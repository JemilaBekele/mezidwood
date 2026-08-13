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
 *
 * TIME MODEL — read calendar.js first. Every duration here is WORKING time:
 * the allocator walks the working segments of each day (skipping lunch), stops
 * at closing time and resumes at the next working day's opening. It can never
 * place work at night, during lunch, on a weekend or on a holiday, whatever
 * instant it is handed as a start.
 */
const prisma = require('../prisma');
const { getCalendar } = require('./calendar');
const { getSchedulingSettings } = require('./settings');
const {
  EPS,
  DEFAULT_STAGE_SHIFT,
  CAPACITY_STAGES,
  NON_CAPACITY_STAGES,
  NON_CAPACITY_HOURS_PER_UNIT,
  DIFFICULTY_BUFFER,
  CONTINGENCY_DAYS,
  deliveryBufferDays,
} = require('./config');

const round2 = (n) => Math.round(n * 100) / 100;
const usageKey = (stage, dateKey) => `${stage}|${dateKey}`;
const maxDate = (a, b) => (a.getTime() > b.getTime() ? a : b);
const isValidDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());

// A DailyStageCapacity "date" column represents a calendar day. We store the
// business-tz day label (YYYY-MM-DD) as UTC midnight so the value is stable
// regardless of the server's local timezone. Use this everywhere a daily-
// capacity row is written or looked up so the stage_date unique key matches.
const dailyCapacityDate = (dateKey) => new Date(`${dateKey}T00:00:00.000Z`);

/**
 * THE daily unit ceiling for a stage, at 100%. One definition, used by the
 * allocator AND by flushUsage when it writes `maxCapacity` — previously these
 * were two expressions that could disagree (flushUsage clamped with
 * `Math.max(1, ...)`), so a fractional-capacity day could be full while the
 * stored row reported 70% utilization.
 */
const effectiveDailyMax = (cfg = {}) => {
  const capacity = cfg.capacity || 1;
  const slots = cfg.parallelSlots || 1;
  return round2(capacity * slots);
};

const rememberBusyUntil = (busyUntil, key, endDateTime) => {
  const end = new Date(endDateTime);
  if (!isValidDate(end)) return;
  const prev = busyUntil[key];
  if (!prev || end.getTime() > prev.getTime()) busyUntil[key] = end;
};

/** Accumulate a stage-day delta as BOTH units and working hours. */
const addDelta = (deltas, key, units, hours) => {
  const cur = deltas[key] || { units: 0, hours: 0 };
  cur.units = round2(cur.units + units);
  cur.hours = round2(cur.hours + hours);
  deltas[key] = cur;
};

/* ------------------------------------------------------------------ *
 * Dynamic stage quantities (material-driven).  This is the one place
 * that decides which stages a project includes and how much work each
 * one carries, based on material mix. Edit the rules here only.
 *
 * `materials` = { laminatedMDF, plainMDF, wood, metal, other } quantities.
 *
 * The frontend used to keep its own copy of these rules; it now calls the
 * stage-quantities endpoint which delegates here, so a rule change cannot
 * make the quote and the project disagree again.
 * ------------------------------------------------------------------ */
