/* eslint-disable no-nested-ternary */
/* eslint-disable no-restricted-syntax */
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');
const { scheduleProject } = require('./scheduling/engine');
const { VALID_DIFFICULTIES } = require('./scheduling/config');

const generateUniqueCode = async () => {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');

  // Find the count of estimations created today to generate sequence
  const startOfDay = new Date(date.setHours(0, 0, 0, 0));
  const endOfDay = new Date(date.setHours(23, 59, 59, 999));

  const count = await prisma.deliveryEstimation.count({
    where: {
      createdAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
  });

  // Format: DE-YYMMDD-XXX (where XXX is sequential number 001, 002, etc.)
  const sequence = (count + 1).toString().padStart(3, '0');
  const code = `DE-${year}${month}${day}-${sequence}`;

  return code;
};
// Helper function to generate unique estimation code
// Calculate delivery estimate based on selected items
const calculateDeliveryEstimate = async (calculationData) => {
  const { difficulty, stageQuantities } = calculationData;

  if (!difficulty) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Difficulty is required');
  }
  if (!stageQuantities || typeof stageQuantities !== 'object') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Stage quantities are required');
  }
  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid difficulty level');
  }

  const formatMinutes = (minutes) => {
    const m = Math.round(minutes || 0);
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  const totalQuantity = Object.values(stageQuantities).reduce(
    (sum, qty) => sum + (qty || 0),
    0,
  );
  const hasMetal = (stageQuantities.METAL_WORKS || 0) > 0;
  const hasLaminatedMDF = (stageQuantities.EDGE_BANDING || 0) > 0;

  // Capacity-aware DRY RUN through the SHARED scheduling engine — the exact same
  // engine createProject uses, so an estimate reproduces the project created from
  // it (given the same stage quantities). dryRun consults existing capacity (so
  // estimates no longer silently over-book) but reserves nothing.
  const plan = await scheduleProject({ stageQuantities, difficulty, mode: 'dryRun' });

  const stageResults = {};
  const stageDays = {};
  let totalActualMinutes = 0;
  plan.stages.forEach((s) => {
    stageResults[s.stage] = {
      workUnits: s.workUnits,
      actualWorkUnits: s.actualWorkUnits,
      timeTaken: s.timeTaken,
      timeTakenFormatted: formatMinutes(s.timeTaken),
      daysUsed: s.capacityDays,
      startDateTime: s.startDateTime,
      endDateTime: s.endDateTime,
    };
    stageDays[s.stage] = s.capacityDays;
    totalActualMinutes += s.timeTaken || 0;
  });

  const estimatedBusinessDays = plan.estimatedDays;
  const estimatedDelivery = plan.deliveryDate;

  return {
    inputs: {
      difficulty,
      stageQuantities,
      totalQuantity,
      hasMetal,
      hasLaminatedMDF,
    },
    timeline: {
      baseBusinessDays: plan.productionWorkingDays,
      difficultyAdjustmentDays: plan.difficultyAdjustmentDays || 0,
      contingencyDays: plan.contingencyDays || 0,
      estimatedBusinessDays,
      estimatedDeliveryDate: estimatedDelivery.toISOString(),
      formattedDeliveryDate: estimatedDelivery.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      estimatedDeliveryTime: estimatedDelivery.toLocaleTimeString(),
    },
    stageResults,
    stageDays,
    allocations: plan.stages.flatMap((s) =>
      (s.allocations || []).map((a) => ({
        date: a.date,
        hours: a.hours,
        units: a.units,
        stage: s.stage,
      })),
    ),
    summary: {
      message: `Based on ${totalQuantity} total units across all stages with ${difficulty.toLowerCase()} difficulty`,
      totalTime: `${estimatedBusinessDays} business days (production ${plan.productionWorkingDays} + difficulty ${plan.difficultyAdjustmentDays || 0} + contingency ${plan.contingencyDays || 0})`,
      deliveryDate: estimatedDelivery.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      totalActualMinutes,
      totalActualTimeFormatted: formatMinutes(totalActualMinutes),
    },
  };
};

