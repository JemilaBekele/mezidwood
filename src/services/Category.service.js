const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');
const reschedule = require('./scheduling/reschedule');
const rebuildLedger = require('./scheduling/rebuildLedger');
const { WORKING_DAYS, CAPACITY_STAGES, OVERCAPACITY_FACTOR } = require('./scheduling/config');

/**
 * Count working days in a date range, excluding weekly off-days and holidays.
 */
const countWorkingDaysInRange = async (fromStr, toStr) => {
  const from = new Date(`${fromStr}T00:00:00Z`);
  const to = new Date(`${toStr}T23:59:59Z`);

  // Load holidays that fall within the range.
  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: from, lte: to } },
    select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));

  let count = 0;
  const d = new Date(from);
  while (d <= to) {
    const dk = d.toISOString().slice(0, 10);
    if (WORKING_DAYS[d.getUTCDay()] && !holidaySet.has(dk)) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
};

// Get Category by ID
const getCategoryById = async (id) => {
  const category = await prisma.category.findUnique({
    where: { id },
  });
  return category;
};

// Get Category by Name
const getCategoryByName = async (name) => {
  const category = await prisma.category.findFirst({
    where: { name },
  });
  return category;
};

// Get all Categories
const getAllCategories = async () => {
  const categories = await prisma.category.findMany({
    orderBy: {
      name: 'asc',
    },
  });

  return {
    categories,
    count: categories.length,
  };
};
const getAllDailyStageCapacities = async () => {
  const today = new Date();
  const startDate = new Date();
  startDate.setDate(today.getDate() - 10);

  const dailyStageCapacities = await prisma.dailyStageCapacity.findMany({
    where: {
      date: {
        gte: startDate,
      },
    },
    include: {
      projectStageCapacityAllocations: {
        include: {
          projectStage: {
            include: {
              project: {
                include: {
                  invoice: true,
                  customer: true,
                },
              },
            },
          },
        },
        orderBy: {
          allocationDate: 'asc',
        },
      },
    },
    orderBy: {
      date: 'asc',
    },
  });

  // ✅ Transform and FILTER OUT zero capacity records
  const transformedData = dailyStageCapacities
    .map((item) => {
      // Calculate actual used capacity from allocations
      const actualUsedCapacity = item.projectStageCapacityAllocations.reduce(
        (sum, allocation) => sum + allocation.allocatedUnits,
        0,
      );

      const actualUsedHours = item.projectStageCapacityAllocations.reduce(
        (sum, allocation) => sum + allocation.allocatedHours,
        0,
      );

      return {
        ...item,
        // Override with calculated values
        usedCapacity: actualUsedCapacity,
        usedHours: actualUsedHours,
        usagePercent:
          item.maxCapacity > 0
            ? (actualUsedCapacity / item.maxCapacity) * 100
            : 0,
        status: actualUsedCapacity === 0 ? 'Unplanned' : 'Planned',
      };
    })
    // ✅ FILTER: Only keep records where usedCapacity > 0
    .filter((item) => item.usedCapacity > 0);

  return {
    dailyStageCapacities: transformedData,
    count: transformedData.length, // This will now only count non-zero records
  };
};
const resetDailyStageCapacities = async () => {
  try {
    console.log(
      '🟡 Starting reset of daily stage capacities...',
    );

    // Delete allocations first
    const deletedAllocations =
      await prisma.projectStageCapacityAllocation.deleteMany(
        {},
      );

    console.log(
      '✅ Deleted allocations:',
      deletedAllocations.count,
    );

    // Delete daily capacities
    const deletedDailyCapacities =
      await prisma.dailyStageCapacity.deleteMany({});

    console.log(
      '✅ Deleted daily capacities:',
      deletedDailyCapacities.count,
    );

    return {
      success: true,
      message:
        'All daily stage capacities and allocations deleted successfully.',
      deletedAllocationCount:
        deletedAllocations.count,
      deletedDailyCapacityCount:
        deletedDailyCapacities.count,
    };
  } catch (error) {
    console.error(
      '❌ Error resetting daily stage capacities:',
      error,
    );

    throw error;
  }
};

/**
 * "Rebuild" the calendar = COMPACT THE CURRENT WEEK ONLY.
 *
 * Instead of the old destructive full re-plan (wipe ledger + reschedule every
 * project from today), this now does a gentle, conservative compaction: stages
 * that currently start within this working week are pulled earlier ONLY into
 * genuinely empty space (after their upstream finishes), removing gaps. Nothing
 * dated outside the current week moves, there is no downstream cascade, other
 * projects are never moved, and if nothing can move nothing is written.
 * See reschedule.compactCurrentWeek.
 */
// NOTE: despite the name this does NOT reconcile the ledger — it pulls work
// forward into gaps in the current week. Use `reconcileCapacityLedger` below to
// repair drifted counters.
const rebuildCapacityLedger = async () => reschedule.compactCurrentWeek();

/**
 * Recompute every daily capacity counter from its allocation rows, enforcing
 * `usedCapacity === Σ allocatedUnits`. Shares its implementation with
 * `npm run capacity:rebuild` so the endpoint and the CLI cannot drift apart.
 */
