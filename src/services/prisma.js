const { PrismaClient, Prisma } = require('../generated/prisma');

/**
 * Serialise Decimal columns as JSON numbers, not strings.
 *
 * Prisma returns `Decimal(12,2)` columns as Decimal instances whose default
 * `toJSON()` emits a string — so an invoice total went over the wire as
 * "134550" instead of 134550. Every currency formatter and every piece of
 * client-side arithmetic on the frontend expects a number, so the API contract
 * must not change just because the column type did.
 *
 * Precision note: these are money amounts bounded by Decimal(12,2), far inside
 * the range where a float64 is exact, so the conversion is lossless here.
 * Server-side arithmetic still goes through utils/money.js.
 */
if (Prisma && Prisma.Decimal && Prisma.Decimal.prototype) {
  // eslint-disable-next-line func-names
  Prisma.Decimal.prototype.toJSON = function () {
    return this.toNumber();
  };
}

const prisma = new PrismaClient();

module.exports = prisma;
