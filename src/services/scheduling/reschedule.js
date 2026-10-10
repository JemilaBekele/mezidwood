/**
 * Live rescheduling + capacity lifecycle (Phase 8: transactional + mode-aware).
 *
 * After a project is created its schedule is NOT frozen. When a stage completes
 * (early or late) or is cancelled, we (a) return its reserved capacity to the
 * pool, (b) — only when the project's scheduleMode allows automatic movement —
 * reschedule the not-yet-started downstream stages and recompute the delivery
 * date, and (c) record a ScheduleHistory audit row.
 *
 * Durability rules:
 *   - Every write goes through a Prisma client that can be a transaction client.
 *     The named lifecycle entry points (onStageCompleted / onStageCancelled /
 *     rescheduleWholeProject / rescheduleDownstream / releaseProjectCapacity)
 *     run inside ONE interactive transaction so capacity counters, stage dates,
 *     allocations and the audit log never end up half-applied. When a caller
 *     already owns a transaction it passes its `client`, and we reuse it
 *     (Prisma has no nested interactive transactions).
 *   - Capacity accounting (release on completion/cancel/delete) ALWAYS runs,
 *     regardless of scheduleMode. Only DATE MOVEMENT is gated by the mode.
 */
const prisma = require('../prisma');
const { getCalendar, markerDayKey } = require('./calendar');
const { getSchedulingSettings } = require('./settings');
const {
  computeStageQuantities,
  scheduleProject,
  dailyCapacityDate,
  deliveryDateFor,
  effectiveDailyMax,
  PHASES,
} = require('./engine');
const {
  deliveryBufferDays,
  OVERCAPACITY_FACTOR,
  CAPACITY_STAGES,
} = require('./config');

// Per-day allocation loops do several sequential writes; give the interactive
// transaction generous headroom (per-project scale is tiny relative to this).
const TX_OPTS = { timeout: 30000, maxWait: 15000 };
// Compaction re-plans many stages across every open project in one atomic
// transaction, which can outlast the default 30s.
const COMPACT_TX_OPTS = { timeout: 180000, maxWait: 15000 };

const phaseIndexOf = (stage) => PHASES.findIndex((phase) => phase.includes(stage));

/**
 * Build the per-stage manual-duration map (minutes) the engine honours so a
 * user-fixed time "sticks" across re-plans. A stage qualifies when the user
 * pinned it (autoSchedule === false) and gave it a positive timeTaken, and it
 * is still live. Engine ignores entries for non-capacity stages.
 */
const manualDurationsOf = (stages) => {
  const map = {};
  (stages || []).forEach((s) => {
    if (
      s.autoSchedule === false
      && (s.timeTaken || 0) > 0
      && s.status !== 'CANCELLED'
      && !s.finished
    ) {
      map[s.stage] = s.timeTaken;
    }
  });
  return map;
};

// Units carry 2-decimal precision (the engine produces fractional per-day units
// for partial/overcapacity days). Persisted allocation units must use the SAME
// rounding the daily counter uses (engine flushUsage round2) so a day's
// usedCapacity always equals the sum of its allocation rows — no drift.
const round2 = (n) => Math.round((n || 0) * 100) / 100;
const EPS = 0.001;

const validDateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const maxInstant = (...values) => {
  const dates = values.map(validDateOrNull).filter(Boolean);
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((d) => d.getTime())));
};

const minInstant = (...values) => {
  const dates = values.map(validDateOrNull).filter(Boolean);
  if (!dates.length) return null;
  return new Date(Math.min(...dates.map((d) => d.getTime())));
};

const liveWorkflowStages = (stages) =>
  (stages || []).filter((s) => phaseIndexOf(s.stage) >= 0 && s.status !== 'CANCELLED');

const getStagePhaseStart = (
  stages,
  stageName,
  fallbackInstant = new Date(),
  { floorToFallback = true } = {},
) => {
  const fallback = validDateOrNull(fallbackInstant) || new Date();
  const targetPhase = phaseIndexOf(stageName);
  if (targetPhase < 0) return fallback;

  const liveStages = liveWorkflowStages(stages);
  const samePhaseStarts = liveStages
    .filter((s) => s.stage !== stageName && phaseIndexOf(s.stage) === targetPhase)
    .map((s) => validDateOrNull(s.startDateTime || s.startDate))
    .filter(Boolean);

  let candidate = samePhaseStarts.length ? minInstant(...samePhaseStarts) : null;
  if (!candidate) {
    for (let phaseIdx = targetPhase - 1; phaseIdx >= 0; phaseIdx -= 1) {
      const priorEnds = liveStages
        .filter((s) => phaseIndexOf(s.stage) === phaseIdx)
        .map((s) => validDateOrNull(s.endDateTime || s.endDate))
        .filter(Boolean);
      if (priorEnds.length) {
        candidate = maxInstant(...priorEnds);
        break;
      }
    }
  }

  if (!candidate) return fallback;
  return floorToFallback ? maxInstant(candidate, fallback) : candidate;
};

const getDownstreamStagesForPhase = (stages, completedStage) => {
  const completedPhase = phaseIndexOf(completedStage);
  if (completedPhase < 0) return [];

  return stages.filter((s) => {
    const stagePhase = phaseIndexOf(s.stage);
    return stagePhase > completedPhase && s.status === 'ACTIVE' && !s.finished;
  });
};

const getPhaseBarrierInstant = (stages, completedStage, fallbackInstant = new Date()) => {
  const fallback = validDateOrNull(fallbackInstant) || new Date();
  const completedPhase = phaseIndexOf(completedStage);
  if (completedPhase < 0) return fallback;

  let barrier = fallback.getTime();
  stages.forEach((s) => {
    if (phaseIndexOf(s.stage) !== completedPhase || s.status === 'CANCELLED') return;
    const end = validDateOrNull(s.endDateTime || s.endDate);
    if (end && end.getTime() > barrier) barrier = end.getTime();
  });
  return new Date(barrier);
};

const sumMaterialQuantities = (invoice) => {
  const materials = { laminatedMDF: 0, plainMDF: 0, wood: 0, metal: 0, other: 0 };

  (invoice?.items || []).forEach((item) => {
    (item.proformaItemMaterials || []).forEach((pim) => {
      const qty = Number(pim.quantity || 0) + Number(pim.additionalQuantity || 0);
      if (qty <= 0) return;
      const material = pim.material || {};
      if (material.laminatedMDF) materials.laminatedMDF += qty;
      else if (material.plainMDF) materials.plainMDF += qty;
      else if (material.wood) materials.wood += qty;
      else if (material.metal) materials.metal += qty;
      else materials.other += qty;
    });
  });

  return materials;
};

const totalMaterialQuantity = (materials) =>
  Number(materials?.laminatedMDF || 0) +
  Number(materials?.plainMDF || 0) +
  Number(materials?.wood || 0) +
  Number(materials?.metal || 0);

const materialStageQuantities = (invoice, existingByStage = new Map()) => {
  const materials = sumMaterialQuantities(invoice);
  const stageQuantities = computeStageQuantities(materials);
  const totalProjectQuantity = totalMaterialQuantity(materials);

  if (invoice?.customer?.isdefault === true) {
    stageQuantities.DELIVERY = 0;
    stageQuantities.INSTALLATION = 0;
  }

  const existingCnc = existingByStage.get('CNC');
  const existingCncUnits = Number(existingCnc?.workUnits || 0);
  if (existingCncUnits > 0 && existingCnc?.status !== 'CANCELLED') {
    stageQuantities.CNC = existingCncUnits;
  }

  return { materials, stageQuantities, totalProjectQuantity };
};

/**
 * Run `fn(client)` inside the provided client if one is given (the caller owns
 * the transaction), otherwise open a fresh interactive transaction. Lets the
 * low-level helpers compose into one atomic operation OR run standalone.
 */
const withClient = (client, fn, txOpts = TX_OPTS) =>
  (client ? fn(client) : prisma.$transaction(fn, txOpts));
const withCompactClient = (client, fn) =>
  withClient(client, fn, COMPACT_TX_OPTS);

/** Best-effort audit log — never let history writing break a schedule op. */
const logScheduleEvent = async (client, data) => {
  try {
    await client.scheduleHistory.create({ data });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[reschedule] could not write ScheduleHistory:', err.message);
  }
};

/**
 * Return capacity reserved by a project stage to the daily pool and remove its
 * allocation rows. If `releaseFrom` is given, only allocations on/after that
 * calendar day are released (a stage finishing early keeps its past days
 * consumed but frees the planned future ones).
 */
