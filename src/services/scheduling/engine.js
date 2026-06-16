/**
 * Unified scheduling engine — the SINGLE allocator used by both
 * Project.service (createProject) and DeliveryEstimation.service.
 *
 * Why: previously each service had its own copy of the allocation + delivery
 * math, and they disagreed (different difficulty tables, estimation never
 * reserved capacity, delivery date computed two different ways). That is why a
 * quoted delivery date never matched the project it became. Both now call
 * buildSchedule(), so an estimate and the project created from it are identical.
 *
 * Design:
 *   - buildSchedule(...) is PURE (no DB, no async): given a calendar, capacity
 *     config and existing usage, it returns a full plan. This is what the unit
 *     tests exercise and what guarantees estimate == project.
 *   - scheduleProject(...) is the async wrapper: loads the calendar + capacity
 *     lots + current usage, runs buildSchedule, and (commit mode only) flushes
 *     the capacity it consumed to DailyStageCapacity.
 */
const prisma = require('../prisma');
const { getCalendar } = require('./calendar');
const { getSchedulingSettings } = require('./settings');
const {
  WORKING_HOURS_PER_DAY,
  SHIFT_HOURS,
  SHIFT_TIMES,
  STAGE_SHIFT_PREFERENCE,
  CAPACITY_STAGES,
  NON_CAPACITY_STAGES,
  NON_CAPACITY_HOURS_PER_UNIT,
  DIFFICULTY_BUFFER,
  CONTINGENCY_DAYS,
} = require('./config');

const MORNING_START = SHIFT_TIMES.FULL_DAY.start; // first working instant of a day

const EPS = 0.001;
const round2 = (n) => Math.round(n * 100) / 100;
const usageKey = (stage, dateKey) => `${stage}|${dateKey}`;
const maxDate = (a, b) => (a.getTime() > b.getTime() ? a : b);
const isValidDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());
const stageShiftHours = (shift, workingHoursPerDay) =>
  shift === 'CUSTOM'
    ? workingHoursPerDay
    : SHIFT_HOURS[shift] || workingHoursPerDay;

// A DailyStageCapacity "date" column represents a calendar day. We store the
// business-tz day label (YYYY-MM-DD) as UTC midnight so the value is stable
// regardless of the server's local timezone. Use this everywhere a daily-
// capacity row is written or looked up so the stage_date unique key matches.
const dailyCapacityDate = (dateKey) => new Date(`${dateKey}T00:00:00.000Z`);
const rememberBusyUntil = (busyUntil, key, endDateTime) => {
  const end = new Date(endDateTime);
  if (!isValidDate(end)) return;
  const prev = busyUntil[key];
  if (!prev || end.getTime() > prev.getTime()) busyUntil[key] = end;
};

/* ------------------------------------------------------------------ *
 * Dynamic stage quantities (material-driven).  This is the one place
 * that decides which stages a project includes and how much work each
 * one carries, based on material mix. Edit the rules here only.
 *
 * `materials` = { laminatedMDF, plainMDF, wood, metal, other } quantities.
 * ------------------------------------------------------------------ */
const computeStageQuantities = (materials) => {
  const m = {
    laminatedMDF: materials.laminatedMDF || 0,
    plainMDF: materials.plainMDF || 0,
    wood: materials.wood || 0,
    metal: materials.metal || 0,
    other: materials.other || 0,
  };
  const total = m.laminatedMDF + m.plainMDF + m.wood + m.metal + m.other;
  const panelTotal = total - m.metal; // everything that is not metal goes through panel stages

  return {
    DESIGN: total,
    METAL_WORKS: m.metal,
    // CNC is a MANUAL-ADD stage (business spec): it carries no auto-computed
    // quantity. It only becomes a real, schedulable node when a user enters a
    // quantity for it (and only metal projects expose the input). So it starts
    // at 0 here and is slotted in later via updateProjectStage.
    CNC: 0,
    CUTTING: panelTotal, // total excluding metal
    EDGE_BANDING: m.laminatedMDF, // laminated panels only
    ASSEMBLY: panelTotal, // metal does not go through assembly
    PAINTING: m.plainMDF + m.wood + m.metal, // excludes laminated MDF
    FINISHING: total,
    DELIVERY: total,
    INSTALLATION: total,
    PURCHASING: total,
  };
};

