/**
 * Single source of truth for all project-scheduling constants.
 *
 * Before this module these constants were duplicated (and had drifted) across
 * Project.service.js and DeliveryEstimation.service.js — that drift was the root
 * cause of "the quoted delivery date does not match the created project" bugs.
 * Both services now import from here so estimation and project stay in lockstep.
 */

/* ------------------------------------------------------------------ *
 * Time & shift configuration
 * ------------------------------------------------------------------ */

// Business timezone. All wall-clock scheduling (shift windows, day boundaries)
// is computed in this zone, then stored as UTC. See calendar.js.
const WORKING_TIMEZONE = 'Africa/Addis_Ababa';

const WORKING_HOURS_PER_DAY = 7.5;

// Shift windows are expressed in the LOCAL FACTORY CLOCK (Ethiopian clock),
// as decimal hours: 2.5 => 2:30, 6.5 => 6:30, 11.0 => 11:00.
//   MORNING   => 2:30 - 6:30  (4.0h)
//   AFTERNOON => 7:30 - 11:00 (3.5h)
//   FULL_DAY  => 2:30 - 11:00 (7.5h, the two shifts back to back)
//   CUSTOM    => 2:30 - 11:00 (7.5h, flexible whole-day scheduling window)
const SHIFT_TIMES = {
  MORNING: { start: 2.5, end: 6.5, hours: 4.0 },
  AFTERNOON: { start: 7.5, end: 11.0, hours: 3.5 },
  FULL_DAY: { start: 2.5, end: 11.0, hours: 7.5 },
  CUSTOM: { start: 2.5, end: 11.0, hours: 7.5 },
};

const SHIFT_HOURS = {
  MORNING: SHIFT_TIMES.MORNING.hours,
  AFTERNOON: SHIFT_TIMES.AFTERNOON.hours,
  FULL_DAY: SHIFT_TIMES.FULL_DAY.hours,
  CUSTOM: SHIFT_TIMES.CUSTOM.hours,
};

const STAGE_SHIFT_PREFERENCE = {
  DESIGN: 'CUSTOM',
  METAL_WORKS: 'CUSTOM',
  CNC: 'CUSTOM',
  CUTTING: 'CUSTOM',
  EDGE_BANDING: 'CUSTOM',
  ASSEMBLY: 'CUSTOM',
  PAINTING: 'CUSTOM',
  FINISHING: 'CUSTOM',
  DELIVERY: 'CUSTOM',
  PURCHASING: 'CUSTOM',
  INSTALLATION: 'CUSTOM',
};

/* ------------------------------------------------------------------ *
 * Working-week configuration (the "which weekdays are working" half of
 * the calendar; the "which specific dates are holidays" half lives in the
 * Holiday DB table, read by calendar.js).
 *
 * Index = JS Date.getDay(): 0 = Sunday ... 6 = Saturday.
 * Default below is a 6-day week (Sunday off) which matches the dominant
 * behaviour of the legacy scheduler. Flip a day to change the work week.
 * ------------------------------------------------------------------ */
const WORKING_DAYS = {
  0: false, // Sunday  - off
  1: true, // Monday
  2: true, // Tuesday
  3: true, // Wednesday
  4: true, // Thursday
  5: true, // Friday
  6: true, // Saturday
};

/* ------------------------------------------------------------------ *
 * Stage classification.
 *
 * NOTE on the enum relationship: the Prisma `ProjectStatus` enum has 12
 * stages (the full workflow incl. INVOICE/PURCHASING/INSTALLATION) while
 * `CapacityStage` has only the 9 stages that consume factory capacity.
 * INVOICE/PURCHASING/INSTALLATION are intentionally NOT capacity stages —
 * they are scheduled by elapsed time, not by daily capacity.
 * ------------------------------------------------------------------ */
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

// INVOICE never gets a ProjectStage row of its own (it is the entry status);
// PURCHASING and INSTALLATION are time-based, not capacity-based.
const NON_CAPACITY_STAGES = ['PURCHASING', 'INSTALLATION'];

