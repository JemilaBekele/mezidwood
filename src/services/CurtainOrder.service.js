/* eslint-disable no-await-in-loop */
/* eslint-disable no-nested-ternary */
/* eslint-disable no-restricted-syntax */
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

/* ──────────────── CURTAIN ORDER ──────────────── */

// Get CurtainOrder by ID
const getCurtainOrderById = async (id) => {
  const curtainOrder = await prisma.curtainOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      Shop: true,
      movementType: true,
      createdBy: {
        select: {
          id: true,
          name: true,
        },
      },
      deliveredBy: {
        select: {
          id: true,
          name: true,
        },
      },
      // Add curtain measurements here
      measurements: {
        include: {
          thickProduct: true,
          thinProduct: true,
          curtainPole: true,
          curtainPulls: true,
          curtainBrackets: true,
          shatterVerticalProduct: true,
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
          thickWorker: {
            select: {
              id: true,
              name: true,
            },
          },
          thinWorker: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });
  return curtainOrder;
};
const getPendingCurtainOrders = async () => {
  try {
    const curtainOrders = await prisma.curtainOrder.findMany({
      where: {
        curtainStatus: {
          not: 'DELIVERED', // Only orders not delivered
        },
        deliveryDeadline: {
          not: null, // Must have a delivery date
        },
      },
      orderBy: {
        deliveryDeadline: 'asc', // Soonest delivery first
      },
      include: {
        customer: true,
        Shop: true,
        movementType: true,
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
          },
        },
        measurements: {
          include: {
            thickProduct: true,
            thinProduct: true,
            curtainPole: true,
            curtainPulls: true,
            curtainBrackets: true,
            shatterVerticalProduct: true,
            createdBy: {
              select: {
                id: true,
                name: true,
              },
            },
            thickWorker: {
              select: {
                id: true,
                name: true,
              },
            },
            thinWorker: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });
    return curtainOrders;
  } catch (error) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to fetch pending curtain orders',
    );
  }
};
const getthikthinCurtainOrderById = async (id) => {
  const curtainOrder = await prisma.curtainOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      Shop: true,
      movementType: true,
      createdBy: {
        select: {
          id: true,
          name: true,
        },
      },
      // Only include measurements WITHOUT shatterVerticalProductId
      measurements: {
        where: {
          shatterVerticalProductId: {
            equals: null, // Use equals instead of isNull
          },
        },
        include: {
          thickProduct: true,
          thinProduct: true,
          curtainPole: true,
          curtainPulls: true,
          curtainBrackets: true,
          // If you still want to include shatterVerticalProduct (though it will be null)
          shatterVerticalProduct: true,
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
          thickWorker: {
            select: {
              id: true,
              name: true,
            },
          },
          thinWorker: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });
  return curtainOrder;
};
// getthikthinCurtainOrderById,getshatterCurtainOrderById
const getshatterCurtainOrderById = async (id) => {
  const curtainOrder = await prisma.curtainOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      Shop: true,
      movementType: true,
      createdBy: {
        select: {
          id: true,
          name: true,
        },
      },
      // Only include measurements where shatterVerticalProductId exists
      measurements: {
        where: {
          shatterVerticalProductId: {
            not: null,
          },
        },
        include: {
          // Only include shatterVerticalProduct and basic relations
          shatterVerticalProduct: true,
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });
  return curtainOrder;
};