// Create delivery estimation from stage quantities
const createDeliveryEstimation = async (estimationData, userId) => {
  console.log('=== START createDeliveryEstimation ===');
  console.log('Estimation data:', estimationData);

  try {
    const {
      customerName,
      phone,
      difficulty,
      status = 'ESTIMATED',
      holdUntil,
      // Stage quantities directly from the request
      DESIGN,
      METAL_WORKS,
      CNC,
      CUTTING,
      EDGE_BANDING,
      ASSEMBLY,
      PAINTING,
      FINISHING,
      DELIVERY,
    } = estimationData;

    // ─────────────────────────────────────────────
    // Validation
    // ─────────────────────────────────────────────
    if (!difficulty) {
      console.error('❌ Missing required field: difficulty');
      throw new ApiError(httpStatus.BAD_REQUEST, 'Difficulty is required');
    }

    // Validate difficulty level
    const validDifficulties = ['EASY', 'MEDIUM', 'HARD'];
    if (!validDifficulties.includes(difficulty)) {
      console.error('❌ Invalid difficulty:', difficulty);
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid difficulty level');
    }

    if (holdUntil) {
      const holdDate = new Date(holdUntil);
      const now = new Date();

      if (holdDate <= now) {
        console.error('❌ Hold until date is not in the future');
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Hold until date must be in the future',
        );
      }
    }

    if (phone && phone.trim().length > 0) {
      const phoneRegex = /^[\+]?[0-9\s\-\(\)]{10,}$/;
      if (!phoneRegex.test(phone.trim())) {
        console.error('❌ Invalid phone number:', phone);
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Please provide a valid phone number',
        );
      }
    }

    // Prepare stage quantities object
    const stageQuantities = {
      DESIGN: DESIGN || 0,
      METAL_WORKS: METAL_WORKS || 0,
      CNC: CNC || 0,
      CUTTING: CUTTING || 0,
      EDGE_BANDING: EDGE_BANDING || 0,
      ASSEMBLY: ASSEMBLY || 0,
      PAINTING: PAINTING || 0,
      FINISHING: FINISHING || 0,
      DELIVERY: DELIVERY || 0,
    };

    // Validate at least one stage has quantity > 0
    const hasAnyQuantity = Object.values(stageQuantities).some(
      (qty) => qty > 0,
    );
    if (!hasAnyQuantity) {
      console.error('❌ No stage quantities provided');
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'At least one stage quantity must be greater than 0',
      );
    }

    // Calculate total quantity
    const totalQuantity = Object.values(stageQuantities).reduce(
      (sum, qty) => sum + qty,
      0,
    );

    // Generate unique estimation code
    const code = await generateUniqueCode();

    // ─────────────────────────────────────────────
    // Calculate estimate using the calculation function
    // ─────────────────────────────────────────────
    console.log('=== Calling calculateDeliveryEstimate ===');

    const calculationResult = await calculateDeliveryEstimate({
      difficulty,
      stageQuantities,
    });

    console.log('✅ Calculation completed successfully');
    console.log(
      `Estimated days: ${calculationResult.timeline.estimatedBusinessDays}`,
    );
    console.log(
      `Delivery date: ${calculationResult.timeline.formattedDeliveryDate}`,
    );

    // Extract values
    const estimatedDays = calculationResult.timeline.estimatedBusinessDays;
    const estimatedDelivery = new Date(
      calculationResult.timeline.estimatedDeliveryDate,
    );

    // ============ CREATE DELIVERY ESTIMATION ============
    console.log('\n=== Creating Delivery Estimation in DB ===');

    const estimation = await prisma.deliveryEstimation.create({
      data: {
        code,
        customerName: customerName ? customerName.trim() : null,
        phone: phone ? phone.trim() : null,
        difficulty,
        totalQuantity,
        estimatedDays,
        estimatedDelivery,
        status,
        holdUntil: holdUntil ? new Date(holdUntil) : null,
        createdById: userId,
        // Store the stage quantities (these are the INPUT quantities, not days)
        DESIGN: stageQuantities.DESIGN,
        METAL_WORKS: stageQuantities.METAL_WORKS,
        CNC: stageQuantities.CNC,
        CUTTING: stageQuantities.CUTTING,
        EDGE_BANDING: stageQuantities.EDGE_BANDING,
        ASSEMBLY: stageQuantities.ASSEMBLY,
        PAINTING: stageQuantities.PAINTING,
        FINISHING: stageQuantities.FINISHING,
        DELIVERY: stageQuantities.DELIVERY,
      },
    });

    console.log('✅ Delivery Estimation created:', estimation.id);

    // ============ UPDATE DAILY STAGE CAPACITY ============
    console.log('\n=== Updating Daily Stage Capacity ===');

    // ============ FETCH COMPLETE ESTIMATION ============
    console.log('\n=== Fetching Complete Estimation ===');

    return {
      calculationDetails: {
        inputs: calculationResult.inputs,
        timeline: calculationResult.timeline,
        stageResults: calculationResult.stageResults,
        summary: calculationResult.summary,
      },
    };
  } catch (error) {
    console.error('❌ Error in createDeliveryEstimation:', {
      error: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
    });

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to create delivery estimation: ${error.message}`,
    );
  }
};

// Create delivery estimation from selected items

// Update Delivery Estimation
const updateDeliveryEstimation = async (id, updateBody, userId) => {
  // Check if estimation exists
  const existingEstimation = await prisma.deliveryEstimation.findUnique({
    where: { id },
  });

  if (!existingEstimation) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Delivery estimation not found');
  }

  // Check if estimation can be updated (not expired or confirmed)
  if (existingEstimation.status === 'EXPIRED') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot update an expired estimation',
    );
  }

  if (existingEstimation.status === 'CONFIRMED') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot update a confirmed estimation',
    );
  }

  // Clean the updateBody to remove any undefined or null values
  const cleanedUpdateBody = {};
  for (const [key, value] of Object.entries(updateBody)) {
    if (value !== undefined && value !== null) {
      const cleanKey = key.replace(/[^a-zA-Z0-9]/g, '');
      cleanedUpdateBody[cleanKey] =
        typeof value === 'string' ? value.trim() : value;
    }
  }

  // Validate total quantity if provided
  if (cleanedUpdateBody.totalQuantity !== undefined) {
    if (cleanedUpdateBody.totalQuantity <= 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Total quantity must be greater than 0',
      );
    }
  }

  // Validate estimated days if provided
  if (cleanedUpdateBody.estimatedDays !== undefined) {
    if (cleanedUpdateBody.estimatedDays <= 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Estimated days must be greater than 0',
      );
    }
  }

  // Validate estimated delivery date if provided
  if (cleanedUpdateBody.estimatedDelivery !== undefined) {
    const deliveryDate = new Date(cleanedUpdateBody.estimatedDelivery);
    if (deliveryDate <= new Date()) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Estimated delivery date must be in the future',
      );
    }
  }

  // Validate phone number format if provided
  if (
    cleanedUpdateBody.phone !== undefined &&
    cleanedUpdateBody.phone.length > 0
  ) {
    const phoneRegex = /^[\+]?[0-9\s\-\(\)]{10,}$/;
    if (!phoneRegex.test(cleanedUpdateBody.phone)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Please provide a valid phone number',
      );
    }
  }

  // Update delivery estimation
  const updatedEstimation = await prisma.deliveryEstimation.update({
    where: { id },
    data: {
      ...cleanedUpdateBody,
      updatedById: userId,
    },
  });

  return updatedEstimation;
};

// Delete Delivery Estimation
// Delete Delivery Estimation
const deleteDeliveryEstimation = async (id) => {
  // Check if estimation exists
  const existingEstimation = await prisma.deliveryEstimation.findUnique({
    where: { id },
  });

  if (!existingEstimation) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Delivery estimation not found');
  }

  // Check if estimation can be deleted (only if not confirmed)
  if (existingEstimation.status === 'CONFIRMED') {
    throw new ApiError(
      httpStatus.CONFLICT,
      'Cannot delete a confirmed delivery estimation',
    );
  }

  await prisma.deliveryEstimation.delete({
    where: { id },
  });

  return { message: 'Delivery estimation deleted successfully' };
};
const getAllOnHoldDeliveryEstimations = async (
  sortBy = 'createdAt',
  sortOrder = 'desc',
) => {
  // 🔹 Auto-expire ON_HOLD estimations whose holdUntil has passed
  const now = new Date();

  const expiredHoldEstimations = await prisma.deliveryEstimation.findMany({
    where: {
      status: 'ON_HOLD',
      holdUntil: {
        lt: now,
      },
    },
  });

  if (expiredHoldEstimations.length > 0) {
    await prisma.deliveryEstimation.updateMany({
      where: {
        id: {
          in: expiredHoldEstimations.map((est) => est.id),
        },
      },
      data: {
        status: 'EXPIRED',
        holdUntil: null,
      },
    });
  }

  // 🔥 ONLY ON_HOLD — no filters, no pagination
  const where = { status: 'ON_HOLD' };

  const estimations = await prisma.deliveryEstimation.findMany({
    where,
    include: {
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      updatedBy: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: {
      [sortBy]: sortOrder,
    },
  });

  // ✅ Total count
  const total = await prisma.deliveryEstimation.count({ where });

  return {
    total,
    estimations,
  };
};
// Get all Delivery Estimations
const getAllDeliveryEstimations = async (filters = {}) => {
  const {
    status,
    difficulty,
    startDate,
    endDate,
    customerName,
    page = 1,
    limit = 10,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = filters;

  // First, check and expire any estimations where holdUntil has passed
  const now = new Date();

  // Find all estimations that are ON_HOLD and holdUntil date has passed
  const expiredHoldEstimations = await prisma.deliveryEstimation.findMany({
    where: {
      status: 'ON_HOLD',
      holdUntil: {
        lt: now, // holdUntil is less than current time (already passed)
      },
    },
  });

  // Update all expired hold estimations to EXPIRED status
  if (expiredHoldEstimations.length > 0) {
    await prisma.deliveryEstimation.updateMany({
      where: {
        id: {
          in: expiredHoldEstimations.map((est) => est.id),
        },
      },
      data: {
        status: 'EXPIRED',
        holdUntil: null, // Clear holdUntil since it's now expired
      },
    });

    // You might want to log this or add updatedById if needed
    console.log(
      `Auto-expired ${expiredHoldEstimations.length} delivery estimations on hold`,
    );
  }

  // Build where clause for the query
  const where = {};

  if (status) {
    where.status = status;
  }

  if (difficulty) {
    where.difficulty = difficulty;
  }

  if (customerName) {
    where.customerName = {
      contains: customerName,
      mode: 'insensitive',
    };
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      where.createdAt.gte = new Date(startDate);
    }
    if (endDate) {
      where.createdAt.lte = new Date(endDate);
    }
  }

  // Calculate pagination
  const skip = (page - 1) * limit;

  // Get estimations with pagination
  const estimations = await prisma.deliveryEstimation.findMany({
    where,
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      updatedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: {
      [sortBy]: sortOrder,
    },
    skip,
    take: parseInt(limit, 10),
  });

  // Get total count
  const total = await prisma.deliveryEstimation.count({ where });

  return {
    estimations,
    pagination: {
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      totalPages: Math.ceil(total / limit),
    },
  };
};
// Get Delivery Estimation by ID
const getDeliveryEstimationById = async (id) => {
  const estimation = await prisma.deliveryEstimation.findUnique({
    where: { id },
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      updatedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  if (!estimation) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Delivery estimation not found');
  }

  return estimation;
};

// Update Delivery Estimation Status
const updateDeliveryEstimationStatus = async (id, status, userId) => {
  // Check if estimation exists
  const existingEstimation = await prisma.deliveryEstimation.findUnique({
    where: { id },
  });

  if (!existingEstimation) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Delivery estimation not found');
  }

  // Validate status transition
  const validTransitions = {
    ESTIMATED: ['ON_HOLD', 'CONFIRMED', 'EXPIRED'],
    ON_HOLD: ['ESTIMATED', 'CONFIRMED', 'EXPIRED'],
    CONFIRMED: ['EXPIRED'], // Once confirmed, can only expire
    EXPIRED: [], // Once expired, cannot change status
  };

  const allowedTransitions = validTransitions[existingEstimation.status] || [];
  if (!allowedTransitions.includes(status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot change status from ${existingEstimation.status} to ${status}`,
    );
  }

  // Prepare update data
  const updateData = {
    status,
    updatedById: userId,
  };

  // If status is being changed to ON_HOLD, add holdUntil date (3 days from today)
  if (status === 'ON_HOLD') {
    const holdUntilDate = new Date();
    holdUntilDate.setDate(holdUntilDate.getDate() + 3);
    updateData.holdUntil = holdUntilDate;
  }
  // If status is being changed from ON_HOLD to another status, clear holdUntil
  else if (existingEstimation.status === 'ON_HOLD') {
    updateData.holdUntil = null;
  }

  // Update status and holdUntil if applicable
  const updatedEstimation = await prisma.deliveryEstimation.update({
    where: { id },
    data: updateData,
  });

  return updatedEstimation;
};

