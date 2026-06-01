const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { curtainService } = require('../services'); // Assuming you'll name it curtainService
const ApiError = require('../utils/ApiError');

// Create Curtain Order
const createCurtainOrder = catchAsync(async (req, res) => {
  const createdById = req.user?.id; // Get user ID from authenticated request
  const curtainOrder = await curtainService.createCurtainOrder(
    req.body,
    createdById,
  );

  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Curtain order created successfully',
    curtainOrder,
  });
});

// Get Curtain Order by ID getthikthinCurtainOrderById,getshatterCurtainOrderById
const getthikthinCurtainOrderById = catchAsync(async (req, res) => {
  const curtainOrder = await curtainService.getthikthinCurtainOrderById(
    req.params.id,
  );

  if (!curtainOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Curtain order not found');
  }

  res.status(httpStatus.OK).send({
    success: true,
    curtainOrder,
  });
});
const getshatterCurtainOrderById = catchAsync(async (req, res) => {
  const curtainOrder = await curtainService.getshatterCurtainOrderById(
    req.params.id,
  );

  if (!curtainOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Curtain order not found');
  }

  res.status(httpStatus.OK).send({
    success: true,
    curtainOrder,
  });
});
const getPendingCurtainOrdersController = catchAsync(async (req, res) => {
  const curtainOrders = await curtainService.getPendingCurtainOrders();

  if (!curtainOrders || curtainOrders.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, 'No pending curtain orders found');
  }

  res.status(httpStatus.OK).send({
    success: true,
    curtainOrders,
  });
});

const getCurtainOrder = catchAsync(async (req, res) => {
  const curtainOrder = await curtainService.getCurtainOrderById(req.params.id);

  if (!curtainOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Curtain order not found');
  }

  res.status(httpStatus.OK).send({
    success: true,
    curtainOrder,
  });
});
const createCurtainMeasurement = catchAsync(async (req, res) => {
  const { orderId } = req.params;
  const { measurements, shopId } = req.body; // ADDED: shopId from request body
  const createdById = req.user?.id;

  if (!orderId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Order ID is required');
  }

  if (!Array.isArray(measurements) || measurements.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Measurements must be a non-empty array',
    );
  }

  // Pass shopId to the service
  const createdMeasurements = await curtainService.createCurtainMeasurement(
    orderId,
    measurements,
    createdById,
    shopId, // ADDED: pass shopId to service
  );

  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Curtain measurements created successfully',
    measurements: createdMeasurements,
  });
});
const bulkUpdateCurtainMeasurements = catchAsync(async (req, res) => {
  const { orderId } = req.params;
  const { measurements, shopId } = req.body;
  const updatedById = req.user?.id;

  if (!orderId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Order ID is required');
  }

  if (!Array.isArray(measurements) || measurements.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Measurements must be a non-empty array',
    );
  }

  // Validate each measurement item
  for (let i = 0; i < measurements.length; i++) {
    const measurement = measurements[i];

    // Validate that each item has curtainMeasurementData
    if (!measurement.curtainMeasurementData) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Curtain measurement data is required for item at index ${i}`,
      );
    }

    // Validate that curtainMeasurementData is not empty
    if (
      Array.isArray(measurement.curtainMeasurementData) &&
      measurement.curtainMeasurementData.length === 0
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Measurement data cannot be empty array for item at index ${i}`,
      );
    }

    if (
      !Array.isArray(measurement.curtainMeasurementData) &&
      typeof measurement.curtainMeasurementData === 'object' &&
      Object.keys(measurement.curtainMeasurementData).length === 0
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Measurement data cannot be empty object for item at index ${i}`,
      );
    }

    // measurementId is now optional - only validate format if provided
    if (
      measurement.measurementId &&
      typeof measurement.measurementId !== 'string'
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Measurement ID must be a string for item at index ${i}`,
      );
    }
  }

  // Transform measurements array to match service function signature
  // measurementId is optional - if not provided, it will create a new measurement
  const measurementsDataArray = measurements.map((measurement) => ({
    measurementId: measurement.measurementId, // May be undefined for new measurements
    curtainMeasurementData: measurement.curtainMeasurementData,
  }));

  // Call the service function
  const result = await curtainService.bulkUpdateCurtainMeasurements(
    measurementsDataArray,
    orderId,
    updatedById,
    shopId,
  );

  // Prepare success message based on what was done
  let message = '';
  if (result.createdCount > 0 && result.updatedCount > 0) {
    message = `Successfully created ${result.createdCount} and updated ${result.updatedCount} curtain measurements`;
  } else if (result.createdCount > 0) {
    message = `Successfully created ${result.createdCount} curtain measurements`;
  } else if (result.updatedCount > 0) {
    message = `Successfully updated ${result.updatedCount} curtain measurements`;
  } else {
    message = 'No changes were made to curtain measurements';
  }

  // Add price change information to message if applicable
  if (result.totalAmountChange !== 0) {
    const changeDirection =
      result.totalAmountChange > 0 ? 'increased' : 'decreased';
    const changeAmount = Math.abs(result.totalAmountChange);
    message += `. Order total ${changeDirection} by ${changeAmount}`;
  }

  res.status(httpStatus.OK).send({
    success: true,
    message,
    data: {
      updatedCount: result.updatedCount,
      createdCount: result.createdCount,
      totalProcessed: result.totalProcessed,
      measurements: result.measurements,
      totalPriceDifference: result.totalPriceDifference,
      totalNewPrice: result.totalNewPrice,
      totalAmountChange: result.totalAmountChange,
    },
  });
});
/**
 * Update curtain measurements by order ID
 * (handles create, update, and delete internally) createsecondCurtainMeasurement,
  updatesecondCurtainOrderShop,
 */