const reconcileCapacityLedger = async (dryRun = false) =>
  rebuildLedger.rebuildCapacityLedger({ dryRun });
// Create Category
const createCategory = async (categoryBody) => {
  // Check if category with same name already exists
  if (await getCategoryByName(categoryBody.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Category name already taken');
  }

  const category = await prisma.category.create({
    data: categoryBody,
  });
  return category;
};

// Update Category
const updateCategory = async (id, updateBody) => {
  const existingCategory = await getCategoryById(id);
  if (!existingCategory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
  }

  // Check if name is being updated to an existing category name
  if (updateBody.name && updateBody.name !== existingCategory.name) {
    if (await getCategoryByName(updateBody.name)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Category name already taken');
    }
  }

  const updatedCategory = await prisma.category.update({
    where: { id },
    data: updateBody,
    include: {
      products: true,
    },
  });

  return updatedCategory;
};

// Delete Category
const deleteCategory = async (id) => {
  const existingCategory = await getCategoryById(id);
  if (!existingCategory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
  }

  await prisma.category.delete({
    where: { id },
  });

  return { message: 'Category deleted successfully' };
};
const getColourById = async (id) => {
  const colour = await prisma.colour.findUnique({
    where: { id },
    include: {
      products: true,
    },
  });

  if (!colour) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Colour not found');
  }

  return colour;
};

// Get Colour by Name
const getColourByName = async (name) => {
  const colour = await prisma.colour.findFirst({
    where: {
      name: {
        equals: name,
      },
    },
  });
  return colour;
};

