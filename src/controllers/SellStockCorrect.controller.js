const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { sellStockCorrectionService } = require('../services');
const ApiError = require('../utils/ApiError');

// Create Sell Stock Correction
const createSellStockCorrection = catchAsync(async (req, res) => {
  const sellStockCorrection =
    await sellStockCorrectionService.createSellStockCorrection(
      req.body,
      req.user.id,
    );
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Sell stock correction created successfully',
    sellStockCorrection,
  });
});

// Get Sell Stock Correction by ID
const getSellStockCorrection = catchAsync(async (req, res) => {
  const sellStockCorrection =
    await sellStockCorrectionService.getSellStockCorrectionById(req.params.id);
  if (!sellStockCorrection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sell stock correction not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    sellStockCorrection,
  });
});

// Get Sell Stock Corrections by Sell ID
const getSellStockCorrectionsBySellId = catchAsync(async (req, res) => {
  const sellStockCorrections =
    await sellStockCorrectionService.getSellStockCorrectionsBySellId(
      req.params.sellId,
    );
  res.status(httpStatus.OK).send({
    success: true,
    sellStockCorrections,
    count: sellStockCorrections.length,
  });
});

const getSellStockCorrectionfilterId = catchAsync(async (req, res) => {
  console.log('sell id', req.params.sellId);
  console.log('user id', req.user.id);

  const sellStockCorrections =
    await sellStockCorrectionService.getSellStockCorrectionfilterId(
      req.params.sellId,
      req.user.id,
    );
  res.status(httpStatus.OK).send({
    success: true,
    sellStockCorrections,
    count: sellStockCorrections.length,
  });
});
// Get Sell Stock Correction by Reference
const getSellStockCorrectionByReference = catchAsync(async (req, res) => {
  const sellStockCorrection =
    await sellStockCorrectionService.getSellStockCorrectionByReference(
      req.params.reference,
    );
  if (!sellStockCorrection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sell stock correction not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    sellStockCorrection,
  });
});

// Get all Sell Stock Corrections
const getSellStockCorrections = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  const result = await sellStockCorrectionService.getAllSellStockCorrections({
    startDate,
    endDate,
  });
  res.status(httpStatus.OK).send(result);
});

// Update Sell Stock Correction
const updateSellStockCorrection = catchAsync(async (req, res) => {
  const sellStockCorrection =
    await sellStockCorrectionService.updateSellStockCorrection(
      req.params.id,
      req.body,
      req.user.id,
    );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Sell stock correction updated successfully',
    sellStockCorrection,
  });
});

// Approve Sell Stock Correction
const approveSellStockCorrection = catchAsync(async (req, res) => {
  const { deliveredItemIds } = req.body;

  const sellStockCorrection =
    await sellStockCorrectionService.approveSellStockCorrection(
      req.params.id,
      req.user.id,
      deliveredItemIds || [], // Pass the deliveredItemIds array from request body
    );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Sell stock correction updated successfully',
    sellStockCorrection,
  });
});

// Reject Sell Stock Correction
const rejectSellStockCorrection = catchAsync(async (req, res) => {
  const sellStockCorrection =
    await sellStockCorrectionService.rejectSellStockCorrection(
      req.params.id,
      req.user.id,
    );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Sell stock correction rejected successfully',
    sellStockCorrection,
  });
});

// Delete Sell Stock Correction
const deleteSellStockCorrection = catchAsync(async (req, res) => {
  await sellStockCorrectionService.deleteSellStockCorrection(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Sell stock correction deleted successfully',
  });
});
const getSellByIdforsellcorrection = catchAsync(async (req, res) => {
  const sell = await sellStockCorrectionService.getSellByIdforsellcorrection(
    req.params.id,
  );
  if (!sell) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    sell,
  });
});
module.exports = {
  createSellStockCorrection,
  getSellStockCorrection,
  getSellStockCorrectionByReference,
  getSellStockCorrections,
  getSellStockCorrectionsBySellId,
  updateSellStockCorrection,
  approveSellStockCorrection,
  rejectSellStockCorrection,
  deleteSellStockCorrection,
  getSellByIdforsellcorrection,
  getSellStockCorrectionfilterId,
};
