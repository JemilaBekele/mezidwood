/**
 * The single source of truth for working-day / working-hour / shift date math.
 *
 * Replaces the three drifted copies of isBusinessDay / getNextBusinessDay /
 * businessDays / getNextAvailableStartTime / createExactDateTime that used to
 * live (inconsistently) inside Project.service.js and DeliveryEstimation.service.js.
 *
 * All wall-clock reasoning happens in the business timezone (config.WORKING_TIMEZONE)
 * and is returned as ordinary JS Date objects (absolute UTC instants), so callers
 * and Prisma store unambiguous timestamps.
 *
 * Usage:
 *   const cal = await getCalendar();          // loads + caches holidays once
 *   cal.isWorkingDay(date);                   // sync from here on
 *   cal.addWorkingDays(date, 5);
 *   cal.shiftBoundaries(date, 'FULL_DAY');
 */
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const prisma = require('../prisma');
const {
  WORKING_TIMEZONE,
  WORKING_DAYS,
  SHIFT_TIMES,
} = require('./config');

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = WORKING_TIMEZONE;

/* ------------------------------------------------------------------ *
 * Holiday cache
 * ------------------------------------------------------------------ */
let _cache = null; // { fixed: Set<'YYYY-MM-DD'>, recurring: Set<'MM-DD'> }

const buildHolidaySets = (holidays) => {
  const fixed = new Set();
  const recurring = new Set();
  for (const h of holidays) {
    const d = dayjs(h.date).tz(TZ);
    if (h.recurring) {
      recurring.add(d.format('MM-DD'));
    } else {
      fixed.add(d.format('YYYY-MM-DD'));
    }
  }
  return { fixed, recurring };
};

const loadHolidays = async () => {
  if (_cache) return _cache;
  let holidays = [];
  try {
    holidays = await prisma.holiday.findMany();
  } catch (err) {
    // Table may not exist yet (pre-migration) — degrade gracefully to
    // weekly-working-days-only rather than crashing the scheduler.
    // eslint-disable-next-line no-console
    console.warn('[calendar] could not load holidays, continuing without them:', err.message);
    holidays = [];
  }
  _cache = buildHolidaySets(holidays);
  return _cache;
};

const invalidateHolidayCache = () => {
  _cache = null;
};

/* ------------------------------------------------------------------ *
 * Calendar factory — binds the loaded holiday sets to sync helpers
 * ------------------------------------------------------------------ */
const makeCalendar = (sets) => {
  const isWorkingDjs = (d) => {
    if (!WORKING_DAYS[d.day()]) return false;
    if (sets.fixed.has(d.format('YYYY-MM-DD'))) return false;
    if (sets.recurring.has(d.format('MM-DD'))) return false;
    return true;
  };

  const toDjs = (date) => dayjs(date).tz(TZ);

  /** Is this calendar day a working day (weekly set AND not a holiday)? */
  const isWorkingDay = (date) => isWorkingDjs(toDjs(date));

  /** Start-of-day of the next working day strictly after `date`. */
  const nextWorkingDay = (date) => {
    let d = toDjs(date).add(1, 'day').startOf('day');
    while (!isWorkingDjs(d)) d = d.add(1, 'day');
    return d.toDate();
  };

  /**
   * Walk `n` working days from `date`, preserving the time-of-day. Positive n
   * goes forward, negative n goes backward (for back-scheduling). n = 0 returns
   * `date` unchanged. Non-working days are skipped, not counted.
   */
  const addWorkingDays = (date, n) => {
    let d = toDjs(date);
    const step = n >= 0 ? 1 : -1;
    let remaining = Math.abs(n);
    while (remaining > 0) {
      d = d.add(step, 'day');
      if (isWorkingDjs(d)) remaining -= 1;
    }
    return d.toDate();
  };

  /** Inclusive count of working days in [start, end]. */
  const workingDaysBetween = (start, end) => {
    let d = toDjs(start).startOf('day');
    const e = toDjs(end).startOf('day').valueOf();
    let count = 0;
    while (d.valueOf() <= e) {
      if (isWorkingDjs(d)) count += 1;
      d = d.add(1, 'day');
    }
    return count;
  };

  /**
   * Build an absolute timestamp at a given factory wall-clock hour
   * (decimal, e.g. 2.5 => 02:30 local) on the calendar day of `date`.
   */
  const createExactDateTime = (date, decimalHour) => {
    const hours = Math.floor(decimalHour);
    const minutes = Math.round((decimalHour % 1) * 60);
    return toDjs(date)
      .hour(hours)
      .minute(minutes)
      .second(0)
      .millisecond(0)
      .toDate();
  };

  /** Shift window for a calendar day: { startDateTime, endDateTime, totalHours }. */
  const shiftBoundaries = (date, shift) => {
    const cfg = SHIFT_TIMES[shift];
    if (!cfg) return null;
    return {
      startDateTime: createExactDateTime(date, cfg.start),
      endDateTime: createExactDateTime(date, cfg.end),
      totalHours: cfg.hours,
    };
  };

  /**
   * Given the instant a piece of work finished, return the next instant work
   * can begin: same day in the afternoon shift if it ended before the morning
   * shift closed, otherwise the start of the next working day's morning shift.
   */
  const nextAvailableStartTime = (endInstant) => {
    const end = toDjs(endInstant);
    const endDecimal = end.hour() + end.minute() / 60;
    // If work ended before the afternoon shift opens (i.e. within/at the morning
    // shift or the lunch gap), the afternoon shift is still available today.
    if (endDecimal < SHIFT_TIMES.AFTERNOON.start - 0.001) {
      return createExactDateTime(end.toDate(), SHIFT_TIMES.AFTERNOON.start);
    }
    // Otherwise roll to the next working day's morning shift.
    const next = nextWorkingDay(end.toDate());
    return createExactDateTime(next, SHIFT_TIMES.MORNING.start);
  };

  const hoursBetween = (start, end) =>
    (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60);

  /** Business-timezone calendar-day key, e.g. '2026-06-01'. */
  const dayKey = (date) => toDjs(date).format('YYYY-MM-DD');

  /** Start-of-day (business tz) as an absolute instant. */
  const startOfDay = (date) => toDjs(date).startOf('day').toDate();

  return {
    isWorkingDay,
    nextWorkingDay,
    addWorkingDays,
    workingDaysBetween,
    createExactDateTime,
    shiftBoundaries,
    nextAvailableStartTime,
    hoursBetween,
    dayKey,
    startOfDay,
  };
};

/**
 * Load (and cache) holidays, returning a calendar with synchronous helpers.
 * Call once at the start of a scheduling operation, then use synchronously.
 */
const getCalendar = async () => makeCalendar(await loadHolidays());

/**
 * Build a calendar synchronously from an explicit holiday list — used by unit
 * tests so they don't need a database.
 */
const makeCalendarFromHolidays = (holidays = []) =>
  makeCalendar(buildHolidaySets(holidays));

module.exports = {
  getCalendar,
  makeCalendarFromHolidays,
  invalidateHolidayCache,
};
