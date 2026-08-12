/* eslint-disable no-nested-ternary */
/* eslint-disable no-restricted-syntax */
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');
const {
  scheduleProject,
  computeStageQuantities,
  withTimeBasedStages,
} = require('./scheduling/engine');
const { VALID_DIFFICULTIES, CAPACITY_STAGES } = require('./scheduling/config');

// Columns a client is allowed to sort by. FN-9: `orderBy: { [sortBy]: order }`
// with an unvalidated query param threw a raw 500 on any unknown field.
const SORTABLE_FIELDS = [
  'createdAt',
  'updatedAt',
  'code',
  'customerName',
  'difficulty',
  'status',
  'totalQuantity',
  'estimatedDays',
  'estimatedDelivery',
];

const safeOrderBy = (sortBy, sortOrder) => ({
  [SORTABLE_FIELDS.includes(sortBy) ? sortBy : 'createdAt']:
    String(sortOrder).toLowerCase() === 'asc' ? 'asc' : 'desc',
});

/**
 * Build the next DE-YYMMDD-NNN code.
 *
 * `code` is UNIQUE, and count()+1 races: two concurrent requests both read N and
 * both try N+1, so one dies on a raw P2002. The caller retries this on a unique
 * violation (see withUniqueCodeRetry), and we seed the sequence from the highest
 * code issued today rather than from a row count, so a deleted estimate cannot
 * make the sequence go backwards into an existing code.
 */
const generateUniqueCode = async (attempt = 0) => {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const prefix = `DE-${year}${month}${day}-`;

  const last = await prisma.deliveryEstimation.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });

  const lastSeq = last ? parseInt(last.code.slice(prefix.length), 10) || 0 : 0;
  const sequence = (lastSeq + 1 + attempt).toString().padStart(3, '0');
  return `${prefix}${sequence}`;
};

/** Retry `fn(code)` while the generated code collides (Prisma P2002). */
const withUniqueCodeRetry = async (fn, maxAttempts = 5) => {
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const code = await generateUniqueCode(attempt);
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn(code);
    } catch (err) {
      const isCodeCollision =
        err.code === 'P2002' &&
        (err.meta?.target?.includes?.('code') ?? true);
      if (!isCodeCollision) throw err;
      lastError = err;
    }
  }
  throw lastError;
};

/**
 * The nine capacity-stage quantities a client sends, plus the two time-based
 * stages the PROJECT will schedule. The estimate used to carry only the nine,
 * so every quote was short by the whole purchasing and installation phase.
 * One derivation, shared with createProject via engine.withTimeBasedStages.
 */
const normalizeStageQuantities = (input = {}) => {
  const q = {};
  CAPACITY_STAGES.forEach((s) => {
    q[s] = Number(input[s]) > 0 ? Number(input[s]) : 0;
  });
  return withTimeBasedStages(q);
};
/**
 * AL-5 — THE server-side derivation of stage quantities from a material mix or
 * a list of items.
 *
 * The frontend kept its own copy of these rules. They agreed at the time of
 * writing, but the header of config.js records that exactly this duplication
 * ("different difficulty tables, two delivery-date formulas") was the original
 * cause of quotes not matching projects. The estimation form now calls this, so
 * there is one rule and it lives with the scheduler.
 *
 * Accepts either:
 *   { materials: { laminatedMDF, plainMDF, wood, metal, other } }
 *   { items: [{ itemId, quantity }] }   — materials resolved from the Item rows
 */