const updateCurtainOrderShop = catchAsync(async (req, res) => {
  const { orderId } = req.params;
  const { measurements } = req.body;

  if (!orderId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Order ID is required');
  }

  const result = await curtainService.updateCurtainOrderShop(
    orderId,
    measurements,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Curtain measurements updated successfully',
    result,
  });
});

// Get all Curtain Orders
const getCurtainOrders = catchAsync(async (req, res) => {
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
  } = req.query;

  const options = {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    search,
    customerId,
    movementTypeId,
    isSiteMeasured: (() => {
      if (isSiteMeasured === 'true') return true;
      if (isSiteMeasured === 'false') return false;
      return undefined;
    })(),
    startDate,
    endDate,
    includeItems: includeItems === 'true',
  };

  const result = await curtainService.getAllCurtainOrders(options);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Update Curtain Order
const updateCurtainOrder = catchAsync(async (req, res) => {
  const curtainOrder = await curtainService.updateCurtainOrder(
    req.params.id,
    req.body,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Curtain order updated successfully',
    curtainOrder,
  });
});

// Delete Curtain Order
const deleteCurtainOrder = catchAsync(async (req, res) => {
  await curtainService.deleteCurtainOrder(req.params.id);

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Curtain order deleted successfully',
  });
});
const deleteCurtainMeasurement = catchAsync(async (req, res) => {
  await curtainService.deleteCurtainMeasurement(req.params.id);

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Curtain measurement deleted successfully',
  });
});

// Get Curtain Orders by Customer ID
const getCurtainOrdersByCustomer = catchAsync(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const { customerId } = req.params;

  const options = {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  };

  const result = await curtainService.getCurtainOrdersByCustomerId(
    customerId,
    options,
  );

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Get Curtain Orders by Created By (User ID)
const getCurtainOrdersByCreator = catchAsync(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const { userId } = req.params;

  const options = {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  };

  const result = await curtainService.getCurtainOrdersByCreatedBy(
    userId,
    options,
  );

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Get My Curtain Orders (orders created by current user)
const getMyCurtainOrders = catchAsync(async (req, res) => {
  const userId = req.user?.id;
  const { page = 1, limit = 10 } = req.query;

  if (!userId) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'User not authenticated');
  }

  const options = {
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  };

  const result = await curtainService.getCurtainOrdersByCreatedBy(
    userId,
    options,
  );

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Search Curtain Orders by criteria
const searchCurtainOrders = catchAsync(async (req, res) => {
  const curtainOrders = await curtainService.getCurtainOrderByCriteria(
    req.query,
  );

  let curtainOrdersArray;
  let count;
  if (Array.isArray(curtainOrders)) {
    curtainOrdersArray = curtainOrders;
    count = curtainOrders.length;
  } else if (curtainOrders) {
    curtainOrdersArray = [curtainOrders];
    count = 1;
  } else {
    curtainOrdersArray = [];
    count = 0;
  }

  res.status(httpStatus.OK).send({
    success: true,
    curtainOrders: curtainOrdersArray,
    count,
  });
});
const createsecondCurtainMeasurement = catchAsync(async (req, res) => {
  const { orderId } = req.params;
  const { measurements, shopId } = req.body; // ADDED: shopId from request body
  const createdById = req.user?.id;

  if (!orderId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Order ID is required');
  }

  if (!Array.isArray(measurements) || measurements.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Measurements must be a non-empty array',
    );
  }

  // Pass shopId to the service createsecondCurtainMeasurement,updatesecondCurtainOrderShop
  const createdMeasurements =
    await curtainService.createsecondCurtainMeasurement(
      orderId,
      measurements,
      createdById,
      shopId, // ADDED: pass shopId to service
    );

  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Curtain measurements created successfully',
    measurements: createdMeasurements,
  });
});

