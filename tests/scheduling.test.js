/**
 * Scheduler unit tests — no database required.
 *
 * `buildSchedule` and the calendar were deliberately written as PURE functions
 * "so the unit tests need no database". Those tests did not exist, which is why
 * a one-working-day delivery error, work scheduled through the lunch break, and
 * projects starting 12 hours in the past all shipped unnoticed.
 *
 * Each test below pins one of those behaviours. Run with:
 *     npm test            (node --test tests/)
 *     node --test tests/scheduling.test.js
 *
 * NOTE ON ISOLATION: calendar.js and settings.js require the Prisma client at
 * module load. We stub `../src/services/prisma` in require.cache before loading
 * anything else, so these tests never touch a database and run anywhere.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');

/* ------------------------------------------------------------------ *
 * Stub the Prisma client BEFORE the scheduling modules are required.
 * ------------------------------------------------------------------ */
const prismaPath = require.resolve('../src/services/prisma');
require.cache[prismaPath] = new Module(prismaPath, null);
require.cache[prismaPath].filename = prismaPath;
require.cache[prismaPath].loaded = true;
require.cache[prismaPath].exports = {
  holiday: { findMany: async () => [] },
  schedulingSettings: {
    findFirst: async () => null,
    create: async () => ({}),
  },
};

const { makeCalendarFromHolidays } = require('../src/services/scheduling/calendar');
const {
  buildSchedule,
  computeStageQuantities,
  withTimeBasedStages,
  effectiveDailyMax,
} = require('../src/services/scheduling/engine');
const {
  normalizeWorkingTime,
  deliveryBufferDays,
  parseWorkingDays,
} = require('../src/services/scheduling/config');

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */
const TZ = 'Africa/Addis_Ababa';
const CAPACITY_STAGES = [
  'DESIGN',
  'METAL_WORKS',
  'CNC',
  'CUTTING',
  'EDGE_BANDING',
  'ASSEMBLY',
  'PAINTING',
  'FINISHING',
  'DELIVERY',
];

const cal = makeCalendarFromHolidays([]);

const capacityConfig = (capacity = 10) =>
  CAPACITY_STAGES.reduce((acc, s) => {
    acc[s] = { capacity, parallelSlots: 1 };
    return acc;
  }, {});

/** Wall-clock in the business timezone, e.g. '03/08/2026, 08:30:00'. */
const local = (d) =>
  new Date(d).toLocaleString('en-GB', { timeZone: TZ, hour12: false });

/** Decimal hour-of-day in the business timezone. */
const hourOf = (d) => {
  const s = new Date(d).toLocaleTimeString('en-GB', {
    timeZone: TZ,
    hour12: false,
  });
  const [h, m] = s.split(':').map(Number);
  return h + m / 60;
};

const dayName = (d) =>
  new Date(d).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long' });

// Monday 3 August 2026, 05:30 UTC = 08:30 Addis (start of shift).
const MONDAY_0830 = new Date('2026-08-03T05:30:00.000Z');

const plan = (opts = {}) =>
  buildSchedule({
    calendar: cal,
    capacityConfig: capacityConfig(opts.capacity || 10),
    stageQuantities: opts.stageQuantities || {
      DESIGN: 10,
      CUTTING: 10,
      ASSEMBLY: 10,
      FINISHING: 10,
      DELIVERY: 10,
    },
    startDate: opts.startDate || MONDAY_0830,
    difficulty: opts.difficulty || 'EASY',
    settings: opts.settings || { contingencyDays: 0, difficultyBuffer: { EASY: 0, MEDIUM: 0.4, HARD: 0.5 } },
    existingUsage: opts.existingUsage,
    overCapacityFactor: opts.overCapacityFactor,
    manualDurations: opts.manualDurations,
  });

/* ================================================================== *
 * WT-1 — work is never scheduled outside the working window
 * ================================================================== */
test('WT-1: a project created after closing starts the NEXT working morning', () => {
  // 18:00 UTC = 21:00 Addis, Monday — four hours after the 17:00 close.
  const p = plan({ startDate: new Date('2026-08-03T18:00:00.000Z') });
  const first = p.stages.find((s) => s.stage === 'DESIGN').startDateTime;

  assert.strictEqual(hourOf(first), 8.5, 'must start at 08:30');
  assert.strictEqual(dayName(first), 'Tuesday', 'must roll to the next day');
  assert.ok(
    first.getTime() > new Date('2026-08-03T18:00:00.000Z').getTime(),
    'the schedule must never start before the instant it was created',
  );
});

