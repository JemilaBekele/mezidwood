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

// Get Transfer by Reference
const getTransferByReference = catchAsync(async (req, res) => {
  const transfer = await transferService.getTransferByReference(
    req.params.reference,
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
  const { startDate, endDate } = req.query;

  const result = await transferService.getAllTransfers({
    startDate,
    endDate,
  });
  res.status(httpStatus.OK).send(result);
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
  await transferService.deleteTransfer(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Transfer deleted successfully',
  });
});

// Controller to bulk update additional prices
const bulkUpdatePrices = catchAsync(async (req, res) => {
  const batchUpdates = req.body; // expect [{ batchId, additionalPrices: [{label, price}] }] format

  const result = await transferService.bulkUpdateAdditionalPrices(batchUpdates);

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Additional prices updated successfully',
    totalProcessed: result.totalProcessed,
    batches: result.batches,
  });
});

module.exports = {
  createTransfer,
  getTransfer,
  getTransferByReference,
  getTransfers,
  updateTransfer,
  completeTransfer,
  cancelTransfer,
  deleteTransfer,
  bulkUpdatePrices,
};
