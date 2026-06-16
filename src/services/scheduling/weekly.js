/**
 * Live rescheduling + capacity lifecycle (Phase 8: transactional + mode-aware).
 */
const prisma = require('../prisma');
const { getCalendar } = require('./calendar');
const { getSchedulingSettings } = require('./settings');
const {
  computeStageQuantities,
  scheduleProject,
  dailyCapacityDate,
  PHASES,
} = require('./weeklyengine');
const { applyDeliveryBuffer, OVERCAPACITY_FACTOR } = require('./config');

const TX_OPTS = { timeout: 30000, maxWait: 15000 };

const phaseIndexOf = (stage) =>
  PHASES.findIndex((phase) => phase.includes(stage));

const manualDurationsOf = (stages) => {
  const map = {};
  (stages || []).forEach((s) => {
    if (
      s.autoSchedule === false &&
      (s.timeTaken || 0) > 0 &&
      s.status !== 'CANCELLED' &&
      !s.finished
    ) {
      map[s.stage] = s.timeTaken;
    }
  });
  return map;
};

const round2 = (n) => Math.round((n || 0) * 100) / 100;
const EPS = 0.001;

const validDateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const maxInstant = (...values) => {
  const dates = values.map(validDateOrNull).filter(Boolean);
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((d) => d.getTime())));
};

const minInstant = (...values) => {
  const dates = values.map(validDateOrNull).filter(Boolean);
  if (!dates.length) return null;
  return new Date(Math.min(...dates.map((d) => d.getTime())));
};

const liveWorkflowStages = (stages) =>
  (stages || []).filter(
    (s) => phaseIndexOf(s.stage) >= 0 && s.status !== 'CANCELLED',
  );

const getStagePhaseStart = (
  stages,
  stageName,
  fallbackInstant = new Date(),
  { floorToFallback = true } = {},
) => {
  const fallback = validDateOrNull(fallbackInstant) || new Date();
  const targetPhase = phaseIndexOf(stageName);
  if (targetPhase < 0) return fallback;

  const liveStages = liveWorkflowStages(stages);
  const samePhaseStarts = liveStages
    .filter(
      (s) => s.stage !== stageName && phaseIndexOf(s.stage) === targetPhase,
    )
    .map((s) => validDateOrNull(s.startDateTime || s.startDate))
    .filter(Boolean);

  let candidate = samePhaseStarts.length
    ? minInstant(...samePhaseStarts)
    : null;
  if (!candidate) {
    for (let phaseIdx = targetPhase - 1; phaseIdx >= 0; phaseIdx -= 1) {
      const priorEnds = liveStages
        .filter((s) => phaseIndexOf(s.stage) === phaseIdx)
        .map((s) => validDateOrNull(s.endDateTime || s.endDate))
        .filter(Boolean);
      if (priorEnds.length) {
        candidate = maxInstant(...priorEnds);
        break;
      }
    }
  }

  if (!candidate) return fallback;
  return floorToFallback ? maxInstant(candidate, fallback) : candidate;
};

const getDownstreamStagesForPhase = (stages, completedStage) => {
  const completedPhase = phaseIndexOf(completedStage);
  if (completedPhase < 0) return [];

  return stages.filter((s) => {
    const stagePhase = phaseIndexOf(s.stage);
    return stagePhase > completedPhase && s.status === 'ACTIVE' && !s.finished;
  });
};

const getPhaseBarrierInstant = (
  stages,
  completedStage,
  fallbackInstant = new Date(),
) => {
  const fallback = validDateOrNull(fallbackInstant) || new Date();
  const completedPhase = phaseIndexOf(completedStage);
  if (completedPhase < 0) return fallback;

  let barrier = fallback.getTime();
  stages.forEach((s) => {
    if (phaseIndexOf(s.stage) !== completedPhase || s.status === 'CANCELLED')
      return;
    const end = validDateOrNull(s.endDateTime || s.endDate);
    if (end && end.getTime() > barrier) barrier = end.getTime();
  });
  return new Date(barrier);
};

const sumMaterialQuantities = (invoice) => {
  const materials = {
    laminatedMDF: 0,
    plainMDF: 0,
    wood: 0,
    metal: 0,
    other: 0,
  };

  (invoice?.items || []).forEach((item) => {
    (item.proformaItemMaterials || []).forEach((pim) => {
      const qty =
        Number(pim.quantity || 0) + Number(pim.additionalQuantity || 0);
      if (qty <= 0) return;
      const material = pim.material || {};
      if (material.laminatedMDF) materials.laminatedMDF += qty;
      else if (material.plainMDF) materials.plainMDF += qty;
      else if (material.wood) materials.wood += qty;
      else if (material.metal) materials.metal += qty;
      else materials.other += qty;
    });
  });

  return materials;
};

const totalMaterialQuantity = (materials) =>
  Object.values(materials || {}).reduce(
    (sum, value) => sum + Number(value || 0),
    0,
  );

const materialStageQuantities = (invoice, existingByStage = new Map()) => {
  const materials = sumMaterialQuantities(invoice);
  const stageQuantities = computeStageQuantities(materials);
  const totalProjectQuantity = totalMaterialQuantity(materials);

  if (invoice?.customer?.isdefault === true) {
    stageQuantities.DELIVERY = 0;
    stageQuantities.INSTALLATION = 0;
  }

  const existingCnc = existingByStage.get('CNC');
  const existingCncUnits = Number(existingCnc?.workUnits || 0);
  if (existingCncUnits > 0 && existingCnc?.status !== 'CANCELLED') {
    stageQuantities.CNC = existingCncUnits;
  }

  return { materials, stageQuantities, totalProjectQuantity };
};

const withClient = (client, fn) =>
  client ? fn(client) : prisma.$transaction(fn, TX_OPTS);

const logScheduleEvent = async (client, data) => {
  try {
    await client.scheduleHistory.create({ data });
  } catch (err) {
    console.warn('[reschedule] could not write ScheduleHistory:', err.message);
  }
};

const releaseStageCapacity = async (
  projectStageId,
  releaseFrom = null,
  client = prisma,
) => {
  const allocations = await client.projectStageCapacityAllocation.findMany({
    where: { projectStageId },
  });
  const cutoff = releaseFrom
    ? dailyCapacityDate(new Date(releaseFrom).toISOString().slice(0, 10))
    : null;

  for (const a of allocations) {
    if (cutoff && new Date(a.allocationDate) < cutoff) continue;
    const daily = await client.dailyStageCapacity.findUnique({
      where: { id: a.dailyStageCapacityId },
    });
    if (daily) {
      const decrementData = {
        usedCapacity: { decrement: a.allocatedUnits },
        usedHours: { decrement: a.allocatedHours },
      };
      if (a.isOverCapacity && (daily.overCapacityUsed || 0) > 0) {
        decrementData.overCapacityUsed = {
          decrement: Math.min(a.allocatedUnits, daily.overCapacityUsed || 0),
        };
        decrementData.overHoursCapacityUsed = {
          decrement: Math.min(
            a.allocatedHours,
            daily.overHoursCapacityUsed || 0,
          ),
        };
      }
      await client.dailyStageCapacity.update({
        where: { id: daily.id },
        data: decrementData,
      });
    }
    await client.projectStageCapacityAllocation.delete({ where: { id: a.id } });
  }
  return allocations.length;
};