test('WT-1: a project created before opening starts the SAME day at 08:30', () => {
  // 02:00 UTC = 05:00 Addis, Monday — before the 08:30 open.
  const p = plan({ startDate: new Date('2026-08-03T02:00:00.000Z') });
  const first = p.stages.find((s) => s.stage === 'DESIGN').startDateTime;
  assert.strictEqual(hourOf(first), 8.5);
  assert.strictEqual(dayName(first), 'Monday');
});

test('WT-1: a project created during lunch starts when lunch ends', () => {
  // 09:45 UTC = 12:45 Addis — inside the 12:30-13:30 lunch gap.
  const p = plan({ startDate: new Date('2026-08-03T09:45:00.000Z') });
  const first = p.stages.find((s) => s.stage === 'DESIGN').startDateTime;
  assert.strictEqual(hourOf(first), 13.5, 'must resume at 13:30, not 08:30');
  assert.strictEqual(dayName(first), 'Monday');
});

test('WT-1: a project created mid-shift keeps its real instant', () => {
  // 07:00 UTC = 10:00 Addis, inside the morning segment.
  const start = new Date('2026-08-03T07:00:00.000Z');
  const p = plan({ startDate: start });
  const first = p.stages.find((s) => s.stage === 'DESIGN').startDateTime;
  assert.strictEqual(first.getTime(), start.getTime());
});

test('WT-1: a project created on a non-working day rolls to the next one', () => {
  // Sunday 2 August 2026 — Sunday is not a working day by default.
  const p = plan({ startDate: new Date('2026-08-02T09:00:00.000Z') });
  const first = p.stages.find((s) => s.stage === 'DESIGN').startDateTime;
  assert.strictEqual(dayName(first), 'Monday');
  assert.strictEqual(hourOf(first), 8.5);
});

test('WT-1: a holiday is skipped like a weekend', () => {
  const withHoliday = makeCalendarFromHolidays([
    { date: new Date('2026-08-04T00:00:00.000Z'), name: 'Test', recurring: false },
  ]);
  // Tuesday the 4th is a holiday -> next working start is Wednesday the 5th.
  const next = withHoliday.nextWorkingStart(new Date('2026-08-04T05:00:00.000Z'));
  assert.strictEqual(dayName(next), 'Wednesday');
  assert.strictEqual(hourOf(next), 8.5);
});

test('WT-1: NO allocation of ANY stage ever falls outside working hours', () => {
  const p = plan({
    startDate: new Date('2026-08-03T18:00:00.000Z'),
    capacity: 3, // small capacity -> long, multi-day stages
    stageQuantities: withTimeBasedStages({
      DESIGN: 40,
      CUTTING: 40,
      EDGE_BANDING: 15,
      ASSEMBLY: 40,
      PAINTING: 20,
      FINISHING: 40,
      DELIVERY: 40,
    }),
  });

  for (const stage of p.stages) {
    for (const a of stage.allocations) {
      assert.ok(
        cal.isWorkingDay(a.startDateTime),
        `${stage.stage} allocated on a non-working day: ${local(a.startDateTime)}`,
      );
      const sh = hourOf(a.startDateTime);
      const eh = hourOf(a.endDateTime);
      assert.ok(sh >= 8.5 - 1e-9, `${stage.stage} starts before opening: ${local(a.startDateTime)}`);
      assert.ok(eh <= 17.0 + 1e-9, `${stage.stage} ends after closing: ${local(a.endDateTime)}`);
      // Must not sit entirely inside the lunch gap.
      assert.ok(
        !(sh >= 12.5 - 1e-9 && eh <= 13.5 + 1e-9 && eh > sh),
        `${stage.stage} allocated inside the lunch break`,
      );
    }
  }
});

/* ================================================================== *
 * WT-2 — time-based stages respect the calendar too
 * ================================================================== */
