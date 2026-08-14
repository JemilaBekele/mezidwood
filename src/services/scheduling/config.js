/**
 * Single source of truth for all project-scheduling constants and for the
 * shape/validation of the business's working-time configuration.
 *
 * Before this module these constants were duplicated (and had drifted) across
 * Project.service.js and DeliveryEstimation.service.js — that drift was the root
 * cause of "the quoted delivery date does not match the created project" bugs.
 * Both services now import from here so estimation and project stay in lockstep.
 *
 * NOTE ON WHAT IS A CONSTANT AND WHAT IS A SETTING
 * ------------------------------------------------
 * The values below are FALLBACK DEFAULTS only. The live working time (which
 * weekdays, shift open/close, lunch window, timezone) and the delivery buffers
 * (contingency days, difficulty percentages) are read at runtime from the
 * SchedulingSettings table — see settings.js. Nothing in the scheduler reads
 * these constants directly except as a fallback when the DB is unavailable.
 */

/** Floating-point tolerance used across the scheduler (hours / units). */
const EPS = 0.001;

/* ------------------------------------------------------------------ *
 * Working-time defaults
 * ------------------------------------------------------------------ */

// Business timezone: East Africa Time (UTC+3), no DST.
// All wall-clock scheduling (shift windows, day boundaries) is computed in this
// zone, then stored as UTC. See calendar.js.
const WORKING_TIMEZONE = 'Africa/Addis_Ababa';

// Factory clock, as decimal hours in the business timezone. These match the
// workshop's actual day. Local (Ethiopian) clock times are given alongside,
// since that is how the floor reads them — Ethiopian = Gregorian - 6h:
//   08:30 open  (2:30 ጧት), 12:30-13:30 lunch (non-working), 17:30 close (11:30)
//   => 4.0h morning + 4.0h afternoon = 8.0 working hours per day
const DEFAULT_SHIFT_START = 8.5;
const DEFAULT_SHIFT_END = 17.5;
const DEFAULT_LUNCH_START = 12.5;
const DEFAULT_LUNCH_END = 13.5;

// Index = JS Date.getDay(): 0 = Sunday ... 6 = Saturday.
// Default is a 6-day week (Sunday off).
const DEFAULT_WORKING_DAYS = {
  0: false, // Sunday  - off
  1: true, // Monday
  2: true, // Tuesday
  3: true, // Wednesday
  4: true, // Thursday
  5: true, // Friday
  6: true, // Saturday
};

const DEFAULT_WORKING_TIME = {
  timezone: WORKING_TIMEZONE,
  workingDays: DEFAULT_WORKING_DAYS,
  shiftStart: DEFAULT_SHIFT_START,
  shiftEnd: DEFAULT_SHIFT_END,
  lunchStart: DEFAULT_LUNCH_START,
  lunchEnd: DEFAULT_LUNCH_END,
};

/** Derived: working hours per day implied by a working-time config. */
const workingHoursOf = ({ shiftStart, shiftEnd, lunchStart, lunchEnd }) => {
  const span = shiftEnd - shiftStart;
  const lunch = lunchEnd > lunchStart ? lunchEnd - lunchStart : 0;
  return Math.round((span - lunch) * 100) / 100;
};

const WORKING_HOURS_PER_DAY = workingHoursOf(DEFAULT_WORKING_TIME);

/** dayjs instance (or Date-like with hour()/minute()) -> decimal hour. */
const decimalHours = (d) => d.hour() + d.minute() / 60 + (d.second() || 0) / 3600;

/**
 * Accept the several shapes a working-day set can arrive in and normalize to
 * the { 0..6: boolean } map the calendar expects.
 *   - '1,2,3,4,5,6'      (the DB column format)
 *   - [1,2,3,4,5,6]
 *   - { 0:false, 1:true, ... }
 */