/* ------------------------------------------------------------------ *
 * Workflow PHASES (Rosewood business spec).
 *
 * The workflow runs as a sequence of phases. Stages WITHIN a phase run in
 * PARALLEL (separate teams, each with its own per-stage capacity); a phase's
 * elapsed time is therefore set by its LONGEST task. The next phase starts the
 * working day AFTER the previous phase's longest task finishes (a barrier — no
 * cross-phase pile-up on a single day).
 *
 *   Design  ->  (Metal Works ∥ CNC)  ->  (Cutting ∥ Edge Banding)
 *           ->  (Assembly ∥ Painting)  ->  Finishing  ->  Delivery  ->  Installation
 *
 * PURCHASING is a side-track that runs parallel to Design and finishes one
 * working day after Design (it does not gate the production phases).
 * ------------------------------------------------------------------ */
const PHASES = [
  ['DESIGN'],
  ['METAL_WORKS', 'CNC'],
  ['CUTTING', 'EDGE_BANDING'],
  ['ASSEMBLY', 'PAINTING'],
  ['FINISHING'],
  ['DELIVERY'],
  ['INSTALLATION'],
];

/**
 * Allocate one stage across consecutive working days, one shift-load per day,
 * honouring per-day capacity (scaled to the stage's shift) and existing usage.
 * Mutates ctx.usage / ctx.deltas. Returns a stage plan or null (zero qty).
 */
