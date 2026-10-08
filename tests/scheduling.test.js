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

/* ------------------------------------------------------------------ *
 * The workshop's actual day, pinned here once.
 *
 *   08:30 open — 12:30 lunch — 13:30 resume — 17:30 close
 *   => 4.0h morning + 4.0h afternoon = 8.0 working hours, Mon-Sat
 *
 * On the local (Ethiopian) clock that is 2:30 ጧት to 11:30 — Ethiopian time runs
 * six hours behind the Gregorian wall clock. Timezone is East Africa Time
 * (UTC+3, no DST), so local = UTC + 3.
 *
 * Change these constants together with config.js if the shift changes.
 * ------------------------------------------------------------------ */
const OPEN = 8.5; // 08:30  (2:30 local)
const CLOSE = 17.5; // 17:30  (11:30 local)
const LUNCH_END = 13.5; // 13:30
const MORNING_HOURS = 4.0; // 08:30 -> 12:30
const HOURS_PER_DAY = 8.0;

// Monday 3 August 2026, 05:30 UTC = 08:30 Addis (start of shift).
const MONDAY_OPEN = new Date('2026-08-03T05:30:00.000Z');

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
    startDate: opts.startDate || MONDAY_OPEN,
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
  // 18:00 UTC = 21:00 Addis, Monday — well after the 17:30 close.
  const p = plan({ startDate: new Date('2026-08-03T18:00:00.000Z') });
  const first = p.stages.find((s) => s.stage === 'DESIGN').startDateTime;

  assert.strictEqual(hourOf(first), OPEN, 'must start at 08:00');
  assert.strictEqual(dayName(first), 'Tuesday', 'must roll to the next day');
  assert.ok(
    first.getTime() > new Date('2026-08-03T18:00:00.000Z').getTime(),
    'the schedule must never start before the instant it was created',
  );
});

test('WT-1: a project created before opening starts the SAME day at 08:00', () => {
  // 02:00 UTC = 05:00 Addis, Monday — before the 08:00 open.
  const p = plan({ startDate: new Date('2026-08-03T02:00:00.000Z') });
  const first = p.stages.find((s) => s.stage === 'DESIGN').startDateTime;
  assert.strictEqual(hourOf(first), OPEN);
  assert.strictEqual(dayName(first), 'Monday');
});

test('WT-1: a project created during lunch starts when lunch ends', () => {
  // 09:45 UTC = 12:45 Addis — inside the 12:30-13:30 lunch gap.
  const p = plan({ startDate: new Date('2026-08-03T09:45:00.000Z') });
  const first = p.stages.find((s) => s.stage === 'DESIGN').startDateTime;
  assert.strictEqual(hourOf(first), 13.5, 'must resume at 13:30, not 08:00');
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
  assert.strictEqual(hourOf(first), OPEN);
});

test('WT-1: a holiday is skipped like a weekend', () => {
  const withHoliday = makeCalendarFromHolidays([
    { date: new Date('2026-08-04T00:00:00.000Z'), name: 'Test', recurring: false },
  ]);
  // Tuesday the 4th is a holiday -> next working start is Wednesday the 5th.
  const next = withHoliday.nextWorkingStart(new Date('2026-08-04T05:00:00.000Z'));
  assert.strictEqual(dayName(next), 'Wednesday');
  assert.strictEqual(hourOf(next), OPEN);
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
      assert.ok(sh >= OPEN - 1e-9, `${stage.stage} starts before opening: ${local(a.startDateTime)}`);
      assert.ok(eh <= CLOSE + 1e-9, `${stage.stage} ends after closing: ${local(a.endDateTime)}`);
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
  assert.ok(hourOf(install.endDateTime) <= CLOSE + 1e-9, 'must end by closing time');
  assert.ok(cal.isWorkingDay(install.endDateTime), 'must end on a working day');

  // 100 working hours at 8.5h/day spans at least 11 working days.
  const spanDays = cal.workingDaysBetween(install.startDateTime, install.endDateTime);
  assert.ok(spanDays >= 11, `expected >= 11 working days, got ${spanDays}`);
});