test('WT-2: INSTALLATION does not run overnight', () => {
  // 200 units x 0.5h = 100 working hours ~= 14 working days, not 100 wall hours.
  const p = plan({
    stageQuantities: { DESIGN: 1, INSTALLATION: 200 },
  });
  const install = p.stages.find((s) => s.stage === 'INSTALLATION');
  assert.ok(install, 'INSTALLATION must be scheduled');
  assert.ok(hourOf(install.endDateTime) <= 17.0 + 1e-9, 'must end by closing time');
  assert.ok(cal.isWorkingDay(install.endDateTime), 'must end on a working day');

  // 100 working hours at 7.5h/day spans at least 13 working days.
  const spanDays = cal.workingDaysBetween(install.startDateTime, install.endDateTime);
  assert.ok(spanDays >= 13, `expected >= 13 working days, got ${spanDays}`);
});

test('WT-2: PURCHASING respects the calendar', () => {
  const p = plan({ stageQuantities: { DESIGN: 10, PURCHASING: 200 } });
  const purch = p.stages.find((s) => s.stage === 'PURCHASING');
  assert.ok(cal.isWorkingDay(purch.endDateTime));
  assert.ok(hourOf(purch.endDateTime) <= 17.0 + 1e-9);
});

/* ================================================================== *
 * WT-3 — the lunch break is real
 * ================================================================== */
test('WT-3: a full working day ends at 17:00, not 16:00', () => {
  // capacity 10, quantity 10 => exactly one full day of work.
  const p = plan({ stageQuantities: { DESIGN: 10 }, capacity: 10 });
  const design = p.stages.find((s) => s.stage === 'DESIGN');
  assert.strictEqual(hourOf(design.startDateTime), 8.5);
  assert.strictEqual(
    hourOf(design.endDateTime),
    17.0,
    'a 7.5h day must span 08:30-17:00 across the lunch gap, ending at 17:00',
  );
});

test('WT-3: addWorkingHours skips the lunch gap', () => {
  // 08:30 + 4.5 working hours = 12:30 (4h) + 0.5h after lunch = 14:00
  const end = cal.addWorkingHours(MONDAY_0830, 4.5);
  assert.strictEqual(hourOf(end), 14.0);
});

test('WT-3: workingHoursBetween excludes lunch, nights and weekends', () => {
  // 08:30 Monday -> 17:00 Monday is 7.5 WORKING hours (8.5 wall-clock hours).
  const close = cal.endOfWorkingDay(MONDAY_0830);
  assert.strictEqual(cal.workingHoursBetween(MONDAY_0830, close), 7.5);

  // 08:30 Monday -> 17:00 Tuesday is 15 working hours, not 32.5 wall hours.
  const tueClose = cal.endOfWorkingDay(cal.addWorkingDays(MONDAY_0830, 1));
  assert.strictEqual(cal.workingHoursBetween(MONDAY_0830, tueClose), 15);
});

test('WT-3: the working day is exactly 7.5 hours by default', () => {
  assert.strictEqual(cal.workingHoursPerDay, 7.5);
});

/* ================================================================== *
 * WT-4 — working time is configurable, and stays coherent
 * ================================================================== */
test('WT-4: a configured shift window changes the schedule', () => {
  const nineToFive = makeCalendarFromHolidays([], {
    shiftStart: 9,
    shiftEnd: 18,
    lunchStart: 13,
    lunchEnd: 14,
  });
  assert.strictEqual(nineToFive.workingHoursPerDay, 8);

  const start = nineToFive.nextWorkingStart(new Date('2026-08-03T02:00:00.000Z'));
  assert.strictEqual(hourOf(start), 9);
  // A full 8h day: 09:00 -> 13:00, lunch, 14:00 -> 18:00.
  assert.strictEqual(hourOf(nineToFive.addWorkingHours(start, 8)), 18);
});

test('WT-4: a five-day week is honoured', () => {
  const fiveDay = makeCalendarFromHolidays([], { workingDays: '1,2,3,4,5' });
  // Saturday 8 Aug 2026 is no longer a working day.
  assert.strictEqual(fiveDay.isWorkingDay(new Date('2026-08-08T09:00:00.000Z')), false);
  assert.strictEqual(cal.isWorkingDay(new Date('2026-08-08T09:00:00.000Z')), true);
});

