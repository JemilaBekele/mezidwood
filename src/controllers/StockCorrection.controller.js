const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { stockCorrectionService } = require('../services');
const ApiError = require('../utils/ApiError');

// Create StockCorrection
const createStockCorrection = catchAsync(async (req, res) => {
  const stockCorrection = await stockCorrectionService.createStockCorrection(
    req.body,
    req.user.id,
  );
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Stock correction created successfully',
    stockCorrection,
  });
});

// Get Stock Correction by ID
const getStockCorrection = catchAsync(async (req, res) => {
  const stockCorrection = await stockCorrectionService.getStockCorrectionById(
    req.params.id,
  );
  if (!stockCorrection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Stock correction not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    stockCorrection,
  });
});
const getStockCorrectionsByPurchaseId = catchAsync(async (req, res) => {
  const stockCorrection =
    await stockCorrectionService.getStockCorrectionsByPurchaseId(req.params.id);
  if (!stockCorrection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Stock correction not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    stockCorrection,
  });
});

// Get Stock Correction by Reference
const getStockCorrectionByReference = catchAsync(async (req, res) => {
  const stockCorrection =
    await stockCorrectionService.getStockCorrectionByReference(
      req.params.reference,
    );
  if (!stockCorrection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Stock correction not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    stockCorrection,
  });
});

// Get all Stock Corrections
const getStockCorrections = catchAsync(async (req, res) => {
  const { startDate, endDate, status } = req.query;

  const result = await stockCorrectionService.getAllStockCorrections({
    startDate,
    endDate,
    status,
  });
  res.status(httpStatus.OK).send(result);
});

// Update Stock Correction
const updateStockCorrection = catchAsync(async (req, res) => {
  const stockCorrection = await stockCorrectionService.updateStockCorrection(
    req.params.id,
    req.body,
    req.user.id,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Stock correction updated successfully',
    stockCorrection,
  });
});

// Approve Stock Correction
const approveStockCorrection = catchAsync(async (req, res) => {
  const stockCorrection = await stockCorrectionService.approveStockCorrection(
    req.params.id,
    req.user.id,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Stock correction approved successfully',
    stockCorrection,
  });
});

// Reject Stock Correction
const rejectStockCorrection = catchAsync(async (req, res) => {
  const stockCorrection = await stockCorrectionService.rejectStockCorrection(
    req.params.id,
    req.user.id,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Stock correction rejected successfully',
    stockCorrection,
  });
});

// Delete Stock Correction
const deleteStockCorrection = catchAsync(async (req, res) => {
  await stockCorrectionService.deleteStockCorrection(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Stock correction deleted successfully',
  });
});

const getMaterialStock = catchAsync(async (req, res) => {
  const { materialId } = req.params;

  const stockInfo = await stockCorrectionService.getMaterialStockQuantity(
    materialId,
  );

  if (!stockInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Material not found');
  }

  res.status(httpStatus.OK).send({
    success: true,
    data: stockInfo,
  });
});
const getMaterialStockQuantityreserve = catchAsync(async (req, res) => {
  const { materialId } = req.params;

  const stockInfo =
    await stockCorrectionService.getMaterialStockQuantityreserve(materialId);

  if (!stockInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Material not found');
  }

  res.status(httpStatus.OK).send({
    success: true,
    data: stockInfo,
  });
});

module.exports = {
  getMaterialStockQuantityreserve,
  getMaterialStock,
  createStockCorrection,
  getStockCorrection,
  getStockCorrectionByReference,
  getStockCorrections,
  updateStockCorrection,
  approveStockCorrection,
  rejectStockCorrection,
  deleteStockCorrection,
  getStockCorrectionsByPurchaseId,
};