const releaseStageCapacity = async (projectStageId, releaseFrom = null, client = prisma) => {
  const allocations = await client.projectStageCapacityAllocation.findMany({
    where: { projectStageId },
  });
  // `releaseFrom` is an arbitrary INSTANT (usually the completion moment), so
  // its day must be read in the business timezone. Slicing the ISO string gave
  // the UTC day instead: a stage completed after midnight local time resolved
  // to the previous day, moving the cutoff back and freeing a day that had
  // already been worked.
  const cal = releaseFrom ? await getCalendar() : null;
  const cutoff = releaseFrom
    ? dailyCapacityDate(cal.businessDayKey(new Date(releaseFrom)))
    : null;

  for (const a of allocations) {
    if (cutoff && new Date(a.allocationDate) < cutoff) continue;
    // eslint-disable-next-line no-await-in-loop
    const daily = await client.dailyStageCapacity.findUnique({
      where: { id: a.dailyStageCapacityId },
    });
    if (daily) {
      // Clamp at zero. A bare `{ decrement }` trusts that the counter still
      // holds at least what this allocation booked; any drift (a double
      // release, a partially-applied write) then pushed usedCapacity negative,
      // which reads downstream as "this day has MORE than full capacity free"
      // and silently overbooks it.
      const decrementData = {
        usedCapacity: {
          decrement: Math.min(a.allocatedUnits, daily.usedCapacity || 0),
        },
        usedHours: {
          decrement: Math.min(a.allocatedHours, daily.usedHours || 0),
        },
      };
      // If this allocation was marked as overcapacity, also decrement the over fields
      if (a.isOverCapacity && (daily.overCapacityUsed || 0) > 0) {
        decrementData.overCapacityUsed = {
          decrement: Math.min(a.allocatedUnits, daily.overCapacityUsed || 0),
        };
        decrementData.overHoursCapacityUsed = {
          decrement: Math.min(a.allocatedHours, daily.overHoursCapacityUsed || 0),
        };
      }
      // eslint-disable-next-line no-await-in-loop
      await client.dailyStageCapacity.update({
        where: { id: daily.id },
        data: decrementData,
      });
    }
    // eslint-disable-next-line no-await-in-loop
    await client.projectStageCapacityAllocation.delete({ where: { id: a.id } });
  }
  return allocations.length;
};

/** Release EVERY stage's reserved capacity for a project (cancel / delete). */
const releaseProjectCapacity = async (projectId, client = prisma) => {
  const stages = await client.projectStage.findMany({
    where: { projectId },
    select: { id: true },
  });
  let released = 0;
  for (const s of stages) {
    // eslint-disable-next-line no-await-in-loop
    released += await releaseStageCapacity(s.id, null, client);
  }
  return released;
};

/** Recreate ProjectStageCapacityAllocation rows for a stage from an engine plan. */
const persistStageAllocations = async (projectStageId, stage, allocations, client = prisma, overCapacityFactor = 1.0) => {
  for (const alloc of allocations || []) {
    const date = dailyCapacityDate(alloc.date);
    // eslint-disable-next-line no-await-in-loop
    let daily = await client.dailyStageCapacity.findUnique({
      where: { stage_date: { stage, date } },
    });
    // A missing daily row used to `continue`, silently dropping the allocation.
    // The commit run has ALREADY incremented that day's usedCapacity, so
    // skipping the row left counted capacity with no allocation backing it —
    // permanently unreleasable, and a direct violation of the invariant that a
    // day's usedCapacity equals the sum of its allocations. Materialise the row
    // instead so the two sides stay reconcilable.
    if (!daily) {
      // eslint-disable-next-line no-await-in-loop
      const lot = await client.capacityLot.findUnique({ where: { stage } });
      const cal = await getCalendar();
      const dailyMax = effectiveDailyMax({
        capacity: lot?.capacity || 1,
        parallelSlots: lot?.parallelSlots || 1,
      });
      // eslint-disable-next-line no-await-in-loop
      daily = await client.dailyStageCapacity.upsert({
        where: { stage_date: { stage, date } },
        create: {
          stage,
          date,
          shift: alloc.shift || 'FULL_DAY',
          usedCapacity: round2(alloc.units),
          maxCapacity: dailyMax,
          workingHours: cal.workingHoursPerDay,
          usedHours: round2(alloc.hours),
          maxHours: cal.workingHoursPerDay,
        },
        update: {},
      });
    }
    // An allocation is overcapacity when the factor was > 1.0 AND this day's
    // total usage now exceeds the base (non-overcapacity) maximum.
    const isOver = overCapacityFactor > 1.0
      && (daily.usedCapacity || 0) > (daily.maxCapacity || 0);
    // eslint-disable-next-line no-await-in-loop
    await client.projectStageCapacityAllocation.create({
      data: {
        projectStageId,
        dailyStageCapacityId: daily.id,
        allocatedUnits: round2(alloc.units),
        allocatedHours: round2(alloc.hours),
        shift: alloc.shift || 'FULL_DAY',
        startDateTime: alloc.startDateTime,
        endDateTime: alloc.endDateTime,
        customStartTime: alloc.startDateTime,
        customEndTime: alloc.endDateTime,
        allocationDate: date,
        isOverCapacity: isOver,
      },
    });
  }
};

/**
 * Release ONLY `units` of a stage's allocation on a SINGLE day (partial move).
 * Reduces (or deletes) that day's allocation row(s) and decrements the shared
 * DailyStageCapacity counters by exactly the moved amount — so the day's
 * usedCapacity stays equal to the sum of its allocation rows. Other days of the
 * stage, parallel peers, and other projects are untouched.
 * @returns {number} the units actually released (<= requested, <= cell units)
 */
const releaseStageUnitsOnDay = async (projectStageId, date, units, client = prisma) => {
  const allocs = await client.projectStageCapacityAllocation.findMany({
    where: { projectStageId, allocationDate: date },
  });
  let remaining = round2(units);
  for (const a of allocs) {
    if (remaining <= EPS) break;
    const take = Math.min(remaining, a.allocatedUnits || 0);
    if (take <= EPS) continue;
    const ratio = (a.allocatedUnits || 0) > 0 ? take / a.allocatedUnits : 0;
    const hoursTake = round2((a.allocatedHours || 0) * ratio);
    // eslint-disable-next-line no-await-in-loop
    const daily = await client.dailyStageCapacity.findUnique({ where: { id: a.dailyStageCapacityId } });
    if (daily) {
      const decrement = { usedCapacity: { decrement: round2(take) }, usedHours: { decrement: hoursTake } };
      if (a.isOverCapacity && (daily.overCapacityUsed || 0) > 0) {
        decrement.overCapacityUsed = { decrement: Math.min(round2(take), daily.overCapacityUsed || 0) };
        decrement.overHoursCapacityUsed = { decrement: Math.min(hoursTake, daily.overHoursCapacityUsed || 0) };
      }
      // eslint-disable-next-line no-await-in-loop
      await client.dailyStageCapacity.update({ where: { id: daily.id }, data: decrement });
    }
    if (take >= (a.allocatedUnits || 0) - EPS) {
      // eslint-disable-next-line no-await-in-loop
      await client.projectStageCapacityAllocation.delete({ where: { id: a.id } });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await client.projectStageCapacityAllocation.update({
        where: { id: a.id },
        data: {
          allocatedUnits: round2((a.allocatedUnits || 0) - take),
          allocatedHours: round2((a.allocatedHours || 0) - hoursTake),
        },
      });
    }
    remaining = round2(remaining - take);
  }
  return round2(units) - remaining;
};

/**
 * Recompute a stage's span (start/end/capacityDays/timeTaken) from ALL of its
 * current allocation rows, after some have been added/removed (e.g. a single-day
 * cell move). Writes the stage row; returns { newStart, newEnd } or null.
 */
const recomputeStageSpan = async (stageId, tx) => {
  const allAllocs = await tx.projectStageCapacityAllocation.findMany({
    where: { projectStageId: stageId },
  });
  if (!allAllocs.length) return null;
  const starts = allAllocs.map((a) => new Date(a.startDateTime || a.customStartTime || a.allocationDate).getTime());
  const ends = allAllocs.map((a) => new Date(a.endDateTime || a.customEndTime || a.allocationDate).getTime());
  const newStart = new Date(Math.min(...starts));
  const newEnd = new Date(Math.max(...ends));
  const days = new Set(allAllocs.map((a) => markerDayKey(a.allocationDate))).size;
  const totalHours = allAllocs.reduce((sum, a) => sum + (a.allocatedHours || 0), 0);
  await tx.projectStage.update({
    where: { id: stageId },
    data: {
      startDate: newStart,
      startDateTime: newStart,
      endDate: newEnd,
      endDateTime: newEnd,
      capacityDays: days,
      timeTaken: Math.round(totalHours * 60),
    },
  });
  return { newStart, newEnd };
};

/**
 * Recompute calculatedDelivery + totalDays from the project's current stage
 * dates (CANCELLED stages excluded). Captures the previous delivery so callers
 * can log the change. Returns { oldDelivery, newDelivery, productionWorkingDays }.
 */