/**
 * Update curtain measurements by order ID
 * (handles create, update, and delete internally) createsecondCurtainMeasurement,
  updatesecondCurtainOrderShop,
 */
const updatesecondCurtainOrderShop = catchAsync(async (req, res) => {
  const { orderId } = req.params;
  const { measurements, shopId } = req.body;
  if (!orderId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Order ID is required');
  }

  const result = await curtainService.updatesecondCurtainOrderShop(
    orderId,
    measurements,
    shopId,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Curtain measurements updated successfully',
    result,
  });
});

const updateCurtainOrderPaymentController = catchAsync(async (req, res) => {
  const { orderId } = req.params;

  const { amount, paymentMethod, note, paymentDate } = req.body;

  const updatedById = req.user?.id || null;

  const updatedOrder = await curtainService.updateCurtainOrderPayment(
    orderId,
    {
      amount,
      paymentMethod,
      note,
      paymentDate,
    },
    updatedById,
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Curtain order payment updated successfully',
    data: updatedOrder,
  });
});
const getInvoiceReportController = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  // Validate query parameters
  if (!startDate || !endDate) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Start date and end date are required',
    );
  }

  // Get the report data from service
  const reportData = await curtainService.getInvoiceReportByDate({
    startDate,
    endDate,
  });

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Invoice report generated successfully',
    data: reportData,
  });
});
const bulkUpdateShatterVerticalMeasurementsController = catchAsync(
  async (req, res) => {
    const { orderId } = req.params;
    const { measurements, shopId } = req.body;
    const updatedById = req.user?.id;

    if (!orderId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Order ID is required');
    }

    if (!Array.isArray(measurements) || measurements.length === 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Measurements must be a non-empty array',
      );
    }

    // Validate each measurement item
    for (let i = 0; i < measurements.length; i++) {
      const measurement = measurements[i];

      // Validate that each item has curtainMeasurementData
      if (!measurement.curtainMeasurementData) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Curtain measurement data is required for item at index ${i}`,
        );
      }

      // Validate that curtainMeasurementData is not empty
      if (
        Array.isArray(measurement.curtainMeasurementData) &&
        measurement.curtainMeasurementData.length === 0
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Measurement data cannot be empty array for item at index ${i}`,
        );
      }

      if (
        !Array.isArray(measurement.curtainMeasurementData) &&
        typeof measurement.curtainMeasurementData === 'object' &&
        Object.keys(measurement.curtainMeasurementData).length === 0
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Measurement data cannot be empty object for item at index ${i}`,
        );
      }

      // Validate required fields for shatter vertical measurements
      const measurementData = Array.isArray(measurement.curtainMeasurementData)
        ? measurement.curtainMeasurementData[0]
        : measurement.curtainMeasurementData;

      // Required fields validation for shatter vertical measurements
      if (!measurementData.roomName) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Room name is required for measurement at index ${i}`,
        );
      }

      if (
        measurementData.width === undefined ||
        measurementData.width === null
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Width is required for measurement at index ${i}`,
        );
      }

      if (
        measurementData.height === undefined ||
        measurementData.height === null
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Height is required for measurement at index ${i}`,
        );
      }

      // Validate numeric values
      const numericWidth = parseFloat(measurementData.width);
      const numericHeight = parseFloat(measurementData.height);

      if (isNaN(numericWidth) || numericWidth <= 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Invalid width value for measurement at index ${i}. Width must be a positive number.`,
        );
      }

      if (isNaN(numericHeight) || numericHeight <= 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Invalid height value for measurement at index ${i}. Height must be a positive number.`,
        );
      }

      // measurementId is optional - only validate format if provided
      if (
        measurement.measurementId &&
        typeof measurement.measurementId !== 'string'
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Measurement ID must be a string for item at index ${i}`,
        );
      }
    }

    // Transform measurements array to match service function signature
    // measurementId is optional - if not provided, it will create a new measurement
    const measurementsDataArray = measurements.map((measurement) => ({
      measurementId: measurement.measurementId, // May be undefined for new measurements
      curtainMeasurementData: measurement.curtainMeasurementData,
    }));

    // Call the service function
    const result = await curtainService.bulkUpdateShatterVerticalMeasurements(
      measurementsDataArray,
      orderId,
      updatedById,
      shopId,
    );

    // Prepare success message based on what was done
    let message = '';
    if (result.createdCount > 0 && result.updatedCount > 0) {
      message = `Successfully created ${result.createdCount} and updated ${result.updatedCount} shatter vertical curtain measurements`;
    } else if (result.createdCount > 0) {
      message = `Successfully created ${result.createdCount} shatter vertical curtain measurements`;
    } else if (result.updatedCount > 0) {
      message = `Successfully updated ${result.updatedCount} shatter vertical curtain measurements`;
    } else {
      message = 'No changes were made to shatter vertical curtain measurements';
    }

    // Add price change information to message if applicable
    if (result.totalAmountChange !== 0) {
      const changeDirection =
        result.totalAmountChange > 0 ? 'increased' : 'decreased';
      const changeAmount = Math.abs(result.totalAmountChange);
      message += `. Order total ${changeDirection} by ${changeAmount}`;
    }

    res.status(httpStatus.OK).send({
      success: true,
      message,
      data: {
        updatedCount: result.updatedCount,
        createdCount: result.createdCount,
        totalProcessed: result.totalProcessed,
        measurements: result.measurements,
        totalPriceDifference: result.totalPriceDifference,
        totalNewPrice: result.totalNewPrice,
        totalAmountChange: result.totalAmountChange,
      },
    });
  },
);
/**
 * Update curtain order status
 * PATCH /api/curtain/orders/:orderId/status
 */
const updateCurtainOrderStatusController = catchAsync(async (req, res) => {
  const { orderId } = req.params;

  const {
    curtainStatus,
    paymentStatus,
    curtainstatusnote,
    deliveredById,
    curtainRodCuttings, // NEW: Accept array of curtain rod cuttings
  } = req.body;

  const updatedById = req.user?.id || null;

  const updatedOrder = await curtainService.updateCurtainOrderStatus(
    orderId,
    {
      curtainStatus,
      paymentStatus,
      curtainstatusnote,
      deliveredById,
      curtainRodCuttings, // Pass to service
    },
    updatedById,
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Curtain order status updated successfully',
    data: updatedOrder,
  });
});
const updateCurtainOrderDeliveryDeadlineController = catchAsync(
  async (req, res) => {
    const { orderId } = req.params;
    const { deliveryDeadline } = req.body;
    const updatedById = req.user?.id || null;

    // Validate required field
    if (!deliveryDeadline) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Delivery deadline is required',
      );
    }

    const updatedOrder =
      await curtainService.updateCurtainOrderDeliveryDeadline(
        orderId,
        deliveryDeadline,
        updatedById,
      );

    res.status(httpStatus.OK).json({
      success: true,
      message: 'Delivery deadline updated successfully',
      data: updatedOrder,
    });
  },
);
const getWorkerPaymentReportController = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  // Filters can come from query or body
  const filters = req.body?.filters || {};

  const userId = req.user?.id || null;

  // Validate required fields
  if (!startDate || !endDate) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Start date and end date are required',
    );
  }

  const report = await curtainService.getWorkerPaymentReport(
    startDate,
    endDate,
    filters,
    userId,
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Worker payment report generated successfully',
    data: report,
  });
});
const markWorkerAsPaidController = catchAsync(async (req, res) => {
  const { measurementId } = req.params;
  const { workerType } = req.body; // 'THIN' or 'THICK'
  const paidById = req.user?.id || null;

  // Validate required fields
  if (!measurementId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Measurement ID is required');
  }

  if (!workerType) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Worker type is required (THIN or THICK)',
    );
  }

  const updatedMeasurement = await curtainService.markWorkerAsPaid(
    measurementId,
    workerType,
    paidById,
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Worker marked as paid successfully',
    data: updatedMeasurement,
  });
});
// In your curtain.controller.js
const getCurtainOrdersByDeliveredByController = catchAsync(async (req, res) => {
  const userId = req.user?.id;
  console.log('Authenticated user ID:', userId); // Debug log to check user ID
  if (!userId) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'User not authenticated');
  }

  const result = await curtainService.getCurtainOrdersByDeliveredBy(userId);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

module.exports = {
  getCurtainOrdersByDeliveredByController,
  getInvoiceReportController,
  getPendingCurtainOrdersController,
  markWorkerAsPaidController,
  getWorkerPaymentReportController,
  updateCurtainOrderPaymentController,
  updateCurtainOrderStatusController,
  createCurtainOrder,
  getCurtainOrder,
  getthikthinCurtainOrderById,
  getshatterCurtainOrderById,
  getCurtainOrders,
  updateCurtainOrder,
  deleteCurtainOrder,
  deleteCurtainMeasurement,
  getCurtainOrdersByCustomer,
  getCurtainOrdersByCreator,
  getMyCurtainOrders,
  searchCurtainOrders,
  updateCurtainOrderShop,
  createCurtainMeasurement,
  bulkUpdateCurtainMeasurements,
  createsecondCurtainMeasurement,
  updatesecondCurtainOrderShop,
  updateCurtainOrderDeliveryDeadlineController,
  bulkUpdateShatterVerticalMeasurementsController,
};