// Get CurtainOrder by criteria
const getCurtainOrderByCriteria = async (criteria) => {
  const curtainOrder = await prisma.curtainOrder.findFirst({
    where: criteria,
    include: {
      customer: true,
      movementType: true,
      createdBy: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
  return curtainOrder;
};

// Create CurtainOrder
const createCurtainOrder = async (curtainOrderData, createdById) => {
  const {
    customerId,
    movementTypeId,
    isSiteMeasured = false,
    siteMeasurePrice,
    remark,
    issueDate,
  } = curtainOrderData;

  // Validate required fields
  if (!customerId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Customer ID is required');
  }

  // Check if customer exists
  const customerExists = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customerExists) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Customer not found');
  }

  // Check movement type
  if (movementTypeId) {
    const movementTypeExists = await prisma.movementType.findUnique({
      where: { id: movementTypeId },
    });

    if (!movementTypeExists) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Movement type not found');
    }
  }

  // Generate Auto Code
  const lastOrder = await prisma.curtainOrder.findFirst({
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      code: true,
    },
  });

  let newCode = 'CO-0001';

  if (lastOrder?.code) {
    const lastNumber = parseInt(lastOrder.code.split('-')[1], 10);
    const nextNumber = lastNumber + 1;
    newCode = `CO-${String(nextNumber).padStart(4, '0')}`;
  }

  // Parse issueDate
  let parsedIssueDate = null;
  if (issueDate) {
    parsedIssueDate = new Date(issueDate);
    if (Number.isNaN(parsedIssueDate.getTime())) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid issue date');
    }
  }

  const data = {
    code: newCode, // 👈 auto generated code
    customerId,
    movementTypeId: movementTypeId || null,
    isSiteMeasured,
    siteMeasurePrice:
      siteMeasurePrice !== undefined ? parseFloat(siteMeasurePrice) : null,
    remark: remark || null,
    issueDate: parsedIssueDate,
    createdById: createdById || null,
  };

  return prisma.curtainOrder.create({
    data,
    include: {
      customer: true,
      movementType: true,
      createdBy: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
};

// Get all CurtainOrders
const getAllCurtainOrders = async (options = {}) => {
  const {
    page = 1,
    limit = 10,
    search,
    customerId,
    movementTypeId,
    isSiteMeasured,
    startDate,
    endDate,
    includeItems = false,
  } = options;

  const skip = (page - 1) * limit;

  const where = {};

  // Search filter
  if (search) {
    where.OR = [
      {
        customer: {
          name: { contains: search, mode: 'insensitive' },
        },
      },
      {
        customer: {
          phone1: { contains: search, mode: 'insensitive' },
        },
      },
      {
        remark: { contains: search, mode: 'insensitive' },
      },
    ];
  }

  // Customer filter
  if (customerId) {
    where.customerId = customerId;
  }

  // Movement type filter
  if (movementTypeId) {
    where.movementTypeId = movementTypeId;
  }

  // Site measured filter
  if (isSiteMeasured !== undefined) {
    where.isSiteMeasured = isSiteMeasured === 'true' || isSiteMeasured === true;
  }

  // Date range filter
  if (startDate || endDate) {
    where.issueDate = {};
    if (startDate) {
      where.issueDate.gte = new Date(startDate);
    }
    if (endDate) {
      where.issueDate.lte = new Date(endDate);
    }
  }

  const include = {
    customer: true,
    movementType: true,
    createdBy: {
      select: {
        id: true,
        name: true,
      },
    },
  };

  if (includeItems) {
    include.curtainOrderItems = true;
  }

  const [curtainOrders, totalCount] = await Promise.all([
    prisma.curtainOrder.findMany({
      where,
      include,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.curtainOrder.count({ where }),
  ]);

  return {
    curtainOrders,
    count: curtainOrders.length,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: page,
  };
};
// In your curtain.service.js
const getCurtainOrdersByDeliveredBy = async (userId, options = {}) => {
  const {
    page = 1,
    limit = 10,
    search,
    startDate,
    endDate,
    includeItems = false,
  } = options;

  const skip = (page - 1) * limit;

  const where = {
    deliveredById: userId,
  };

  // Search filter
  if (search) {
    where.OR = [
      {
        customer: {
          name: { contains: search, mode: 'insensitive' },
        },
      },
      {
        customer: {
          phone1: { contains: search, mode: 'insensitive' },
        },
      },
      {
        code: { contains: search, mode: 'insensitive' },
      },
      {
        remark: { contains: search, mode: 'insensitive' },
      },
    ];
  }

  // Date range filter for delivery date
  if (startDate || endDate) {
    where.deliveredAt = {};
    if (startDate) {
      where.deliveredAt.gte = new Date(startDate);
    }
    if (endDate) {
      where.deliveredAt.lte = new Date(endDate);
    }
  }

  const include = {
    customer: true,
    movementType: true,
    createdBy: {
      select: {
        id: true,
        name: true,
      },
    },
    deliveredBy: {
      select: {
        id: true,
        name: true,
        email: true,
      },
    },
    measurements: includeItems,
    curtainPayments: includeItems
      ? {
          orderBy: { createdAt: 'desc' },
        }
      : false,
  };

  const [curtainOrders, totalCount] = await Promise.all([
    prisma.curtainOrder.findMany({
      where,
      include,
      orderBy: { deliveredAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.curtainOrder.count({ where }),
  ]);

  // Calculate statistics
  const stats = {
    totalDelivered: curtainOrders.length,
    totalAmount: curtainOrders.reduce(
      (sum, order) => sum + (parseFloat(order.totalAmount) || 0),
      0,
    ),
    recentDeliveries: curtainOrders.filter((o) => {
      const daysDiff =
        (new Date() - new Date(o.deliveredAt)) / (1000 * 60 * 60 * 24);
      return daysDiff <= 7;
    }).length,
  };

  return {
    curtainOrders,
    count: curtainOrders.length,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: page,
  };
};
// Update CurtainOrder
const updateCurtainOrder = async (id, updateBody) => {
  const existing = await getCurtainOrderById(id);
  if (!existing) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Curtain order not found');
  }

  const {
    customerId,
    movementTypeId,
    isSiteMeasured,
    siteMeasurePrice,
    remark,
    issueDate,
  } = updateBody;

  // Validate customer if being updated
  if (customerId && customerId !== existing.customerId) {
    const customerExists = await prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customerExists) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Customer not found');
    }
  }

  // Validate movement type if being updated
  if (movementTypeId !== undefined) {
    if (movementTypeId && movementTypeId !== existing.movementTypeId) {
      const movementTypeExists = await prisma.movementType.findUnique({
        where: { id: movementTypeId },
      });
      if (!movementTypeExists) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Movement type not found');
      }
    }
  }

  // Validate siteMeasurePrice if provided
  if (siteMeasurePrice !== undefined && siteMeasurePrice !== null) {
    const price = parseFloat(siteMeasurePrice);
    if (Number.isNaN(price) || price < 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid site measure price');
    }
  }

  // Parse issueDate if provided
  let parsedIssueDate;
  if (issueDate !== undefined) {
    if (issueDate === null) {
      parsedIssueDate = null;
    } else if (issueDate) {
      parsedIssueDate = new Date(issueDate);
      if (Number.isNaN(parsedIssueDate.getTime())) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid issue date');
      }
    }
  }

  // Prepare update data
  const updateData = {};

  if (customerId !== undefined) updateData.customerId = customerId;
  if (movementTypeId !== undefined)
    updateData.movementTypeId = movementTypeId || null;
  if (isSiteMeasured !== undefined)
    updateData.isSiteMeasured =
      isSiteMeasured === 'true' || isSiteMeasured === true;
  if (siteMeasurePrice !== undefined)
    updateData.siteMeasurePrice =
      siteMeasurePrice !== null ? parseFloat(siteMeasurePrice) : null;
  if (remark !== undefined) updateData.remark = remark || null;
  if (issueDate !== undefined) updateData.issueDate = parsedIssueDate;

  return prisma.curtainOrder.update({
    where: { id },
    data: updateData,
    include: {
      customer: true,
      movementType: true,
      createdBy: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
};

// Delete CurtainOrder
const deleteCurtainOrder = async (id) => {
  const existing = await getCurtainOrderById(id);
  if (!existing) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Curtain order not found');
  }

  // Check if there are any items associated
  const itemsCount = await prisma.curtainOrderItem.count({
    where: { curtainOrderId: id },
  });

  if (itemsCount > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot delete curtain order. It has ${itemsCount} item(s) associated with it.`,
    );
  }

  await prisma.curtainOrder.delete({ where: { id } });
  return { message: 'Curtain order deleted successfully' };
};

// Get curtain orders by customer
const getCurtainOrdersByCustomerId = async (customerId, options = {}) => {
  const { page = 1, limit = 10 } = options;
  const skip = (page - 1) * limit;

  const where = { customerId };

  const [curtainOrders, totalCount] = await Promise.all([
    prisma.curtainOrder.findMany({
      where,
      include: {
        movementType: true,
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.curtainOrder.count({ where }),
  ]);

  return {
    curtainOrders,
    count: curtainOrders.length,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: page,
  };
};

// Get curtain orders created by user
const getCurtainOrdersByCreatedBy = async (createdById, options = {}) => {
  const { page = 1, limit = 10 } = options;
  const skip = (page - 1) * limit;

  const where = { createdById };

  const [curtainOrders, totalCount] = await Promise.all([
    prisma.curtainOrder.findMany({
      where,
      include: {
        customer: true,
        movementType: true,
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.curtainOrder.count({ where }),
  ]);

  return {
    curtainOrders,
    count: curtainOrders.length,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: page,
  };
};

const createCurtainMeasurement = async (
  orderId,
  curtainMeasurementData,
  createdById,
  shopId,
) => {
  try {
    // Check if curtainMeasurementData is an array and extract the first element
    let measurementData;
    if (Array.isArray(curtainMeasurementData)) {
      if (curtainMeasurementData.length === 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'No measurement data provided',
        );
      }
      measurementData = curtainMeasurementData[0];
    } else {
      measurementData = curtainMeasurementData;
    }

    const {
      roomName,
      width,
      height,
      extrawidth, // ← ADD THIS LINE
      curtainSize,
      quantity,
      size,

      thickProductId,
      thickVariant,
      thickMeter,
      thickPrice,

      thinProductId,
      thinVariant,
      thinMeter,
      thinPrice,

      curtainPoleId,
      curtainPoleQuantity,
      curtainPolePrice,

      curtainPullsId,
      curtainPullsQuantity,

      curtainBracketsId,
      curtainBracketsQuantity,
      curtainPullsBracketsPrice,

      thickWorkerId,
      thinWorkerId,
      workerPrice,
      totalWorkerMeter,

      price,
      remark,
    } = measurementData;

    /* ---------------- REQUIRED FIELD VALIDATION ---------------- */

    if (!orderId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Order ID is required');
    }

    if (!roomName) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Room name is required');
    }

    if (width === undefined || width === null) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Width is required');
    }

    if (height === undefined || height === null) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Height is required');
    }

    /* ---------------- OPTIONAL FIELD VALIDATION FOR extrawidth ---------------- */
    // Validate extrawidth if provided
    let numericextrawidth = null;
    if (extrawidth !== undefined && extrawidth !== null) {
      numericextrawidth = parseFloat(extrawidth);
      if (Number.isNaN(numericextrawidth) || numericextrawidth < 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Invalid extra height value. Must be a positive number or zero.',
        );
      }
    }

    /* ---------------- ORDER CHECK ---------------- */

    const orderExists = await prisma.curtainOrder.findUnique({
      where: { id: orderId },
    });

    if (!orderExists) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Order not found');
    }

    /* ---------------- SHOP VALIDATION (if provided) ---------------- */
    if (shopId) {
      const shopExists = await prisma.shop.findUnique({
        where: { id: shopId },
      });

      if (!shopExists) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Shop not found');
      }
    }

    /* ---------------- PRODUCT CHECKS ---------------- */
    const checkProduct = async (id, label) => {
      if (!id) return;

      const exists = await prisma.product.findUnique({ where: { id } });

      if (!exists) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `${label} product not found`,
        );
      }
    };

    await checkProduct(thickProductId, 'Thick curtain');
    await checkProduct(thinProductId, 'Thin curtain');
    await checkProduct(curtainPoleId, 'Curtain pole');
    await checkProduct(curtainPullsId, 'Curtain pulls');
    await checkProduct(curtainBracketsId, 'Curtain brackets');

    /* ---------------- WORKER CHECKS ---------------- */
    const checkWorker = async (id, label) => {
      if (!id) return;

      const exists = await prisma.user.findUnique({ where: { id } });

      if (!exists) {
        throw new ApiError(httpStatus.BAD_REQUEST, `${label} worker not found`);
      }
    };

    await checkWorker(thickWorkerId, 'Thick');
    await checkWorker(thinWorkerId, 'Thin');

    /* ---------------- NUMERIC VALIDATION ---------------- */

    const numericWidth = parseFloat(width);
    const numericHeight = parseFloat(height);

    if (Number.isNaN(numericWidth) || numericWidth <= 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid width value');
    }

    if (Number.isNaN(numericHeight) || numericHeight <= 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid height value');
    }

    // Optional: Validate size enum value if provided
    if (size && !['TWO_POINT_FIVE', 'THREE', 'NORMAL'].includes(size)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid size value. Must be TWO_POINT_FIVE, THREE, or NORMAL',
      );
    }

    if (!thickProductId && !thinProductId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'At least one curtain product (thick or thin) must be selected',
      );
    }

    /* ---------------- UPDATE CURTAIN ORDER WITH SHOP ID ---------------- */
    if (shopId) {
      await prisma.curtainOrder.update({
        where: { id: orderId },
        data: {
          ShopId: shopId,
          updatedAt: new Date(),
        },
      });
    }

    /* ---------------- PREPARE MEASUREMENT DATA ---------------- */
    const data = {
      orderId,
      roomName,
      width: numericWidth,
      height: numericHeight,
      extrawidth: numericextrawidth, // ← ADD THIS LINE
      curtainSize: curtainSize ? parseFloat(curtainSize) : null,
      quantity: quantity ? parseInt(quantity, 10) : 1, // Default to 1 if not provided
      size: size || null,

      thickProductId: thickProductId || null,
      thickVariant: thickVariant || null,
      thickMeter: thickMeter ? parseFloat(thickMeter) : null,
      thickPrice: thickPrice ? parseFloat(thickPrice) : null,

      thinProductId: thinProductId || null,
      thinVariant: thinVariant || null,
      thinMeter: thinMeter ? parseFloat(thinMeter) : null,
      thinPrice: thinPrice ? parseFloat(thinPrice) : null,

      curtainPoleId: curtainPoleId || null,
      curtainPoleQuantity: curtainPoleQuantity
        ? parseFloat(curtainPoleQuantity)
        : null,
      curtainPolePrice: curtainPolePrice ? parseFloat(curtainPolePrice) : null,

      curtainPullsId: curtainPullsId || null,
      curtainPullsQuantity: curtainPullsQuantity
        ? parseInt(curtainPullsQuantity, 10)
        : null,

      curtainBracketsId: curtainBracketsId || null,
      curtainBracketsQuantity: curtainBracketsQuantity
        ? parseInt(curtainBracketsQuantity, 10)
        : null,
      curtainPullsBracketsPrice: curtainPullsBracketsPrice
        ? parseFloat(curtainPullsBracketsPrice)
        : null,

      thickWorkerId: thickWorkerId || null,
      thinWorkerId: thinWorkerId || null,
      workerPrice: workerPrice ? parseFloat(workerPrice) : null,
      totalWorkerMeter: totalWorkerMeter ? parseFloat(totalWorkerMeter) : null,

      price: price ? parseFloat(price) : null,
      remark: remark || null,
      createdById: createdById || null,
    };

    /* ---------------- CREATE MEASUREMENT ---------------- */
    const result = await prisma.curtainMeasurement.create({
      data,
    });

    /* ---------------- UPDATE CURTAIN ORDER TOTAL AMOUNT ---------------- */
    if (price) {
      const numericPrice = parseFloat(price);

      // Get current order total - ensure it's a number
      const currentOrder = await prisma.curtainOrder.findUnique({
        where: { id: orderId },
        select: { totalAmount: true },
      });

      // Parse current total as number (handle null/undefined)
      let currentTotal = 0;
      if (currentOrder?.totalAmount) {
        currentTotal =
          typeof currentOrder.totalAmount === 'string'
            ? parseFloat(currentOrder.totalAmount)
            : Number(currentOrder.totalAmount);
      }

      // Ensure currentTotal is a valid number
      if (isNaN(currentTotal)) {
        currentTotal = 0;
      }

      const newTotal = currentTotal + numericPrice;

      // Validate that newTotal is within range (assuming your DB column is DECIMAL(10,2) or similar)
      // Maximum value for DECIMAL(10,2) is 99,999,999.99
      if (newTotal > 99999999.99) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Total amount would exceed maximum allowed value',
        );
      }

      await prisma.curtainOrder.update({
        where: { id: orderId },
        data: {
          totalAmount: newTotal,
        },
      });
    }

    return result;
  } catch (error) {
    console.error('🔥 ERROR in createCurtainMeasurement');
    throw error;
  }
};

const bulkUpdateCurtainMeasurements = async (
  measurementsDataArray,
  orderId,
  updatedById,
  shopId,
) => {
  try {
    // Validate input is an array
    if (
      !Array.isArray(measurementsDataArray) ||
      measurementsDataArray.length === 0
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Measurements data must be a non-empty array',
      );
    }

    // Check if order exists once for all updates
    if (!orderId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Order ID is required');
    }

    const orderExists = await prisma.curtainOrder.findUnique({
      where: { id: orderId },
    });

    if (!orderExists) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Order not found');
    }

    // Check shop if provided
    if (shopId) {
      const shopExists = await prisma.shop.findUnique({
        where: { id: shopId },
      });

      if (!shopExists) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Shop not found');
      }
    }

    // Separate measurements into updates and creates
    const updateOperations = [];
    const createOperations = [];
    const updateMeasurements = [];
    const newMeasurements = [];

    // Separate items with and without measurementId
    for (const measurementItem of measurementsDataArray) {
      if (measurementItem.measurementId) {
        updateMeasurements.push(measurementItem);
      } else {
        newMeasurements.push(measurementItem);
      }
    }

    // Fetch existing measurements only for updates
    let existingMap = new Map();
    if (updateMeasurements.length > 0) {
      const measurementIds = updateMeasurements.map(
        (item) => item.measurementId,
      );

      const existingMeasurements = await prisma.curtainMeasurement.findMany({
        where: {
          id: { in: measurementIds },
          orderId,
        },
      });

      // Check if all measurements exist
      const existingIds = new Set(existingMeasurements.map((m) => m.id));
      const missingIds = measurementIds.filter((id) => !existingIds.has(id));

      if (missingIds.length > 0) {
        throw new ApiError(
          httpStatus.NOT_FOUND,
          `Measurements not found: ${missingIds.join(', ')}`,
        );
      }

      existingMap = new Map(existingMeasurements.map((m) => [m.id, m]));
    }

    // Track price changes for order total update
    let totalPriceDifference = 0;
    let totalNewPrice = 0;

    // Helper function to prepare measurement data
    const prepareMeasurementData = (
      measurementData,
      existingMeasurement = null,
    ) => {
      const {
        roomName,
        width,
        height,
        extrawidth,
        curtainSize,
        quantity,
        size,

        thickProductId,
        thickVariant,
        thickMeter,
        thickPrice,

        thinProductId,
        thinVariant,
        thinMeter,
        thinPrice,

        curtainPoleId,
        curtainPoleQuantity,
        curtainPolePrice,

        curtainPullsId,
        curtainPullsQuantity,

        curtainBracketsId,
        curtainBracketsQuantity,
        curtainPullsBracketsPrice,

        thickWorkerId,
        thinWorkerId,
        workerPrice,
        totalWorkerMeter,

        price,
        remark,
      } = measurementData;

      // Numeric conversions
      const numericWidth = parseFloat(width);
      const numericHeight = parseFloat(height);

      let numericextrawidth = null;
      if (extrawidth !== undefined && extrawidth !== null) {
        numericextrawidth = parseFloat(extrawidth);
      }

      // Build base data object
      const data = {
        roomName:
          roomName !== undefined ? roomName : existingMeasurement?.roomName,
        width: !isNaN(numericWidth) ? numericWidth : existingMeasurement?.width,
        height: !isNaN(numericHeight)
          ? numericHeight
          : existingMeasurement?.height,
        extrawidth:
          numericextrawidth !== null
            ? numericextrawidth
            : existingMeasurement?.extrawidth,
        curtainSize:
          curtainSize !== undefined
            ? curtainSize
              ? parseFloat(curtainSize)
              : null
            : existingMeasurement?.curtainSize,
        quantity:
          quantity !== undefined
            ? quantity
              ? parseInt(quantity, 10)
              : 1
            : existingMeasurement?.quantity || 1,
        size: size !== undefined ? size || null : existingMeasurement?.size,
        thickVariant:
          thickVariant !== undefined
            ? thickVariant || null
            : existingMeasurement?.thickVariant,
        thickMeter:
          thickMeter !== undefined
            ? thickMeter
              ? parseFloat(thickMeter)
              : null
            : existingMeasurement?.thickMeter,
        thickPrice:
          thickPrice !== undefined
            ? thickPrice
              ? parseFloat(thickPrice)
              : null
            : existingMeasurement?.thickPrice,
        thinVariant:
          thinVariant !== undefined
            ? thinVariant || null
            : existingMeasurement?.thinVariant,
        thinMeter:
          thinMeter !== undefined
            ? thinMeter
              ? parseFloat(thinMeter)
              : null
            : existingMeasurement?.thinMeter,
        thinPrice:
          thinPrice !== undefined
            ? thinPrice
              ? parseFloat(thinPrice)
              : null
            : existingMeasurement?.thinPrice,
        curtainPoleQuantity:
          curtainPoleQuantity !== undefined
            ? curtainPoleQuantity
              ? parseFloat(curtainPoleQuantity)
              : null
            : existingMeasurement?.curtainPoleQuantity,
        curtainPolePrice:
          curtainPolePrice !== undefined
            ? curtainPolePrice
              ? parseFloat(curtainPolePrice)
              : null
            : existingMeasurement?.curtainPolePrice,
        curtainPullsQuantity:
          curtainPullsQuantity !== undefined
            ? curtainPullsQuantity
              ? parseInt(curtainPullsQuantity, 10)
              : null
            : existingMeasurement?.curtainPullsQuantity,
        curtainBracketsQuantity:
          curtainBracketsQuantity !== undefined
            ? curtainBracketsQuantity
              ? parseInt(curtainBracketsQuantity, 10)
              : null
            : existingMeasurement?.curtainBracketsQuantity,
        curtainPullsBracketsPrice:
          curtainPullsBracketsPrice !== undefined
            ? curtainPullsBracketsPrice
              ? parseFloat(curtainPullsBracketsPrice)
              : null
            : existingMeasurement?.curtainPullsBracketsPrice,
        workerPrice:
          workerPrice !== undefined
            ? workerPrice
              ? parseFloat(workerPrice)
              : null
            : existingMeasurement?.workerPrice,
        totalWorkerMeter:
          totalWorkerMeter !== undefined
            ? totalWorkerMeter
              ? parseFloat(totalWorkerMeter)
              : null
            : existingMeasurement?.totalWorkerMeter,
        price:
          price !== undefined
            ? price
              ? parseFloat(price)
              : null
            : existingMeasurement?.price,
        remark:
          remark !== undefined ? remark || null : existingMeasurement?.remark,
      };

      // Handle relations for existing measurements (update) or new measurements (create)
      if (existingMeasurement) {
        // For updates, handle updatedBy
        if (updatedById) {
          data.updatedBy = { connect: { id: updatedById } };
        }
        data.updatedAt = new Date();
      } else {
        // For creates, handle createdBy and order connection
        if (updatedById) {
          data.createdBy = { connect: { id: updatedById } };
        }
        data.order = { connect: { id: orderId } };
      }

      // Handle relation updates using connect/disconnect
      // Thick Product relation
      if (thickProductId !== undefined) {
        if (thickProductId && thickProductId !== 'NONE') {
          data.thickProduct = { connect: { id: thickProductId } };
        } else if (existingMeasurement) {
          data.thickProduct = { disconnect: true };
        }
      } else if (!existingMeasurement && thickProductId) {
        data.thickProduct = { connect: { id: thickProductId } };
      }

      // Thin Product relation
      if (thinProductId !== undefined) {
        if (thinProductId && thinProductId !== 'NONE') {
          data.thinProduct = { connect: { id: thinProductId } };
        } else if (existingMeasurement) {
          data.thinProduct = { disconnect: true };
        }
      } else if (!existingMeasurement && thinProductId) {
        data.thinProduct = { connect: { id: thinProductId } };
      }

      // Curtain Pole relation
      if (curtainPoleId !== undefined) {
        if (curtainPoleId && curtainPoleId !== 'NONE') {
          data.curtainPole = { connect: { id: curtainPoleId } };
        } else if (existingMeasurement) {
          data.curtainPole = { disconnect: true };
        }
      } else if (!existingMeasurement && curtainPoleId) {
        data.curtainPole = { connect: { id: curtainPoleId } };
      }

      // Curtain Pulls relation
      if (curtainPullsId !== undefined) {
        if (curtainPullsId && curtainPullsId !== 'NONE') {
          data.curtainPulls = { connect: { id: curtainPullsId } };
        } else if (existingMeasurement) {
          data.curtainPulls = { disconnect: true };
        }
      } else if (!existingMeasurement && curtainPullsId) {
        data.curtainPulls = { connect: { id: curtainPullsId } };
      }

      // Curtain Brackets relation
      if (curtainBracketsId !== undefined) {
        if (curtainBracketsId && curtainBracketsId !== 'NONE') {
          data.curtainBrackets = { connect: { id: curtainBracketsId } };
        } else if (existingMeasurement) {
          data.curtainBrackets = { disconnect: true };
        }
      } else if (!existingMeasurement && curtainBracketsId) {
        data.curtainBrackets = { connect: { id: curtainBracketsId } };
      }

      // Thick Worker relation
      if (thickWorkerId !== undefined) {
        if (thickWorkerId && thickWorkerId !== 'NONE') {
          data.thickWorker = { connect: { id: thickWorkerId } };
        } else if (existingMeasurement) {
          data.thickWorker = { disconnect: true };
        }
      } else if (!existingMeasurement && thickWorkerId) {
        data.thickWorker = { connect: { id: thickWorkerId } };
      }

      // Thin Worker relation
      if (thinWorkerId !== undefined) {
        if (thinWorkerId && thinWorkerId !== 'NONE') {
          data.thinWorker = { connect: { id: thinWorkerId } };
        } else if (existingMeasurement) {
          data.thinWorker = { disconnect: true };
        }
      } else if (!existingMeasurement && thinWorkerId) {
        data.thinWorker = { connect: { id: thinWorkerId } };
      }

      return data;
    };

    // Process updates
    for (const measurementItem of updateMeasurements) {
      const { measurementId, curtainMeasurementData } = measurementItem;

      // Parse measurement data
      let measurementData;
      if (Array.isArray(curtainMeasurementData)) {
        if (curtainMeasurementData.length === 0) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `No measurement data provided for measurement ${measurementId}`,
          );
        }
        measurementData = curtainMeasurementData[0];
      } else {
        measurementData = curtainMeasurementData;
      }

      const existingMeasurement = existingMap.get(measurementId);
      const data = prepareMeasurementData(measurementData, existingMeasurement);

      // Calculate price difference for updates
      const oldPrice = existingMeasurement.price
        ? parseFloat(existingMeasurement.price)
        : 0;
      const newPrice = data.price ? parseFloat(data.price) : oldPrice;
      const priceDifference = newPrice - oldPrice;
      totalPriceDifference += priceDifference;

      updateOperations.push(
        prisma.curtainMeasurement.update({
          where: { id: measurementId },
          data,
        }),
      );
    }

    // Process new measurements (creates)
    for (const measurementItem of newMeasurements) {
      const { curtainMeasurementData } = measurementItem;

      // Parse measurement data
      let measurementData;
      if (Array.isArray(curtainMeasurementData)) {
        if (curtainMeasurementData.length === 0) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            'No measurement data provided for new measurement',
          );
        }
        measurementData = curtainMeasurementData[0];
      } else {
        measurementData = curtainMeasurementData;
      }

      const data = prepareMeasurementData(measurementData, null);

      // Add price to total for new measurements
      if (data.price) {
        totalNewPrice += parseFloat(data.price);
      }

      createOperations.push(
        prisma.curtainMeasurement.create({
          data,
        }),
      );
    }

    /* ---------------- UPDATE CURTAIN ORDER WITH SHOP ID ---------------- */
    if (shopId && orderExists.ShopId !== shopId) {
      updateOperations.push(
        prisma.curtainOrder.update({
          where: { id: orderId },
          data: {
            ShopId: shopId,
            updatedAt: new Date(),
          },
        }),
      );
    }

    /* ---------------- EXECUTE ALL OPERATIONS IN TRANSACTION ---------------- */
    const allOperations = [...updateOperations, ...createOperations];
    let results = [];
    if (allOperations.length > 0) {
      results = await prisma.$transaction(allOperations);
    }

    // Separate measurement results
    const measurementResults = results.filter(
      (r) => r && r.roomName !== undefined,
    );

    /* ---------------- HANDLE ORDER TOTAL AMOUNT AND BALANCE UPDATE ---------------- */
    const totalAmountChange = totalPriceDifference + totalNewPrice;

    if (totalAmountChange !== 0) {
      // Get current order financial data
      const currentOrder = await prisma.curtainOrder.findUnique({
        where: { id: orderId },
        select: {
          totalAmount: true,
          totalPaid: true,
          balance: true,
        },
      });

      // Parse current total as number
      let currentTotal = 0;
      if (currentOrder?.totalAmount) {
        currentTotal =
          typeof currentOrder.totalAmount === 'string'
            ? parseFloat(currentOrder.totalAmount)
            : Number(currentOrder.totalAmount);
      }

      // Parse current total paid
      let currentTotalPaid = 0;
      if (currentOrder?.totalPaid) {
        currentTotalPaid =
          typeof currentOrder.totalPaid === 'string'
            ? parseFloat(currentOrder.totalPaid)
            : Number(currentOrder.totalPaid);
      }

      // Ensure currentTotal is a valid number
      if (isNaN(currentTotal)) {
        currentTotal = 0;
      }
      if (isNaN(currentTotalPaid)) {
        currentTotalPaid = 0;
      }

      const newTotal = currentTotal + totalAmountChange;

      // Calculate new balance = totalAmount - totalPaid
      const newBalance = newTotal - currentTotalPaid;

      // Validate that newTotal is within range
      if (newTotal > 99999999.99) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Total amount would exceed maximum allowed value',
        );
      }

      if (newTotal < 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Total amount cannot be negative',
        );
      }

      // Update both totalAmount and balance
      await prisma.curtainOrder.update({
        where: { id: orderId },
        data: {
          totalAmount: newTotal,
          balance: newBalance,
        },
      });
    } else {
      console.log('💰 No total price change, skipping order total update');
    }

    return {
      success: true,
      updatedCount: updateOperations.length,
      createdCount: createOperations.length,
      totalProcessed: measurementResults.length,
      measurements: measurementResults,
      totalPriceDifference,
      totalNewPrice,
      totalAmountChange,
    };
  } catch (error) {
    console.error('Message:', error.message);
    console.error('Full error:', error);
    throw error;
  }
};
// Update CurtainMeasurement
const updateCurtainOrderShop = async (orderId, measurementsData, shopId) => {
  try {
    /* ---------------- ORDER CHECK ---------------- */

    const existingOrder = await prisma.curtainOrder.findUnique({
      where: { id: orderId },
      include: {
        measurements: true,
      },
    });

    if (!existingOrder) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Curtain order not found');
    }

    /* ---------------- SHOP VALIDATION (if provided) ---------------- */
    if (shopId) {
      const shopExists = await prisma.shop.findUnique({
        where: { id: shopId },
      });

      if (!shopExists) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Shop not found');
      }
    }

    /* ---------------- UPDATE CURTAIN ORDER WITH SHOP ID ---------------- */
    if (shopId && shopId !== existingOrder.ShopId) {
      const updatedOrder = await prisma.curtainOrder.update({
        where: { id: orderId },
        data: {
          ShopId: shopId,
          updatedAt: new Date(),
        },
      });
    }

    /* ---------------- HANDLE MEASUREMENTS UPDATES ---------------- */
    const updatedMeasurements = [];
    let totalAmountChanged = false;

    if (
      measurementsData &&
      Array.isArray(measurementsData) &&
      measurementsData.length > 0
    ) {
      for (const measurementData of measurementsData) {
        const {
          id: measurementId,
          roomName,
          width,
          height,
          extrawidth, // ← ADD THIS LINE
          curtainSize,
          quantity,

          thickProductId,
          thickMeter,
          thickPrice,

          thinProductId,
          thinMeter,
          thinPrice,

          curtainPoleId,
          curtainPoleQuantity,
          curtainPolePrice,

          curtainPullsId,
          curtainPullsQuantity,

          curtainBracketsId,
          curtainBracketsQuantity,
          curtainPullsBracketsPrice,

          thickWorkerId,
          thinWorkerId,
          workerPrice,
          totalworkerMeter,

          price,
          remark,
        } = measurementData;

        if (!measurementId) {
          continue;
        }

        const existingMeasurement = await prisma.curtainMeasurement.findUnique({
          where: { id: measurementId },
        });

        if (!existingMeasurement) {
          continue;
        }

        if (existingMeasurement.orderId !== orderId) {
          console.log(
            `⚠️ Measurement ${measurementId} doesn't belong to order ${orderId}, skipping`,
          );
          continue;
        }

        // Parse price as number for comparison
        const oldPrice = existingMeasurement.price
          ? Number(existingMeasurement.price)
          : 0;
        const newPrice = price ? parseFloat(price) : null;
        const isPriceChanged = newPrice !== null && oldPrice !== newPrice;

        const updateData = {};

        /* ---------------- HANDLE extrawidth VALIDATION ---------------- */
        // Validate and process extrawidth if provided
        if (extrawidth !== undefined) {
          if (extrawidth === null || extrawidth === '') {
            updateData.extrawidth = null;
          } else {
            const numericextrawidth = parseFloat(extrawidth);
            if (Number.isNaN(numericextrawidth) || numericextrawidth < 0) {
              throw new ApiError(
                httpStatus.BAD_REQUEST,
                `Invalid extra height value for measurement ${measurementId}. Must be a positive number or zero.`,
              );
            }
            updateData.extrawidth = numericextrawidth;
            console.log(
              `📏 Extra height updated for measurement ${measurementId}:`,
              numericextrawidth,
            );
          }
        }

        if (roomName !== undefined) updateData.roomName = roomName;
        if (width !== undefined) updateData.width = parseFloat(width);
        if (height !== undefined) updateData.height = parseFloat(height);
        if (curtainSize !== undefined)
          updateData.curtainSize = curtainSize ? parseFloat(curtainSize) : null;
        if (quantity !== undefined)
          updateData.quantity = quantity ? parseInt(quantity, 10) : null;

        if (thickProductId !== undefined)
          updateData.thickProductId = thickProductId || null;
        if (thickMeter !== undefined)
          updateData.thickMeter = thickMeter ? parseFloat(thickMeter) : null;
        if (thickPrice !== undefined)
          updateData.thickPrice = thickPrice ? parseFloat(thickPrice) : null;

        if (thinProductId !== undefined)
          updateData.thinProductId = thinProductId || null;
        if (thinMeter !== undefined)
          updateData.thinMeter = thinMeter ? parseFloat(thinMeter) : null;
        if (thinPrice !== undefined)
          updateData.thinPrice = thinPrice ? parseFloat(thinPrice) : null;

        if (curtainPoleId !== undefined)
          updateData.curtainPoleId = curtainPoleId || null;
        if (curtainPoleQuantity !== undefined)
          updateData.curtainPoleQuantity = curtainPoleQuantity
            ? parseFloat(curtainPoleQuantity)
            : null;
        if (curtainPolePrice !== undefined)
          updateData.curtainPolePrice = curtainPolePrice
            ? parseFloat(curtainPolePrice)
            : null;

        if (curtainPullsId !== undefined)
          updateData.curtainPullsId = curtainPullsId || null;
        if (curtainPullsQuantity !== undefined)
          updateData.curtainPullsQuantity = curtainPullsQuantity
            ? parseInt(curtainPullsQuantity, 10)
            : null;

        if (curtainBracketsId !== undefined)
          updateData.curtainBracketsId = curtainBracketsId || null;
        if (curtainBracketsQuantity !== undefined)
          updateData.curtainBracketsQuantity = curtainBracketsQuantity
            ? parseInt(curtainBracketsQuantity, 10)
            : null;
        if (curtainPullsBracketsPrice !== undefined)
          updateData.curtainPullsBracketsPrice = curtainPullsBracketsPrice
            ? parseFloat(curtainPullsBracketsPrice)
            : null;

        if (thickWorkerId !== undefined)
          updateData.thickWorkerId = thickWorkerId || null;
        if (thinWorkerId !== undefined)
          updateData.thinWorkerId = thinWorkerId || null;
        if (workerPrice !== undefined)
          updateData.workerPrice = workerPrice ? parseFloat(workerPrice) : null;
        if (totalworkerMeter !== undefined)
          updateData.totalWorkerMeter = totalworkerMeter
            ? parseFloat(totalworkerMeter)
            : null;

        if (price !== undefined) {
          updateData.price = newPrice;
        }
        if (remark !== undefined) updateData.remark = remark || null;

        const updatedMeasurement = await prisma.curtainMeasurement.update({
          where: { id: measurementId },
          data: updateData,
        });

        updatedMeasurements.push(updatedMeasurement);

        if (isPriceChanged) {
          totalAmountChanged = true;
          console.log(`💰 Price changed for measurement ${measurementId}:`, {
            old: oldPrice,
            new: newPrice,
          });
        }
      }
    }

    /* ---------------- RECALCULATE ORDER TOTAL AMOUNT ---------------- */
    if (totalAmountChanged) {
      const allMeasurements = await prisma.curtainMeasurement.findMany({
        where: { orderId },
        select: { price: true },
      });

      // Sum all prices as numbers
      let newTotal = 0;
      for (const measurement of allMeasurements) {
        if (measurement.price) {
          newTotal += Number(measurement.price);
        }
      }

      // Validate newTotal is within range
      if (newTotal > 99999999.99) {
        console.error('❌ New total exceeds maximum allowed value:', newTotal);
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Total amount would exceed maximum allowed value',
        );
      }

      await prisma.curtainOrder.update({
        where: { id: orderId },
        data: {
          totalAmount: newTotal,
          updatedAt: new Date(),
        },
      });
    }

    const finalOrder = await prisma.curtainOrder.findUnique({
      where: { id: orderId },
      include: {
        measurements: true,
        Shop: true,
        customer: true,
      },
    });

    return {
      order: finalOrder,
      updatedMeasurements,
    };
  } catch (error) {
    console.error('Message:', error.message);
    console.error('Full error:', error);
    throw error;
  }
};
const deleteCurtainMeasurement = async (id) => {
  // Check if measurement exists
  const existing = await prisma.curtainMeasurement.findUnique({
    where: { id },
    include: {
      order: true,
    },
  });

  if (!existing) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Curtain measurement not found');
  }

  // Optional: Check if there are any dependencies or restrictions
  // For example, if the order is already finalized, you might not want to allow deletion
  // const order = await prisma.curtainOrder.findUnique({
  //   where: { id: existing.orderId },
  // });

  // if (order?.status === 'FINALIZED' || order?.status === 'COMPLETED') {
  //   throw new ApiError(
  //     httpStatus.BAD_REQUEST,
  //     'Cannot delete measurement from a finalized/completed order'
  //   );
  // }

  // Get the price of the measurement to subtract from total
  const measurementPrice = existing.price ? Number(existing.price) : 0;
  console.log('💰 Measurement price to subtract:', measurementPrice);

  // Delete the measurement
  await prisma.curtainMeasurement.delete({
    where: { id },
  });

  // Update order total amount by subtracting the measurement price
  if (measurementPrice > 0) {
    console.log('🔄 Updating order total amount after deletion');

    // Get current order total
    const currentOrder = await prisma.curtainOrder.findUnique({
      where: { id: existing.orderId },
      select: { totalAmount: true },
    });

    // Parse current total as number
    let currentTotal = 0;
    if (currentOrder?.totalAmount) {
      currentTotal =
        typeof currentOrder.totalAmount === 'string'
          ? parseFloat(currentOrder.totalAmount)
          : Number(currentOrder.totalAmount);
    }

    // Ensure currentTotal is a valid number
    if (isNaN(currentTotal)) {
      currentTotal = 0;
    }

    // Calculate new total (subtract the deleted measurement price)
    const newTotal = currentTotal - measurementPrice;

    console.log('📊 Total amount update after deletion:', {
      currentTotal,
      subtractPrice: measurementPrice,
      newTotal,
    });

    // Ensure newTotal doesn't go negative
    const finalTotal = newTotal < 0 ? 0 : newTotal;

    // Update the order total
    await prisma.curtainOrder.update({
      where: { id: existing.orderId },
      data: {
        totalAmount: finalTotal,
        updatedAt: new Date(),
      },
    });
  }

  return {
    message: 'Curtain measurement deleted successfully',
    deletedMeasurementId: id,
    orderId: existing.orderId,
    subtractedAmount: measurementPrice,
  };
};
/* ──────────────── EXPORTS createsecondCurtainMeasurement,updatesecondCurtainOrderShop ──────────────── */
const createsecondCurtainMeasurement = async (
  orderId,
  curtainMeasurementData,
  createdById,
  shopId,
) => {
  try {
    // Check if curtainMeasurementData is an array and extract the first element
    let measurementData;
    if (Array.isArray(curtainMeasurementData)) {
      if (curtainMeasurementData.length === 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'No measurement data provided',
        );
      }
      measurementData = curtainMeasurementData[0];
      console.log('📋 Extracted first element from array:', measurementData);
    } else {
      measurementData = curtainMeasurementData;
    }

    const {
      roomName,
      width,
      height,
      quantity,
      unitprice,
      pricePerUnit,
      price,
      remark,
      shatterVerticalProductId,
    } = measurementData;

    console.log('🧩 Destructured values:', {
      orderId,
      roomName,
      width,
      height,
      quantity,
      unitprice,
      pricePerUnit,
      price,
      remark,
      shatterVerticalProductId,
    });

    /* ---------------- REQUIRED FIELD VALIDATION ---------------- */
    console.log('🔍 Validating required fields');

    if (!orderId) {
      console.error('❌ Missing orderId');
      throw new ApiError(httpStatus.BAD_REQUEST, 'Order ID is required');
    }

    if (!roomName) {
      console.error('❌ Missing roomName');
      throw new ApiError(httpStatus.BAD_REQUEST, 'Room name is required');
    }

    if (width === undefined || width === null) {
      console.error('❌ Missing width');
      throw new ApiError(httpStatus.BAD_REQUEST, 'Width is required');
    }

    if (height === undefined || height === null) {
      console.error('❌ Missing height');
      throw new ApiError(httpStatus.BAD_REQUEST, 'Height is required');
    }

    /* ---------------- ORDER CHECK ---------------- */

    const orderExists = await prisma.curtainOrder.findUnique({
      where: { id: orderId },
    });

    if (!orderExists) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Order not found');
    }

    /* ---------------- SHOP VALIDATION (if provided) ---------------- */
    if (shopId) {
      const shopExists = await prisma.shop.findUnique({
        where: { id: shopId },
      });

      if (!shopExists) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Shop not found');
      }
    }

    /* ---------------- VALIDATE SHATTER VERTICAL PRODUCT (if provided) ---------------- */
    if (shatterVerticalProductId) {
      const productExists = await prisma.product.findUnique({
        where: { id: shatterVerticalProductId },
      });

      if (!productExists) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Shatter vertical product not found',
        );
      }
    }

    /* ---------------- NUMERIC VALIDATION ---------------- */

    const numericWidth = parseFloat(width);
    const numericHeight = parseFloat(height);

    if (Number.isNaN(numericWidth) || numericWidth <= 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid width value');
    }

    if (Number.isNaN(numericHeight) || numericHeight <= 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid height value');
    }

    /* ---------------- UPDATE CURTAIN ORDER WITH SHOP ID ---------------- */
    if (shopId) {
      await prisma.curtainOrder.update({
        where: { id: orderId },
        data: {
          ShopId: shopId,
          updatedAt: new Date(),
        },
      });
    }

    /* ---------------- PREPARE MEASUREMENT DATA ---------------- */
    const data = {
      orderId,
      roomName,
      width: numericWidth,
      height: numericHeight,
      quantity: quantity ? parseInt(quantity, 10) : null,
      unitprice: unitprice ? parseFloat(unitprice) : null,
      pricePerUnit: pricePerUnit ? parseFloat(pricePerUnit) : null,
      price: price ? parseFloat(price) : null,
      remark: remark || null,
      createdById: createdById || null,
      shatterVerticalProductId: shatterVerticalProductId || null,
    };

    /* ---------------- CREATE MEASUREMENT ---------------- */
    const result = await prisma.curtainMeasurement.create({
      data,
      include: {
        shatterVerticalProduct: true,
      },
    });

    /* ---------------- UPDATE CURTAIN ORDER TOTAL AMOUNT ---------------- */
    if (price) {
      // Get current order total - FIX: Convert to number properly
      const currentOrder = await prisma.curtainOrder.findUnique({
        where: { id: orderId },
        select: { totalAmount: true },
      });

      // FIX: Convert Decimal/string to number
      const currentTotal = currentOrder?.totalAmount
        ? parseFloat(currentOrder.totalAmount.toString())
        : 0;

      const addPrice = parseFloat(price);
      const newTotal = currentTotal + addPrice;

      await prisma.curtainOrder.update({
        where: { id: orderId },
        data: {
          totalAmount: newTotal, // Prisma will handle number to Decimal conversion
          updatedAt: new Date(),
        },
      });
    }

    return result;
  } catch (error) {
    console.error('🔥 ERROR in createCurtainMeasurement');
    console.error('Message:', error.message);
    console.error('Full error:', error);
    throw error;
  }
};