const allocateStage = (cal, stage, quantity, startInstant, ctx) => {
  if (quantity <= EPS) return null;

  // FIX 6 & 7: Check boundary before allocation
  if (ctx.rebuildBoundary && startInstant > ctx.rebuildBoundary) {
    console.log(
      `⚠️ Skipping ${stage} - start ${startInstant} beyond boundary ${ctx.rebuildBoundary}`,
    );
    return null;
  }

  // Time-based (non-capacity) stages: a single contiguous block, no day cap.
  if (NON_CAPACITY_STAGES.includes(stage)) {
    const hours = quantity * (NON_CAPACITY_HOURS_PER_UNIT[stage] || 0.5);
    const start = new Date(startInstant);
    const end = new Date(start.getTime() + hours * 3600 * 1000);

    // FIX 6: Check if end exceeds boundary and truncate
    let finalEnd = end;
    if (ctx.rebuildBoundary && end > ctx.rebuildBoundary) {
      finalEnd = new Date(ctx.rebuildBoundary);
      console.log(
        `⚠️ Truncating ${stage} end from ${end} to ${finalEnd} due to boundary`,
      );
    }

    return {
      stage,
      workUnits: quantity,
      actualWorkUnits: quantity,
      startDateTime: start,
      endDateTime: finalEnd,
      capacityDays: 1,
      shift: 'CUSTOM',
      timeTaken: Math.round(hours * 60),
      allocations: [],
      customStartTime: start,
      customEndTime: finalEnd,
    };
  }

  const cfg = ctx.capacityConfig[stage] || { capacity: 1 };
  const capacity = cfg.capacity || 1;
  const slots = cfg.parallelSlots || 1;
  const shift = STAGE_SHIFT_PREFERENCE[stage] || 'FULL_DAY';
  const whpd = ctx.workingHoursPerDay || WORKING_HOURS_PER_DAY;
  const shiftHours = stageShiftHours(shift, whpd);
  const baseDailyMax = capacity * (shiftHours / whpd) * slots;
  const overCapFactor = ctx.overCapacityFactor || 1.0;
  const dailyMaxUnits = baseDailyMax * overCapFactor;
  const effShiftHours = shiftHours * overCapFactor;
  const unitsPerHour = (capacity * slots) / whpd;

  let remaining = quantity;
  let cur = new Date(startInstant);
  const allocations = [];
  let guard = 0;
  const GUARD_MAX = 100000;

  while (remaining > EPS) {
    guard += 1;
    if (guard > GUARD_MAX) {
      throw new Error(
        `Scheduler failed to converge for ${stage} (qty=${quantity}, capacity=${capacity})`,
      );
    }

    // FIX 4 & 6: Check boundary before processing each day
    if (ctx.rebuildBoundary && cur > ctx.rebuildBoundary) {
      console.log(
        `🛑 Stopping ${stage} allocation at boundary ${ctx.rebuildBoundary}`,
      );
      break;
    }

    if (!cal.isWorkingDay(cur)) {
      cur = cal.nextWorkingDay(cur);
      continue;
    }

    const dateKey = cal.dayKey(cur);
    const sb = cal.shiftBoundaries(cur, shift);
    const isTransitionDay = dateKey === cal.dayKey(startInstant);
    const stageDayBusyUntil = ctx.busyUntil[usageKey(stage, dateKey)];
    const dayStart = isTransitionDay
      ? maxDate(new Date(startInstant), sb.startDateTime)
      : sb.startDateTime;
    const startDT = stageDayBusyUntil
      ? maxDate(dayStart, stageDayBusyUntil)
      : dayStart;

    const consumedWindowHours = Math.max(
      0,
      cal.hoursBetween(sb.startDateTime, startDT),
    );
    if (consumedWindowHours >= effShiftHours - EPS) {
      cur = cal.nextWorkingDay(cur);
      continue;
    }

    const availableWindowHours = effShiftHours - consumedWindowHours;
    const availableWindowUnits = availableWindowHours * unitsPerHour;
    if (availableWindowUnits <= EPS) {
      cur = cal.nextWorkingDay(cur);
      continue;
    }

    const used = ctx.usage[usageKey(stage, dateKey)] || 0;
    const available = Math.min(
      Math.max(0, dailyMaxUnits - used),
      availableWindowUnits,
    );
    if (available <= EPS) {
      cur = cal.nextWorkingDay(cur);
      continue;
    }

    const assign = Math.min(remaining, available);
    const workHours = assign / unitsPerHour;
    let endDT = new Date(startDT.getTime() + workHours * 3600 * 1000);

    // FIX 6: Check if end exceeds boundary and truncate
    if (ctx.rebuildBoundary && endDT > ctx.rebuildBoundary) {
      endDT = new Date(ctx.rebuildBoundary);
      const truncatedAssign = Math.max(
        0,
        cal.hoursBetween(startDT, endDT) * unitsPerHour,
      );
      if (truncatedAssign <= EPS) break;

      allocations.push({
        date: dateKey,
        startDateTime: startDT,
        endDateTime: endDT,
        units: round2(truncatedAssign),
        hours: round2(cal.hoursBetween(startDT, endDT)),
        shift,
      });
      ctx.usage[usageKey(stage, dateKey)] = used + truncatedAssign;
      ctx.deltas[usageKey(stage, dateKey)] =
        (ctx.deltas[usageKey(stage, dateKey)] || 0) + truncatedAssign;
      rememberBusyUntil(ctx.busyUntil, usageKey(stage, dateKey), endDT);
      remaining = round2(remaining - truncatedAssign);
      break; // Stop after boundary truncation
    }

    allocations.push({
      date: dateKey,
      startDateTime: startDT,
      endDateTime: endDT,
      units: round2(assign),
      hours: round2(workHours),
      shift,
    });
    ctx.usage[usageKey(stage, dateKey)] = used + assign;
    ctx.deltas[usageKey(stage, dateKey)] =
      (ctx.deltas[usageKey(stage, dateKey)] || 0) + assign;
    rememberBusyUntil(ctx.busyUntil, usageKey(stage, dateKey), endDT);

    remaining = round2(remaining - assign);
    if (remaining > EPS) cur = cal.nextWorkingDay(cur);

    // FIX 7: Hard safety check
    if (
      ctx.rebuildBoundary &&
      cur.getTime() > new Date(ctx.rebuildBoundary).getTime()
    ) {
      break;
    }
  }

  if (allocations.length === 0) return null;

  const totalHours = allocations.reduce((s, a) => s + a.hours, 0);
  return {
    stage,
    workUnits: quantity,
    actualWorkUnits: round2(allocations.reduce((s, a) => s + a.units, 0)),
    startDateTime: allocations[0].startDateTime,
    endDateTime: allocations[allocations.length - 1].endDateTime,
    capacityDays: allocations.length,
    shift,
    timeTaken: Math.round(totalHours * 60),
    allocations,
    customStartTime: null,
    customEndTime: null,
  };
};

/**
 * Allocate a stage by a USER-FIXED duration ("manual time wins"): the stage spans
 * exactly `minutes` of working time from `startInstant`, and its quantity is
 * distributed across those day-segments proportional to time — regardless of
 * the quantity-derived capacity rate. Mirrors the manual timeline used when a
 * stage's time is edited, so a manual duration is honoured on EVERY re-plan
 * (cascade / rebuild / drag), not just at the moment of edit. Days may exceed
 * 100% (marked overcapacity downstream); the time is authoritative.
 */
