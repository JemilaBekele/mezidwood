/**
 * Unified scheduling engine — the SINGLE allocator used by both
 * Project.service (createProject) and DeliveryEstimation.service.
 */
const prisma = require('../prisma');
const { getCalendar } = require('./calendar');
const { getSchedulingSettings } = require('./settings');
const {
  WORKING_HOURS_PER_DAY,
  SHIFT_HOURS,
  SHIFT_TIMES,
  STAGE_SHIFT_PREFERENCE,
  CAPACITY_STAGES,
  NON_CAPACITY_STAGES,
  NON_CAPACITY_HOURS_PER_UNIT,
  DIFFICULTY_BUFFER,
  CONTINGENCY_DAYS,
} = require('./config');

const MORNING_START = SHIFT_TIMES.FULL_DAY.start;

const EPS = 0.001;
const round2 = (n) => Math.round(n * 100) / 100;
const usageKey = (stage, dateKey) => `${stage}|${dateKey}`;
const maxDate = (a, b) => (a.getTime() > b.getTime() ? a : b);
const isValidDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());
const stageShiftHours = (shift, workingHoursPerDay) =>
  shift === 'CUSTOM'
    ? workingHoursPerDay
    : SHIFT_HOURS[shift] || workingHoursPerDay;

const dailyCapacityDate = (dateKey) => new Date(`${dateKey}T00:00:00.000Z`);
const rememberBusyUntil = (busyUntil, key, endDateTime) => {
  const end = new Date(endDateTime);
  if (!isValidDate(end)) return;
  const prev = busyUntil[key];
  if (!prev || end.getTime() > prev.getTime()) busyUntil[key] = end;
};

const computeStageQuantities = (materials) => {
  const m = {
    laminatedMDF: materials.laminatedMDF || 0,
    plainMDF: materials.plainMDF || 0,
    wood: materials.wood || 0,
    metal: materials.metal || 0,
    other: materials.other || 0,
  };
  const total = m.laminatedMDF + m.plainMDF + m.wood + m.metal + m.other;
  const panelTotal = total - m.metal;

  return {
    DESIGN: total,
    METAL_WORKS: m.metal,
    CNC: 0,
    CUTTING: panelTotal,
    EDGE_BANDING: m.laminatedMDF,
    ASSEMBLY: panelTotal,
    PAINTING: m.plainMDF + m.wood + m.metal,
    FINISHING: total,
    DELIVERY: total,
    INSTALLATION: total,
    PURCHASING: total,
  };
};

const PHASES = [
  ['DESIGN'],
  ['METAL_WORKS', 'CNC'],
  ['CUTTING', 'EDGE_BANDING'],
  ['ASSEMBLY', 'PAINTING'],
  ['FINISHING'],
  ['DELIVERY'],
  ['INSTALLATION'],
];

/**
 * Helper to check if a date exceeds the rebuild boundary
 */
const isBeyondBoundary = (date, boundary) => {
  if (!boundary) return false;
  const boundaryDate = new Date(boundary);
  boundaryDate.setHours(23, 59, 59, 999);
  return date.getTime() > boundaryDate.getTime();
};

/**
 * Helper to cap a date at boundary
 */
const capAtBoundary = (date, boundary) => {
  if (!boundary) return date;
  const boundaryDate = new Date(boundary);
  boundaryDate.setHours(23, 59, 59, 999);
  if (date.getTime() > boundaryDate.getTime()) {
    return boundaryDate;
  }
  return date;
};

/**
 * Calculate days remaining in week to adjust overcapacity
 */
const getDaysRemainingInWeek = (currentDate, boundary) => {
  if (!boundary) return 7;
  const boundaryDate = new Date(boundary);
  boundaryDate.setHours(0, 0, 0, 0);
  const current = new Date(currentDate);
  current.setHours(0, 0, 0, 0);
  const diffTime = boundaryDate.getTime() - current.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(1, diffDays);
};

/**
 * Allocate one stage across consecutive working days with AGGRESSIVE overcapacity
 * to prevent pushing work to next week.
 */
/**
 * Allocate one stage with STRICT boundary enforcement - NO work beyond rebuildBoundary
 */
