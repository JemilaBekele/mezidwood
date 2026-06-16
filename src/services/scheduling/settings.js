/**
 * Runtime, business-tunable scheduling settings.
 *
 * The delivery formula (contingency days + difficulty percentages) and the
 * default working hours/day used to be hardcoded constants in config.js. They
 * are now backed by the singleton `SchedulingSettings` table so the business
 * can change them without a deploy. config.js still holds the FALLBACK DEFAULTS
 * (used when no row exists yet or the DB is unreachable).
 *
 * Cached like the holiday calendar — loaded once per process and invalidated
 * when the row is updated, so a saved change takes effect immediately.
 */
const prisma = require('../prisma');
const {
  DIFFICULTY_BUFFER,
  CONTINGENCY_DAYS,
  WORKING_HOURS_PER_DAY,
} = require('./config');

let _cache = null;

/** The shape buildSchedule/applyDeliveryBuffer expect, built from a settings row. */
const normalize = (row) => ({
  contingencyDays: row.contingencyDays,
  difficultyBuffer: {
    EASY: row.easyPercent,
    MEDIUM: row.mediumPercent,
    HARD: row.hardPercent,
  },
  workingHoursPerDay: row.workingHoursPerDay,
});

/** The code-constant defaults, in the same normalized shape. */
const defaults = () => ({
  contingencyDays: CONTINGENCY_DAYS,
  difficultyBuffer: { ...DIFFICULTY_BUFFER },
  workingHoursPerDay: WORKING_HOURS_PER_DAY,
});

/**
 * Load (and cache) the singleton settings row, lazily creating it with the
 * code-constant defaults if it does not exist yet. Degrades to the in-code
 * defaults if the DB/table is unavailable, so scheduling never crashes.
 */
const getSchedulingSettings = async () => {
  if (_cache) return _cache;
  try {
    let row = await prisma.schedulingSettings.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!row) {
      row = await prisma.schedulingSettings.create({ data: {} }); // schema defaults
    }
    _cache = normalize(row);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[settings] could not load SchedulingSettings, using defaults:', err.message);
    _cache = defaults();
  }
  return _cache;
};

/** Read the raw singleton row (creating it if needed) — for the settings API. */
const getSchedulingSettingsRow = async () => {
  let row = await prisma.schedulingSettings.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!row) row = await prisma.schedulingSettings.create({ data: {} });
  return row;
};

/** Update the singleton row and invalidate the cache so changes apply at once. */
const updateSchedulingSettings = async (data) => {
  const row = await getSchedulingSettingsRow();
  const updated = await prisma.schedulingSettings.update({
    where: { id: row.id },
    data,
  });
  _cache = null;
  return updated;
};

const invalidateSettingsCache = () => {
  _cache = null;
};

module.exports = {
  getSchedulingSettings,
  getSchedulingSettingsRow,
  updateSchedulingSettings,
  invalidateSettingsCache,
  defaults,
};