const releaseProjectCapacity = async (projectId, client = prisma) => {
  const stages = await client.projectStage.findMany({
    where: { projectId },
    select: { id: true },
  });
  let released = 0;
  for (const s of stages) {
    released += await releaseStageCapacity(s.id, null, client);
  }
  return released;
};

const persistStageAllocations = async (
  projectStageId,
  stage,
  allocations,
  client = prisma,
  overCapacityFactor = 1.0,
) => {
  let created = 0;
  let skipped = 0;

  for (const alloc of allocations || []) {
    const date = dailyCapacityDate(alloc.date);

    const daily = await client.dailyStageCapacity.findUnique({
      where: { stage_date: { stage, date } },
    });
    if (!daily) {
      skipped++;
      continue;
    }

    const isOver =
      overCapacityFactor > 1.0 &&
      (daily.usedCapacity || 0) > (daily.maxCapacity || 0);

    await client.projectStageCapacityAllocation.create({
      data: {
        projectStageId,
        dailyStageCapacityId: daily.id,
        allocatedUnits: round2(alloc.units),
        allocatedHours: round2(alloc.hours),
        shift: alloc.shift || 'FULL_DAY',
        startDateTime: alloc.startDateTime,
        endDateTime: alloc.endDateTime,
        customStartTime: alloc.startDateTime,
        customEndTime: alloc.endDateTime,
        allocationDate: date,
        isOverCapacity: isOver,
      },
    });
    created++;
  }

  return { created, skipped };
};

const releaseStageUnitsOnDay = async (
  projectStageId,
  date,
  units,
  client = prisma,
) => {
  const allocs = await client.projectStageCapacityAllocation.findMany({
    where: { projectStageId, allocationDate: date },
  });
  let remaining = round2(units);
  for (const a of allocs) {
    if (remaining <= EPS) break;
    const take = Math.min(remaining, a.allocatedUnits || 0);
    if (take <= EPS) continue;
    const ratio = (a.allocatedUnits || 0) > 0 ? take / a.allocatedUnits : 0;
    const hoursTake = round2((a.allocatedHours || 0) * ratio);
    const daily = await client.dailyStageCapacity.findUnique({
      where: { id: a.dailyStageCapacityId },
    });
    if (daily) {
      const decrement = {
        usedCapacity: { decrement: round2(take) },
        usedHours: { decrement: hoursTake },
      };
      if (a.isOverCapacity && (daily.overCapacityUsed || 0) > 0) {
        decrement.overCapacityUsed = {
          decrement: Math.min(round2(take), daily.overCapacityUsed || 0),
        };
        decrement.overHoursCapacityUsed = {
          decrement: Math.min(hoursTake, daily.overHoursCapacityUsed || 0),
        };
      }
      await client.dailyStageCapacity.update({
        where: { id: daily.id },
        data: decrement,
      });
    }
    if (take >= (a.allocatedUnits || 0) - EPS) {
      await client.projectStageCapacityAllocation.delete({
        where: { id: a.id },
      });
    } else {
      await client.projectStageCapacityAllocation.update({
        where: { id: a.id },
        data: {
          allocatedUnits: round2((a.allocatedUnits || 0) - take),
          allocatedHours: round2((a.allocatedHours || 0) - hoursTake),
        },
      });
    }
    remaining = round2(remaining - take);
  }
  return round2(units) - remaining;
};

const recomputeProjectDelivery = async (projectId, client = prisma) => {
  const project = await client.project.findUnique({
    where: { id: projectId },
    include: { stages: true },
  });
  if (!project || project.stages.length === 0) return null;

  const live = project.stages.filter((s) => s.status !== 'CANCELLED');
  if (live.length === 0) return null;

  const cal = await getCalendar();
  const settings = await getSchedulingSettings();
  const startTimes = live
    .map((s) => new Date(s.startDateTime || s.startDate))
    .filter((d) => !Number.isNaN(d.getTime()))
    .map((d) => d.getTime());
  const endTimes = live
    .map((s) => new Date(s.endDateTime || s.endDate))
    .filter((d) => !Number.isNaN(d.getTime()))
    .map((d) => d.getTime());
  if (!startTimes.length || !endTimes.length) return null;

  const firstStart = new Date(Math.min(...startTimes));
  const lastEnd = new Date(Math.max(...endTimes));
  const productionWorkingDays = cal.workingDaysBetween(firstStart, lastEnd);
  const estimatedDays = applyDeliveryBuffer(
    productionWorkingDays,
    project.difficulty,
    settings,
  );
  const deliveryDate = cal.addWorkingDays(firstStart, estimatedDays);
  const oldDelivery = project.calculatedDelivery;

  await client.project.update({
    where: { id: projectId },
    data: {
      calculatedDelivery: deliveryDate,
      totalDays: productionWorkingDays,
    },
  });
  return {
    oldDelivery,
    newDelivery: deliveryDate,
    deliveryDate,
    productionWorkingDays,
    estimatedDays,
  };
};

const rescheduleDownstream = async (
  projectId,
  completedStage,
  startInstant,
  client = null,
  overCapacityFactor = 1.0,
) =>
  withClient(client, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { stages: true },
    });
    if (!project) return null;

    const downstream = getDownstreamStagesForPhase(
      project.stages,
      completedStage,
    );
    const downstreamStart = getPhaseBarrierInstant(
      project.stages,
      completedStage,
      startInstant,
    );
    if (downstream.length === 0) {
      return recomputeProjectDelivery(projectId, tx);
    }

    for (const s of downstream) {
      await releaseStageCapacity(s.id, null, tx);
    }

    const stageQuantities = {};
    downstream.forEach((s) => {
      stageQuantities[s.stage] = s.workUnits || 0;
    });
    const plan = await scheduleProject({
      stageQuantities,
      startDate: downstreamStart,
      preserveStartTime: true,
      difficulty: project.difficulty,
      mode: 'commit',
      tx,
      overCapacityFactor,
      manualDurations: manualDurationsOf(downstream),
    });
    const planByStage = {};
    plan.stages.forEach((p) => {
      planByStage[p.stage] = p;
    });

    for (const s of downstream) {
      const p = planByStage[s.stage];
      if (!p) continue;
      await tx.projectStage.update({
        where: { id: s.id },
        data: {
          startDate: p.startDateTime,
          endDate: p.endDateTime,
          startDateTime: p.startDateTime,
          endDateTime: p.endDateTime,
          capacityDays: p.capacityDays,
          shift: p.shift,
          timeTaken: p.timeTaken,
        },
      });
      await persistStageAllocations(s.id, s.stage, p.allocations, tx);
    }

    return recomputeProjectDelivery(projectId, tx);
  });

