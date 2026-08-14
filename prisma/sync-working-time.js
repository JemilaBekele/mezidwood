#!/usr/bin/env node
/**
 * Align the stored SchedulingSettings row with the working-time defaults in
 * services/scheduling/config.js.
 *
 * WHY THIS EXISTS: the constants in config.js are FALLBACKS — they apply only
 * when no settings row exists yet. Once the row has been created (which happens
 * on the first read), changing the constants has no effect on a running system:
 * the scheduler keeps using whatever is stored. So correcting the shift window
 * in code is not enough; the row has to be corrected too.
 *
 *   npm run workingtime:check   — show stored vs. expected, change nothing
 *   npm run workingtime:sync    — write the config defaults to the row
 *
 * NOTE: this does NOT reschedule existing projects. Stages already planned under
 * the old window keep their dates until something reschedules them.
 */
const prisma = require('../src/services/prisma');
const {
  DEFAULT_SHIFT_START,
  DEFAULT_SHIFT_END,
  DEFAULT_LUNCH_START,
  DEFAULT_LUNCH_END,
  WORKING_TIMEZONE,
  workingHoursOf,
} = require('../src/services/scheduling/config');
const {
  getSchedulingSettingsRow,
  updateSchedulingSettings,
} = require('../src/services/scheduling/settings');

const check = process.argv.includes('--check');

const hhmm = (dec) => {
  const h = Math.floor(dec);
  const m = Math.round((dec % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const hoursOf = (s) =>
  workingHoursOf({
    shiftStart: s.shiftStartHour,
    shiftEnd: s.shiftEndHour,
    lunchStart: s.lunchStartHour,
    lunchEnd: s.lunchEndHour,
  });

(async () => {
  const row = await getSchedulingSettingsRow();

  const expected = {
    shiftStartHour: DEFAULT_SHIFT_START,
    shiftEndHour: DEFAULT_SHIFT_END,
    lunchStartHour: DEFAULT_LUNCH_START,
    lunchEndHour: DEFAULT_LUNCH_END,
    timezone: WORKING_TIMEZONE,
  };

  const line = (label, cur, exp) =>
    `  ${label.padEnd(12)} ${String(cur).padEnd(20)} ${
      String(cur) === String(exp) ? '(matches)' : `-> ${exp}`
    }`;

  console.log('\nWorking time — stored vs. config defaults\n');
  console.log(line('shift', `${hhmm(row.shiftStartHour)}-${hhmm(row.shiftEndHour)}`, `${hhmm(expected.shiftStartHour)}-${hhmm(expected.shiftEndHour)}`));
  console.log(line('lunch', `${hhmm(row.lunchStartHour)}-${hhmm(row.lunchEndHour)}`, `${hhmm(expected.lunchStartHour)}-${hhmm(expected.lunchEndHour)}`));
  console.log(line('timezone', row.timezone, expected.timezone));
  console.log(line('hours/day', hoursOf(row), hoursOf({
    shiftStartHour: expected.shiftStartHour,
    shiftEndHour: expected.shiftEndHour,
    lunchStartHour: expected.lunchStartHour,
    lunchEndHour: expected.lunchEndHour,
  })));
  console.log(`  ${'workingDays'.padEnd(12)} ${row.workingDays}`);

  const inSync =
    row.shiftStartHour === expected.shiftStartHour &&
    row.shiftEndHour === expected.shiftEndHour &&
    row.lunchStartHour === expected.lunchStartHour &&
    row.lunchEndHour === expected.lunchEndHour &&
    row.timezone === expected.timezone;

  if (inSync) {
    console.log('\n  Already in sync.\n');
  } else if (check) {
    console.log('\n  Out of sync. Run `npm run workingtime:sync` to correct it.\n');
  } else {
    const updated = await updateSchedulingSettings(expected);
    console.log(
      `\n  Updated. The scheduler now uses ${hoursOf(updated)} working hours a day.`,
    );
    console.log(
      '  Existing project stages keep their current dates until rescheduled.\n',
    );
  }

  await prisma.$disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error('\nWorking-time sync failed:', err.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
