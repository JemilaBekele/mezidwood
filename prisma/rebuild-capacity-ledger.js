#!/usr/bin/env node
/**
 * Repair the capacity ledger from the command line.
 *
 *   npm run capacity:check     — report drift, change nothing
 *   npm run capacity:rebuild   — apply the corrections
 *
 * The logic lives in src/services/scheduling/rebuildLedger.js so the
 * POST /daily-stage-capacities/rebuild endpoint and this script cannot diverge.
 */
const prisma = require('../src/services/prisma');
const { rebuildCapacityLedger } = require('../src/services/scheduling/rebuildLedger');

const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--check');

const pad = (s, n) => String(s).padEnd(n);

(async () => {
  console.log(
    dryRun
      ? '\nCapacity ledger — CHECK (no changes will be written)\n'
      : '\nCapacity ledger — REBUILD\n',
  );

  const report = await rebuildCapacityLedger({ dryRun });

  if (report.corrections.length > 0) {
    console.log(
      `${pad('STAGE', 16)}${pad('DAY', 12)}${pad('ALLOCS', 8)}${pad('UNITS', 22)}HOURS`,
    );
    console.log('-'.repeat(80));
    for (const c of report.corrections) {
      const units = `${c.usedCapacity.before} -> ${c.usedCapacity.after}`;
      const hours = `${c.usedHours.before} -> ${c.usedHours.after}`;
      console.log(
        `${pad(c.stage, 16)}${pad(c.date, 12)}${pad(c.allocations, 8)}${pad(units, 22)}${hours}`,
      );
    }
    console.log('');
  }

  console.log(`  days scanned              ${report.scannedDays}`);
  console.log(`  days corrected            ${report.correctedDays}`);
  console.log(`  negative counters found   ${report.negativeCountersFound}`);
  console.log(`  orphan allocations removed ${report.orphanAllocationsDeleted}`);
  console.log(`  empty days removed        ${report.emptyDaysDeleted}`);
  console.log(`  net unit drift            ${report.unitsDriftTotal}`);
  console.log(`  net hour drift            ${report.hoursDriftTotal}`);

  if (report.clean) {
    console.log('\n  Ledger is consistent — usedCapacity matches its allocations.\n');
  } else if (dryRun) {
    console.log('\n  Drift found. Re-run with `npm run capacity:rebuild` to correct it.\n');
  } else {
    console.log('\n  Ledger repaired.\n');
  }

  await prisma.$disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error('\nCapacity ledger rebuild failed:', err.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
