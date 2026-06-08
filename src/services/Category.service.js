const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

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
const STATIC_COLOURS = [
  'White',
  'Black',
  'Red',
  'Green',
  'Blue',
  'Yellow',
  'Orange',
  'Purple',
  'Pink',
  'Brown',
  'Gray',
  'Silver',
  'Gold',
  'Beige',
  'Cream',
];

// Create Colour
const createColour = async (colourBody) => {
  try {
    const existingColour = await getColourByName(colourBody.name);

    if (existingColour) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Colour name already exists');
    }

    const colour = await prisma.colour.create({
      data: colourBody,
    });

    // Get existing static colours
    const existingStaticColours = await prisma.colour.findMany({
      where: {
        name: {
          in: STATIC_COLOURS,
        },
      },
      select: {
        name: true,
      },
    });

    const existingColourNames = existingStaticColours.map((item) => item.name);

    // Find colours that don't exist yet
    const coloursToCreate = STATIC_COLOURS.filter(
      (colourName) => !existingColourNames.includes(colourName),
    ).map((colourName) => ({ 
      name: colourName,
      // Add any other required fields with default values
      // isActive: true,
      // createdAt: new Date(),
    }));

    // Create missing static colours if any
    if (coloursToCreate.length > 0) {
      console.log(`Creating ${coloursToCreate.length} missing static colours:`, 
        coloursToCreate.map(c => c.name));
      
      await prisma.colour.createMany({
        data: coloursToCreate,
        skipDuplicates: true,
      });
    }

    return colour;
  } catch (error) {
    console.error('Error in createColour:', error);
    throw error;
  }
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
 * Get top selling products by quantity and revenue
 * @param {Object} dateFilter - { startDate, endDate }
 * @returns {Promise<Object>} Top products data
 */