const allocateStage = (cal, stage, quantity, startInstant, ctx) => {
  console.log(`\n📊 allocateStage START: ${stage}`);
  console.log(`   quantity: ${quantity}`);
  console.log(`   startInstant: ${startInstant.toISOString().slice(0, 10)}`);
  
  if (ctx.rebuildBoundary) {
    console.log(`   🚧 HARD BOUNDARY: ${ctx.rebuildBoundary.toISOString().slice(0, 10)}`);
    console.log(`   ⚠️  NO work will be scheduled on or after this date`);
  }

  if (quantity <= EPS) {
    console.log(`   ⏭️ quantity <= EPS, skipping`);
    return null;
  }

  // EARLY CHECK: If start is already beyond boundary, return null immediately
  if (ctx.rebuildBoundary && isBeyondBoundary(startInstant, ctx.rebuildBoundary)) {
    console.log(`   ❌ Start date ${startInstant.toISOString().slice(0, 10)} is beyond boundary - SKIPPING ${stage} entirely`);
    return null;
  }

  // Time-based (non-capacity) stages
  if (NON_CAPACITY_STAGES.includes(stage)) {
    console.log(`   ⏱️ ${stage} is NON-CAPACITY stage`);
    const hours = quantity * (NON_CAPACITY_HOURS_PER_UNIT[stage] || 0.5);
    const start = new Date(startInstant);
    let end = new Date(start.getTime() + hours * 3600 * 1000);

    if (ctx.rebuildBoundary) {
      // Check if end exceeds boundary
      if (isBeyondBoundary(end, ctx.rebuildBoundary)) {
        // Calculate how much work can fit before boundary
        const availableHours = Math.max(0, cal.hoursBetween(start, ctx.rebuildBoundary));
        const maxUnits = availableHours / (NON_CAPACITY_HOURS_PER_UNIT[stage] || 0.5);
        
        if (maxUnits <= EPS) {
          console.log(`   ❌ No time available before boundary - SKIPPING ${stage}`);
          return null;
        }
        
        const partialQuantity = Math.min(quantity, maxUnits);
        const partialHours = partialQuantity * (NON_CAPACITY_HOURS_PER_UNIT[stage] || 0.5);
        end = capAtBoundary(end, ctx.rebuildBoundary);
        
        console.log(`   ⚠️ Can only schedule ${partialQuantity.toFixed(2)}/${quantity.toFixed(2)} units before boundary`);
        console.log(`   ⚠️ Remaining ${(quantity - partialQuantity).toFixed(2)} units will NOT be scheduled`);
        
        return {
          stage,
          workUnits: quantity,
          actualWorkUnits: partialQuantity,  // Partial completion
          startDateTime: start,
          endDateTime: end,
          capacityDays: 1,
          shift: 'CUSTOM',
          timeTaken: Math.round(partialHours * 60),
          allocations: [],
          customStartTime: start,
          customEndTime: end,
        };
      }
    }

    return {
      stage,
      workUnits: quantity,
      actualWorkUnits: quantity,
      startDateTime: start,
      endDateTime: end,
      capacityDays: 1,
      shift: 'CUSTOM',
      timeTaken: Math.round(hours * 60),
      allocations: [],
      customStartTime: start,
      customEndTime: end,
    };
  }

  // CAPACITY STAGES - STRICT BOUNDARY ENFORCEMENT
  
  const cfg = ctx.capacityConfig[stage] || { capacity: 1 };
  const capacity = cfg.capacity || 1;
  const slots = cfg.parallelSlots || 1;
  const shift = STAGE_SHIFT_PREFERENCE[stage] || 'FULL_DAY';
  const whpd = ctx.workingHoursPerDay || WORKING_HOURS_PER_DAY;
  const shiftHours = stageShiftHours(shift, whpd);
  const baseDailyMax = capacity * (shiftHours / whpd) * slots;
  
  // Calculate maximum possible units before boundary
  let maxPossibleUnits = 0;
  let tempDate = new Date(startInstant);
  let daysChecked = 0;
  const MAX_DAYS_CHECK = 30;
  
  while (daysChecked < MAX_DAYS_CHECK && !isBeyondBoundary(tempDate, ctx.rebuildBoundary)) {
    if (cal.isWorkingDay(tempDate)) {
      const dailyMax = baseDailyMax * (ctx.overCapacityFactor || 1.25);
      maxPossibleUnits += dailyMax;
    }
    tempDate = cal.nextWorkingDay(tempDate);
    daysChecked++;
  }
  
  console.log(`   📊 Maximum possible units before boundary: ${maxPossibleUnits.toFixed(2)}`);
  
  if (maxPossibleUnits < quantity - EPS) {
    console.log(`   ❌ Cannot schedule all ${quantity} units before boundary`);
    console.log(`   📉 Only ${maxPossibleUnits.toFixed(2)} units max can fit`);
    
    // Calculate what percentage can be scheduled
    const scheduledQuantity = Math.min(quantity, maxPossibleUnits);
    const percentage = (scheduledQuantity / quantity * 100).toFixed(1);
    
    console.log(`   ⚠️ Will schedule ${scheduledQuantity.toFixed(2)}/${quantity.toFixed(2)} units (${percentage}%)`);
    
    // Update quantity to what can actually fit
    quantity = scheduledQuantity;
    
    if (quantity <= EPS) {
      console.log(`   ❌ No units can fit - SKIPPING ${stage}`);
      return null;
    }
  }

  // Continue with normal allocation using the potentially reduced quantity
  const effectiveOverCap = ctx.overCapacityFactor || 1.25;
  const dailyMaxUnits = baseDailyMax * effectiveOverCap;
  const unitsPerHour = (capacity * slots) / whpd;
  
  let remaining = quantity;
  let cur = new Date(startInstant);
  const allocations = [];
  let guard = 0;
  const GUARD_MAX = 100000;
  let dayCount = 0;
  let workStarted = false;

  while (remaining > EPS) {
    guard += 1;
    dayCount++;

    if (guard > GUARD_MAX) {
      throw new Error(`Scheduler failed to converge for ${stage}`);
    }

    // HARD STOP at boundary - NO work beyond this date
    if (ctx.rebuildBoundary && isBeyondBoundary(cur, ctx.rebuildBoundary)) {
      console.log(`   🛑 HARD STOP: Reached boundary at ${cur.toISOString().slice(0, 10)}`);
      console.log(`   ✅ Scheduled ${(quantity - remaining).toFixed(2)}/${quantity.toFixed(2)} units`);
      break;
    }

    if (!cal.isWorkingDay(cur)) {
      cur = cal.nextWorkingDay(cur);
      continue;
    }

    const dateKey = cal.dayKey(cur);
    const sb = cal.shiftBoundaries(cur, shift);
    const isTransitionDay = !workStarted && dateKey === cal.dayKey(startInstant);
    const dayStart = isTransitionDay 
      ? maxDate(new Date(startInstant), sb.startDateTime) 
      : sb.startDateTime;

    if (ctx.rebuildBoundary && isBeyondBoundary(dayStart, ctx.rebuildBoundary)) {
      cur = cal.nextWorkingDay(cur);
      continue;
    }

    let startDT = ctx.busyUntil[usageKey(stage, dateKey)]
      ? maxDate(dayStart, ctx.busyUntil[usageKey(stage, dateKey)])
      : dayStart;

    if (ctx.rebuildBoundary && isBeyondBoundary(startDT, ctx.rebuildBoundary)) {
      cur = cal.nextWorkingDay(cur);
      continue;
    }

    const consumedWindowHours = Math.max(0, cal.hoursBetween(sb.startDateTime, startDT));
    const effShiftHours = shiftHours * effectiveOverCap;

    if (consumedWindowHours >= effShiftHours - EPS) {
      cur = cal.nextWorkingDay(cur);
      continue;
    }

    const availableWindowHours = effShiftHours - consumedWindowHours;
    const availableWindowUnits = availableWindowHours * unitsPerHour;

    if (availableWindowUnits <= EPS) {
      cur = cal.nextWorkingDay(cur);
      continue;
    }

    const used = ctx.usage[usageKey(stage, dateKey)] || 0;
    let available = Math.min(Math.max(0, dailyMaxUnits - used), availableWindowUnits);

    // Check if this is the last possible day before boundary
    const nextDay = cal.nextWorkingDay(cur);
    const isLastPossibleDay = ctx.rebuildBoundary && 
      (isBeyondBoundary(nextDay, ctx.rebuildBoundary) || 
       nextDay.toISOString().slice(0, 10) === ctx.rebuildBoundary.toISOString().slice(0, 10));

    if (isLastPossibleDay) {
      // On last possible day, use MAXIMUM capacity
      const emergencyMax = dailyMaxUnits * 2.0;
      available = Math.min(Math.max(0, emergencyMax - used), availableWindowUnits);
      console.log(`   🚨 LAST POSSIBLE DAY - EMERGENCY OVERCAPACITY: ${available.toFixed(2)} units available`);
    }

    if (available <= EPS) {
      cur = cal.nextWorkingDay(cur);
      continue;
    }

    let assign = Math.min(remaining, available);
    let workHours = assign / unitsPerHour;
    let endDT = new Date(startDT.getTime() + workHours * 3600 * 1000);

    // Ensure we don't exceed boundary
    if (ctx.rebuildBoundary && isBeyondBoundary(endDT, ctx.rebuildBoundary)) {
      const maxHoursAllowed = Math.max(0, cal.hoursBetween(startDT, ctx.rebuildBoundary));
      const maxUnitsAllowed = maxHoursAllowed * unitsPerHour;
      
      if (maxUnitsAllowed > EPS) {
        assign = Math.min(assign, maxUnitsAllowed);
        workHours = assign / unitsPerHour;
        endDT = capAtBoundary(endDT, ctx.rebuildBoundary);
      } else {
        console.log(`   ⏭️ No capacity available to fit before boundary`);
        break;
      }
    }

    allocations.push({
      date: dateKey,
      startDateTime: startDT,
      endDateTime: endDT,
      units: round2(assign),
      hours: round2(workHours),
      shift,
    });
    
    ctx.usage[usageKey(stage, dateKey)] = used + assign;
    ctx.deltas[usageKey(stage, dateKey)] = (ctx.deltas[usageKey(stage, dateKey)] || 0) + assign;
    rememberBusyUntil(ctx.busyUntil, usageKey(stage, dateKey), endDT);

    remaining = round2(remaining - assign);
    workStarted = true;

    if (remaining > EPS) {
      cur = cal.nextWorkingDay(cur);
    }
  }

  if (allocations.length === 0) {
    console.log(`   ❌ No allocations created for ${stage}`);
    return null;
  }

  const totalHours = allocations.reduce((s, a) => s + a.hours, 0);
  const scheduledUnits = round2(allocations.reduce((s, a) => s + a.units, 0));
  
  const result = {
    stage,
    workUnits: quantity,
    actualWorkUnits: scheduledUnits,  // May be less than workUnits if boundary cut off
    startDateTime: allocations[0].startDateTime,
    endDateTime: allocations[allocations.length - 1].endDateTime,
    capacityDays: allocations.length,
    shift,
    timeTaken: Math.round(totalHours * 60),
    allocations,
    customStartTime: null,
    customEndTime: null,
  };

  console.log(`   ✅ ${stage} allocated: ${allocations.length} days, ${scheduledUnits.toFixed(2)}/${quantity.toFixed(2)} units`);
  
  if (scheduledUnits < quantity - EPS) {
    console.log(`   ⚠️ ${(quantity - scheduledUnits).toFixed(2)} units could not fit within boundary`);
    console.log(`   ⚠️ These units will NOT be scheduled (as requested)`);
  }

  return result;
};

