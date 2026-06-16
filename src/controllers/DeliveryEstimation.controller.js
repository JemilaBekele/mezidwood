/* eslint-disable no-nested-ternary */
const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { deliveryEstimationService } = require('../services');

// Create Delivery Estimation
const createDeliveryEstimation = catchAsync(async (req, res) => {
  const estimationData = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(httpStatus.UNAUTHORIZED).json({
      success: false,
      error: 'User authentication required',
    });
  }

  const estimation = await deliveryEstimationService.createDeliveryEstimation(
    estimationData,
    userId,
  );

  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Delivery estimation created successfully',
    data: estimation,
  });
});

// Get all Delivery Estimations
const getDeliveryEstimations = catchAsync(async (req, res) => {
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
  } = req.query;

  const filters = {
    ...(status && { status }),
    ...(difficulty && { difficulty }),
    ...(customerName && { customerName }),
    ...((startDate || endDate) && { startDate, endDate }),
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    sortBy,
    sortOrder,
  };

  const result = await deliveryEstimationService.getAllDeliveryEstimations(
    filters,
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Delivery estimations retrieved successfully',
    ...result,
  });
});
const getAllOnHoldDeliveryEstimations = catchAsync(async (req, res) => {
  const result =
    await deliveryEstimationService.getAllOnHoldDeliveryEstimations();

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Delivery estimations retrieved successfully',
    ...result,
  });
});

// Get Delivery Estimation by ID
const getDeliveryEstimation = catchAsync(async (req, res) => {
  const { id } = req.params;

  const estimation = await deliveryEstimationService.getDeliveryEstimationById(
    id,
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Delivery estimation retrieved successfully',
    data: estimation,
  });
});

// Update Delivery Estimation
const updateDeliveryEstimation = catchAsync(async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(httpStatus.UNAUTHORIZED).json({
      success: false,
      error: 'User authentication required',
    });
  }

  const estimation = await deliveryEstimationService.updateDeliveryEstimation(
    id,
    updateData,
    userId,
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Delivery estimation updated successfully',
    data: estimation,
  });
});

// Delete Delivery Estimation
const deleteDeliveryEstimation = catchAsync(async (req, res) => {
  const { id } = req.params;

  await deliveryEstimationService.deleteDeliveryEstimation(id);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Delivery estimation deleted successfully',
  });
});

// Update Delivery Estimation Status
const updateEstimationStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(httpStatus.UNAUTHORIZED).json({
      success: false,
      error: 'User authentication required',
    });
  }

  if (!status) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      error: 'Status is required',
    });
  }

  const estimation =
    await deliveryEstimationService.updateDeliveryEstimationStatus(
      id,
      status,
      userId,
    );

  res.status(httpStatus.OK).json({
    success: true,
    message: `Delivery estimation status updated to ${status}`,
    data: estimation,
  });
});

// Put Delivery Estimation on Hold
const putEstimationOnHold = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { holdUntil } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(httpStatus.UNAUTHORIZED).json({
      success: false,
      error: 'User authentication required',
    });
  }

  if (!holdUntil) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      error: 'Hold until date is required',
    });
  }

  const estimation =
    await deliveryEstimationService.putDeliveryEstimationOnHold(
      id,
      holdUntil,
      userId,
    );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Delivery estimation placed on hold',
    data: estimation,
  });
});

// Confirm Delivery Estimation
const confirmEstimation = catchAsync(async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(httpStatus.UNAUTHORIZED).json({
      success: false,
      error: 'User authentication required',
    });
  }

  const estimation = await deliveryEstimationService.confirmDeliveryEstimation(
    id,
    userId,
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Delivery estimation confirmed successfully',
    data: estimation,
  });
});

// Get Delivery Estimations by Status
const getEstimationsByStatus = catchAsync(async (req, res) => {
  const { status } = req.params;

  if (!status) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      error: 'Status parameter is required',
    });
  }

  const result = await deliveryEstimationService.getDeliveryEstimationsByStatus(
    status,
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: `Delivery estimations with status ${status} retrieved successfully`,
    ...result,
  });
});

// Search Delivery Estimations by Customer Name
const searchEstimationsByCustomer = catchAsync(async (req, res) => {
  const { name } = req.query;

  if (!name || name.trim().length === 0) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      error: 'Search query parameter "name" is required',
    });
  }

  const filters = {
    customerName: name.trim(),
  };

  const result = await deliveryEstimationService.getAllDeliveryEstimations(
    filters,
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: `Search results for customer name: ${name}`,
    ...result,
  });
});