const computeStageQuantities = (materials) => {
  const m = {
    laminatedMDF: materials.laminatedMDF || 0,
    plainMDF: materials.plainMDF || 0,
    wood: materials.wood || 0,
    metal: materials.metal || 0,
    other: materials.other || 0,
  };
  const total = m.laminatedMDF + m.plainMDF + m.wood + m.metal; // excluded m.other
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

/**
 * Derive the two time-based stage quantities from the nine capacity-stage
 * quantities an estimate carries. DESIGN is the "everything" stage, so it is
 * the project's unit total. Keeps an estimate's stage set identical to the
 * project's — the estimate used to omit PURCHASING and INSTALLATION entirely,
 * while the project scheduled both, so the quote was short by the whole
 * installation phase.
 */
const withTimeBasedStages = (stageQuantities = {}) => {
  const total = stageQuantities.DESIGN || 0;
  return {
    ...stageQuantities,
    PURCHASING:
      stageQuantities.PURCHASING != null ? stageQuantities.PURCHASING : total,
    INSTALLATION:
      stageQuantities.INSTALLATION != null ? stageQuantities.INSTALLATION : total,
  };
};

/* ------------------------------------------------------------------ *
 * Workflow PHASES (Rosewood business spec).
 *
 * The workflow runs as a sequence of phases. Stages WITHIN a phase run in
 * PARALLEL (separate teams, each with its own per-stage capacity); a phase's
 * elapsed time is therefore set by its LONGEST task. The next phase starts when
 * the previous phase's longest task finishes (sharing the transition day rather
 * than wasting the rest of it).
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
 * Allocate one stage across consecutive working days, honouring per-day
 * capacity and existing usage. Mutates ctx.usage / ctx.deltas / ctx.busyUntil.
 * Returns a stage plan or null (zero qty).
 *
 * OVERCAPACITY: `ctx.overCapacityFactor` (1.25 on a manual reschedule) raises
 * the day's UNIT ceiling and the effective work RATE together. It never extends
 * the working window — a 125% day is still 08:30-17:00, just worked faster.
 * That is the whole point: the previous implementation multiplied the day's
 * HOURS by the factor, which pushed work past closing time.
 */
const allocateStage = (cal, stage, quantity, startInstant, ctx) => {
  if (quantity <= EPS) return null;

  // Time-based (non-capacity) stages: a contiguous run of WORKING time with no
  // daily unit ceiling. Still calendar-bound — it stops at closing and resumes
  // next working morning, so a 100-hour installation no longer runs overnight
  // and straight through Sundays.
  if (NON_CAPACITY_STAGES.includes(stage)) {
    const hours = quantity * (NON_CAPACITY_HOURS_PER_UNIT[stage] || 0.5);
    const start = cal.nextWorkingStart(startInstant);
    const end = cal.addWorkingHours(start, hours);
    return {
      stage,
      workUnits: quantity,
      actualWorkUnits: quantity,
      startDateTime: start,
      endDateTime: end,
      capacityDays: Math.max(1, cal.workingDaysBetween(start, end)),
      shift: DEFAULT_STAGE_SHIFT,
      timeTaken: Math.round(hours * 60),
      allocations: [],
      customStartTime: start,
      customEndTime: end,
    };
  }

  const cfg = ctx.capacityConfig[stage] || { capacity: 1 };
  const whpd = cal.workingHoursPerDay;
  const overCapFactor = ctx.overCapacityFactor || 1.0;

  const baseDailyMax = effectiveDailyMax(cfg); // units/day at 100%
  const dailyMaxUnits = round2(baseDailyMax * overCapFactor); // 100% or 125%
  const baseRate = baseDailyMax / whpd; // units per working hour at 100%
  const rate = baseRate * overCapFactor; // effective units per working hour

  let remaining = quantity;
  let cur = cal.nextWorkingStart(startInstant); // WT-1: never before opening
  const allocations = [];
  let guard = 0;
  const GUARD_MAX = 100000;

  while (remaining > EPS) {
    guard += 1;
    if (guard > GUARD_MAX) {
      throw new Error(
        `Scheduler failed to converge for ${stage} (qty=${quantity}, capacity=${cfg.capacity})`,
      );
    }

    // Stack after any work this same stage/team already has booked today.
    const dateKey = cal.dayKey(cur);
    const busy = ctx.busyUntil[usageKey(stage, dateKey)];
    let dayStart = cur;
    if (busy && busy.getTime() > dayStart.getTime()) {
      dayStart = cal.nextWorkingStart(busy);
    }
    if (cal.dayKey(dayStart) !== dateKey) {
      // busyUntil pushed us into a later day — restart the loop on that day.
      cur = dayStart;
      // eslint-disable-next-line no-continue
      continue;
    }

    const used = ctx.usage[usageKey(stage, dateKey)] || 0;
    const capacityHoursLeft = Math.max(0, dailyMaxUnits - used) / rate;
    const windowHoursLeft = cal.remainingHoursInDay(dayStart);
    const availableHours = Math.min(capacityHoursLeft, windowHoursLeft);

    if (availableHours <= EPS) {
      cur = cal.nextWorkingStart(cal.endOfWorkingDay(dayStart));
      // eslint-disable-next-line no-continue
      continue;
    }

    // Work in FULL PRECISION inside the loop and round only what is recorded.
    // Rounding `remaining` to 2dp and then re-deriving the next day's hours
    // from it fed the rounding error back into the time axis: a stage that
    // should have ended at 12:30:00 ended at 12:29:51, and the error compounded
    // through every downstream phase.
    const neededHours = remaining / rate;
    const isFinalChunk = neededHours <= availableHours + EPS;
    // Snap the closing chunk to a whole second so boundaries read cleanly.
    const useHours = isFinalChunk
      ? Math.round(neededHours * 3600) / 3600
      : availableHours;
    const assign = isFinalChunk ? remaining : useHours * rate;
    const endDT = cal.addWorkingHours(dayStart, useHours);

    allocations.push({
      date: dateKey,
      startDateTime: dayStart,
      endDateTime: endDT,
      units: round2(assign),
      hours: round2(useHours),
      shift: DEFAULT_STAGE_SHIFT,
    });
    ctx.usage[usageKey(stage, dateKey)] = used + assign;
    addDelta(ctx.deltas, usageKey(stage, dateKey), assign, useHours);
    rememberBusyUntil(ctx.busyUntil, usageKey(stage, dateKey), endDT);

    remaining = isFinalChunk ? 0 : remaining - assign;
    if (remaining > EPS) cur = cal.nextWorkingStart(endDT);
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
    shift: DEFAULT_STAGE_SHIFT,
    timeTaken: Math.round(totalHours * 60),
    allocations,
    customStartTime: null,
    customEndTime: null,
  };
};

/**
 * Allocate a stage by a USER-FIXED duration ("manual time wins"): the stage
 * spans exactly `minutes` of WORKING time from `startInstant`, and its quantity
 * is distributed across those day-segments proportional to time — regardless of
 * the quantity-derived capacity rate. Mirrors the manual timeline used when a
 * stage's time is edited, so a manual duration is honoured on EVERY re-plan
 * (cascade / rebuild / drag), not just at the moment of edit. Days may exceed
 * 100% of the unit ceiling (marked overcapacity downstream); the time is
 * authoritative — but it is still WORKING time, so a manual 20-hour stage
 * spans three working days rather than running through two nights.
 */
const allocateStageManual = (cal, stage, quantity, startInstant, minutes, ctx) => {
  const start = cal.nextWorkingStart(startInstant);
  const totalMinutes = Math.max(0, minutes);
  const empty = {
    stage,
    workUnits: quantity,
    actualWorkUnits: 0,
    startDateTime: start,
    endDateTime: start,
    capacityDays: 0,
    shift: DEFAULT_STAGE_SHIFT,
    timeTaken: 0,
    allocations: [],
    customStartTime: null,
    customEndTime: null,
  };
  if (totalMinutes <= EPS) return empty;

  const cfg = ctx.capacityConfig[stage] || { capacity: 1 };
  const baseDailyMax = effectiveDailyMax(cfg);
  const baseRate = baseDailyMax / cal.workingHoursPerDay;

  // 1) Split the manual minutes across consecutive working days (stacking after
  //    any existing same-stage work on the start day via busyUntil).
  const segments = [];
  let cur = start;
  let remaining = totalMinutes;
  let guard = 0;
  while (remaining > EPS && guard < 100000) {
    guard += 1;

    const dateKey = cal.dayKey(cur);
    const busy = ctx.busyUntil[usageKey(stage, dateKey)];
    let dayStart = cur;
    if (busy && busy.getTime() > dayStart.getTime()) {
      dayStart = cal.nextWorkingStart(busy);
    }
    if (cal.dayKey(dayStart) !== dateKey) {
      cur = dayStart;
      // eslint-disable-next-line no-continue
      continue;
    }

    const availMin = Math.round(cal.remainingHoursInDay(dayStart) * 60);
    if (availMin <= 0) {
      cur = cal.nextWorkingStart(cal.endOfWorkingDay(dayStart));
      // eslint-disable-next-line no-continue
      continue;
    }

    const useMin = Math.min(remaining, availMin);
    const endDT = cal.addWorkingHours(dayStart, useMin / 60);

    segments.push({
      dateKey,
      startDateTime: dayStart,
      endDateTime: endDT,
      minutes: useMin,
    });
    remaining = round2(remaining - useMin);
    if (remaining > EPS) cur = cal.nextWorkingStart(endDT);
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
    ctx.usage[key] = round2((ctx.usage[key] || 0) + u);
    addDelta(ctx.deltas, key, u, hours);
    rememberBusyUntil(ctx.busyUntil, key, seg.endDateTime);
    return {
      date: seg.dateKey,
      startDateTime: seg.startDateTime,
      endDateTime: seg.endDateTime,
      units: round2(u),
      hours,
      shift: DEFAULT_STAGE_SHIFT,
      // A manual duration can put more units into a day than the base rate
      // would; flag it so the capacity row records the overage honestly.
      baseRate,
    };
  });

  return {
    stage,
    workUnits: quantity,
    actualWorkUnits: round2(allocations.reduce((s, a) => s + a.units, 0)),
    startDateTime: allocations[0].startDateTime,
    endDateTime: allocations[allocations.length - 1].endDateTime,
    capacityDays: allocations.length,
    shift: DEFAULT_STAGE_SHIFT,
    timeTaken: Math.round(totalMinutes),
    allocations,
    customStartTime: null,
    customEndTime: null,
  };
};