test('WT-2: PURCHASING respects the calendar', () => {
  const p = plan({ stageQuantities: { DESIGN: 10, PURCHASING: 200 } });
  const purch = p.stages.find((s) => s.stage === 'PURCHASING');
  assert.ok(cal.isWorkingDay(purch.endDateTime));
  assert.ok(hourOf(purch.endDateTime) <= CLOSE + 1e-9);
});

/* ================================================================== *
 * WT-3 — the lunch break is real
 * ================================================================== */
test('WT-3: a full working day ends at 17:30, not early', () => {
  // capacity 10, quantity 10 => exactly one full day of work.
  const p = plan({ stageQuantities: { DESIGN: 10 }, capacity: 10 });
  const design = p.stages.find((s) => s.stage === 'DESIGN');
  assert.strictEqual(hourOf(design.startDateTime), OPEN);
  assert.strictEqual(
    hourOf(design.endDateTime),
    CLOSE,
    'an 8.5h day must span 08:00-17:30 across the lunch gap, ending at 17:30',
  );
});

test('WT-3: addWorkingHours skips the lunch gap', () => {
  // 08:30 + 4.5 working hours = 12:30 (4h) + 0.5h after lunch = 14:00
  // 08:30 + 4.5 working hours = 4h to 12:30, then 0.5h after lunch = 14:00.
  const end = cal.addWorkingHours(MONDAY_OPEN, 4.5);
  assert.strictEqual(hourOf(end), 14.0);

  // Exactly the morning segment lands on the lunch boundary, not past it.
  assert.strictEqual(hourOf(cal.addWorkingHours(MONDAY_OPEN, MORNING_HOURS)), 12.5);
});

test('WT-3: workingHoursBetween excludes lunch, nights and weekends', () => {
  // 08:30 Monday -> 17:00 Monday is 7.5 WORKING hours (8.5 wall-clock hours).
  const close = cal.endOfWorkingDay(MONDAY_OPEN);
  assert.strictEqual(cal.workingHoursBetween(MONDAY_OPEN, close), HOURS_PER_DAY);

  // 08:30 Monday -> 17:00 Tuesday is 15 working hours, not 32.5 wall hours.
  const tueClose = cal.endOfWorkingDay(cal.addWorkingDays(MONDAY_OPEN, 1));
  assert.strictEqual(cal.workingHoursBetween(MONDAY_OPEN, tueClose), HOURS_PER_DAY * 2);
});

test('WT-3: the working day is exactly 8.5 hours by default', () => {
  assert.strictEqual(cal.workingHoursPerDay, HOURS_PER_DAY);
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
  assert.strictEqual(wt.shiftStart, OPEN);
  assert.strictEqual(wt.shiftEnd, CLOSE);
  assert.strictEqual(wt.workingHoursPerDay, HOURS_PER_DAY);

  // A lunch window outside the shift means "no lunch", not a negative day.
  const wt2 = normalizeWorkingTime({ lunchStart: 20, lunchEnd: 21 });
  assert.strictEqual(wt2.workingHoursPerDay, CLOSE - OPEN);
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
  assert.strictEqual(hourOf(p.deliveryDate), CLOSE);
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
    startDate: MONDAY_OPEN,
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
    startDate: MONDAY_OPEN,
    difficulty: 'EASY',
    settings: { contingencyDays: 0, difficultyBuffer: { EASY: 0 } },
    overCapacityFactor: 1.25,
  });
  const allocs = p.stages[0].allocations;
  // 12 units fit in one day at 125% (ceiling 12.5)...
  assert.strictEqual(allocs.length, 1);
  assert.ok(allocs[0].units <= 12.5 + 1e-6);
  // ...but that day still ends at 17:00.
  assert.ok(hourOf(allocs[0].endDateTime) <= CLOSE + 1e-9);
});

test('FN-7: an empty plan reports a consistent zero', () => {
  const p = plan({ stageQuantities: {} });
  assert.strictEqual(p.stages.length, 0);
  assert.strictEqual(p.estimatedDays, 0);
  assert.strictEqual(p.productionWorkingDays, 0);
  assert.ok(p.deliveryDate instanceof Date);
});