// Expire Old Estimations (Admin/System endpoint)
const expireOldEstimations = catchAsync(async (req, res) => {
  // Optional: Add admin check if needed
  // if (!req.user?.isAdmin) {
  //   return res.status(httpStatus.FORBIDDEN).json({
  //     success: false,
  //     error: 'Admin access required',
  //   });
  // }

  const result = await deliveryEstimationService.expireOldEstimations();

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Old estimations expired successfully',
    ...result,
  });
});

// Get Delivery Estimations Statistics
const getEstimationStatistics = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  // Get all estimations for the period
  const filters = {
    ...(startDate || endDate ? { startDate, endDate } : {}),
    limit: 1000, // High limit to get all data for statistics
  };

  const { estimations } =
    await deliveryEstimationService.getAllDeliveryEstimations(filters);

  // Calculate statistics
  const stats = {
    total: estimations.length,
    byStatus: {},
    byDifficulty: {},
    averageQuantity: 0,
    averageEstimatedDays: 0,
    totalQuantity: 0,
  };

  if (estimations.length > 0) {
    let totalQuantitySum = 0;
    let totalDaysSum = 0;

    estimations.forEach((estimation) => {
      // Status statistics
      stats.byStatus[estimation.status] =
        (stats.byStatus[estimation.status] || 0) + 1;

      // Difficulty statistics
      stats.byDifficulty[estimation.difficulty] =
        (stats.byDifficulty[estimation.difficulty] || 0) + 1;

      // Sum for averages
      totalQuantitySum += estimation.totalQuantity;
      totalDaysSum += estimation.estimatedDays;
    });

    stats.totalQuantity = totalQuantitySum;
    stats.averageQuantity = Math.round(totalQuantitySum / estimations.length);
    stats.averageEstimatedDays = Math.round(totalDaysSum / estimations.length);
  }

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Delivery estimation statistics retrieved successfully',
    data: stats,
    period: {
      startDate,
      endDate,
    },
  });
});
// Calculate Delivery Estimation
const calculateDeliveryEstimation = catchAsync(async (req, res) => {
  console.log('=== START calculateDeliveryEstimation Controller ===');

  const calculationData = req.body;
  const userId = req.user?.id; // optional, but logged

  console.log('Request body:', calculationData);
  console.log('User ID:', userId ?? 'Guest');

  // Optional auth check (remove if calculator is public)
  if (!userId) {
    return res.status(httpStatus.UNAUTHORIZED).json({
      success: false,
      error: 'User authentication required',
    });
  }

  const result = await deliveryEstimationService.calculateDeliveryEstimate(
    calculationData,
  );

  console.log('Calculation completed successfully');

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Delivery estimation calculated successfully',
    data: result,
  });

  console.log('=== END calculateDeliveryEstimation Controller ===');
});
// controllers/project.controller.js

const createProjectFromDeliveryEstimation = catchAsync(async (req, res) => {
  const { deliveryEstimationCode, proformaInvoiceId } = req.body;
  const userId = req.user.id; // Assuming user is attached to request by auth middleware

  // Validate required fields
  if (!deliveryEstimationCode) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Delivery estimation code is required',
    );
  }

  if (!proformaInvoiceId) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Proforma invoice ID is required',
    );
  }

  console.log('Creating project from delivery estimation:', {
    deliveryEstimationCode,
    proformaInvoiceId,
    userId,
  });

  // Call service with all three parameters
  const project =
    await deliveryEstimationService.createProjectFromDeliveryEstimation(
      deliveryEstimationCode,
      proformaInvoiceId,
      userId,
    );

  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Project created successfully from delivery estimation',
    data: project,
  });
});
module.exports = {
  createDeliveryEstimation,
  getDeliveryEstimations,
  getDeliveryEstimation,
  updateDeliveryEstimation,
  deleteDeliveryEstimation,
  updateEstimationStatus,
  putEstimationOnHold,
  confirmEstimation,
  getEstimationsByStatus,
  searchEstimationsByCustomer,
  expireOldEstimations,
  getEstimationStatistics,
  calculateDeliveryEstimation,
  createProjectFromDeliveryEstimation,
  getAllOnHoldDeliveryEstimations,
};