const allocateStageManual = (
  cal,
  stage,
  quantity,
  startInstant,
  minutes,
  ctx,
) => {
  const shift = STAGE_SHIFT_PREFERENCE[stage] || 'FULL_DAY';
  const start = new Date(startInstant);
  const totalMinutes = Math.max(0, minutes);
  const empty = {
    stage,
    workUnits: quantity,
    actualWorkUnits: 0,
    startDateTime: start,
    endDateTime: start,
    capacityDays: 0,
    shift,
    timeTaken: 0,
    allocations: [],
    customStartTime: null,
    customEndTime: null,
  };
  if (totalMinutes <= EPS) return empty;

  // FIX 6: Check boundary at start
  if (ctx.rebuildBoundary && start > ctx.rebuildBoundary) {
    console.log(`⚠️ Skipping manual ${stage} - start beyond boundary`);
    return empty;
  }

  const whpd = ctx.workingHoursPerDay || WORKING_HOURS_PER_DAY;
  const shiftHours = stageShiftHours(shift, whpd);

  // 1) Split the manual minutes across consecutive working days (stacking after
  //    any existing same-stage work on the start day via busyUntil).
  const segments = [];
  let cur = new Date(startInstant);
  let remaining = totalMinutes;
  let guard = 0;
  while (remaining > EPS && guard < 100000) {
    guard += 1;

    // FIX 4 & 6: Check boundary before each day
    if (ctx.rebuildBoundary && cur > ctx.rebuildBoundary) {
      console.log(
        `🛑 Stopping manual ${stage} at boundary ${ctx.rebuildBoundary}`,
      );
      break;
    }

    if (!cal.isWorkingDay(cur)) {
      cur = cal.nextWorkingDay(cur);
      continue;
    }
    const dateKey = cal.dayKey(cur);
    const sb = cal.shiftBoundaries(cur, shift);
    const isTransitionDay =
      segments.length === 0 && dateKey === cal.dayKey(startInstant);
    const dayStart = isTransitionDay
      ? maxDate(new Date(startInstant), sb.startDateTime)
      : sb.startDateTime;
    const busy = ctx.busyUntil[usageKey(stage, dateKey)];
    const startDT = busy ? maxDate(dayStart, busy) : dayStart;
    const consumedHours = Math.max(
      0,
      cal.hoursBetween(sb.startDateTime, startDT),
    );
    const availMin = Math.max(0, Math.round((shiftHours - consumedHours) * 60));
    if (availMin <= 0) {
      cur = cal.nextWorkingDay(cur);
      continue;
    }

    let useMin = Math.min(remaining, availMin);
    let endDT = new Date(startDT.getTime() + useMin * 60000);

    // FIX 6: Check if end exceeds boundary and truncate
    if (ctx.rebuildBoundary && endDT > ctx.rebuildBoundary) {
      const maxMinutes = Math.max(
        0,
        cal.hoursBetween(startDT, ctx.rebuildBoundary) * 60,
      );
      useMin = Math.min(useMin, maxMinutes);
      endDT = new Date(ctx.rebuildBoundary);
      if (useMin <= EPS) break;
    }

    segments.push({
      dateKey,
      startDateTime: startDT,
      endDateTime: endDT,
      minutes: useMin,
    });
    remaining = round2(remaining - useMin);
    if (remaining > EPS) cur = cal.nextWorkingDay(cur);

    // FIX 7: Hard safety check
    if (
      ctx.rebuildBoundary &&
      cur.getTime() > new Date(ctx.rebuildBoundary).getTime()
    ) {
      break;
    }
  }

  if (segments.length === 0) return empty;

  // 2) Distribute the quantity across segments proportional to their minutes
  //    (last segment takes the remainder) and record usage.
  const totalSegMin = segments.reduce((s, x) => s + x.minutes, 0) || 1;
  const totalUnits = Math.max(0, quantity);
  let remUnits = totalUnits;
  const allocations = segments.map((seg, i) => {
    const u =
      i === segments.length - 1
        ? remUnits
        : Math.min(remUnits, round2(totalUnits * (seg.minutes / totalSegMin)));
    remUnits = round2(remUnits - u);
    const hours = round2(seg.minutes / 60);
    const key = usageKey(stage, seg.dateKey);
    ctx.usage[key] = (ctx.usage[key] || 0) + u;
    ctx.deltas[key] = (ctx.deltas[key] || 0) + u;
    rememberBusyUntil(ctx.busyUntil, key, seg.endDateTime);
    return {
      date: seg.dateKey,
      startDateTime: seg.startDateTime,
      endDateTime: seg.endDateTime,
      units: round2(u),
      hours,
      shift,
    };
  });

  return {
    stage,
    workUnits: quantity,
    actualWorkUnits: round2(allocations.reduce((s, a) => s + a.units, 0)),
    startDateTime: allocations[0].startDateTime,
    endDateTime: allocations[allocations.length - 1].endDateTime,
    capacityDays: allocations.length,
    shift,
    timeTaken: Math.round(totalMinutes),
    allocations,
    customStartTime: null,
    customEndTime: null,
  };
};