const getTopSellingProducts = async (dateFilter) => {
  const { startDate, endDate } = dateFilter;

  console.log('📊 Getting top selling products for date range:', {
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

  // Set end date to end of day
  endDateTime.setHours(23, 59, 59, 999);
  startDateTime.setHours(0, 0, 0, 0);

  if (startDateTime > endDateTime) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Start date cannot be after end date',
    );
  }

  try {
    // Fetch curtain measurements within date range
    const measurements = await prisma.curtainMeasurement.findMany({
      where: {
        createdAt: {
          gte: startDateTime,
          lte: endDateTime,
        },
      },
      include: {
        thickProduct: {
          select: {
            id: true,
            name: true,
            sellPrice: true,
          },
        },
        thinProduct: {
          select: {
            id: true,
            name: true,
            sellPrice: true,
          },
        },
        curtainPole: {
          select: {
            id: true,
            name: true,
            sellPrice: true,
          },
        },
        curtainPulls: {
          select: {
            id: true,
            name: true,
            sellPrice: true,
          },
        },
        curtainBrackets: {
          select: {
            id: true,
            name: true,
            sellPrice: true,
          },
        },
        shatterVerticalProduct: {
          select: {
            id: true,
            name: true,
            sellPrice: true,
          },
        },
      },
    });

    // Track product sales
    const productSales = new Map();

    measurements.forEach((measurement) => {
      // Thick curtains
      if (measurement.thickProductId && measurement.thickProduct) {
        const productKey = `thick_${measurement.thickProductId}`;
        if (!productSales.has(productKey)) {
          productSales.set(productKey, {
            id: measurement.thickProduct.id,
            name: `${measurement.thickProduct.name} (Thick Curtain)`,
            type: 'THICK_CURTAIN',
            quantity: 0,
            revenue: 0,
            meters: measurement.thickMeter || 0,
          });
        }
        const product = productSales.get(productKey);
        product.quantity += measurement.quantity || 1;
        product.revenue += measurement.thickPrice || 0;
        product.meters += measurement.thickMeter || 0;
      }

      // Thin curtains
      if (measurement.thinProductId && measurement.thinProduct) {
        const productKey = `thin_${measurement.thinProductId}`;
        if (!productSales.has(productKey)) {
          productSales.set(productKey, {
            id: measurement.thinProduct.id,
            name: `${measurement.thinProduct.name} (Thin Curtain)`,
            type: 'THIN_CURTAIN',
            quantity: 0,
            revenue: 0,
            meters: measurement.thinMeter || 0,
          });
        }
        const product = productSales.get(productKey);
        product.quantity += measurement.quantity || 1;
        product.revenue += measurement.thinPrice || 0;
        product.meters += measurement.thinMeter || 0;
      }

      // Curtain Poles
      if (measurement.curtainPoleId && measurement.curtainPole) {
        const productKey = `pole_${measurement.curtainPoleId}`;
        if (!productSales.has(productKey)) {
          productSales.set(productKey, {
            id: measurement.curtainPole.id,
            name: measurement.curtainPole.name,
            type: 'CURTAIN_POLE',
            quantity: 0,
            revenue: 0,
            meters: 0,
          });
        }
        const product = productSales.get(productKey);
        product.quantity += measurement.curtainPoleQuantity || 1;
        product.revenue +=
          (measurement.curtainPolePrice || 0) *
          (measurement.curtainPoleQuantity || 1);
      }

      // Curtain Pulls
      if (measurement.curtainPullsId && measurement.curtainPulls) {
        const productKey = `pulls_${measurement.curtainPullsId}`;
        if (!productSales.has(productKey)) {
          productSales.set(productKey, {
            id: measurement.curtainPulls.id,
            name: measurement.curtainPulls.name,
            type: 'CURTAIN_PULLS',
            quantity: 0,
            revenue: 0,
            meters: 0,
          });
        }
        const product = productSales.get(productKey);
        product.quantity += measurement.curtainPullsQuantity || 1;
        product.revenue += measurement.curtainPullsBracketsPrice || 0;
      }

      // Curtain Brackets
      if (measurement.curtainBracketsId && measurement.curtainBrackets) {
        const productKey = `brackets_${measurement.curtainBracketsId}`;
        if (!productSales.has(productKey)) {
          productSales.set(productKey, {
            id: measurement.curtainBrackets.id,
            name: measurement.curtainBrackets.name,
            type: 'CURTAIN_BRACKETS',
            quantity: 0,
            revenue: 0,
            meters: 0,
          });
        }
        const product = productSales.get(productKey);
        product.quantity += measurement.curtainBracketsQuantity || 1;
        product.revenue += measurement.curtainPullsBracketsPrice || 0;
      }

      // Shatter Vertical Products
      if (
        measurement.shatterVerticalProductId &&
        measurement.shatterVerticalProduct
      ) {
        const productKey = `shatter_${measurement.shatterVerticalProductId}`;
        if (!productSales.has(productKey)) {
          productSales.set(productKey, {
            id: measurement.shatterVerticalProduct.id,
            name: measurement.shatterVerticalProduct.name,
            type: 'SHATTER_VERTICAL',
            quantity: 0,
            revenue: 0,
            meters: 0,
          });
        }
        const product = productSales.get(productKey);
        product.quantity += measurement.quantity || 1;
        product.revenue += measurement.price || 0;
      }
    });

    // Convert to array and sort
    const productsArray = Array.from(productSales.values());

    // Top by quantity
    const topByQuantity = [...productsArray]
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    // Top by revenue
    const topByRevenue = [...productsArray]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Top by meters (for fabric products)
    const topByMeters = [...productsArray]
      .filter((p) => p.meters > 0)
      .sort((a, b) => b.meters - a.meters)
      .slice(0, 10);

    return {
      topByQuantity,
      topByRevenue,
      topByMeters,
      summary: {
        totalProductsSold: productsArray.reduce(
          (sum, p) => sum + p.quantity,
          0,
        ),
        totalRevenue: productsArray.reduce((sum, p) => sum + p.revenue, 0),
        uniqueProducts: productsArray.length,
      },
    };
  } catch (error) {
    console.error('Error getting top selling products:', error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to get top selling products',
    );
  }
};

/**
 * Get top tailors (workers) by meters worked
 * @param {Object} dateFilter - { startDate, endDate }
 * @returns {Promise<Object>} Top tailors data
 */