// Update CurtainMeasurement
const updatesecondCurtainOrderShop = async (
  orderId,
  measurementsData,
  shopId,
) => {
  console.log('🚀 updateCurtainOrderShop START');
  console.log('📦 Order ID:', orderId);
  console.log('🏪 Shop ID:', shopId);
  console.log('📐 Measurements data:', measurementsData);

  try {
    /* ---------------- ORDER CHECK ---------------- */
    console.log('🔍 Checking order exists:', orderId);

    const existingOrder = await prisma.curtainOrder.findUnique({
      where: { id: orderId },
      include: {
        measurements: {
          include: {
            shatterVerticalProduct: true,
          },
        },
      },
    });

    console.log('📦 Existing order:', existingOrder);

    if (!existingOrder) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Curtain order not found');
    }

    /* ---------------- SHOP VALIDATION (if provided) ---------------- */
    if (shopId) {
      console.log('🏪 Validating shop:', shopId);

      const shopExists = await prisma.shop.findUnique({
        where: { id: shopId },
      });

      console.log('🏪 Shop exists:', shopExists);

      if (!shopExists) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Shop not found');
      }
    }

    /* ---------------- UPDATE CURTAIN ORDER WITH SHOP ID ---------------- */
    if (shopId && shopId !== existingOrder.ShopId) {
      console.log('🔄 Updating curtain order shopId:', shopId);

      const updatedOrder = await prisma.curtainOrder.update({
        where: { id: orderId },
        data: {
          ShopId: shopId,
          updatedAt: new Date(),
        },
      });

      console.log('✅ Curtain order updated with shopId:', updatedOrder);
    }

    /* ---------------- HANDLE MEASUREMENTS UPDATES ---------------- */
    const updatedMeasurements = [];
    let totalAmountChanged = false;

    if (
      measurementsData &&
      Array.isArray(measurementsData) &&
      measurementsData.length > 0
    ) {
      console.log(
        '📝 Processing measurements updates:',
        measurementsData.length,
      );

      for (const measurementData of measurementsData) {
        const {
          id: measurementId, // This is the measurement ID
          roomName,
          width,
          height,
          quantity,
          unitprice,
          pricePerUnit,
          price,
          remark,
          shatterVerticalProductId,
        } = measurementData;

        // If no measurement ID, skip or create new measurement
        if (!measurementId) {
          console.log('⚠️ No measurement ID provided, skipping update');
          continue;
        }

        // Check if measurement exists and belongs to this order
        const existingMeasurement = await prisma.curtainMeasurement.findUnique({
          where: { id: measurementId },
        });

        if (!existingMeasurement) {
          console.log(`⚠️ Measurement ${measurementId} not found, skipping`);
          continue;
        }

        if (existingMeasurement.orderId !== orderId) {
          console.log(
            `⚠️ Measurement ${measurementId} doesn't belong to order ${orderId}, skipping`,
          );
          continue;
        }

        // Check if price is being updated - FIX: Convert to numbers properly
        const isPriceChanged =
          price !== undefined &&
          parseFloat(price) !==
            parseFloat(existingMeasurement.price?.toString() || '0');

        /* ---------------- VALIDATE SHATTER VERTICAL PRODUCT (if provided) ---------------- */
        if (shatterVerticalProductId) {
          console.log(
            '🔍 Validating shatter vertical product:',
            shatterVerticalProductId,
          );

          const productExists = await prisma.product.findUnique({
            where: { id: shatterVerticalProductId },
          });

          console.log('📦 Product exists:', productExists);

          if (!productExists) {
            console.log(
              `⚠️ Shatter vertical product ${shatterVerticalProductId} not found, skipping update for measurement`,
            );
            continue;
          }
        }

        // Prepare update data
        const updateData = {};

        if (roomName !== undefined) updateData.roomName = roomName;
        if (width !== undefined) updateData.width = parseFloat(width);
        if (height !== undefined) updateData.height = parseFloat(height);
        if (quantity !== undefined)
          updateData.quantity = quantity ? parseInt(quantity, 10) : null;
        if (unitprice !== undefined)
          updateData.unitprice = unitprice ? parseFloat(unitprice) : null;
        if (pricePerUnit !== undefined)
          updateData.pricePerUnit = pricePerUnit
            ? parseFloat(pricePerUnit)
            : null;
        if (price !== undefined)
          updateData.price = price ? parseFloat(price) : null;
        if (remark !== undefined) updateData.remark = remark || null;
        if (shatterVerticalProductId !== undefined) {
          updateData.shatterVerticalProductId =
            shatterVerticalProductId || null;
        }

        // Update the measurement
        const updatedMeasurement = await prisma.curtainMeasurement.update({
          where: { id: measurementId },
          data: updateData,
          include: {
            shatterVerticalProduct: true,
          },
        });

        updatedMeasurements.push(updatedMeasurement);
        console.log(`✅ Measurement ${measurementId} updated`);

        // Track if price changed for this measurement
        if (isPriceChanged) {
          totalAmountChanged = true;
          console.log(`💰 Price changed for measurement ${measurementId}:`, {
            old: existingMeasurement.price?.toString() || '0',
            new: updatedMeasurement.price?.toString() || '0',
          });
        }
      }
    }

    /* ---------------- RECALCULATE ORDER TOTAL AMOUNT ---------------- */
    if (totalAmountChanged) {
      console.log('💰 Recalculating order total amount due to price updates');

      // Get all measurements for this order with their current prices
      const allMeasurements = await prisma.curtainMeasurement.findMany({
        where: { orderId },
        select: { price: true },
      });

      // FIX: Convert Decimal/string values to numbers properly
      const newTotal = allMeasurements.reduce((sum, measurement) => {
        const price = measurement.price
          ? parseFloat(measurement.price.toString())
          : 0;
        return sum + price;
      }, 0);

      console.log('📊 New total amount calculation:', {
        measurementCount: allMeasurements.length,
        newTotal,
      });

      // Update the order total
      await prisma.curtainOrder.update({
        where: { id: orderId },
        data: {
          totalAmount: newTotal, // Prisma will handle number to Decimal conversion
          updatedAt: new Date(),
        },
      });

      console.log('✅ Order total amount updated successfully');
    }

    // Return the updated order with measurements
    const finalOrder = await prisma.curtainOrder.findUnique({
      where: { id: orderId },
      include: {
        measurements: {
          include: {
            shatterVerticalProduct: true,
          },
        },
        Shop: true,
        customer: true,
      },
    });

    console.log('✅ Curtain order and measurements updated successfully');
    console.log(
      '📊 Final order total amount:',
      finalOrder.totalAmount?.toString(),
    );

    return {
      order: finalOrder,
      updatedMeasurements,
    };
  } catch (error) {
    console.error('🔥 ERROR in updateCurtainOrderShop');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    console.error('Full error:', error);
    throw error;
  }
};