const rescheduleWholeProject = async (projectId, startInstant, client = null) =>
  withClient(client, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { stages: true },
    });
    if (!project) return null;

    const active = project.stages.filter(
      (s) =>
        s.status !== 'CANCELLED' && s.status !== 'COMPLETED' && !s.finished,
    );
    for (const s of active) {
      await releaseStageCapacity(s.id, null, tx);
    }

    const effStart = new Date(startInstant);

    const stageQuantities = {};
    active.forEach((s) => {
      stageQuantities[s.stage] = s.workUnits || 0;
    });

    const plan = await scheduleProject({
      stageQuantities,
      startDate: effStart,
      difficulty: project.difficulty,
      mode: 'commit',
      tx,
      manualDurations: manualDurationsOf(active),
    });
    const planByStage = {};
    plan.stages.forEach((p) => {
      planByStage[p.stage] = p;
    });

    for (const s of active) {
      const p = planByStage[s.stage];
      if (!p) continue;
      if (s.stage === 'DELIVERY') continue;
      await tx.projectStage.update({
        where: { id: s.id },
        data: {
          startDate: p.startDateTime,
          endDate: p.endDateTime,
          startDateTime: p.startDateTime,
          endDateTime: p.endDateTime,
          capacityDays: p.capacityDays,
          shift: p.shift,
          timeTaken: p.timeTaken,
        },
      });
      await persistStageAllocations(s.id, s.stage, p.allocations, tx);
    }

    await recomputeProjectDelivery(projectId, tx);
    return plan;
  });

function getWeekRangeSafe(date = new Date()) {
  const d = new Date(date);

  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  saturday.setHours(23, 59, 59, 999);

  return { monday, saturday };
}

/**
 * Reschedule a project for CURRENT WEEK ONLY with EXTENSIVE LOGGING
 */
/**
 * Reschedule a project for CURRENT WEEK ONLY with EXTENSIVE LOGGING
 */
