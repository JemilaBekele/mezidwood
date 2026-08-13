/**
 * The single source of truth for working-day / working-hour / shift date math.
 *
 * All wall-clock reasoning happens in the business timezone and is returned as
 * ordinary JS Date objects (absolute UTC instants), so callers and Prisma store
 * unambiguous timestamps.
 *
 * THE WORKING-TIME MODEL
 * ----------------------
 * A working day is a list of SEGMENTS, not one contiguous span. With the default
 * settings a day is:
 *
 *     [ 08:30 - 12:30 ]  lunch  [ 13:30 - 17:00 ]     = 7.5 working hours
 *
 * Every duration this module hands out is measured in WORKING hours: it never
 * counts the lunch gap, never counts the night, never counts a Sunday and never
 * counts a holiday. `addWorkingHours` walks the segments; `workingHoursBetween`
 * measures across them. That is what keeps a stage from being scheduled through
 * lunch or past closing time.
 *
 * All of the shape (which weekdays, what hours, where lunch falls, which
 * timezone) comes from the SchedulingSettings row, so the business can change
 * its working time without a deploy. config.js holds only the fallback defaults.
 *
 * Usage:
 *   const cal = await getCalendar();          // loads + caches holidays/settings
 *   cal.isWorkingDay(date);                   // sync from here on
 *   cal.nextWorkingStart(date);               // first instant work may begin
 *   cal.addWorkingHours(date, 6.25);          // lunch/night/holiday aware
 */
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const prisma = require('../prisma');
const { getWorkingTimeConfig } = require('./settings');
const { EPS, decimalHours, normalizeWorkingTime } = require('./config');

dayjs.extend(utc);
dayjs.extend(timezone);

/* ------------------------------------------------------------------ *
 * Holiday cache (TTL'd — see settings.js for why a TTL and not just an
 * explicit invalidation: under PM2 cluster / multi-container the explicit
 * invalidation only reaches the worker that handled the write.)
 * ------------------------------------------------------------------ */
const CACHE_TTL_MS = 60 * 1000;

let _cache = null; // { fixed: Set<'YYYY-MM-DD'>, recurring: Set<'MM-DD'> }
let _cachedAt = 0;

const buildHolidaySets = (holidays, tz) => {
  const fixed = new Set();
  const recurring = new Set();
  for (const h of holidays) {
    // Holidays are stored as UTC-midnight day markers, so read the label in UTC
    // rather than in the business timezone (which would shift it a day).
    const d = dayjs(h.date).utc();
    if (h.recurring) {
      recurring.add(d.format('MM-DD'));
    } else {
      fixed.add(d.format('YYYY-MM-DD'));
    }
  }
  return { fixed, recurring, tz };
};

const loadHolidays = async (tz) => {
  if (_cache && Date.now() - _cachedAt < CACHE_TTL_MS) return _cache;
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
  _cache = buildHolidaySets(holidays, tz);
  _cachedAt = Date.now();
  return _cache;
};

const invalidateHolidayCache = () => {
  _cache = null;
  _cachedAt = 0;
};

/* ------------------------------------------------------------------ *
 * Calendar factory — binds holiday sets + working-time config to sync helpers
 * ------------------------------------------------------------------ */