const recomputeProjectDelivery = async (projectId, client = prisma) => {
  const project = await client.project.findUnique({
    where: { id: projectId },
    include: { stages: true },
  });
  if (!project || project.stages.length === 0) return null;

  const live = project.stages.filter((s) => s.status !== 'CANCELLED');
  if (live.length === 0) return null;

  const cal = await getCalendar();
  const settings = await getSchedulingSettings();
  const startTimes = live
    .map((s) => new Date(s.startDateTime || s.startDate))
    .filter((d) => !Number.isNaN(d.getTime()))
    .map((d) => d.getTime());
  const endTimes = live
    .map((s) => new Date(s.endDateTime || s.endDate))
    .filter((d) => !Number.isNaN(d.getTime()))
    .map((d) => d.getTime());
  if (!startTimes.length || !endTimes.length) return null;

  const firstStart = new Date(Math.min(...startTimes));
  const lastEnd = new Date(Math.max(...endTimes));
  const productionWorkingDays = cal.workingDaysBetween(firstStart, lastEnd);
  // AL-1: the buffer is walked from the END of production, not from its start.
  // `productionWorkingDays` is an INCLUSIVE count, so adding it to firstStart
  // double-counted the first day and pushed every promised date one working day
  // late. Identical rule to engine.buildSchedule — one function, both callers.
  const { deliveryDate } = deliveryDateFor(
    cal,
    lastEnd,
    productionWorkingDays,
    project.difficulty,
    settings,
  );
  const estimatedDays =
    productionWorkingDays
    + deliveryBufferDays(productionWorkingDays, project.difficulty, settings);
  const oldDelivery = project.calculatedDelivery;

  await client.project.update({
    where: { id: projectId },
    data: { calculatedDelivery: deliveryDate, totalDays: productionWorkingDays },
  });
  return { oldDelivery, newDelivery: deliveryDate, deliveryDate, productionWorkingDays, estimatedDays };
};

/**
 * Reschedule the project's not-yet-started downstream stages by workflow phase.
 * Same-phase peers stay anchored because they run in parallel for the same
 * project. The next phase starts at the latest end of the edited/completed phase.
 * Does NOT gate on scheduleMode; callers decide whether to invoke it.
 *
 * `overCapacityFactor` lets a USER-initiated edit (manual stage time/quantity
 * change) pack downstream up to 125% — matching the calendar drag — while
 * automatic (completion/cancel) cascades stay at 100% (the default).
 */
const rescheduleDownstream = async (
  projectId,
  completedStage,
  startInstant,
  client = null,
  overCapacityFactor = 1.0,
) =>
  withClient(client, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { stages: true },
    });
    if (!project) return null;

    const downstream = getDownstreamStagesForPhase(project.stages, completedStage);
    const downstreamStart = getPhaseBarrierInstant(project.stages, completedStage, startInstant);
    if (downstream.length === 0) {
      return recomputeProjectDelivery(projectId, tx);
    }

    for (const s of downstream) {
      // eslint-disable-next-line no-await-in-loop
      await releaseStageCapacity(s.id, null, tx);
    }

    const stageQuantities = {};
    downstream.forEach((s) => {
      stageQuantities[s.stage] = s.workUnits || 0;
    });
    const plan = await scheduleProject({
      stageQuantities,
      startDate: downstreamStart,
      difficulty: project.difficulty,
      mode: 'commit',
      tx,
      overCapacityFactor,
      // Use each team's free hours (before/between/after other projects'
      // bookings), not only the time after its latest booking.
      fillGaps: true,
      // Honour any user-fixed durations on downstream stages so a manual time
      // sticks through this cascade instead of reverting to quantity-derived.
      manualDurations: manualDurationsOf(downstream),
    });
    const planByStage = {};
    plan.stages.forEach((p) => {
      planByStage[p.stage] = p;
    });

    for (const s of downstream) {
      const p = planByStage[s.stage];
      if (!p) continue;
      // eslint-disable-next-line no-await-in-loop
      await tx.projectStage.update({
        where: { id: s.id },
        data: {
          startDate: p.startDateTime,
          endDate: p.endDateTime,
          startDateTime: p.startDateTime,
          endDateTime: p.endDateTime,
          capacityDays: p.capacityDays,
          shift: p.shift,
          // timeTaken now reflects the plan: a manual-duration stage gets its
          // user-fixed minutes back from the engine; auto stages get the fresh value.
          timeTaken: p.timeTaken,
        },
      });
      // eslint-disable-next-line no-await-in-loop
      await persistStageAllocations(s.id, s.stage, p.allocations, tx);
    }

    return recomputeProjectDelivery(projectId, tx);
  });

/**
 * Re-schedule an ENTIRE project from `startInstant` using the unified engine
 * (DAG + capacity-aware). COMPLETED/finished and CANCELLED stages stay anchored
 * (their dates and consumed capacity are real). Used by auto- and manual
 * (back-)scheduling so they share one calendar/engine with createProject.
 */
const rescheduleWholeProject = async (projectId, startInstant, client = null) =>
  withClient(client, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { stages: true },
    });
    if (!project) return null;

    const active = project.stages.filter(
      (s) => s.status !== 'CANCELLED' && s.status !== 'COMPLETED' && !s.finished,
    );

    // DELIVERY is manually managed and is deliberately skipped by the update
    // loop below. It must therefore be skipped HERE too: releasing its capacity
    // and then letting the commit run re-book it — while never re-persisting its
    // allocation rows — left counted capacity with nothing backing it, which no
    // later release could ever return to the pool. DELIVERY is now left entirely
    // untouched by a whole-project rebuild: same dates, same allocations, same
    // capacity.
    const rebuildable = active.filter((s) => s.stage !== 'DELIVERY');

    for (const s of rebuildable) {
      // eslint-disable-next-line no-await-in-loop
      await releaseStageCapacity(s.id, null, tx);
    }

    // Projects pipeline by stage team. Once this project's own future capacity
    // is released, existing usage from other projects only blocks the same
    // stage/team instead of pushing the whole project behind all workshop work.
    const effStart = new Date(startInstant);

    // DELIVERY is excluded from the plan as well — a commit run books capacity
    // for every stage it is given, so including it here is what created the
    // orphaned reservation described above.
    const stageQuantities = {};
    rebuildable.forEach((s) => {
      stageQuantities[s.stage] = s.workUnits || 0;
    });

    const plan = await scheduleProject({
      stageQuantities,
      startDate: effStart,
      difficulty: project.difficulty,
      mode: 'commit',
      tx,
      // Same free-window filling as createProject.
      fillGaps: true,
      // A user-fixed duration sticks through a full rebuild too.
      manualDurations: manualDurationsOf(rebuildable),
    });
    const planByStage = {};
    plan.stages.forEach((p) => {
      planByStage[p.stage] = p;
    });

    for (const s of rebuildable) {
      const p = planByStage[s.stage];
      if (!p) continue;
      // eslint-disable-next-line no-await-in-loop
      await tx.projectStage.update({
        where: { id: s.id },
        data: {
          startDate: p.startDateTime,
          endDate: p.endDateTime,
          startDateTime: p.startDateTime,
          endDateTime: p.endDateTime,
          capacityDays: p.capacityDays,
          shift: p.shift,
          // Plan is authoritative: a manual-duration stage gets its fixed minutes
          // back (via manualDurations); auto stages get the engine value.
          timeTaken: p.timeTaken,
        },
      });
      // eslint-disable-next-line no-await-in-loop
      await persistStageAllocations(s.id, s.stage, p.allocations, tx);
    }

    await recomputeProjectDelivery(projectId, tx);
    return plan;
  });