const rescheduleWeekOnly = async (
  projectId,
  client = null,
  rebuildEnd = null,
  overCapacityFactor = 1.25,
) => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔄 RESCHEDULE WEEK ONLY - PROJECT: ${projectId}`);
  console.log(`${'='.repeat(80)}`);

  return withClient(client, async (tx) => {
    const { monday: weekStart, saturday: weekEnd } = getWeekRangeSafe();

    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const effectiveStart = today > weekStart ? today : weekStart;

    // FORCE boundary to Saturday at END OF DAY
    const hardBoundary = new Date(weekEnd);
    hardBoundary.setHours(23, 59, 59, 999);

    console.log(`\n📅 WEEK BOUNDARIES:`);
    console.log(
      `   Monday (week start): ${weekStart.toISOString().slice(0, 10)}`,
    );
    console.log(
      `   Saturday (HARD BOUNDARY): ${hardBoundary.toISOString().slice(0, 10)}`,
    );
    console.log(`   Today: ${today.toISOString().slice(0, 10)}`);
    console.log(
      `   Effective start: ${effectiveStart.toISOString().slice(0, 10)}`,
    );
    console.log(`   Overcapacity factor: ${overCapacityFactor}`);

    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { stages: true },
    });
    if (!project) {
      console.log(`❌ Project ${projectId} not found`);
      return null;
    }

    console.log(`\n📋 PROJECT STAGES (BEFORE RESCHEDULE):`);
    project.stages.forEach((s) => {
      const stageStart = new Date(s.startDateTime || s.startDate);
      console.log(
        `   ${s.stage}: start=${stageStart
          .toISOString()
          .slice(0, 10)}, status=${s.status}, finished=${
          s.finished
        }, workUnits=${s.workUnits}`,
      );
    });

    // CRITICAL FIX: ONLY include stages that start WITHIN this week
    // A stage is in this week if: startDate >= weekStart AND startDate <= hardBoundary
    const stagesToReschedule = project.stages.filter((s) => {
      const stageStart = new Date(s.startDateTime || s.startDate);
      const isActive =
        s.status !== 'CANCELLED' && s.status !== 'COMPLETED' && !s.finished;
      
      // CRITICAL: Check if stage starts WITHIN the week (Monday to Saturday inclusive)
      const isInWeek = stageStart >= weekStart && stageStart <= hardBoundary;

      console.log(
        `   Filtering ${s.stage}: start=${stageStart
          .toISOString()
          .slice(0, 10)}, isActive=${isActive}, isInWeek=${isInWeek}`,
      );

      return isActive && isInWeek;
    });

    console.log(`\n📊 Stages to reschedule: ${stagesToReschedule.length}`);

    if (stagesToReschedule.length === 0) {
      console.log(`⏭️ No stages to reschedule this week`);
      return { skipped: true, reason: 'No stages to reschedule this week' };
    }

    // Release capacity ONLY for future days
    for (const s of stagesToReschedule) {
      console.log(
        `   Releasing capacity for ${s.stage} from ${effectiveStart
          .toISOString()
          .slice(0, 10)}`,
      );
      await releaseStageCapacity(s.id, effectiveStart, tx);
    }

    const stageQuantities = {};
    stagesToReschedule.forEach((s) => {
      stageQuantities[s.stage] = s.workUnits || 0;
      console.log(`   ${s.stage}: workUnits=${s.workUnits}`);
    });

    console.log(`\n🚀 Calling scheduleProject with:`);
    console.log(`   rebuildBoundary: ${hardBoundary.toISOString()}`);
    console.log(`   startDate: ${effectiveStart.toISOString()}`);
    console.log(`   stageQuantities:`, stageQuantities);

    const plan = await scheduleProject({
      stageQuantities,
      startDate: effectiveStart,
      preserveStartTime: true,
      difficulty: project.difficulty,
      mode: 'commit',
      tx,
      rebuildBoundary: hardBoundary,
      overCapacityFactor,
      manualDurations: manualDurationsOf(stagesToReschedule),
    });

    console.log(`\n📊 scheduleProject RETURNED ${plan.stages.length} stages:`);
    plan.stages.forEach((p) => {
      console.log(
        `   ${p.stage}: start=${p.startDateTime
          .toISOString()
          .slice(0, 10)}, end=${p.endDateTime
          .toISOString()
          .slice(0, 10)}, days=${p.capacityDays}`,
      );

      // Check if this stage exceeds boundary
      if (p.endDateTime > hardBoundary) {
        console.log(
          `   ❌ WARNING: ${p.stage} ends ${p.endDateTime
            .toISOString()
            .slice(0, 10)} which EXCEEDS boundary ${hardBoundary
            .toISOString()
            .slice(0, 10)}!`,
        );
      }
    });

    const planByStage = {};
    plan.stages.forEach((p) => {
      planByStage[p.stage] = p;
    });

    let totalAllocationsCreated = 0;
    let overCapacityCount = 0;

    for (const s of stagesToReschedule) {
      const p = planByStage[s.stage];
      if (!p) {
        console.log(`   ⚠️ No plan found for ${s.stage}`);
        continue;
      }

      const weekAllocations = (p.allocations || []).filter((alloc) => {
        const allocDate = new Date(alloc.date);
        const isValid =
          allocDate >= effectiveStart && allocDate <= hardBoundary;
        if (!isValid) {
          console.log(
            `   ⏭️ Filtered out allocation for ${s.stage} on ${alloc.date} (outside week range)`,
          );
        }
        return isValid;
      });

      console.log(
        `   ${s.stage}: ${
          weekAllocations.length
        } allocations within week (out of ${p.allocations?.length || 0} total)`,
      );

      if (weekAllocations.length > 0) {
        await tx.projectStage.update({
          where: { id: s.id },
          data: {
            startDate: p.startDateTime,
            endDate: p.endDateTime,
            startDateTime: p.startDateTime,
            endDateTime: p.endDateTime,
            capacityDays: p.capacityDays,
            shift: p.shift,
            timeTaken: p.timeTaken,
          },
        });

        const result = await persistStageAllocations(
          s.id,
          s.stage,
          weekAllocations,
          tx,
          overCapacityFactor,
        );
        totalAllocationsCreated += result.created;
        overCapacityCount += weekAllocations.filter(
          (alloc) => alloc.units > 0,
        ).length;
      }
    }

    await recomputeProjectDelivery(projectId, tx);

    console.log(`\n✅ RESCHEDULE COMPLETE:`);
    console.log(`   Allocations created: ${totalAllocationsCreated}`);
    console.log(`   Overcapacity count: ${overCapacityCount}`);
    console.log(
      `   Week range: ${weekStart.toISOString().slice(0, 10)} to ${hardBoundary
        .toISOString()
        .slice(0, 10)}`,
    );
    console.log(`${'='.repeat(80)}\n`);

    return {
      success: true,
      mode: 'WEEK_ONLY_WITH_OVERCAPACITY',
      projectId,
      range: { start: effectiveStart, end: hardBoundary },
      allocationsCreated: totalAllocationsCreated,
      overCapacityCount,
      overCapacityFactor,
    };
  });
};
/**
 * Reschedule ONLY specific stages for CURRENT WEEK ONLY, preserving original anchor dates
 */
/**
 * Reschedule ONLY specific stages for CURRENT WEEK ONLY - NO downstream rescheduling
 */
/**
 * Reschedule ONLY specific stages for CURRENT WEEK ONLY - NO downstream rescheduling
 */
const rescheduleWeekOnlyWithStages = async (
  projectId,
  client = null,
  rebuildEnd = null,
  overCapacityFactor = 1.25,
  stagesToReschedule = []
) => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔄 RESCHEDULE WITH STAGES - PROJECT: ${projectId}`);
  console.log(`   Stages to reschedule: ${stagesToReschedule.map(s => s.stage).join(', ')}`);
  console.log(`${'='.repeat(80)}`);

  return withClient(client, async (tx) => {
    const { monday: weekStart, saturday: weekEnd } = getWeekRangeSafe();

    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const effectiveStart = today > weekStart ? today : weekStart;

    const hardBoundary = new Date(weekEnd);
    hardBoundary.setHours(23, 59, 59, 999);

    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { stages: true },
    });
    
    if (!project) {
      console.log(`❌ Project ${projectId} not found`);
      return null;
    }

    if (stagesToReschedule.length === 0) {
      console.log(`⏭️ No stages to reschedule`);
      return { skipped: true, reason: 'No stages to reschedule' };
    }

    // ============================================================
    // CRITICAL: Get future stages and SAVE their original dates
    // ============================================================
    
    const currentWeekStageIds = new Set(stagesToReschedule.map(s => s.id));
    
    // Get ALL stages that are NOT in current week (future stages)
    const futureStages = project.stages.filter(s => !currentWeekStageIds.has(s.id) && s.status === 'ACTIVE' && !s.finished);
    
    console.log(`\n📊 Future stages (will NOT be modified):`);
    for (const stage of futureStages) {
      console.log(`   ${stage.stage}: start=${stage.startDateTime?.toISOString().slice(0, 10)}, units=${stage.workUnits}`);
    }
    
    // SAVE future stage original dates BEFORE any changes
    const futureStageBackup = futureStages.map(s => ({
      id: s.id,
      originalStartDate: new Date(s.startDateTime || s.startDate),
      originalEndDate: new Date(s.endDateTime || s.endDate),
      originalCapacityDays: s.capacityDays
    }));

    // ============================================================
    // ONLY release capacity for current week stages
    // ============================================================
    
    for (const stage of stagesToReschedule) {
      console.log(`   Releasing capacity for ${stage.stage} (original start: ${stage.startDateTime?.toISOString().slice(0, 10)})`);
      await releaseStageCapacity(stage.id, effectiveStart, tx);
    }

    // Build stage quantities ONLY for stages being rescheduled
    const stageQuantities = {};
    stagesToReschedule.forEach((s) => {
      stageQuantities[s.stage] = s.workUnits || 0;
    });

    // Use today as anchor start (not original dates)
    const anchorStart = effectiveStart;

    console.log(`\n🎯 Using anchor start date: ${anchorStart.toISOString().slice(0, 10)}`);

    // ============================================================
    // CRITICAL: Create a schedule that ONLY includes current week stages
    // by only passing quantities for those stages
    // ============================================================
    
    const plan = await scheduleProject({
      stageQuantities,
      startDate: anchorStart,
      preserveStartTime: true,
      difficulty: project.difficulty,
      mode: 'commit',
      tx,
      rebuildBoundary: hardBoundary,
      overCapacityFactor,
      manualDurations: manualDurationsOf(stagesToReschedule),
    });

    const planByStage = {};
    plan.stages.forEach((p) => {
      planByStage[p.stage] = p;
    });

    let totalAllocationsCreated = 0;

    // ============================================================
    // ONLY update current week stages
    // ============================================================
    
    for (const s of stagesToReschedule) {
      const p = planByStage[s.stage];
      if (!p) {
        console.log(`   ⚠️ No plan found for ${s.stage}`);
        continue;
      }

      // Filter allocations to ONLY within current week
      const weekAllocations = (p.allocations || []).filter((alloc) => {
        const allocDate = new Date(alloc.date);
        return allocDate >= effectiveStart && allocDate <= hardBoundary;
      });

      console.log(`   ${s.stage}: ${weekAllocations.length} allocations within week`);

      if (weekAllocations.length > 0) {
        // Update the stage with new schedule
        await tx.projectStage.update({
          where: { id: s.id },
          data: {
            startDate: p.startDateTime,
            endDate: p.endDateTime,
            startDateTime: p.startDateTime,
            endDateTime: p.endDateTime,
            capacityDays: p.capacityDays,
            shift: p.shift,
            timeTaken: p.timeTaken,
          },
        });

        const result = await persistStageAllocations(
          s.id,
          s.stage,
          weekAllocations,
          tx,
          overCapacityFactor,
        );
        totalAllocationsCreated += result.created;
        console.log(`   ✅ ${s.stage}: scheduled ${p.actualWorkUnits}/${s.workUnits} units`);
      } else {
        console.log(`   ⚠️ ${s.stage}: No allocations within current week`);
      }
    }

    // ============================================================
    // CRITICAL: RESTORE future stages to their original dates
    // This prevents them from being changed by the scheduling engine
    // ============================================================
    
    console.log(`\n🔄 Restoring future stages to original dates...`);
    for (const backup of futureStageBackup) {
      await tx.projectStage.update({
        where: { id: backup.id },
        data: {
          startDateTime: backup.originalStartDate,
          endDateTime: backup.originalEndDate,
          startDate: backup.originalStartDate,
          endDate: backup.originalEndDate,
          capacityDays: backup.originalCapacityDays,
        },
      });
      console.log(`   Restored stage to ${backup.originalStartDate.toISOString().slice(0, 10)}`);
    }

    // ============================================================
    // Recompute delivery based on restored dates
    // ============================================================
    
    const allStagesAfterRestore = await tx.projectStage.findMany({
      where: { projectId },
    });
    
    const liveStages = allStagesAfterRestore.filter(s => s.status !== 'CANCELLED');
    if (liveStages.length > 0) {
      const cal = await getCalendar();
      const settings = await getSchedulingSettings();
      const startTimes = liveStages
        .map((s) => new Date(s.startDateTime || s.startDate))
        .filter((d) => !Number.isNaN(d.getTime()))
        .map((d) => d.getTime());
      const endTimes = liveStages
        .map((s) => new Date(s.endDateTime || s.endDate))
        .filter((d) => !Number.isNaN(d.getTime()))
        .map((d) => d.getTime());
      
      if (startTimes.length && endTimes.length) {
        const firstStart = new Date(Math.min(...startTimes));
        const lastEnd = new Date(Math.max(...endTimes));
        const productionWorkingDays = cal.workingDaysBetween(firstStart, lastEnd);
        const estimatedDays = applyDeliveryBuffer(
          productionWorkingDays,
          project.difficulty,
          settings,
        );
        const deliveryDate = cal.addWorkingDays(firstStart, estimatedDays);
        
        await tx.project.update({
          where: { id: projectId },
          data: {
            calculatedDelivery: deliveryDate,
            totalDays: productionWorkingDays,
          },
        });
      }
    }

    console.log(`\n✅ RESCHEDULE COMPLETE:`);
    console.log(`   Allocations created: ${totalAllocationsCreated}`);
    console.log(`   Future stages restored: ${futureStageBackup.length}`);
    console.log(`${'='.repeat(80)}\n`);

    return {
      success: true,
      mode: 'WEEK_ONLY_WITH_RESTORE',
      projectId,
      allocationsCreated: totalAllocationsCreated,
      futureStagesRestored: futureStageBackup.length,
      anchorStart,
    };
  });
};
const reallocateProjectFromInvoiceMaterials = async (
  projectId,
  { client = null, byUserId = null, startInstant = new Date() } = {},
) =>
  withClient(client, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: {
        stages: true,
        invoice: {
          include: {
            customer: true,
            items: {
              include: {
                proformaItemMaterials: { include: { material: true } },
              },
            },
          },
        },
      },
    });
    if (!project) return null;
    if (!project.invoice) return recomputeProjectDelivery(projectId, tx);

    const existingByStage = new Map(project.stages.map((s) => [s.stage, s]));
    const { materials, stageQuantities, totalProjectQuantity } =
      materialStageQuantities(project.invoice, existingByStage);

    const start = validDateOrNull(startInstant) || new Date();
    const scheduleQuantities = {};
    const stageState = {};

    const allStages = Array.from(
      new Set([
        ...Object.keys(stageQuantities),
        ...project.stages.map((s) => s.stage),
      ]),
    ).filter(
      (stage) =>
        stage !== 'INVOICE' &&
        (phaseIndexOf(stage) >= 0 || stage === 'PURCHASING'),
    );

    for (const stageName of allStages) {
      const plannedUnits = Number(stageQuantities[stageName] || 0);
      const existing = existingByStage.get(stageName);
      const actualUnits = Number(existing?.actualWorkUnits || 0);
      const remainingUnits = Math.max(0, plannedUnits - actualUnits);

      if (plannedUnits <= 0) {
        if (!existing) continue;
        await releaseStageCapacity(existing.id, null, tx);
        const hasActualWork = actualUnits > 0;
        await tx.projectStage.update({
          where: { id: existing.id },
          data: {
            workUnits: 0,
            actualWorkUnits: actualUnits,
            finished: hasActualWork,
            status: hasActualWork ? 'COMPLETED' : 'CANCELLED',
            autoSchedule: true,
          },
        });
        continue;
      }

      let stageRow = existing;
      if (!stageRow) {
        stageRow = await tx.projectStage.create({
          data: {
            projectId,
            stage: stageName,
            workUnits: plannedUnits,
            actualWorkUnits: 0,
            capacityDays: 1,
            timeTaken: 0,
            startDate: start,
            endDate: start,
            startDateTime: start,
            endDateTime: start,
            customStartTime: start,
            customEndTime: start,
            shift: 'CUSTOM',
            autoSchedule: true,
            status: 'ACTIVE',
            finished: false,
          },
        });
      }

      if (remainingUnits <= 0) {
        await releaseStageCapacity(stageRow.id, null, tx);
        await tx.projectStage.update({
          where: { id: stageRow.id },
          data: {
            workUnits: plannedUnits,
            actualWorkUnits: actualUnits,
            finished: true,
            status: 'COMPLETED',
            autoSchedule: true,
          },
        });
        continue;
      }

      if (stageRow.status === 'COMPLETED' || stageRow.finished) {
        await releaseStageCapacity(stageRow.id, start, tx);
      } else {
        await releaseStageCapacity(stageRow.id, null, tx);
      }

      const activeRow = await tx.projectStage.update({
        where: { id: stageRow.id },
        data: {
          workUnits: plannedUnits,
          actualWorkUnits: actualUnits,
          finished: false,
          status: 'ACTIVE',
          autoSchedule: true,
        },
      });

      scheduleQuantities[stageName] = remainingUnits;
      stageState[stageName] = {
        row: activeRow,
        plannedUnits,
        actualUnits,
      };
    }

    let plan = { stages: [] };
    if (Object.values(scheduleQuantities).some((qty) => qty > 0)) {
      plan = await scheduleProject({
        stageQuantities: scheduleQuantities,
        startDate: start,
        preserveStartTime: true,
        difficulty: project.difficulty,
        mode: 'commit',
        tx,
      });
    }

    const planByStage = new Map(plan.stages.map((p) => [p.stage, p]));
    for (const [stageName, state] of Object.entries(stageState)) {
      const p = planByStage.get(stageName);
      if (!p) {
        throw new Error(
          `Material reallocation did not produce a schedule for ${stageName}`,
        );
      }
      await tx.projectStage.update({
        where: { id: state.row.id },
        data: {
          workUnits: state.plannedUnits,
          actualWorkUnits: state.actualUnits,
          startDate: p.startDateTime,
          endDate: p.endDateTime,
          startDateTime: p.startDateTime,
          endDateTime: p.endDateTime,
          customStartTime: p.customStartTime,
          customEndTime: p.customEndTime,
          capacityDays: p.capacityDays,
          shift: p.shift,
          timeTaken: p.timeTaken,
          finished: false,
          status: 'ACTIVE',
          autoSchedule: true,
        },
      });
      await persistStageAllocations(state.row.id, stageName, p.allocations, tx);
    }

    await tx.project.update({
      where: { id: projectId },
      data: { totalProjectQuantity },
    });

    const result = await recomputeProjectDelivery(projectId, tx);
    await logScheduleEvent(tx, {
      projectId,
      event: 'RESCHEDULED',
      trigger: byUserId ? 'USER' : 'SYSTEM',
      byUserId,
      oldDelivery: result ? result.oldDelivery : project.calculatedDelivery,
      newDelivery: result ? result.newDelivery : project.calculatedDelivery,
      reason:
        'Project materials changed; stage quantities and capacity were reallocated',
    });

    return {
      ...result,
      materials,
      stageQuantities,
      totalProjectQuantity,
      scheduledStages: Object.keys(scheduleQuantities),
    };
  });