test('WT-4: an incoherent working-time config falls back, never widens the window', () => {
  // shiftEnd before shiftStart is nonsense — must NOT produce a 24h day.
  const wt = normalizeWorkingTime({ shiftStart: 18, shiftEnd: 6 });
  assert.strictEqual(wt.shiftStart, 8.5);
  assert.strictEqual(wt.shiftEnd, 17.0);
  assert.strictEqual(wt.workingHoursPerDay, 7.5);

  // A lunch window outside the shift means "no lunch", not a negative day.
  const wt2 = normalizeWorkingTime({ lunchStart: 20, lunchEnd: 21 });
  assert.strictEqual(wt2.workingHoursPerDay, 8.5);
});

test('WT-4: workingDays parses every accepted shape', () => {
  const expected = { 0: false, 1: true, 2: true, 3: true, 4: true, 5: true, 6: false };
  assert.deepStrictEqual(parseWorkingDays('1,2,3,4,5'), expected);
  assert.deepStrictEqual(parseWorkingDays([1, 2, 3, 4, 5]), expected);
  assert.deepStrictEqual(parseWorkingDays(expected), expected);
  // Garbage falls back to the default six-day week rather than "no working days".
  assert.strictEqual(parseWorkingDays('nonsense')[1], true);
});

/* ================================================================== *
 * AL-1 — the delivery date rule
 * ================================================================== */
test('AL-1: with a zero buffer, the delivery date IS the production end', () => {
  const p = plan({
    settings: { contingencyDays: 0, difficultyBuffer: { EASY: 0 } },
    difficulty: 'EASY',
  });
  assert.strictEqual(
    cal.dayKey(p.deliveryDate),
    cal.dayKey(p.lastEnd),
    'zero buffer must not move the date — this is the invariant that was broken',
  );
});

test('AL-1: the buffer is walked from the END of production, not the start', () => {
  const p = plan({
    settings: { contingencyDays: 3, difficultyBuffer: { EASY: 0 } },
    difficulty: 'EASY',
  });
  const expected = cal.addWorkingDays(p.lastEnd, 3);
  assert.strictEqual(cal.dayKey(p.deliveryDate), cal.dayKey(expected));

  // And explicitly NOT the old rule (firstStart + production + buffer), which
  // double-counted the first day of an inclusive span.
  const oldRule = cal.addWorkingDays(p.firstStart, p.productionWorkingDays + 3);
  assert.notStrictEqual(
    cal.dayKey(p.deliveryDate),
    cal.dayKey(oldRule),
    'the old off-by-one rule must not be reachable',
  );
});

test('AL-1: the delivery date is close of business, not the morning', () => {
  const p = plan();
  assert.strictEqual(hourOf(p.deliveryDate), 17.0);
});

test('AL-1: the delivery date always lands on a working day', () => {
  for (const difficulty of ['EASY', 'MEDIUM', 'HARD']) {
    for (let qty = 1; qty <= 40; qty += 7) {
      const p = plan({
        difficulty,
        stageQuantities: { DESIGN: qty, CUTTING: qty, FINISHING: qty },
        settings: { contingencyDays: 3, difficultyBuffer: { EASY: 0, MEDIUM: 0.4, HARD: 0.5 } },
      });
      assert.ok(
        cal.isWorkingDay(p.deliveryDate),
        `${difficulty}/${qty}: delivery fell on a non-working day`,
      );
    }
  }
});

test('AL-1: difficulty extends the promise by the documented percentage', () => {
  const settings = {
    contingencyDays: 0,
    difficultyBuffer: { EASY: 0, MEDIUM: 0.4, HARD: 0.5 },
  };
  const q = { DESIGN: 40, CUTTING: 40, FINISHING: 40 };
  const easy = plan({ difficulty: 'EASY', stageQuantities: q, settings, capacity: 5 });
  const hard = plan({ difficulty: 'HARD', stageQuantities: q, settings, capacity: 5 });

  assert.strictEqual(easy.bufferDays, 0);
  assert.strictEqual(hard.bufferDays, Math.ceil(hard.productionWorkingDays * 0.5));
  assert.ok(hard.deliveryDate.getTime() > easy.deliveryDate.getTime());
});

test('AL-1: deliveryBufferDays matches the documented formula', () => {
  const settings = { contingencyDays: 3, difficultyBuffer: { EASY: 0, MEDIUM: 0.4, HARD: 0.5 } };
  assert.strictEqual(deliveryBufferDays(10, 'EASY', settings), 3);
  assert.strictEqual(deliveryBufferDays(10, 'MEDIUM', settings), 4 + 3);
  assert.strictEqual(deliveryBufferDays(10, 'HARD', settings), 5 + 3);
});