/**
 * PURE scheduling core. No DB, no async.
 * @param {object} opts
 * @param {object} opts.calendar          - sync calendar (from getCalendar/makeCalendarFromHolidays)
 * @param {object} opts.capacityConfig    - { [stage]: { capacity } }
 * @param {object} opts.stageQuantities   - { [stage]: number }
 * @param {Date}   opts.startDate         - first instant work may begin
 * @param {string} opts.difficulty        - EASY | MEDIUM | HARD
 * @param {object} [opts.existingUsage]   - usage seed, optionally with busyUntil timestamps
 * @returns {object} plan
 */
const buildSchedule = ({
  calendar,
  capacityConfig,
  stageQuantities,
  startDate,
  preserveStartTime = false,
  difficulty = 'EASY',
  existingUsage = {},
  settings = {},
  overCapacityFactor = 1.0,
  manualDurations = {},
  rebuildBoundary = null, // ADDED: Week boundary to stop scheduling
}) => {
  const cal = calendar;
  const seeded =
    existingUsage && existingUsage.usage
      ? existingUsage
      : { usage: existingUsage };
  const seededBusyUntil = {};
  Object.entries(seeded.busyUntil || {}).forEach(([key, value]) => {
    const date = new Date(value);
    if (isValidDate(date)) seededBusyUntil[key] = date;
  });
  const ctx = {
    capacityConfig,
    usage: { ...(seeded.usage || {}) },
    busyUntil: seededBusyUntil,
    deltas: {},
    workingHoursPerDay: settings.workingHoursPerDay || WORKING_HOURS_PER_DAY,
    overCapacityFactor,
    manualDurations: manualDurations || {},
    rebuildBoundary, // ADDED: Pass to context for use in allocation functions
  };

  // FIX 7: Hard safety check at the beginning
  if (rebuildBoundary) {
    const boundaryDate = new Date(rebuildBoundary);
    boundaryDate.setHours(23, 59, 59, 999);
    ctx.weekEnd = boundaryDate;
  }

  // Project creation normally starts on the working day's first instant. Manual
  // downstream reschedules must preserve a mid-day completion timestamp so the
  // next phase only receives the remaining day window.
  const morningStart = cal.isWorkingDay(startDate)
    ? cal.createExactDateTime(startDate, MORNING_START)
    : cal.createExactDateTime(cal.nextWorkingDay(startDate), MORNING_START);
  const projectStart =
    preserveStartTime && cal.isWorkingDay(startDate)
      ? maxDate(new Date(startDate), morningStart)
      : morningStart;

  // FIX 4 & 6: Check if start date is already beyond boundary
  if (rebuildBoundary && projectStart > rebuildBoundary) {
    console.log(
      `⚠️ Project start ${projectStart} is beyond rebuild boundary ${rebuildBoundary}`,
    );
    return {
      stages: [],
      firstStart: startDate,
      lastEnd: startDate,
      productionWorkingDays: 0,
      estimatedDays: 0,
      difficultyAdjustmentDays: 0,
      contingencyDays: 0,
      deliveryDate: startDate,
      usageDeltas: ctx.deltas,
    };
  }

  const isPresent = (stage) => (stageQuantities[stage] || 0) > EPS;
  const endByStage = {};
  const stages = [];

  // Phase loop: allocate the present stages of each phase IN PARALLEL from the
  // phase start (each uses its own per-stage capacity pool), then continue the
  // NEXT phase the SAME day this phase's LONGEST task finished — so no whole day
  // is wasted when a stage only fills part of its last day (e.g. Design at 33%).
  // Stages within a phase run in parallel; adjacent phases may share the
  // transition day. Cross-project contention is stage/team-specific through
  // ctx.usage + ctx.busyUntil, so a free DESIGN team can start the next project
  // while the previous project is already in downstream stages.
  let phaseStart = projectStart;
  for (const phase of PHASES) {
    const ends = [];
    for (const stage of phase) {
      if (!isPresent(stage)) continue;

      // FIX 6: Skip if stage start is beyond boundary
      if (rebuildBoundary && phaseStart > rebuildBoundary) {
        console.log(
          `⚠️ Skipping stage ${stage} - phaseStart ${phaseStart} beyond boundary`,
        );
        continue;
      }

      const manualMin = ctx.manualDurations[stage];
      const useManual =
        manualMin != null && manualMin > EPS && CAPACITY_STAGES.includes(stage);
      const res = useManual
        ? allocateStageManual(
            cal,
            stage,
            stageQuantities[stage],
            phaseStart,
            manualMin,
            ctx,
          )
        : allocateStage(cal, stage, stageQuantities[stage], phaseStart, ctx);

      if (!res) continue;

      // FIX 6: Check if allocation end exceeds boundary
      if (rebuildBoundary && res.endDateTime > rebuildBoundary) {
        console.log(`⚠️ Stage ${stage} would end beyond boundary, truncating`);
        // Optionally truncate the stage to end at boundary
        res.endDateTime = new Date(rebuildBoundary);
        res.capacityDays = cal.workingDaysBetween(
          res.startDateTime,
          res.endDateTime,
        );
      }

      stages.push(res);
      endByStage[stage] = res.endDateTime;
      ends.push(res.endDateTime.getTime());
    }
    if (ends.length) {
      phaseStart = new Date(Math.max(...ends));
    }

    // FIX 4: Check if next phase start is beyond boundary
    if (rebuildBoundary && phaseStart > rebuildBoundary) {
      console.log(
        `⚠️ Stopping further phases - phaseStart ${phaseStart} beyond boundary`,
      );
      break;
    }
  }

  // PURCHASING side-track: runs parallel to Design and FINISHES one working day
  // after Design (spec: "start from invoicing, finished when design finished +
  // 1 day"). It does not gate the production phases.
  if (isPresent('PURCHASING')) {
    // FIX 6: Skip if beyond boundary
    if (!rebuildBoundary || projectStart <= rebuildBoundary) {
      const res = allocateStage(
        cal,
        'PURCHASING',
        stageQuantities.PURCHASING,
        projectStart,
        ctx,
      );
      if (res) {
        stages.push(res);
        endByStage.PURCHASING = res.endDateTime;
        if (endByStage.DESIGN) {
          const newEnd = cal.createExactDateTime(
            cal.nextWorkingDay(endByStage.DESIGN),
            SHIFT_TIMES.FULL_DAY.end,
          );
          // FIX 6: Check if new end exceeds boundary
          if (rebuildBoundary && newEnd > rebuildBoundary) {
            res.endDateTime = new Date(rebuildBoundary);
            res.customEndTime = new Date(rebuildBoundary);
          } else {
            res.endDateTime = newEnd;
            res.customEndTime = newEnd;
          }
          res.capacityDays = cal.workingDaysBetween(
            res.startDateTime,
            res.endDateTime,
          );
          endByStage.PURCHASING = res.endDateTime;
        }
      }
    }
  }

  if (stages.length === 0) {
    return {
      stages: [],
      firstStart: startDate,
      lastEnd: startDate,
      productionWorkingDays: 0,
      estimatedDays:
        settings.contingencyDays != null
          ? settings.contingencyDays
          : CONTINGENCY_DAYS,
      difficultyAdjustmentDays: 0,
      contingencyDays:
        settings.contingencyDays != null
          ? settings.contingencyDays
          : CONTINGENCY_DAYS,
      deliveryDate: startDate,
      usageDeltas: ctx.deltas,
    };
  }

  const firstStart = stages.reduce(
    (a, s) => (s.startDateTime < a ? s.startDateTime : a),
    stages[0].startDateTime,
  );
  const lastEnd = stages.reduce(
    (a, s) => (s.endDateTime > a ? s.endDateTime : a),
    stages[0].endDateTime,
  );

  const productionWorkingDays = cal.workingDaysBetween(firstStart, lastEnd);
  const buffer = settings.difficultyBuffer || DIFFICULTY_BUFFER;
  const contingencyDays =
    settings.contingencyDays != null
      ? settings.contingencyDays
      : CONTINGENCY_DAYS;
  const diff = buffer[difficulty] != null ? buffer[difficulty] : 0;
  const difficultyAdjustmentDays = Math.ceil(productionWorkingDays * diff);
  const estimatedDays =
    productionWorkingDays + difficultyAdjustmentDays + contingencyDays;
  // Delivery date = buffered working days walked forward from the first start.
  let deliveryDate = cal.addWorkingDays(firstStart, estimatedDays);

  // FIX 6: Cap delivery date at boundary if needed
  if (rebuildBoundary && deliveryDate > rebuildBoundary) {
    deliveryDate = new Date(rebuildBoundary);
  }

  return {
    stages,
    firstStart,
    lastEnd,
    productionWorkingDays,
    difficultyAdjustmentDays,
    contingencyDays,
    estimatedDays,
    deliveryDate,
    usageDeltas: ctx.deltas,
  };
};