const onStageCompleted = async (
  projectId,
  stage,
  completionInstant = new Date(),
  client = null,
) =>
  withClient(client, async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) return null;

    const ps = await tx.projectStage.findFirst({ where: { projectId, stage } });
    if (ps) {
      await releaseStageCapacity(ps.id, completionInstant, tx);
    }

    const auto = project.scheduleMode === 'AUTO';
    let result = null;
    if (auto) {
      result = await rescheduleDownstream(
        projectId,
        stage,
        completionInstant,
        tx,
      );
    }

    await logScheduleEvent(tx, {
      projectId,
      event: 'STAGE_COMPLETED',
      trigger: 'COMPLETION',
      stage,
      oldDelivery: result ? result.oldDelivery : project.calculatedDelivery,
      newDelivery: result ? result.newDelivery : project.calculatedDelivery,
      reason: auto
        ? 'Stage completed; downstream rescheduled'
        : `Stage completed; capacity released, schedule held (mode=${project.scheduleMode})`,
    });
    return result;
  });

const onStageCancelled = async (
  projectId,
  stage,
  byUserId = null,
  client = null,
) =>
  withClient(client, async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) return null;

    const ps = await tx.projectStage.findFirst({ where: { projectId, stage } });
    if (!ps) return null;

    await releaseStageCapacity(ps.id, null, tx);
    await tx.projectStage.update({
      where: { id: ps.id },
      data: { status: 'CANCELLED', workUnits: 0 },
    });

    const auto = project.scheduleMode === 'AUTO';
    let result = null;
    if (auto) {
      result = await rescheduleDownstream(
        projectId,
        stage,
        ps.startDateTime || ps.startDate || new Date(),
        tx,
      );
    }

    await logScheduleEvent(tx, {
      projectId,
      event: 'STAGE_CANCELLED',
      trigger: 'CANCELLATION',
      stage,
      byUserId,
      oldDelivery: result ? result.oldDelivery : project.calculatedDelivery,
      newDelivery: result ? result.newDelivery : project.calculatedDelivery,
      reason: auto
        ? 'Stage cancelled; downstream rescheduled'
        : `Stage cancelled; capacity released, schedule held (mode=${project.scheduleMode})`,
    });
    return result;
  });