const parseWorkingDays = (value) => {
  if (value == null || value === '') return { ...DEFAULT_WORKING_DAYS };
  let indices = null;
  if (typeof value === 'string') {
    indices = value
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  } else if (Array.isArray(value)) {
    indices = value
      .map((n) => parseInt(n, 10))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  } else if (typeof value === 'object') {
    const map = {};
    for (let i = 0; i <= 6; i += 1) map[i] = !!value[i];
    return Object.values(map).some(Boolean) ? map : { ...DEFAULT_WORKING_DAYS };
  }
  if (!indices || indices.length === 0) return { ...DEFAULT_WORKING_DAYS };
  const map = {};
  for (let i = 0; i <= 6; i += 1) map[i] = false;
  indices.forEach((i) => {
    map[i] = true;
  });
  return map;
};

/** Serialize a working-day map back to the DB column format. */
const serializeWorkingDays = (map) =>
  Object.keys(map)
    .filter((k) => map[k])
    .map((k) => parseInt(k, 10))
    .sort((a, b) => a - b)
    .join(',');

/**
 * Validate + fill in a working-time config. Any field that is missing or
 * incoherent falls back to the default rather than producing a calendar that
 * schedules into the night — an invalid config must never widen the working
 * window.
 */
const normalizeWorkingTime = (input = {}) => {
  const num = (v, fallback) => {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return Number.isFinite(n) ? n : fallback;
  };
  let shiftStart = num(input.shiftStart, DEFAULT_SHIFT_START);
  let shiftEnd = num(input.shiftEnd, DEFAULT_SHIFT_END);
  let lunchStart = num(input.lunchStart, DEFAULT_LUNCH_START);
  let lunchEnd = num(input.lunchEnd, DEFAULT_LUNCH_END);

  if (!(shiftStart >= 0 && shiftStart < 24)) shiftStart = DEFAULT_SHIFT_START;
  if (!(shiftEnd > shiftStart && shiftEnd <= 24)) {
    shiftStart = DEFAULT_SHIFT_START;
    shiftEnd = DEFAULT_SHIFT_END;
  }
  // A lunch window outside the shift, or inverted, means "no lunch break".
  if (
    !(lunchEnd > lunchStart) ||
    lunchStart < shiftStart ||
    lunchEnd > shiftEnd
  ) {
    lunchStart = 0;
    lunchEnd = 0;
  }

  const workingDays = parseWorkingDays(input.workingDays);
  const wt = {
    timezone: input.timezone || WORKING_TIMEZONE,
    workingDays,
    shiftStart,
    shiftEnd,
    lunchStart,
    lunchEnd,
  };
  wt.workingHoursPerDay = workingHoursOf(wt);
  return wt;
};

/* ------------------------------------------------------------------ *
 * Legacy shift descriptors.
 *
 * The scheduler is segment-based and does not read these; they remain so that
 * the WorkShift enum stored on rows keeps a human meaning and so reporting code
 * can label a row. Every stage uses CUSTOM (the full working day).
 * ------------------------------------------------------------------ */
const SHIFT_TIMES = {
  MORNING: { start: DEFAULT_SHIFT_START, end: DEFAULT_LUNCH_START, hours: DEFAULT_LUNCH_START - DEFAULT_SHIFT_START },
  AFTERNOON: { start: DEFAULT_LUNCH_END, end: DEFAULT_SHIFT_END, hours: DEFAULT_SHIFT_END - DEFAULT_LUNCH_END },
  FULL_DAY: { start: DEFAULT_SHIFT_START, end: DEFAULT_SHIFT_END, hours: WORKING_HOURS_PER_DAY },
  CUSTOM: { start: DEFAULT_SHIFT_START, end: DEFAULT_SHIFT_END, hours: WORKING_HOURS_PER_DAY },
};

const SHIFT_HOURS = {
  MORNING: SHIFT_TIMES.MORNING.hours,
  AFTERNOON: SHIFT_TIMES.AFTERNOON.hours,
  FULL_DAY: SHIFT_TIMES.FULL_DAY.hours,
  CUSTOM: SHIFT_TIMES.CUSTOM.hours,
};

const DEFAULT_STAGE_SHIFT = 'CUSTOM';

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

// Kept as an export for compatibility with older consumers.
const WORKING_DAYS = DEFAULT_WORKING_DAYS;