/* ================================================================== *
 * AL-4 / estimate == project
 * ================================================================== */
test('AL-4: withTimeBasedStages adds the two stages the estimate used to omit', () => {
  const q = withTimeBasedStages({ DESIGN: 25, CUTTING: 25 });
  assert.strictEqual(q.PURCHASING, 25);
  assert.strictEqual(q.INSTALLATION, 25);
});

test('estimate and project produce the IDENTICAL delivery date', () => {
  // The estimate: nine capacity stages entered by the user, normalized.
  const estimateQuantities = withTimeBasedStages({
    DESIGN: 30,
    METAL_WORKS: 0,
    CNC: 0,
    CUTTING: 30,
    EDGE_BANDING: 10,
    ASSEMBLY: 30,
    PAINTING: 20,
    FINISHING: 30,
    DELIVERY: 30,
  });

  // The project: created from the estimate, so the same quantities and the same
  // difficulty flow into the same engine.
  const settings = { contingencyDays: 3, difficultyBuffer: { EASY: 0, MEDIUM: 0.4, HARD: 0.5 } };
  const estimate = plan({ stageQuantities: estimateQuantities, difficulty: 'HARD', settings, capacity: 8 });
  const project = plan({ stageQuantities: estimateQuantities, difficulty: 'HARD', settings, capacity: 8 });

  assert.strictEqual(estimate.deliveryDate.getTime(), project.deliveryDate.getTime());
  assert.strictEqual(estimate.estimatedDays, project.estimatedDays);
  assert.strictEqual(estimate.productionWorkingDays, project.productionWorkingDays);
});

test('the material rule produces the documented stage mix', () => {
  const q = computeStageQuantities({ laminatedMDF: 10, plainMDF: 5, wood: 3, metal: 2, other: 0 });
  assert.strictEqual(q.DESIGN, 20, 'DESIGN carries every unit');
  assert.strictEqual(q.METAL_WORKS, 2);
  assert.strictEqual(q.CNC, 0, 'CNC is manual-add only');
  assert.strictEqual(q.CUTTING, 18, 'panels only (total - metal)');
  assert.strictEqual(q.EDGE_BANDING, 10, 'laminated only');
  assert.strictEqual(q.ASSEMBLY, 18);
  assert.strictEqual(q.PAINTING, 10, 'excludes laminated MDF');
  assert.strictEqual(q.FINISHING, 20);
});

/* ================================================================== *
 * FN-5 / FN-7 — capacity accounting and empty plans
 * ================================================================== */
test('FN-5: the daily ceiling is one definition', () => {
  assert.strictEqual(effectiveDailyMax({ capacity: 10, parallelSlots: 1 }), 10);
  assert.strictEqual(effectiveDailyMax({ capacity: 10, parallelSlots: 2 }), 20);
  // Fractional capacity is NOT clamped up to 1 — that clamp made a full day
  // report as under-utilized.
  assert.strictEqual(effectiveDailyMax({ capacity: 0.5, parallelSlots: 1 }), 0.5);
});

test('capacity is never exceeded on any day', () => {
  const cfg = capacityConfig(5);
  const p = buildSchedule({
    calendar: cal,
    capacityConfig: cfg,
    stageQuantities: { DESIGN: 37 },
    startDate: MONDAY_0830,
    difficulty: 'EASY',
    settings: { contingencyDays: 0, difficultyBuffer: { EASY: 0 } },
  });
  const perDay = {};
  p.stages[0].allocations.forEach((a) => {
    perDay[a.date] = (perDay[a.date] || 0) + a.units;
  });
  Object.entries(perDay).forEach(([date, units]) => {
    assert.ok(units <= 5 + 1e-6, `${date}: ${units} units exceeds the ceiling of 5`);
  });
  // And all the work was placed.
  const total = Object.values(perDay).reduce((s, u) => s + u, 0);
  assert.ok(Math.abs(total - 37) < 0.01, `expected 37 units placed, got ${total}`);
});

