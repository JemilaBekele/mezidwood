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
const { getCalendar } = require('./calendar');
const { getSchedulingSettings } = require('./settings');
const {
  computeStageQuantities,
  scheduleProject,
  dailyCapacityDate,
  deliveryDateFor,
  PHASES,
} = require('./engine');
const { deliveryBufferDays, OVERCAPACITY_FACTOR } = require('./config');

// Per-day allocation loops do several sequential writes; give the interactive
// transaction generous headroom (per-project scale is tiny relative to this).
const TX_OPTS = { timeout: 30000, maxWait: 15000 };

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
const withClient = (client, fn) =>
  (client ? fn(client) : prisma.$transaction(fn, TX_OPTS));

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
  const cutoff = releaseFrom
    ? dailyCapacityDate(new Date(releaseFrom).toISOString().slice(0, 10))
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
    const daily = await client.dailyStageCapacity.findUnique({
      where: { stage_date: { stage, date } },
    });
    if (!daily) continue;
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
  const days = new Set(allAllocs.map((a) => new Date(a.allocationDate).toISOString().slice(0, 10))).size;
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
    for (const s of active) {
      // eslint-disable-next-line no-await-in-loop
      await releaseStageCapacity(s.id, null, tx);
    }

    // Projects pipeline by stage team. Once this project's own future capacity
    // is released, existing usage from other projects only blocks the same
    // stage/team instead of pushing the whole project behind all workshop work.
    const effStart = new Date(startInstant);

    const stageQuantities = {};
    active.forEach((s) => {
      stageQuantities[s.stage] = s.workUnits || 0;
    });

    const plan = await scheduleProject({
      stageQuantities,
      startDate: effStart,
      difficulty: project.difficulty,
      mode: 'commit',
      tx,
      // A user-fixed duration sticks through a full rebuild too.
      manualDurations: manualDurationsOf(active),
    });
    const planByStage = {};
    plan.stages.forEach((p) => {
      planByStage[p.stage] = p;
    });

    for (const s of active) {
      const p = planByStage[s.stage];
      if (!p) continue;
      // DELIVERY stage dates are manually managed — never overwrite during rebuild
      if (s.stage === 'DELIVERY') continue;
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
    const fromDateCutoff = effectiveFromDate
      ? dailyCapacityDate(effectiveFromDate.toISOString().slice(0, 10))
      : null;
    const effStart = new Date(newStartDate);

    // ── PAST CELL-MOVE: drop to an EARLIER day ──
    // Move ONLY the source-day cell of the dragged stage AND each parallel peer
    // to the target day. Nothing else is touched — no downstream cascade, no
    // other day/cell of these stages, no other project. (The user's rule for a
    // backward drag.)
    if (pastCellMove && fromDateCutoff) {
      const cellUnitsOnDay = (s) =>
        (s.projectStageCapacityAllocations || [])
          .filter((a) => dailyCapacityDate(new Date(a.allocationDate).toISOString().slice(0, 10)).getTime() === fromDateCutoff.getTime())
          .reduce((sum, a) => sum + (a.allocatedUnits || 0), 0);

      const moved = [];
      let pastPlan = null;
      for (const s of [draggedStage, ...parallelPeers]) {
        const cu = cellUnitsOnDay(s);
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
        reason: `Cell ${stageName} (+ parallel peers) moved back to ${effStart.toISOString().slice(0, 10)}; downstream untouched`,
      });
      return {
        ...result,
        rescheduledStages: moved,
        partialFrom: effectiveFromDate ? effectiveFromDate.toISOString().slice(0, 10) : null,
        draggedPlan: pastPlan,
      };
    }

    // Units the dragged stage has on the source day ("the cell"). A partial move
    // is requested when `units` is set and is strictly less than the cell.
    const cellUnits = fromDateCutoff
      ? (draggedStage.projectStageCapacityAllocations || [])
          .filter((a) => {
            const ad = dailyCapacityDate(new Date(a.allocationDate).toISOString().slice(0, 10));
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
          const ad = dailyCapacityDate(new Date(a.allocationDate).toISOString().slice(0, 10));
          return ad.getTime() >= fromDateCutoff.getTime();
        });
      const allocsBeforeCutoff = (s) =>
        (s.projectStageCapacityAllocations || []).filter((a) => {
          if (!fromDateCutoff) return false;
          const ad = dailyCapacityDate(new Date(a.allocationDate).toISOString().slice(0, 10));
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
                new Date(a.allocationDate).toISOString().slice(0, 10),
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

/** Day-key (YYYY-MM-DD) of the last working day of the current week (Saturday;
 *  Sunday is the non-working day). Operates on date-only keys so it is timezone
 *  safe relative to the calendar's business-tz day boundaries. */
const endOfWorkingWeekKey = (cal, now) => {
  const nowKey = cal.dayKey(now);
  const dow = new Date(`${nowKey}T00:00:00Z`).getUTCDay(); // 0=Sun .. 6=Sat
  const daysToSat = dow === 0 ? 6 : 6 - dow;
  const end = new Date(`${nowKey}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + daysToSat);
  return end.toISOString().slice(0, 10);
};

/**
 * Compact the CURRENT WEEK only: pull stages that currently start within
 * [today, end-of-working-week] as early as they legally can (after their
 * upstream finishes, into genuinely free capacity ≤100%), removing gaps.
 *
 * Strictly conservative:
 *   - A stage moves ONLY if a dry-run proves it can start on an EARLIER day.
 *     If nothing can move, nothing is written.
 *   - Work dated outside the current week is never moved; there is NO downstream
 *     cascade. Other projects are never moved (only respected as capacity).
 *   - LOCKED projects and completed/cancelled/finished stages are untouched.
 */
const compactCurrentWeek = async (client = null) =>
  withClient(client, async (tx) => {
    const cal = await getCalendar();
    const now = new Date();
    const nowKey = cal.dayKey(now);
    const weekEndKey = endOfWorkingWeekKey(cal, now);

    const projects = await tx.project.findMany({
      where: { totalFinishedPercent: { lt: 100 } },
      orderBy: { createdAt: 'asc' },
      include: { stages: { include: { projectStageCapacityAllocations: true } } },
    });

    let compacted = 0;
    const projectsTouched = new Set();

    for (const project of projects) {
      if (project.scheduleMode === 'LOCKED') continue;

      // Live, mutable view of this project's stage dates so later stages see the
      // new positions of earlier ones when computing their earliest legal start.
      const liveStages = project.stages.map((s) => ({ ...s }));
      const movable = liveStages
        .filter((s) => phaseIndexOf(s.stage) >= 0 && s.status === 'ACTIVE' && !s.finished)
        .sort((a, b) => phaseIndexOf(a.stage) - phaseIndexOf(b.stage));

      for (const stage of movable) {
        const curStart = stage.startDateTime || stage.startDate;
        if (!curStart) continue;
        const startKey = cal.dayKey(curStart);
        // Candidate only if it currently starts within the current week.
        if (startKey < nowKey || startKey > weekEndKey) continue;
        const units = stage.workUnits || 0;
        if (units <= 0) continue;

        const earliest = getStagePhaseStart(liveStages, stage.stage, now);
        if (cal.dayKey(curStart) <= cal.dayKey(earliest)) continue; // already as early as allowed

        const sched = (mode) =>
          scheduleProject({
            stageQuantities: { [stage.stage]: units },
            startDate: earliest,
            difficulty: project.difficulty,
            mode,
            tx,
            overCapacityFactor: 1.0, // only fill genuinely empty space
            manualDurations: manualDurationsOf([stage]),
          });

        // Probe: would it actually land on an earlier day? If not, leave it be.
        // eslint-disable-next-line no-await-in-loop
        const dry = await sched('dryRun');
        const dp = dry.stages.find((p) => p.stage === stage.stage);
        if (!dp || cal.dayKey(dp.startDateTime) >= startKey) continue;

        // Real gap → pull the stage earlier. No downstream cascade.
        // eslint-disable-next-line no-await-in-loop
        await releaseStageCapacity(stage.id, null, tx);
        // eslint-disable-next-line no-await-in-loop
        const plan = await sched('commit');
        const p = plan.stages.find((x) => x.stage === stage.stage);
        if (p) {
          // eslint-disable-next-line no-await-in-loop
          await persistStageAllocations(stage.id, stage.stage, p.allocations, tx, 1.0);
        }
        // eslint-disable-next-line no-await-in-loop
        const span = await recomputeStageSpan(stage.id, tx);
        if (span) {
          stage.startDateTime = span.newStart;
          stage.startDate = span.newStart;
          stage.endDateTime = span.newEnd;
          stage.endDate = span.newEnd;
        }
        compacted += 1;
        projectsTouched.add(project.id);
      }
    }

    for (const pid of projectsTouched) {
      // eslint-disable-next-line no-await-in-loop
      await recomputeProjectDelivery(pid, tx);
    }
    return { success: true, compacted, projectsTouched: projectsTouched.size };
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