/* ------------------------------------------------------------------ *
 * Async wrapper: load calendar + capacity + current usage, schedule,
 * and (commit only) persist consumed capacity to DailyStageCapacity.
 * ------------------------------------------------------------------ */

const loadCapacityConfig = async (client = prisma) => {
  const lots = await client.capacityLot.findMany();
  const cfg = {};
  lots.forEach((lot) => {
    cfg[lot.stage] = {
      capacity: lot.capacity || 1,
      workingHours: lot.workingHours || WORKING_HOURS_PER_DAY,
      parallelSlots: lot.parallelSlots || 1,
    };
  });
  // Ensure every capacity stage has an entry (default capacity 1).
  CAPACITY_STAGES.forEach((s) => {
    if (!cfg[s])
      cfg[s] = {
        capacity: 1,
        workingHours: WORKING_HOURS_PER_DAY,
        parallelSlots: 1,
      };
  });
  return cfg;
};

const loadExistingUsage = async (cal, fromDate, client = prisma) => {
  const usage = {};
  const busyUntil = {};
  try {
    const rows = await client.dailyStageCapacity.findMany({
      where: { date: { gte: cal.startOfDay(fromDate) } },
      include: {
        projectStageCapacityAllocations: {
          select: {
            endDateTime: true,
            customEndTime: true,
          },
        },
      },
    });
    rows.forEach((r) => {
      const dateKey = cal.dayKey(r.date);
      const key = usageKey(r.stage, dateKey);
      usage[key] = r.usedCapacity;
      (r.projectStageCapacityAllocations || []).forEach((a) => {
        rememberBusyUntil(busyUntil, key, a.endDateTime || a.customEndTime);
      });
      if (!busyUntil[key] && (r.usedHours || 0) > EPS) {
        const shift = r.shift || STAGE_SHIFT_PREFERENCE[r.stage] || 'FULL_DAY';
        const sb = cal.shiftBoundaries(r.date, shift);
        if (sb) {
          rememberBusyUntil(
            busyUntil,
            key,
            new Date(
              sb.startDateTime.getTime() + (r.usedHours || 0) * 3600 * 1000,
            ),
          );
        }
      }
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[engine] could not load existing capacity usage:',
      err.message,
    );
  }
  return { usage, busyUntil };
};

const flushUsage = async (
  capacityConfig,
  deltas,
  settings = {},
  client = prisma,
) => {
  const whpd = settings.workingHoursPerDay || WORKING_HOURS_PER_DAY;
  for (const [key, addedUnits] of Object.entries(deltas)) {
    if (addedUnits <= EPS) continue;
    const [stage, dateKey] = key.split('|');
    const date = dailyCapacityDate(dateKey);
    const cfg = capacityConfig[stage] || {};
    const capacity = cfg.capacity || 1;
    const slots = cfg.parallelSlots || 1;
    const shift = STAGE_SHIFT_PREFERENCE[stage] || 'FULL_DAY';
    const shiftHours = stageShiftHours(shift, whpd);
    // The EFFECTIVE daily ceiling — identical to allocateStage's dailyMaxUnits —
    // so the stored row is self-consistent (usedCapacity never exceeds
    // maxCapacity) and any consumer reads utilization as usedCapacity /
    // maxCapacity. (Previously maxCapacity stored the BASE capacity, so a fully
    // loaded day with parallelSlots > 1 read as > 100%.)
    // The effective daily ceiling, kept at 2-decimal precision to match the
    // fractional allocation units (units are Float). Storing the exact base means
    // a full day reads exactly 100% and overcapacity reads exactly 125% — no
    // rounding skew between the ceiling and the units measured against it.
    const dailyMax = Math.max(
      1,
      round2(capacity * (shiftHours / whpd) * slots),
    );
    const unitsPerHour = (capacity * slots) / whpd;
    const addedHours = round2(addedUnits / unitsPerHour);
    // eslint-disable-next-line no-await-in-loop
    const existing = await client.dailyStageCapacity.findUnique({
      where: { stage_date: { stage, date } },
    });
    if (existing) {
      const newTotal = (existing.usedCapacity || 0) + round2(addedUnits);
      const overUnits = Math.max(0, round2(newTotal - dailyMax));
      const prevOver = existing.overCapacityUsed || 0;
      const overDelta = Math.max(0, overUnits - prevOver);
      const overHoursDelta =
        overDelta > 0 ? round2(overDelta / unitsPerHour) : 0;
      // eslint-disable-next-line no-await-in-loop
      await client.dailyStageCapacity.update({
        where: { id: existing.id },
        data: {
          usedCapacity: { increment: round2(addedUnits) },
          usedHours: { increment: addedHours },
          ...(overDelta > 0
            ? {
                overCapacityUsed: { increment: overDelta },
                overHoursCapacityUsed: { increment: overHoursDelta },
              }
            : {}),
        },
      });
    } else {
      const overUnits = Math.max(0, round2(round2(addedUnits) - dailyMax));
      const overHours = overUnits > 0 ? round2(overUnits / unitsPerHour) : 0;
      // eslint-disable-next-line no-await-in-loop
      await client.dailyStageCapacity.create({
        data: {
          stage,
          date,
          shift,
          usedCapacity: round2(addedUnits),
          maxCapacity: dailyMax,
          workingHours: whpd,
          usedHours: addedHours,
          maxHours: shiftHours,
          overCapacityUsed: overUnits,
          overHoursCapacityUsed: overHours,
        },
      });
    }
  }
};

/**
 * Schedule a project/estimate.
 * @param {object} opts
 * @param {object} opts.stageQuantities  - { [stage]: number }
 * @param {Date|string} [opts.startDate] - default now
 * @param {boolean} [opts.preserveStartTime] - keep a same-day time-of-day instead of snapping to morning
 * @param {string} [opts.difficulty]     - EASY|MEDIUM|HARD
 * @param {'dryRun'|'commit'} [opts.mode] - dryRun (estimation) does not persist
 * @returns {Promise<object>} the plan (+ usageDeltas)
 */
const scheduleProject = async ({
  stageQuantities,
  startDate,
  preserveStartTime = false,
  difficulty = 'EASY',
  mode = 'dryRun',
  tx = null,
  overCapacityFactor = 1.0,
  manualDurations = {},
  rebuildBoundary = null, // ADD THIS: Week boundary to stop scheduling
}) => {
  const db = tx || prisma;
  const cal = await getCalendar();
  const settings = await getSchedulingSettings();
  const capacityConfig = await loadCapacityConfig(db);
  const start =
    startDate && startDate !== '' ? new Date(startDate) : new Date();
  const existingUsage = await loadExistingUsage(cal, start, db);

  const plan = buildSchedule({
    calendar: cal,
    capacityConfig,
    stageQuantities,
    startDate: start,
    preserveStartTime,
    difficulty,
    existingUsage,
    settings,
    overCapacityFactor,
    manualDurations,
    rebuildBoundary, // PASS IT TO buildSchedule
  });

  if (mode === 'commit') {
    await flushUsage(capacityConfig, plan.usageDeltas, settings, db);
  }
  return plan;
};

module.exports = {
  computeStageQuantities,
  buildSchedule,
  scheduleProject,
  loadCapacityConfig,
  dailyCapacityDate,
  PHASES,
};