// Put Delivery Estimation on Hold
const putDeliveryEstimationOnHold = async (id, holdUntil, userId) => {
  // Check if estimation exists
  const existingEstimation = await prisma.deliveryEstimation.findUnique({
    where: { id },
  });

  if (!existingEstimation) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Delivery estimation not found');
  }

  // Validate current status
  if (existingEstimation.status !== 'ESTIMATED') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot put estimation on hold. Current status is ${existingEstimation.status}`,
    );
  }

  // Validate holdUntil date
  const holdDate = new Date(holdUntil);
  if (holdDate <= new Date()) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Hold until date must be in the future',
    );
  }

  // Update to ON_HOLD with holdUntil
  const updatedEstimation = await prisma.deliveryEstimation.update({
    where: { id },
    data: {
      status: 'ON_HOLD',
      holdUntil: holdDate,
      updatedById: userId,
    },
  });

  return updatedEstimation;
};

// Confirm Delivery Estimation
const confirmDeliveryEstimation = async (id, userId) => {
  // Check if estimation exists
  const existingEstimation = await prisma.deliveryEstimation.findUnique({
    where: { id },
  });

  if (!existingEstimation) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Delivery estimation not found');
  }

  // Validate current status
  if (existingEstimation.status !== 'ESTIMATED') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot confirm estimation. Current status is ${existingEstimation.status}`,
    );
  }

  // Update to CONFIRMED
  const updatedEstimation = await prisma.deliveryEstimation.update({
    where: { id },
    data: {
      status: 'CONFIRMED',
      updatedById: userId,
    },
  });

  return updatedEstimation;
};

