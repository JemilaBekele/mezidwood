const updateProjectTotalQuantity = async (projectId) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      invoice: {
        include: {
          items: {
            include: {
              proformaItemMaterials: {
                include: {
                  material: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!project) return;

  let totalLaminatedMDFQuantity = 0;
  let totalPlainMDFQuantity = 0;
  let totalWoodQuantity = 0;
  let totalMetalQuantity = 0;
  let totalOtherQuantity = 0;

  project.invoice.items.forEach((item) => {
    item.proformaItemMaterials.forEach((pim) => {
      const { quantity } = pim;
      const { material } = pim;

      if (material?.laminatedMDF) {
        totalLaminatedMDFQuantity += quantity;
      } else if (material?.plainMDF) {
        totalPlainMDFQuantity += quantity;
      } else if (material?.wood) {
        totalWoodQuantity += quantity;
      } else if (material?.metal) {
        totalMetalQuantity += quantity;
      } else {
        totalOtherQuantity += quantity;
      }
    });
  });

  const totalProjectQuantity =
    totalLaminatedMDFQuantity +
    totalPlainMDFQuantity +
    totalWoodQuantity +
    totalMetalQuantity +
    totalOtherQuantity;

  await prisma.project.update({
    where: { id: projectId },
    data: { totalProjectQuantity },
  });
};
const updateProjectStage = async (projectId, stageName, newQuantity, userId, allowOverCapacity = false) => {
  console.log('=== START updateProjectStage ===');
  console.log('projectId:', projectId);
  console.log('stageName:', stageName);
  console.log('newQuantity:', newQuantity);
  console.log('userId:', userId);
  console.log('allowOverCapacity:', allowOverCapacity);

  // Define enums based on your schema
  const ProjectStatus = {
    INVOICE: 'INVOICE',
    DESIGN: 'DESIGN',
    PURCHASING: 'PURCHASING',
    METAL_WORKS: 'METAL_WORKS',
    CNC: 'CNC',
    CUTTING: 'CUTTING',
    EDGE_BANDING: 'EDGE_BANDING',
    ASSEMBLY: 'ASSEMBLY',
    PAINTING: 'PAINTING',
    FINISHING: 'FINISHING',
    DELIVERY: 'DELIVERY',
    INSTALLATION: 'INSTALLATION',
  };

  // Working hours per day
  const WORKING_HOURS_PER_DAY = 7.5;

  // Helper function to check if a date is a business day
  const isBusinessDay = (date) => {
    const day = date.getDay();
    return day !== 0; // Only Sunday is off
  };

  // Helper function to get next business day
  const getNextBusinessDay = (date) => {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);
    while (!isBusinessDay(nextDate)) {
      nextDate.setDate(nextDate.getDate() + 1);
    }
    return nextDate;
  };

  // Helper function to format minutes to readable string
  const formatMinutes = (minutes) => {
    if (!minutes && minutes !== 0) return 'N/A';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins} min`;
    if (mins === 0) return `${hours} hr`;
    return `${hours} hr ${mins} min`;
  };

  // Get the project with all its stages
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      stages: {
        orderBy: {
          startDate: 'asc',
        },
      },
      invoice: {
        include: {
          items: {
            include: {
              proformaItemMaterials: {
                include: {
                  material: true,
                },
              },
            },
          },
        },
      },
      customer: true,
    },
  });

  if (!project) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');
  }

  // Find the stage to update
  const targetStage = project.stages.find(stage => stage.stage === stageName);
  
  if (!targetStage) {
    throw new ApiError(httpStatus.NOT_FOUND, `Stage ${stageName} not found in project`);
  }

  // Check if stage is already completed
  if (targetStage.status === 'COMPLETED') {
    throw new ApiError(httpStatus.BAD_REQUEST, `Cannot update completed stage: ${stageName}`);
  }

  // Get all capacity lots
  const capacityLots = await prisma.capacityLot.findMany();
  const capacityMap = {};
  capacityLots.forEach((lot) => {
    capacityMap[lot.stage] = {
      days: lot.days,
      capacity: lot.capacity || 1,
      workingHours: lot.workingHours || WORKING_HOURS_PER_DAY,
    };
  });

  // Get all daily stage capacity records for this stage
  const dailyCapacityRecords = await prisma.dailyStageCapacity.findMany({
    where: {
      stage: stageName,
      date: {
        gte: targetStage.startDate,
        lte: targetStage.endDate,
      },
    },
  });

  // Helper function to get available regular hours for a specific stage and date
  const getAvailableRegularHours = async (stage, date, excludeCurrentProject = true) => {
    const normalizedDate = new Date(date);
    normalizedDate.setHours(0, 0, 0, 0);

    const dailyRecord = await prisma.dailyStageCapacity.findUnique({
      where: {
        stage_date: {
          stage,
          date: normalizedDate,
        },
      },
    });

    let regularUsedHours = dailyRecord?.usedHours || 0;
    
    // If we're recalculating, subtract the current project's usage for these dates
    if (excludeCurrentProject && dailyCapacityRecords.length > 0) {
      const currentDayRecord = dailyCapacityRecords.find(
        record => record.date.toDateString() === normalizedDate.toDateString()
      );
      if (currentDayRecord) {
        regularUsedHours -= (currentDayRecord.usedHours || 0);
      }
    }

    const maxHours = WORKING_HOURS_PER_DAY;
    const regularAvailable = Math.max(0, maxHours - regularUsedHours);
    
    return regularAvailable;
  };

  // Helper function to get available over-capacity hours for a specific stage and date
  const getAvailableOverCapacityHours = async (stage, date, excludeCurrentProject = true) => {
    const normalizedDate = new Date(date);
    normalizedDate.setHours(0, 0, 0, 0);

    const dailyRecord = await prisma.dailyStageCapacity.findUnique({
      where: {
        stage_date: {
          stage,
          date: normalizedDate,
        },
      },
    });

    let overUsedHours = dailyRecord?.overHoursCapacityUsed || 0;
    
    // If we're recalculating, subtract the current project's usage for these dates
    if (excludeCurrentProject && dailyCapacityRecords.length > 0) {
      const currentDayRecord = dailyCapacityRecords.find(
        record => record.date.toDateString() === normalizedDate.toDateString()
      );
      if (currentDayRecord) {
        overUsedHours -= (currentDayRecord.overHoursCapacityUsed || 0);
      }
    }

    const maxHours = WORKING_HOURS_PER_DAY;
    const overAvailable = Math.max(0, maxHours - overUsedHours);
    
    return overAvailable;
  };

  // Calculate required hours for a stage
  const calculateRequiredHours = (stage, quantity) => {
    if (quantity <= 0) return 0;
    const capacityInfo = capacityMap[stage];
    if (!capacityInfo) {
      return quantity * WORKING_HOURS_PER_DAY;
    }
    return (quantity / capacityInfo.capacity) * WORKING_HOURS_PER_DAY;
  };

  // Calculate required minutes for a stage
  const calculateRequiredMinutes = (stage, quantity) => {
    const hours = calculateRequiredHours(stage, quantity);
    return Math.round(hours * 60);
  };

  // Calculate actual units based on hours assigned
  const calculateActualUnits = (hoursAssigned, stage) => {
    const capacityInfo = capacityMap[stage];
    if (!capacityInfo) {
      return Math.ceil(hoursAssigned / WORKING_HOURS_PER_DAY);
    }
    const unitsPerHour = capacityInfo.capacity / WORKING_HOURS_PER_DAY;
    return Math.ceil(hoursAssigned * unitsPerHour);
  };

  // Reallocate capacity for the updated stage
  const reallocateStageCapacity = async (stage, totalQuantity, startDate, oldAllocations = []) => {
    if (totalQuantity <= 0) return null;

    // First, remove old allocations
    for (const oldAlloc of oldAllocations) {
      const oldDate = new Date(oldAlloc.date);
      oldDate.setHours(0, 0, 0, 0);
      
      await prisma.dailyStageCapacity.update({
        where: {
          stage_date: {
            stage,
            date: oldDate,
          },
        },
        data: {
          usedHours: {
            decrement: oldAlloc.usedHours || 0,
          },
          usedCapacity: {
            decrement: oldAlloc.usedCapacity || 0,
          },
          overCapacityUsed: {
            decrement: oldAlloc.overCapacityUsed || 0,
          },
          overHoursCapacityUsed: {
            decrement: oldAlloc.overHoursCapacityUsed || 0,
          },
        },
      });
    }

    const capacityInfo = capacityMap[stage];
    if (!capacityInfo) {
      const startDateTime = new Date(startDate);
      startDateTime.setHours(8, 0, 0, 0);
      const endDateTime = new Date(startDateTime);
      const hoursNeeded = totalQuantity * WORKING_HOURS_PER_DAY;
      endDateTime.setHours(
        8 + Math.floor(hoursNeeded),
        (hoursNeeded % 1) * 60,
        0,
        0,
      );

      return {
        startDateTime,
        endDateTime,
        allocations: [{
          date: startDateTime,
          hours: hoursNeeded,
          units: totalQuantity,
          usedHours: hoursNeeded,
          usedCapacity: totalQuantity,
          overCapacityUsed: 0,
          overHoursCapacityUsed: 0,
        }],
        totalHours: hoursNeeded,
        totalMinutes: Math.round(hoursNeeded * 60),
        totalActualUnits: totalQuantity,
      };
    }

    let requiredHours = calculateRequiredHours(stage, totalQuantity);
    let currentDateTime = new Date(startDate);
    currentDateTime.setHours(8, 0, 0, 0);
    const allocations = [];
    let firstWorkDate = null;
    let lastEndDateTime = null;
    const unitsPerHour = capacityInfo.capacity / WORKING_HOURS_PER_DAY;
    let totalOverCapacityUnits = 0;
    let totalOverCapacityHours = 0;

    const requiredMinutes = requiredHours * 60;
    console.log(`\n   📍 [${stage}] ${totalQuantity} planned units = ${requiredMinutes} minutes (${requiredHours.toFixed(2)} hours)`);
    console.log(`   📊 Capacity: ${capacityInfo.capacity} units/day = ${WORKING_HOURS_PER_DAY} hours/day`);
    console.log(`   📈 Production rate: ${unitsPerHour.toFixed(2)} units/hour`);
    console.log(`   🔓 Over-capacity allowed: ${allowOverCapacity}`);

    while (requiredHours > 0.01) {
      const currentDateOnly = new Date(currentDateTime);
      currentDateOnly.setHours(0, 0, 0, 0);

      if (!isBusinessDay(currentDateOnly)) {
        currentDateTime = new Date(getNextBusinessDay(currentDateOnly));
        currentDateTime.setHours(8, 0, 0, 0);
        continue;
      }

      // Get available regular and over-capacity hours
      const regularAvailableHours = await getAvailableRegularHours(stage, currentDateOnly, true);
      const overAvailableHours = await getAvailableOverCapacityHours(stage, currentDateOnly, true);
      
      let availableHours = 0;
      let isOverCapacity = false;

      // Check if regular capacity is available
      if (regularAvailableHours > 0.01) {
        // Use regular capacity first
        availableHours = Math.min(requiredHours, regularAvailableHours);
        isOverCapacity = false;
        console.log(`      📍 ${currentDateOnly.toISOString().split('T')[0]}: Regular capacity available: ${regularAvailableHours.toFixed(2)} hours`);
      } 
      // If regular capacity is full and over-capacity is allowed
      else if (allowOverCapacity && overAvailableHours > 0.01) {
        availableHours = Math.min(requiredHours, overAvailableHours);
        isOverCapacity = true;
        console.log(`      ⚠️ ${currentDateOnly.toISOString().split('T')[0]}: Regular capacity FULL, using OVER-CAPACITY (${overAvailableHours.toFixed(2)} hours available)`);
      }
      // If no capacity available at all
      else {
        console.log(`      ⏭️ ${currentDateOnly.toISOString().split('T')[0]}: No capacity available (Regular: ${regularAvailableHours.toFixed(2)}h, Over: ${overAvailableHours.toFixed(2)}h), skipping to next day`);
        currentDateTime = new Date(getNextBusinessDay(currentDateOnly));
        currentDateTime.setHours(8, 0, 0, 0);
        continue;
      }

      const hoursToAssign = Math.min(requiredHours, availableHours);
      const unitsToAssign = calculateActualUnits(hoursToAssign, stage);
      const minutesToAssign = Math.round(hoursToAssign * 60);
      
      let overCapacityUnits = 0;
      let overCapacityHours = 0;
      
      if (isOverCapacity) {
        overCapacityUnits = unitsToAssign;
        overCapacityHours = hoursToAssign;
        totalOverCapacityUnits += overCapacityUnits;
        totalOverCapacityHours += overCapacityHours;
      }

      // Update or create daily stage capacity record
      await prisma.$transaction(async (tx) => {
        const existingRecord = await tx.dailyStageCapacity.findUnique({
          where: {
            stage_date: {
              stage,
              date: currentDateOnly,
            },
          },
        });

        if (isOverCapacity) {
          const currentOverCapacity = existingRecord?.overCapacityUsed || 0;
          const currentOverHours = existingRecord?.overHoursCapacityUsed || 0;
          
          await tx.dailyStageCapacity.upsert({
            where: {
              stage_date: {
                stage,
                date: currentDateOnly,
              },
            },
            update: {
              overCapacityUsed: currentOverCapacity + overCapacityUnits,
              overHoursCapacityUsed: currentOverHours + overCapacityHours,
            },
            create: {
              stage,
              date: currentDateOnly,
              usedHours: 0,
              usedCapacity: 0,
              maxCapacity: capacityInfo.capacity,
              maxHours: WORKING_HOURS_PER_DAY,
              workingHours: WORKING_HOURS_PER_DAY,
              overCapacityUsed: overCapacityUnits,
              overHoursCapacityUsed: overCapacityHours,
            },
          });
        } else {
          const currentUsedHours = existingRecord?.usedHours || 0;
          const currentUsedCapacity = existingRecord?.usedCapacity || 0;
          
          await tx.dailyStageCapacity.upsert({
            where: {
              stage_date: {
                stage,
                date: currentDateOnly,
              },
            },
            update: {
              usedHours: currentUsedHours + hoursToAssign,
              usedCapacity: currentUsedCapacity + unitsToAssign,
            },
            create: {
              stage,
              date: currentDateOnly,
              usedHours: hoursToAssign,
              usedCapacity: unitsToAssign,
              maxCapacity: capacityInfo.capacity,
              maxHours: WORKING_HOURS_PER_DAY,
              workingHours: WORKING_HOURS_PER_DAY,
              overCapacityUsed: 0,
              overHoursCapacityUsed: 0,
            },
          });
        }
      });

      // Calculate end time for this day
      const dayEndDateTime = new Date(currentDateTime);
      const startHour = currentDateTime.getHours();
      const startMinute = currentDateTime.getMinutes();
      const totalMinutes = startHour * 60 + startMinute + minutesToAssign;
      dayEndDateTime.setHours(
        Math.floor(totalMinutes / 60),
        totalMinutes % 60,
        0,
        0,
      );

      allocations.push({
        date: new Date(currentDateTime),
        hours: hoursToAssign,
        minutes: minutesToAssign,
        units: unitsToAssign,
        endDateTime: new Date(dayEndDateTime),
        usedHours: isOverCapacity ? 0 : hoursToAssign,
        usedCapacity: isOverCapacity ? 0 : unitsToAssign,
        overCapacityUsed: isOverCapacity ? overCapacityUnits : 0,
        overHoursCapacityUsed: isOverCapacity ? overCapacityHours : 0,
        isOverCapacity,
      });

      if (firstWorkDate === null) {
        firstWorkDate = new Date(currentDateTime);
      }

      lastEndDateTime = new Date(dayEndDateTime);
      requiredHours -= hoursToAssign;

      const capacityType = isOverCapacity ? '🔥 OVER-CAPACITY' : '✓ NORMAL';
      console.log(`      ${currentDateOnly.toISOString().split('T')[0]} [${capacityType}]: ${minutesToAssign} minutes (${hoursToAssign.toFixed(2)} hours) → ${unitsToAssign} units (ends ${dayEndDateTime.toLocaleTimeString()})`);

      if (requiredHours > 0.01) {
        // Move to next business day
        currentDateTime = new Date(getNextBusinessDay(currentDateOnly));
        currentDateTime.setHours(8, 0, 0, 0);
      }
    }

    const totalHours = allocations.reduce((sum, alloc) => sum + alloc.hours, 0);
    const totalMinutes = Math.round(totalHours * 60);
    const totalActualUnits = allocations.reduce((sum, alloc) => sum + alloc.units, 0);

    console.log(`\n   ✅ [${stage}] Summary:`);
    console.log(`      Planned: ${totalQuantity} units, ${calculateRequiredMinutes(stage, totalQuantity)} minutes`);
    console.log(`      Actual: ${totalActualUnits} units, ${totalMinutes} minutes`);
    if (totalOverCapacityUnits > 0) {
      console.log(`      ⚠️ Over-capacity used: ${totalOverCapacityUnits} units (${totalOverCapacityHours.toFixed(2)} hours)`);
    }

    return {
      startDateTime: firstWorkDate,
      endDateTime: lastEndDateTime,
      allocations,
      totalHours,
      totalMinutes,
      totalActualUnits,
      totalOverCapacityUnits,
      totalOverCapacityHours,
    };
  };

  // Get old allocation details from daily capacity records
  const oldAllocations = dailyCapacityRecords.map(record => ({
    date: record.date,
    usedHours: record.usedHours,
    usedCapacity: record.usedCapacity,
    overCapacityUsed: record.overCapacityUsed,
    overHoursCapacityUsed: record.overHoursCapacityUsed,
  }));

  // Reallocate the stage with new quantity
  const newAllocation = await reallocateStageCapacity(
    stageName,
    newQuantity,
    targetStage.startDate,
    oldAllocations
  );

  if (!newAllocation) {
    // If quantity is 0, just delete the stage or mark as skipped
    await prisma.projectStage.update({
      where: { id: targetStage.id },
      data: {
        workUnits: 0,
        timeTaken: 0,
        status: 'SKIPPED',
        endDate: targetStage.startDate,
      },
    });
    
    // Update project total quantity if needed
    await updateProjectTotalQuantity(projectId);
    
    return { message: `Stage ${stageName} has been skipped (quantity set to 0)` };
  }

  // Update the stage with new allocation
  const updatedStage = await prisma.projectStage.update({
    where: { id: targetStage.id },
    data: {
      workUnits: newQuantity,
      timeTaken: newAllocation.totalMinutes,
      actualWorkUnits: newAllocation.totalActualUnits,
      endDate: newAllocation.endDateTime,
      capacityDays: newAllocation.allocations.length,
      status: 'ACTIVE',
      overCapacityUsed: newAllocation.totalOverCapacityUnits || 0,
      overHoursUsed: newAllocation.totalOverCapacityHours || 0,
    },
  });

  // Update subsequent stages (recalculate from this stage onward)
  const subsequentStages = project.stages.filter(
    stage => stage.startDate > targetStage.startDate
  );

  let currentDateTime = newAllocation.endDateTime;
  const updatedSubsequentStages = [];

  for (const subsequentStage of subsequentStages) {
    console.log(`\n🔄 Recalculating subsequent stage: ${subsequentStage.stage}`);
    
    // Get the original quantity for this stage
    const originalStage = project.stages.find(s => s.stage === subsequentStage.stage);
    const stageQuantity = originalStage?.workUnits || 0;
    
    if (stageQuantity <= 0) continue;
    
    // Get old allocations for this stage to remove them
    const stageDailyRecords = await prisma.dailyStageCapacity.findMany({
      where: {
        stage: subsequentStage.stage,
        date: {
          gte: subsequentStage.startDate,
          lte: subsequentStage.endDate,
        },
      },
    });
    
    const oldStageAllocations = stageDailyRecords.map(record => ({
      date: record.date,
      usedHours: record.usedHours,
      usedCapacity: record.usedCapacity,
      overCapacityUsed: record.overCapacityUsed,
      overHoursCapacityUsed: record.overHoursCapacityUsed,
    }));
    
    // Reallocate the subsequent stage
    const newStageAllocation = await reallocateStageCapacity(
      subsequentStage.stage,
      stageQuantity,
      currentDateTime,
      oldStageAllocations
    );
    
    if (newStageAllocation) {
      const updatedStageRecord = await prisma.projectStage.update({
        where: { id: subsequentStage.id },
        data: {
          startDate: newStageAllocation.startDateTime,
          endDate: newStageAllocation.endDateTime,
          timeTaken: newStageAllocation.totalMinutes,
          actualWorkUnits: newStageAllocation.totalActualUnits,
          capacityDays: newStageAllocation.allocations.length,
          overCapacityUsed: newStageAllocation.totalOverCapacityUnits || 0,
          overHoursUsed: newStageAllocation.totalOverCapacityHours || 0,
        },
      });
      
      updatedSubsequentStages.push(updatedStageRecord);
      currentDateTime = newStageAllocation.endDateTime;
    }
  }

  // Calculate new project delivery date
  const allStages = await prisma.projectStage.findMany({
    where: { projectId },
    orderBy: { startDate: 'asc' },
  });
  
  const lastStage = allStages[allStages.length - 1];
  const newDeliveryDate = lastStage?.endDate || project.calculatedDelivery;

  // Calculate actual business days between first and last stage
  const calculateActualBusinessDays = (startDate, endDate) => {
    let count = 0;
    const current = new Date(startDate);
    const end = new Date(endDate);
    current.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    while (current <= end) {
      if (isBusinessDay(current)) {
        count++;
      }
      current.setDate(current.getDate() + 1);
    }
    return count;
  };

  const firstStage = allStages[0];
  const newProjectDays = calculateActualBusinessDays(
    firstStage?.startDate || new Date(),
    newDeliveryDate
  );

  // Update project with new delivery date and duration
  const updatedProject = await prisma.project.update({
    where: { id: projectId },
    data: {
      calculatedDelivery: newDeliveryDate,
      totalDays: newProjectDays,
      updatedById: userId,
      updatedAt: new Date(),
    },
    include: {
      stages: {
        orderBy: {
          startDate: 'asc',
        },
      },
      customer: true,
      invoice: true,
    },
  });

  // Calculate summary metrics
  const totalPlannedUnits = updatedProject.stages.reduce(
    (sum, stage) => sum + (stage.workUnits || 0),
    0
  );
  const totalActualUnits = updatedProject.stages.reduce(
    (sum, stage) => sum + (stage.actualWorkUnits || 0),
    0
  );
  const totalActualMinutes = updatedProject.stages.reduce(
    (sum, stage) => sum + (stage.timeTaken || 0),
    0
  );
  const totalOverCapacityUnits = updatedProject.stages.reduce(
    (sum, stage) => sum + (stage.overCapacityUsed || 0),
    0
  );

  console.log('\n✅ PROJECT STAGE UPDATED SUCCESSFULLY');
  console.log(`   Project ID: ${project.id}`);
  console.log(`   Updated Stage: ${stageName}`);
  console.log(`   New Quantity: ${newQuantity} units`);
  console.log(`   New Delivery Date: ${newDeliveryDate.toISOString().split('T')[0]}`);
  console.log(`   New Duration: ${newProjectDays} day(s)`);
  console.log(`   Total Actual Time: ${formatMinutes(totalActualMinutes)}`);
  console.log(`   Total Actual Units: ${totalActualUnits}`);
  if (totalOverCapacityUnits > 0) {
    console.log(`   ⚠️ Total Over-Capacity Units: ${totalOverCapacityUnits}`);
  }

  return updatedProject;
};

// Helper function to update project total quantity
// const createProject = async (projectData, userId) => {
//   console.log('=== START createProject ===');
//   console.log('projectData:', JSON.stringify(projectData, null, 2));
//   console.log('userId:', userId);

//   const {
//     customerId,
//     invoiceId,
//     status = 'INVOICE',
//     difficulty = 'EASY',
//     requestedDelivery,
//     manualStartDate,
//   } = projectData;

//   // Define enums based on your schema
//   const ProjectStatus = {
//     INVOICE: 'INVOICE',
//     DESIGN: 'DESIGN',
//     PURCHASING: 'PURCHASING',
//     METAL_WORKS: 'METAL_WORKS',
//     CNC: 'CNC',
//     CUTTING: 'CUTTING',
//     EDGE_BANDING: 'EDGE_BANDING',
//     ASSEMBLY: 'ASSEMBLY',
//     PAINTING: 'PAINTING',
//     FINISHING: 'FINISHING',
//     DELIVERY: 'DELIVERY',
//     INSTALLATION: 'INSTALLATION',
//   };

//   // Define difficulty percentage increases (for reference only)
//   const difficultyPercentages = {
//     EASY: 0.0,
//     MEDIUM: 0.4,
//     HARD: 0.5,
//   };

//   // Working hours per day
//   const WORKING_HOURS_PER_DAY = 7.5;

//   // Validate required fields
//   if (!invoiceId) {
//     console.error('Missing customerId or invoiceId');
//     throw new ApiError(
//       httpStatus.BAD_REQUEST,
//       'Customer ID and Invoice ID are required',
//     );
//   }

//     let validCustomerId = customerId;
//   let usedDefaultCustomer = false;

//   if (!customerId) {
//     console.log('No customerId provided, will use default customer');
//     usedDefaultCustomer = true;

//     // Find the default customer
//     const defaultCustomer = await prisma.customer.findFirst({
//       where: { isdefault: true },
//     });

//     if (defaultCustomer) {
//       validCustomerId = defaultCustomer.id;
//       console.log(`Using default customer: ${defaultCustomer.id} - ${defaultCustomer.name}`);
//     } else {
//       // Create default customer if it doesn't exist
//       console.log('No default customer found, creating one...');
//       const newDefaultCustomer = await prisma.customer.create({
//         data: DEFAULT_CUSTOMER,
//       });
//       validCustomerId = newDefaultCustomer.id;
//       console.log(`Created and using default customer: ${newDefaultCustomer.id}`);
//     }
//   } else {
//     // Check if the provided customer exists
//     const customerExists = await prisma.customer.findUnique({
//       where: { id: customerId },
//     });

//     if (!customerExists) {
//       console.log(`Customer ${customerId} not found, using default customer`);
//       usedDefaultCustomer = true;

//       // Find the default customer
//       const defaultCustomer = await prisma.customer.findFirst({
//         where: { isdefault: true },
//       });

//       if (defaultCustomer) {
//         validCustomerId = defaultCustomer.id;
//         console.log(`Using default customer: ${defaultCustomer.id} - ${defaultCustomer.name}`);
//       } else {
//         // Create default customer if it doesn't exist
//         console.log('No default customer found, creating one...');
//         const newDefaultCustomer = await prisma.customer.create({
//           data: DEFAULT_CUSTOMER,
//         });
//         validCustomerId = newDefaultCustomer.id;
//         console.log(`Created and using default customer: ${newDefaultCustomer.id}`);
//       }
//     } else {
//       console.log(`Using provided customer: ${customerExists.id} - ${customerExists.name}`);
//     }
//   }  // Check if invoice exists and is available
//   const invoiceExists = await prisma.proformaInvoice.findUnique({
//     where: { id: invoiceId },
//     include: {
//       project: true,
//       items: {
//         include: {
//           proformaItemMaterials: {
//             include: {
//               material: true,
//             },
//           },
//         },
//       },
//     },
//   });

//   if (!invoiceExists) {
//     console.error('Invoice not found:', invoiceId);
//     throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found');
//   }

//   if (invoiceExists.project) {
//     console.error('Invoice already has project:', invoiceId);
//     throw new ApiError(
//       httpStatus.CONFLICT,
//       'Invoice is already associated with another project',
//     );
//   }

//   // Get all capacity lots
//   const capacityLots = await prisma.capacityLot.findMany();
//   console.log('📊 Capacity lots found:', capacityLots.length);

//   // Create a map for easy lookup
//   const capacityMap = {};
//   capacityLots.forEach((lot) => {
//     capacityMap[lot.stage] = {
//       days: lot.days,
//       capacity: lot.capacity || 1,
//       workingHours: lot.workingHours || WORKING_HOURS_PER_DAY,
//     };
//   });

//   // Calculate total quantities per material type
//   let totalLaminatedMDFQuantity = 0;
//   let totalPlainMDFQuantity = 0;
//   let totalWoodQuantity = 0;
//   let totalMetalQuantity = 0;
//   let totalOtherQuantity = 0;

//   invoiceExists.items.forEach((item) => {
//     item.proformaItemMaterials.forEach((pim) => {
//       const { quantity } = pim;
//       const { material } = pim;

//       if (material?.laminatedMDF) {
//         totalLaminatedMDFQuantity += quantity;
//       } else if (material?.plainMDF) {
//         totalPlainMDFQuantity += quantity;
//       } else if (material?.wood) {
//         totalWoodQuantity += quantity;
//       } else if (material?.metal) {
//         totalMetalQuantity += quantity;
//       } else {
//         totalOtherQuantity += quantity;
//       }
//     });
//   });

//   // Calculate total project quantity
//   const totalProjectQuantity =
//     totalLaminatedMDFQuantity +
//     totalPlainMDFQuantity +
//     totalWoodQuantity +
//     totalMetalQuantity +
//     totalOtherQuantity;

//   // Determine which material types are present
//   const hasMetal = totalMetalQuantity > 0;
//   const hasWood = totalWoodQuantity > 0;
//   const hasPlainMDF = totalPlainMDFQuantity > 0;
//   const hasLaminatedMDF = totalLaminatedMDFQuantity > 0;

//   // Calculate stage quantities based on the rules
//   const stageQuantities = {
//     DESIGN: totalProjectQuantity,
//     METAL_WORKS: hasMetal ? totalMetalQuantity : 0,
//     CUTTING: totalProjectQuantity - totalMetalQuantity,
//     EDGE_BANDING: hasLaminatedMDF ? totalLaminatedMDFQuantity : 0,
//     ASSEMBLY: totalProjectQuantity - totalMetalQuantity,
//     PAINTING: totalPlainMDFQuantity + totalWoodQuantity + totalMetalQuantity,
//     FINISHING: totalProjectQuantity,
//     DELIVERY: totalProjectQuantity,
//     INSTALLATION: totalProjectQuantity,
//     CNC: 0,
//   };

//   // Helper function to format minutes to readable string
//   const formatMinutes = (minutes) => {
//     if (!minutes && minutes !== 0) return 'N/A';
//     const hours = Math.floor(minutes / 60);
//     const mins = minutes % 60;
//     if (hours === 0) return `${mins} min`;
//     if (mins === 0) return `${hours} hr`;
//     return `${hours} hr ${mins} min`;
//   };

//   // Helper function to check if a date is a business day
//   const isBusinessDay = (date) => {
//     const day = date.getDay();
//     return day !== 0; // Only Sunday is off
//   };

//   // Helper function to get next business day
//   const getNextBusinessDay = (date) => {
//     const nextDate = new Date(date);
//     nextDate.setDate(nextDate.getDate() + 1);
//     while (!isBusinessDay(nextDate)) {
//       nextDate.setDate(nextDate.getDate() + 1);
//     }
//     return nextDate;
//   };

//   // Helper function to get max date
//   const getMaxDate = (dates) => {
//     return new Date(Math.max(...dates.map((d) => d.getTime())));
//   };

//   // Helper function to get available hours for a specific stage and date
//   const getAvailableHours = async (stage, date) => {
//     const normalizedDate = new Date(date);
//     normalizedDate.setHours(0, 0, 0, 0);

//     const dailyRecord = await prisma.dailyStageCapacity.findUnique({
//       where: {
//         stage_date: {
//           stage,
//           date: normalizedDate,
//         },
//       },
//     });

//     const usedHours = dailyRecord?.usedHours || 0;
//     const maxHours = WORKING_HOURS_PER_DAY;
//     return maxHours - usedHours;
//   };

//   // Calculate required hours for a stage
//   const calculateRequiredHours = (stage, quantity) => {
//     if (quantity <= 0) return 0;
//     const capacityInfo = capacityMap[stage];
//     if (!capacityInfo) {
//       return quantity * WORKING_HOURS_PER_DAY;
//     }
//     return (quantity / capacityInfo.capacity) * WORKING_HOURS_PER_DAY;
//   };

//   // Calculate required minutes for a stage
//   const calculateRequiredMinutes = (stage, quantity) => {
//     const hours = calculateRequiredHours(stage, quantity);
//     return Math.round(hours * 60);
//   };

//   // Calculate actual units based on hours assigned
//   const calculateActualUnits = (hoursAssigned, stage) => {
//     const capacityInfo = capacityMap[stage];
//     if (!capacityInfo) {
//       return Math.ceil(hoursAssigned / WORKING_HOURS_PER_DAY);
//     }
//     const unitsPerHour = capacityInfo.capacity / WORKING_HOURS_PER_DAY;
//     return Math.ceil(hoursAssigned * unitsPerHour);
//   };

//   // Time-based capacity allocation - RETURNS end date WITH TIME, actualHours, actualUnits
//   const allocateStageCapacity = async (stage, totalQuantity, startDate) => {
//     if (totalQuantity <= 0) return null;

//     const capacityInfo = capacityMap[stage];
//     if (!capacityInfo) {
//       const startDateTime = new Date(startDate);
//       startDateTime.setHours(8, 0, 0, 0);
//       const endDateTime = new Date(startDateTime);
//       const hoursNeeded = totalQuantity * WORKING_HOURS_PER_DAY;
//       endDateTime.setHours(
//         8 + Math.floor(hoursNeeded),
//         (hoursNeeded % 1) * 60,
//         0,
//         0,
//       );

//       return {
//         firstDate: startDateTime,
//         lastDate: endDateTime,
//         allocations: [
//           {
//             date: startDateTime,
//             hours: hoursNeeded,
//             units: totalQuantity,
//           },
//         ],
//         totalHours: hoursNeeded,
//         totalActualUnits: totalQuantity,
//         endDateTime,
//       };
//     }

//     let requiredHours = calculateRequiredHours(stage, totalQuantity);
//     let currentDateTime = new Date(startDate);
//     currentDateTime.setHours(8, 0, 0, 0);
//     const allocations = [];
//     let firstWorkDate = null;
//     let lastEndDateTime = null;
//     const unitsPerHour = capacityInfo.capacity / WORKING_HOURS_PER_DAY;

//     const requiredMinutes = requiredHours * 60;
//     console.log(
//       `\n   📍 [${stage}] ${totalQuantity} planned units = ${requiredMinutes} minutes (${requiredHours.toFixed(
//         2,
//       )} hours)`,
//     );
//     console.log(
//       `   📊 Capacity: ${capacityInfo.capacity} units/day = ${WORKING_HOURS_PER_DAY} hours/day`,
//     );
//     console.log(`   📈 Production rate: ${unitsPerHour.toFixed(2)} units/hour`);

//     while (requiredHours > 0.01) {
//       const currentDateOnly = new Date(currentDateTime);
//       currentDateOnly.setHours(0, 0, 0, 0);

//       if (!isBusinessDay(currentDateOnly)) {
//         currentDateTime = new Date(getNextBusinessDay(currentDateOnly));
//         currentDateTime.setHours(8, 0, 0, 0);
//         continue;
//       }

//       const availableHours = await getAvailableHours(stage, currentDateOnly);

//       if (availableHours <= 0.01) {
//         currentDateTime = new Date(getNextBusinessDay(currentDateOnly));
//         currentDateTime.setHours(8, 0, 0, 0);
//         continue;
//       }

//       const hoursToAssign = Math.min(requiredHours, availableHours);
//       const unitsToAssign = calculateActualUnits(hoursToAssign, stage);
//       const minutesToAssign = Math.round(hoursToAssign * 60);

//       // Use transaction to prevent race conditions
//       await prisma.$transaction(async (tx) => {
//         const existingRecord = await tx.dailyStageCapacity.findUnique({
//           where: {
//             stage_date: {
//               stage,
//               date: currentDateOnly,
//             },
//           },
//         });

//         const currentUsedHours = existingRecord?.usedHours || 0;
//         const currentUsedCapacity = existingRecord?.usedCapacity || 0;

//         await tx.dailyStageCapacity.upsert({
//           where: {
//             stage_date: {
//               stage,
//               date: currentDateOnly,
//             },
//           },
//           update: {
//             usedHours: currentUsedHours + hoursToAssign,
//             usedCapacity: currentUsedCapacity + unitsToAssign,
//           },
//           create: {
//             stage,
//             date: currentDateOnly,
//             usedHours: hoursToAssign,
//             usedCapacity: unitsToAssign,
//             maxCapacity: capacityInfo.capacity,
//             maxHours: WORKING_HOURS_PER_DAY,
//             workingHours: WORKING_HOURS_PER_DAY,
//           },
//         });
//       });

//       // Calculate end time for this day
//       const dayEndDateTime = new Date(currentDateTime);
//       const startHour = currentDateTime.getHours();
//       const startMinute = currentDateTime.getMinutes();
//       const totalMinutes = startHour * 60 + startMinute + minutesToAssign;
//       dayEndDateTime.setHours(
//         Math.floor(totalMinutes / 60),
//         totalMinutes % 60,
//         0,
//         0,
//       );

//       allocations.push({
//         date: new Date(currentDateTime),
//         hours: hoursToAssign,
//         minutes: minutesToAssign,
//         units: unitsToAssign,
//         endDateTime: new Date(dayEndDateTime),
//       });

//       if (firstWorkDate === null) {
//         firstWorkDate = new Date(currentDateTime);
//       }

//       lastEndDateTime = new Date(dayEndDateTime);
//       requiredHours -= hoursToAssign;

//       console.log(
//         `      ${
//           currentDateOnly.toISOString().split('T')[0]
//         }: ${minutesToAssign} minutes (${hoursToAssign.toFixed(
//           2,
//         )} hours) → ${unitsToAssign} units (ends ${dayEndDateTime.toLocaleTimeString()})`,
//       );

//       if (requiredHours > 0.01) {
//         currentDateTime = new Date(dayEndDateTime);
//         // Move to next day but keep the same time (8:00 AM)
//         currentDateTime = new Date(getNextBusinessDay(currentDateOnly));
//         currentDateTime.setHours(8, 0, 0, 0);
//       }
//     }

//     const totalHours = allocations.reduce((sum, alloc) => sum + alloc.hours, 0);
//     const totalMinutes = Math.round(totalHours * 60);
//     const totalActualUnits = allocations.reduce(
//       (sum, alloc) => sum + alloc.units,
//       0,
//     );

//     console.log(`\n   ✅ [${stage}] Summary:`);
//     console.log(
//       `      Planned: ${totalQuantity} units, ${calculateRequiredMinutes(
//         stage,
//         totalQuantity,
//       )} minutes`,
//     );
//     console.log(
//       `      Actual: ${totalActualUnits} units, ${totalMinutes} minutes`,
//     );
//     console.log(
//       `      Utilization: ${(
//         (totalHours / (allocations.length * WORKING_HOURS_PER_DAY)) *
//         100
//       ).toFixed(1)}%`,
//     );

//     return {
//       firstDate: firstWorkDate,
//       lastDate: allocations[allocations.length - 1]?.date,
//       lastDateTime: lastEndDateTime,
//       allocations,
//       totalHours,
//       totalMinutes,
//       totalActualUnits,
//     };
//   };

//   // Schedule a stage - RETURNS end DateTime with actual time and units
//   const scheduleStage = async (stage, quantity, startDateTime) => {
//     if (quantity <= 0) return null;

//     const result = await allocateStageCapacity(stage, quantity, startDateTime);
//     if (!result) return null;

//     // Store time taken in MINUTES (not hours) for better precision
//     const timeTakenMinutes = result.totalMinutes;

//     return {
//       stage,
//       workUnits: quantity, // Planned work units
//       timeTaken: timeTakenMinutes, // Actual time taken in MINUTES
//       startDate: new Date(result.firstDate),
//       endDate: new Date(result.lastDateTime || result.lastDate),
//       startDateTime: new Date(result.firstDate),
//       endDateTime: new Date(result.lastDateTime || result.lastDate),
//       capacityDays: result.allocations.length,
//       autoSchedule: true,
//       status: 'ACTIVE',
//     };
//   };

//   // Schedule parallel stages - ALL start at the SAME dateTime
//   const scheduleParallelStages = async (stages, startDateTime, groupName) => {
//     const validStages = stages.filter((s) => s.quantity > 0);

//     if (validStages.length === 0) {
//       return {
//         records: [],
//         endDateTime: startDateTime,
//       };
//     }

//     console.log(`\n🔄 PARALLEL Group: ${groupName}`);
//     console.log(`   Stages: ${validStages.map((s) => s.name).join(', ')}`);
//     console.log(
//       `   All start at: ${
//         startDateTime.toISOString().split('T')[0]
//       } ${startDateTime.toLocaleTimeString()}`,
//     );

//     const results = await Promise.all(
//       validStages.map(async ({ name, quantity }) => {
//         return await scheduleStage(name, quantity, startDateTime);
//       }),
//     );

//     const validResults = results.filter((r) => r !== null);
//     // End date is the LATEST finishing stage
//     const endDateTimes = validResults.map((r) => r.endDateTime);
//     const latestEndDateTime =
//       endDateTimes.length > 0
//         ? new Date(Math.max(...endDateTimes.map((d) => d.getTime())))
//         : startDateTime;

//     console.log(
//       `   Latest completion: ${
//         latestEndDateTime.toISOString().split('T')[0]
//       } ${latestEndDateTime.toLocaleTimeString()}`,
//     );

//     return {
//       records: validResults,
//       endDateTime: latestEndDateTime,
//     };
//   };

//   // ============ SCHEDULE PROJECT STAGES ============
//   const projectStages = [];
//   let currentDateTime = new Date(
//     manualStartDate && manualStartDate !== ''
//       ? new Date(manualStartDate)
//       : new Date(),
//   );
//   currentDateTime.setHours(8, 0, 0, 0);

//   if (!isBusinessDay(currentDateTime)) {
//     currentDateTime = new Date(getNextBusinessDay(currentDateTime));
//     currentDateTime.setHours(8, 0, 0, 0);
//   }

//   console.log(`\n${'='.repeat(60)}`);
//   console.log(
//     `🚀 START DATE/TIME: ${
//       currentDateTime.toISOString().split('T')[0]
//     } ${currentDateTime.toLocaleTimeString()}`,
//   );
//   console.log(`${'='.repeat(60)}`);

//   // GROUP 1: Design & Purchasing (Parallel)
//   console.log(`\n📋 GROUP 1: Design & Purchasing (Parallel)`);

//   const designStage = await scheduleStage(
//     'DESIGN',
//     stageQuantities.DESIGN,
//     currentDateTime,
//   );
//   projectStages.push(designStage);

//   // Purchasing runs parallel with Design - starts same time, ends when Design ends
//   // Purchasing doesn't use capacity hours (manual stage)
//   const purchasingTimeTaken = Math.round(
//     (designStage.endDateTime - designStage.startDateTime) / (1000 * 60),
//   ); // Minutes

//   projectStages.push({
//     stage: 'PURCHASING',
//     workUnits: totalProjectQuantity,
//     timeTaken: purchasingTimeTaken,
//     startDate: new Date(currentDateTime),
//     endDate: new Date(designStage.endDateTime),
//     startDateTime: new Date(currentDateTime),
//     endDateTime: new Date(designStage.endDateTime),
//     capacityDays: 1,
//     autoSchedule: true,
//     status: 'ACTIVE',
//   });

//   // Next group starts at the MAX end time of this group
//   currentDateTime = new Date(designStage.endDateTime);
//   console.log(
//     `   Group 1 completes at: ${
//       currentDateTime.toISOString().split('T')[0]
//     } ${currentDateTime.toLocaleTimeString()}`,
//   );

//   // GROUP 2: Metal Works (if exists)
//   if (hasMetal) {
//     console.log(`\n📋 GROUP 2: Metal Works`);
//     const metalStage = await scheduleStage(
//       'METAL_WORKS',
//       stageQuantities.METAL_WORKS,
//       currentDateTime,
//     );
//     if (metalStage) {
//       projectStages.push(metalStage);
//       currentDateTime = new Date(metalStage.endDateTime);
//       console.log(
//         `   Metal Works completes at: ${
//           currentDateTime.toISOString().split('T')[0]
//         } ${currentDateTime.toLocaleTimeString()}`,
//       );
//     }
//   }

//   // GROUP 3: Cutting & Edge Banding (Parallel)
//   console.log(`\n📋 GROUP 3: Cutting & Edge Banding (Parallel)`);
//   const cuttingEdgeStages = [];
//   if (stageQuantities.CUTTING > 0)
//     cuttingEdgeStages.push({
//       name: 'CUTTING',
//       quantity: stageQuantities.CUTTING,
//     });
//   if (stageQuantities.EDGE_BANDING > 0)
//     cuttingEdgeStages.push({
//       name: 'EDGE_BANDING',
//       quantity: stageQuantities.EDGE_BANDING,
//     });

//   const group3Results = await scheduleParallelStages(
//     cuttingEdgeStages,
//     currentDateTime,
//     'Cutting & Edge Banding',
//   );
//   if (group3Results.records.length > 0) {
//     projectStages.push(...group3Results.records);
//     currentDateTime = new Date(group3Results.endDateTime);
//     console.log(
//       `   Group 3 completes at: ${
//         currentDateTime.toISOString().split('T')[0]
//       } ${currentDateTime.toLocaleTimeString()}`,
//     );
//   }

//   // GROUP 4: Assembly & Painting (Parallel)
//   console.log(`\n📋 GROUP 4: Assembly & Painting (Parallel)`);
//   const assemblyPaintingStages = [];
//   if (stageQuantities.ASSEMBLY > 0)
//     assemblyPaintingStages.push({
//       name: 'ASSEMBLY',
//       quantity: stageQuantities.ASSEMBLY,
//     });
//   if (stageQuantities.PAINTING > 0)
//     assemblyPaintingStages.push({
//       name: 'PAINTING',
//       quantity: stageQuantities.PAINTING,
//     });

//   const group4Results = await scheduleParallelStages(
//     assemblyPaintingStages,
//     currentDateTime,
//     'Assembly & Painting',
//   );
//   if (group4Results.records.length > 0) {
//     projectStages.push(...group4Results.records);
//     currentDateTime = new Date(group4Results.endDateTime);
//     console.log(
//       `   Group 4 completes at: ${
//         currentDateTime.toISOString().split('T')[0]
//       } ${currentDateTime.toLocaleTimeString()}`,
//     );
//   }

//   // GROUP 5: Finishing (Sequential)
//   console.log(`\n📋 GROUP 5: Finishing`);
//   const finishingStage = await scheduleStage(
//     'FINISHING',
//     stageQuantities.FINISHING,
//     currentDateTime,
//   );
//   projectStages.push(finishingStage);
//   currentDateTime = new Date(finishingStage.endDateTime);
//   console.log(
//     `   Finishing completes at: ${
//       currentDateTime.toISOString().split('T')[0]
//     } ${currentDateTime.toLocaleTimeString()}`,
//   );

//   // GROUP 6: Delivery (Sequential)
//   console.log(`\n📋 GROUP 6: Delivery`);
//   const deliveryStage = await scheduleStage(
//     'DELIVERY',
//     stageQuantities.DELIVERY,
//     currentDateTime,
//   );
//   projectStages.push(deliveryStage);
//   currentDateTime = new Date(deliveryStage.endDateTime);
//   console.log(
//     `   Delivery completes at: ${
//       currentDateTime.toISOString().split('T')[0]
//     } ${currentDateTime.toLocaleTimeString()}`,
//   );

//   // GROUP 7: Installation (Sequential)
//   console.log(`\n📋 GROUP 7: Installation`);
//   const installationStage = await scheduleStage(
//     'INSTALLATION',
//     stageQuantities.INSTALLATION,
//     currentDateTime,
//   );
//   projectStages.push(installationStage);

//   // Sort stages by start date
//   projectStages.sort((a, b) => a.startDateTime - b.startDateTime);
//   const calculatedDelivery =
//     projectStages[projectStages.length - 1]?.endDateTime || new Date();

//   // ============ USE ACTUAL SCHEDULE DURATION (NOT ESTIMATE) ============
//   // Calculate actual project duration from the schedule
//   const firstStageStart = projectStages[0]?.startDateTime || currentDateTime;
//   const lastStageEnd =
//     projectStages[projectStages.length - 1]?.endDateTime || currentDateTime;

//   // Calculate actual business days between start and end
//   const calculateActualBusinessDays = (startDate, endDate) => {
//     let count = 0;
//     const current = new Date(startDate);
//     const end = new Date(endDate);
//     current.setHours(0, 0, 0, 0);
//     end.setHours(0, 0, 0, 0);

//     while (current <= end) {
//       if (isBusinessDay(current)) {
//         count++;
//       }
//       current.setDate(current.getDate() + 1);
//     }
//     return count;
//   };

//   const actualProjectDays = calculateActualBusinessDays(
//     firstStageStart,
//     lastStageEnd,
//   );

//   console.log(`\n${'='.repeat(60)}`);
//   console.log(`📋 FINAL SCHEDULE (WITH TIMES & ACTUAL METRICS)`);
//   console.log(`${'='.repeat(60)}`);
//   projectStages.forEach((stage) => {
//     const startStr = stage.startDateTime
//       ? `${
//           stage.startDateTime.toISOString().split('T')[0]
//         } ${stage.startDateTime.toLocaleTimeString()}`
//       : stage.startDate?.toISOString().split('T')[0];
//     const endStr = stage.endDateTime
//       ? `${
//           stage.endDateTime.toISOString().split('T')[0]
//         } ${stage.endDateTime.toLocaleTimeString()}`
//       : stage.endDate?.toISOString().split('T')[0];

//     const plannedMinutes = calculateRequiredMinutes(
//       stage.stage,
//       stage.workUnits,
//     );

//     console.log(`   ${stage.stage}: ${startStr} → ${endStr}`);
//     console.log(
//       `      📊 Planned: ${stage.workUnits || 0} units (${formatMinutes(
//         plannedMinutes,
//       )})`,
//     );
//     console.log(
//       `      ✅ Actual: ${stage.actualWorkUnits || 0} units (${formatMinutes(
//         stage.timeTaken || 0,
//       )})`,
//     );
//   });
//   console.log(
//     `\n🎯 DELIVERY: ${
//       calculatedDelivery.toISOString().split('T')[0]
//     } ${calculatedDelivery.toLocaleTimeString()}`,
//   );
//   console.log(`📊 ACTUAL PROJECT DURATION: ${actualProjectDays} day(s)`);

//   // Calculate total actual vs planned
//   const totalPlannedUnits = projectStages.reduce(
//     (sum, s) => sum + (s.workUnits || 0),
//     0,
//   );
//   const totalActualUnits = projectStages.reduce(
//     (sum, s) => sum + (s.actualWorkUnits || 0),
//     0,
//   );
//   const totalPlannedMinutes = projectStages.reduce((sum, s) => {
//     if (s.workUnits) {
//       return sum + calculateRequiredMinutes(s.stage, s.workUnits);
//     }
//     return sum;
//   }, 0);
//   const totalActualMinutes = projectStages.reduce(
//     (sum, s) => sum + (s.timeTaken || 0),
//     0,
//   );

//   console.log(`\n📊 PROJECT SUMMARY:`);
//   console.log(`   Total Planned Units: ${totalPlannedUnits}`);
//   console.log(`   Total Actual Units: ${totalActualUnits}`);
//   console.log(`   Total Planned Time: ${formatMinutes(totalPlannedMinutes)}`);
//   console.log(`   Total Actual Time: ${formatMinutes(totalActualMinutes)}`);
//   console.log(
//     `   Efficiency: ${
//       totalPlannedMinutes > 0
//         ? ((totalActualMinutes / totalPlannedMinutes) * 100).toFixed(1)
//         : 0
//     }%`,
//   );
//   console.log(`${'='.repeat(60)}`);

//   try {
//     const project = await prisma.project.create({
//       data: {
//         customerId: validCustomerId,
//         invoiceId,
//         status,
//         difficulty,
//         totalProjectQuantity,
//         requestedDelivery:
//           requestedDelivery && requestedDelivery !== ''
//             ? new Date(requestedDelivery)
//             : null,
//         calculatedDelivery: new Date(calculatedDelivery),
//         totalDays: actualProjectDays,
//         createdById: userId,
//         stages: {
//           create: projectStages.map((stage) => ({
//             stage: stage.stage,
//             workUnits: stage.workUnits,
//             timeTaken: stage.timeTaken || 0, // Now in MINUTES
//             capacityDays: stage.capacityDays,
//             startDate: new Date(stage.startDateTime || stage.startDate),
//             endDate: new Date(stage.endDateTime || stage.endDate),
//             autoSchedule: stage.autoSchedule,
//             status: stage.status,
//           })),
//         },
//       },
//       include: {
//         customer: true,
//         invoice: {
//           include: {
//             items: {
//               include: {
//                 proformaItemMaterials: {
//                   include: {
//                     material: true,
//                   },
//                 },
//               },
//             },
//           },
//         },
//         stages: {
//           orderBy: {
//             startDate: 'asc',
//           },
//         },
//         createdBy: {
//           select: {
//             id: true,
//             name: true,
//             email: true,
//           },
//         },
//       },
//     });

//     console.log('\n✅ PROJECT CREATED SUCCESSFULLY');
//     console.log(`   Project ID: ${project.id}`);
//     console.log(`   Actual Duration: ${actualProjectDays} day(s)`);
//     console.log(
//       `   Delivery Date: ${calculatedDelivery.toISOString().split('T')[0]}`,
//     );
//     console.log(`   Total Actual Time: ${formatMinutes(totalActualMinutes)}`);
//     console.log(`   Total Actual Units: ${totalActualUnits}`);

//     return project;
//   } catch (error) {
//     console.error('❌ Error creating project:', error);
//     throw error;
//   }
// };

// Update Project

const createProject = async (projectData, userId) => {
  console.log('=== START createProject ===');
  console.log('projectData:', JSON.stringify(projectData, null, 2));
  console.log('userId:', userId);

  const {
    customerId,
    invoiceId,
    status = 'INVOICE',
    difficulty = 'EASY',
    requestedDelivery,
    manualStartDate,
  } = projectData;

  // Define enums based on your schema
  const ProjectStatus = {
    INVOICE: 'INVOICE',
    DESIGN: 'DESIGN',
    PURCHASING: 'PURCHASING',
    METAL_WORKS: 'METAL_WORKS',
    CNC: 'CNC',
    CUTTING: 'CUTTING',
    EDGE_BANDING: 'EDGE_BANDING',
    ASSEMBLY: 'ASSEMBLY',
    PAINTING: 'PAINTING',
    FINISHING: 'FINISHING',
    DELIVERY: 'DELIVERY',
    INSTALLATION: 'INSTALLATION',
  };

  // Define difficulty percentage increases (for reference only)
  const difficultyPercentages = {
    EASY: 0.0,
    MEDIUM: 0.4,
    HARD: 0.5,
  };

  // Working hours per day
  const WORKING_HOURS_PER_DAY = 7.5;

  // Validate required fields
  if (!invoiceId) {
    console.error('Missing customerId or invoiceId');
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Customer ID and Invoice ID are required',
    );
  }

  let validCustomerId = customerId;
  let usedDefaultCustomer = false;
  let isDefaultCustomer = false;

  if (!customerId) {
    console.log('No customerId provided, will use default customer');
    usedDefaultCustomer = true;
    isDefaultCustomer = true;

    // Find the default customer
    const defaultCustomer = await prisma.customer.findFirst({
      where: { isdefault: true },
    });

    if (defaultCustomer) {
      validCustomerId = defaultCustomer.id;
      console.log(
        `Using default customer: ${defaultCustomer.id} - ${defaultCustomer.name}`,
      );
    } else {
      // Create default customer if it doesn't exist
      console.log('No default customer found, creating one...');
      const newDefaultCustomer = await prisma.customer.create({
        data: DEFAULT_CUSTOMER,
      });
      validCustomerId = newDefaultCustomer.id;
      console.log(
        `Created and using default customer: ${newDefaultCustomer.id}`,
      );
    }
  } else {
    // Check if the provided customer exists
    const customerExists = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customerExists) {
      console.log(`Customer ${customerId} not found, using default customer`);
      usedDefaultCustomer = true;
      isDefaultCustomer = true;

      // Find the default customer
      const defaultCustomer = await prisma.customer.findFirst({
        where: { isdefault: true },
      });

      if (defaultCustomer) {
        validCustomerId = defaultCustomer.id;
        console.log(
          `Using default customer: ${defaultCustomer.id} - ${defaultCustomer.name}`,
        );
      } else {
        // Create default customer if it doesn't exist
        console.log('No default customer found, creating one...');
        const newDefaultCustomer = await prisma.customer.create({
          data: DEFAULT_CUSTOMER,
        });
        validCustomerId = newDefaultCustomer.id;
        console.log(
          `Created and using default customer: ${newDefaultCustomer.id}`,
        );
      }
    } else {
      // Check if the provided customer is the default customer
      isDefaultCustomer = customerExists.isdefault === true;
      console.log(
        `Using provided customer: ${customerExists.id} - ${customerExists.name}, isDefault: ${isDefaultCustomer}`,
      );
    }
  }

  // Check if invoice exists and is available
  const invoiceExists = await prisma.proformaInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      project: true,
      items: {
        include: {
          proformaItemMaterials: {
            include: {
              material: true,
            },
          },
        },
      },
    },
  });

  if (!invoiceExists) {
    console.error('Invoice not found:', invoiceId);
    throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found');
  }

  if (invoiceExists.project) {
    console.error('Invoice already has project:', invoiceId);
    throw new ApiError(
      httpStatus.CONFLICT,
      'Invoice is already associated with another project',
    );
  }

  // Get all capacity lots
  const capacityLots = await prisma.capacityLot.findMany();
  console.log('📊 Capacity lots found:', capacityLots.length);

  // Create a map for easy lookup
  const capacityMap = {};
  capacityLots.forEach((lot) => {
    capacityMap[lot.stage] = {
      days: lot.days,
      capacity: lot.capacity || 1,
      workingHours: lot.workingHours || WORKING_HOURS_PER_DAY,
    };
  });

  // Calculate total quantities per material type
  let totalLaminatedMDFQuantity = 0;
  let totalPlainMDFQuantity = 0;
  let totalWoodQuantity = 0;
  let totalMetalQuantity = 0;
  let totalOtherQuantity = 0;

  invoiceExists.items.forEach((item) => {
    item.proformaItemMaterials.forEach((pim) => {
      const { quantity } = pim;
      const { material } = pim;

      if (material?.laminatedMDF) {
        totalLaminatedMDFQuantity += quantity;
      } else if (material?.plainMDF) {
        totalPlainMDFQuantity += quantity;
      } else if (material?.wood) {
        totalWoodQuantity += quantity;
      } else if (material?.metal) {
        totalMetalQuantity += quantity;
      } else {
        totalOtherQuantity += quantity;
      }
    });
  });

  // Calculate total project quantity
  const totalProjectQuantity =
    totalLaminatedMDFQuantity +
    totalPlainMDFQuantity +
    totalWoodQuantity +
    totalMetalQuantity +
    totalOtherQuantity;

  // Determine which material types are present
  const hasMetal = totalMetalQuantity > 0;
  const hasWood = totalWoodQuantity > 0;
  const hasPlainMDF = totalPlainMDFQuantity > 0;
  const hasLaminatedMDF = totalLaminatedMDFQuantity > 0;

  // Calculate stage quantities based on the rules
  const stageQuantities = {
    DESIGN: totalProjectQuantity,
    METAL_WORKS: hasMetal ? totalMetalQuantity : 0,
    CUTTING: totalProjectQuantity - totalMetalQuantity,
    EDGE_BANDING: hasLaminatedMDF ? totalLaminatedMDFQuantity : 0,
    ASSEMBLY: totalProjectQuantity - totalMetalQuantity,
    PAINTING: totalPlainMDFQuantity + totalWoodQuantity + totalMetalQuantity,
    FINISHING: totalProjectQuantity,
    DELIVERY: totalProjectQuantity,
    INSTALLATION: totalProjectQuantity,
    CNC: 0,
  };

  // ✅ If default customer, remove DELIVERY and INSTALLATION stages
  if (isDefaultCustomer) {
    console.log(
      '⚠️ Default customer detected - Removing DELIVERY and INSTALLATION stages',
    );
    stageQuantities.DELIVERY = 0;
    stageQuantities.INSTALLATION = 0;
  }

  // Helper function to format minutes to readable string
  const formatMinutes = (minutes) => {
    if (!minutes && minutes !== 0) return 'N/A';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins} min`;
    if (mins === 0) return `${hours} hr`;
    return `${hours} hr ${mins} min`;
  };

  // Helper function to check if a date is a business day
  const isBusinessDay = (date) => {
    const day = date.getDay();
    return day !== 0; // Only Sunday is off
  };

  // Helper function to get next business day
  const getNextBusinessDay = (date) => {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);
    while (!isBusinessDay(nextDate)) {
      nextDate.setDate(nextDate.getDate() + 1);
    }
    return nextDate;
  };

  // Helper function to get max date
  const getMaxDate = (dates) => {
    return new Date(Math.max(...dates.map((d) => d.getTime())));
  };

  // Helper function to get available hours for a specific stage and date
  const getAvailableHours = async (stage, date) => {
    const normalizedDate = new Date(date);
    normalizedDate.setHours(0, 0, 0, 0);

    const dailyRecord = await prisma.dailyStageCapacity.findUnique({
      where: {
        stage_date: {
          stage,
          date: normalizedDate,
        },
      },
    });

    const usedHours = dailyRecord?.usedHours || 0;
    const maxHours = WORKING_HOURS_PER_DAY;
    return maxHours - usedHours;
  };

  // Calculate required hours for a stage
  const calculateRequiredHours = (stage, quantity) => {
    if (quantity <= 0) return 0;
    const capacityInfo = capacityMap[stage];
    if (!capacityInfo) {
      return quantity * WORKING_HOURS_PER_DAY;
    }
    return (quantity / capacityInfo.capacity) * WORKING_HOURS_PER_DAY;
  };

  // Calculate required minutes for a stage
  const calculateRequiredMinutes = (stage, quantity) => {
    const hours = calculateRequiredHours(stage, quantity);
    return Math.round(hours * 60);
  };

  // Calculate actual units based on hours assigned
  const calculateActualUnits = (hoursAssigned, stage) => {
    const capacityInfo = capacityMap[stage];
    if (!capacityInfo) {
      return Math.ceil(hoursAssigned / WORKING_HOURS_PER_DAY);
    }
    const unitsPerHour = capacityInfo.capacity / WORKING_HOURS_PER_DAY;
    return Math.ceil(hoursAssigned * unitsPerHour);
  };

  // Time-based capacity allocation - RETURNS end date WITH TIME, actualHours, actualUnits
  const allocateStageCapacity = async (stage, totalQuantity, startDate) => {
    if (totalQuantity <= 0) return null;

    const capacityInfo = capacityMap[stage];
    if (!capacityInfo) {
      const startDateTime = new Date(startDate);
      startDateTime.setHours(8, 0, 0, 0);
      const endDateTime = new Date(startDateTime);
      const hoursNeeded = totalQuantity * WORKING_HOURS_PER_DAY;
      endDateTime.setHours(
        8 + Math.floor(hoursNeeded),
        (hoursNeeded % 1) * 60,
        0,
        0,
      );

      return {
        firstDate: startDateTime,
        lastDate: endDateTime,
        allocations: [
          {
            date: startDateTime,
            hours: hoursNeeded,
            units: totalQuantity,
          },
        ],
        totalHours: hoursNeeded,
        totalActualUnits: totalQuantity,
        endDateTime,
      };
    }

    let requiredHours = calculateRequiredHours(stage, totalQuantity);
    let currentDateTime = new Date(startDate);
    currentDateTime.setHours(8, 0, 0, 0);
    const allocations = [];
    let firstWorkDate = null;
    let lastEndDateTime = null;
    const unitsPerHour = capacityInfo.capacity / WORKING_HOURS_PER_DAY;

    const requiredMinutes = requiredHours * 60;
    console.log(
      `\n   📍 [${stage}] ${totalQuantity} planned units = ${requiredMinutes} minutes (${requiredHours.toFixed(
        2,
      )} hours)`,
    );
    console.log(
      `   📊 Capacity: ${capacityInfo.capacity} units/day = ${WORKING_HOURS_PER_DAY} hours/day`,
    );
    console.log(`   📈 Production rate: ${unitsPerHour.toFixed(2)} units/hour`);

    while (requiredHours > 0.01) {
      const currentDateOnly = new Date(currentDateTime);
      currentDateOnly.setHours(0, 0, 0, 0);

      if (!isBusinessDay(currentDateOnly)) {
        currentDateTime = new Date(getNextBusinessDay(currentDateOnly));
        currentDateTime.setHours(8, 0, 0, 0);
        continue;
      }

      const availableHours = await getAvailableHours(stage, currentDateOnly);

      if (availableHours <= 0.01) {
        currentDateTime = new Date(getNextBusinessDay(currentDateOnly));
        currentDateTime.setHours(8, 0, 0, 0);
        continue;
      }

      const hoursToAssign = Math.min(requiredHours, availableHours);
      const unitsToAssign = calculateActualUnits(hoursToAssign, stage);
      const minutesToAssign = Math.round(hoursToAssign * 60);

      // Use transaction to prevent race conditions
      await prisma.$transaction(async (tx) => {
        const existingRecord = await tx.dailyStageCapacity.findUnique({
          where: {
            stage_date: {
              stage,
              date: currentDateOnly,
            },
          },
        });

        const currentUsedHours = existingRecord?.usedHours || 0;
        const currentUsedCapacity = existingRecord?.usedCapacity || 0;

        await tx.dailyStageCapacity.upsert({
          where: {
            stage_date: {
              stage,
              date: currentDateOnly,
            },
          },
          update: {
            usedHours: currentUsedHours + hoursToAssign,
            usedCapacity: currentUsedCapacity + unitsToAssign,
          },
          create: {
            stage,
            date: currentDateOnly,
            usedHours: hoursToAssign,
            usedCapacity: unitsToAssign,
            maxCapacity: capacityInfo.capacity,
            maxHours: WORKING_HOURS_PER_DAY,
            workingHours: WORKING_HOURS_PER_DAY,
          },
        });
      });

      // Calculate end time for this day
      const dayEndDateTime = new Date(currentDateTime);
      const startHour = currentDateTime.getHours();
      const startMinute = currentDateTime.getMinutes();
      const totalMinutes = startHour * 60 + startMinute + minutesToAssign;
      dayEndDateTime.setHours(
        Math.floor(totalMinutes / 60),
        totalMinutes % 60,
        0,
        0,
      );

      allocations.push({
        date: new Date(currentDateTime),
        hours: hoursToAssign,
        minutes: minutesToAssign,
        units: unitsToAssign,
        endDateTime: new Date(dayEndDateTime),
      });

      if (firstWorkDate === null) {
        firstWorkDate = new Date(currentDateTime);
      }

      lastEndDateTime = new Date(dayEndDateTime);
      requiredHours -= hoursToAssign;

      console.log(
        `      ${
          currentDateOnly.toISOString().split('T')[0]
        }: ${minutesToAssign} minutes (${hoursToAssign.toFixed(
          2,
        )} hours) → ${unitsToAssign} units (ends ${dayEndDateTime.toLocaleTimeString()})`,
      );

      if (requiredHours > 0.01) {
        currentDateTime = new Date(dayEndDateTime);
        // Move to next day but keep the same time (8:00 AM)
        currentDateTime = new Date(getNextBusinessDay(currentDateOnly));
        currentDateTime.setHours(8, 0, 0, 0);
      }
    }

    const totalHours = allocations.reduce((sum, alloc) => sum + alloc.hours, 0);
    const totalMinutes = Math.round(totalHours * 60);
    const totalActualUnits = allocations.reduce(
      (sum, alloc) => sum + alloc.units,
      0,
    );

    console.log(`\n   ✅ [${stage}] Summary:`);
    console.log(
      `      Planned: ${totalQuantity} units, ${calculateRequiredMinutes(
        stage,
        totalQuantity,
      )} minutes`,
    );
    console.log(
      `      Actual: ${totalActualUnits} units, ${totalMinutes} minutes`,
    );
    console.log(
      `      Utilization: ${(
        (totalHours / (allocations.length * WORKING_HOURS_PER_DAY)) *
        100
      ).toFixed(1)}%`,
    );

    return {
      firstDate: firstWorkDate,
      lastDate: allocations[allocations.length - 1]?.date,
      lastDateTime: lastEndDateTime,
      allocations,
      totalHours,
      totalMinutes,
      totalActualUnits,
    };
  };

  // Schedule a stage - RETURNS end DateTime with actual time and units
  const scheduleStage = async (stage, quantity, startDateTime) => {
    if (quantity <= 0) return null;

    const result = await allocateStageCapacity(stage, quantity, startDateTime);
    if (!result) return null;

    // Store time taken in MINUTES (not hours) for better precision
    const timeTakenMinutes = result.totalMinutes;

    return {
      stage,
      workUnits: quantity, // Planned work units
      timeTaken: timeTakenMinutes, // Actual time taken in MINUTES
      startDate: new Date(result.firstDate),
      endDate: new Date(result.lastDateTime || result.lastDate),
      startDateTime: new Date(result.firstDate),
      endDateTime: new Date(result.lastDateTime || result.lastDate),
      capacityDays: result.allocations.length,
      autoSchedule: true,
      status: 'ACTIVE',
    };
  };

  // Schedule parallel stages - ALL start at the SAME dateTime
  const scheduleParallelStages = async (stages, startDateTime, groupName) => {
    const validStages = stages.filter((s) => s.quantity > 0);

    if (validStages.length === 0) {
      return {
        records: [],
        endDateTime: startDateTime,
      };
    }

    console.log(`\n🔄 PARALLEL Group: ${groupName}`);
    console.log(`   Stages: ${validStages.map((s) => s.name).join(', ')}`);
    console.log(
      `   All start at: ${
        startDateTime.toISOString().split('T')[0]
      } ${startDateTime.toLocaleTimeString()}`,
    );

    const results = await Promise.all(
      validStages.map(async ({ name, quantity }) => {
        return await scheduleStage(name, quantity, startDateTime);
      }),
    );

    const validResults = results.filter((r) => r !== null);
    // End date is the LATEST finishing stage
    const endDateTimes = validResults.map((r) => r.endDateTime);
    const latestEndDateTime =
      endDateTimes.length > 0
        ? new Date(Math.max(...endDateTimes.map((d) => d.getTime())))
        : startDateTime;

    console.log(
      `   Latest completion: ${
        latestEndDateTime.toISOString().split('T')[0]
      } ${latestEndDateTime.toLocaleTimeString()}`,
    );

    return {
      records: validResults,
      endDateTime: latestEndDateTime,
    };
  };

  // ============ SCHEDULE PROJECT STAGES ============
  const projectStages = [];
  let currentDateTime = new Date(
    manualStartDate && manualStartDate !== ''
      ? new Date(manualStartDate)
      : new Date(),
  );
  currentDateTime.setHours(8, 0, 0, 0);

  if (!isBusinessDay(currentDateTime)) {
    currentDateTime = new Date(getNextBusinessDay(currentDateTime));
    currentDateTime.setHours(8, 0, 0, 0);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(
    `🚀 START DATE/TIME: ${
      currentDateTime.toISOString().split('T')[0]
    } ${currentDateTime.toLocaleTimeString()}`,
  );
  console.log(`${'='.repeat(60)}`);

  // GROUP 1: Design & Purchasing (Parallel)
  console.log(`\n📋 GROUP 1: Design & Purchasing (Parallel)`);

  const designStage = await scheduleStage(
    'DESIGN',
    stageQuantities.DESIGN,
    currentDateTime,
  );
  projectStages.push(designStage);

  // Purchasing runs parallel with Design - starts same time, ends when Design ends
  // Purchasing doesn't use capacity hours (manual stage)
  const purchasingTimeTaken = Math.round(
    (designStage.endDateTime - designStage.startDateTime) / (1000 * 60),
  ); // Minutes

  projectStages.push({
    stage: 'PURCHASING',
    workUnits: totalProjectQuantity,
    timeTaken: purchasingTimeTaken,
    startDate: new Date(currentDateTime),
    endDate: new Date(designStage.endDateTime),
    startDateTime: new Date(currentDateTime),
    endDateTime: new Date(designStage.endDateTime),
    capacityDays: 1,
    autoSchedule: true,
    status: 'ACTIVE',
  });

  // Next group starts at the MAX end time of this group
  currentDateTime = new Date(designStage.endDateTime);
  console.log(
    `   Group 1 completes at: ${
      currentDateTime.toISOString().split('T')[0]
    } ${currentDateTime.toLocaleTimeString()}`,
  );

  // GROUP 2: Metal Works (if exists)
  if (hasMetal) {
    console.log(`\n📋 GROUP 2: Metal Works`);
    const metalStage = await scheduleStage(
      'METAL_WORKS',
      stageQuantities.METAL_WORKS,
      currentDateTime,
    );
    if (metalStage) {
      projectStages.push(metalStage);
      currentDateTime = new Date(metalStage.endDateTime);
      console.log(
        `   Metal Works completes at: ${
          currentDateTime.toISOString().split('T')[0]
        } ${currentDateTime.toLocaleTimeString()}`,
      );
    }
  }

  // GROUP 3: Cutting & Edge Banding (Parallel)
  console.log(`\n📋 GROUP 3: Cutting & Edge Banding (Parallel)`);
  const cuttingEdgeStages = [];
  if (stageQuantities.CUTTING > 0)
    cuttingEdgeStages.push({
      name: 'CUTTING',
      quantity: stageQuantities.CUTTING,
    });
  if (stageQuantities.EDGE_BANDING > 0)
    cuttingEdgeStages.push({
      name: 'EDGE_BANDING',
      quantity: stageQuantities.EDGE_BANDING,
    });

  const group3Results = await scheduleParallelStages(
    cuttingEdgeStages,
    currentDateTime,
    'Cutting & Edge Banding',
  );
  if (group3Results.records.length > 0) {
    projectStages.push(...group3Results.records);
    currentDateTime = new Date(group3Results.endDateTime);
    console.log(
      `   Group 3 completes at: ${
        currentDateTime.toISOString().split('T')[0]
      } ${currentDateTime.toLocaleTimeString()}`,
    );
  }

  // GROUP 4: Assembly & Painting (Parallel)
  console.log(`\n📋 GROUP 4: Assembly & Painting (Parallel)`);
  const assemblyPaintingStages = [];
  if (stageQuantities.ASSEMBLY > 0)
    assemblyPaintingStages.push({
      name: 'ASSEMBLY',
      quantity: stageQuantities.ASSEMBLY,
    });
  if (stageQuantities.PAINTING > 0)
    assemblyPaintingStages.push({
      name: 'PAINTING',
      quantity: stageQuantities.PAINTING,
    });

  const group4Results = await scheduleParallelStages(
    assemblyPaintingStages,
    currentDateTime,
    'Assembly & Painting',
  );
  if (group4Results.records.length > 0) {
    projectStages.push(...group4Results.records);
    currentDateTime = new Date(group4Results.endDateTime);
    console.log(
      `   Group 4 completes at: ${
        currentDateTime.toISOString().split('T')[0]
      } ${currentDateTime.toLocaleTimeString()}`,
    );
  }

  // GROUP 5: Finishing (Sequential)
  console.log(`\n📋 GROUP 5: Finishing`);
  const finishingStage = await scheduleStage(
    'FINISHING',
    stageQuantities.FINISHING,
    currentDateTime,
  );
  projectStages.push(finishingStage);
  currentDateTime = new Date(finishingStage.endDateTime);
  console.log(
    `   Finishing completes at: ${
      currentDateTime.toISOString().split('T')[0]
    } ${currentDateTime.toLocaleTimeString()}`,
  );

  // GROUP 6: Delivery (Sequential) - Only if not default customer
  if (stageQuantities.DELIVERY > 0) {
    console.log(`\n📋 GROUP 6: Delivery`);
    const deliveryStage = await scheduleStage(
      'DELIVERY',
      stageQuantities.DELIVERY,
      currentDateTime,
    );
    projectStages.push(deliveryStage);
    currentDateTime = new Date(deliveryStage.endDateTime);
    console.log(
      `   Delivery completes at: ${
        currentDateTime.toISOString().split('T')[0]
      } ${currentDateTime.toLocaleTimeString()}`,
    );
  }

  // GROUP 7: Installation (Sequential) - Only if not default customer
  if (stageQuantities.INSTALLATION > 0) {
    console.log(`\n📋 GROUP 7: Installation`);
    const installationStage = await scheduleStage(
      'INSTALLATION',
      stageQuantities.INSTALLATION,
      currentDateTime,
    );
    projectStages.push(installationStage);
    currentDateTime = new Date(installationStage.endDateTime);
  }

  // Sort stages by start date
  projectStages.sort((a, b) => a.startDateTime - b.startDateTime);
  const calculatedDelivery =
    projectStages[projectStages.length - 1]?.endDateTime || new Date();

  // ============ USE ACTUAL SCHEDULE DURATION (NOT ESTIMATE) ============
  // Calculate actual project duration from the schedule
  const firstStageStart = projectStages[0]?.startDateTime || currentDateTime;
  const lastStageEnd =
    projectStages[projectStages.length - 1]?.endDateTime || currentDateTime;

  // Calculate actual business days between start and end
  const calculateActualBusinessDays = (startDate, endDate) => {
    let count = 0;
    const current = new Date(startDate);
    const end = new Date(endDate);
    current.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    while (current <= end) {
      if (isBusinessDay(current)) {
        count++;
      }
      current.setDate(current.getDate() + 1);
    }
    return count;
  };

  const actualProjectDays = calculateActualBusinessDays(
    firstStageStart,
    lastStageEnd,
  );

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📋 FINAL SCHEDULE (WITH TIMES & ACTUAL METRICS)`);
  console.log(`${'='.repeat(60)}`);
  projectStages.forEach((stage) => {
    const startStr = stage.startDateTime
      ? `${
          stage.startDateTime.toISOString().split('T')[0]
        } ${stage.startDateTime.toLocaleTimeString()}`
      : stage.startDate?.toISOString().split('T')[0];
    const endStr = stage.endDateTime
      ? `${
          stage.endDateTime.toISOString().split('T')[0]
        } ${stage.endDateTime.toLocaleTimeString()}`
      : stage.endDate?.toISOString().split('T')[0];

    const plannedMinutes = calculateRequiredMinutes(
      stage.stage,
      stage.workUnits,
    );

    console.log(`   ${stage.stage}: ${startStr} → ${endStr}`);
    console.log(
      `      📊 Planned: ${stage.workUnits || 0} units (${formatMinutes(
        plannedMinutes,
      )})`,
    );
    console.log(
      `      ✅ Actual: ${stage.actualWorkUnits || 0} units (${formatMinutes(
        stage.timeTaken || 0,
      )})`,
    );
  });
  console.log(
    `\n🎯 DELIVERY: ${
      calculatedDelivery.toISOString().split('T')[0]
    } ${calculatedDelivery.toLocaleTimeString()}`,
  );
  console.log(`📊 ACTUAL PROJECT DURATION: ${actualProjectDays} day(s)`);

  // Calculate total actual vs planned
  const totalPlannedUnits = projectStages.reduce(
    (sum, s) => sum + (s.workUnits || 0),
    0,
  );
  const totalActualUnits = projectStages.reduce(
    (sum, s) => sum + (s.actualWorkUnits || 0),
    0,
  );
  const totalPlannedMinutes = projectStages.reduce((sum, s) => {
    if (s.workUnits) {
      return sum + calculateRequiredMinutes(s.stage, s.workUnits);
    }
    return sum;
  }, 0);
  const totalActualMinutes = projectStages.reduce(
    (sum, s) => sum + (s.timeTaken || 0),
    0,
  );

  console.log(`\n📊 PROJECT SUMMARY:`);
  console.log(`   Total Planned Units: ${totalPlannedUnits}`);
  console.log(`   Total Actual Units: ${totalActualUnits}`);
  console.log(`   Total Planned Time: ${formatMinutes(totalPlannedMinutes)}`);
  console.log(`   Total Actual Time: ${formatMinutes(totalActualMinutes)}`);
  console.log(
    `   Efficiency: ${
      totalPlannedMinutes > 0
        ? ((totalActualMinutes / totalPlannedMinutes) * 100).toFixed(1)
        : 0
    }%`,
  );
  console.log(`${'='.repeat(60)}`);

  try {
    const project = await prisma.project.create({
      data: {
        customerId: validCustomerId,
        invoiceId,
        status,
        difficulty,
        totalProjectQuantity,
        requestedDelivery:
          requestedDelivery && requestedDelivery !== ''
            ? new Date(requestedDelivery)
            : null,
        calculatedDelivery: new Date(calculatedDelivery),
        totalDays: actualProjectDays,
        createdById: userId,
        stages: {
          create: projectStages.map((stage) => ({
            stage: stage.stage,
            workUnits: stage.workUnits,
            timeTaken: stage.timeTaken || 0, // Now in MINUTES
            capacityDays: stage.capacityDays,
            startDate: new Date(stage.startDateTime || stage.startDate),
            endDate: new Date(stage.endDateTime || stage.endDate),
            autoSchedule: stage.autoSchedule,
            status: stage.status,
          })),
        },
      },
      include: {
        customer: true,
        invoice: {
          include: {
            items: {
              include: {
                proformaItemMaterials: {
                  include: {
                    material: true,
                  },
                },
              },
            },
          },
        },
        stages: {
          orderBy: {
            startDate: 'asc',
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    console.log('\n✅ PROJECT CREATED SUCCESSFULLY');
    console.log(`   Project ID: ${project.id}`);
    console.log(`   Actual Duration: ${actualProjectDays} day(s)`);
    console.log(
      `   Delivery Date: ${calculatedDelivery.toISOString().split('T')[0]}`,
    );
    console.log(`   Total Actual Time: ${formatMinutes(totalActualMinutes)}`);
    console.log(`   Total Actual Units: ${totalActualUnits}`);

    return project;
  } catch (error) {
    console.error('❌ Error creating project:', error);
    throw error;
  }
};


const createProject = async (projectData, userId) => {
  console.log('=== START createProject ===');
  console.log('projectData:', JSON.stringify(projectData, null, 2));
  console.log('userId:', userId);

  const {
    customerId,
    invoiceId,
    status = 'INVOICE',
    difficulty = 'EASY',
    requestedDelivery,
    manualStartDate,
  } = projectData;

  // Define enums based on your schema
  const ProjectStatus = {
    INVOICE: 'INVOICE',
    DESIGN: 'DESIGN',
    PURCHASING: 'PURCHASING',
    METAL_WORKS: 'METAL_WORKS',
    CNC: 'CNC',
    CUTTING: 'CUTTING',
    EDGE_BANDING: 'EDGE_BANDING',
    ASSEMBLY: 'ASSEMBLY',
    PAINTING: 'PAINTING',
    FINISHING: 'FINISHING',
    DELIVERY: 'DELIVERY',
    INSTALLATION: 'INSTALLATION',
  };

  // Define CapacityStage enum values (for validation)
  const CapacityStageValues = [
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

  // Define difficulty percentage increases (for reference only)
  const difficultyPercentages = {
    EASY: 0.0,
    MEDIUM: 0.4,
    HARD: 0.5,
  };

  // Working hours per day
  const WORKING_HOURS_PER_DAY = 7.5;

  // Validate required fields
  if (!invoiceId) {
    console.error('Missing customerId or invoiceId');
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Customer ID and Invoice ID are required',
    );
  }

  let validCustomerId = customerId;
  let usedDefaultCustomer = false;
  let isDefaultCustomer = false;

  if (!customerId) {
    console.log('No customerId provided, will use default customer');
    usedDefaultCustomer = true;
    isDefaultCustomer = true;

    // Find the default customer
    const defaultCustomer = await prisma.customer.findFirst({
      where: { isdefault: true },
    });

    if (defaultCustomer) {
      validCustomerId = defaultCustomer.id;
      console.log(
        `Using default customer: ${defaultCustomer.id} - ${defaultCustomer.name}`,
      );
    } else {
      // Create default customer if it doesn't exist
      console.log('No default customer found, creating one...');
      const newDefaultCustomer = await prisma.customer.create({
        data: DEFAULT_CUSTOMER,
      });
      validCustomerId = newDefaultCustomer.id;
      console.log(
        `Created and using default customer: ${newDefaultCustomer.id}`,
      );
    }
  } else {
    // Check if the provided customer exists
    const customerExists = await prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customerExists) {
      console.log(`Customer ${customerId} not found, using default customer`);
      usedDefaultCustomer = true;
      isDefaultCustomer = true;

      // Find the default customer
      const defaultCustomer = await prisma.customer.findFirst({
        where: { isdefault: true },
      });

      if (defaultCustomer) {
        validCustomerId = defaultCustomer.id;
        console.log(
          `Using default customer: ${defaultCustomer.id} - ${defaultCustomer.name}`,
        );
      } else {
        // Create default customer if it doesn't exist
        console.log('No default customer found, creating one...');
        const newDefaultCustomer = await prisma.customer.create({
          data: DEFAULT_CUSTOMER,
        });
        validCustomerId = newDefaultCustomer.id;
        console.log(
          `Created and using default customer: ${newDefaultCustomer.id}`,
        );
      }
    } else {
      // Check if the provided customer is the default customer
      isDefaultCustomer = customerExists.isdefault === true;
      console.log(
        `Using provided customer: ${customerExists.id} - ${customerExists.name}, isDefault: ${isDefaultCustomer}`,
      );
    }
  }

  // Check if invoice exists and is available
  const invoiceExists = await prisma.proformaInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      project: true,
      items: {
        include: {
          proformaItemMaterials: {
            include: {
              material: true,
            },
          },
        },
      },
    },
  });

  if (!invoiceExists) {
    console.error('Invoice not found:', invoiceId);
    throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found');
  }

  if (invoiceExists.project) {
    console.error('Invoice already has project:', invoiceId);
    throw new ApiError(
      httpStatus.CONFLICT,
      'Invoice is already associated with another project',
    );
  }

  // Get all capacity lots
  const capacityLots = await prisma.capacityLot.findMany();
  console.log('📊 Capacity lots found:', capacityLots.length);

  // Create a map for easy lookup
  const capacityMap = {};
  capacityLots.forEach((lot) => {
    capacityMap[lot.stage] = {
      days: lot.days,
      capacity: lot.capacity || 1,
      workingHours: lot.workingHours || WORKING_HOURS_PER_DAY,
    };
  });

  // Calculate total quantities per material type
  let totalLaminatedMDFQuantity = 0;
  let totalPlainMDFQuantity = 0;
  let totalWoodQuantity = 0;
  let totalMetalQuantity = 0;
  let totalOtherQuantity = 0;

  invoiceExists.items.forEach((item) => {
    item.proformaItemMaterials.forEach((pim) => {
      const { quantity } = pim;
      const { material } = pim;

      if (material?.laminatedMDF) {
        totalLaminatedMDFQuantity += quantity;
      } else if (material?.plainMDF) {
        totalPlainMDFQuantity += quantity;
      } else if (material?.wood) {
        totalWoodQuantity += quantity;
      } else if (material?.metal) {
        totalMetalQuantity += quantity;
      } else {
        totalOtherQuantity += quantity;
      }
    });
  });

  // Calculate total project quantity
  const totalProjectQuantity =
    totalLaminatedMDFQuantity +
    totalPlainMDFQuantity +
    totalWoodQuantity +
    totalMetalQuantity +
    totalOtherQuantity;

  // Determine which material types are present
  const hasMetal = totalMetalQuantity > 0;
  const hasWood = totalWoodQuantity > 0;
  const hasPlainMDF = totalPlainMDFQuantity > 0;
  const hasLaminatedMDF = totalLaminatedMDFQuantity > 0;

  // Calculate stage quantities based on the rules
  const stageQuantities = {
    DESIGN: totalProjectQuantity,
    METAL_WORKS: hasMetal ? totalMetalQuantity : 0,
    CUTTING: totalProjectQuantity - totalMetalQuantity,
    EDGE_BANDING: hasLaminatedMDF ? totalLaminatedMDFQuantity : 0,
    ASSEMBLY: totalProjectQuantity - totalMetalQuantity,
    PAINTING: totalPlainMDFQuantity + totalWoodQuantity + totalMetalQuantity,
    FINISHING: totalProjectQuantity,
    DELIVERY: totalProjectQuantity,
    INSTALLATION: totalProjectQuantity,
    CNC: 0,
  };

  // ✅ If default customer, remove DELIVERY and INSTALLATION stages
  if (isDefaultCustomer) {
    console.log(
      '⚠️ Default customer detected - Removing DELIVERY and INSTALLATION stages',
    );
    stageQuantities.DELIVERY = 0;
    stageQuantities.INSTALLATION = 0;
  }

  // Helper function to format minutes to readable string
  const formatMinutes = (minutes) => {
    if (!minutes && minutes !== 0) return 'N/A';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins} min`;
    if (mins === 0) return `${hours} hr`;
    return `${hours} hr ${mins} min`;
  };

  // Helper function to check if a date is a business day
  const isBusinessDay = (date) => {
    const day = date.getDay();
    return day !== 0; // Only Sunday is off
  };

  // Helper function to get next business day
  const getNextBusinessDay = (date) => {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);
    while (!isBusinessDay(nextDate)) {
      nextDate.setDate(nextDate.getDate() + 1);
    }
    return nextDate;
  };

  // Helper function to get max date
  const getMaxDate = (dates) => {
    return new Date(Math.max(...dates.map((d) => d.getTime())));
  };

  // Helper function to get available hours for a specific stage and date
  const getAvailableHours = async (stage, date) => {
    // Skip capacity check for stages not in CapacityStage enum
    if (!CapacityStageValues.includes(stage)) {
      return WORKING_HOURS_PER_DAY;
    }

    const normalizedDate = new Date(date);
    normalizedDate.setHours(0, 0, 0, 0);

    const dailyRecord = await prisma.dailyStageCapacity.findUnique({
      where: {
        stage_date: {
          stage,
          date: normalizedDate,
        },
      },
    });

    const usedHours = dailyRecord?.usedHours || 0;
    const maxHours = WORKING_HOURS_PER_DAY;
    return maxHours - usedHours;
  };

  // Calculate required hours for a stage
  const calculateRequiredHours = (stage, quantity) => {
    if (quantity <= 0) return 0;
    const capacityInfo = capacityMap[stage];
    if (!capacityInfo) {
      return quantity * WORKING_HOURS_PER_DAY;
    }
    return (quantity / capacityInfo.capacity) * WORKING_HOURS_PER_DAY;
  };

  // Calculate required minutes for a stage
  const calculateRequiredMinutes = (stage, quantity) => {
    const hours = calculateRequiredHours(stage, quantity);
    return Math.round(hours * 60);
  };

  // Calculate actual units based on hours assigned
  const calculateActualUnits = (hoursAssigned, stage) => {
    const capacityInfo = capacityMap[stage];
    if (!capacityInfo) {
      return Math.ceil(hoursAssigned / WORKING_HOURS_PER_DAY);
    }
    const unitsPerHour = capacityInfo.capacity / WORKING_HOURS_PER_DAY;
    return Math.ceil(hoursAssigned * unitsPerHour);
  };

  // Store allocations for later use
  const allStageAllocations = [];

  // Time-based capacity allocation - RETURNS end date WITH TIME, actualHours, actualUnits
  const allocateStageCapacity = async (stage, totalQuantity, startDate) => {
    if (totalQuantity <= 0) return null;

    // Check if stage is in CapacityStage enum
    const isCapacityStage = CapacityStageValues.includes(stage);

    if (!isCapacityStage || !capacityMap[stage]) {
      const startDateTime = new Date(startDate);
      startDateTime.setHours(8, 0, 0, 0);
      const endDateTime = new Date(startDateTime);
      const hoursNeeded = totalQuantity * WORKING_HOURS_PER_DAY;
      endDateTime.setHours(
        8 + Math.floor(hoursNeeded),
        (hoursNeeded % 1) * 60,
        0,
        0,
      );

      // Store allocation for non-capacity stages too (for tracking)
      const allocations = [
        {
          date: startDateTime,
          hours: hoursNeeded,
          units: totalQuantity,
        },
      ];

      if (isCapacityStage) {
        allStageAllocations.push({
          stage,
          allocations,
        });
      }

      return {
        firstDate: startDateTime,
        lastDate: endDateTime,
        allocations,
        totalHours: hoursNeeded,
        totalActualUnits: totalQuantity,
        endDateTime,
      };
    }

    let requiredHours = calculateRequiredHours(stage, totalQuantity);
    let currentDateTime = new Date(startDate);
    currentDateTime.setHours(8, 0, 0, 0);
    const allocations = [];
    let firstWorkDate = null;
    let lastEndDateTime = null;
    const unitsPerHour = capacityMap[stage].capacity / WORKING_HOURS_PER_DAY;

    const requiredMinutes = requiredHours * 60;
    console.log(
      `\n   📍 [${stage}] ${totalQuantity} planned units = ${requiredMinutes} minutes (${requiredHours.toFixed(
        2,
      )} hours)`,
    );
    console.log(
      `   📊 Capacity: ${capacityMap[stage].capacity} units/day = ${WORKING_HOURS_PER_DAY} hours/day`,
    );
    console.log(`   📈 Production rate: ${unitsPerHour.toFixed(2)} units/hour`);

    while (requiredHours > 0.01) {
      const currentDateOnly = new Date(currentDateTime);
      currentDateOnly.setHours(0, 0, 0, 0);

      if (!isBusinessDay(currentDateOnly)) {
        currentDateTime = new Date(getNextBusinessDay(currentDateOnly));
        currentDateTime.setHours(8, 0, 0, 0);
        continue;
      }

      const availableHours = await getAvailableHours(stage, currentDateOnly);

      if (availableHours <= 0.01) {
        currentDateTime = new Date(getNextBusinessDay(currentDateOnly));
        currentDateTime.setHours(8, 0, 0, 0);
        continue;
      }

      const hoursToAssign = Math.min(requiredHours, availableHours);
      const unitsToAssign = calculateActualUnits(hoursToAssign, stage);
      const minutesToAssign = Math.round(hoursToAssign * 60);

      // Store allocation for later
      allocations.push({
        date: new Date(currentDateOnly),
        hours: hoursToAssign,
        units: unitsToAssign,
        stage,
      });

      // Use transaction to prevent race conditions
      await prisma.$transaction(async (tx) => {
        const existingRecord = await tx.dailyStageCapacity.findUnique({
          where: {
            stage_date: {
              stage,
              date: currentDateOnly,
            },
          },
        });

        const currentUsedHours = existingRecord?.usedHours || 0;
        const currentUsedCapacity = existingRecord?.usedCapacity || 0;

        await tx.dailyStageCapacity.upsert({
          where: {
            stage_date: {
              stage,
              date: currentDateOnly,
            },
          },
          update: {
            usedHours: currentUsedHours + hoursToAssign,
            usedCapacity: currentUsedCapacity + unitsToAssign,
          },
          create: {
            stage,
            date: currentDateOnly,
            usedHours: hoursToAssign,
            usedCapacity: unitsToAssign,
            maxCapacity: capacityMap[stage].capacity,
            maxHours: WORKING_HOURS_PER_DAY,
            workingHours: WORKING_HOURS_PER_DAY,
          },
        });
      });

      // Calculate end time for this day
      const dayEndDateTime = new Date(currentDateTime);
      const startHour = currentDateTime.getHours();
      const startMinute = currentDateTime.getMinutes();
      const totalMinutes = startHour * 60 + startMinute + minutesToAssign;
      dayEndDateTime.setHours(
        Math.floor(totalMinutes / 60),
        totalMinutes % 60,
        0,
        0,
      );

      if (firstWorkDate === null) {
        firstWorkDate = new Date(currentDateTime);
      }

      lastEndDateTime = new Date(dayEndDateTime);
      requiredHours -= hoursToAssign;

      console.log(
        `      ${
          currentDateOnly.toISOString().split('T')[0]
        }: ${minutesToAssign} minutes (${hoursToAssign.toFixed(
          2,
        )} hours) → ${unitsToAssign} units (ends ${dayEndDateTime.toLocaleTimeString()})`,
      );

      if (requiredHours > 0.01) {
        currentDateTime = new Date(dayEndDateTime);
        // Move to next day but keep the same time (8:00 AM)
        currentDateTime = new Date(getNextBusinessDay(currentDateOnly));
        currentDateTime.setHours(8, 0, 0, 0);
      }
    }

    const totalHours = allocations.reduce((sum, alloc) => sum + alloc.hours, 0);
    const totalMinutes = Math.round(totalHours * 60);
    const totalActualUnits = allocations.reduce(
      (sum, alloc) => sum + alloc.units,
      0,
    );

    console.log(`\n   ✅ [${stage}] Summary:`);
    console.log(
      `      Planned: ${totalQuantity} units, ${calculateRequiredMinutes(
        stage,
        totalQuantity,
      )} minutes`,
    );
    console.log(
      `      Actual: ${totalActualUnits} units, ${totalMinutes} minutes`,
    );
    console.log(
      `      Utilization: ${(
        (totalHours / (allocations.length * WORKING_HOURS_PER_DAY)) *
        100
      ).toFixed(1)}%`,
    );

    // Store allocations for this stage
    allStageAllocations.push({
      stage,
      allocations,
    });

    return {
      firstDate: firstWorkDate,
      lastDate: allocations[allocations.length - 1]?.date,
      lastDateTime: lastEndDateTime,
      allocations,
      totalHours,
      totalMinutes,
      totalActualUnits,
    };
  };

  // Schedule a stage - RETURNS end DateTime with actual time and units
  const scheduleStage = async (stage, quantity, startDateTime) => {
    if (quantity <= 0) return null;

    const result = await allocateStageCapacity(stage, quantity, startDateTime);
    if (!result) return null;

    // Store time taken in MINUTES (not hours) for better precision
    const timeTakenMinutes = result.totalMinutes;

    return {
      stage,
      workUnits: quantity, // Planned work units
      timeTaken: timeTakenMinutes, // Actual time taken in MINUTES
      startDate: new Date(result.firstDate),
      endDate: new Date(result.lastDateTime || result.lastDate),
      startDateTime: new Date(result.firstDate),
      endDateTime: new Date(result.lastDateTime || result.lastDate),
      capacityDays: result.allocations.length,
      autoSchedule: true,
      status: 'ACTIVE',
      actualWorkUnits: result.totalActualUnits,
      allocations: result.allocations,
    };
  };

  // Schedule parallel stages - ALL start at the SAME dateTime
  const scheduleParallelStages = async (stages, startDateTime, groupName) => {
    const validStages = stages.filter((s) => s.quantity > 0);

    if (validStages.length === 0) {
      return {
        records: [],
        endDateTime: startDateTime,
      };
    }

    console.log(`\n🔄 PARALLEL Group: ${groupName}`);
    console.log(`   Stages: ${validStages.map((s) => s.name).join(', ')}`);
    console.log(
      `   All start at: ${
        startDateTime.toISOString().split('T')[0]
      } ${startDateTime.toLocaleTimeString()}`,
    );

    const results = await Promise.all(
      validStages.map(async ({ name, quantity }) => {
        return await scheduleStage(name, quantity, startDateTime);
      }),
    );

    const validResults = results.filter((r) => r !== null);
    // End date is the LATEST finishing stage
    const endDateTimes = validResults.map((r) => r.endDateTime);
    const latestEndDateTime =
      endDateTimes.length > 0
        ? new Date(Math.max(...endDateTimes.map((d) => d.getTime())))
        : startDateTime;

    console.log(
      `   Latest completion: ${
        latestEndDateTime.toISOString().split('T')[0]
      } ${latestEndDateTime.toLocaleTimeString()}`,
    );

    return {
      records: validResults,
      endDateTime: latestEndDateTime,
    };
  };

  // ============ SCHEDULE PROJECT STAGES ============
  const projectStages = [];
  let currentDateTime = new Date(
    manualStartDate && manualStartDate !== ''
      ? new Date(manualStartDate)
      : new Date(),
  );
  currentDateTime.setHours(8, 0, 0, 0);

  if (!isBusinessDay(currentDateTime)) {
    currentDateTime = new Date(getNextBusinessDay(currentDateTime));
    currentDateTime.setHours(8, 0, 0, 0);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(
    `🚀 START DATE/TIME: ${
      currentDateTime.toISOString().split('T')[0]
    } ${currentDateTime.toLocaleTimeString()}`,
  );
  console.log(`${'='.repeat(60)}`);

  // GROUP 1: Design & Purchasing (Parallel)
  console.log(`\n📋 GROUP 1: Design & Purchasing (Parallel)`);

  const designStage = await scheduleStage(
    'DESIGN',
    stageQuantities.DESIGN,
    currentDateTime,
  );
  projectStages.push(designStage);

  // Purchasing runs parallel with Design - starts same time, ends when Design ends
  // Purchasing doesn't use capacity hours (manual stage)
  const purchasingTimeTaken = Math.round(
    (designStage.endDateTime - designStage.startDateTime) / (1000 * 60),
  ); // Minutes

  projectStages.push({
    stage: 'PURCHASING',
    workUnits: totalProjectQuantity,
    timeTaken: purchasingTimeTaken,
    startDate: new Date(currentDateTime),
    endDate: new Date(designStage.endDateTime),
    startDateTime: new Date(currentDateTime),
    endDateTime: new Date(designStage.endDateTime),
    capacityDays: 1,
    autoSchedule: true,
    status: 'ACTIVE',
    actualWorkUnits: totalProjectQuantity,
  });

  // Next group starts at the MAX end time of this group
  currentDateTime = new Date(designStage.endDateTime);
  console.log(
    `   Group 1 completes at: ${
      currentDateTime.toISOString().split('T')[0]
    } ${currentDateTime.toLocaleTimeString()}`,
  );

  // GROUP 2: Metal Works (if exists)
  if (hasMetal) {
    console.log(`\n📋 GROUP 2: Metal Works`);
    const metalStage = await scheduleStage(
      'METAL_WORKS',
      stageQuantities.METAL_WORKS,
      currentDateTime,
    );
    if (metalStage) {
      projectStages.push(metalStage);
      currentDateTime = new Date(metalStage.endDateTime);
      console.log(
        `   Metal Works completes at: ${
          currentDateTime.toISOString().split('T')[0]
        } ${currentDateTime.toLocaleTimeString()}`,
      );
    }
  }

  // GROUP 3: Cutting & Edge Banding (Parallel)
  console.log(`\n📋 GROUP 3: Cutting & Edge Banding (Parallel)`);
  const cuttingEdgeStages = [];
  if (stageQuantities.CUTTING > 0)
    cuttingEdgeStages.push({
      name: 'CUTTING',
      quantity: stageQuantities.CUTTING,
    });
  if (stageQuantities.EDGE_BANDING > 0)
    cuttingEdgeStages.push({
      name: 'EDGE_BANDING',
      quantity: stageQuantities.EDGE_BANDING,
    });

  const group3Results = await scheduleParallelStages(
    cuttingEdgeStages,
    currentDateTime,
    'Cutting & Edge Banding',
  );
  if (group3Results.records.length > 0) {
    projectStages.push(...group3Results.records);
    currentDateTime = new Date(group3Results.endDateTime);
    console.log(
      `   Group 3 completes at: ${
        currentDateTime.toISOString().split('T')[0]
      } ${currentDateTime.toLocaleTimeString()}`,
    );
  }

  // GROUP 4: Assembly & Painting (Parallel)
  console.log(`\n📋 GROUP 4: Assembly & Painting (Parallel)`);
  const assemblyPaintingStages = [];
  if (stageQuantities.ASSEMBLY > 0)
    assemblyPaintingStages.push({
      name: 'ASSEMBLY',
      quantity: stageQuantities.ASSEMBLY,
    });
  if (stageQuantities.PAINTING > 0)
    assemblyPaintingStages.push({
      name: 'PAINTING',
      quantity: stageQuantities.PAINTING,
    });

  const group4Results = await scheduleParallelStages(
    assemblyPaintingStages,
    currentDateTime,
    'Assembly & Painting',
  );
  if (group4Results.records.length > 0) {
    projectStages.push(...group4Results.records);
    currentDateTime = new Date(group4Results.endDateTime);
    console.log(
      `   Group 4 completes at: ${
        currentDateTime.toISOString().split('T')[0]
      } ${currentDateTime.toLocaleTimeString()}`,
    );
  }

  // GROUP 5: Finishing (Sequential)
  console.log(`\n📋 GROUP 5: Finishing`);
  const finishingStage = await scheduleStage(
    'FINISHING',
    stageQuantities.FINISHING,
    currentDateTime,
  );
  projectStages.push(finishingStage);
  currentDateTime = new Date(finishingStage.endDateTime);
  console.log(
    `   Finishing completes at: ${
      currentDateTime.toISOString().split('T')[0]
    } ${currentDateTime.toLocaleTimeString()}`,
  );

  // GROUP 6: Delivery (Sequential) - Only if not default customer
  if (stageQuantities.DELIVERY > 0) {
    console.log(`\n📋 GROUP 6: Delivery`);
    const deliveryStage = await scheduleStage(
      'DELIVERY',
      stageQuantities.DELIVERY,
      currentDateTime,
    );
    projectStages.push(deliveryStage);
    currentDateTime = new Date(deliveryStage.endDateTime);
    console.log(
      `   Delivery completes at: ${
        currentDateTime.toISOString().split('T')[0]
      } ${currentDateTime.toLocaleTimeString()}`,
    );
  }

  // GROUP 7: Installation (Sequential) - Only if not default customer
  if (stageQuantities.INSTALLATION > 0) {
    console.log(`\n📋 GROUP 7: Installation`);
    const installationStage = await scheduleStage(
      'INSTALLATION',
      stageQuantities.INSTALLATION,
      currentDateTime,
    );
    projectStages.push(installationStage);
    currentDateTime = new Date(installationStage.endDateTime);
  }

  // Sort stages by start date
  projectStages.sort((a, b) => a.startDateTime - b.startDateTime);
  const calculatedDelivery =
    projectStages[projectStages.length - 1]?.endDateTime || new Date();

  // ============ USE ACTUAL SCHEDULE DURATION (NOT ESTIMATE) ============
  // Calculate actual project duration from the schedule
  const firstStageStart = projectStages[0]?.startDateTime || currentDateTime;
  const lastStageEnd =
    projectStages[projectStages.length - 1]?.endDateTime || currentDateTime;

  // Calculate actual business days between start and end
  const calculateActualBusinessDays = (startDate, endDate) => {
    let count = 0;
    const current = new Date(startDate);
    const end = new Date(endDate);
    current.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    while (current <= end) {
      if (isBusinessDay(current)) {
        count++;
      }
      current.setDate(current.getDate() + 1);
    }
    return count;
  };

  const actualProjectDays = calculateActualBusinessDays(
    firstStageStart,
    lastStageEnd,
  );

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📋 FINAL SCHEDULE (WITH TIMES & ACTUAL METRICS)`);
  console.log(`${'='.repeat(60)}`);
  projectStages.forEach((stage) => {
    const startStr = stage.startDateTime
      ? `${
          stage.startDateTime.toISOString().split('T')[0]
        } ${stage.startDateTime.toLocaleTimeString()}`
      : stage.startDate?.toISOString().split('T')[0];
    const endStr = stage.endDateTime
      ? `${
          stage.endDateTime.toISOString().split('T')[0]
        } ${stage.endDateTime.toLocaleTimeString()}`
      : stage.endDate?.toISOString().split('T')[0];

    const plannedMinutes = calculateRequiredMinutes(
      stage.stage,
      stage.workUnits,
    );

    console.log(`   ${stage.stage}: ${startStr} → ${endStr}`);
    console.log(
      `      📊 Planned: ${stage.workUnits || 0} units (${formatMinutes(
        plannedMinutes,
      )})`,
    );
    console.log(
      `      ✅ Actual: ${stage.actualWorkUnits || 0} units (${formatMinutes(
        stage.timeTaken || 0,
      )})`,
    );
  });
  console.log(
    `\n🎯 DELIVERY: ${
      calculatedDelivery.toISOString().split('T')[0]
    } ${calculatedDelivery.toLocaleTimeString()}`,
  );
  console.log(`📊 ACTUAL PROJECT DURATION: ${actualProjectDays} day(s)`);

  // Calculate total actual vs planned
  const totalPlannedUnits = projectStages.reduce(
    (sum, s) => sum + (s.workUnits || 0),
    0,
  );
  const totalActualUnits = projectStages.reduce(
    (sum, s) => sum + (s.actualWorkUnits || 0),
    0,
  );
  const totalPlannedMinutes = projectStages.reduce((sum, s) => {
    if (s.workUnits) {
      return sum + calculateRequiredMinutes(s.stage, s.workUnits);
    }
    return sum;
  }, 0);
  const totalActualMinutes = projectStages.reduce(
    (sum, s) => sum + (s.timeTaken || 0),
    0,
  );

  console.log(`\n📊 PROJECT SUMMARY:`);
  console.log(`   Total Planned Units: ${totalPlannedUnits}`);
  console.log(`   Total Actual Units: ${totalActualUnits}`);
  console.log(`   Total Planned Time: ${formatMinutes(totalPlannedMinutes)}`);
  console.log(`   Total Actual Time: ${formatMinutes(totalActualMinutes)}`);
  console.log(
    `   Efficiency: ${
      totalPlannedMinutes > 0
        ? ((totalActualMinutes / totalPlannedMinutes) * 100).toFixed(1)
        : 0
    }%`,
  );
  console.log(`${'='.repeat(60)}`);

  try {
    // First create the project and stages
    const project = await prisma.project.create({
      data: {
        customerId: validCustomerId,
        invoiceId,
        status,
        difficulty,
        totalProjectQuantity,
        requestedDelivery:
          requestedDelivery && requestedDelivery !== ''
            ? new Date(requestedDelivery)
            : null,
        calculatedDelivery: new Date(calculatedDelivery),
        totalDays: actualProjectDays,
        createdById: userId,
        stages: {
          create: projectStages.map((stage) => ({
            stage: stage.stage,
            workUnits: stage.workUnits,
            timeTaken: stage.timeTaken || 0, // Now in MINUTES
            capacityDays: stage.capacityDays,
            startDate: new Date(stage.startDateTime || stage.startDate),
            endDate: new Date(stage.endDateTime || stage.endDate),
            autoSchedule: stage.autoSchedule,
            status: stage.status,
          })),
        },
      },
      include: {
        customer: true,
        invoice: {
          include: {
            items: {
              include: {
                proformaItemMaterials: {
                  include: {
                    material: true,
                  },
                },
              },
            },
          },
        },
        stages: {
          orderBy: {
            startDate: 'asc',
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Get the created stages to link with allocations
    const createdStages = await prisma.projectStage.findMany({
      where: {
        projectId: project.id,
      },
    });

    // Create a map of stage name to stage id
    const stageIdMap = {};
    createdStages.forEach((stage) => {
      stageIdMap[stage.stage] = stage.id;
    });

    // Create ProjectStageCapacityAllocation records
    console.log('\n📋 Creating project stage capacity allocations...');

    for (const stageAllocation of allStageAllocations) {
      // Skip stages that are not in CapacityStage enum
      if (!CapacityStageValues.includes(stageAllocation.stage)) {
        console.log(
          `⚠️ Skipping allocation for ${stageAllocation.stage} - not in CapacityStage enum`,
        );
        continue;
      }

      const projectStageId = stageIdMap[stageAllocation.stage];

      if (!projectStageId) {
        console.log(`⚠️ No project stage found for ${stageAllocation.stage}`);
        continue;
      }

      for (const allocation of stageAllocation.allocations) {
        // Get or create DailyStageCapacity record
        const dailyCapacity = await prisma.dailyStageCapacity.upsert({
          where: {
            stage_date: {
              stage: stageAllocation.stage,
              date: allocation.date,
            },
          },
          update: {},
          create: {
            stage: stageAllocation.stage,
            date: allocation.date,
            usedCapacity: 0,
            usedHours: 0,
            maxCapacity: capacityMap[stageAllocation.stage]?.capacity || 1,
            maxHours: WORKING_HOURS_PER_DAY,
            workingHours: WORKING_HOURS_PER_DAY,
          },
        });

        // Create the allocation record
        await prisma.projectStageCapacityAllocation.create({
          data: {
            projectStageId,
            dailyStageCapacityId: dailyCapacity.id,
            allocatedUnits: allocation.units,
            allocatedHours: allocation.hours,
            isOverCapacity: false,
            allocationDate: allocation.date,
          },
        });

        console.log(
          `   ✅ Created allocation for ${stageAllocation.stage} on ${
            allocation.date.toISOString().split('T')[0]
          }: ${allocation.units} units, ${allocation.hours.toFixed(2)} hours`,
        );
      }
    }

    console.log('\n✅ PROJECT CREATED SUCCESSFULLY');
    console.log(`   Project ID: ${project.id}`);
    console.log(`   Actual Duration: ${actualProjectDays} day(s)`);
    console.log(
      `   Delivery Date: ${calculatedDelivery.toISOString().split('T')[0]}`,
    );
    console.log(`   Total Actual Time: ${formatMinutes(totalActualMinutes)}`);
    console.log(`   Total Actual Units: ${totalActualUnits}`);
    console.log(
      `   Total Allocations Created: ${allStageAllocations.reduce(
        (sum, sa) => sum + sa.allocations.length,
        0,
      )}`,
    );

    return project;
  } catch (error) {
    console.error('❌ Error creating project:', error);
    throw error;
  }
};