// Helper function to deduct product stock
// Helper function to deduct product stock
// Helper function to deduct product stock
const deductProductStock = async (
  tx,
  { productId, shopId, quantity, measurementId, productType, updatedById },
) => {
  // Find or create shop stock record
  const shopStock = await tx.shopStock.findFirst({
    where: {
      productId,
      shopId,
    },
    include: {
      product: true,
    },
  });

  if (!shopStock) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `No stock found for ${productType} in this shop`,
    );
  }

  // Check if sufficient stock available
  if (shopStock.quantity < quantity) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Insufficient stock for ${productType}. Available: ${shopStock.quantity}, Required: ${quantity}`,
    );
  }

  // Update shop stock
  const updatedShopStock = await tx.shopStock.update({
    where: { id: shopStock.id },
    data: {
      quantity: {
        decrement: quantity,
      },
    },
  });

  // Create stock ledger entry with required fields - REMOVED balance field
  await tx.stockLedger.create({
    data: {
      productId,
      shopId,
      movementType: 'OUT', // Required field
      quantity: -quantity, // Negative for deduction
      unitOfMeasureId: shopStock.unitOfMeasureId, // Required field
      reference: `Order completion - Measurement: ${measurementId}`,
      userId: updatedById,
      notes: `${productType} deducted for curtain order. Current stock: ${updatedShopStock.quantity}`,
    },
  });

  // Create log entry
  await tx.log.create({
    data: {
      action: `Deducted ${quantity} units of ${productType} (Product ID: ${productId}) for curtain order completion - Measurement ID: ${measurementId}. Remaining stock: ${updatedShopStock.quantity}`,
      userId: updatedById,
    },
  });

  return updatedShopStock;
};

// Helper function to restore product stock (for cancellations)
const restoreProductStock = async (
  tx,
  { productId, shopId, quantity, measurementId, productType, updatedById },
) => {
  // Find shop stock record
  let shopStock = await tx.shopStock.findFirst({
    where: {
      productId,
      shopId,
    },
    include: {
      product: true,
    },
  });

  if (!shopStock) {
    // Get product to get unitOfMeasureId
    const product = await tx.product.findUnique({
      where: { id: productId },
      include: { unitOfMeasure: true },
    });

    if (!product) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Product not found for ${productType}`,
      );
    }

    // Create new stock record if it doesn't exist
    shopStock = await tx.shopStock.create({
      data: {
        productId,
        shopId,
        quantity: 0,
        unitOfMeasureId: product.unitOfMeasureId,
        status: 'Available',
      },
    });
  }

  // Update shop stock
  const updatedShopStock = await tx.shopStock.update({
    where: { id: shopStock.id },
    data: {
      quantity: {
        increment: quantity,
      },
    },
  });

  // Create stock ledger entry with required fields - REMOVED balance field
  await tx.stockLedger.create({
    data: {
      productId,
      shopId,
      movementType: 'RETERN', // Using RETERN as per your schema
      quantity, // Positive for restoration
      unitOfMeasureId: shopStock.unitOfMeasureId, // Required field
      reference: `Order cancellation - Measurement: ${measurementId}`,
      userId: updatedById,
      notes: `${productType} restored for curtain order cancellation. Current stock: ${updatedShopStock.quantity}`,
    },
  });

  // Create log entry
  await tx.log.create({
    data: {
      action: `Restored ${quantity} units of ${productType} (Product ID: ${productId}) for curtain order cancellation - Measurement ID: ${measurementId}. Current stock: ${updatedShopStock.quantity}`,
      userId: updatedById,
    },
  });

  return updatedShopStock;
};

