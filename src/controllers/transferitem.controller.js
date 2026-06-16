const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { transferService } = require('../services');
const ApiError = require('../utils/ApiError');

// Create Transfer
const createTransfer = catchAsync(async (req, res) => {
  const transfer = await transferService.createTransfer(req.body, req.user.id);
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Transfer created successfully',
    transfer,
  });
});

// Get Transfer by ID
const getTransfer = catchAsync(async (req, res) => {
  const transfer = await transferService.getTransferById(req.params.id);
  if (!transfer) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Transfer not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    transfer,
  });
});

// Get Transfer by Short Code
const getTransferByShortCode = catchAsync(async (req, res) => {
  const transfer = await transferService.getTransferByShortCode(
    req.params.shortCode,
  );
  if (!transfer) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Transfer not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    transfer,
  });
});

// Get all Transfers
const getTransfers = catchAsync(async (req, res) => {
  console.log('Received query parameters:', req.query); // Debug log
  const { startDate, endDate, type } = req.query;

  const result = await transferService.getAllTransfers({
    startDate,
    endDate,
    type,
  });

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Update Transfer
const updateTransfer = catchAsync(async (req, res) => {
  const transfer = await transferService.updateTransfer(
    req.params.id,
    req.body,
    req.user.id,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Transfer updated successfully',
    transfer,
  });
});

// Complete Transfer
const completeTransfer = catchAsync(async (req, res) => {
  const transfer = await transferService.completeTransfer(
    req.params.id,
    req.user.id,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Transfer completed successfully',
    transfer,
  });
});

// Cancel Transfer
const cancelTransfer = catchAsync(async (req, res) => {
  const transfer = await transferService.cancelTransfer(
    req.params.id,
    req.user.id,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Transfer cancelled successfully',
    transfer,
  });
});

// Delete Transfer
const deleteTransfer = catchAsync(async (req, res) => {
  const result = await transferService.deleteTransfer(
    req.params.id,
    req.user.id,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: result.message,
    stockReversed: result.stockReversed,
  });
});

// Get Transfer Statistics
const getTransferStats = catchAsync(async (req, res) => {
  const { type } = req.query;

  const stats = await transferService.getTransferStats({ type });

  res.status(httpStatus.OK).send({
    success: true,
    stats,
  });
});

// Get Transfer Items by Transfer ID
const getTransferItems = catchAsync(async (req, res) => {
  const transfer = await transferService.getTransferById(req.params.id);
  if (!transfer) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Transfer not found');
  }

  res.status(httpStatus.OK).send({
    success: true,
    items: transfer.items,
  });
});

module.exports = {
  createTransfer,
  getTransfer,
  getTransferByShortCode,
  getTransfers,
  updateTransfer,
  completeTransfer,
  cancelTransfer,
  deleteTransfer,
  getTransferStats,
  getTransferItems,
};