const deriveStageQuantities = async ({ materials, items } = {}) => {
  let totals = { laminatedMDF: 0, plainMDF: 0, wood: 0, metal: 0, other: 0 };

  if (materials && typeof materials === 'object') {
    totals = {
      laminatedMDF: Number(materials.laminatedMDF) || 0,
      plainMDF: Number(materials.plainMDF) || 0,
      wood: Number(materials.wood) || 0,
      metal: Number(materials.metal) || 0,
      other: Number(materials.other) || 0,
    };
  } else if (Array.isArray(items) && items.length) {
    const itemIds = items.map((i) => i.itemId).filter(Boolean);
    const rows = await prisma.items.findMany({
      where: { id: { in: itemIds } },
      include: { itemMaterials: { include: { material: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    items.forEach((sel) => {
      const item = byId.get(sel.itemId);
      if (!item) return;
      const itemQty = Number(sel.quantity) > 0 ? Number(sel.quantity) : 1;
      (item.itemMaterials || []).forEach((im) => {
        const qty = (Number(im.quantity) || 0) * itemQty;
        if (qty <= 0) return;
        const m = im.material || {};
        if (m.laminatedMDF) totals.laminatedMDF += qty;
        else if (m.plainMDF) totals.plainMDF += qty;
        else if (m.wood) totals.wood += qty;
        else if (m.metal) totals.metal += qty;
        else totals.other += qty;
      });
    });
  } else {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Provide either `materials` totals or an `items` array',
    );
  }

  const stageQuantities = computeStageQuantities(totals);
  const total =
    (totals.laminatedMDF || 0) +
    (totals.plainMDF || 0) +
    (totals.wood || 0) +
    (totals.metal || 0);

  return {
    materials: { ...totals, total },
    // The nine capacity stages the user can edit...
    stageQuantities: CAPACITY_STAGES.reduce((acc, s) => {
      acc[s] = stageQuantities[s] || 0;
      return acc;
    }, {}),
    // ...plus the two time-based stages the schedule will include regardless.
    timeBasedStages: {
      PURCHASING: stageQuantities.PURCHASING || 0,
      INSTALLATION: stageQuantities.INSTALLATION || 0,
    },
  };
};

// Calculate delivery estimate based on selected items
const calculateDeliveryEstimate = async (calculationData) => {
  const { difficulty, startDate } = calculationData;

  if (!difficulty) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Difficulty is required');
  }
  if (
    !calculationData.stageQuantities ||
    typeof calculationData.stageQuantities !== 'object'
  ) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Stage quantities are required');
  }
  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid difficulty level');
  }

  // AL-4: schedule the SAME stage set the project will schedule.
  const stageQuantities = normalizeStageQuantities(
    calculationData.stageQuantities,
  );

  const formatMinutes = (minutes) => {
    const m = Math.round(minutes || 0);
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  // The unit total is the DESIGN quantity (the "everything" stage). Summing all
  // stages would count the same panel once per stage it passes through.
  const totalQuantity = stageQuantities.DESIGN || 0;
  const hasMetal = (stageQuantities.METAL_WORKS || 0) > 0;
  const hasLaminatedMDF = (stageQuantities.EDGE_BANDING || 0) > 0;

  // Capacity-aware DRY RUN through the SHARED scheduling engine — the exact same
  // engine createProject uses, so an estimate reproduces the project created from
  // it (given the same stage quantities). dryRun consults existing capacity (so
  // estimates no longer silently over-book) but reserves nothing.
  const plan = await scheduleProject({
    stageQuantities,
    startDate,
    difficulty,
    mode: 'dryRun',
  });

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
      // The instant production actually ends, before the buffer — useful for
      // showing the customer "built by X, promised by Y".
      productionEndDate: plan.lastEnd ? plan.lastEnd.toISOString() : null,
      scheduledStartDate: plan.firstStart ? plan.firstStart.toISOString() : null,
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
  try {
    const {
      customerName,
      phone,
      piId,
      difficulty,
      status = 'ESTIMATED',
      holdUntil,
      // The items the quote was built from, kept as provenance.
      items,
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

    // Validate difficulty level against the SHARED list, not a local copy.
    if (!VALID_DIFFICULTIES.includes(difficulty)) {
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

    // Prepare stage quantities — including the two time-based stages the
    // project will schedule (AL-4), so the quote covers the same work.
    const stageQuantities = normalizeStageQuantities({
      DESIGN,
      METAL_WORKS,
      CNC,
      CUTTING,
      EDGE_BANDING,
      ASSEMBLY,
      PAINTING,
      FINISHING,
      DELIVERY,
    });

    // Validate at least one stage has quantity > 0
    const hasAnyQuantity = CAPACITY_STAGES.some((s) => stageQuantities[s] > 0);
    if (!hasAnyQuantity) {
      console.error('❌ No stage quantities provided');
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'At least one stage quantity must be greater than 0',
      );
    }

    // The unit total is the DESIGN quantity (the stage every unit passes
    // through). Summing all stages counted the same panel once per stage and
    // inflated the stored total several times over.
    const totalQuantity = Math.round(stageQuantities.DESIGN || 0);

    // ─────────────────────────────────────────────
    // Calculate estimate using the calculation function
    // ─────────────────────────────────────────────
    const calculationResult = await calculateDeliveryEstimate({
      difficulty,
      stageQuantities,
    });

    // Extract values
    const estimatedDays = calculationResult.timeline.estimatedBusinessDays;
    const estimatedDelivery = new Date(
      calculationResult.timeline.estimatedDeliveryDate,
    );

    // FN-3: retry on a code collision instead of surfacing a raw P2002.
    const estimation = await withUniqueCodeRetry((code) =>
      prisma.deliveryEstimation.create({
        data: {
          code,
          customerName: customerName ? customerName.trim() : null,
          phone: phone ? phone.trim() : null,
          piId,
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
          PURCHASING: stageQuantities.PURCHASING,
          INSTALLATION: stageQuantities.INSTALLATION,
          // FN-1: the items the quote was calculated from. Without this an
          // estimate could not be re-costed, audited, or reconciled against the
          // invoice it later becomes.
          itemsSnapshot: Array.isArray(items) && items.length ? items : undefined,
        },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
        },
      }),
    );

    // FN-1: return the RECORD as well as the calculation. The caller previously
    // got only `calculationDetails` — no id, no code — so the client could not
    // link, display or navigate to the quote it had just created.
    return {
      estimation,
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

  // Whitelist the updatable columns.
  //
  // This used to strip every non-alphanumeric character from the key
  // (`key.replace(/[^a-zA-Z0-9]/g, '')`), which silently renamed the
  // underscored stage columns — EDGE_BANDING became EDGEBANDING, METAL_WORKS
  // became METALWORKS — and Prisma then rejected the write with an unknown-
  // argument error. It also let a client set ANY column, including `code`,
  // `status` and `createdById`, bypassing the status machine entirely.
  const UPDATABLE_FIELDS = [
    'customerName',
    'phone',
    'difficulty',
    'holdUntil',
    ...CAPACITY_STAGES,
  ];

  const cleanedUpdateBody = {};
  for (const [key, value] of Object.entries(updateBody)) {
    if (value === undefined || value === null) continue;
    if (!UPDATABLE_FIELDS.includes(key)) continue;
    cleanedUpdateBody[key] = typeof value === 'string' ? value.trim() : value;
  }

  // If any stage quantity changed, the stored timeline is now stale — recompute
  // it through the same engine, so an edited estimate stays consistent with the
  // project it will become instead of keeping the original quote's dates.
  const stageChanged = CAPACITY_STAGES.some(
    (s) => cleanedUpdateBody[s] !== undefined,
  );
  if (stageChanged || cleanedUpdateBody.difficulty) {
    const merged = normalizeStageQuantities(
      CAPACITY_STAGES.reduce((acc, s) => {
        acc[s] =
          cleanedUpdateBody[s] !== undefined
            ? cleanedUpdateBody[s]
            : existingEstimation[s] || 0;
        return acc;
      }, {}),
    );
    const recalculated = await calculateDeliveryEstimate({
      difficulty: cleanedUpdateBody.difficulty || existingEstimation.difficulty,
      stageQuantities: merged,
    });
    cleanedUpdateBody.PURCHASING = merged.PURCHASING;
    cleanedUpdateBody.INSTALLATION = merged.INSTALLATION;
    cleanedUpdateBody.totalQuantity = Math.round(merged.DESIGN || 0);
    cleanedUpdateBody.estimatedDays =
      recalculated.timeline.estimatedBusinessDays;
    cleanedUpdateBody.estimatedDelivery = new Date(
      recalculated.timeline.estimatedDeliveryDate,
    );
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

  // The delivery date is DERIVED above by the scheduling engine, never taken
  // from the client, so there is nothing to validate here — a recomputed date
  // is correct by construction. (The old check rejected its own recalculation
  // whenever the engine legitimately produced a same-day result.)

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
    orderBy: safeOrderBy(sortBy, sortOrder),
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
    orderBy: safeOrderBy(sortBy, sortOrder),
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

  // Validate status transition.
  // FN-4: the map must cover EVERY value of the EstimationStatus enum.
  // PROJECT_CREATED was missing, so an estimate that had become a project fell
  // through to `[]` and could never transition again — and no legal path
  // reached that state through this API at all (createProject set it with a raw
  // updateMany that bypassed this guard).
  const validTransitions = {
    ESTIMATED: ['ON_HOLD', 'CONFIRMED', 'EXPIRED'],
    ON_HOLD: ['ESTIMATED', 'CONFIRMED', 'EXPIRED'],
    CONFIRMED: ['PROJECT_CREATED', 'EXPIRED'],
    PROJECT_CREATED: [], // terminal: the project owns the schedule from here
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

  // Validate current status. An ON_HOLD estimate is confirmable — the
  // transition table two functions above has always allowed ON_HOLD ->
  // CONFIRMED, while this guard rejected it, so a held quote could never be
  // accepted without first being taken off hold.
  if (!['ESTIMATED', 'ON_HOLD'].includes(existingEstimation.status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot confirm estimation. Current status is ${existingEstimation.status}`,
    );
  }

  // Update to CONFIRMED. Clear holdUntil so a confirmed quote is not still
  // carrying a hold expiry that the auto-expiry sweep could act on.
  const updatedEstimation = await prisma.deliveryEstimation.update({
    where: { id },
    data: {
      status: 'CONFIRMED',
      holdUntil: null,
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

  // AL-2 — pass the estimation CODE. This is the whole fix for "the quote does
  // not match the project": createProject has an inheritance branch that reuses
  // the estimate's stage quantities and difficulty, but it is keyed on
  // `deliveryEstimationcode`, and this function never passed it. So the project
  // was scheduled from INVOICE MATERIALS while the customer had been quoted
  // from the estimate's (possibly hand-entered) quantities — two unrelated
  // numbers. Passing the code also makes the link + status flip happen INSIDE
  // createProject's transaction (FN-8), so a failure can no longer leave an
  // estimate that is convertible twice.
  const project = await createProject(
    {
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      deliveryEstimationcode: estimation.code,
      status: 'INVOICE',
      difficulty: estimation.difficulty,
      requestedDelivery: null,
    },
    userId,
  );

  const full = await prisma.project.findUnique({
    where: { id: project.id },
    include: {
      customer: true,
      invoice: { include: { customer: true } },
      stages: { orderBy: { startDate: 'asc' } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  // Report how the realised project compares with the quote, so a divergence is
  // visible at the moment of conversion rather than discovered at delivery.
  return {
    ...full,
    warnings: project.warnings || [],
    quote: {
      code: estimation.code,
      quotedDeliveryDate: estimation.estimatedDelivery,
      quotedBusinessDays: estimation.estimatedDays,
      scheduledDeliveryDate: full.calculatedDelivery,
    },
  };
};

module.exports = {
  deriveStageQuantities,
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
