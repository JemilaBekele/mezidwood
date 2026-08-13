/**
 * Runtime, business-tunable scheduling settings.
 *
 * Two groups of settings live in the singleton `SchedulingSettings` row:
 *
 *   1. DELIVERY BUFFERS — contingency days and the difficulty percentages that
 *      turn a raw production span into a customer promise.
 *   2. WORKING TIME — which weekdays are worked, when the shift opens and
 *      closes, when lunch falls, and the business timezone. These used to be
 *      hardcoded constants, which meant the business could set
 *      `workingHoursPerDay` in the UI while the shift window stayed fixed —
 *      any value other than the window's own total scheduled work past closing.
 *      `workingHoursPerDay` is now DERIVED from the shift and lunch windows and
 *      is never accepted as independent input.
 *
 * config.js still holds the FALLBACK DEFAULTS (used when no row exists yet or
 * the DB is unreachable).
 *
 * Caching: the row is cached for CACHE_TTL_MS and invalidated explicitly on
 * write. The TTL matters because the explicit invalidation only reaches the
 * worker that handled the write — under PM2 cluster mode or multiple containers
 * the other workers would otherwise keep scheduling against stale settings
 * until restart.
 */
const prisma = require('../prisma');
const {
  DIFFICULTY_BUFFER,
  CONTINGENCY_DAYS,
  DEFAULT_WORKING_TIME,
  normalizeWorkingTime,
  parseWorkingDays,
  serializeWorkingDays,
  workingHoursOf,
} = require('./config');

const CACHE_TTL_MS = 60 * 1000;

let _cache = null;
let _cachedAt = 0;

const invalidateSettingsCache = () => {
  _cache = null;
  _cachedAt = 0;
};

/** The shape buildSchedule/applyDeliveryBuffer expect, built from a settings row. */
const normalize = (row) => ({
  contingencyDays: row.contingencyDays,
  difficultyBuffer: {
    EASY: row.easyPercent,
    MEDIUM: row.mediumPercent,
    HARD: row.hardPercent,
  },
  workingTime: normalizeWorkingTime({
    timezone: row.timezone,
    workingDays: row.workingDays,
    shiftStart: row.shiftStartHour,
    shiftEnd: row.shiftEndHour,
    lunchStart: row.lunchStartHour,
    lunchEnd: row.lunchEndHour,
  }),
});

/** The code-constant defaults, in the same normalized shape. */
const defaults = () => ({
  contingencyDays: CONTINGENCY_DAYS,
  difficultyBuffer: { ...DIFFICULTY_BUFFER },
  workingTime: normalizeWorkingTime(DEFAULT_WORKING_TIME),
});

/**
 * Load (and cache) the singleton settings row, lazily creating it with the
 * code-constant defaults if it does not exist yet. Degrades to the in-code
 * defaults if the DB/table is unavailable, so scheduling never crashes.
 */
const getSchedulingSettings = async () => {
  if (_cache && Date.now() - _cachedAt < CACHE_TTL_MS) return _cache;
  try {
    let row = await prisma.schedulingSettings.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (!row) {
      row = await prisma.schedulingSettings.create({ data: {} }); // schema defaults
    }
    _cache = normalize(row);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[settings] could not load SchedulingSettings, using defaults:',
      err.message,
    );
    _cache = defaults();
  }
  _cachedAt = Date.now();
  return _cache;
};

/** Just the working-time half — what calendar.js needs. */
const getWorkingTimeConfig = async () =>
  (await getSchedulingSettings()).workingTime;

/** Read the raw singleton row (creating it if needed) — for the settings API. */
const getSchedulingSettingsRow = async () => {
  let row = await prisma.schedulingSettings.findFirst({
    orderBy: { createdAt: 'asc' },
  });
  if (!row) row = await prisma.schedulingSettings.create({ data: {} });
  return row;
};

/**
 * Update the singleton row and invalidate the caches so changes apply at once.
 *
 * `workingHoursPerDay` is NOT writable: it is recomputed from the shift and
 * lunch windows on every save so the stored number can never contradict the
 * window the scheduler actually uses.
 */
const updateSchedulingSettings = async (data) => {
  const row = await getSchedulingSettingsRow();

  const next = { ...data };
  delete next.workingHoursPerDay; // derived, never accepted as input

  if (next.workingDays !== undefined) {
    const serialized = serializeWorkingDays(parseWorkingDays(next.workingDays));
    if (!serialized) throw new Error('At least one working day must be selected');
    next.workingDays = serialized;
  }

  // Validate the shift/lunch window as a whole (merging the incoming patch onto
  // the stored row) so a partial update cannot produce an incoherent window.
  const merged = normalizeWorkingTime({
    timezone: next.timezone !== undefined ? next.timezone : row.timezone,
    workingDays:
      next.workingDays !== undefined ? next.workingDays : row.workingDays,
    shiftStart:
      next.shiftStartHour !== undefined ? next.shiftStartHour : row.shiftStartHour,
    shiftEnd:
      next.shiftEndHour !== undefined ? next.shiftEndHour : row.shiftEndHour,
    lunchStart:
      next.lunchStartHour !== undefined ? next.lunchStartHour : row.lunchStartHour,
    lunchEnd:
      next.lunchEndHour !== undefined ? next.lunchEndHour : row.lunchEndHour,
  });

  if (merged.workingHoursPerDay <= 0) {
    throw new Error('The working day must contain at least some working time');
  }

  // Persist the NORMALIZED window, so what is stored is exactly what the
  // scheduler will use — no silent divergence between the two.
  next.shiftStartHour = merged.shiftStart;
  next.shiftEndHour = merged.shiftEnd;
  next.lunchStartHour = merged.lunchStart;
  next.lunchEndHour = merged.lunchEnd;
  next.timezone = merged.timezone;
  next.workingDays = serializeWorkingDays(merged.workingDays);
  next.workingHoursPerDay = workingHoursOf(merged);

  const updated = await prisma.schedulingSettings.update({
    where: { id: row.id },
    data: next,
  });

  invalidateSettingsCache();
  // The calendar caches the working-time config alongside the holiday sets.
  // eslint-disable-next-line global-require
  require('./calendar').invalidateHolidayCache();

  return updated;
};

module.exports = {
  getSchedulingSettings,
  getWorkingTimeConfig,
  getSchedulingSettingsRow,
  updateSchedulingSettings,
  invalidateSettingsCache,
  defaults,
};
