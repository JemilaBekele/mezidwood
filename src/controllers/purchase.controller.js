const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { purchaseService } = require('../services');
const ApiError = require('../utils/ApiError');

// Create Purchase
const createPurchase = catchAsync(async (req, res) => {
  const userId = req.user.id; // ✅ User ID from auth middleware

  const purchase = await purchaseService.createPurchase(req.body, userId);
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Purchase created successfully',
    purchase,
  });
});

// Get Purchase by ID
const getPurchase = catchAsync(async (req, res) => {
  const purchase = await purchaseService.getPurchaseById(req.params.id);
  if (!purchase) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    purchase,
  });
});

// Get Purchase by Invoice Number
const getPurchaseByInvoice = catchAsync(async (req, res) => {
  const purchase = await purchaseService.getPurchaseByInvoiceNo(
    req.params.invoiceNo,
  );
  if (!purchase) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    purchase,
  });
});

// Get all Purchases
const getPurchases = catchAsync(async (req, res) => {
  const result = await purchaseService.getAllPurchases(req.query);
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Update Purchase
const updatePurchase = catchAsync(async (req, res) => {
  const purchase = await purchaseService.updatePurchase(
    req.params.id,
    req.body,
    req.user.id,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Purchase updated successfully',
    purchase,
  });
});

const acceptPurchase = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { paymentStatus } = req.body; // ✅ Get paymentStatus from request body
  const userId = req.user.id; // ✅ User ID from auth middleware

  const result = await purchaseService.acceptPurchase(
    id,
    paymentStatus,
    userId,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: `Purchase accepted successfully with status ${paymentStatus}`,
    data: result,
  });
});

// Delete Purchase
const deletePurchase = catchAsync(async (req, res) => {
  await purchaseService.deletePurchase(req.params.id, req.user.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Purchase deleted successfully',
  });
});

module.exports = {
  createPurchase,
  getPurchase,
  getPurchaseByInvoice,
  getPurchases,
  updatePurchase,
  deletePurchase,
  acceptPurchase,
};