/**
 * THE delivery-date rule. `productionWorkingDays` is an INCLUSIVE count of
 * [firstStart, lastEnd], so the buffer must be walked from lastEnd — walking it
 * from firstStart (what the code used to do) counts the production span twice
 * over its first day and made every promised date exactly one working day late.
 *
 * The returned instant is pinned to the END of the working day: a delivery date
 * means "by close of business on that day", not 08:30 that morning.
 */
const deliveryDateFor = (cal, lastEnd, productionWorkingDays, difficulty, settings) => {
  const bufferDays = deliveryBufferDays(productionWorkingDays, difficulty, settings);
  const day = bufferDays > 0 ? cal.addWorkingDays(lastEnd, bufferDays) : lastEnd;
  return { deliveryDate: cal.endOfWorkingDay(day), bufferDays };
};

/**
 * PURE scheduling core. No DB, no async.
 * @param {object} opts
 * @param {object} opts.calendar          - sync calendar (from getCalendar/makeCalendarFromHolidays)
 * @param {object} opts.capacityConfig    - { [stage]: { capacity, parallelSlots } }
 * @param {object} opts.stageQuantities   - { [stage]: number }
 * @param {Date}   opts.startDate         - earliest instant work may begin; normalized
 *                                          to the next valid working instant
 * @param {string} opts.difficulty        - EASY | MEDIUM | HARD
 * @param {object} [opts.existingUsage]   - usage seed, optionally with busyUntil timestamps
 * @returns {object} plan
 */