const reallocateProjectFromInvoiceMaterials = async (
  projectId,
  { client = null, byUserId = null, startInstant = new Date() } = {},
) =>
  withClient(client, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: {
        stages: true,
        invoice: {
          include: {
            customer: true,
            items: {
              include: {
                proformaItemMaterials: { include: { material: true } },
              },
            },
          },
        },
      },
    });
    if (!project) return null;
    if (!project.invoice) return recomputeProjectDelivery(projectId, tx);

    const existingByStage = new Map(project.stages.map((s) => [s.stage, s]));
    const { materials, stageQuantities, totalProjectQuantity } = materialStageQuantities(
      project.invoice,
      existingByStage,
    );

    const start = validDateOrNull(startInstant) || new Date();
    const scheduleQuantities = {};
    const stageState = {};

    const allStages = Array.from(
      new Set([
        ...Object.keys(stageQuantities),
        ...project.stages.map((s) => s.stage),
      ]),
    ).filter((stage) => stage !== 'INVOICE' && (phaseIndexOf(stage) >= 0 || stage === 'PURCHASING'));

    for (const stageName of allStages) {
      const plannedUnits = Number(stageQuantities[stageName] || 0);
      const existing = existingByStage.get(stageName);
      const actualUnits = Number(existing?.actualWorkUnits || 0);
      const remainingUnits = Math.max(0, plannedUnits - actualUnits);

      if (plannedUnits <= 0) {
        if (!existing) continue;
        // eslint-disable-next-line no-await-in-loop
        await releaseStageCapacity(existing.id, null, tx);
        const hasActualWork = actualUnits > 0;
        // eslint-disable-next-line no-await-in-loop
        await tx.projectStage.update({
          where: { id: existing.id },
          data: {
            workUnits: 0,
            actualWorkUnits: actualUnits,
            finished: hasActualWork,
            status: hasActualWork ? 'COMPLETED' : 'CANCELLED',
            autoSchedule: true,
          },
        });
        continue;
      }

      let stageRow = existing;
      if (!stageRow) {
        // eslint-disable-next-line no-await-in-loop
        stageRow = await tx.projectStage.create({
          data: {
            projectId,
            stage: stageName,
            workUnits: plannedUnits,
            actualWorkUnits: 0,
            capacityDays: 1,
            timeTaken: 0,
            startDate: start,
            endDate: start,
            startDateTime: start,
            endDateTime: start,
            customStartTime: start,
            customEndTime: start,
            shift: 'CUSTOM',
            autoSchedule: true,
            status: 'ACTIVE',
            finished: false,
          },
        });
      }

      if (remainingUnits <= 0) {
        // eslint-disable-next-line no-await-in-loop
        await releaseStageCapacity(stageRow.id, null, tx);
        // eslint-disable-next-line no-await-in-loop
        await tx.projectStage.update({
          where: { id: stageRow.id },
          data: {
            workUnits: plannedUnits,
            actualWorkUnits: actualUnits,
            finished: true,
            status: 'COMPLETED',
            autoSchedule: true,
          },
        });
        continue;
      }

      if (stageRow.status === 'COMPLETED' || stageRow.finished) {
        // Keep historical completed allocations, but free any planned future rows.
        // eslint-disable-next-line no-await-in-loop
        await releaseStageCapacity(stageRow.id, start, tx);
      } else {
        // eslint-disable-next-line no-await-in-loop
        await releaseStageCapacity(stageRow.id, null, tx);
      }

      // eslint-disable-next-line no-await-in-loop
      const activeRow = await tx.projectStage.update({
        where: { id: stageRow.id },
        data: {
          workUnits: plannedUnits,
          actualWorkUnits: actualUnits,
          finished: false,
          status: 'ACTIVE',
          autoSchedule: true,
        },
      });

      scheduleQuantities[stageName] = remainingUnits;
      stageState[stageName] = {
        row: activeRow,
        plannedUnits,
        actualUnits,
      };
    }

    let plan = { stages: [] };
    if (Object.values(scheduleQuantities).some((qty) => qty > 0)) {
      plan = await scheduleProject({
        stageQuantities: scheduleQuantities,
        startDate: start,
        difficulty: project.difficulty,
        mode: 'commit',
        tx,
        // Same free-window filling as createProject.
        fillGaps: true,
      });
    }

    const planByStage = new Map(plan.stages.map((p) => [p.stage, p]));
    for (const [stageName, state] of Object.entries(stageState)) {
      const p = planByStage.get(stageName);
      if (!p) {
        throw new Error(`Material reallocation did not produce a schedule for ${stageName}`);
      }
      // eslint-disable-next-line no-await-in-loop
      await tx.projectStage.update({
        where: { id: state.row.id },
        data: {
          workUnits: state.plannedUnits,
          actualWorkUnits: state.actualUnits,
          startDate: p.startDateTime,
          endDate: p.endDateTime,
          startDateTime: p.startDateTime,
          endDateTime: p.endDateTime,
          customStartTime: p.customStartTime,
          customEndTime: p.customEndTime,
          capacityDays: p.capacityDays,
          shift: p.shift,
          timeTaken: p.timeTaken,
          finished: false,
          status: 'ACTIVE',
          autoSchedule: true,
        },
      });
      // eslint-disable-next-line no-await-in-loop
      await persistStageAllocations(state.row.id, stageName, p.allocations, tx);
    }

    await tx.project.update({
      where: { id: projectId },
      data: { totalProjectQuantity },
    });

    const result = await recomputeProjectDelivery(projectId, tx);
    await logScheduleEvent(tx, {
      projectId,
      event: 'RESCHEDULED',
      trigger: byUserId ? 'USER' : 'SYSTEM',
      byUserId,
      oldDelivery: result ? result.oldDelivery : project.calculatedDelivery,
      newDelivery: result ? result.newDelivery : project.calculatedDelivery,
      reason: 'Project materials changed; stage quantities and capacity were reallocated',
    });

    return {
      ...result,
      materials,
      stageQuantities,
      totalProjectQuantity,
      scheduledStages: Object.keys(scheduleQuantities),
    };
  });

/**
 * Called when a stage is marked COMPLETED. Always frees the stage's unused
 * future capacity; cascades to downstream + recomputes delivery ONLY when the
 * project's scheduleMode is AUTO. Always writes a STAGE_COMPLETED audit row.
 */
const onStageCompleted = async (projectId, stage, completionInstant = new Date(), client = null) =>
  withClient(client, async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) return null;

    const ps = await tx.projectStage.findFirst({ where: { projectId, stage } });
    if (ps) {
      await releaseStageCapacity(ps.id, completionInstant, tx); // free planned-but-unused future days
    }

    const auto = project.scheduleMode === 'AUTO';
    let result = null;
    if (auto) {
      result = await rescheduleDownstream(projectId, stage, completionInstant, tx);
    }

    await logScheduleEvent(tx, {
      projectId,
      event: 'STAGE_COMPLETED',
      trigger: 'COMPLETION',
      stage,
      oldDelivery: result ? result.oldDelivery : project.calculatedDelivery,
      newDelivery: result ? result.newDelivery : project.calculatedDelivery,
      reason: auto
        ? 'Stage completed; downstream rescheduled'
        : `Stage completed; capacity released, schedule held (mode=${project.scheduleMode})`,
    });
    return result;
  });

/**
 * Called when a stage is CANCELLED. Frees ALL its reserved capacity, marks the
 * stage CANCELLED, and (AUTO only) reschedules the remaining downstream stages
 * — the cancelled stage drops out of the DAG automatically. Writes an audit row.
 */
const onStageCancelled = async (projectId, stage, byUserId = null, client = null) =>
  withClient(client, async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) return null;

    const ps = await tx.projectStage.findFirst({ where: { projectId, stage } });
    if (!ps) return null;

    await releaseStageCapacity(ps.id, null, tx); // free everything it reserved
    await tx.projectStage.update({
      where: { id: ps.id },
      data: { status: 'CANCELLED', workUnits: 0 },
    });

    const auto = project.scheduleMode === 'AUTO';
    let result = null;
    if (auto) {
      result = await rescheduleDownstream(
        projectId,
        stage,
        ps.startDateTime || ps.startDate || new Date(),
        tx,
      );
    }

    await logScheduleEvent(tx, {
      projectId,
      event: 'STAGE_CANCELLED',
      trigger: 'CANCELLATION',
      stage,
      byUserId,
      oldDelivery: result ? result.oldDelivery : project.calculatedDelivery,
      newDelivery: result ? result.newDelivery : project.calculatedDelivery,
      reason: auto
        ? 'Stage cancelled; downstream rescheduled'
        : `Stage cancelled; capacity released, schedule held (mode=${project.scheduleMode})`,
    });
    return result;
  });


/**
 * Release every downstream stage and re-plan it from a barrier instant.
 * Shared by the whole-phase and partial-unit reschedule paths. Other projects
 * are never touched. Returns the rescheduled stage names.
 */
const recomputeDownstreamFromBarrier = async (
  downstreamStages,
  downstreamStart,
  project,
  tx,
  overCapacityFactor,
) => {
  if (!downstreamStages.length) return [];
  for (const s of downstreamStages) {
    // eslint-disable-next-line no-await-in-loop
    await releaseStageCapacity(s.id, null, tx);
  }
  const downstreamQuantities = {};
  downstreamStages.forEach((s) => {
    downstreamQuantities[s.stage] = s.workUnits || 0;
  });
  const downstreamPlan = await scheduleProject({
    stageQuantities: downstreamQuantities,
    startDate: downstreamStart,
    difficulty: project.difficulty,
    mode: 'commit',
    tx,
    overCapacityFactor,
    // Downstream of a drag also uses each team's free windows, not only the
    // time after its latest booking.
    fillGaps: true,
    // User-fixed downstream durations stick through the drag cascade too.
    manualDurations: manualDurationsOf(downstreamStages),
  });
  const planByStage = {};
  downstreamPlan.stages.forEach((p) => {
    planByStage[p.stage] = p;
  });
  const names = [];
  for (const s of downstreamStages) {
    const p = planByStage[s.stage];
    if (!p) continue;
    // eslint-disable-next-line no-await-in-loop
    await tx.projectStage.update({
      where: { id: s.id },
      data: {
        startDate: p.startDateTime,
        endDate: p.endDateTime,
        startDateTime: p.startDateTime,
        endDateTime: p.endDateTime,
        capacityDays: p.capacityDays,
        shift: p.shift,
        // Plan is authoritative: manual-duration stages get their fixed minutes
        // back (via manualDurations); auto stages get the engine value.
        timeTaken: p.timeTaken,
      },
    });
    // eslint-disable-next-line no-await-in-loop
    await persistStageAllocations(s.id, s.stage, p.allocations, tx, overCapacityFactor);
    names.push(s.stage);
  }
  return names;
};