test('overcapacity raises the unit ceiling but NOT the working window', () => {
  const p = buildSchedule({
    calendar: cal,
    capacityConfig: capacityConfig(10),
    stageQuantities: { DESIGN: 12 },
    startDate: MONDAY_0830,
    difficulty: 'EASY',
    settings: { contingencyDays: 0, difficultyBuffer: { EASY: 0 } },
    overCapacityFactor: 1.25,
  });
  const allocs = p.stages[0].allocations;
  // 12 units fit in one day at 125% (ceiling 12.5)...
  assert.strictEqual(allocs.length, 1);
  assert.ok(allocs[0].units <= 12.5 + 1e-6);
  // ...but that day still ends at 17:00.
  assert.ok(hourOf(allocs[0].endDateTime) <= 17.0 + 1e-9);
});

test('FN-7: an empty plan reports a consistent zero', () => {
  const p = plan({ stageQuantities: {} });
  assert.strictEqual(p.stages.length, 0);
  assert.strictEqual(p.estimatedDays, 0);
  assert.strictEqual(p.productionWorkingDays, 0);
  assert.ok(p.deliveryDate instanceof Date);
});

test('existing usage from other projects pushes a stage to the next free day', () => {
  const monday = cal.dayKey(MONDAY_0830);
  const p = buildSchedule({
    calendar: cal,
    capacityConfig: capacityConfig(10),
    stageQuantities: { DESIGN: 10 },
    startDate: MONDAY_0830,
    difficulty: 'EASY',
    settings: { contingencyDays: 0, difficultyBuffer: { EASY: 0 } },
    existingUsage: { usage: { [`DESIGN|${monday}`]: 10 } }, // Monday is full
  });
  const first = p.stages[0].allocations[0];
  assert.notStrictEqual(first.date, monday, 'must not book a full day');
  assert.strictEqual(dayName(p.stages[0].startDateTime), 'Tuesday');
});

/* ================================================================== *
 * Manual durations
 * ================================================================== */
test('a manual duration is honoured in WORKING time', () => {
  // 20 hours of manual work = 2 full days (15h) + 5h into the third day.
  const p = plan({
    stageQuantities: { DESIGN: 10 },
    manualDurations: { DESIGN: 20 * 60 },
  });
  const design = p.stages.find((s) => s.stage === 'DESIGN');
  assert.strictEqual(design.timeTaken, 1200);
  assert.strictEqual(design.allocations.length, 3);
  design.allocations.forEach((a) => {
    assert.ok(hourOf(a.endDateTime) <= 17.0 + 1e-9);
    assert.ok(cal.isWorkingDay(a.startDateTime));
  });
});

/* ================================================================== *
 * Phase ordering
 * ================================================================== */
test('phases run in order and never overlap backwards', () => {
  const p = plan({
    stageQuantities: withTimeBasedStages({
      DESIGN: 20,
      CUTTING: 20,
      ASSEMBLY: 20,
      FINISHING: 20,
      DELIVERY: 20,
    }),
    capacity: 5,
  });
  const byStage = {};
  p.stages.forEach((s) => {
    byStage[s.stage] = s;
  });

  const order = ['DESIGN', 'CUTTING', 'ASSEMBLY', 'FINISHING', 'DELIVERY'];
  for (let i = 1; i < order.length; i += 1) {
    const prev = byStage[order[i - 1]];
    const cur = byStage[order[i]];
    if (!prev || !cur) continue;
    assert.ok(
      cur.startDateTime.getTime() >= prev.endDateTime.getTime(),
      `${order[i]} starts before ${order[i - 1]} finishes`,
    );
  }
});

test('stage boundaries land on whole seconds, with no accumulated drift', () => {
  // Start mid-lunch so the schedule begins at 13:30 and every stage crosses a
  // day boundary — the case where rounding units to 2dp and re-deriving the
  // next day's hours from the rounded value made ends drift to 12:29:51.
  const p = plan({
    startDate: new Date('2026-08-03T09:45:00.000Z'),
    stageQuantities: withTimeBasedStages({
      DESIGN: 10,
      CUTTING: 10,
      ASSEMBLY: 10,
      FINISHING: 10,
      DELIVERY: 10,
    }),
  });
  p.stages.forEach((s) => {
    assert.strictEqual(
      s.endDateTime.getTime() % 1000,
      0,
      `${s.stage} ends on a fractional second: ${local(s.endDateTime)}`,
    );
    assert.strictEqual(
      s.endDateTime.getSeconds(),
      0,
      `${s.stage} ends at a drifted time: ${local(s.endDateTime)}`,
    );
  });
});