const buildSchedule = ({
  calendar,
  capacityConfig,
  stageQuantities,
  startDate,
  difficulty = 'EASY',
  existingUsage = {},
  settings = {},
  overCapacityFactor = 1.0,
  manualDurations = {},
}) => {
  const cal = calendar;
  const seeded =
    existingUsage && existingUsage.usage ? existingUsage : { usage: existingUsage };
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
    overCapacityFactor,
    manualDurations: manualDurations || {},
  };

  const contingencyDays =
    settings.contingencyDays != null ? settings.contingencyDays : CONTINGENCY_DAYS;

  // WT-1 — THE working-time guard. Whatever instant we are handed (21:00, a
  // Sunday, the middle of the lunch break, or a stale timestamp from a cascade)
  // the project starts at the next instant the factory is actually open.
  const projectStart = cal.nextWorkingStart(startDate);

  const isPresent = (stage) => (stageQuantities[stage] || 0) > EPS;
  const endByStage = {};
  const stages = [];

  // Phase loop: allocate the present stages of each phase IN PARALLEL from the
  // phase start (each uses its own per-stage capacity pool), then continue the
  // NEXT phase from the instant this phase's LONGEST task finished — so no whole
  // day is wasted when a stage only fills part of its last day (e.g. Design at
  // 33%). Cross-project contention is stage/team-specific through ctx.usage +
  // ctx.busyUntil, so a free DESIGN team can start the next project while the
  // previous project is already in downstream stages.
  let phaseStart = projectStart;
  for (const phase of PHASES) {
    const ends = [];
    for (const stage of phase) {
      if (!isPresent(stage)) continue;

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
      stages.push(res);
      endByStage[stage] = res.endDateTime;
      ends.push(res.endDateTime.getTime());
    }
    if (ends.length) phaseStart = new Date(Math.max(...ends));
  }

  // PURCHASING side-track: runs parallel to Design and FINISHES one working day
  // after Design (spec: "start from invoicing, finished when design finished +
  // 1 day"). It does not gate the production phases.
  if (isPresent('PURCHASING')) {
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
        // "One working day after design" — end of that day's shift. Never
        // shorten the stage below the working time it actually needs.
        const spec = cal.endOfWorkingDay(cal.nextWorkingDay(endByStage.DESIGN));
        const newEnd = maxDate(spec, res.endDateTime);
        res.endDateTime = newEnd;
        res.customEndTime = newEnd;
        res.capacityDays = Math.max(
          1,
          cal.workingDaysBetween(res.startDateTime, res.endDateTime),
        );
        endByStage.PURCHASING = res.endDateTime;
      }
    }
  }

  if (stages.length === 0) {
    // FN-7: an empty plan used to report `estimatedDays = contingency` while
    // returning `deliveryDate = startDate`, two numbers that contradicted each
    // other. Nothing to build means nothing to promise.
    return {
      stages: [],
      firstStart: projectStart,
      lastEnd: projectStart,
      productionWorkingDays: 0,
      estimatedDays: 0,
      difficultyAdjustmentDays: 0,
      contingencyDays: 0,
      bufferDays: 0,
      deliveryDate: cal.endOfWorkingDay(projectStart),
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
  const diff = buffer[difficulty] != null ? buffer[difficulty] : 0;
  const difficultyAdjustmentDays = Math.ceil(productionWorkingDays * diff);

  const { deliveryDate, bufferDays } = deliveryDateFor(
    cal,
    lastEnd,
    productionWorkingDays,
    difficulty,
    settings,
  );

  return {
    stages,
    firstStart,
    lastEnd,
    productionWorkingDays,
    difficultyAdjustmentDays,
    contingencyDays,
    bufferDays,
    // The customer-facing promise LENGTH in working days.
    estimatedDays: productionWorkingDays + bufferDays,
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
      parallelSlots: lot.parallelSlots || 1,
    };
  });
  // Ensure every capacity stage has an entry (default capacity 1).
  CAPACITY_STAGES.forEach((s) => {
    if (!cfg[s]) cfg[s] = { capacity: 1, parallelSlots: 1 };
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
          select: { endDateTime: true, customEndTime: true },
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
        // No allocation rows (legacy data): assume the used hours were worked
        // from the start of the day, in WORKING time.
        rememberBusyUntil(
          busyUntil,
          key,
          cal.addWorkingHours(cal.startOfWorkingDay(r.date), r.usedHours || 0),
        );
      }
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[engine] could not load existing capacity usage:', err.message);
  }
  return { usage, busyUntil };
};