/* ------------------------------------------------------------------ *
 * Stage classification.
 *
 * NOTE on the enum relationship: the Prisma `ProjectStatus` enum has 12
 * stages (the full workflow incl. INVOICE/PURCHASING/INSTALLATION) while
 * `CapacityStage` has only the 9 stages that consume factory capacity.
 * INVOICE/PURCHASING/INSTALLATION are intentionally NOT capacity stages —
 * they are scheduled by elapsed WORKING time, not by daily capacity. They are
 * still bound to the working calendar (they never run overnight or on a
 * holiday); they simply have no daily ceiling.
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
 * Difficulty levels: EASY = 0%, MEDIUM = 40%, HARD = 50%.
 * Used IDENTICALLY by estimation and project so a quote reproduces the
 * project created from it.
 *
 * IMPORTANT — how the buffer is applied to a date. A is an INCLUSIVE working-day
 * count of [firstStart, lastEnd], so the buffered delivery date is
 *
 *     deliveryDate = lastEnd + (B + Contingency) working days
 *
 * and NOT `firstStart + A + B + Contingency`, which double-counts the first day
 * and put every promised date exactly one working day late. See
 * engine.deliveryDateFor().
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
 *
 * Overcapacity raises the UNIT ceiling of a day; it never extends the working
 * window. Work still stops at closing time and resumes the next working day.
 * ------------------------------------------------------------------ */
const OVERCAPACITY_FACTOR = 1.25; // 125% hard ceiling on manual reschedule
const MAX_OVERCAPACITY_BAND = OVERCAPACITY_FACTOR - 1.0; // 0.25 — the extra 25%

/**
 * The number of BUFFER working days to add after production ends:
 *   ceil(A x difficulty) + contingencyDays
 * @param {number} baseWorkingDays  A — the raw schedule span in working days
 * @param {'EASY'|'MEDIUM'|'HARD'} difficulty
 * @param {{difficultyBuffer?: object, contingencyDays?: number}} [settings]
 * @returns {number} integer buffer working days
 */
const deliveryBufferDays = (baseWorkingDays, difficulty, settings = {}) => {
  const buffer = settings.difficultyBuffer || DIFFICULTY_BUFFER;
  const contingency =
    settings.contingencyDays != null ? settings.contingencyDays : CONTINGENCY_DAYS;
  const diff = buffer[difficulty] != null ? buffer[difficulty] : 0;
  return Math.ceil(baseWorkingDays * diff) + contingency;
};

/**
 * Convert a raw count of working days into the customer-promised count:
 *   A + ceil(A x difficulty) + contingencyDays.
 * This is the LENGTH of the promise, not a date offset — see the note above.
 * @returns {number} integer buffered working days
 */
const applyDeliveryBuffer = (baseWorkingDays, difficulty, settings = {}) =>
  baseWorkingDays + deliveryBufferDays(baseWorkingDays, difficulty, settings);

const VALID_DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];

/**
 * Every value the ProjectStatus enum defines — the workflow stages plus the two
 * terminal states.
 *
 * Three mutually incompatible hand-rolled status lists existed across
 * Project.service.js, none of which matched the schema: they permitted
 * PENDING/IN_PROGRESS/ON_HOLD/DELIVERED (absent from the enum) while rejecting
 * every real stage value. This is the single list to validate against.
 */
const VALID_PROJECT_STATUSES = [...WORKFLOW_ORDER, 'COMPLETED', 'CANCELLED'];

module.exports = {
  EPS,
  WORKING_TIMEZONE,
  WORKING_HOURS_PER_DAY,
  DEFAULT_WORKING_TIME,
  DEFAULT_WORKING_DAYS,
  DEFAULT_SHIFT_START,
  DEFAULT_SHIFT_END,
  DEFAULT_LUNCH_START,
  DEFAULT_LUNCH_END,
  workingHoursOf,
  decimalHours,
  parseWorkingDays,
  serializeWorkingDays,
  normalizeWorkingTime,
  SHIFT_TIMES,
  SHIFT_HOURS,
  DEFAULT_STAGE_SHIFT,
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
  deliveryBufferDays,
  applyDeliveryBuffer,
  VALID_DIFFICULTIES,
  VALID_PROJECT_STATUSES,
};