/**
 * Reschedule a stage + its downstream stages within ONE project.
 * Upstream stages and other projects are NEVER touched.
 *
 * Two modes, switched by `units`:
 *  - FULL (units omitted / >= the source-day cell): the dragged stage AND its
 *    same-phase parallel peers move together from `fromDate` onward (the
 *    "whole phase" behaviour).
 *  - PARTIAL (units < the source-day cell): ONLY `units` of the dragged stage,
 *    taken from the `fromDate` day, relocate to `newStartDate`; the parallel
 *    peer stays; the remaining cell units stay put.
 * In BOTH modes the project's downstream stages recompute off the phase barrier.
 *
 * @param {string} projectId
 * @param {string} stageName  - the stage being dragged / moved
 * @param {Date|string} newStartDate - target start date for that stage
 * @param {object} [options]
 * @param {object} [options.client] - existing tx client (optional)
 * @param {string} [options.byUserId] - audit trail
 * @param {number} [options.overCapacityFactor] - default 1.25 (25% overcapacity)
 * @param {Date|string} [options.fromDate] - the dragged day; only release from
 *   this day onward (full) or this day's units (partial).
 * @param {number} [options.units] - partial move: how many of the cell's units
 *   to relocate. Omit or >= cell units for a full whole-phase move.
 */
