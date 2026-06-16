/* eslint-disable no-nested-ternary */
/* eslint-disable no-restricted-syntax */
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

const CapacityHistoryAction = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
};

const createCapacitySlot = async (capacityData, userId = null) => {
  const { stage, days, capacity, workingHours, parallelSlots } = capacityData;

  // Validate required fields
  if (!stage) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Stage is required');
  }

  // Validate days and capacity
  if (days === undefined || days === null) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Days is required');
  }

  // Validate days is a positive integer
  if (days < 1) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Days must be a positive integer',
    );
  }

  // Validate capacity if provided (optional field but must be positive if provided)
  if (capacity !== undefined && capacity !== null) {
    if (capacity < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Capacity must be a non-negative integer',
      );
    }
  }

  // Check if capacity lot already exists for this stage (since stage is unique)
  const existingLot = await prisma.capacityLot.findUnique({
    where: { stage },
  });

  if (existingLot) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Capacity lot already exists for stage: ${stage}`,
    );
  }

  // Prepare data object
  const data = {
    stage,
    days: parseInt(days, 10),
  };

  // Only include capacity if it was provided
  if (capacity !== undefined && capacity !== null) {
    data.capacity = parseInt(capacity, 10);
  }
  // workingHours (per-day, float) and parallelSlots (int) — scheduling inputs.
  if (workingHours !== undefined && workingHours !== null) {
    data.workingHours = parseFloat(workingHours);
  }
  if (parallelSlots !== undefined && parallelSlots !== null) {
    data.parallelSlots = Math.max(1, parseInt(parallelSlots, 10));
  }

  // Create capacity lot with transaction to ensure both operations succeed
  const capacityLot = await prisma.$transaction(async (tx) => {
    const createdLot = await tx.capacityLot.create({
      data,
    });

    // Create history log for creation
    await tx.capacityLotHistory.create({
      data: {
        capacityLotId: createdLot.id,
        stage: createdLot.stage,
        oldDays: null,
        newDays: createdLot.days,
        oldCapacity: null,
        newCapacity: createdLot.capacity,
        action: CapacityHistoryAction.CREATED,
        changedById: userId,
      },
    });

    return createdLot;
  });

  return capacityLot;
};

// Update Capacity Lot with History Log
const updateCapacitySlot = async (id, updateBody, userId = null) => {
  // Check if capacity lot exists
  const existingLot = await prisma.capacityLot.findUnique({
    where: { id },
  });

  if (!existingLot) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Capacity lot not found');
  }

  // Clean the updateBody to remove any undefined or null values
  const cleanedUpdateBody = {};
  for (const [key, value] of Object.entries(updateBody)) {
    if (value !== undefined && value !== null) {
      const cleanKey = key.replace(/[^a-zA-Z0-9]/g, '');
      cleanedUpdateBody[cleanKey] = value;
    }
  }

  // Validate days if provided
  if (cleanedUpdateBody.days !== undefined) {
    if (cleanedUpdateBody.days < 1) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Days must be a positive integer',
      );
    }
    // Convert days to integer
    cleanedUpdateBody.days = parseInt(cleanedUpdateBody.days, 10);
  }

  // Validate capacity if provided
  if (cleanedUpdateBody.capacity !== undefined) {
    if (cleanedUpdateBody.capacity < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Capacity must be a non-negative integer',
      );
    }
    // Convert capacity to integer
    cleanedUpdateBody.capacity = parseInt(cleanedUpdateBody.capacity, 10);
  }

  // Coerce scheduling inputs if provided.
  if (cleanedUpdateBody.workingHours !== undefined) {
    cleanedUpdateBody.workingHours = parseFloat(cleanedUpdateBody.workingHours);
  }
  if (cleanedUpdateBody.parallelSlots !== undefined) {
    cleanedUpdateBody.parallelSlots = Math.max(
      1,
      parseInt(cleanedUpdateBody.parallelSlots, 10),
    );
  }

  // If stage is being updated, check for uniqueness
  if (
    cleanedUpdateBody.stage &&
    cleanedUpdateBody.stage !== existingLot.stage
  ) {
    const existingStageLot = await prisma.capacityLot.findUnique({
      where: { stage: cleanedUpdateBody.stage },
    });

    if (existingStageLot) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Capacity lot already exists for stage: ${cleanedUpdateBody.stage}`,
      );
    }
  }

  // Update capacity lot with transaction to ensure both operations succeed
  const updatedCapacityLot = await prisma.$transaction(async (tx) => {
    // Track what fields are being changed for the history log
    const oldDays = existingLot.days;
    const newDays =
      cleanedUpdateBody.days !== undefined ? cleanedUpdateBody.days : oldDays;

    const oldCapacity = existingLot.capacity;
    const newCapacity =
      cleanedUpdateBody.capacity !== undefined
        ? cleanedUpdateBody.capacity
        : oldCapacity;

    const updatedLot = await tx.capacityLot.update({
      where: { id },
      data: cleanedUpdateBody,
    });

    // Create history log for update if any changes were made
    await tx.capacityLotHistory.create({
      data: {
        capacityLotId: id,
        stage: updatedLot.stage,
        oldDays: oldDays !== newDays ? oldDays : null,
        newDays: oldDays !== newDays ? newDays : null,
        oldCapacity: oldCapacity !== newCapacity ? oldCapacity : null,
        newCapacity: oldCapacity !== newCapacity ? newCapacity : null,
        action: CapacityHistoryAction.UPDATED,
        changedById: userId,
      },
    });

    return updatedLot;
  });

  return updatedCapacityLot;
};
/**
 * Simple Capacity Report Service
 * Get capacity progress report with date filtering
 */