// Hours-per-unit for the time-based (non-capacity) stages.
const NON_CAPACITY_HOURS_PER_UNIT = { PURCHASING: 0.1, INSTALLATION: 0.5 };

// Full workflow order (mirrors the ProjectStatus enum).
const WORKFLOW_ORDER = [
  'INVOICE',
  'DESIGN',
  'PURCHASING',
  'METAL_WORKS',
  'CNC',
  'CUTTING',
  'EDGE_BANDING',
  'ASSEMBLY',
  'PAINTING',
  'FINISHING',
  'DELIVERY',
  'INSTALLATION',
];

/* ------------------------------------------------------------------ *
 * Delivery buffer model (Rosewood business spec).
 *
 *   FinalDays = A + B + Contingency
 *     A = capacity working-days (the raw schedule span)
 *     B = ceil(A x difficulty%)
 *     Contingency = a FIXED number of working days (not a percentage)
 *
 * Difficulty levels: 1/EASY = 0%, 2/MEDIUM = 40%, 3/HARD = 50%.
 * Used IDENTICALLY by estimation and project so a quote reproduces the
 * project created from it.
 *
 * The values below are the FALLBACK DEFAULTS. The business can override
 * them at runtime via the SchedulingSettings table (see settings.js); the
 * loaded settings are passed into applyDeliveryBuffer as the 3rd argument.
 * ------------------------------------------------------------------ */
const DIFFICULTY_BUFFER = { EASY: 0.0, MEDIUM: 0.4, HARD: 0.5 };
const CONTINGENCY_DAYS = 3;

/* ------------------------------------------------------------------ *
 * Overcapacity model.
 *
 * A MANUAL calendar reschedule may pack a stage's day up to 125% of its
 * base daily capacity (a 25% overcapacity band). This is a HARD ceiling:
 * the day total for a stage never exceeds 125% — anything that does not
 * fit overflows to the next working day. Normal auto-scheduling stays at
 * 100% (factor 1.0). The allowance applies only to stages that are NOT
 * yet completed; a COMPLETED stage's days are frozen.
 * ------------------------------------------------------------------ */
const OVERCAPACITY_FACTOR = 1.25; // 125% hard ceiling on manual reschedule
const MAX_OVERCAPACITY_BAND = OVERCAPACITY_FACTOR - 1.0; // 0.25 — the extra 25%

/**
 * Convert a raw count of working days into the customer-promised count:
 *   A + ceil(A x difficulty) + contingencyDays.
 * @param {number} baseWorkingDays  A — the raw schedule span in working days
 * @param {'EASY'|'MEDIUM'|'HARD'} difficulty
 * @param {{difficultyBuffer?: object, contingencyDays?: number}} [settings]
 *   optional runtime overrides (from SchedulingSettings); falls back to the
 *   constants above when a field is absent. Kept as a plain argument so this
 *   function stays PURE and the unit tests need no database.
 * @returns {number} integer buffered working days
 */
const applyDeliveryBuffer = (baseWorkingDays, difficulty, settings = {}) => {
  const buffer = settings.difficultyBuffer || DIFFICULTY_BUFFER;
  const contingency =
    settings.contingencyDays != null ? settings.contingencyDays : CONTINGENCY_DAYS;
  const diff = buffer[difficulty] != null ? buffer[difficulty] : 0;
  const difficultyAdjustment = Math.ceil(baseWorkingDays * diff);
  return baseWorkingDays + difficultyAdjustment + contingency;
};

const VALID_DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];

module.exports = {
  WORKING_TIMEZONE,
  WORKING_HOURS_PER_DAY,
  SHIFT_TIMES,
  SHIFT_HOURS,
  STAGE_SHIFT_PREFERENCE,
  WORKING_DAYS,
  CAPACITY_STAGES,
  NON_CAPACITY_STAGES,
  NON_CAPACITY_HOURS_PER_UNIT,
  WORKFLOW_ORDER,
  DIFFICULTY_BUFFER,
  CONTINGENCY_DAYS,
  OVERCAPACITY_FACTOR,
  MAX_OVERCAPACITY_BAND,
  applyDeliveryBuffer,
  VALID_DIFFICULTIES,
};