/**
 * Allocate a stage by a USER-FIXED duration with overcapacity support
 */
const allocateStageManual = (
  cal,
  stage,
  quantity,
  startInstant,
  minutes,
  ctx,
) => {
  console.log(
    `\n📊 allocateStageManual START: ${stage} (manual: ${minutes} minutes)`,
  );

  const shift = STAGE_SHIFT_PREFERENCE[stage] || 'FULL_DAY';
  const start = new Date(startInstant);
  const totalMinutes = Math.max(0, minutes);
  const empty = {
    stage,
    workUnits: quantity,
    actualWorkUnits: 0,
    startDateTime: start,
    endDateTime: start,
    capacityDays: 0,
    shift,
    timeTaken: 0,
    allocations: [],
    customStartTime: null,
    customEndTime: null,
  };

  if (totalMinutes <= EPS) return empty;

  if (ctx.rebuildBoundary && isBeyondBoundary(start, ctx.rebuildBoundary)) {
    console.log(`   ❌ allocateStageManual: start beyond boundary`);
    return empty;
  }

  const whpd = ctx.workingHoursPerDay || WORKING_HOURS_PER_DAY;
  const shiftHours = stageShiftHours(shift, whpd);

  // Apply overcapacity to manual stages too
  const daysRemaining = getDaysRemainingInWeek(
    startInstant,
    ctx.rebuildBoundary,
  );
  let effectiveOverCap = ctx.overCapacityFactor || 1.25;
  if (daysRemaining <= 2) {
    effectiveOverCap = Math.min(2.0, effectiveOverCap * 1.4);
  }
  const effShiftHours = shiftHours * effectiveOverCap;

  const segments = [];
  let cur = new Date(startInstant);
  let remaining = totalMinutes;
  let guard = 0;
  let dayCount = 0;

  while (remaining > EPS && guard < 100000) {
    guard += 1;
    dayCount++;

    console.log(
      `   Day ${dayCount}: cur=${cur
        .toISOString()
        .slice(0, 10)}, remaining=${remaining.toFixed(0)} min`,
    );

    if (ctx.rebuildBoundary && isBeyondBoundary(cur, ctx.rebuildBoundary)) {
      console.log(`   🛑 Stopping at boundary`);
      break;
    }

    if (!cal.isWorkingDay(cur)) {
      cur = cal.nextWorkingDay(cur);
      continue;
    }

    const dateKey = cal.dayKey(cur);
    const sb = cal.shiftBoundaries(cur, shift);
    const isTransitionDay =
      segments.length === 0 && dateKey === cal.dayKey(startInstant);
    const dayStart = isTransitionDay
      ? maxDate(new Date(startInstant), sb.startDateTime)
      : sb.startDateTime;
    const busy = ctx.busyUntil[usageKey(stage, dateKey)];
    let startDT = busy ? maxDate(dayStart, busy) : dayStart;

    if (ctx.rebuildBoundary && isBeyondBoundary(startDT, ctx.rebuildBoundary)) {
      cur = cal.nextWorkingDay(cur);
      continue;
    }

    const consumedHours = Math.max(
      0,
      cal.hoursBetween(sb.startDateTime, startDT),
    );
    const availMin = Math.max(
      0,
      Math.round((effShiftHours - consumedHours) * 60),
    );

    if (availMin <= 0) {
      cur = cal.nextWorkingDay(cur);
      continue;
    }

    let useMin = Math.min(remaining, availMin);
    let endDT = new Date(startDT.getTime() + useMin * 60000);

    if (ctx.rebuildBoundary && isBeyondBoundary(endDT, ctx.rebuildBoundary)) {
      const maxMinutes = Math.max(
        0,
        cal.hoursBetween(startDT, ctx.rebuildBoundary) * 60,
      );
      useMin = Math.min(useMin, maxMinutes);
      endDT = capAtBoundary(endDT, ctx.rebuildBoundary);
      if (useMin <= EPS) break;
    }

    segments.push({
      dateKey,
      startDateTime: startDT,
      endDateTime: endDT,
      minutes: useMin,
    });
    remaining = round2(remaining - useMin);

    if (remaining > EPS) cur = cal.nextWorkingDay(cur);

    if (ctx.rebuildBoundary && isBeyondBoundary(cur, ctx.rebuildBoundary)) {
      break;
    }
  }

  if (segments.length === 0) return empty;

  const totalSegMin = segments.reduce((s, x) => s + x.minutes, 0) || 1;
  const totalUnits = Math.max(0, quantity);
  let remUnits = totalUnits;
  const allocations = segments.map((seg, i) => {
    const u =
      i === segments.length - 1
        ? remUnits
        : Math.min(remUnits, round2(totalUnits * (seg.minutes / totalSegMin)));
    remUnits = round2(remUnits - u);
    const hours = round2(seg.minutes / 60);
    const key = usageKey(stage, seg.dateKey);
    ctx.usage[key] = (ctx.usage[key] || 0) + u;
    ctx.deltas[key] = (ctx.deltas[key] || 0) + u;
    rememberBusyUntil(ctx.busyUntil, key, seg.endDateTime);
    return {
      date: seg.dateKey,
      startDateTime: seg.startDateTime,
      endDateTime: seg.endDateTime,
      units: round2(u),
      hours,
      shift,
    };
  });

  return {
    stage,
    workUnits: quantity,
    actualWorkUnits: round2(allocations.reduce((s, a) => s + a.units, 0)),
    startDateTime: allocations[0].startDateTime,
    endDateTime: allocations[allocations.length - 1].endDateTime,
    capacityDays: allocations.length,
    shift,
    timeTaken: Math.round(totalMinutes),
    allocations,
    customStartTime: null,
    customEndTime: null,
  };
};