const makeCalendar = (sets, workingTime) => {
  const wt = normalizeWorkingTime(workingTime);
  const TZ = wt.timezone;

  /** The working segments of ANY day, as decimal hours. Lunch is the gap. */
  const SEGMENTS = wt.lunchEnd > wt.lunchStart
    ? [
        { start: wt.shiftStart, end: wt.lunchStart },
        { start: wt.lunchEnd, end: wt.shiftEnd },
      ].filter((s) => s.end - s.start > EPS)
    : [{ start: wt.shiftStart, end: wt.shiftEnd }];

  const WORKING_HOURS_PER_DAY = SEGMENTS.reduce((sum, s) => sum + (s.end - s.start), 0);

  const toDjs = (date) => dayjs(date).tz(TZ);

  const isWorkingDjs = (d) => {
    if (!wt.workingDays[d.day()]) return false;
    if (sets.fixed.has(d.format('YYYY-MM-DD'))) return false;
    if (sets.recurring.has(d.format('MM-DD'))) return false;
    return true;
  };

  /** Is this calendar day a working day (weekly set AND not a holiday)? */
  const isWorkingDay = (date) => isWorkingDjs(toDjs(date));

  /**
   * Build an absolute timestamp at a given factory wall-clock hour
   * (decimal, e.g. 8.5 => 08:30 local) on the calendar day of `date`.
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

  /** Start-of-day of the next working day strictly after `date`. */
  const nextWorkingDay = (date) => {
    let d = toDjs(date).add(1, 'day').startOf('day');
    let guard = 0;
    while (!isWorkingDjs(d)) {
      d = d.add(1, 'day');
      guard += 1;
      if (guard > 3650) throw new Error('[calendar] no working day found within 10 years — check WORKING_DAYS / holidays');
    }
    return d.toDate();
  };

  /** The first working instant of a given calendar day. */
  const startOfWorkingDay = (date) => createExactDateTime(date, wt.shiftStart);

  /** The last working instant of a given calendar day. */
  const endOfWorkingDay = (date) => createExactDateTime(date, wt.shiftEnd);

  /**
   * The working segments of `date` as absolute instants.
   * Returns [] when `date` is not a working day.
   */
  const daySegments = (date) => {
    const d = toDjs(date);
    if (!isWorkingDjs(d)) return [];
    return SEGMENTS.map((s) => ({
      startDateTime: createExactDateTime(date, s.start),
      endDateTime: createExactDateTime(date, s.end),
      hours: s.end - s.start,
    }));
  };

  /**
   * WT-1 / WT-3 — the guard that keeps work inside the working window.
   *
   * Returns the first instant at or after `instant` at which work may legally
   * begin. Handles every out-of-hours case:
   *   - non-working day (weekend / holiday) -> next working day, shift start
   *   - before opening                      -> today, shift start
   *   - inside the lunch gap                -> today, lunch end
   *   - at or after closing                 -> next working day, shift start
   *   - already inside a working segment    -> unchanged (the real instant)
   */
  const nextWorkingStart = (instant) => {
    let d = toDjs(instant);
    let guard = 0;
    for (;;) {
      guard += 1;
      if (guard > 3650) throw new Error('[calendar] nextWorkingStart failed to converge');
      if (!isWorkingDjs(d)) {
        d = toDjs(nextWorkingDay(d.toDate()));
        d = toDjs(createExactDateTime(d.toDate(), wt.shiftStart));
        return d.toDate();
      }
      const dec = decimalHours(d);
      if (dec <= wt.shiftStart + EPS) return createExactDateTime(d.toDate(), wt.shiftStart);
      // Inside a segment? Return the instant untouched.
      const seg = SEGMENTS.find((s) => dec >= s.start - EPS && dec < s.end - EPS);
      if (seg) return d.toDate();
      // In a gap between segments (lunch) -> jump to the next segment's start.
      const next = SEGMENTS.find((s) => s.start > dec - EPS);
      if (next) return createExactDateTime(d.toDate(), next.start);
      // At or past closing -> next working day.
      d = toDjs(nextWorkingDay(d.toDate()));
      return createExactDateTime(d.toDate(), wt.shiftStart);
    }
  };

  /**
   * Snap an instant to the nearest whole second.
   *
   * Durations flow through the scheduler as decimal hours, and repeated
   * add/subtract of values like 7.5/1.3333 accumulates binary-float error. Left
   * unsnapped that surfaced as stage boundaries reading 12:29:51 instead of
   * 12:30:00 — cosmetically wrong on the Gantt chart, and enough to leave a
   * sub-second sliver of a day "available" so the next iteration booked a
   * zero-length allocation. Scheduling granularity is minutes; a second is a
   * safe floor.
   */
  const roundToSecond = (date) => new Date(Math.round(date.getTime() / 1000) * 1000);

  /**
   * Walk `hours` of WORKING time forward from `startInstant`, skipping lunch,
   * nights, weekends and holidays. Returns the instant work finishes.
   * Zero hours returns the normalized start.
   */
  const addWorkingHours = (startInstant, hours) => {
    let remaining = Math.max(0, hours);
    let cur = nextWorkingStart(startInstant);
    if (remaining <= EPS) return cur;
    let guard = 0;
    for (;;) {
      guard += 1;
      if (guard > 100000) throw new Error('[calendar] addWorkingHours failed to converge');
      const d = toDjs(cur);
      const dec = decimalHours(d);
      const seg = SEGMENTS.find((s) => dec >= s.start - EPS && dec < s.end - EPS);
      if (!seg) {
        cur = nextWorkingStart(cur);
        // eslint-disable-next-line no-continue
        continue;
      }
      const segRemaining = seg.end - dec;
      if (remaining <= segRemaining + EPS) {
        return roundToSecond(new Date(cur.getTime() + remaining * 3600 * 1000));
      }
      remaining -= segRemaining;
      cur = nextWorkingStart(createExactDateTime(cur, seg.end));
    }
  };

  /**
   * WORKING hours between two instants — excludes lunch, nights, weekends and
   * holidays. Negative spans return 0.
   */
  const workingHoursBetween = (start, end) => {
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (!(e > s)) return 0;
    let total = 0;
    let cursor = toDjs(start).startOf('day');
    const endDjs = toDjs(end);
    let guard = 0;
    while (cursor.valueOf() <= endDjs.valueOf()) {
      guard += 1;
      if (guard > 3650) break;
      if (isWorkingDjs(cursor)) {
        for (const seg of daySegments(cursor.toDate())) {
          const os = Math.max(s, seg.startDateTime.getTime());
          const oe = Math.min(e, seg.endDateTime.getTime());
          if (oe > os) total += (oe - os) / (1000 * 60 * 60);
        }
      }
      cursor = cursor.add(1, 'day');
    }
    // Snap to whole seconds' worth of hours so accumulated float error cannot
    // leave a sliver of a day looking "available".
    return Math.round(total * 3600) / 3600;
  };

  /** WORKING hours still available on `instant`'s day, from `instant` onward. */
  const remainingHoursInDay = (instant) => {
    const d = toDjs(instant);
    if (!isWorkingDjs(d)) return 0;
    return workingHoursBetween(instant, endOfWorkingDay(instant));
  };

  /**
   * Walk `n` working days from `date`, preserving the time-of-day. Positive n
   * goes forward, negative n goes backward (for back-scheduling). n = 0 returns
   * `date` unchanged. Non-working days are skipped, not counted.
   */
  const addWorkingDays = (date, n) => {
    let d = toDjs(date);
    const step = n >= 0 ? 1 : -1;
    let remaining = Math.abs(Math.round(n));
    let guard = 0;
    while (remaining > 0) {
      guard += 1;
      if (guard > 36500) throw new Error('[calendar] addWorkingDays failed to converge');
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
    let guard = 0;
    while (d.valueOf() <= e) {
      guard += 1;
      if (guard > 36500) break;
      if (isWorkingDjs(d)) count += 1;
      d = d.add(1, 'day');
    }
    return count;
  };

  /**
   * Shift window for a calendar day. The scheduler itself is segment-based and
   * no longer consults this; it is kept for reporting consumers that want a
   * simple open/close pair for a day.
   */
  const shiftBoundaries = (date) => ({
    startDateTime: startOfWorkingDay(date),
    endDateTime: endOfWorkingDay(date),
    totalHours: WORKING_HOURS_PER_DAY,
  });

  /** Raw wall-clock hours (NOT working hours) — kept for non-calendar math. */
  const hoursBetween = (start, end) =>
    (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60);

  /**
   * Business-timezone calendar-day key, e.g. '2026-06-01'.
   *
   * USE THIS for any arbitrary INSTANT (a completion moment, a drag target, a
   * "now"). The tempting `date.toISOString().slice(0, 10)` gives the UTC day
   * instead, which is a different day whenever the instant falls outside the
   * span where the business day and the UTC day happen to coincide — e.g. a
   * stage completed at 01:00 in Addis (UTC+3) is still "yesterday" in UTC, so a
   * release cutoff computed that way frees a day that should have stayed
   * consumed. The two only agree for positive UTC offsets during working hours,
   * which is why this went unnoticed.
   */
  const dayKey = (date) => toDjs(date).format('YYYY-MM-DD');

  /** Alias of `dayKey`, named for call sites that want the intent to be loud. */
  const businessDayKey = dayKey;

  /** Start-of-day (business tz) as an absolute instant. */
  const startOfDay = (date) => toDjs(date).startOf('day').toDate();

  /** True when `instant` falls inside a working segment of a working day. */
  const isWithinWorkingHours = (instant) => {
    const d = toDjs(instant);
    if (!isWorkingDjs(d)) return false;
    const dec = decimalHours(d);
    return SEGMENTS.some((s) => dec >= s.start - EPS && dec < s.end - EPS);
  };

  return {
    // configuration the caller may need to echo back to the UI
    workingHoursPerDay: WORKING_HOURS_PER_DAY,
    timezone: TZ,
    workingTime: wt,
    segments: SEGMENTS,

    isWorkingDay,
    isWithinWorkingHours,
    nextWorkingDay,
    nextWorkingStart,
    startOfWorkingDay,
    endOfWorkingDay,
    daySegments,
    addWorkingHours,
    workingHoursBetween,
    remainingHoursInDay,
    roundToSecond,
    addWorkingDays,
    workingDaysBetween,
    createExactDateTime,
    shiftBoundaries,
    hoursBetween,
    dayKey,
    businessDayKey,
    startOfDay,
  };
};

/**
 * Read the day label back out of a stored day MARKER.
 *
 * `DailyStageCapacity.date` and `ProjectStageCapacityAllocation.allocationDate`
 * hold a calendar day encoded as UTC midnight (see `dailyCapacityDate`). They
 * are labels, not instants, so they must be read in UTC — formatting one in the
 * business timezone would shift it to the previous day for any negative UTC
 * offset. This is the exact inverse of `dailyCapacityDate`, and deliberately
 * NOT the same operation as `businessDayKey`.
 */
const markerDayKey = (date) => new Date(date).toISOString().slice(0, 10);

/**
 * Load (and cache) holidays + working-time settings, returning a calendar with
 * synchronous helpers. Call once at the start of a scheduling operation, then
 * use synchronously.
 */
const getCalendar = async () => {
  const workingTime = await getWorkingTimeConfig();
  const sets = await loadHolidays(workingTime.timezone);
  return makeCalendar(sets, workingTime);
};

/**
 * Build a calendar synchronously from an explicit holiday list and (optionally)
 * an explicit working-time config — used by unit tests so they need no database.
 */
const makeCalendarFromHolidays = (holidays = [], workingTime = {}) => {
  const wt = normalizeWorkingTime(workingTime);
  return makeCalendar(buildHolidaySets(holidays, wt.timezone), wt);
};

module.exports = {
  getCalendar,
  makeCalendar,
  makeCalendarFromHolidays,
  invalidateHolidayCache,
  markerDayKey,
};