/**
 * Persist the capacity a plan consumed.
 *
 * `maxCapacity` / `maxHours` store the BASE (100%) ceiling so that a full day
 * reads exactly 100% and an overcapacity day reads exactly 125% — the ceiling
 * comes from effectiveDailyMax(), the same function the allocator measures
 * against, so a row can never be self-inconsistent.
 */
const flushUsage = async (capacityConfig, deltas, client = prisma, cal = null) => {
  const whpd = cal ? cal.workingHoursPerDay : null;
  for (const [key, delta] of Object.entries(deltas)) {
    const addedUnits = round2(delta.units || 0);
    const addedHours = round2(delta.hours || 0);
    if (addedUnits <= EPS && addedHours <= EPS) continue;

    const [stage, dateKey] = key.split('|');
    if (!CAPACITY_STAGES.includes(stage)) continue; // enum-safe: no rows for time-based stages

    const date = dailyCapacityDate(dateKey);
    const cfg = capacityConfig[stage] || {};
    const dailyMax = effectiveDailyMax(cfg);
    const maxHours = whpd || cfg.workingHours || 7.5;

    // eslint-disable-next-line no-await-in-loop
    const existing = await client.dailyStageCapacity.findUnique({
      where: { stage_date: { stage, date } },
    });

    if (existing) {
      const newTotal = round2((existing.usedCapacity || 0) + addedUnits);
      const overUnits = Math.max(0, round2(newTotal - dailyMax));
      const prevOver = existing.overCapacityUsed || 0;
      const overDelta = Math.max(0, round2(overUnits - prevOver));
      const newHours = round2((existing.usedHours || 0) + addedHours);
      const overHours = Math.max(0, round2(newHours - maxHours));
      const prevOverHours = existing.overHoursCapacityUsed || 0;
      const overHoursDelta = Math.max(0, round2(overHours - prevOverHours));

      // eslint-disable-next-line no-await-in-loop
      await client.dailyStageCapacity.update({
        where: { id: existing.id },
        data: {
          usedCapacity: { increment: addedUnits },
          usedHours: { increment: addedHours },
          maxCapacity: dailyMax,
          maxHours,
          ...(overDelta > 0 ? { overCapacityUsed: { increment: overDelta } } : {}),
          ...(overHoursDelta > 0
            ? { overHoursCapacityUsed: { increment: overHoursDelta } }
            : {}),
        },
      });
    } else {
      const overUnits = Math.max(0, round2(addedUnits - dailyMax));
      const overHours = Math.max(0, round2(addedHours - maxHours));
      // eslint-disable-next-line no-await-in-loop
      await client.dailyStageCapacity.create({
        data: {
          stage,
          date,
          shift: DEFAULT_STAGE_SHIFT,
          usedCapacity: addedUnits,
          maxCapacity: dailyMax,
          workingHours: maxHours,
          usedHours: addedHours,
          maxHours,
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
 * @param {Date|string} [opts.startDate] - default now; normalized to working hours
 * @param {string} [opts.difficulty]     - EASY|MEDIUM|HARD
 * @param {'dryRun'|'commit'} [opts.mode] - dryRun (estimation) does not persist
 * @returns {Promise<object>} the plan (+ usageDeltas)
 */
const scheduleProject = async ({
  stageQuantities,
  startDate,
  difficulty = 'EASY',
  mode = 'dryRun',
  tx = null,
  overCapacityFactor = 1.0,
  manualDurations = {},
}) => {
  const db = tx || prisma;
  const cal = await getCalendar();
  const settings = await getSchedulingSettings();
  const capacityConfig = await loadCapacityConfig(db);
  const start = startDate && startDate !== '' ? new Date(startDate) : new Date();
  const existingUsage = await loadExistingUsage(cal, start, db);

  const plan = buildSchedule({
    calendar: cal,
    capacityConfig,
    stageQuantities,
    startDate: start,
    difficulty,
    existingUsage,
    settings,
    overCapacityFactor,
    manualDurations,
  });

  if (mode === 'commit') {
    await flushUsage(capacityConfig, plan.usageDeltas, db, cal);
  }
  return plan;
};

module.exports = {
  computeStageQuantities,
  withTimeBasedStages,
  buildSchedule,
  scheduleProject,
  loadCapacityConfig,
  loadExistingUsage,
  flushUsage,
  effectiveDailyMax,
  deliveryDateFor,
  dailyCapacityDate,
  PHASES,
};