// Get all Colours with pagination and filtering
const getAllColours = async (filter, options) => {
  const { name } = filter || {};
  const { sortBy, order, page = 1, limit = 10 } = options || {};

  // Build where clause
  const where = {};
  if (name) {
    where.name = {
      contains: name,
      mode: 'insensitive',
    };
  }

  // Calculate pagination
  const skip = (page - 1) * limit;

  // Get total count
  const total = await prisma.colour.count({ where });

  // Get colours with pagination
  const colours = await prisma.colour.findMany({
    where,
    orderBy: sortBy ? { [sortBy]: order || 'asc' } : { name: 'asc' },
    skip,
    take: limit,
    include: {
      products: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  const totalPages = Math.ceil(total / limit);

  return {
    colours,
    count: colours.length,
    total,
    page,
    totalPages,
    limit,
  };
};

// Create Colour
const createColour = async (colourBody) => {
  // Check if colour with same name already exists (case-insensitive)
  const existingColour = await getColourByName(colourBody.name);
  if (existingColour) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Colour name already exists');
  }

  const colour = await prisma.colour.create({
    data: colourBody,
  });

  return colour;
};

// Update Colour
const updateColour = async (id, updateBody) => {
  const existingColour = await getColourById(id);

  // Check if name is being updated to an existing colour name
  if (updateBody.name && updateBody.name !== existingColour.name) {
    const colourWithSameName = await getColourByName(updateBody.name);
    if (colourWithSameName) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Colour name already exists');
    }
  }

  const updatedColour = await prisma.colour.update({
    where: { id },
    data: updateBody,
    include: {
      products: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return updatedColour;
};

// Delete Colour
const deleteColour = async (id) => {
  const existingColour = await getColourById(id);

  // Check if colour has associated products
  if (existingColour.products && existingColour.products.length > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot delete colour with associated products. Remove products first.',
    );
  }

  await prisma.colour.delete({
    where: { id },
  });

  return {
    message: 'Colour deleted successfully',
    deletedColour: existingColour.name,
  };
};

/**
 * Compute telemetry stats (utilization, units, hours, over-capacity) for a date range.
 * The denominator (eff, maxH) is the TOTAL company capacity across ALL stages × working
 * days — derived from CapacityLot — not just stages that have DailyStageCapacity rows.
 * @param {string} from - ISO date string (YYYY-MM-DD)
 * @param {string} to   - ISO date string (YYYY-MM-DD)
 * @param {string} [stageFilter] - Optional stage filter (e.g. "CUTTING")
 */
const getCapacityTelemetry = async (from, to, stageFilter) => {
  // 1. Get total company capacity from CapacityLot (the theoretical maximum).
  const lots = await prisma.capacityLot.findMany();
  const workingDays = await countWorkingDaysInRange(from, to);

  // Build per-stage theoretical capacity.
  const lotMap = {};
  lots.forEach((lot) => {
    lotMap[lot.stage] = {
      dailyUnits: (lot.capacity || 0) * (lot.parallelSlots || 1),
      dailyHours: lot.workingHours || 7.5,
    };
  });

  // Calculate total company capacity (denominator).
  const stagesToCount = stageFilter && stageFilter !== 'ALL'
    ? [stageFilter]
    : CAPACITY_STAGES;

  let totalEff = 0;
  let totalMaxH = 0;
  stagesToCount.forEach((s) => {
    const l = lotMap[s] || { dailyUnits: 0, dailyHours: 7.5 };
    totalEff += l.dailyUnits * workingDays;
    totalMaxH += l.dailyHours * workingDays;
  });

  // 2. Get actual usage from DailyStageCapacity rows (the numerator).
  const where = {
    date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59Z`) },
  };
  if (stageFilter && stageFilter !== 'ALL') where.stage = stageFilter;

  const rows = await prisma.dailyStageCapacity.findMany({
    where,
    include: {
      projectStageCapacityAllocations: { select: { allocatedUnits: true, allocatedHours: true } },
    },
  });

  let used = 0;
  let usedH = 0;
  let over = 0; // days in the allowed overcapacity band (>100%, ≤125%)
  let violation = 0; // days that BREACH the 125% hard ceiling
  let allocs = 0;
  const days = new Set();

  rows.forEach((r) => {
    const rowUsed = r.projectStageCapacityAllocations.reduce((s, a) => s + a.allocatedUnits, 0);
    const rowHours = r.projectStageCapacityAllocations.reduce((s, a) => s + a.allocatedHours, 0);
    const rowMax = r.maxCapacity || 0;

    used += rowUsed;
    usedH += rowHours;
    allocs += r.projectStageCapacityAllocations.length;
    if (rowUsed > rowMax || (r.overCapacityUsed || 0) > 0) over += 1;
    // A violation is any day that exceeds the 125% ceiling (rowMax is the 100%
    // base). The scheduler now overflows past 125%, so this should normally be 0
    // — a non-zero count flags data that pre-dates the ceiling fix or manual edits.
    if (rowMax > 0 && rowUsed > rowMax * OVERCAPACITY_FACTOR + 0.001) violation += 1;
    days.add(r.date.toISOString().slice(0, 10));
  });

  // 3. Compute utilization — hours-based is the primary metric because
  //    units are NOT comparable across stages (1 design unit ≠ 1 cutting unit),
  //    but hours are the universal currency of factory time.
  const util = totalMaxH > 0 ? (usedH / totalMaxH) * 100 : 0;
  const unitsUtil = totalEff > 0 ? (used / totalEff) * 100 : 0;

  return {
    used: Math.round(used * 100) / 100,
    eff: Math.round(totalEff * 100) / 100,
    usedH: Math.round(usedH * 100) / 100,
    maxH: Math.round(totalMaxH * 100) / 100,
    over,
    violation,
    allocs,
    activeDays: days.size,
    util: Math.round(util * 100) / 100,
    unitsUtil: Math.round(unitsUtil * 100) / 100,
    hoursUtil: Math.round(util * 100) / 100,
    workingDays,
    from,
    to,
  };
};

/**
 * Compute per-stage utilization for a date range (stage load rail).
 * Each stage's denominator (eff) is derived from CapacityLot × working days,
 * ensuring idle stages still show their available capacity.
 * @param {string} from - ISO date string (YYYY-MM-DD)
 * @param {string} to   - ISO date string (YYYY-MM-DD)
 */
const getStageLoadRail = async (from, to) => {
  // 1. Get theoretical per-stage capacity from CapacityLot.
  const lots = await prisma.capacityLot.findMany();
  const workingDays = await countWorkingDaysInRange(from, to);

  const lotMap = {};
  lots.forEach((lot) => {
    lotMap[lot.stage] = (lot.capacity || 0) * (lot.parallelSlots || 1) * workingDays;
  });

  // 2. Get actual usage.
  const rows = await prisma.dailyStageCapacity.findMany({
    where: {
      date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59Z`) },
    },
    include: {
      projectStageCapacityAllocations: { select: { allocatedUnits: true } },
    },
  });

  const agg = {};
  rows.forEach((r) => {
    const rowUsed = r.projectStageCapacityAllocations.reduce((s, a) => s + a.allocatedUnits, 0);
    const rowMax = r.maxCapacity || 0;
    if (!agg[r.stage]) agg[r.stage] = { used: 0, over: false, violation: false };
    agg[r.stage].used += rowUsed;
    if (rowUsed > rowMax || (r.overCapacityUsed || 0) > 0) agg[r.stage].over = true;
    // Breach of the 125% hard ceiling (rowMax is the 100% base).
    if (rowMax > 0 && rowUsed > rowMax * OVERCAPACITY_FACTOR + 0.001) agg[r.stage].violation = true;
  });

  return {
    stages: CAPACITY_STAGES.map((s) => ({
      stage: s,
      used: Math.round((agg[s]?.used || 0) * 100) / 100,
      eff: Math.round((lotMap[s] || 0) * 100) / 100,
      over: agg[s]?.over || false,
      violation: agg[s]?.violation || false,
    })),
    workingDays,
    from,
    to,
  };
};

module.exports = {
  getAllDailyStageCapacities,
  resetDailyStageCapacities,
  rebuildCapacityLedger,
  reconcileCapacityLedger,
  getCapacityTelemetry,
  getStageLoadRail,
  getCategoryById,
  getCategoryByName,
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getColourById,
  getColourByName,
  getAllColours,
  createColour,
  updateColour,
  deleteColour,
};