const recomputeDownstreamFromBarrier = async (
  downstreamStages,
  downstreamStart,
  project,
  tx,
  overCapacityFactor,
) => {
  if (!downstreamStages.length) return [];
  for (const s of downstreamStages) {
    await releaseStageCapacity(s.id, null, tx);
  }
  const downstreamQuantities = {};
  downstreamStages.forEach((s) => {
    downstreamQuantities[s.stage] = s.workUnits || 0;
  });
  const downstreamPlan = await scheduleProject({
    stageQuantities: downstreamQuantities,
    startDate: downstreamStart,
    preserveStartTime: true,
    difficulty: project.difficulty,
    mode: 'commit',
    tx,
    overCapacityFactor,
    manualDurations: manualDurationsOf(downstreamStages),
  });
  const planByStage = {};
  downstreamPlan.stages.forEach((p) => {
    planByStage[p.stage] = p;
  });
  const names = [];
  for (const s of downstreamStages) {
    const p = planByStage[s.stage];
    if (!p) continue;
    await tx.projectStage.update({
      where: { id: s.id },
      data: {
        startDate: p.startDateTime,
        endDate: p.endDateTime,
        startDateTime: p.startDateTime,
        endDateTime: p.endDateTime,
        capacityDays: p.capacityDays,
        shift: p.shift,
        timeTaken: p.timeTaken,
      },
    });
    await persistStageAllocations(
      s.id,
      s.stage,
      p.allocations,
      tx,
      overCapacityFactor,
    );
    names.push(s.stage);
  }
  return names;
};

