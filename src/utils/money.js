/**
 * Money helpers.
 *
 * Proforma invoice money columns are `Decimal(12,2)`, so Prisma hands back
 * Decimal.js instances rather than numbers. Those are safe under `-`, `*` and
 * `/` (JS coerces them numerically) but NOT under `+`, where `valueOf()`
 * returning a string makes `a + b` a string concatenation — silently producing
 * values like "1500500" instead of 2000.
 *
 * Every arithmetic or comparison involving a value read back from the database
 * must go through these helpers.
 */

const CENTS = 2;
// Half a cent: the tolerance below which two amounts are the same money.
const EPSILON = 0.005;

/**
 * Coerce a Decimal | number | string | null into a plain JS number.
 */
const toNumber = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  // Decimal.js and numeric strings both round-trip correctly through Number().
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

/**
 * Round to whole cents. Use before every write to a money column so stored
 * values never carry binary-floating-point residue.
 */
const round = (value) => {
  const num = toNumber(value);
  return Number(num.toFixed(CENTS));
};

/** Sum any mix of Decimal/number/string safely. */
const sum = (...values) =>
  round(values.flat().reduce((acc, value) => acc + toNumber(value), 0));

/** a - b, rounded to cents. */
const subtract = (a, b) => round(toNumber(a) - toNumber(b));

/** a * b, rounded to cents. */
const multiply = (a, b) => round(toNumber(a) * toNumber(b));

/** True when two amounts are equal to within half a cent. */
const equals = (a, b) => Math.abs(toNumber(a) - toNumber(b)) < EPSILON;

/** True when `a` is greater than `b` by at least half a cent. */
const greaterThan = (a, b) => toNumber(a) - toNumber(b) >= EPSILON;

/** True when the amount is zero or negative (within tolerance). */
const isSettled = (value) => toNumber(value) <= EPSILON;

/** True when the amount is meaningfully positive. */
const isPositive = (value) => toNumber(value) > EPSILON;

module.exports = {
  CENTS,
  EPSILON,
  toNumber,
  round,
  sum,
  subtract,
  multiply,
  equals,
  greaterThan,
  isSettled,
  isPositive,
};