const getTopTailorsByMeters = async (dateFilter) => {
  const { startDate, endDate } = dateFilter;

  console.log('📊 Getting top tailors by meters for date range:', {
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

  endDateTime.setHours(23, 59, 59, 999);
  startDateTime.setHours(0, 0, 0, 0);

  if (startDateTime > endDateTime) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Start date cannot be after end date',
    );
  }

  try {
    // Fetch measurements with worker info within date range
    const measurements = await prisma.curtainMeasurement.findMany({
      where: {
        createdAt: {
          gte: startDateTime,
          lte: endDateTime,
        },
      },
      include: {
        thickWorker: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        thinWorker: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Track tailor (worker) performance
    const tailorStats = new Map();

    measurements.forEach((measurement) => {
      // Thick worker
      if (measurement.thickWorkerId && measurement.thickWorker) {
        const workerKey = measurement.thickWorkerId;
        if (!tailorStats.has(workerKey)) {
          tailorStats.set(workerKey, {
            id: measurement.thickWorker.id,
            name: measurement.thickWorker.name,
            email: measurement.thickWorker.email,
            totalMeters: 0,
            totalWorkerMeter: 0,
            totalOrders: 0,
            totalEarnings: 0,
            thickMeters: 0,
            thinMeters: 0,
          });
        }
        const worker = tailorStats.get(workerKey);
        worker.totalMeters += measurement.thickMeter || 0;
        worker.totalWorkerMeter += measurement.totalWorkerMeter || 0;
        worker.totalOrders += 1;
        worker.totalEarnings += measurement.thickWorkerPaidAmount || 0;
        worker.thickMeters += measurement.thickMeter || 0;
      }

      // Thin worker
      if (measurement.thinWorkerId && measurement.thinWorker) {
        const workerKey = measurement.thinWorkerId;
        if (!tailorStats.has(workerKey)) {
          tailorStats.set(workerKey, {
            id: measurement.thinWorker.id,
            name: measurement.thinWorker.name,
            email: measurement.thinWorker.email,
            totalMeters: 0,
            totalWorkerMeter: 0,
            totalOrders: 0,
            totalEarnings: 0,
            thickMeters: 0,
            thinMeters: 0,
          });
        }
        const worker = tailorStats.get(workerKey);
        worker.totalMeters += measurement.thinMeter || 0;
        worker.totalWorkerMeter += measurement.totalWorkerMeter || 0;
        worker.totalOrders += 1;
        worker.totalEarnings += measurement.thinWorkerPaidAmount || 0;
        worker.thinMeters += measurement.thinMeter || 0;
      }
    });

    // Convert to array and sort
    const tailorsArray = Array.from(tailorStats.values());

    // Top by total meters
    const topByTotalMeters = [...tailorsArray]
      .sort((a, b) => b.totalMeters - a.totalMeters)
      .slice(0, 10);

    // Top by worker meter (complexity adjusted meters)
    const topByWorkerMeter = [...tailorsArray]
      .sort((a, b) => b.totalWorkerMeter - a.totalWorkerMeter)
      .slice(0, 10);

    // Top by earnings
    const topByEarnings = [...tailorsArray]
      .sort((a, b) => b.totalEarnings - a.totalEarnings)
      .slice(0, 10);

    // Top by orders completed
    const topByOrders = [...tailorsArray]
      .sort((a, b) => b.totalOrders - a.totalOrders)
      .slice(0, 10);

    return {
      topByTotalMeters,
      topByWorkerMeter,
      topByEarnings,
      topByOrders,
      summary: {
        totalTailors: tailorsArray.length,
        totalMetersAllTailors: tailorsArray.reduce(
          (sum, t) => sum + t.totalMeters,
          0,
        ),
        totalEarningsAllTailors: tailorsArray.reduce(
          (sum, t) => sum + t.totalEarnings,
          0,
        ),
        totalOrdersAllTailors: tailorsArray.reduce(
          (sum, t) => sum + t.totalOrders,
          0,
        ),
      },
    };
  } catch (error) {
    console.error('Error getting top tailors:', error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to get top tailors',
    );
  }
};

/**
 * Get worker logs with meter completions
 * @param {Object} dateFilter - { startDate, endDate }
 * @returns {Promise<Object>} Worker log performance
 */
const getWorkerLogPerformance = async (dateFilter) => {
  const { startDate, endDate } = dateFilter;

  if (!startDate || !endDate) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Start date and end date are required',
    );
  }

  const startDateTime = new Date(startDate);
  const endDateTime = new Date(endDate);
  endDateTime.setHours(23, 59, 59, 999);
  startDateTime.setHours(0, 0, 0, 0);

  try {
    const workerLogs = await prisma.curtainWorkerLog.findMany({
      where: {
        createdAt: {
          gte: startDateTime,
          lte: endDateTime,
        },
      },
      include: {
        worker: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        curtainMeasurement: {
          select: {
            roomName: true,
          },
        },
      },
    });

    const workerStats = new Map();

    workerLogs.forEach((log) => {
      if (!log.workerId || !log.worker) return;

      if (!workerStats.has(log.workerId)) {
        workerStats.set(log.workerId, {
          id: log.worker.id,
          name: log.worker.name,
          email: log.worker.email,
          totalWidthAssigned: 0,
          totalWidthCompleted: 0,
          totalHeightAssigned: 0,
          totalHeightCompleted: 0,
          totalQuantityAssigned: 0,
          totalQuantityCompleted: 0,
          totalExtraWidthAssigned: 0,
          totalExtraWidthCompleted: 0,
          completionRate: 0,
          logsCount: 0,
        });
      }

      const stats = workerStats.get(log.workerId);
      stats.totalWidthAssigned += log.widthmeterAssigned || 0;
      stats.totalWidthCompleted += log.widthmeterCompleted || 0;
      stats.totalHeightAssigned += log.heightmeterAssigned || 0;
      stats.totalHeightCompleted += log.heightmeterCompleted || 0;
      stats.totalQuantityAssigned += log.quantityAssigned || 0;
      stats.totalQuantityCompleted += log.quantityCompleted || 0;
      stats.totalExtraWidthAssigned += log.extrawidthAssigned || 0;
      stats.totalExtraWidthCompleted += log.extrawidthCompleted || 0;
      stats.logsCount += 1;
    });

    // Calculate completion rates
    const workersArray = Array.from(workerStats.values()).map((worker) => ({
      ...worker,
      widthCompletionRate:
        worker.totalWidthAssigned > 0
          ? Math.round(
              (worker.totalWidthCompleted / worker.totalWidthAssigned) * 100,
            )
          : 0,
      heightCompletionRate:
        worker.totalHeightAssigned > 0
          ? Math.round(
              (worker.totalHeightCompleted / worker.totalHeightAssigned) * 100,
            )
          : 0,
      quantityCompletionRate:
        worker.totalQuantityAssigned > 0
          ? Math.round(
              (worker.totalQuantityCompleted / worker.totalQuantityAssigned) *
                100,
            )
          : 0,
    }));

    // Top by width completed
    const topByWidthCompleted = [...workersArray]
      .sort((a, b) => b.totalWidthCompleted - a.totalWidthCompleted)
      .slice(0, 10);

    // Top by completion rate
    const topByCompletionRate = [...workersArray]
      .filter((w) => w.logsCount > 2) // At least 3 logs for reliable rate
      .sort((a, b) => b.widthCompletionRate - a.widthCompletionRate)
      .slice(0, 10);

    return {
      topByWidthCompleted,
      topByCompletionRate,
      allWorkers: workersArray,
      summary: {
        totalWorkers: workersArray.length,
        totalWidthCompleted: workersArray.reduce(
          (sum, w) => sum + w.totalWidthCompleted,
          0,
        ),
        totalQuantityCompleted: workersArray.reduce(
          (sum, w) => sum + w.totalQuantityCompleted,
          0,
        ),
        totalLogs: workerLogs.length,
      },
    };
  } catch (error) {
    console.error('Error getting worker log performance:', error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to get worker log performance',
    );
  }
};

/**
 * Complete dashboard analytics for top performers
 * @param {Object} dateFilter - { startDate, endDate }
 * @returns {Promise<Object>} Complete top performers data
 */
const getTopPerformersDashboard = async (dateFilter) => {
  const { startDate, endDate } = dateFilter;

  console.log('📊 Getting top performers dashboard for date range:', {
    startDate,
    endDate,
  });

  try {
    const [topProducts, topTailors, workerPerformance] = await Promise.all([
      getTopSellingProducts(dateFilter),
      getTopTailorsByMeters(dateFilter),
      getWorkerLogPerformance(dateFilter),
    ]);

    // Additional metrics
    const [totalOrders, totalCustomers] = await Promise.all([
      prisma.curtainOrder.count({
        where: {
          createdAt: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        },
      }),
      prisma.customer.count({
        where: {
          createdAt: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        },
      }),
    ]);

    return {
      dateRange: {
        startDate,
        endDate,
      },
      products: topProducts,
      tailors: topTailors,
      workerPerformance,
      additionalMetrics: {
        totalOrders,
        totalCustomers,
      },
    };
  } catch (error) {
    console.error('Error getting top performers dashboard:', error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to get top performers dashboard',
    );
  }
};

module.exports = {
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
  getTopSellingProducts,
  getTopTailorsByMeters,
  getWorkerLogPerformance,
  getTopPerformersDashboard,
};