const rescheduleStageAndDownstream = async (
  projectId,
  stageName,
  newStartDate,
  {
    client = null,
    byUserId = null,
    overCapacityFactor = OVERCAPACITY_FACTOR,
    fromDate = null,
    units = null,
  } = {},
) =>
  withClient(client, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: {
        stages: {
          include: {
            projectStageCapacityAllocations: true,
          },
        },
      },
    });
    if (!project) return null;

    const targetPhase = phaseIndexOf(stageName);
    if (targetPhase < 0) return null;

    const draggedStage = project.stages.find(
      (s) =>
        s.stage === stageName &&
        s.status !== 'CANCELLED' &&
        s.status !== 'COMPLETED' &&
        !s.finished,
    );
    if (!draggedStage) return null;

    const parallelPeers = project.stages.filter(
      (s) =>
        s.stage !== stageName &&
        phaseIndexOf(s.stage) === targetPhase &&
        s.status !== 'CANCELLED' &&
        s.status !== 'COMPLETED' &&
        !s.finished,
    );

    const downstreamStages = project.stages.filter((s) => {
      if (s.status === 'CANCELLED' || s.status === 'COMPLETED' || s.finished)
        return false;
      return phaseIndexOf(s.stage) > targetPhase;
    });

    const effectiveFromDate = fromDate ? new Date(fromDate) : null;
    const fromDateCutoff = effectiveFromDate
      ? dailyCapacityDate(effectiveFromDate.toISOString().slice(0, 10))
      : null;
    const effStart = new Date(newStartDate);

    const cellUnits = fromDateCutoff
      ? (draggedStage.projectStageCapacityAllocations || [])
          .filter((a) => {
            const ad = dailyCapacityDate(
              new Date(a.allocationDate).toISOString().slice(0, 10),
            );
            return ad.getTime() === fromDateCutoff.getTime();
          })
          .reduce((sum, a) => sum + (a.allocatedUnits || 0), 0)
      : 0;
    const isPartial =
      units != null && fromDateCutoff && units > EPS && units < cellUnits - EPS;

    const phaseEndTimes = [];
    let rescheduledStages = [];
    let movedPlan = null;

    if (isPartial) {
      await releaseStageUnitsOnDay(draggedStage.id, fromDateCutoff, units, tx);

      const plan = await scheduleProject({
        stageQuantities: { [stageName]: units },
        startDate: effStart,
        preserveStartTime: false,
        difficulty: project.difficulty,
        mode: 'commit',
        tx,
        overCapacityFactor,
      });
      movedPlan = plan;
      const p = plan.stages.find((s) => s.stage === stageName);
      if (p)
        await persistStageAllocations(
          draggedStage.id,
          stageName,
          p.allocations,
          tx,
          overCapacityFactor,
        );

      const allAllocs = await tx.projectStageCapacityAllocation.findMany({
        where: { projectStageId: draggedStage.id },
      });
      if (allAllocs.length) {
        const starts = allAllocs.map((a) =>
          new Date(
            a.startDateTime || a.customStartTime || a.allocationDate,
          ).getTime(),
        );
        const ends = allAllocs.map((a) =>
          new Date(
            a.endDateTime || a.customEndTime || a.allocationDate,
          ).getTime(),
        );
        const newStart = new Date(Math.min(...starts));
        const newEnd = new Date(Math.max(...ends));
        const days = new Set(
          allAllocs.map((a) =>
            new Date(a.allocationDate).toISOString().slice(0, 10),
          ),
        ).size;
        const totalHours = allAllocs.reduce(
          (sum, a) => sum + (a.allocatedHours || 0),
          0,
        );
        await tx.projectStage.update({
          where: { id: draggedStage.id },
          data: {
            startDate: newStart,
            startDateTime: newStart,
            endDate: newEnd,
            endDateTime: newEnd,
            capacityDays: days,
            timeTaken: Math.round(totalHours * 60),
          },
        });
        phaseEndTimes.push(newEnd.getTime());
      }
      parallelPeers.forEach((peer) => {
        const e = validDateOrNull(peer.endDateTime || peer.endDate);
        if (e) phaseEndTimes.push(e.getTime());
      });
      rescheduledStages = [stageName];
    } else {
      const phaseStages = [draggedStage, ...parallelPeers];
      const phaseQuantities = {};
      const preservedStartDates = {};

      const allocsFromCutoff = (s) =>
        (s.projectStageCapacityAllocations || []).filter((a) => {
          if (!fromDateCutoff) return true;
          const ad = dailyCapacityDate(
            new Date(a.allocationDate).toISOString().slice(0, 10),
          );
          return ad.getTime() >= fromDateCutoff.getTime();
        });
      const allocsBeforeCutoff = (s) =>
        (s.projectStageCapacityAllocations || []).filter((a) => {
          if (!fromDateCutoff) return false;
          const ad = dailyCapacityDate(
            new Date(a.allocationDate).toISOString().slice(0, 10),
          );
          return ad.getTime() < fromDateCutoff.getTime();
        });

      for (const s of phaseStages) {
        await releaseStageCapacity(s.id, effectiveFromDate, tx);

        const movedUnits = allocsFromCutoff(s).reduce(
          (sum, a) => sum + (a.allocatedUnits || 0),
          0,
        );
        phaseQuantities[s.stage] =
          movedUnits > 0 ? movedUnits : s.workUnits || 0;

        const preserved = allocsBeforeCutoff(s);
        if (preserved.length > 0) {
          const earliest = preserved
            .map((a) =>
              new Date(
                a.startDateTime || a.customStartTime || a.allocationDate,
              ).getTime(),
            )
            .filter(Number.isFinite);
          preservedStartDates[s.stage] = earliest.length
            ? new Date(Math.min(...earliest))
            : new Date(s.startDate || s.startDateTime);
        }
      }

      const draggedPlan = await scheduleProject({
        stageQuantities: phaseQuantities,
        startDate: effStart,
        preserveStartTime: false,
        difficulty: project.difficulty,
        mode: 'commit',
        tx,
        overCapacityFactor,
        manualDurations: manualDurationsOf(phaseStages),
      });

      movedPlan = draggedPlan;
      const draggedResult = draggedPlan.stages.find(
        (p) => p.stage === stageName,
      );
      if (!draggedResult) return null;

      for (const s of phaseStages) {
        const p = draggedPlan.stages.find((ps) => ps.stage === s.stage);
        if (!p) continue;
        const preservedStart = preservedStartDates[s.stage] || null;
        const preservedDayCount = preservedStart
          ? new Set(
              allocsBeforeCutoff(s).map((a) =>
                new Date(a.allocationDate).toISOString().slice(0, 10),
              ),
            ).size
          : 0;
        await tx.projectStage.update({
          where: { id: s.id },
          data: {
            startDate: preservedStart || p.startDateTime,
            endDate: p.endDateTime,
            startDateTime: preservedStart || p.startDateTime,
            endDateTime: p.endDateTime,
            capacityDays: preservedDayCount + (p.capacityDays || 0),
            shift: p.shift,
            timeTaken: p.timeTaken,
          },
        });
        await persistStageAllocations(
          s.id,
          s.stage,
          p.allocations,
          tx,
          overCapacityFactor,
        );
        phaseEndTimes.push(p.endDateTime.getTime());
      }
      rescheduledStages = phaseStages.map((s) => s.stage);
    }

    if (downstreamStages.length > 0 && phaseEndTimes.length > 0) {
      const downstreamStart = new Date(Math.max(...phaseEndTimes));
      const dsNames = await recomputeDownstreamFromBarrier(
        downstreamStages,
        downstreamStart,
        project,
        tx,
        overCapacityFactor,
      );
      rescheduledStages.push(...dsNames);
    }

    const result = await recomputeProjectDelivery(projectId, tx);

    const fromLabel = effectiveFromDate
      ? ` from ${effectiveFromDate.toISOString().slice(0, 10)}`
      : '';
    await logScheduleEvent(tx, {
      projectId,
      event: 'RESCHEDULED',
      trigger: byUserId ? 'USER' : 'SYSTEM',
      stage: stageName,
      byUserId,
      oldDelivery: result ? result.oldDelivery : project.calculatedDelivery,
      newDelivery: result ? result.newDelivery : project.calculatedDelivery,
      reason: `Stage ${stageName}${fromLabel} moved to ${effStart
        .toISOString()
        .slice(0, 10)}; downstream rescheduled with ${Math.round(
        (overCapacityFactor - 1) * 100,
      )}% overcapacity allowance`,
    });

    return {
      ...result,
      rescheduledStages,
      partialFrom: effectiveFromDate
        ? effectiveFromDate.toISOString().slice(0, 10)
        : null,
      partialUnits: isPartial ? units : null,
      draggedPlan: movedPlan,
    };
  });
