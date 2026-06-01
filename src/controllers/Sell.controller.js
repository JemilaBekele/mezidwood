const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { sellService } = require('../services');
const ApiError = require('../utils/ApiError');

// Create Sell
const createSell = catchAsync(async (req, res) => {
  const userId = req.user.id; // ✅ User ID from auth middleware

  const sell = await sellService.createSell(req.body, userId);
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Sale created successfully',
    sell,
  });
});

// Get Sell by ID
const getSell = catchAsync(async (req, res) => {
  const sell = await sellService.getSellById(req.params.id);
  if (!sell) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    sell,
  });
});
const getSellByIdByuser = catchAsync(async (req, res) => {
  const sell = await sellService.getSellByIdByuser(req.params.id, req.user.id);
  if (!sell) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    sell,
  });
});

const unlockSell = catchAsync(async (req, res) => {
  const sell = await sellService.unlockSell(req.params.id);
  if (!sell) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    sell,
  });
});

// Get all Sells
const getSells = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  const result = await sellService.getAllSells({
    startDate,
    endDate,
  });

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getAllSellsuser = catchAsync(async (req, res) => {
  const userId = req.user.id; // ✅ User ID from auth middleware
  const { startDate, endDate, customerName, status } = req.query;
  const result = await sellService.getAllSellsuser({
    startDate,
    endDate,
    userId,
    customerName,
    status,
  });
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getAllSellsForStore = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { startDate, endDate, customerName, salesPersonName } = req.query;

  // Handle status parameter which can be single value or array
  let statusFilter;
  if (req.query.status) {
    if (Array.isArray(req.query.status)) {
      // If multiple status parameters are provided (e.g., ?status=APPROVED&status=PENDING)
      statusFilter = req.query.status;
    } else if (req.query.status === 'all') {
      statusFilter = 'all';
    } else if (req.query.status.includes(',')) {
      // If comma-separated values
      statusFilter = req.query.status.split(',').map((s) => s.trim());
    } else {
      // Single value
      statusFilter = req.query.status;
    }
  }

  const result = await sellService.getAllSellsForStore({
    startDate,
    endDate,
    userId,
    customerName: customerName?.trim(),
    salesPersonName: salesPersonName?.trim(),
    status: statusFilter,
  });

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const updateSell = catchAsync(async (req, res) => {
  const userId = req.user.id; // ✅ User ID from auth middleware

  const sell = await sellService.updateSell(req.params.id, req.body, userId);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Sale updated successfully',
    sell,
  });
});

// Delete Sell
const deleteSell = catchAsync(async (req, res) => {
  await sellService.deleteSell(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Sale deleted successfully',
  });
});
// Complete delivery for all deliverable items
// Deliver all sale items with batch data
const deliverAllSaleItems = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params; // saleId
  const { deliveryData } = req.body; // batch delivery data

  if (
    !deliveryData ||
    !deliveryData.items ||
    !Array.isArray(deliveryData.items)
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Please provide valid delivery data with batch information',
    );
  }

  const sale = await sellService.deliverAllSaleItems(id, deliveryData, userId);
  res.status(httpStatus.OK).send({
    success: true,
    message:
      'All deliverable items delivered successfully with batch assignment',
    sale,
  });
});

// Complete delivery for specific items with batch data (partial delivery)
const completeSaleDelivery = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params; // saleId
  const { deliveryData } = req.body; // batch delivery data

  if (
    !deliveryData ||
    !deliveryData.items ||
    !Array.isArray(deliveryData.items)
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Please provide valid delivery data with batch information',
    );
  }

  // Validate that each item has batches
  deliveryData.items.forEach((item, index) => {
    if (!item.itemId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item at index ${index} is missing itemId`,
      );
    }
    if (
      !item.batches ||
      !Array.isArray(item.batches) ||
      item.batches.length === 0
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${item.itemId} must have at least one batch with quantity`,
      );
    }
  });

  const sale = await sellService.completeSaleDelivery(id, deliveryData, userId);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Selected items delivered successfully with batch assignment',
    sale,
  });
});

// Partial delivery endpoint with batch data
const partialSaleDelivery = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params; // saleId
  const { deliveryData } = req.body; // batch delivery data

  if (
    !deliveryData ||
    !deliveryData.items ||
    !Array.isArray(deliveryData.items)
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Please provide valid delivery data with batch information',
    );
  }

  // Validate that each item has batches
  deliveryData.items.forEach((item, index) => {
    if (!item.itemId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item at index ${index} is missing itemId`,
      );
    }
    if (
      !item.batches ||
      !Array.isArray(item.batches) ||
      item.batches.length === 0
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${item.itemId} must have at least one batch with quantity`,
      );
    }
  });

  const sale = await sellService.partialSaleDelivery(id, deliveryData, userId);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Partial delivery completed successfully with batch assignment',
    sale,
  });
});

// ✅ Update Sale Status
const updateSaleStatus = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params; // saleId
  const { newStatus } = req.body;

  const sale = await sellService.updateSaleStatus(id, newStatus, userId);
  res.status(httpStatus.OK).send({
    success: true,
    message: `Sale status updated to ${newStatus}`,
    sale,
  });
});

// ✅ Update Payment Status
const updatePaymentStatus = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params; // saleId
  const { newPaymentStatus } = req.body;

  const sale = await sellService.updatePaymentStatus(
    id,
    newPaymentStatus,
    userId,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: `Sale payment status updated to ${newPaymentStatus}`,
    sale,
  });
});

// ✅ Cancel Sal
const cancelSale = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params; // saleId

  const sale = await sellService.cancelSale(id, userId);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Sale cancelled successfully',
    sale,
  });
});
module.exports = {
  createSell,
  getSell,
  getSells,
  updateSell,
  deleteSell,
  completeSaleDelivery,
  updateSaleStatus,
  updatePaymentStatus,
  cancelSale,
  deliverAllSaleItems,
  partialSaleDelivery,
  getAllSellsuser,
  getAllSellsForStore,
  getSellByIdByuser,
  unlockSell,
};