const rescheduleStageAndDownstream = async (
  projectId,
  stageName,
  newStartDate,
  {
    client = null,
    byUserId = null,
    overCapacityFactor = OVERCAPACITY_FACTOR,
    fromDate = null,
    units = null,
    pastCellMove = false,
  } = {},
) =>
  withClient(client, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: {
        stages: {
          include: {
            projectStageCapacityAllocations: true,
          },
        },
      },
    });
    if (!project) return null;

    const targetPhase = phaseIndexOf(stageName);
    if (targetPhase < 0) return null;

    // ── Identify the dragged stage, its parallel peers, and downstream ──
    // Only the SPECIFICALLY DRAGGED stage is rescheduled within its phase.
    // Parallel peers (other stages in the same phase) are LEFT UNTOUCHED.
    // Stages in LATER phases are fully rescheduled from the phase barrier.
    const draggedStage = project.stages.find((s) =>
      s.stage === stageName
      && s.status !== 'CANCELLED'
      && s.status !== 'COMPLETED'
      && !s.finished,
    );
    if (!draggedStage) return null;

    // Parallel peers: same phase, different stage, still active — NOT rescheduled
    const parallelPeers = project.stages.filter((s) =>
      s.stage !== stageName
      && phaseIndexOf(s.stage) === targetPhase
      && s.status !== 'CANCELLED'
      && s.status !== 'COMPLETED'
      && !s.finished,
    );

    // Downstream: later phases, still active
    const downstreamStages = project.stages.filter((s) => {
      if (s.status === 'CANCELLED' || s.status === 'COMPLETED' || s.finished) return false;
      return phaseIndexOf(s.stage) > targetPhase;
    });

    const effectiveFromDate = fromDate ? new Date(fromDate) : null;
    // `fromDate` is the instant the user dragged FROM, so its calendar day must
    // be resolved in the business timezone — a UTC slice picks the wrong day for
    // any instant outside the window where the two calendars coincide, and this
    // cutoff decides which allocation cells get moved.
    const dragCal = effectiveFromDate ? await getCalendar() : null;
    const fromDateCutoff = effectiveFromDate
      ? dailyCapacityDate(dragCal.businessDayKey(effectiveFromDate))
      : null;
    // A calendar drop names a DAY, not a time (the client encodes 08:00Z, i.e.
    // 11:00 EAT, which hid the whole morning). Start from that day's opening
    // time (Scheduling Settings) — or from now, if the day is today — and let
    // the engine find the team's free windows on it (fillGaps).
    const dropCal = dragCal || await getCalendar();
    const dropOpening = dropCal.startOfWorkingDay(new Date(newStartDate));
    const now = new Date();
    const dropStart = dropCal.dayKey(dropOpening) === dropCal.dayKey(now)
      && now.getTime() > dropOpening.getTime()
      ? now
      : dropOpening;
    // Stage sequence, at day level: never on an EARLIER day than this
    // project's earlier phases (e.g. ASSEMBLY after its EDGE_BANDING). On the
    // day those phases end it may share the day — work is handed on as it is
    // done — but it starts no earlier than they start on that day.
    const upstreamStages = project.stages.filter((s) =>
      phaseIndexOf(s.stage) >= 0
      && phaseIndexOf(s.stage) < targetPhase
      && s.status !== 'CANCELLED'
      && s.status !== 'COMPLETED'
      && !s.finished);
    const upstreamEnds = upstreamStages
      .map((s) => validDateOrNull(s.endDateTime || s.endDate))
      .filter(Boolean)
      .map((d) => d.getTime());
    const upstreamEnd = upstreamEnds.length ? Math.max(...upstreamEnds) : 0;
    let effStart = dropStart;
    if (upstreamEnd > 0) {
      const lastUpstreamDay = dropCal.dayKey(new Date(upstreamEnd));
      const dropDay = dropCal.dayKey(dropStart);
      if (dropDay <= lastUpstreamDay) {
        const startsThatDay = upstreamStages
          .flatMap((s) => s.projectStageCapacityAllocations || [])
          .map((a) => validDateOrNull(a.startDateTime))
          .filter((d) => d && dropCal.dayKey(d) === lastUpstreamDay)
          .map((d) => d.getTime());
        const dayFloor = startsThatDay.length
          ? Math.min(...startsThatDay)
          : upstreamEnd;
        const base = dropDay === lastUpstreamDay
          ? dropStart.getTime()
          : dropCal.startOfWorkingDay(new Date(upstreamEnd)).getTime();
        effStart = new Date(Math.max(base, dayFloor));
      }
    }

    // ── PAST CELL-MOVE: drop to an EARLIER day ──
    // Move ONLY the source-day cell of the dragged stage AND each parallel peer
    // to the target day. Nothing else is touched — no downstream cascade, no
    // other day/cell of these stages, no other project. (The user's rule for a
    // backward drag.)
    if (pastCellMove && fromDateCutoff) {
      const cellUnitsOnDay = (s) =>
        (s.projectStageCapacityAllocations || [])
          .filter((a) => dailyCapacityDate(markerDayKey(a.allocationDate)).getTime() === fromDateCutoff.getTime())
          .reduce((sum, a) => sum + (a.allocatedUnits || 0), 0);

      // Partial past move (units < the dragged cell): move only `units` of the
      // dragged stage; the parallel peers and the rest of the cell stay put.
      const draggedCellUnits = cellUnitsOnDay(draggedStage);
      const isPastPartial = units != null && units > EPS && units < draggedCellUnits - EPS;

      const moved = [];
      let pastPlan = null;
      for (const s of isPastPartial ? [draggedStage] : [draggedStage, ...parallelPeers]) {
        const cu = isPastPartial ? round2(units) : cellUnitsOnDay(s);
        if (cu <= EPS) continue;
        // Release exactly that day's cell (units >= cell ⇒ row removed), then
        // re-allocate the same units on the target day (125% + overflow forward).
        // eslint-disable-next-line no-await-in-loop
        await releaseStageUnitsOnDay(s.id, fromDateCutoff, cu, tx);
        // eslint-disable-next-line no-await-in-loop
        const plan = await scheduleProject({
          stageQuantities: { [s.stage]: cu },
          startDate: effStart,
          difficulty: project.difficulty,
          mode: 'commit',
          tx,
          overCapacityFactor,
          fillGaps: true,
          fillByDay: true,
        });
        const p = plan.stages.find((x) => x.stage === s.stage);
        if (p) {
          // eslint-disable-next-line no-await-in-loop
          await persistStageAllocations(s.id, s.stage, p.allocations, tx, overCapacityFactor);
        }
        if (s.stage === stageName) pastPlan = plan;
        // eslint-disable-next-line no-await-in-loop
        await recomputeStageSpan(s.id, tx);
        moved.push(s.stage);
      }

      const result = await recomputeProjectDelivery(projectId, tx);
      await logScheduleEvent(tx, {
        projectId,
        event: 'RESCHEDULED',
        trigger: byUserId ? 'USER' : 'SYSTEM',
        stage: stageName,
        byUserId,
        oldDelivery: result ? result.oldDelivery : project.calculatedDelivery,
        newDelivery: result ? result.newDelivery : project.calculatedDelivery,
        reason: isPastPartial
          ? `${round2(units)} unit(s) of ${stageName} moved back to ${effStart.toISOString().slice(0, 10)}; downstream untouched`
          : `Cell ${stageName} (+ parallel peers) moved back to ${effStart.toISOString().slice(0, 10)}; downstream untouched`,
      });
      return {
        ...result,
        rescheduledStages: moved,
        partialFrom: effectiveFromDate ? effectiveFromDate.toISOString().slice(0, 10) : null,
        draggedPlan: pastPlan,
        partialUnits: isPastPartial ? units : null,
      };
    }

    // Units the dragged stage has on the source day ("the cell"). A partial move
    // is requested when `units` is set and is strictly less than the cell.
    const cellUnits = fromDateCutoff
      ? (draggedStage.projectStageCapacityAllocations || [])
          .filter((a) => {
            const ad = dailyCapacityDate(markerDayKey(a.allocationDate));
            return ad.getTime() === fromDateCutoff.getTime();
          })
          .reduce((sum, a) => sum + (a.allocatedUnits || 0), 0)
      : 0;
    const isPartial = units != null && fromDateCutoff
      && units > EPS && units < cellUnits - EPS;

    let phaseEndTimes = [];
    let rescheduledStages = [];
    let movedPlan = null; // the plan containing the dragged stage's new allocations

    if (isPartial) {
      // ── PARTIAL: move only `units` of the dragged stage from the cell day ──
      // The parallel peer and the stage's other days stay put.
      await releaseStageUnitsOnDay(draggedStage.id, fromDateCutoff, units, tx);

      const plan = await scheduleProject({
        stageQuantities: { [stageName]: units },
        startDate: effStart,
        difficulty: project.difficulty,
        mode: 'commit',
        tx,
        overCapacityFactor,
        fillGaps: true,
        fillByDay: true,
      });
      movedPlan = plan;
      const p = plan.stages.find((s) => s.stage === stageName);
      if (p) await persistStageAllocations(draggedStage.id, stageName, p.allocations, tx, overCapacityFactor);

      // Recompute the dragged stage's span from ALL its current allocations
      // (remaining cell units + untouched other days + the new target units).
      const span = await recomputeStageSpan(draggedStage.id, tx);
      if (span) phaseEndTimes.push(span.newEnd.getTime());
      // Barrier also respects the untouched parallel peers' existing ends.
      parallelPeers.forEach((peer) => {
        const e = validDateOrNull(peer.endDateTime || peer.endDate);
        if (e) phaseEndTimes.push(e.getTime());
      });
      rescheduledStages = [stageName];
    } else {
      // ── FULL: move the WHOLE PHASE together (dragged stage + parallel peers) ──
      // Work already done BEFORE fromDate is preserved in place.
      const phaseStages = [draggedStage, ...parallelPeers];
      const phaseQuantities = {};
      const preservedStartDates = {}; // stage -> original start, only when pre-fromDate work exists

      const allocsFromCutoff = (s) =>
        (s.projectStageCapacityAllocations || []).filter((a) => {
          if (!fromDateCutoff) return true;
          const ad = dailyCapacityDate(markerDayKey(a.allocationDate));
          return ad.getTime() >= fromDateCutoff.getTime();
        });
      const allocsBeforeCutoff = (s) =>
        (s.projectStageCapacityAllocations || []).filter((a) => {
          if (!fromDateCutoff) return false;
          const ad = dailyCapacityDate(markerDayKey(a.allocationDate));
          return ad.getTime() < fromDateCutoff.getTime();
        });

      for (const s of phaseStages) {
        // eslint-disable-next-line no-await-in-loop
        await releaseStageCapacity(s.id, effectiveFromDate, tx);

        const movedUnits = allocsFromCutoff(s).reduce((sum, a) => sum + (a.allocatedUnits || 0), 0);
        phaseQuantities[s.stage] = movedUnits > 0 ? movedUnits : (s.workUnits || 0);

        const preserved = allocsBeforeCutoff(s);
        if (preserved.length > 0) {
          const earliest = preserved
            .map((a) => new Date(a.startDateTime || a.customStartTime || a.allocationDate).getTime())
            .filter(Number.isFinite);
          preservedStartDates[s.stage] = earliest.length
            ? new Date(Math.min(...earliest))
            : new Date(s.startDate || s.startDateTime);
        }
      }

      // The phase moves to a user-chosen target instant; the calendar normalizes
      // it to the next working instant (never before opening, never in lunch).
      // DAY and must begin at that day's morning shift start, not the time-of-day
      // the calendar client encodes in newStartDate (which is the shift END).
      const draggedPlan = await scheduleProject({
        stageQuantities: phaseQuantities,
        startDate: effStart,
        difficulty: project.difficulty,
        mode: 'commit',
        tx,
        overCapacityFactor,
        fillGaps: true,
        fillByDay: true,
        // A dragged/parallel stage with a user-fixed time keeps that duration.
        manualDurations: manualDurationsOf(phaseStages),
      });

      movedPlan = draggedPlan;
      const draggedResult = draggedPlan.stages.find((p) => p.stage === stageName);
      if (!draggedResult) return null;

      for (const s of phaseStages) {
        const p = draggedPlan.stages.find((ps) => ps.stage === s.stage);
        if (!p) continue;
        const preservedStart = preservedStartDates[s.stage] || null;
        const preservedDayCount = preservedStart
          ? new Set(
              allocsBeforeCutoff(s).map((a) =>
                markerDayKey(a.allocationDate),
              ),
            ).size
          : 0;
        // eslint-disable-next-line no-await-in-loop
        await tx.projectStage.update({
          where: { id: s.id },
          data: {
            startDate: preservedStart || p.startDateTime,
            endDate: p.endDateTime,
            startDateTime: preservedStart || p.startDateTime,
            endDateTime: p.endDateTime,
            capacityDays: preservedDayCount + (p.capacityDays || 0),
            shift: p.shift,
            timeTaken: p.timeTaken,
          },
        });
        // eslint-disable-next-line no-await-in-loop
        await persistStageAllocations(s.id, s.stage, p.allocations, tx, overCapacityFactor);
        phaseEndTimes.push(p.endDateTime.getTime());
      }
      rescheduledStages = phaseStages.map((s) => s.stage);
    }

    // ── Downstream recompute (both modes) — they depend on the moved stage ──
    if (downstreamStages.length > 0 && phaseEndTimes.length > 0) {
      const downstreamStart = new Date(Math.max(...phaseEndTimes));
      const dsNames = await recomputeDownstreamFromBarrier(
        downstreamStages, downstreamStart, project, tx, overCapacityFactor,
      );
      rescheduledStages.push(...dsNames);
    }

    const result = await recomputeProjectDelivery(projectId, tx);

    const fromLabel = effectiveFromDate
      ? ` from ${effectiveFromDate.toISOString().slice(0, 10)}`
      : '';
    await logScheduleEvent(tx, {
      projectId,
      event: 'RESCHEDULED',
      trigger: byUserId ? 'USER' : 'SYSTEM',
      stage: stageName,
      byUserId,
      oldDelivery: result ? result.oldDelivery : project.calculatedDelivery,
      newDelivery: result ? result.newDelivery : project.calculatedDelivery,
      reason: `Stage ${stageName}${fromLabel} moved to ${effStart.toISOString().slice(0, 10)}; downstream rescheduled with ${Math.round((overCapacityFactor - 1) * 100)}% overcapacity allowance`,
    });

    return {
      ...result,
      rescheduledStages,
      partialFrom: effectiveFromDate ? effectiveFromDate.toISOString().slice(0, 10) : null,
      partialUnits: isPartial ? units : null,
      draggedPlan: movedPlan,
    };
  });

/**
 * Day-key (YYYY-MM-DD) of the last working day of the current week.
 *
 * This used to hardcode Saturday as the week's end and Sunday as the day off,
 * which silently ignored the configured `workingDays`: a business running
 * Mon–Fri had its compaction window extended over a non-working Saturday, and
 * one working Sunday had its last day excluded entirely. The window is now
 * derived from the calendar — walk to the last configured working day at or
 * before the coming Saturday boundary.
 *
 * Operates on date-only keys so it stays timezone safe relative to the
 * calendar's business-tz day boundaries.
 */