const updateCurtainOrderStatus = async (orderId, statusData, updatedById) => {
  console.log('🚀 updateCurtainOrderStatus START');
  console.log('📦 Input parameters:', { orderId, updatedById, statusData });

  const {
    curtainStatus,
    paymentStatus,
    curtainstatusnote,
    deliveredById,
    curtainRodCuttings,
  } = statusData;

  console.log('✅ Extracted statusData:', {
    curtainStatus,
    paymentStatus,
    curtainstatusnote,
    deliveredById,
    curtainRodCuttings,
  });

  // Validate required fields
  console.log('🔍 Validating required fields...');
  if (!orderId) {
    console.error('❌ Validation failed: Order ID is required');
    throw new ApiError(httpStatus.BAD_REQUEST, 'Order ID is required');
  }

  if (!curtainStatus) {
    console.error('❌ Validation failed: Curtain status is required');
    throw new ApiError(httpStatus.BAD_REQUEST, 'Curtain status is required');
  }
  console.log('✅ Required fields validated');

  // Validate curtain status
  console.log('🔍 Validating curtain status...');
  const validCurtainStatuses = [
    'PENDING',
    'FINISHED',
    'RETURNED',
    'COMPLETED',
    'CANCELLED',
    'DELIVERED',
  ];

  if (!validCurtainStatuses.includes(curtainStatus)) {
    console.error(`❌ Invalid curtain status: ${curtainStatus}`);
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid curtain status');
  }
  console.log(`✅ Curtain status validated: ${curtainStatus}`);

  // Check if order exists
  console.log(`🔍 Checking if order ${orderId} exists...`);
  const orderExists = await prisma.curtainOrder.findUnique({
    where: { id: orderId },
    include: {
      measurements: {
        include: {
          thickProduct: true,
          thinProduct: true,
          curtainPole: true,
          curtainPulls: true,
          curtainBrackets: true,
          shatterVerticalProduct: true,
        },
      },
      Shop: true,
    },
  });

  if (!orderExists) {
    console.error(`❌ Order ${orderId} not found`);
    throw new ApiError(httpStatus.NOT_FOUND, 'Curtain order not found');
  }
  console.log(`✅ Order found:`, {
    orderId: orderExists.id,
    currentStatus: orderExists.curtainStatus,
    shopId: orderExists.ShopId,
    measurementsCount: orderExists.measurements?.length,
  });

  // Validate delivery person when DELIVERED
  if (curtainStatus === 'DELIVERED') {
    console.log('🚚 Processing DELIVERED status validation...');
    if (!deliveredById) {
      console.error('❌ Delivered person ID is required');
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Delivered person is required',
      );
    }

    console.log(`🔍 Validating delivery user ${deliveredById}...`);
    const deliveryUser = await prisma.user.findUnique({
      where: { id: deliveredById },
    });

    if (!deliveryUser) {
      console.error(`❌ Delivery user ${deliveredById} not found`);
      throw new ApiError(httpStatus.NOT_FOUND, 'Delivery user not found');
    }
    console.log(`✅ Delivery user validated:`, {
      id: deliveryUser.id,
      name: deliveryUser.name,
    });
  }

  // Validate curtain rod cuttings when DELIVERED
  if (curtainStatus === 'DELIVERED') {
    console.log('✂️ Processing curtain rod cuttings validation...');
    // Get all measurements that have curtain poles
    const measurementsWithPoles = orderExists.measurements.filter(
      (m) => m.curtainPoleId && m.curtainPoleQuantity > 0,
    );
    console.log(
      `📏 Measurements with poles: ${measurementsWithPoles.length}`,
      measurementsWithPoles.map((m) => ({
        id: m.id,
        quantity: m.curtainPoleQuantity,
      })),
    );

    if (measurementsWithPoles.length > 0) {
      console.log('🔍 Validating curtain rod cuttings array...');
      // Check if curtainRodCuttings is provided
      if (!curtainRodCuttings || !Array.isArray(curtainRodCuttings)) {
        console.error(
          '❌ curtainRodCuttings array is required but not provided',
        );
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'curtainRodCuttings array is required when cutting curtain rods',
        );
      }
      console.log(
        `✅ curtainRodCuttings array received with ${curtainRodCuttings.length} items`,
      );

      // Validate each cutting
      const cuttingMap = new Map();
      for (let i = 0; i < curtainRodCuttings.length; i++) {
        const cutting = curtainRodCuttings[i];
        console.log(
          `🔍 Validating cutting ${i + 1}/${curtainRodCuttings.length}:`,
          cutting,
        );

        const { measurementId, curtainRodVariantId, requestedWidth } = cutting;

        if (!measurementId) {
          console.error(`❌ measurementId missing for cutting ${i + 1}`);
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            'measurementId is required for each curtain rod cutting',
          );
        }

        if (!curtainRodVariantId) {
          console.error(
            `❌ curtainRodVariantId missing for measurement ${measurementId}`,
          );
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `curtainRodVariantId is required for measurement ${measurementId}`,
          );
        }

        if (!requestedWidth || requestedWidth <= 0) {
          console.error(
            `❌ Invalid requestedWidth for measurement ${measurementId}: ${requestedWidth}`,
          );
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `requestedWidth is required and must be greater than 0 for measurement ${measurementId}`,
          );
        }

        // Check for duplicate measurementId
        if (cuttingMap.has(measurementId)) {
          console.error(`❌ Duplicate measurementId: ${measurementId}`);
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Duplicate curtain rod cutting for measurement ${measurementId}`,
          );
        }

        // Find the measurement
        const measurement = orderExists.measurements.find(
          (m) => m.id === measurementId,
        );

        if (!measurement) {
          console.error(`❌ Measurement ${measurementId} not found in order`);
          throw new ApiError(
            httpStatus.NOT_FOUND,
            `Measurement ${measurementId} not found in this order`,
          );
        }

        if (!measurement.curtainPoleId) {
          console.error(
            `❌ Measurement ${measurementId} does not have a curtain pole`,
          );
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Measurement ${measurementId} does not have a curtain pole`,
          );
        }
        console.log(
          `✅ Measurement ${measurementId} found with curtain pole ID: ${measurement.curtainPoleId}`,
        );

        // Verify the variant exists and get its details
        console.log(
          `🔍 Fetching curtain rod variant ${curtainRodVariantId}...`,
        );
        const curtainRodVariant = await prisma.shopProductVariant.findUnique({
          where: { id: curtainRodVariantId },
          include: {
            shopStock: {
              include: {
                shop: true,
              },
            },
          },
        });

        if (!curtainRodVariant) {
          console.error(
            `❌ Curtain rod variant ${curtainRodVariantId} not found`,
          );
          throw new ApiError(
            httpStatus.NOT_FOUND,
            `Curtain rod variant ${curtainRodVariantId} not found`,
          );
        }
        console.log(`✅ Variant found:`, {
          id: curtainRodVariant.id,
          width: curtainRodVariant.width,
          height: curtainRodVariant.height,
          quantity: curtainRodVariant.quantity,
          shopStockId: curtainRodVariant.shopStockId,
        });

        // LOG but don't enforce hardcoded dimensions - FLEXIBLE VALIDATION
        if (curtainRodVariant.width !== 6 || curtainRodVariant.height !== 1) {
          console.warn(
            `⚠️ Variant has non-standard dimensions: ${curtainRodVariant.width}x${curtainRodVariant.height}. Expected: 6x1`,
            {
              measurementId,
              variantId: curtainRodVariant.id,
            },
          );
          // Continue execution - the system can handle any dimensions
        }

        // Validate requested width doesn't exceed available width
        if (requestedWidth > curtainRodVariant.width) {
          console.error(
            `❌ Requested width ${requestedWidth} exceeds variant width ${curtainRodVariant.width}`,
          );
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Requested width ${requestedWidth}m for measurement ${measurementId} exceeds variant width ${curtainRodVariant.width}m`,
          );
        }
        console.log(
          `✅ Width validation passed: ${requestedWidth} <= ${curtainRodVariant.width}`,
        );

        // Validate stock quantity
        const piecesNeeded = measurement.curtainPoleQuantity || 1;
        if (curtainRodVariant.quantity < piecesNeeded) {
          console.error(
            `❌ Insufficient stock: available ${curtainRodVariant.quantity}, needed ${piecesNeeded}`,
          );
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Insufficient stock for measurement ${measurementId}. Available: ${curtainRodVariant.quantity}, Required: ${piecesNeeded}`,
          );
        }
        console.log(
          `✅ Stock validated: ${curtainRodVariant.quantity} available, ${piecesNeeded} needed`,
        );

        // Use the actual variant dimensions (not hardcoded)
        const constantHeight = curtainRodVariant.height; // Use actual variant height
        const remainingWidth = curtainRodVariant.width - requestedWidth;
        console.log(
          `📐 Calculations: requestedWidth=${requestedWidth}, remainingWidth=${remainingWidth}, constantHeight=${constantHeight}`,
        );

        // Store cutting info
        cuttingMap.set(measurementId, {
          measurement,
          variant: curtainRodVariant,
          requestedWidth,
          constantHeight,
          remainingWidth,
          piecesNeeded,
        });
        console.log(`✅ Cutting info stored for measurement ${measurementId}`);
      }

      // Ensure all measurements with poles have cutting info
      console.log(
        '🔍 Verifying all measurements with poles have cutting info...',
      );
      for (const measurement of measurementsWithPoles) {
        if (!cuttingMap.has(measurement.id)) {
          console.error(
            `❌ Missing cutting info for measurement ${measurement.id}`,
          );
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Missing curtain rod cutting info for measurement ${measurement.id}`,
          );
        }
      }
      console.log(
        `✅ All ${measurementsWithPoles.length} measurements with poles have cutting info`,
      );

      // Store all cuttings info for transaction
      statusData.curtainRodCuttingsInfo = Array.from(cuttingMap.values());
      console.log(
        `✅ Stored ${statusData.curtainRodCuttingsInfo.length} cutting info items for transaction`,
      );
    } else {
      console.log(
        'ℹ️ No measurements with curtain poles found, skipping cutting validation',
      );
    }
  }

  // Prevent duplicate completed update
  console.log('🔍 Checking for duplicate COMPLETED update...');
  if (
    orderExists.curtainStatus === 'COMPLETED' &&
    curtainStatus === 'COMPLETED'
  ) {
    console.error('❌ Order is already completed');
    throw new ApiError(httpStatus.BAD_REQUEST, 'Order is already completed');
  }
  console.log('✅ No duplicate COMPLETED update');

  // COMPLETED validations
  if (curtainStatus === 'COMPLETED') {
    console.log('🔍 Validating COMPLETED status requirements...');
    if (!orderExists.measurements || orderExists.measurements.length === 0) {
      console.error('❌ Cannot mark as COMPLETED without measurements');
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cannot mark as COMPLETED without measurements',
      );
    }

    if (!orderExists.ShopId) {
      console.error('❌ Cannot mark as COMPLETED without assigned shop');
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cannot mark as COMPLETED without assigned shop',
      );
    }
    console.log('✅ COMPLETED validations passed');
  }

  // CANCELLED validations
  if (curtainStatus === 'CANCELLED') {
    console.log('🔍 Validating CANCELLED status requirements...');
    if (
      orderExists.totalPaid &&
      parseFloat(orderExists.totalPaid.toString()) > 0
    ) {
      if (paymentStatus && paymentStatus === 'PENDING') {
        console.error(
          '❌ Cannot set payment status to PENDING when payments exist',
        );
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Cannot set payment status to PENDING when there are payments made',
        );
      }

      if (!paymentStatus && orderExists.paymentStatus === 'PENDING') {
        console.error('❌ Cannot cancel order with pending payments');
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Cannot cancel order with pending payments',
        );
      }
    }
    console.log('✅ CANCELLED validations passed');
  }

  // Prepare update data
  console.log('📝 Preparing update data...');
  const updateData = {
    curtainStatus,
    updatedById: updatedById || null,
  };

  if (paymentStatus) {
    updateData.paymentStatus = paymentStatus;
    console.log(`💰 Payment status set to: ${paymentStatus}`);
  }

  if (curtainstatusnote !== undefined && curtainstatusnote !== null) {
    updateData.curtainstatusnote = curtainstatusnote;
    console.log(`📝 Note added: ${curtainstatusnote}`);
  }

  if (deliveredById) {
    updateData.deliveredById = deliveredById;
    console.log(`🚚 Delivered by: ${deliveredById}`);
  }

  if (curtainStatus === 'DELIVERED') {
    updateData.deliveredAt = new Date();
    console.log(`📅 Delivered at: ${updateData.deliveredAt}`);
  }
  console.log('✅ Update data prepared:', updateData);

  try {
    console.log('🔄 Starting database transaction...');
    const updatedOrder = await prisma.$transaction(async (tx) => {
      console.log('📦 Transaction started');

      // Handle curtain rod cuttings if applicable
      // Handle curtain rod cuttings if applicable
      // Handle curtain rod cuttings if applicable
      if (curtainStatus === 'DELIVERED' && statusData.curtainRodCuttingsInfo) {
        console.log(
          `✂️ Starting curtain rod cutting process for ${statusData.curtainRodCuttingsInfo.length} measurements`,
        );

        for (
          let idx = 0;
          idx < statusData.curtainRodCuttingsInfo.length;
          idx++
        ) {
          const cuttingInfo = statusData.curtainRodCuttingsInfo[idx];
          console.log(
            `\n📏 Processing measurement ${idx + 1}/${
              statusData.curtainRodCuttingsInfo.length
            } (ID: ${cuttingInfo.measurement.id}):`,
            {
              originalVariantId: cuttingInfo.variant.id,
              originalWidth: cuttingInfo.variant.width,
              originalHeight: cuttingInfo.variant.height,
              requestedWidth: cuttingInfo.requestedWidth,
              constantHeight: cuttingInfo.constantHeight,
              remainingWidth: cuttingInfo.remainingWidth,
              piecesNeeded: cuttingInfo.piecesNeeded,
            },
          );

          // Validate we have enough stock
          if (cuttingInfo.variant.quantity < cuttingInfo.piecesNeeded) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Insufficient stock. Need ${cuttingInfo.piecesNeeded} rods, but only have ${cuttingInfo.variant.quantity}`,
            );
          }

          // Calculate per-rod cutting (same logic as curtain worker log, but repeated for each rod needed)
          const widthPerPiece = cuttingInfo.requestedWidth;
          const piecesPerRod = 1; // Cut ONE piece from each rod
          const totalWidthToCutPerRod = widthPerPiece; // Just the requested width

          // Validate requested width doesn't exceed original width (per rod)
          if (widthPerPiece > cuttingInfo.variant.width) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Cannot cut ${widthPerPiece}m from a single rod. Original rod width is only ${cuttingInfo.variant.width}m.`,
            );
          }

          const remainingWidthPerRod =
            cuttingInfo.variant.width - totalWidthToCutPerRod;

          console.log(
            `📐 Per-rod cutting calculation (repeated for ${cuttingInfo.piecesNeeded} rods):`,
            {
              widthPerPiece,
              piecesPerRod,
              totalWidthToCutPerRod,
              remainingWidthPerRod,
              totalRodsNeeded: cuttingInfo.piecesNeeded,
              explanation: `For each of ${cuttingInfo.piecesNeeded} rods: cut ONE ${widthPerPiece}m section, remaining ${remainingWidthPerRod}m piece returned to stock`,
            },
          );

          // Process EACH ROD individually (same as curtain worker log processes each piece)
          for (
            let rodNumber = 0;
            rodNumber < cuttingInfo.piecesNeeded;
            rodNumber++
          ) {
            console.log(
              `\n  🔪 Processing rod ${rodNumber + 1}/${
                cuttingInfo.piecesNeeded
              }`,
            );

            // STEP 1: Decrement original variant quantity by 1 (taking ONE physical rod)
            console.log(`    📉 STEP 1: Taking 1 physical rod from stock`);
            await tx.shopProductVariant.update({
              where: { id: cuttingInfo.variant.id },
              data: {
                quantity: { decrement: 1 },
              },
            });

            // STEP 2: Create the cut piece (requested width) - This is consumed by customer
            console.log(
              `    ✂️ STEP 2: Cutting ${widthPerPiece}m section (CONSUMED)`,
            );
            // Note: We don't create a stock variant for the cut piece because it's immediately used/consumed
            // The cut piece is recorded in the ledger as OUT movement

            // STEP 3: Handle remaining piece (if any width left)
            let remainingPieceVariant = null;
            if (remainingWidthPerRod > 0) {
              console.log(
                `    📏 STEP 3: Adding back the remaining piece (${remainingWidthPerRod}×${cuttingInfo.constantHeight}) to stock`,
              );

              const existingRemainingVariant =
                await tx.shopProductVariant.findFirst({
                  where: {
                    shopStockId: cuttingInfo.variant.shopStockId,
                    width: remainingWidthPerRod,
                    height: cuttingInfo.constantHeight,
                  },
                });

              if (existingRemainingVariant) {
                console.log(
                  `    ♻️ Existing remaining variant found, incrementing quantity by 1`,
                );
                remainingPieceVariant = await tx.shopProductVariant.update({
                  where: { id: existingRemainingVariant.id },
                  data: {
                    quantity: { increment: 1 },
                  },
                });
              } else {
                console.log(`    🆕 Creating new remaining variant`);
                remainingPieceVariant = await tx.shopProductVariant.create({
                  data: {
                    shopStockId: cuttingInfo.variant.shopStockId,
                    width: remainingWidthPerRod,
                    height: cuttingInfo.constantHeight,
                    quantity: 1,
                  },
                });
              }
            } else {
              console.log(
                `    ℹ️ No remaining width, entire rod fully consumed`,
              );
            }

            // STEP 4: Update shop stock total quantity
            const netChange = remainingWidthPerRod > 0 ? 0 : -1;
            console.log(
              `    🏪 STEP 4: Updating shop stock total quantity (net change: ${netChange})`,
            );

            const shopStock = await tx.shopStock.findUnique({
              where: { id: cuttingInfo.variant.shopStockId },
            });

            if (shopStock) {
              await tx.shopStock.update({
                where: { id: shopStock.id },
                data: {
                  quantity: { increment: netChange },
                },
              });
            }

            // STEP 5: Create stock ledger entries for this rod
            const invoiceNo = `CUT-ROD-${
              cuttingInfo.measurement.id
            }-${Date.now()}-${rodNumber}`;

            // Entry for the original rod removal (OUT)
            await tx.stockLedger.create({
              data: {
                productId: cuttingInfo.measurement.curtainPoleId,
                shopId: orderExists.ShopId,
                invoiceNo,
                movementType: 'OUT',
                quantity: 1,
                height: cuttingInfo.constantHeight,
                width: cuttingInfo.variant.width,
                unitOfMeasureId: shopStock?.unitOfMeasureId,
                reference: `CURTAIN-ROD-REMOVED-M${cuttingInfo.measurement.id}`,
                userId: updatedById,
                notes: `Original curtain rod removed for cutting. Rod ${
                  rodNumber + 1
                }/${cuttingInfo.piecesNeeded}. Original dimensions: ${
                  cuttingInfo.variant.width
                }×${
                  cuttingInfo.variant.height
                }. Cut requested: ${widthPerPiece}m.`,
                movementDate: new Date(),
              },
            });

            // Entry for the cut piece (CONSUMED - OUT)
            await tx.stockLedger.create({
              data: {
                productId: cuttingInfo.measurement.curtainPoleId,
                shopId: orderExists.ShopId,
                invoiceNo: `${invoiceNo}-CUT-PIECE`,
                movementType: 'OUT', // Consumed by customer
                quantity: 1,
                height: cuttingInfo.constantHeight,
                width: widthPerPiece,
                unitOfMeasureId: shopStock?.unitOfMeasureId,
                reference: `CURTAIN-ROD-CUT-PIECE-M${cuttingInfo.measurement.id}`,
                userId: updatedById,
                notes: `Cut section from curtain rod for measurement ${
                  cuttingInfo.measurement.id
                } (rod ${rodNumber + 1}/${
                  cuttingInfo.piecesNeeded
                }). Dimensions: ${widthPerPiece}×${
                  cuttingInfo.constantHeight
                }. CONSUMED by customer.`,
                movementDate: new Date(),
              },
            });

            // Entry for remaining piece (if any) - IN movement
            if (remainingWidthPerRod > 0 && remainingPieceVariant) {
              await tx.stockLedger.create({
                data: {
                  productId: cuttingInfo.measurement.curtainPoleId,
                  shopId: orderExists.ShopId,
                  invoiceNo: `${invoiceNo}-REMAINING`,
                  movementType: 'IN', // Goes back to stock
                  quantity: 1,
                  height: cuttingInfo.constantHeight,
                  width: remainingWidthPerRod,
                  unitOfMeasureId: shopStock?.unitOfMeasureId,
                  reference: `CURTAIN-ROD-REMAINING-M${cuttingInfo.measurement.id}`,
                  userId: updatedById,
                  notes: `Remaining piece after cutting ${widthPerPiece}m from original ${
                    cuttingInfo.variant.width
                  }m rod (rod ${rodNumber + 1}/${
                    cuttingInfo.piecesNeeded
                  }). New dimensions: ${remainingWidthPerRod}×${
                    cuttingInfo.constantHeight
                  }`,
                  movementDate: new Date(),
                },
              });
            }

            console.log(
              `    ✅ Completed processing for rod ${rodNumber + 1}/${
                cuttingInfo.piecesNeeded
              }`,
            );
          }

          console.log(
            `✅ Completed processing for measurement ${cuttingInfo.measurement.id}`,
          );
        }

        // Create system log entry for all cuttings
        console.log(`📝 Creating system log entry for all cuttings...`);
        const cuttingsSummary = statusData.curtainRodCuttingsInfo
          .map((info) => {
            return `Measurement ${info.measurement.id}: Cut ${
              info.piecesNeeded
            } piece(s) of ${info.requestedWidth}m from ${
              info.piecesNeeded
            } individual ${
              info.variant.width
            }m rods. Each rod: removed 1 piece (${info.variant.width}m) → cut ${
              info.requestedWidth
            }m section (consumed) → ${
              info.variant.width - info.requestedWidth > 0
                ? `returned ${
                    info.variant.width - info.requestedWidth
                  }m piece to stock`
                : 'rod fully consumed'
            }.`;
          })
          .join('; ');

        await tx.log.create({
          data: {
            action: `Multiple curtain rod cuts performed for order ${orderId}. ${cuttingsSummary}`,
            userId: updatedById,
          },
        });
        console.log(`✅ System log created`);

        console.log('✅ All curtain rod cuttings completed');
      }

      // Continue with regular stock deduction for other products
      if (
        curtainStatus === 'DELIVERED' &&
        orderExists.curtainStatus !== 'DELIVERED'
      ) {
        console.log(
          `📦 Processing regular stock deduction for other products...`,
        );
        for (const measurement of orderExists.measurements) {
          console.log(`  📏 Processing measurement ${measurement.id}`);

          // Skip curtain pole if we already handled it via cutting
          // The cutting process already removed the rod from stock

          // Curtain Pulls
          if (measurement.curtainPullsId && measurement.curtainPullsQuantity) {
            console.log(
              `    🔧 Deducting curtain pulls: ${measurement.curtainPullsQuantity}`,
            );
            await deductProductStock(tx, {
              productId: measurement.curtainPullsId,
              shopId: orderExists.ShopId,
              quantity: measurement.curtainPullsQuantity,
              measurementId: measurement.id,
              productType: 'curtain pulls',
              updatedById,
            });
            console.log(`    ✅ Curtain pulls deducted`);
          }

          // Curtain Brackets
          if (
            measurement.curtainBracketsId &&
            measurement.curtainBracketsQuantity
          ) {
            console.log(
              `    🔧 Deducting curtain brackets: ${measurement.curtainBracketsQuantity}`,
            );
            await deductProductStock(tx, {
              productId: measurement.curtainBracketsId,
              shopId: orderExists.ShopId,
              quantity: measurement.curtainBracketsQuantity,
              measurementId: measurement.id,
              productType: 'curtain brackets',
              updatedById,
            });
            console.log(`    ✅ Curtain brackets deducted`);
          }

          // Shatter Vertical
          if (measurement.shatterVerticalProductId && measurement.quantity) {
            console.log(
              `    🔧 Deducting shatter vertical: ${measurement.quantity}`,
            );
            await deductProductStock(tx, {
              productId: measurement.shatterVerticalProductId,
              shopId: orderExists.ShopId,
              quantity: measurement.quantity,
              measurementId: measurement.id,
              productType: 'shatter vertical',
              updatedById,
            });
            console.log(`    ✅ Shatter vertical deducted`);
          }
        }
        console.log(`✅ Regular stock deduction completed`);
      }

      // Update order
      console.log(`📝 Updating order ${orderId} with new data...`);
      const updated = await tx.curtainOrder.update({
        where: { id: orderId },
        data: updateData,
        include: {
          customer: true,
          movementType: true,
          deliveredBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          measurements: {
            include: {
              thickProduct: true,
              thinProduct: true,
              curtainPole: true,
              curtainPulls: true,
              curtainBrackets: true,
              shatterVerticalProduct: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
          updatedBy: {
            select: {
              id: true,
              name: true,
            },
          },
          Shop: true,
          curtainPayments: true,
        },
      });
      console.log(`✅ Order ${orderId} updated successfully`);

      return updated;
    });

    console.log('🎉 Transaction completed successfully!');
    console.log('📦 Updated order:', {
      id: updatedOrder.id,
      curtainStatus: updatedOrder.curtainStatus,
      paymentStatus: updatedOrder.paymentStatus,
      updatedAt: updatedOrder.updatedAt,
    });

    return updatedOrder;
  } catch (error) {
    console.error('❌ Error updating curtain order status:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });

    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to update status: ${error.message}`,
    );
  }
};
const updateCurtainOrderPayment = async (
  orderId,
  paymentData, // { amount, paymentMethod, note, paymentDate }
  updatedById,
) => {
  const { amount, paymentMethod, note, paymentDate } = paymentData;

  // Validate required fields
  if (!orderId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Order ID is required');
  }

  if (amount === undefined || amount === null) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Payment amount is required');
  }

  // Parse and validate amount
  const paymentAmount = parseFloat(amount);

  if (Number.isNaN(paymentAmount) || paymentAmount < 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid payment amount');
  }

  // Validate payment method if provided
  const validPaymentMethods = [
    'CASH',
    'TELEBIRR',
    'TRANSFER',
    'CBE',
    'AWASH',
    'DASHEN',
    'ABYSSINIA',
    'HIBRET',
    'NIB',
    'OROMIA',
    'BERHAN',
    'BUNNA',
    'ZEMEN',
    'ENAT',
    'COOP',
    'WEGAGEN',
    'AMHARA',
    'TSEHAY',
    'GOH',
    'HIJRA',
    'SIINQEE',
    'SHABELLE',
    'AHMAD',
    'ADDIS',
    'LION',
    'GADA',
    'RAYA',
  ];
  if (paymentMethod && !validPaymentMethods.includes(paymentMethod)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid payment method');
  }

  // Check if order exists with current payment info
  const orderExists = await prisma.curtainOrder.findUnique({
    where: { id: orderId },
    include: {
      measurements: true,
      curtainPayments: {
        orderBy: {
          createdAt: 'desc',
        },
      },
    },
  });

  if (!orderExists) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Curtain order not found');
  }

  // Calculate total amount from measurements if not already set
  let calculatedTotalAmount = parseFloat(orderExists.totalAmount) || 0;

  if (calculatedTotalAmount === 0 && orderExists.measurements.length > 0) {
    calculatedTotalAmount = orderExists.measurements.reduce(
      (sum, measurement) => sum + (parseFloat(measurement.price) || 0),
      0,
    );
  }

  // Get current total paid from the order
  const currentTotalPaid = parseFloat(orderExists.totalPaid) || 0;
  const currentBalance = parseFloat(orderExists.balance) || 0;

  // Validate payment amount against balance
  const EPSILON = 0.01;
  const roundedPaymentAmount = Math.round(paymentAmount * 100) / 100;
  const roundedCurrentBalance = Math.round(currentBalance * 100) / 100;

  if (roundedPaymentAmount > roundedCurrentBalance + EPSILON) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Payment amount (${roundedPaymentAmount.toFixed(
        2,
      )}) exceeds current balance (${roundedCurrentBalance.toFixed(
        2,
      )}). Maximum allowed payment is ${roundedCurrentBalance.toFixed(2)}`,
    );
  }

  // Calculate new totals
  const actualPaymentAmount = Math.min(
    roundedPaymentAmount,
    roundedCurrentBalance,
  );
  const newTotalPaid = currentTotalPaid + actualPaymentAmount;
  let newBalance = calculatedTotalAmount - newTotalPaid;

  // Fix floating point rounding issues
  newBalance = Math.round(newBalance * 100) / 100;

  // Ensure balance never goes negative
  if (newBalance < 0 && Math.abs(newBalance) <= EPSILON) {
    newBalance = 0;
  }

  if (newBalance < -EPSILON) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Payment would make balance negative. Current balance: ${currentBalance.toFixed(
        2,
      )}, Payment amount: ${actualPaymentAmount.toFixed(2)}`,
    );
  }

  // Determine payment status
  const finalPaymentStatus = newBalance <= EPSILON ? 'PAID' : 'PENDING';

  // Prepare the payment date
  const finalPaymentDate = paymentDate ? new Date(paymentDate) : new Date();

  // Use a transaction to ensure data consistency
  // FIX: Rename the parameter to 'tx' or 'transaction' to avoid shadowing
  const result = await prisma.$transaction(async (tx) => {
    // 1. Create the payment record
    const paymentRecord = await tx.curtainPayment.create({
      data: {
        curtainOrderId: orderId,
        amount: actualPaymentAmount,
        paymentMethod: paymentMethod || null,
        note: note || null,
        paymentDate: finalPaymentDate,
        createdById: updatedById || null,
      },
    });

    // 2. Update the curtain order
    const updatedOrder = await tx.curtainOrder.update({
      where: { id: orderId },
      data: {
        totalAmount: calculatedTotalAmount,
        totalPaid: newTotalPaid,
        balance: newBalance,
        paymentStatus: finalPaymentStatus,
        updatedById: updatedById || null,
      },
      include: {
        customer: true,
        movementType: true,
        measurements: true,
        curtainPayments: {
          orderBy: {
            createdAt: 'desc',
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // 3. Create a log entry
    const paymentStatusMessage =
      newBalance <= EPSILON
        ? `ORDER FULLY PAID - Balance is zero (${newBalance})`
        : `Partial payment - Remaining balance: ${newBalance}`;

    await tx.log.create({
      data: {
        action: `Payment added for curtain order ${orderId}: ${paymentStatusMessage}. Payment amount = ${actualPaymentAmount}, Payment method = ${
          paymentMethod || 'N/A'
        }, Payment date = ${finalPaymentDate.toISOString()}, Previous Total Paid = ${currentTotalPaid}, New Total Paid = ${newTotalPaid}, Previous Balance = ${currentBalance}, New Balance = ${newBalance}, Status = ${finalPaymentStatus}`,
        userId: updatedById || null,
      },
    });

    return updatedOrder;
  });

  return result;
};

const updateCurtainOrderDeliveryDeadline = async (
  orderId,
  deliveryDeadline,
  updatedById,
) => {
  try {
    /* ---------------- VALIDATION ---------------- */
    if (!orderId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Order ID is required');
    }

    if (deliveryDeadline === undefined || deliveryDeadline === null) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Delivery deadline is required',
      );
    }

    /* ---------------- CHECK ORDER EXISTS ---------------- */
    const existingOrder = await prisma.curtainOrder.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        movementType: true,
      },
    });

    if (!existingOrder) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Curtain order not found');
    }

    /* ---------------- VALIDATE DELIVERY DEADLINE ---------------- */
    let parsedDeadline;

    // Handle different input types
    if (deliveryDeadline instanceof Date) {
      parsedDeadline = deliveryDeadline;
    } else if (typeof deliveryDeadline === 'string') {
      parsedDeadline = new Date(deliveryDeadline);
    } else {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid delivery deadline format. Must be a valid date.',
      );
    }

    // Check if date is valid
    if (Number.isNaN(parsedDeadline.getTime())) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid delivery deadline date',
      );
    }

    // Optional: Check if deadline is in the future
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (parsedDeadline < today) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Delivery deadline cannot be in the past',
      );
    }

    /* ---------------- UPDATE DELIVERY DEADLINE ---------------- */
    const updateData = {
      deliveryDeadline: parsedDeadline,
      updatedById: updatedById || null,
      updatedAt: new Date(),
    };

    const updatedOrder = await prisma.curtainOrder.update({
      where: { id: orderId },
      data: updateData,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone1: true,
          },
        },
        movementType: true,
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return updatedOrder;
  } catch (error) {
    console.error('🔥 ERROR in updateCurtainOrderDeliveryDeadline');
    throw error;
  }
};
const getWorkerPaymentReport = async (
  startDate,
  endDate,
  filters = {},
  userId,
) => {
  try {
    /* ---------------- VALIDATION ---------------- */
    if (!startDate || !endDate) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Start date and end date are required',
      );
    }

    /* ---------------- PARSE DATES ---------------- */
    let parsedStartDate;
    let parsedEndDate;

    const parseDate = (date) => {
      if (date instanceof Date) return date;
      if (typeof date === 'string') return new Date(date);
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid date format. Must be a valid date.',
      );
    };

    try {
      parsedStartDate = parseDate(startDate);
      parsedEndDate = parseDate(endDate);

      parsedStartDate.setHours(0, 0, 0, 0);
      parsedEndDate.setHours(23, 59, 59, 999);
    } catch (error) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid date format. Please provide valid dates.',
      );
    }

    if (parsedStartDate > parsedEndDate) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Start date cannot be after end date',
      );
    }

    /* ---------------- BUILD FILTER CONDITIONS ---------------- */
    const {
      paymentStatus,
      workerId,
      shopId,
      movementTypeId,
      includePaid = true,
      includeUnpaid = true,
      workerType = 'ALL', // 'THIN', 'THICK', 'ALL'
    } = filters;

    // Base where clause for CurtainOrder - only include orders with measurements that have workers
    const orderWhereClause = {
      createdAt: {
        gte: parsedStartDate,
        lte: parsedEndDate,
      },
      measurements: {
        some: {
          OR: [
            { thinWorkerId: { not: null } },
            { thickWorkerId: { not: null } },
          ],
        },
      },
    };

    if (shopId) {
      orderWhereClause.ShopId = shopId;
    }

    if (movementTypeId) {
      orderWhereClause.movementTypeId = movementTypeId;
    }

    // Add worker-specific filter
    if (workerId) {
      orderWhereClause.measurements = {
        some: {
          OR: [{ thinWorkerId: workerId }, { thickWorkerId: workerId }],
        },
      };
    }

    /* ---------------- FETCH ORDERS WITH MEASUREMENTS ---------------- */

    const orders = await prisma.curtainOrder.findMany({
      where: orderWhereClause,
      include: {
        movementType: {
          select: {
            id: true,
            name: true,
          },
        },
        Shop: {
          select: {
            id: true,
            name: true,
          },
        },
        measurements: {
          where: {
            OR: [
              { thinWorkerId: { not: null } },
              { thickWorkerId: { not: null } },
            ],
          },
          include: {
            thinWorker: {
              select: {
                id: true,
                name: true,
                phone: true,
                role: true,
              },
            },
            thickWorker: {
              select: {
                id: true,
                name: true,
                phone: true,
                role: true,
              },
            },
            thinProduct: {
              select: {
                id: true,
                name: true,
                productCode: true,
              },
            },
            thickProduct: {
              select: {
                id: true,
                name: true,
                productCode: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    /* ---------------- PROCESS WORKER DATA ONLY ---------------- */
    const reportData = {
      summary: {
        totalOrders: orders.length,
        totalMeasurements: 0,
        totalThinWorkerAmount: 0,
        totalThickWorkerAmount: 0,
        totalWorkerAmount: 0,
        paidThinWorkers: 0,
        unpaidThinWorkers: 0,
        paidThickWorkers: 0,
        unpaidThickWorkers: 0,
        totalPaidAmount: 0,
        totalUnpaidAmount: 0,
        totalWorkerJobs: 0,
        totalWorkerMeters: 0,
        totalUniqueWorkers: 0,
      },
      workers: {
        thin: {},
        thick: {},
      },
      measurements: [], // Flat list of measurements with worker details
      dateRange: {
        start: parsedStartDate,
        end: parsedEndDate,
      },
      generatedAt: new Date(),
      generatedBy: userId,
    };

    // Process measurements to extract worker data
    orders.forEach((order) => {
      order.measurements.forEach((measurement) => {
        const measurementWorkerData = {
          measurementId: measurement.id,
          orderId: order.id,
          orderDate: order.createdAt,
          roomName: measurement.roomName,
          totalWorkerMeter: measurement.totalWorkerMeter || 0,
          workerPrice: measurement.workerPrice || 0,
          shopName: order.Shop?.name || 'N/A',
          movementType: order.movementType?.name || 'N/A',
        };

        // Process Thin Worker
        if (measurement.thinWorker) {
          const workerId = measurement.thinWorker.id;

          // Update measurement data with thin worker info
          const thinWorkerData = {
            ...measurementWorkerData,
            workerType: 'THIN',
            workerId: measurement.thinWorker.id,
            workerName: measurement.thinWorker.name,
            workerPhone: measurement.thinWorker.phone,
            workerRole: measurement.thinWorker.role,
            isPaid: measurement.thinWorkerPaid || false,
            paidDate: measurement.thinWorkerPaidDate,
            productName: measurement.thinProduct?.name,
            productCode: measurement.thinProduct?.productCode,
          };

          reportData.measurements.push(thinWorkerData);

          // Update summary
          reportData.summary.totalMeasurements++;
          reportData.summary.totalThinWorkerAmount +=
            measurement.workerPrice || 0;
          reportData.summary.totalWorkerAmount += measurement.workerPrice || 0;
          reportData.summary.totalWorkerMeters +=
            measurement.totalWorkerMeter || 0;

          if (measurement.thinWorkerPaid) {
            reportData.summary.paidThinWorkers++;
            reportData.summary.totalPaidAmount += measurement.workerPrice || 0;
          } else {
            reportData.summary.unpaidThinWorkers++;
            reportData.summary.totalUnpaidAmount +=
              measurement.workerPrice || 0;
          }

          // Group by worker
          if (!reportData.workers.thin[workerId]) {
            reportData.workers.thin[workerId] = {
              workerId: measurement.thinWorker.id,
              workerName: measurement.thinWorker.name,
              workerPhone: measurement.thinWorker.phone,
              workerRole: measurement.thinWorker.role,
              totalJobs: 0,
              totalMeters: 0,
              totalAmount: 0,
              paidAmount: 0,
              unpaidAmount: 0,
              jobs: [],
            };
          }

          const workerStats = reportData.workers.thin[workerId];
          workerStats.totalJobs++;
          workerStats.totalMeters += measurement.totalWorkerMeter || 0;
          workerStats.totalAmount += measurement.workerPrice || 0;

          if (measurement.thinWorkerPaid) {
            workerStats.paidAmount += measurement.workerPrice || 0;
          } else {
            workerStats.unpaidAmount += measurement.workerPrice || 0;
          }

          workerStats.jobs.push({
            measurementId: measurement.id,
            orderId: order.id,
            orderDate: order.createdAt,
            roomName: measurement.roomName,
            meter: measurement.totalWorkerMeter || 0,
            amount: measurement.workerPrice || 0,
            productName: measurement.thinProduct?.name,
            productCode: measurement.thinProduct?.productCode,
            paid: measurement.thinWorkerPaid,
            paidDate: measurement.thinWorkerPaidDate,
          });
        }

        // Process Thick Worker
        if (measurement.thickWorker) {
          const workerId = measurement.thickWorker.id;

          // Update measurement data with thick worker info
          const thickWorkerData = {
            ...measurementWorkerData,
            workerType: 'THICK',
            workerId: measurement.thickWorker.id,
            workerName: measurement.thickWorker.name,
            workerPhone: measurement.thickWorker.phone,
            workerRole: measurement.thickWorker.role,
            isPaid: measurement.thickWorkerPaid || false,
            paidDate: measurement.thickWorkerPaidDate,
            productName: measurement.thickProduct?.name,
            productCode: measurement.thickProduct?.productCode,
          };

          reportData.measurements.push(thickWorkerData);

          // Update summary
          reportData.summary.totalMeasurements++;
          reportData.summary.totalThickWorkerAmount +=
            measurement.workerPrice || 0;
          reportData.summary.totalWorkerAmount += measurement.workerPrice || 0;
          reportData.summary.totalWorkerMeters +=
            measurement.totalWorkerMeter || 0;

          if (measurement.thickWorkerPaid) {
            reportData.summary.paidThickWorkers++;
            reportData.summary.totalPaidAmount += measurement.workerPrice || 0;
          } else {
            reportData.summary.unpaidThickWorkers++;
            reportData.summary.totalUnpaidAmount +=
              measurement.workerPrice || 0;
          }

          // Group by worker
          if (!reportData.workers.thick[workerId]) {
            reportData.workers.thick[workerId] = {
              workerId: measurement.thickWorker.id,
              workerName: measurement.thickWorker.name,
              workerPhone: measurement.thickWorker.phone,
              workerRole: measurement.thickWorker.role,
              totalJobs: 0,
              totalMeters: 0,
              totalAmount: 0,
              paidAmount: 0,
              unpaidAmount: 0,
              jobs: [],
            };
          }

          const workerStats = reportData.workers.thick[workerId];
          workerStats.totalJobs++;
          workerStats.totalMeters += measurement.totalWorkerMeter || 0;
          workerStats.totalAmount += measurement.workerPrice || 0;

          if (measurement.thickWorkerPaid) {
            workerStats.paidAmount += measurement.workerPrice || 0;
          } else {
            workerStats.unpaidAmount += measurement.workerPrice || 0;
          }

          workerStats.jobs.push({
            measurementId: measurement.id,
            orderId: order.id,
            orderDate: order.createdAt,
            roomName: measurement.roomName,
            meter: measurement.totalWorkerMeter || 0,
            amount: measurement.workerPrice || 0,
            productName: measurement.thickProduct?.name,
            productCode: measurement.thickProduct?.productCode,
            paid: measurement.thickWorkerPaid,
            paidDate: measurement.thickWorkerPaidDate,
          });
        }
      });
    });

    // Filter measurements based on worker type and payment status
    if (workerType === 'THIN') {
      reportData.measurements = reportData.measurements.filter(
        (m) => m.workerType === 'THIN',
      );
    } else if (workerType === 'THICK') {
      reportData.measurements = reportData.measurements.filter(
        (m) => m.workerType === 'THICK',
      );
    }

    if (!includePaid && includeUnpaid) {
      reportData.measurements = reportData.measurements.filter(
        (m) => !m.isPaid,
      );
    } else if (includePaid && !includeUnpaid) {
      reportData.measurements = reportData.measurements.filter((m) => m.isPaid);
    }

    if (paymentStatus === 'PAID') {
      reportData.measurements = reportData.measurements.filter((m) => m.isPaid);
    } else if (paymentStatus === 'UNPAID') {
      reportData.measurements = reportData.measurements.filter(
        (m) => !m.isPaid,
      );
    }

    // Convert workers objects to arrays
    reportData.workers.thin = Object.values(reportData.workers.thin);
    reportData.workers.thick = Object.values(reportData.workers.thick);

    // Calculate final summary metrics
    reportData.summary.totalWorkerJobs =
      reportData.workers.thin.reduce((acc, w) => acc + w.totalJobs, 0) +
      reportData.workers.thick.reduce((acc, w) => acc + w.totalJobs, 0);

    reportData.summary.totalUniqueWorkers =
      reportData.workers.thin.length + reportData.workers.thick.length;

    console.log('✅ Worker Payment Report generated:', {
      totalMeasurements: reportData.summary.totalMeasurements,
      totalUniqueWorkers: reportData.summary.totalUniqueWorkers,
      totalWorkerAmount: reportData.summary.totalWorkerAmount,
      totalPaid: reportData.summary.totalPaidAmount,
      totalUnpaid: reportData.summary.totalUnpaidAmount,
    });

    return reportData;
  } catch (error) {
    console.error('🔥 ERROR in getWorkerPaymentReport');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
};

// Additional helper function to mark worker as paid
const markWorkerAsPaid = async (
  measurementId,
  workerType, // 'THIN' or 'THICK'
  paidById,
) => {
  try {
    /* ---------------- VALIDATION ---------------- */
    if (!measurementId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Measurement ID is required');
    }

    if (!workerType || !['THIN', 'THICK'].includes(workerType)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Valid worker type (THIN or THICK) is required',
      );
    }

    /* ---------------- CHECK MEASUREMENT EXISTS ---------------- */
    const existingMeasurement = await prisma.curtainMeasurement.findUnique({
      where: { id: measurementId },
      include: {
        thinWorker: true,
        thickWorker: true,
        order: true,
      },
    });

    if (!existingMeasurement) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Curtain measurement not found');
    }

    // Check if the worker type is assigned to this measurement
    if (workerType === 'THIN' && !existingMeasurement.thinWorkerId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'No thin worker assigned to this measurement',
      );
    }

    if (workerType === 'THICK' && !existingMeasurement.thickWorkerId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'No thick worker assigned to this measurement',
      );
    }

    // Check if already paid
    if (workerType === 'THIN' && existingMeasurement.thinWorkerPaid) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Thin worker is already marked as paid',
      );
    }

    if (workerType === 'THICK' && existingMeasurement.thickWorkerPaid) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Thick worker is already marked as paid',
      );
    }

    /* ---------------- UPDATE WORKER PAYMENT STATUS ---------------- */
    const updateData = {
      updatedAt: new Date(),
    };

    if (workerType === 'THIN') {
      updateData.thinWorkerPaid = true;
      updateData.thinWorkerPaidDate = new Date();
    } else {
      updateData.thickWorkerPaid = true;
      updateData.thickWorkerPaidDate = new Date();
    }

    const updatedMeasurement = await prisma.curtainMeasurement.update({
      where: { id: measurementId },
      data: updateData,
      include: {
        thinWorker: {
          select: {
            id: true,
            name: true,
          },
        },
        thickWorker: {
          select: {
            id: true,
            name: true,
          },
        },
        order: {
          select: {
            id: true,
            customer: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    console.log('✅ Worker payment marked successfully:', {
      measurementId: updatedMeasurement.id,
      workerType,
      workerName:
        workerType === 'THIN'
          ? updatedMeasurement.thinWorker?.name
          : updatedMeasurement.thickWorker?.name,
      paidDate:
        workerType === 'THIN'
          ? updatedMeasurement.thinWorkerPaidDate
          : updatedMeasurement.thickWorkerPaidDate,
    });

    return updatedMeasurement;
  } catch (error) {
    console.error('🔥 ERROR in markWorkerAsPaid');
    console.error('Message:', error.message);

    // If it's a Prisma validation error, it might be because the client needs to be regenerated
    if (error.name === 'PrismaClientValidationError') {
      console.error(
        '⚠️ This might be a Prisma client issue. Try running: npx prisma generate',
      );
    }

    throw error;
  }
};
// Helper function to get week number
function getWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  );
}

// Helper function to get start of week (Monday)
function getStartOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

// Helper function to get end of week (Sunday)
function getEndOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? 0 : 7);
  return new Date(d.setDate(diff)).toISOString().split('T')[0];
}
const getInvoiceReportByDate = async (dateFilter) => {
  const { startDate, endDate } = dateFilter;

  console.log('📊 Generating invoice report for date range:', {
    startDate,
    endDate,
  });

  // Validate required fields
  if (!startDate) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Start date is required');
  }

  if (!endDate) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'End date is required');
  }

  // Parse and validate dates
  const startDateTime = new Date(startDate);
  const endDateTime = new Date(endDate);

  if (isNaN(startDateTime.getTime())) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid start date format');
  }

  if (isNaN(endDateTime.getTime())) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid end date format');
  }

  // Set start date to beginning of day (00:00:00.000)
  startDateTime.setHours(0, 0, 0, 0);

  // Set end date to end of day (23:59:59.999)
  endDateTime.setHours(23, 59, 59, 999);

  if (startDateTime > endDateTime) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Start date cannot be after end date',
    );
  }

  try {
    // Fetch all data in parallel for better performance
    const [curtainPayments, purchases, expenses] = await Promise.all([
      // 1. Fetch Curtain Payments within date range
      prisma.curtainPayment.findMany({
        where: {
          paymentDate: {
            gte: startDateTime,
            lte: endDateTime,
          },
        },
        include: {
          curtainOrder: {
            include: {
              customer: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          paymentDate: 'desc',
        },
      }),

      // 2. Fetch Purchases within date range
      prisma.purchase.findMany({
        where: {
          purchaseDate: {
            gte: startDateTime,
            lte: endDateTime,
          },
        },
        include: {
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
          store: {
            select: {
              id: true,
              name: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                },
              },
              unitOfMeasure: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
        orderBy: {
          purchaseDate: 'desc',
        },
      }),

      // 3. Fetch Expenses within date range
      prisma.expense.findMany({
        where: {
          expenseDate: {
            gte: startDateTime,
            lte: endDateTime,
          },
        },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          expenseDate: 'desc',
        },
      }),
    ]);

    // Calculate totals
    const totalIncome = curtainPayments.reduce(
      (sum, payment) => sum + parseFloat(payment.amount),
      0,
    );

    const totalExpenses = expenses.reduce(
      (sum, expense) => sum + expense.amount,
      0,
    );

    const totalPurchases = purchases.reduce(
      (sum, purchase) => sum + purchase.grandTotal,
      0,
    );

    const netProfit = totalIncome - totalExpenses - totalPurchases;

    // Format curtain payments for response
    const formattedCurtainPayments = curtainPayments.map((payment) => ({
      id: payment.id,
      amount: parseFloat(payment.amount),
      paymentMethod: payment.paymentMethod,
      paymentDate: payment.paymentDate,
      note: payment.note,
      orderCode: payment.curtainOrder?.code || 'N/A',
      customerName: payment.curtainOrder?.customer?.name || 'N/A',
      createdBy: payment.createdBy?.name || null,
    }));

    // Format purchases for response
    const formattedPurchases = purchases.map((purchase) => ({
      id: purchase.id,
      invoiceNo: purchase.invoiceNo,
      supplierName: purchase.supplier?.name || 'N/A',
      storeName: purchase.store?.name || 'N/A',
      grandTotal: purchase.grandTotal,
      subTotal: purchase.subTotal,
      purchaseDate: purchase.purchaseDate,
      paymentStatus: purchase.paymentStatus,
      notes: purchase.notes,
      createdBy: purchase.createdBy?.name || null,
      totalProducts: purchase.totalProducts,
      items: purchase.items.map((item) => ({
        productName: item.product?.name || 'N/A',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        height: item.height,
        width: item.width,
        unitOfMeasure: item.unitOfMeasure?.name || 'N/A',
      })),
    }));

    // Format expenses for response
    const formattedExpenses = expenses.map((expense) => ({
      id: expense.id,
      title: expense.title,
      description: expense.description,
      amount: expense.amount,
      expenseDate: expense.expenseDate,
      createdBy: expense.createdBy?.name || null,
    }));

    // ============ DATA FOR BAR CHARTS ============

    // 1. Daily breakdown (for line/bar charts)
    const dailyData = new Map();

    // Helper to get date key
    const getDateKey = (date) => date.toISOString().split('T')[0];

    // Initialize all dates in range
    const currentDate = new Date(startDateTime);
    while (currentDate <= endDateTime) {
      const dateKey = getDateKey(currentDate);
      dailyData.set(dateKey, {
        date: dateKey,
        income: 0,
        expenses: 0,
        purchases: 0,
        profit: 0,
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Add payment data to daily breakdown
    curtainPayments.forEach((payment) => {
      const dateKey = getDateKey(payment.paymentDate);
      if (dailyData.has(dateKey)) {
        dailyData.get(dateKey).income += parseFloat(payment.amount);
      }
    });

    // Add expense data to daily breakdown
    expenses.forEach((expense) => {
      const dateKey = getDateKey(expense.expenseDate);
      if (dailyData.has(dateKey)) {
        dailyData.get(dateKey).expenses += expense.amount;
      }
    });

    // Add purchase data to daily breakdown
    purchases.forEach((purchase) => {
      const dateKey = getDateKey(purchase.purchaseDate);
      if (dailyData.has(dateKey)) {
        dailyData.get(dateKey).purchases += purchase.grandTotal;
      }
    });

    // Calculate profit for each day
    const chartData = Array.from(dailyData.values()).map((day) => ({
      ...day,
      profit: day.income - day.expenses - day.purchases,
    }));

    // 2. Weekly breakdown
    const weeklyData = new Map();
    chartData.forEach((day) => {
      const date = new Date(day.date);
      const weekNumber = getWeekNumber(date);
      const weekKey = `${date.getFullYear()}-W${weekNumber}`;

      if (!weeklyData.has(weekKey)) {
        weeklyData.set(weekKey, {
          week: weekKey,
          weekNumber,
          year: date.getFullYear(),
          startDate: getStartOfWeek(date),
          endDate: getEndOfWeek(date),
          income: 0,
          expenses: 0,
          purchases: 0,
          profit: 0,
        });
      }

      const week = weeklyData.get(weekKey);
      week.income += day.income;
      week.expenses += day.expenses;
      week.purchases += day.purchases;
      week.profit += day.profit;
    });

    // 3. Monthly breakdown
    const monthlyData = new Map();
    chartData.forEach((day) => {
      const monthKey = day.date.substring(0, 7); // YYYY-MM
      const monthNames = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];
      const monthNum = parseInt(monthKey.split('-')[1]) - 1;

      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, {
          month: monthKey,
          monthName: monthNames[monthNum],
          monthNumber: monthNum + 1,
          year: parseInt(monthKey.split('-')[0]),
          income: 0,
          expenses: 0,
          purchases: 0,
          profit: 0,
        });
      }

      const month = monthlyData.get(monthKey);
      month.income += day.income;
      month.expenses += day.expenses;
      month.purchases += day.purchases;
      month.profit += day.profit;
    });

    // 4. Payment method breakdown for pie chart
    const paymentMethodData = {};
    curtainPayments.forEach((payment) => {
      const method = payment.paymentMethod || 'OTHER';
      if (!paymentMethodData[method]) {
        paymentMethodData[method] = 0;
      }
      paymentMethodData[method] += parseFloat(payment.amount);
    });

    // Convert to array format for pie chart
    const paymentMethodArray = Object.entries(paymentMethodData).map(
      ([name, value]) => ({
        name,
        value: Math.round(value * 100) / 100,
      }),
    );

    // 5. Expense category breakdown for pie chart
    const expenseCategoryData = {};
    expenses.forEach((expense) => {
      const category = expense.title || 'Uncategorized';
      if (!expenseCategoryData[category]) {
        expenseCategoryData[category] = 0;
      }
      expenseCategoryData[category] += expense.amount;
    });

    const expenseCategoryArray = Object.entries(expenseCategoryData).map(
      ([name, value]) => ({
        name,
        value: Math.round(value * 100) / 100,
      }),
    );

    // 6. Top suppliers by purchase amount (bar chart)
    const supplierData = {};
    purchases.forEach((purchase) => {
      const supplierName = purchase.supplier?.name || 'Unknown';
      if (!supplierData[supplierName]) {
        supplierData[supplierName] = 0;
      }
      supplierData[supplierName] += purchase.grandTotal;
    });

    const topSuppliers = Object.entries(supplierData)
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10); // Top 10 suppliers

    // 7. Cumulative profit over time (for area chart)
    let cumulativeProfit = 0;
    const cumulativeData = chartData.map((day) => {
      cumulativeProfit += day.profit;
      return {
        date: day.date,
        cumulativeProfit: Math.round(cumulativeProfit * 100) / 100,
        dailyProfit: day.profit,
        dailyIncome: day.income,
        dailyExpenses: day.expenses + day.purchases,
      };
    });

    // 8. Group payments by date for trend analysis
    const paymentsByDate = {};
    curtainPayments.forEach((payment) => {
      const date = payment.paymentDate.toISOString().split('T')[0];
      if (!paymentsByDate[date]) {
        paymentsByDate[date] = 0;
      }
      paymentsByDate[date] += parseFloat(payment.amount);
    });

    const paymentsTrend = Object.entries(paymentsByDate).map(
      ([date, amount]) => ({
        date,
        amount: Math.round(amount * 100) / 100,
      }),
    );

    // 9. Group purchases by date
    const purchasesByDate = {};
    purchases.forEach((purchase) => {
      const date = purchase.purchaseDate.toISOString().split('T')[0];
      if (!purchasesByDate[date]) {
        purchasesByDate[date] = 0;
      }
      purchasesByDate[date] += purchase.grandTotal;
    });

    const purchasesTrend = Object.entries(purchasesByDate).map(
      ([date, amount]) => ({
        date,
        amount: Math.round(amount * 100) / 100,
      }),
    );

    // 10. Profit margin by month
    const profitMarginData = Array.from(monthlyData.values()).map((month) => ({
      month: month.monthName,
      year: month.year,
      monthKey: month.month,
      profitMargin:
        month.income > 0
          ? Math.round((month.profit / month.income) * 100 * 100) / 100
          : 0,
      income: month.income,
      profit: month.profit,
    }));

    // Group payments by payment method
    const paymentsByMethod = {};
    curtainPayments.forEach((payment) => {
      const method = payment.paymentMethod || 'OTHER';
      if (!paymentsByMethod[method]) {
        paymentsByMethod[method] = 0;
      }
      paymentsByMethod[method] += parseFloat(payment.amount);
    });

    // Group expenses by date
    const expensesByDate = {};
    expenses.forEach((expense) => {
      const date = expense.expenseDate.toISOString().split('T')[0];
      if (!expensesByDate[date]) {
        expensesByDate[date] = 0;
      }
      expensesByDate[date] += expense.amount;
    });

    // Prepare summary
    const summary = {
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      totalPurchases: Math.round(totalPurchases * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      startDate: startDateTime.toISOString(),
      endDate: endDateTime.toISOString(),
      paymentsByMethod,
      expensesByDate,
      counts: {
        totalPayments: curtainPayments.length,
        totalPurchases: purchases.length,
        totalExpenses: expenses.length,
      },
    };

    // Log the report generation
    await prisma.log.create({
      data: {
        action: `Invoice report generated for date range: ${startDate} to ${endDate}. Total Income: ${summary.totalIncome}, Total Expenses: ${summary.totalExpenses}, Total Purchases: ${summary.totalPurchases}, Net Profit: ${summary.netProfit}`,
        userId: null,
      },
    });

    return {
      summary,
      curtainPayments: formattedCurtainPayments,
      purchases: formattedPurchases,
      expenses: formattedExpenses,
      // Chart-ready data
      charts: {
        // Daily breakdown (for line/bar charts)
        daily: chartData,

        // Weekly breakdown
        weekly: Array.from(weeklyData.values()),

        // Monthly breakdown
        monthly: Array.from(monthlyData.values()),

        // Payment methods (for pie chart)
        paymentMethods: paymentMethodArray,

        // Expense categories (for pie chart)
        expenseCategories: expenseCategoryArray,

        // Top suppliers (for bar chart)
        topSuppliers,

        // Cumulative profit (for area chart)
        cumulativeProfit: cumulativeData,

        // Payment trends (for line chart)
        paymentTrends: paymentsTrend,

        // Purchase trends (for line chart)
        purchaseTrends: purchasesTrend,

        // Profit margin by month (for bar chart)
        profitMargins: profitMarginData,

        // Comparison data (for grouped bar chart)
        comparison: {
          labels: Array.from(monthlyData.values()).map((m) => m.monthName),
          datasets: {
            income: Array.from(monthlyData.values()).map((m) => m.income),
            expenses: Array.from(monthlyData.values()).map(
              (m) => m.expenses + m.purchases,
            ),
            profit: Array.from(monthlyData.values()).map((m) => m.profit),
          },
        },

        // Summary stats for KPI cards
        kpi: {
          averageDailyIncome:
            chartData.length > 0
              ? Math.round((totalIncome / chartData.length) * 100) / 100
              : 0,
          averageDailyExpense:
            chartData.length > 0
              ? Math.round(
                  ((totalExpenses + totalPurchases) / chartData.length) * 100,
                ) / 100
              : 0,
          profitMargin:
            totalIncome > 0
              ? Math.round((netProfit / totalIncome) * 100 * 100) / 100
              : 0,
          bestDay: chartData.reduce(
            (best, day) => (day.profit > best.profit ? day : best),
            chartData[0] || { profit: -Infinity },
          ),
          worstDay: chartData.reduce(
            (worst, day) => (day.profit < worst.profit ? day : worst),
            chartData[0] || { profit: Infinity },
          ),
        },
      },
    };
  } catch (error) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to generate invoice report',
    );
  }
};
const bulkUpdateShatterVerticalMeasurements = async (
  measurementsDataArray,
  orderId,
  updatedById,
  shopId,
) => {
  try {
    // Validate input is an array
    if (
      !Array.isArray(measurementsDataArray) ||
      measurementsDataArray.length === 0
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Measurements data must be a non-empty array',
      );
    }

    // Check if order exists once for all updates
    if (!orderId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Order ID is required');
    }

    const orderExists = await prisma.curtainOrder.findUnique({
      where: { id: orderId },
    });

    if (!orderExists) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Order not found');
    }

    // Check shop if provided
    if (shopId) {
      const shopExists = await prisma.shop.findUnique({
        where: { id: shopId },
      });

      if (!shopExists) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Shop not found');
      }
    }

    // Separate measurements into updates and creates
    const updateOperations = [];
    const createOperations = [];
    const updateMeasurements = [];
    const newMeasurements = [];

    // Separate items with and without measurementId
    for (const measurementItem of measurementsDataArray) {
      if (measurementItem.measurementId) {
        updateMeasurements.push(measurementItem);
      } else {
        newMeasurements.push(measurementItem);
      }
    }

    // Fetch existing measurements only for updates
    let existingMap = new Map();
    if (updateMeasurements.length > 0) {
      const measurementIds = updateMeasurements.map(
        (item) => item.measurementId,
      );

      const existingMeasurements = await prisma.curtainMeasurement.findMany({
        where: {
          id: { in: measurementIds },
          orderId,
        },
      });

      // Check if all measurements exist
      const existingIds = new Set(existingMeasurements.map((m) => m.id));
      const missingIds = measurementIds.filter((id) => !existingIds.has(id));

      if (missingIds.length > 0) {
        throw new ApiError(
          httpStatus.NOT_FOUND,
          `Measurements not found: ${missingIds.join(', ')}`,
        );
      }

      existingMap = new Map(existingMeasurements.map((m) => [m.id, m]));
    }

    // Track price changes for order total update
    let totalPriceDifference = 0;
    let totalNewPrice = 0;

    // Helper function to prepare measurement data
    const prepareMeasurementData = (
      measurementData,
      existingMeasurement = null,
    ) => {
      const {
        roomName,
        width,
        height,
        quantity,
        unitprice,
        pricePerUnit,
        price,
        remark,
        shatterVerticalProductId,
      } = measurementData;

      // Numeric conversions
      const numericWidth =
        width !== undefined && width !== null ? parseFloat(width) : undefined;
      const numericHeight =
        height !== undefined && height !== null
          ? parseFloat(height)
          : undefined;
      const numericQuantity =
        quantity !== undefined && quantity !== null
          ? parseInt(quantity, 10)
          : undefined;
      const numericUnitprice =
        unitprice !== undefined && unitprice !== null
          ? parseFloat(unitprice)
          : undefined;
      const numericPricePerUnit =
        pricePerUnit !== undefined && pricePerUnit !== null
          ? parseFloat(pricePerUnit)
          : undefined;
      const numericPrice =
        price !== undefined && price !== null ? parseFloat(price) : undefined;

      // Build base data object
      const data = {
        roomName:
          roomName !== undefined ? roomName : existingMeasurement?.roomName,
        width: !isNaN(numericWidth) ? numericWidth : existingMeasurement?.width,
        height: !isNaN(numericHeight)
          ? numericHeight
          : existingMeasurement?.height,
        quantity: !isNaN(numericQuantity)
          ? numericQuantity
          : existingMeasurement?.quantity,
        unitprice: !isNaN(numericUnitprice)
          ? numericUnitprice
          : existingMeasurement?.unitprice,
        pricePerUnit: !isNaN(numericPricePerUnit)
          ? numericPricePerUnit
          : existingMeasurement?.pricePerUnit,
        price: !isNaN(numericPrice) ? numericPrice : existingMeasurement?.price,
        remark:
          remark !== undefined ? remark || null : existingMeasurement?.remark,
      };

      // Handle relations for existing measurements (update) or new measurements (create)
      if (existingMeasurement) {
        // For updates, handle updatedBy
        if (updatedById) {
          data.updatedBy = { connect: { id: updatedById } };
        }
        data.updatedAt = new Date();
      } else {
        // For creates, handle createdBy and order connection
        if (updatedById) {
          data.createdBy = { connect: { id: updatedById } };
        }
        data.order = { connect: { id: orderId } };
      }

      // Handle Shatter Vertical Product relation
      if (shatterVerticalProductId !== undefined) {
        if (shatterVerticalProductId && shatterVerticalProductId !== 'NONE') {
          data.shatterVerticalProduct = {
            connect: { id: shatterVerticalProductId },
          };
        } else if (existingMeasurement) {
          data.shatterVerticalProduct = { disconnect: true };
        }
      } else if (!existingMeasurement && shatterVerticalProductId) {
        data.shatterVerticalProduct = {
          connect: { id: shatterVerticalProductId },
        };
      }

      return data;
    };

    // Process updates
    for (const measurementItem of updateMeasurements) {
      const { measurementId, curtainMeasurementData } = measurementItem;

      // Parse measurement data
      let measurementData;
      if (Array.isArray(curtainMeasurementData)) {
        if (curtainMeasurementData.length === 0) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `No measurement data provided for measurement ${measurementId}`,
          );
        }
        measurementData = curtainMeasurementData[0];
      } else {
        measurementData = curtainMeasurementData;
      }

      const existingMeasurement = existingMap.get(measurementId);
      const data = prepareMeasurementData(measurementData, existingMeasurement);

      // Calculate price difference for updates
      const oldPrice = existingMeasurement.price
        ? parseFloat(existingMeasurement.price)
        : 0;
      const newPrice = data.price ? parseFloat(data.price) : oldPrice;
      const priceDifference = newPrice - oldPrice;
      totalPriceDifference += priceDifference;

      // Validate shatter vertical product if provided
      if (data.shatterVerticalProduct?.connect?.id) {
        const productExists = await prisma.product.findUnique({
          where: { id: data.shatterVerticalProduct.connect.id },
        });

        if (!productExists) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Shatter vertical product not found for measurement ${measurementId}`,
          );
        }
      }

      updateOperations.push(
        prisma.curtainMeasurement.update({
          where: { id: measurementId },
          data,
        }),
      );
    }

    // Process new measurements (creates)
    for (const measurementItem of newMeasurements) {
      const { curtainMeasurementData } = measurementItem;

      // Parse measurement data
      let measurementData;
      if (Array.isArray(curtainMeasurementData)) {
        if (curtainMeasurementData.length === 0) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            'No measurement data provided for new measurement',
          );
        }
        measurementData = curtainMeasurementData[0];
      } else {
        measurementData = curtainMeasurementData;
      }

      const data = prepareMeasurementData(measurementData, null);

      // Validate shatter vertical product if provided
      if (data.shatterVerticalProduct?.connect?.id) {
        const productExists = await prisma.product.findUnique({
          where: { id: data.shatterVerticalProduct.connect.id },
        });

        if (!productExists) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            'Shatter vertical product not found',
          );
        }
      }

      // Add price to total for new measurements
      if (data.price) {
        totalNewPrice += parseFloat(data.price);
      }

      createOperations.push(
        prisma.curtainMeasurement.create({
          data,
        }),
      );
    }

    /* ---------------- UPDATE CURTAIN ORDER WITH SHOP ID ---------------- */
    if (shopId && orderExists.ShopId !== shopId) {
      updateOperations.push(
        prisma.curtainOrder.update({
          where: { id: orderId },
          data: {
            ShopId: shopId,
            updatedAt: new Date(),
          },
        }),
      );
    }

    /* ---------------- EXECUTE ALL OPERATIONS IN TRANSACTION ---------------- */
    const allOperations = [...updateOperations, ...createOperations];
    let results = [];
    if (allOperations.length > 0) {
      results = await prisma.$transaction(allOperations);
    }

    // Separate measurement results
    const measurementResults = results.filter(
      (r) => r && r.roomName !== undefined,
    );

    /* ---------------- HANDLE ORDER TOTAL AMOUNT AND BALANCE UPDATE ---------------- */
    const totalAmountChange = totalPriceDifference + totalNewPrice;

    if (totalAmountChange !== 0) {
      // Get current order financial data
      const currentOrder = await prisma.curtainOrder.findUnique({
        where: { id: orderId },
        select: {
          totalAmount: true,
          totalPaid: true,
          balance: true,
        },
      });

      // Parse current total as number
      let currentTotal = 0;
      if (currentOrder?.totalAmount) {
        currentTotal =
          typeof currentOrder.totalAmount === 'string'
            ? parseFloat(currentOrder.totalAmount)
            : Number(currentOrder.totalAmount);
      }

      // Parse current total paid
      let currentTotalPaid = 0;
      if (currentOrder?.totalPaid) {
        currentTotalPaid =
          typeof currentOrder.totalPaid === 'string'
            ? parseFloat(currentOrder.totalPaid)
            : Number(currentOrder.totalPaid);
      }

      // Ensure currentTotal is a valid number
      if (isNaN(currentTotal)) {
        currentTotal = 0;
      }
      if (isNaN(currentTotalPaid)) {
        currentTotalPaid = 0;
      }

      const newTotal = currentTotal + totalAmountChange;

      // Calculate new balance = totalAmount - totalPaid
      const newBalance = newTotal - currentTotalPaid;

      // Validate that newTotal is within range
      if (newTotal > 99999999.99) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Total amount would exceed maximum allowed value',
        );
      }

      if (newTotal < 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Total amount cannot be negative',
        );
      }

      // Update both totalAmount and balance
      await prisma.curtainOrder.update({
        where: { id: orderId },
        data: {
          totalAmount: newTotal,
          balance: newBalance,
        },
      });
    } else {
      console.log('💰 No total price change, skipping order total update');
    }

    return {
      success: true,
      updatedCount: updateOperations.length,
      createdCount: createOperations.length,
      totalProcessed: measurementResults.length,
      measurements: measurementResults,
      totalPriceDifference,
      totalNewPrice,
      totalAmountChange,
    };
  } catch (error) {
    console.error('Message:', error.message);
    console.error('Full error:', error);
    throw error;
  }
};
module.exports = {
  // CurtainOrder
  bulkUpdateShatterVerticalMeasurements,
  getInvoiceReportByDate,
  markWorkerAsPaid,
  getWorkerPaymentReport,
  updateCurtainOrderDeliveryDeadline,
  updateCurtainOrderPayment,
  updateCurtainOrderStatus,
  updateCurtainOrderShop,
  createCurtainMeasurement,
  bulkUpdateCurtainMeasurements,
  getCurtainOrderById,
  getCurtainOrderByCriteria,
  createCurtainOrder,
  getAllCurtainOrders,
  updateCurtainOrder,
  deleteCurtainOrder,
  deleteCurtainMeasurement,
  getCurtainOrdersByCustomerId,
  getCurtainOrdersByCreatedBy,
  createsecondCurtainMeasurement,
  updatesecondCurtainOrderShop,
  getthikthinCurtainOrderById,
  getshatterCurtainOrderById,
  getPendingCurtainOrders,
  getCurtainOrdersByDeliveredBy,
};
