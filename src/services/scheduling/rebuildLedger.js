/**
 * Capacity-ledger repair.
 *
 * THE INVARIANT (stated in reschedule.js and relied on everywhere):
 *
 *     For every (stage, day):
 *       DailyStageCapacity.usedCapacity === Σ its allocations' allocatedUnits
 *       DailyStageCapacity.usedHours    === Σ its allocations' allocatedHours
 *
 * The counters and the allocation rows are written separately, so any code path
 * that updated one without the other left the ledger drifting. The historical
 * offenders — a stage completion that decremented every allocation (including
 * days already worked) and then deleted the rows, releases with no zero floor,
 * and allocations silently dropped when their daily row was missing — are fixed
 * now, but rows written before those fixes are still wrong, and a drifted
 * counter is invisible: it simply makes the scheduler think a day is fuller (or
 * emptier) than it is, and overbooks or under-books accordingly.
 *
 * This module recomputes the counters from the allocation rows, which are the
 * ground truth: each one records what a specific project stage actually booked.
 *
 * It is deliberately conservative — it only ever rewrites the derived counters
 * and removes rows that reference something that no longer exists. It never
 * invents or deletes real allocations.
 */
const prisma = require('../prisma');

const round2 = (n) => Math.round((n || 0) * 100) / 100;

/**
 * Recompute the ledger.
 *
 * @param {object}  opts
 * @param {boolean} opts.dryRun  Report the drift without writing anything.
 * @param {object}  opts.client  Prisma client / transaction client.
 * @returns {Promise<object>} a before/after report
 */
const rebuildCapacityLedger = async ({ dryRun = false, client = prisma } = {}) => {
  const report = {
    dryRun,
    scannedDays: 0,
    correctedDays: 0,
    orphanAllocationsDeleted: 0,
    emptyDaysDeleted: 0,
    unitsDriftTotal: 0,
    hoursDriftTotal: 0,
    negativeCountersFound: 0,
    corrections: [],
  };

  // 1. Drop allocations whose ProjectStage no longer exists. A deleted stage
  //    should have released its capacity first; if it did not, these rows are
  //    phantom bookings that would otherwise be counted as real below.
  const allAllocations = await client.projectStageCapacityAllocation.findMany({
    select: {
      id: true,
      projectStageId: true,
      dailyStageCapacityId: true,
      allocatedUnits: true,
      allocatedHours: true,
    },
  });

  const stageIds = [...new Set(allAllocations.map((a) => a.projectStageId))];
  const liveStages = await client.projectStage.findMany({
    where: { id: { in: stageIds } },
    select: { id: true },
  });
  const liveStageIds = new Set(liveStages.map((s) => s.id));

  const orphanIds = allAllocations
    .filter((a) => !liveStageIds.has(a.projectStageId))
    .map((a) => a.id);

  if (orphanIds.length > 0) {
    report.orphanAllocationsDeleted = orphanIds.length;
    if (!dryRun) {
      await client.projectStageCapacityAllocation.deleteMany({
        where: { id: { in: orphanIds } },
      });
    }
  }

  const orphanIdSet = new Set(orphanIds);
  const survivingAllocations = allAllocations.filter((a) => !orphanIdSet.has(a.id));

  // 2. Sum the surviving allocations per daily-capacity row.
  const sums = new Map(); // dailyStageCapacityId -> { units, hours, count }
  for (const a of survivingAllocations) {
    const cur = sums.get(a.dailyStageCapacityId) || { units: 0, hours: 0, count: 0 };
    cur.units += a.allocatedUnits || 0;
    cur.hours += a.allocatedHours || 0;
    cur.count += 1;
    sums.set(a.dailyStageCapacityId, cur);
  }

  // 3. Compare every daily row against its allocations and correct the drift.
  const dailyRows = await client.dailyStageCapacity.findMany({
    select: {
      id: true,
      stage: true,
      date: true,
      usedCapacity: true,
      usedHours: true,
    },
    orderBy: [{ stage: 'asc' }, { date: 'asc' }],
  });

  const emptyDayIds = [];

  for (const row of dailyRows) {
    report.scannedDays += 1;
    const actual = sums.get(row.id) || { units: 0, hours: 0, count: 0 };
    const expectedUnits = round2(actual.units);
    const expectedHours = round2(actual.hours);
    const currentUnits = round2(row.usedCapacity);
    const currentHours = round2(row.usedHours);

    if (currentUnits < 0 || currentHours < 0) {
      report.negativeCountersFound += 1;
    }

    // A day with no allocations left and a zero counter carries no information.
    // Removing it keeps the table from accumulating dead rows forever.
    if (actual.count === 0 && currentUnits === 0 && currentHours === 0) {
      emptyDayIds.push(row.id);
      continue;
    }

    if (currentUnits === expectedUnits && currentHours === expectedHours) continue;

    report.correctedDays += 1;
    report.unitsDriftTotal = round2(
      report.unitsDriftTotal + (currentUnits - expectedUnits),
    );
    report.hoursDriftTotal = round2(
      report.hoursDriftTotal + (currentHours - expectedHours),
    );
    report.corrections.push({
      stage: row.stage,
      date: new Date(row.date).toISOString().slice(0, 10),
      allocations: actual.count,
      usedCapacity: { before: currentUnits, after: expectedUnits },
      usedHours: { before: currentHours, after: expectedHours },
    });

    if (!dryRun) {
      await client.dailyStageCapacity.update({
        where: { id: row.id },
        data: { usedCapacity: expectedUnits, usedHours: expectedHours },
      });
    }
  }

  if (emptyDayIds.length > 0) {
    report.emptyDaysDeleted = emptyDayIds.length;
    if (!dryRun) {
      await client.dailyStageCapacity.deleteMany({
        where: { id: { in: emptyDayIds } },
      });
    }
  }

  report.clean =
    report.correctedDays === 0 &&
    report.orphanAllocationsDeleted === 0 &&
    report.negativeCountersFound === 0;

  return report;
};

module.exports = { rebuildCapacityLedger };