const endOfWorkingWeekKey = (cal, now) => {
  const nowKey = cal.dayKey(now);
  const cursor = new Date(`${nowKey}T00:00:00Z`);
  const dow = cursor.getUTCDay(); // 0=Sun .. 6=Sat
  const daysToWeekEnd = dow === 0 ? 6 : 6 - dow;

  // Walk backwards from the calendar week's end to the last day actually worked.
  const end = new Date(cursor);
  end.setUTCDate(end.getUTCDate() + daysToWeekEnd);
  for (let i = 0; i <= daysToWeekEnd; i += 1) {
    const key = end.toISOString().slice(0, 10);
    // isWorkingDay reads the configured weekly set and the holiday list.
    if (cal.isWorkingDay(new Date(`${key}T12:00:00Z`))) return key;
    end.setUTCDate(end.getUTCDate() - 1);
  }
  // No working day left this week — fall back to today so the window is empty
  // rather than accidentally spanning into next week.
  return nowKey;
};

/**
 * Compaction may fill a stage's day up to 130% of its base capacity. This
 * ceiling applies to compaction only; every other scheduling path keeps its
 * own factor.
 */
const COMPACT_OVERCAPACITY_FACTOR = 1.3;

/**
 * The compaction window, as of `now`:
 *   - `floor`      the first instant work can still be placed — `now` itself
 *                  inside working hours, otherwise the next opening (lunch,
 *                  evenings, closed days and holidays all roll forward). Work
 *                  is never placed in hours that have already passed.
 *   - `floorKey`   that instant's business day.
 *   - `weekEndKey` the last working day of the current week. On a non-working
 *                  Sunday this is the coming week's last day.
 *   - `isEmpty`    true when no working time is left this week (e.g. Saturday
 *                  after closing): compaction then does nothing.
 */