const getCapacityReport = async (startDate, endDate) => {
  // Build date filter
  const dateFilter = {};
  if (startDate) {
    dateFilter.gte = new Date(startDate);
  }
  if (endDate) {
    dateFilter.lte = new Date(endDate);
  }

  // Get all capacity lots with their histories within date range
  const capacityLots = await prisma.capacityLot.findMany({
    include: {
      capacityLotHistories: {
        where: dateFilter,
        include: {
          changedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      },
    },
    orderBy: {
      stage: 'asc',
    },
  });

  // Calculate summary statistics
  const totalStages = capacityLots.length;
  const totalCapacity = capacityLots.reduce(
    (sum, lot) => sum + (lot.capacity || 0),
    0,
  );
  const totalDays = capacityLots.reduce((sum, lot) => sum + lot.days, 0);
  const totalWorkingHours = capacityLots.reduce(
    (sum, lot) => sum + (lot.workingHours || 0),
    0,
  );
  const totalParallelSlots = capacityLots.reduce(
    (sum, lot) => sum + (lot.parallelSlots || 0),
    0,
  );

  // Get all history entries within date range
  const allHistories = capacityLots.flatMap((lot) => lot.capacityLotHistories);
  const totalChanges = allHistories.length;
  const createdCount = allHistories.filter(
    (h) => h.action === 'CREATED',
  ).length;
  const updatedCount = allHistories.filter(
    (h) => h.action === 'UPDATED',
  ).length;

  // Prepare stage-wise data
  const stageData = capacityLots.map((lot) => {
    const histories = lot.capacityLotHistories || [];

    // Calculate capacity change within the date range
    let initialCapacity = lot.capacity || 0;
    let finalCapacity = lot.capacity || 0;

    if (histories.length > 0) {
      // Get first and last capacity in the date range
      const sortedHistories = [...histories].sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
      );

      initialCapacity = sortedHistories[0]?.oldCapacity ?? lot.capacity ?? 0;
      finalCapacity =
        sortedHistories[sortedHistories.length - 1]?.newCapacity ??
        lot.capacity ??
        0;
    }

    return {
      stage: lot.stage,
      days: lot.days,
      currentCapacity: lot.capacity || 0,
      initialCapacity,
      finalCapacity,
      capacityChange: finalCapacity - initialCapacity,
      workingHours: lot.workingHours || 0,
      parallelSlots: lot.parallelSlots || 0,
      totalCapacityHours:
        (lot.capacity || 0) * (lot.workingHours || 0) * lot.parallelSlots,
      historyCount: histories.length,
      recentChanges: histories.slice(0, 5),
    };
  });

  // Calculate overall capacity trend
  let cumulativeChange = 0;
  const capacityTrend = allHistories
    .filter((h) => h.action === 'UPDATED')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((h) => {
      cumulativeChange += (h.newCapacity || 0) - (h.oldCapacity || 0);
      return {
        date: h.createdAt,
        stage: h.stage,
        change: (h.newCapacity || 0) - (h.oldCapacity || 0),
        cumulativeChange,
        changedBy: h.changedBy?.name || 'System',
      };
    });

  // Prepare the report
  const report = {
    summary: {
      totalStages,
      totalCapacity,
      totalDays,
      totalWorkingHours,
      totalParallelSlots,
      averageCapacityPerStage:
        totalStages > 0 ? totalCapacity / totalStages : 0,
      averageDaysPerStage: totalStages > 0 ? totalDays / totalStages : 0,
      totalHistoryEntries: totalChanges,
      createdEntries: createdCount,
      updatedEntries: updatedCount,
    },
    dateRange: {
      startDate: startDate || null,
      endDate: endDate || null,
    },
    stages: stageData,
    capacityTrend: capacityTrend.slice(-20), // Last 20 changes
    generatedAt: new Date().toISOString(),
  };

  return report;
};

// Delete Capacity Slot
const deleteCapacitySlot = async (id) => {
  // Check if capacity slot exists
  const existingSlot = await prisma.capacityLot.findUnique({
    where: { id },
  });

  if (!existingSlot) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Capacity slot not found');
  }

  // Delete capacity slot
  await prisma.capacityLot.delete({
    where: { id },
  });

  return { message: 'Capacity slot deleted successfully' };
};

// Get all Capacity Slots (optional - for reference)
const getAllCapacitySlots = async () => {
  const capacitySlots = await prisma.capacityLot.findMany();

  return {
    capacitySlots,
    count: capacitySlots.length,
  };
};

// Get Capacity Slot by ID (optional - for reference)
const getCapacitySlotById = async (id) => {
  const capacitySlot = await prisma.capacityLot.findUnique({
    where: { id },
  });

  if (!capacitySlot) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Capacity slot not found');
  }

  return capacitySlot;
};

// Get Capacity Slot by Stage (optional - for reference)
const getCapacitySlotByStage = async (stage) => {
  const capacitySlot = await prisma.capacityLot.findUnique({
    where: { stage },
  });

  return capacitySlot;
};

module.exports = {
  getCapacityReport,

  createCapacitySlot,
  updateCapacitySlot,
  deleteCapacitySlot,
  getAllCapacitySlots,
  getCapacitySlotById,
  getCapacitySlotByStage,
};