// Get Delivery Estimations by Status
const getDeliveryEstimationsByStatus = async (status) => {
  const estimations = await prisma.deliveryEstimation.findMany({
    where: { status },
    include: {
      createdBy: {
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
  });

  return {
    estimations,
    count: estimations.length,
  };
};

// Check and expire old estimations
const expireOldEstimations = async () => {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Find estimations older than 1 week that are still ESTIMATED or ON_HOLD
  const oldEstimations = await prisma.deliveryEstimation.updateMany({
    where: {
      AND: [
        {
          createdAt: {
            lt: oneWeekAgo,
          },
        },
        {
          status: {
            in: ['ESTIMATED', 'ON_HOLD'],
          },
        },
      ],
    },
    data: {
      status: 'EXPIRED',
    },
  });

  return {
    expiredCount: oldEstimations.count,
  };
};

/**
 * Create project from delivery estimation
 */
const createProjectFromDeliveryEstimation = async (
  deliveryEstimationCode,
  proformaInvoiceId,
  userId,
) => {
  // Convert a confirmed estimate into a real project.
  //
  // Per the unified-scheduling decision we RECOMPUTE the schedule through the
  // shared engine (via Project.service.createProject) instead of copying stored
  // estimate stages. Because the estimate was produced by that same engine, the
  // resulting project's delivery date matches the quote. (The previous version
  // read a `deliveryEstimationStages` relation that does not exist in the schema
  // and was therefore non-functional.)
  // eslint-disable-next-line global-require
  const { createProject } = require('./Project.service');

  const invoice = await prisma.proformaInvoice.findUnique({
    where: { id: proformaInvoiceId },
    include: { customer: true, project: true },
  });
  if (!invoice) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Proforma invoice not found');
  }
  if (invoice.project) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'Invoice already associated with another project',
    );
  }

  const estimation = await prisma.deliveryEstimation.findUnique({
    where: { code: deliveryEstimationCode },
  });
  if (!estimation) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Delivery estimation not found');
  }
  if (estimation.status === 'PROJECT_CREATED') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'This delivery estimation has already been converted to a project',
    );
  }

  // Recompute the schedule from the invoice using the shared engine.
  const project = await createProject(
    {
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      status: 'INVOICE',
      difficulty: estimation.difficulty,
      requestedDelivery: null,
    },
    userId,
  );

  // Link the estimate to the project and mark it converted.
  await prisma.project.update({
    where: { id: project.id },
    data: { deliveryEstimationcode: estimation.code },
  });
  await prisma.deliveryEstimation.update({
    where: { id: estimation.id },
    data: { status: 'PROJECT_CREATED', updatedById: userId },
  });

  return prisma.project.findUnique({
    where: { id: project.id },
    include: {
      customer: true,
      invoice: { include: { customer: true } },
      stages: { orderBy: { startDate: 'asc' } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
};

module.exports = {
  createDeliveryEstimation,
  updateDeliveryEstimation,
  deleteDeliveryEstimation,
  getAllDeliveryEstimations,
  getDeliveryEstimationById,
  updateDeliveryEstimationStatus,
  putDeliveryEstimationOnHold,
  confirmDeliveryEstimation,
  getDeliveryEstimationsByStatus,
  expireOldEstimations,
  calculateDeliveryEstimate,
  createProjectFromDeliveryEstimation,
  getAllOnHoldDeliveryEstimations,
};