const compactionWindow = (cal, now = new Date()) => {
  const floor = cal.nextWorkingStart(now);
  const floorKey = cal.dayKey(floor);
  const weekEndKey = endOfWorkingWeekKey(cal, now);
  // First working day of that same week (walk back to its Sunday, then
  // forward to the first configured working day).
  const day = new Date(`${weekEndKey}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - day.getUTCDay());
  while (
    !cal.isWorkingDay(day) &&
    day.toISOString().slice(0, 10) < weekEndKey
  ) {
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return {
    floor,
    floorKey,
    weekEndKey,
    isEmpty: floorKey > weekEndKey,
    // Overflow window: whole earlier working days of this week, before the
    // day of `floor`. Empty on the week's first working day.
    weekStart: cal.startOfWorkingDay(day),
    pastEnd: cal.startOfWorkingDay(floor),
  };
};

/**
 * Compact the CURRENT WEEK: pack overdue and this week's work as early as it
 * can legally go inside this week, so free space opens up at the week's end.
 *
 * Rules (they hold for any week, not just today's data):
 *   - WINDOW: from `floor` (now, in working time) to the week's last working
 *     day. Nothing is ever placed after the week ends — every booking has a
 *     hard stop at next week's first opening.
 *   - OVERFLOW: when OVERDUE work does not all fit from now to the week's
 *     end, the part that fits stays from now and the remainder goes onto
 *     whole EARLIER working days of this week (e.g. work stuck on 30 Sep
 *     lands on Monday 5 Oct when today is Tuesday 6 Oct). Same 130% and
 *     working-hours rules; never before an upstream stage ends. If even that
 *     is not enough, the stage stays where it is.
 *   - SCOPE: only active stages that are OVERDUE (unfinished units booked on a
 *     day before today) or that START within this week. A stage starting next
 *     week or later is never touched. For a stage that also has bookings next
 *     week, only its past and this-week units move; its next-week bookings
 *     stay exactly as they are.
 *   - FIT: a stage moves only when ALL of its remaining units fit (with the
 *     overflow rule above); otherwise it stays exactly where it is.
 *   - CAPACITY: each stage-day holds at most 130% of its base daily capacity
 *     (existing bookings included). Room is measured in units — a day with 24
 *     of 60 units used is not "full" just because one booking runs to closing.
 *   - WORKING HOURS: every booking is inside the Scheduling Settings window;
 *     lunch, closing time, closed days and holidays are skipped.
 *   - ORDER: a stage never starts before the unfinished earlier-phase stages
 *     of its project have ended (using where they were just moved to).
 *   - PRIORITY: pass 1 places OVERDUE work for every project (oldest project
 *     first); pass 2 then pulls this week's stages onto an earlier day in the
 *     room that is left. Overdue work is never crowded out by work that was
 *     already on time.
 *   - LOCKED projects, completed/cancelled stages and PURCHASING are never
 *     touched. If nothing can move, nothing is written.
 */
const compactCurrentWeek = async (client = null, { now = new Date() } = {}) =>
  withCompactClient(client, async (tx) => {
    const cal = await getCalendar();
    const { floor, floorKey, weekEndKey, isEmpty, weekStart, pastEnd } =
      compactionWindow(cal, now);
    const summary = {
      success: true,
      compacted: 0,
      overdueMoved: 0,
      // Stages whose overflow went onto earlier days of this week.
      usedEarlierDays: 0,
      didNotFit: 0,
      projectsTouched: 0,
      window: { from: floor, to: weekEndKey },
    };
    if (isEmpty) return summary;
    // One compaction at a time, across every server process: lock the single
    // settings row for the length of this transaction (released on commit or
    // rollback). A second run waits here, then sees the already-compacted week.
    await tx.$queryRaw`SELECT id FROM scheduling_settings LIMIT 1 FOR UPDATE`;
    // Hard stop: nothing compaction books can reach next week.
    const weekLimit = cal.nextWorkingStart(
      cal.endOfWorkingDay(new Date(`${weekEndKey}T12:00:00Z`)),
    );

    const projects = await tx.project.findMany({
      where: {
        totalFinishedPercent: { lt: 100 },
        scheduleMode: { not: 'LOCKED' },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        stages: { include: { projectStageCapacityAllocations: true } },
      },
    });

    // Live, mutable view of every project's stage dates, shared by both passes,
    // so a stage always sees where its upstream was just moved to.
    const liveByProject = new Map(
      projects.map((p) => [p.id, p.stages.map((s) => ({ ...s }))]),
    );
    const projectsTouched = new Set();
    const isOpen = (s) => s.status === 'ACTIVE' && !s.finished;
    const movableOf = (stages) =>
      stages
        .filter(
          (s) =>
            isOpen(s) &&
            phaseIndexOf(s.stage) >= 0 &&
            (CAPACITY_STAGES.includes(s.stage) || s.stage === 'INSTALLATION'),
        )
        .sort((x, y) => phaseIndexOf(x.stage) - phaseIndexOf(y.stage));

    const sched = (
      project,
      stage,
      units,
      earliest,
      mode,
      { notBefore = floor, endBy = weekLimit } = {},
    ) =>
      scheduleProject({
        stageQuantities: { [stage.stage]: units },
        startDate: earliest,
        difficulty: project.difficulty,
        mode,
        tx,
        overCapacityFactor: COMPACT_OVERCAPACITY_FACTOR,
        manualDurations: manualDurationsOf([stage]),
        fillByUnits: true,
        excludeStageId: stage.id,
        notBefore,
        endBy,
      });

    /**
     * Plan one project's moves for a pass with DRY RUNS only, walking stages in
     * phase order against a scratch copy of their dates. Stages in `held` are
     * kept where they are. Returns the moves, or `blockedBy` = the moved
     * upstream stage that left a later stage starting before it ends (that
     * later stage could not follow inside this week).
     */
    const planProject = async (project, pass, held) => {
      const scratch = liveByProject.get(project.id).map((s) => ({ ...s }));
      const moves = [];
      let notFit = 0;
      for (const stage of movableOf(scratch)) {
        const curStart = stage.startDateTime || stage.startDate;
        if (!curStart) continue;
        const startKey = cal.dayKey(curStart);
        if (startKey > weekEndKey) continue; // next week or later: never touched
        const allocs = stage.projectStageCapacityAllocations || [];
        const timeBased = !CAPACITY_STAGES.includes(stage.stage);
        const upstream = scratch.filter(
          (s) =>
            isOpen(s) &&
            phaseIndexOf(s.stage) >= 0 &&
            phaseIndexOf(s.stage) < phaseIndexOf(stage.stage),
        );
        const upstreamEnds = upstream
          .map((s) => validDateOrNull(s.endDateTime || s.endDate))
          .filter(Boolean);
        const upstreamEnd = upstreamEnds.length
          ? maxInstant(...upstreamEnds)
          : null;
        // Starts before its upstream ends (e.g. that upstream was overdue and
        // was just pulled forward) — it must be re-planned after it.
        const breaksOrder = !!upstreamEnd && new Date(curStart) < upstreamEnd;
        // The moved upstream (if any) responsible for breaking the order.
        const culprit = () =>
          moves
            .filter(
              (m) =>
                m.stage.endDateTime &&
                new Date(m.stage.endDateTime) > new Date(curStart),
            )
            .map((m) => m.stage.id)
            .pop();

        // Anything already booked into next week stays exactly as it is. A
        // time-based stage reaching next week is left whole; a capacity stage
        // moves only its past and this-week part (its next-week rows stay).
        const nextWeekUnits = allocs
          .filter((a) => markerDayKey(a.allocationDate) > weekEndKey)
          .reduce((sum, a) => sum + (a.allocatedUnits || 0), 0);
        const units = Math.max(
          0,
          (stage.workUnits || 0) - (stage.actualWorkUnits || 0) - nextWeekUnits,
        );
        const isOverdue = timeBased
          ? startKey < floorKey
          : allocs.some((a) => markerDayKey(a.allocationDate) < floorKey);
        const mustMove = isOverdue || breaksOrder;
        const earliest = maxInstant(floor, upstreamEnd);

        let skip =
          held.has(stage.id) ||
          units <= EPS ||
          (timeBased &&
            cal.dayKey(stage.endDateTime || stage.endDate || curStart) >
              weekEndKey) ||
          cal.dayKey(earliest) > weekEndKey ||
          (pass === 'overdue' && !mustMove) ||
          (pass === 'pull' && (mustMove || startKey <= cal.dayKey(earliest)));

        let dp = null;
        let split = null;
        if (!skip) {
          // eslint-disable-next-line no-await-in-loop
          const dry = await sched(project, stage, units, earliest, 'dryRun');
          dp = dry.stages.find((x) => x.stage === stage.stage) || null;
          const placedNow = dp
            ? dp.allocations.reduce((t, al) => t + al.units, 0)
            : 0;
          const fitsNow = timeBased
            ? !!dp && cal.dayKey(dp.endDateTime) <= weekEndKey
            : !!dp && placedNow >= units - 0.01;
          if (!fitsNow && !timeBased) {
            // The rest of the week is full. Overdue work may overflow onto
            // whole earlier days of this week (never next week): the part
            // that fits from now stays from now, the remainder goes back.
            const futureAllocs = dp ? dp.allocations : [];
            const futureUnits = futureAllocs.reduce((t, al) => t + al.units, 0);
            const rest = units - futureUnits;
            const pastFrom = maxInstant(weekStart, upstreamEnd);
            const canOverflow =
              mustMove &&
              !timeBased &&
              !Object.keys(manualDurationsOf([stage])).length &&
              pastFrom < pastEnd;
            if (canOverflow) {
              // eslint-disable-next-line no-await-in-loop
              const back = await sched(
                project,
                stage,
                rest,
                pastFrom,
                'dryRun',
                {
                  notBefore: weekStart,
                  endBy: pastEnd,
                },
              );
              const bp = back.stages.find((x) => x.stage === stage.stage);
              const placed = bp
                ? bp.allocations.reduce((t, al) => t + al.units, 0)
                : 0;
              if (bp && placed >= rest - 0.01) {
                split = { futureUnits, rest, pastFrom, back: bp, futureAllocs };
              }
            }
            if (!split) {
              notFit += 1;
              skip = true;
            }
          } else if (!fitsNow) {
            notFit += 1;
            skip = true;
          } else if (
            pass === 'pull' &&
            cal.dayKey(dp.startDateTime) >= startKey
          ) {
            skip = true;
          }
        }

        if (skip) {
          // Left in place: if a move made earlier in THIS plan now ends after
          // this stage starts, that move must be held back.
          if (breaksOrder && culprit()) return { blockedBy: culprit() };
          continue;
        }
        moves.push({
          stage,
          units,
          earliest,
          nextWeekUnits,
          isOverdue,
          timeBased,
          dp,
          split,
        });
        // Scratch: where the stage now starts and ends (its next-week rows, if
        // any, still finish it later).
        const newStart = split ? split.back.startDateTime : dp.startDateTime;
        let newEnd = dp ? dp.endDateTime : null;
        if (split) {
          newEnd = split.futureAllocs.length
            ? split.futureAllocs[split.futureAllocs.length - 1].endDateTime
            : split.back.endDateTime;
        }
        Object.assign(stage, {
          startDateTime: newStart,
          startDate: newStart,
          ...(nextWeekUnits > EPS
            ? {}
            : { endDateTime: newEnd, endDate: newEnd }),
        });
      }
      return { moves, notFit };
    };

    /** Write one planned move and refresh the live view of that stage. */
    const commitMove = async (project, move) => {
      const {
        stage: scratchStage,
        units,
        earliest,
        nextWeekUnits,
        timeBased,
        dp,
        split,
      } = move;
      const live = liveByProject
        .get(project.id)
        .find((s) => s.id === scratchStage.id);
      if (timeBased) {
        // No capacity rows: just move the stage's dates.
        await tx.projectStage.update({
          where: { id: live.id },
          data: {
            startDate: dp.startDateTime,
            startDateTime: dp.startDateTime,
            endDate: dp.endDateTime,
            endDateTime: dp.endDateTime,
            customStartTime: dp.customStartTime,
            customEndTime: dp.customEndTime,
            capacityDays: dp.capacityDays,
            timeTaken: dp.timeTaken,
          },
        });
        Object.assign(live, {
          startDateTime: dp.startDateTime,
          startDate: dp.startDateTime,
          endDateTime: dp.endDateTime,
          endDate: dp.endDateTime,
        });
        return;
      }
      // Release the stage's past and this-week bookings (next-week rows are
      // kept) and re-book those remaining units inside the window.
      if (nextWeekUnits <= EPS) {
        await releaseStageCapacity(live.id, null, tx);
      } else {
        for (const a of live.projectStageCapacityAllocations || []) {
          if (markerDayKey(a.allocationDate) <= weekEndKey) {
            // eslint-disable-next-line no-await-in-loop
            await releaseStageUnitsOnDay(
              live.id,
              a.allocationDate,
              a.allocatedUnits || 0,
              tx,
            );
          }
        }
      }
      // Book [units] from `from` and fail loudly if any unit is left over —
      // the whole compaction then rolls back instead of losing work.
      const book = async (qty, from, opts) => {
        if (qty <= EPS) return;
        const plan = await sched(project, live, qty, from, 'commit', opts);
        const p = plan.stages.find((x) => x.stage === live.stage);
        const placed = p ? p.allocations.reduce((t, al) => t + al.units, 0) : 0;
        if (placed < qty - 0.01) {
          throw new Error(
            `Compaction could not place ${qty} ${live.stage} units (placed ${placed}); nothing was changed`,
          );
        }
        await persistStageAllocations(
          live.id,
          live.stage,
          p.allocations,
          tx,
          COMPACT_OVERCAPACITY_FACTOR,
        );
      };
      if (split) {
        await book(split.futureUnits, earliest);
        await book(split.rest, split.pastFrom, {
          notBefore: weekStart,
          endBy: pastEnd,
        });
        summary.usedEarlierDays += 1;
      } else {
        await book(units, earliest);
      }
      const span = await recomputeStageSpan(live.id, tx);
      Object.assign(live, {
        ...(span
          ? {
              startDateTime: span.newStart,
              startDate: span.newStart,
              endDateTime: span.newEnd,
              endDate: span.newEnd,
            }
          : {}),
        projectStageCapacityAllocations:
          await tx.projectStageCapacityAllocation.findMany({
            where: { projectStageId: live.id },
          }),
      });
    };

    for (const pass of ['overdue', 'pull']) {
      for (const project of projects) {
        // Re-plan until no moved stage strands a later stage behind it: each
        // round holds back the offending upstream move.
        const held = new Set();
        let result = { moves: [] };
        for (let round = 0; round <= 20; round += 1) {
          // eslint-disable-next-line no-await-in-loop
          result = await planProject(project, pass, held);
          if (!result.blockedBy) break;
          held.add(result.blockedBy);
          result = { moves: [] };
        }
        summary.didNotFit += result.notFit || 0;
        for (const move of result.moves) {
          // eslint-disable-next-line no-await-in-loop
          await commitMove(project, move);
          summary.compacted += 1;
          if (move.isOverdue) summary.overdueMoved += 1;
          projectsTouched.add(project.id);
        }
      }
    }
    for (const pid of projectsTouched) {
      // eslint-disable-next-line no-await-in-loop
      await recomputeProjectDelivery(pid, tx);
    }
    summary.projectsTouched = projectsTouched.size;
    return summary;
  });
module.exports = {
  withClient,
  logScheduleEvent,
  releaseStageCapacity,
  releaseProjectCapacity,
  persistStageAllocations,
  getStagePhaseStart,
  recomputeProjectDelivery,
  rescheduleDownstream,
  rescheduleWholeProject,
  rescheduleStageAndDownstream,
  reallocateProjectFromInvoiceMaterials,
  onStageCompleted,
  onStageCancelled,
  releaseStageUnitsOnDay,
  compactCurrentWeek,
  compactionWindow,
  COMPACT_OVERCAPACITY_FACTOR,
  __private: {
    phaseIndexOf,
    getStagePhaseStart,
    getDownstreamStagesForPhase,
    getPhaseBarrierInstant,
    sumMaterialQuantities,
    materialStageQuantities,
    releaseStageUnitsOnDay,
  },
};