/**
 * PURE scheduling core with aggressive overcapacity
 */
const buildSchedule = ({
  calendar,
  capacityConfig,
  stageQuantities,
  startDate,
  preserveStartTime = false,
  difficulty = 'EASY',
  existingUsage = {},
  settings = {},
  overCapacityFactor = 1.25, // Default 125% overcapacity
  manualDurations = {},
  rebuildBoundary = null,
}) => {
  const cal = calendar;

  let normalizedBoundary = null;
  if (rebuildBoundary) {
    normalizedBoundary = new Date(rebuildBoundary);
    normalizedBoundary.setHours(23, 59, 59, 999);
    console.log(`\n${'='.repeat(60)}`);
    console.log(
      `🚧 buildSchedule: HARD BOUNDARY = ${normalizedBoundary
        .toISOString()
        .slice(0, 10)}`,
    );
    console.log(
      `⚠️  NO scheduling will occur on or after ${normalizedBoundary.toISOString()}`,
    );
    console.log(`${'='.repeat(60)}\n`);
  }

  const seeded =
    existingUsage && existingUsage.usage
      ? existingUsage
      : { usage: existingUsage };
  const seededBusyUntil = {};
  Object.entries(seeded.busyUntil || {}).forEach(([key, value]) => {
    const date = new Date(value);
    if (isValidDate(date)) seededBusyUntil[key] = date;
  });

  const ctx = {
    capacityConfig,
    usage: { ...(seeded.usage || {}) },
    busyUntil: seededBusyUntil,
    deltas: {},
    workingHoursPerDay: settings.workingHoursPerDay || WORKING_HOURS_PER_DAY,
    overCapacityFactor,
    manualDurations: manualDurations || {},
    rebuildBoundary: normalizedBoundary,
  };

  const morningStart = cal.isWorkingDay(startDate)
    ? cal.createExactDateTime(startDate, MORNING_START)
    : cal.createExactDateTime(cal.nextWorkingDay(startDate), MORNING_START);
  const projectStart =
    preserveStartTime && cal.isWorkingDay(startDate)
      ? maxDate(new Date(startDate), morningStart)
      : morningStart;

  console.log(`📅 Project start: ${projectStart.toISOString().slice(0, 10)}`);
  console.log(
    `📅 Overcapacity factor: ${overCapacityFactor} (${Math.round(
      (overCapacityFactor - 1) * 100,
    )}% extra)`,
  );

  if (
    normalizedBoundary &&
    isBeyondBoundary(projectStart, normalizedBoundary)
  ) {
    console.log(`❌ Project start beyond boundary, returning empty schedule`);
    return {
      stages: [],
      firstStart: startDate,
      lastEnd: startDate,
      productionWorkingDays: 0,
      estimatedDays:
        settings.contingencyDays != null
          ? settings.contingencyDays
          : CONTINGENCY_DAYS,
      difficultyAdjustmentDays: 0,
      contingencyDays:
        settings.contingencyDays != null
          ? settings.contingencyDays
          : CONTINGENCY_DAYS,
      deliveryDate: startDate,
      usageDeltas: ctx.deltas,
    };
  }

  const isPresent = (stage) => (stageQuantities[stage] || 0) > EPS;
  const stages = [];

  let phaseStart = projectStart;
  let phaseIndex = 0;

  for (const phase of PHASES) {
    phaseIndex++;
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`📍 PHASE ${phaseIndex}: ${phase.join(' + ')}`);
    console.log(`   Phase start: ${phaseStart.toISOString().slice(0, 10)}`);

    if (
      normalizedBoundary &&
      isBeyondBoundary(phaseStart, normalizedBoundary)
    ) {
      console.log(`   ⏭️ Phase start beyond boundary, stopping`);
      break;
    }

    const ends = [];
    for (const stage of phase) {
      if (!isPresent(stage)) {
        console.log(`   ⏭️ Stage ${stage}: quantity = 0, skipping`);
        continue;
      }

      if (
        normalizedBoundary &&
        isBeyondBoundary(phaseStart, normalizedBoundary)
      ) {
        console.log(
          `   ⏭️ Stage ${stage}: phaseStart beyond boundary, skipping`,
        );
        continue;
      }

      const manualMin = ctx.manualDurations[stage];
      const useManual =
        manualMin != null && manualMin > EPS && CAPACITY_STAGES.includes(stage);

      console.log(`\n   🔧 Stage ${stage}:`);
      console.log(`      quantity: ${stageQuantities[stage]}`);
      console.log(`      manual duration: ${manualMin || 'none'}`);

      const res = useManual
        ? allocateStageManual(
            cal,
            stage,
            stageQuantities[stage],
            phaseStart,
            manualMin,
            ctx,
          )
        : allocateStage(cal, stage, stageQuantities[stage], phaseStart, ctx);

      if (res) {
        stages.push(res);
        ends.push(res.endDateTime.getTime());
        console.log(
          `   ✅ ${stage} scheduled: ends ${res.endDateTime
            .toISOString()
            .slice(0, 10)}`,
        );
      } else {
        console.log(`   ❌ ${stage} could not be scheduled`);
      }
    }

    if (ends.length) {
      const newPhaseStart = new Date(Math.max(...ends));
      console.log(
        `\n   📍 Phase ends: ${newPhaseStart.toISOString().slice(0, 10)}`,
      );
      phaseStart = newPhaseStart;
    }

    if (
      normalizedBoundary &&
      isBeyondBoundary(phaseStart, normalizedBoundary)
    ) {
      console.log(`   ⏭️ Next phase would start beyond boundary, stopping`);
      break;
    }
  }

  // PURCHASING side-track
  if (isPresent('PURCHASING')) {
    console.log(`\n📦 PURCHASING side-track`);
    if (
      !normalizedBoundary ||
      !isBeyondBoundary(projectStart, normalizedBoundary)
    ) {
      const res = allocateStage(
        cal,
        'PURCHASING',
        stageQuantities.PURCHASING,
        projectStart,
        ctx,
      );
      if (res) {
        stages.push(res);
      }
    }
  }

  if (stages.length === 0) {
    console.log(`\n❌ No stages scheduled!`);
    return {
      stages: [],
      firstStart: startDate,
      lastEnd: startDate,
      productionWorkingDays: 0,
      estimatedDays:
        settings.contingencyDays != null
          ? settings.contingencyDays
          : CONTINGENCY_DAYS,
      difficultyAdjustmentDays: 0,
      contingencyDays:
        settings.contingencyDays != null
          ? settings.contingencyDays
          : CONTINGENCY_DAYS,
      deliveryDate: startDate,
      usageDeltas: ctx.deltas,
    };
  }

  const firstStart = stages.reduce(
    (a, s) => (s.startDateTime < a ? s.startDateTime : a),
    stages[0].startDateTime,
  );
  const lastEnd = stages.reduce(
    (a, s) => (s.endDateTime > a ? s.endDateTime : a),
    stages[0].endDateTime,
  );

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 SCHEDULE SUMMARY:`);
  console.log(`   First start: ${firstStart.toISOString().slice(0, 10)}`);
  console.log(`   Last end: ${lastEnd.toISOString().slice(0, 10)}`);
  console.log(
    `   Boundary: ${
      normalizedBoundary
        ? normalizedBoundary.toISOString().slice(0, 10)
        : 'NONE'
    }`,
  );
  console.log(`${'='.repeat(60)}\n`);

  const productionWorkingDays = cal.workingDaysBetween(firstStart, lastEnd);
  const buffer = settings.difficultyBuffer || DIFFICULTY_BUFFER;
  const contingencyDays =
    settings.contingencyDays != null
      ? settings.contingencyDays
      : CONTINGENCY_DAYS;
  const diff = buffer[difficulty] != null ? buffer[difficulty] : 0;
  const difficultyAdjustmentDays = Math.ceil(productionWorkingDays * diff);
  const estimatedDays =
    productionWorkingDays + difficultyAdjustmentDays + contingencyDays;
  let deliveryDate = cal.addWorkingDays(firstStart, estimatedDays);

  if (
    normalizedBoundary &&
    isBeyondBoundary(deliveryDate, normalizedBoundary)
  ) {
    deliveryDate = capAtBoundary(deliveryDate, normalizedBoundary);
  }

  return {
    stages,
    firstStart,
    lastEnd,
    productionWorkingDays,
    difficultyAdjustmentDays,
    contingencyDays,
    estimatedDays,
    deliveryDate,
    usageDeltas: ctx.deltas,
  };
};

/* ------------------------------------------------------------------ *
 * Async wrapper: load calendar + capacity + current usage, schedule,
 * and (commit only) persist consumed capacity to DailyStageCapacity.
 * ------------------------------------------------------------------ */

const loadCapacityConfig = async (client = prisma) => {
  const lots = await client.capacityLot.findMany();
  const cfg = {};
  lots.forEach((lot) => {
    cfg[lot.stage] = {
      capacity: lot.capacity || 1,
      workingHours: lot.workingHours || WORKING_HOURS_PER_DAY,
      parallelSlots: lot.parallelSlots || 1,
    };
  });
  CAPACITY_STAGES.forEach((s) => {
    if (!cfg[s])
      cfg[s] = {
        capacity: 1,
        workingHours: WORKING_HOURS_PER_DAY,
        parallelSlots: 1,
      };
  });
  return cfg;
};

const loadExistingUsage = async (cal, fromDate, client = prisma) => {
  const usage = {};
  const busyUntil = {};
  try {
    const rows = await client.dailyStageCapacity.findMany({
      where: { date: { gte: cal.startOfDay(fromDate) } },
      include: {
        projectStageCapacityAllocations: {
          select: {
            endDateTime: true,
            customEndTime: true,
          },
        },
      },
    });
    rows.forEach((r) => {
      const dateKey = cal.dayKey(r.date);
      const key = usageKey(r.stage, dateKey);
      usage[key] = r.usedCapacity;
      (r.projectStageCapacityAllocations || []).forEach((a) => {
        rememberBusyUntil(busyUntil, key, a.endDateTime || a.customEndTime);
      });
      if (!busyUntil[key] && (r.usedHours || 0) > EPS) {
        const shift = r.shift || STAGE_SHIFT_PREFERENCE[r.stage] || 'FULL_DAY';
        const sb = cal.shiftBoundaries(r.date, shift);
        if (sb) {
          rememberBusyUntil(
            busyUntil,
            key,
            new Date(
              sb.startDateTime.getTime() + (r.usedHours || 0) * 3600 * 1000,
            ),
          );
        }
      }
    });
  } catch (err) {
    console.warn(
      '[engine] could not load existing capacity usage:',
      err.message,
    );
  }
  return { usage, busyUntil };
};

const flushUsage = async (
  capacityConfig,
  deltas,
  settings = {},
  client = prisma,
) => {
  const whpd = settings.workingHoursPerDay || WORKING_HOURS_PER_DAY;
  for (const [key, addedUnits] of Object.entries(deltas)) {
    if (addedUnits <= EPS) continue;
    const [stage, dateKey] = key.split('|');
    const date = dailyCapacityDate(dateKey);
    const cfg = capacityConfig[stage] || {};
    const capacity = cfg.capacity || 1;
    const slots = cfg.parallelSlots || 1;
    const shift = STAGE_SHIFT_PREFERENCE[stage] || 'FULL_DAY';
    const shiftHours = stageShiftHours(shift, whpd);
    const dailyMax = Math.max(
      1,
      round2(capacity * (shiftHours / whpd) * slots),
    );
    const unitsPerHour = (capacity * slots) / whpd;
    const addedHours = round2(addedUnits / unitsPerHour);
    const existing = await client.dailyStageCapacity.findUnique({
      where: { stage_date: { stage, date } },
    });
    if (existing) {
      const newTotal = (existing.usedCapacity || 0) + round2(addedUnits);
      const overUnits = Math.max(0, round2(newTotal - dailyMax));
      const prevOver = existing.overCapacityUsed || 0;
      const overDelta = Math.max(0, overUnits - prevOver);
      const overHoursDelta =
        overDelta > 0 ? round2(overDelta / unitsPerHour) : 0;
      await client.dailyStageCapacity.update({
        where: { id: existing.id },
        data: {
          usedCapacity: { increment: round2(addedUnits) },
          usedHours: { increment: addedHours },
          ...(overDelta > 0
            ? {
                overCapacityUsed: { increment: overDelta },
                overHoursCapacityUsed: { increment: overHoursDelta },
              }
            : {}),
        },
      });
    } else {
      const overUnits = Math.max(0, round2(round2(addedUnits) - dailyMax));
      const overHours = overUnits > 0 ? round2(overUnits / unitsPerHour) : 0;
      await client.dailyStageCapacity.create({
        data: {
          stage,
          date,
          shift,
          usedCapacity: round2(addedUnits),
          maxCapacity: dailyMax,
          workingHours: whpd,
          usedHours: addedHours,
          maxHours: shiftHours,
          overCapacityUsed: overUnits,
          overHoursCapacityUsed: overHours,
        },
      });
    }
  }
};

/**
 * Schedule a project/estimate.
 * @param {object} opts
 * @param {object} opts.stageQuantities  - { [stage]: number }
 * @param {Date|string} [opts.startDate] - default now
 * @param {boolean} [opts.preserveStartTime] - keep a same-day time-of-day
 * @param {string} [opts.difficulty]     - EASY|MEDIUM|HARD
 * @param {'dryRun'|'commit'} [opts.mode] - dryRun (estimation) does not persist
 * @param {Date} [opts.rebuildBoundary]  - HARD BOUNDARY: NO scheduling beyond this date
 * @returns {Promise<object>} the plan (+ usageDeltas)
 */
const scheduleProject = async ({
  stageQuantities,
  startDate,
  preserveStartTime = false,
  difficulty = 'EASY',
  mode = 'dryRun',
  tx = null,
  overCapacityFactor = 1.0,
  manualDurations = {},
  rebuildBoundary = null,
}) => {
  const db = tx || prisma;
  const cal = await getCalendar();
  const settings = await getSchedulingSettings();
  const capacityConfig = await loadCapacityConfig(db);
  const start =
    startDate && startDate !== '' ? new Date(startDate) : new Date();
  const existingUsage = await loadExistingUsage(cal, start, db);

  // Log boundary info
  if (rebuildBoundary) {
    const boundaryDate = new Date(rebuildBoundary);
    boundaryDate.setHours(23, 59, 59, 999);
    console.log(
      `🚧 scheduleProject: HARD BOUNDARY = ${boundaryDate
        .toISOString()
        .slice(0, 10)}`,
    );
    console.log(`⚠️  NO scheduling will occur on or after this date`);
  } else {
    console.log(
      `⚠️ scheduleProject: NO BOUNDARY set - may schedule into future weeks`,
    );
  }

  const plan = buildSchedule({
    calendar: cal,
    capacityConfig,
    stageQuantities,
    startDate: start,
    preserveStartTime,
    difficulty,
    existingUsage,
    settings,
    overCapacityFactor,
    manualDurations,
    rebuildBoundary, // Pass the boundary
  });

  if (mode === 'commit') {
    await flushUsage(capacityConfig, plan.usageDeltas, settings, db);
  }
  return plan;
};

module.exports = {
  computeStageQuantities,
  buildSchedule,
  scheduleProject,
  loadCapacityConfig,
  dailyCapacityDate,
  PHASES,
};