test('existing usage from other projects pushes a stage to the next free day', () => {
  const monday = cal.dayKey(MONDAY_OPEN);
  const p = buildSchedule({
    calendar: cal,
    capacityConfig: capacityConfig(10),
    stageQuantities: { DESIGN: 10 },
    startDate: MONDAY_OPEN,
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
    assert.ok(hourOf(a.endDateTime) <= CLOSE + 1e-9);
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
    startDate: MONDAY_OPEN,
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

test('manual move: a stage starting near close rolls over instead of running late', () => {
  // 14:21 UTC = 17:21 Addis — only 9 minutes remain before the 17:30 close.
  const start = new Date('2026-08-03T14:21:00.000Z');
  const { end } = splitWorkingMinutes(cal, start, 79);

  // 9 minutes fit before the close; the remaining 70 resume at 08:30 → 09:40.
  assert.ok(hourOf(end) <= CLOSE, `must not end after the 17:30 close: ${local(end)}`);
  assert.strictEqual(dayName(end), 'Tuesday', `expected next day, got ${local(end)}`);
  assert.strictEqual(hourOf(end), 9.0 + 40 / 60, `expected 09:40, got ${local(end)}`);
});

test('manual move: a night-time start is pulled into the working window', () => {
  // 19:00 UTC = 22:00 Addis, Monday — long after closing. This is the instant a
  // user could pick in the stage dialog; it must never be persisted verbatim.
  const picked = new Date('2026-08-03T19:00:00.000Z');
  const normalized = cal.nextWorkingStart(picked);

  assert.strictEqual(hourOf(normalized), OPEN, `expected 08:00, got ${local(normalized)}`);
  assert.strictEqual(dayName(normalized), 'Tuesday');
  assert.ok(cal.isWithinWorkingHours(normalized));
});

test('manual move: every segment of a multi-day split sits inside working hours', () => {
  // 20 hours of work from Monday morning spills across three days.
  const { segments, end } = splitWorkingMinutes(cal, MONDAY_OPEN, 20 * 60);

  assert.ok(segments.length > 1, 'a 20-hour duration must span several days');
  for (const seg of segments) {
    assert.ok(
      cal.isWithinWorkingHours(seg.start),
      `segment starts out of hours: ${local(seg.start)}`,
    );
    assert.ok(hourOf(seg.end) <= CLOSE, `segment ends after close: ${local(seg.end)}`);
    assert.notStrictEqual(dayName(seg.start), 'Sunday', 'Sunday is not worked');
  }
  const total = segments.reduce((s, x) => s + x.minutes, 0);
  assert.strictEqual(total, 20 * 60, 'the full duration must be allocated');
  assert.ok(hourOf(end) <= CLOSE);
});

/* ================================================================== *
 * Day keys — business timezone vs UTC.
 *
 * A stored day MARKER (DailyStageCapacity.date, allocationDate) is a label
 * encoded as UTC midnight and must be read in UTC. An arbitrary INSTANT (a
 * completion moment, a drag target) must be resolved in the business timezone.
 * Conflating the two is what let a release cutoff free a day already worked.
 * ================================================================== */
const { markerDayKey } = require('../src/services/scheduling/calendar');

test('day keys: an after-midnight instant resolves to the LOCAL day, not the UTC day', () => {
  // 22:30 UTC on 3 Aug = 01:30 on 4 Aug in Addis (UTC+3).
  const instant = new Date('2026-08-03T22:30:00.000Z');

  assert.strictEqual(
    cal.businessDayKey(instant),
    '2026-08-04',
    'the business day is already the 4th in Addis',
  );
  assert.strictEqual(
    instant.toISOString().slice(0, 10),
    '2026-08-03',
    'the old UTC slice reported the 3rd — a day earlier',
  );
  assert.notStrictEqual(
    cal.businessDayKey(instant),
    instant.toISOString().slice(0, 10),
    'this divergence is exactly the bug the helper split fixes',
  );
});

test('day keys: a stored UTC-midnight marker round-trips unchanged', () => {
  const marker = new Date('2026-08-04T00:00:00.000Z');
  assert.strictEqual(markerDayKey(marker), '2026-08-04');
});

test('day keys: working-hour instants agree under both readings', () => {
  // Why this went unnoticed: during the 08:30-17:00 Addis window the business
  // day and the UTC day are always the same date.
  for (const iso of [
    '2026-08-03T05:30:00.000Z', // 08:30 Addis
    '2026-08-03T09:00:00.000Z', // 12:00 Addis
    '2026-08-03T14:00:00.000Z', // 17:00 Addis
  ]) {
    const d = new Date(iso);
    assert.strictEqual(cal.businessDayKey(d), d.toISOString().slice(0, 10));
  }
});

/* ================================================================== *
 * Compact week — window, 130% ceiling, working hours
 * ================================================================== */
const {
  compactionWindow,
  COMPACT_OVERCAPACITY_FACTOR,
} = require('../src/services/scheduling/reschedule');

// Tuesday 4 August 2026 in Addis (UTC+3).
const addis = (isoLocal) => new Date(`${isoLocal}+03:00`);

test('compact window: mid-shift starts NOW, never earlier in the week', () => {
  const now = addis('2026-08-04T10:15:00');
  const w = compactionWindow(cal, now);
  assert.strictEqual(w.floor.getTime(), now.getTime());
  assert.strictEqual(w.floorKey, '2026-08-04');
  assert.strictEqual(w.weekEndKey, '2026-08-08'); // Saturday
  assert.strictEqual(w.isEmpty, false);
});

test('compact window: after closing starts at the next opening', () => {
  const w = compactionWindow(cal, addis('2026-08-04T19:00:00'));
  assert.strictEqual(local(w.floor), '05/08/2026, 08:30:00');
});

test('compact window: during lunch starts when lunch ends', () => {
  const w = compactionWindow(cal, addis('2026-08-04T12:45:00'));
  assert.strictEqual(hourOf(w.floor), LUNCH_END);
});

test('compact window: Saturday after closing leaves nothing to compact', () => {
  const w = compactionWindow(cal, addis('2026-08-08T19:00:00'));
  assert.strictEqual(w.isEmpty, true);
});

test('compact window: on Sunday it compacts the coming week from Monday', () => {
  const w = compactionWindow(cal, addis('2026-08-09T10:00:00'));
  assert.strictEqual(local(w.floor), '10/08/2026, 08:30:00');
  assert.strictEqual(w.weekEndKey, '2026-08-15');
  assert.strictEqual(w.isEmpty, false);
});

test('compact fill: the 130% ceiling holds, counting existing bookings', () => {
  assert.strictEqual(COMPACT_OVERCAPACITY_FACTOR, 1.3);
  const monday = cal.dayKey(MONDAY_OPEN);
  const p = buildSchedule({
    calendar: cal,
    capacityConfig: capacityConfig(10),
    stageQuantities: { DESIGN: 20 },
    startDate: MONDAY_OPEN,
    settings: { contingencyDays: 0, difficultyBuffer: { EASY: 0 } },
    existingUsage: { usage: { [`DESIGN|${monday}`]: 8 } },
    overCapacityFactor: COMPACT_OVERCAPACITY_FACTOR,
    fillByUnits: true,
  });
  const perDay = {};
  p.stages[0].allocations.forEach((a) => {
    perDay[a.date] = (perDay[a.date] || 0) + a.units;
  });
  // Monday already had 8: only 5 more fit under the 13-unit (130%) ceiling.
  assert.ok(
    Math.abs(perDay[monday] - 5) < 0.01,
    `Monday got ${perDay[monday]}`,
  );
  Object.entries(perDay).forEach(([date, units]) => {
    const existing = date === monday ? 8 : 0;
    assert.ok(
      existing + units <= 13 + 1e-6,
      `${date}: ${existing + units} > 130%`,
    );
  });
});

test('compact fill: a day with free units is used even if a booking runs to closing', () => {
  const monday = cal.dayKey(MONDAY_OPEN);
  const busy = {
    usage: { [`DESIGN|${monday}`]: 4 },
    busyUntil: { [`DESIGN|${monday}`]: cal.endOfWorkingDay(MONDAY_OPEN) },
  };
  const base = {
    calendar: cal,
    capacityConfig: capacityConfig(10),
    stageQuantities: { DESIGN: 5 },
    startDate: MONDAY_OPEN,
    settings: { contingencyDays: 0, difficultyBuffer: { EASY: 0 } },
    existingUsage: busy,
    overCapacityFactor: COMPACT_OVERCAPACITY_FACTOR,
  };
  // Normal scheduling queues behind the booking and loses Monday...
  assert.notStrictEqual(
    buildSchedule(base).stages[0].allocations[0].date,
    monday,
  );
  // ...compaction measures room in units and books Monday.
  const p = buildSchedule({ ...base, fillByUnits: true });
  assert.strictEqual(p.stages[0].allocations[0].date, monday);
});

test('compact fill: every booking stays inside working hours', () => {
  const p = buildSchedule({
    calendar: cal,
    capacityConfig: capacityConfig(10),
    stageQuantities: { DESIGN: 40, CUTTING: 40, ASSEMBLY: 40 },
    startDate: addis('2026-08-04T15:40:00'),
    settings: { contingencyDays: 0, difficultyBuffer: { EASY: 0 } },
    overCapacityFactor: COMPACT_OVERCAPACITY_FACTOR,
    fillByUnits: true,
  });
  p.stages.forEach((s) =>
    s.allocations.forEach((a) => {
      assert.ok(
        cal.isWithinWorkingHours(a.startDateTime),
        `${s.stage} starts ${local(a.startDateTime)}`,
      );
      assert.ok(
        hourOf(a.endDateTime) <= CLOSE + 1e-9,
        `${s.stage} ends ${local(a.endDateTime)}`,
      );
      assert.ok(
        !(
          hourOf(a.startDateTime) >= 12.5 && hourOf(a.startDateTime) < LUNCH_END
        ),
        'starts in lunch',
      );
    }),
  );
});

test('compact fill: a half-gone day only takes the units its remaining hours allow', () => {
  // Monday 13:30: 4.0 of the 8.0 working hours are left. Capacity 10/day at
  // 130% => 13/day, so at most 6.5 units fit in the remaining half day.
  const halfDay = addis('2026-08-03T13:30:00');
  const monday = cal.dayKey(halfDay);
  const p = buildSchedule({
    calendar: cal,
    capacityConfig: capacityConfig(10),
    stageQuantities: { DESIGN: 20 },
    startDate: halfDay,
    settings: { contingencyDays: 0, difficultyBuffer: { EASY: 0 } },
    existingUsage: {
      usage: { [`DESIGN|${monday}`]: 2 },
      usageFrom: { [`DESIGN|${monday}`]: 2 },
    },
    overCapacityFactor: COMPACT_OVERCAPACITY_FACTOR,
    fillByUnits: true,
  });
  const mondayUnits = p.stages[0].allocations
    .filter((a) => a.date === monday)
    .reduce((s, a) => s + a.units, 0);
  // 6.5 for the half day, minus the 2 already booked in that afternoon.
  assert.ok(Math.abs(mondayUnits - 4.5) < 0.01, `Monday got ${mondayUnits}`);
});

test('compact fill: on the day of "now", all bookings share only the hours left', () => {
  // Monday 16:30 with 08:30-17:30 days: 1.0h left. Capacity 8/day at 130%
  // => 1.3 units/hour, so the rest of Monday holds 1.3 units however many
  // plans start inside it.
  const now = addis('2026-08-03T16:30:00');
  const monday = cal.dayKey(now);
  const run = (start, usage) =>
    buildSchedule({
      calendar: cal,
      capacityConfig: capacityConfig(8),
      stageQuantities: { DESIGN: 5 },
      startDate: start,
      settings: { contingencyDays: 0, difficultyBuffer: { EASY: 0 } },
      existingUsage: usage,
      overCapacityFactor: COMPACT_OVERCAPACITY_FACTOR,
      fillByUnits: true,
      notBefore: now,
    }).stages[0].allocations.filter((a) => a.date === monday);
  // A first plan from 16:30 already booked 1.0 unit (16:30-17:16).
  const key = `DESIGN|${monday}`;
  const usage = {
    usage: { [key]: 1.0 },
    usageFrom: { [key]: 0 },
    usageFloor: { [key]: 1.0 },
  };
  // A second plan starting at 17:00 is told nothing is booked in ITS window,
  // but the day since "now" only has 0.3 units left.
  const later = run(addis('2026-08-03T17:00:00'), usage);
  const units = later.reduce((t, a) => t + a.units, 0);
  assert.ok(units <= 0.3 + 0.01, `Monday got ${units} more units`);
  // Without the "now" floor the same plan would take its whole half hour (0.65).
  const unfloored = buildSchedule({
    calendar: cal,
    capacityConfig: capacityConfig(8),
    stageQuantities: { DESIGN: 5 },
    startDate: addis('2026-08-03T17:00:00'),
    settings: { contingencyDays: 0, difficultyBuffer: { EASY: 0 } },
    existingUsage: usage,
    overCapacityFactor: COMPACT_OVERCAPACITY_FACTOR,
    fillByUnits: true,
  }).stages[0].allocations.filter((a) => a.date === monday);
  assert.ok(unfloored.reduce((t, a) => t + a.units, 0) > 0.3 + 0.01);
});

test('compact fill: endBy is a hard stop — nothing is placed at or after it', () => {
  // Capacity 10/day at 130% => 13/day. 50 units from Thursday with a stop at
  // next Monday's opening: Thu+Fri+Sat hold 39, the other 11 stay unplaced.
  const thursday = addis('2026-08-06T08:30:00');
  const nextMonday = addis('2026-08-10T08:30:00');
  const p = buildSchedule({
    calendar: cal,
    capacityConfig: capacityConfig(10),
    stageQuantities: { DESIGN: 50 },
    startDate: thursday,
    settings: { contingencyDays: 0, difficultyBuffer: { EASY: 0 } },
    overCapacityFactor: COMPACT_OVERCAPACITY_FACTOR,
    fillByUnits: true,
    endBy: nextMonday,
  });
  const allocs = p.stages[0].allocations;
  allocs.forEach((a) => {
    assert.ok(a.date < '2026-08-10', `booked on ${a.date}`);
  });
  const placed = allocs.reduce((t, a) => t + a.units, 0);
  assert.ok(Math.abs(placed - 39) < 0.01, `placed ${placed}`);
});

test('compact window: the overflow window is the earlier days of this week', () => {
  const w = compactionWindow(cal, addis('2026-08-05T10:00:00')); // Wednesday
  assert.strictEqual(local(w.weekStart), '03/08/2026, 08:30:00'); // Monday
  assert.strictEqual(local(w.pastEnd), '05/08/2026, 08:30:00'); // today's opening
  const first = compactionWindow(cal, addis('2026-08-03T10:00:00')); // Monday
  assert.strictEqual(first.weekStart.getTime(), first.pastEnd.getTime()); // none
});

/* ------------------------------------------------------------------ *
 * fillGaps (calendar reschedule): a team booked only late in the day is
 * free in the morning — a moved stage must use that time, not queue
 * behind the latest booking's end.
 * ------------------------------------------------------------------ */
test('fill gaps: a late booking does not block the free morning', () => {
  const monday = cal.dayKey(MONDAY_OPEN);
  const key = `ASSEMBLY|${monday}`;
  const existingUsage = {
    usage: { [key]: 2 },
    busyUntil: { [key]: addis('2026-08-03T17:30:00') },
    busyIntervals: {
      [key]: [{ start: addis('2026-08-03T15:30:00'), end: addis('2026-08-03T17:30:00') }],
    },
  };
  const opts = {
    calendar: cal,
    capacityConfig: capacityConfig(10),
    stageQuantities: { ASSEMBLY: 4 },
    startDate: MONDAY_OPEN,
    settings: { contingencyDays: 0, difficultyBuffer: { EASY: 0 } },
    existingUsage,
  };
  // Old behaviour: queued behind the 17:30 end => Tuesday.
  const queued = buildSchedule(opts);
  assert.notStrictEqual(queued.stages[0].allocations[0].date, monday);

  const p = buildSchedule({ ...opts, fillGaps: true });
  const a = p.stages[0].allocations;
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].date, monday);
  assert.strictEqual(local(a[0].startDateTime), '03/08/2026, 08:30:00');
  assert.ok(a[0].endDateTime.getTime() <= addis('2026-08-03T15:30:00').getTime());
});

test('fill gaps: work wraps around a booking and respects the unit ceiling', () => {
  const monday = cal.dayKey(MONDAY_OPEN);
  const key = `ASSEMBLY|${monday}`;
  const busyStart = addis('2026-08-03T13:30:00');
  const busyEnd = addis('2026-08-03T15:30:00');
  const p = buildSchedule({
    calendar: cal,
    capacityConfig: capacityConfig(10),
    stageQuantities: { ASSEMBLY: 12 },
    startDate: MONDAY_OPEN,
    settings: { contingencyDays: 0, difficultyBuffer: { EASY: 0 } },
    existingUsage: {
      usage: { [key]: 2.5 },
      busyIntervals: { [key]: [{ start: busyStart, end: busyEnd }] },
    },
    fillGaps: true,
  });
  const allocs = p.stages[0].allocations;
  const mondayAllocs = allocs.filter((a) => a.date === monday);
  // No piece overlaps the existing booking.
  mondayAllocs.forEach((a) => {
    const overlaps = a.startDateTime < busyEnd && a.endDateTime > busyStart;
    assert.ok(!overlaps, `overlaps booking: ${local(a.startDateTime)}-${local(a.endDateTime)}`);
  });
  // Monday holds at most the 7.5 units left under the 10/day ceiling.
  const mondayUnits = mondayAllocs.reduce((s, a) => s + a.units, 0);
  assert.ok(mondayUnits <= 7.5 + 0.01, `Monday got ${mondayUnits}`);
  assert.ok(mondayUnits >= 7.5 - 0.01, `Monday got ${mondayUnits}`);
  // The rest spills to the next working day.
  const total = allocs.reduce((s, a) => s + a.units, 0);
  assert.ok(Math.abs(total - 12) < 0.01);
});

test('fill gaps on create: free hours are used and the phase sequence holds', () => {
  const monday = cal.dayKey(MONDAY_OPEN);
  const key = `DESIGN|${monday}`;
  const busyStart = addis('2026-08-03T15:30:00');
  const busyEnd = addis('2026-08-03T17:30:00');
  const p = buildSchedule({
    calendar: cal,
    capacityConfig: capacityConfig(10),
    stageQuantities: {
      DESIGN: 4, METAL_WORKS: 7, CNC: 14, CUTTING: 20, EDGE_BANDING: 20,
      ASSEMBLY: 10, PAINTING: 4, FINISHING: 10, DELIVERY: 10,
    },
    startDate: MONDAY_OPEN,
    settings: { contingencyDays: 0, difficultyBuffer: { EASY: 0 } },
    existingUsage: {
      usage: { [key]: 2 },
      busyIntervals: { [key]: [{ start: busyStart, end: busyEnd }] },
    },
    fillGaps: true,
  });
  const by = Object.fromEntries(p.stages.map((s) => [s.stage, s]));
  // DESIGN uses Monday's free morning instead of waiting for Tuesday.
  assert.strictEqual(local(by.DESIGN.startDateTime), '03/08/2026, 08:30:00');
  by.DESIGN.allocations.forEach((a) => {
    assert.ok(!(a.startDateTime < busyEnd && a.endDateTime > busyStart));
  });
  // Every phase starts only after the previous phase's longest stage ends.
  const phases = [
    ['DESIGN'], ['METAL_WORKS', 'CNC'], ['CUTTING', 'EDGE_BANDING'],
    ['ASSEMBLY', 'PAINTING'], ['FINISHING'], ['DELIVERY'],
  ];
  for (let i = 1; i < phases.length; i += 1) {
    const prevEnd = Math.max(...phases[i - 1].map((s) => by[s].endDateTime.getTime()));
    phases[i].forEach((s) => {
      assert.ok(by[s].startDateTime.getTime() >= prevEnd, `${s} starts before phase ${i - 1} ends`);
    });
  }
  // Every stage got all of its work.
  p.stages.filter((s) => s.allocations.length).forEach((s) => {
    assert.ok(Math.abs(s.actualWorkUnits - s.workUnits) < 0.01, `${s.stage} short`);
  });
});