test('units are conserved exactly across a multi-day split', () => {
  const p = buildSchedule({
    calendar: cal,
    capacityConfig: capacityConfig(7),
    stageQuantities: { DESIGN: 100 },
    startDate: MONDAY_0830,
    difficulty: 'EASY',
    settings: { contingencyDays: 0, difficultyBuffer: { EASY: 0 } },
  });
  const total = p.stages[0].allocations.reduce((s, a) => s + a.units, 0);
  assert.ok(
    Math.abs(total - 100) < 0.01,
    `allocations must sum to the requested quantity, got ${total}`,
  );
});

test('a schedule is deterministic — same input, same output', () => {
  const a = plan({ stageQuantities: { DESIGN: 23, CUTTING: 23 }, capacity: 7 });
  const b = plan({ stageQuantities: { DESIGN: 23, CUTTING: 23 }, capacity: 7 });
  assert.strictEqual(a.deliveryDate.getTime(), b.deliveryDate.getTime());
  assert.strictEqual(a.lastEnd.getTime(), b.lastEnd.getTime());
});

/* ================================================================== *
 * Manual stage moves — the "Manage Project Stages" edit path.
 *
 * These pin the three failures reported from the stage screen: an end time
 * shown past closing, an end time that ran straight through lunch, and a
 * user-picked night-time start being taken at face value.
 * ================================================================== */
const { splitWorkingMinutes } = require('../src/services/Project.service').__private;

test('manual move: a 3-hour stage starting 10:06 ends at 14:06, not 13:06', () => {
  // 07:06 UTC = 10:06 Addis, Monday. Three hours of WORK spans the 12:30-13:30
  // lunch break, so it finishes an hour later on the wall clock.
  const start = new Date('2026-08-03T07:06:00.000Z');
  const { end } = splitWorkingMinutes(cal, start, 180);

  assert.strictEqual(hourOf(end), 14.1, `expected 14:06, got ${local(end)}`);
  assert.strictEqual(dayName(end), 'Monday');
});

test('manual move: a 1h19 stage starting 16:21 rolls past the 17:00 close', () => {
  // 13:21 UTC = 16:21 Addis. Only 39 minutes remain before closing, so the
  // balance must land the NEXT working morning — never at 17:40.
  const start = new Date('2026-08-03T13:21:00.000Z');
  const { end } = splitWorkingMinutes(cal, start, 79);

  // 39 minutes fit before the close; the remaining 40 resume at 08:30 → 09:10.
  assert.ok(hourOf(end) <= 17, `must not end after the 17:00 close: ${local(end)}`);
  assert.strictEqual(dayName(end), 'Tuesday', `expected next day, got ${local(end)}`);
  assert.strictEqual(hourOf(end), 9.0 + 10 / 60, `expected 09:10, got ${local(end)}`);
});

test('manual move: a night-time start is pulled into the working window', () => {
  // 19:00 UTC = 22:00 Addis, Monday — long after closing. This is the instant a
  // user could pick in the stage dialog; it must never be persisted verbatim.
  const picked = new Date('2026-08-03T19:00:00.000Z');
  const normalized = cal.nextWorkingStart(picked);

  assert.strictEqual(hourOf(normalized), 8.5, `expected 08:30, got ${local(normalized)}`);
  assert.strictEqual(dayName(normalized), 'Tuesday');
  assert.ok(cal.isWithinWorkingHours(normalized));
});

test('manual move: every segment of a multi-day split sits inside working hours', () => {
  // 20 hours of work from Monday morning spills across three days.
  const { segments, end } = splitWorkingMinutes(cal, MONDAY_0830, 20 * 60);

  assert.ok(segments.length > 1, 'a 20-hour duration must span several days');
  for (const seg of segments) {
    assert.ok(
      cal.isWithinWorkingHours(seg.start),
      `segment starts out of hours: ${local(seg.start)}`,
    );
    assert.ok(hourOf(seg.end) <= 17, `segment ends after close: ${local(seg.end)}`);
    assert.notStrictEqual(dayName(seg.start), 'Sunday', 'Sunday is not worked');
  }
  const total = segments.reduce((s, x) => s + x.minutes, 0);
  assert.strictEqual(total, 20 * 60, 'the full duration must be allocated');
  assert.ok(hourOf(end) <= 17);
});