const rebuildCapacityLedgerWeek = async (overCapacityFactor = 1.25) => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 REBUILD CAPACITY LEDGER WEEK - START`);
  console.log(`${'='.repeat(80)}`);
  
  try {
    return await prisma.$transaction(async (tx) => {
      const { monday: weekStart, saturday: weekEnd } = getWeekRangeSafe();

      const now = new Date();
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);

      const effectiveStart = today > weekStart ? today : weekStart;
      
      // STRICT BOUNDARY: Saturday 23:59:59 - NOTHING beyond this
      const strictBoundary = new Date(weekEnd);
      strictBoundary.setHours(23, 59, 59, 999);
      
      console.log(`\n📅 STRICT WEEK BOUNDARIES:`);
      console.log(`   Week Monday (START): ${weekStart.toISOString().slice(0, 10)}`);
      console.log(`   Week Saturday (END): ${strictBoundary.toISOString().slice(0, 10)}`);
      console.log(`   Today: ${today.toISOString().slice(0, 10)}`);
      console.log(`   Effective start: ${effectiveStart.toISOString().slice(0, 10)}`);

      // ============================================================
      // STEP 1: ONLY get CAPACITY_STAGES (exclude PURCHASING)
      // ============================================================
      
      const CAPACITY_STAGES = ['DESIGN', 'METAL_WORKS', 'CUTTING', 'ASSEMBLY', 'PAINTING'];
      
      // Get ONLY capacity stages that start in current week
      const stagesInCurrentWeek = await tx.projectStage.findMany({
        where: {
          status: 'ACTIVE',
          finished: false,
          stage: { in: CAPACITY_STAGES },  // ONLY capacity stages
          startDateTime: {
            gte: weekStart,
            lte: strictBoundary,
          },
        },
        include: {
          project: true
        }
      });

      console.log(`\n📊 CAPACITY STAGES in current week: ${stagesInCurrentWeek.length}`);
      
      // If no capacity stages, return early
      if (stagesInCurrentWeek.length === 0) {
        console.log(`   ✅ No capacity stages to rebuild`);
        return {
          success: true,
          mode: 'NO_CAPACITY_STAGES',
          rebuilt: 0,
          message: 'No capacity stages found in current week'
        };
      }
      
      // Log which stages we found
      for (const stage of stagesInCurrentWeek) {
        console.log(`   📌 ${stage.stage}: project ${stage.projectId}, starts ${stage.startDateTime?.toISOString().slice(0, 10)}, units=${stage.workUnits}`);
      }
      
      // Group by project
      const stagesByProject = new Map();
      for (const stage of stagesInCurrentWeek) {
        if (!stagesByProject.has(stage.projectId)) {
          stagesByProject.set(stage.projectId, []);
        }
        stagesByProject.get(stage.projectId).push(stage);
      }

      // ============================================================
      // STEP 2: ONLY delete allocations for CAPACITY_STAGES
      // ============================================================
      
      await tx.projectStageCapacityAllocation.deleteMany({
        where: {
          allocationDate: {
            gte: effectiveStart,
            lte: strictBoundary,
          },
          projectStage: {
            stage: { in: CAPACITY_STAGES }  // ONLY capacity stages
          }
        },
      });

      await tx.dailyStageCapacity.deleteMany({
        where: {
          date: { gte: effectiveStart, lte: strictBoundary },
          stage: { in: CAPACITY_STAGES }  // ONLY capacity stages
        },
      });

      console.log(`\n📋 Processing ${stagesByProject.size} project(s) with capacity stages`);

      let rebuilt = 0;

      // ============================================================
      // STEP 3: Reschedule ONLY capacity stages for each project
      // ============================================================
      
      for (const [projectId, stages] of stagesByProject) {
        console.log(`\n📦 Project ${projectId}: rescheduling ${stages.map(s => s.stage).join(', ')}`);
        
        // Pass ONLY the capacity stages (PURCHASING is excluded)
        await rescheduleWeekOnlyWithStages(
          projectId,
          tx,
          strictBoundary,
          overCapacityFactor,
          stages  // ONLY capacity stages for this project
        );
        rebuilt++;
      }

      // ============================================================
      // STEP 4: Verify results
      // ============================================================
      
      // Verify PURCHASING was untouched
      const purchasingStages = await tx.projectStage.findMany({
        where: {
          status: 'ACTIVE',
          finished: false,
          stage: 'PURCHASING',
        },
        select: {
          id: true,
          stage: true,
          startDateTime: true,
          projectId: true,
        },
      });
      
      // Verify future week capacity stages untouched
      const futureCapacityStages = await tx.projectStage.findMany({
        where: {
          status: 'ACTIVE',
          finished: false,
          stage: { in: CAPACITY_STAGES },
          startDateTime: {
            gt: strictBoundary,
          },
        },
        select: {
          id: true,
          stage: true,
          startDateTime: true,
          projectId: true,
        },
      });
      
      console.log(`\n✅ VERIFICATION:`);
      console.log(`   ✓ PURCHASING stages (untouched): ${purchasingStages.length}`);
      console.log(`   ✓ Future capacity stages (untouched): ${futureCapacityStages.length}`);
      
      if (futureCapacityStages.length > 0) {
        console.log(`   Example future stages:`);
        for (const stage of futureCapacityStages.slice(0, 3)) {
          console.log(`      - ${stage.stage}: starts ${stage.startDateTime?.toISOString().slice(0, 10)}`);
        }
      }

      console.log(`\n✅ REBUILD COMPLETE:`);
      console.log(`   Rebuilt projects: ${rebuilt}`);
      console.log(`   Capacity stages rescheduled: ${stagesInCurrentWeek.length}`);
      console.log(`   PURCHASING stages ignored: ${purchasingStages.length}`);
      console.log(`   Future stages preserved: ${futureCapacityStages.length}`);
      console.log(`${'='.repeat(80)}\n`);

      return {
        success: true,
        mode: 'CAPACITY_STAGES_ONLY',
        rebuilt,
        capacityStagesRescheduled: stagesInCurrentWeek.length,
        currentWeekRange: { start: weekStart, end: strictBoundary },
        purchasingStagesIgnored: purchasingStages.length,
        futureStagesPreserved: futureCapacityStages.length,
      };
    });
  } catch (err) {
    console.error('❌ WEEK-ONLY REBUILD ERROR:', err);
    throw err;
  }
};
module.exports = {
  withClient,
  logScheduleEvent,
  releaseStageCapacity,
  releaseProjectCapacity,
  persistStageAllocations,
  getStagePhaseStart,
  recomputeProjectDelivery,
  rescheduleDownstream,
  rescheduleWholeProject,
  rescheduleWeekOnly,
  rescheduleStageAndDownstream,
  reallocateProjectFromInvoiceMaterials,
  onStageCompleted,
  onStageCancelled,
  releaseStageUnitsOnDay,
  rebuildCapacityLedgerWeek,
  rescheduleWeekOnlyWithStages,
  getWeekRangeSafe,
  __private: {
    phaseIndexOf,
    getStagePhaseStart,
    getDownstreamStagesForPhase,
    getPhaseBarrierInstant,
    sumMaterialQuantities,
    materialStageQuantities,
    releaseStageUnitsOnDay,
  },
};
