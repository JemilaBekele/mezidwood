const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { productBatchService } = require('../services');
const ApiError = require('../utils/ApiError');

// Create Product Batch
const createProductBatch = catchAsync(async (req, res) => {
  const batch =
    await productBatchService.createProductBatchWithAdditionalPrices(req.body);
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Product batch created successfully',
    batch,
  });
});

// Get Product Batch by ID
const getProductBatch = catchAsync(async (req, res) => {
  const batch = await productBatchService.getProductBatchById(req.params.id);
  if (!batch) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product batch not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    batch,
  });
});

// Get all Product Batches (with filters + pagination)
const getProductBatches = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  const result = await productBatchService.getAllProductBatches(
    startDate,
    endDate,
  );
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Update Product Batch
const updateProductBatch = catchAsync(async (req, res) => {
  const batch =
    await productBatchService.updateProductBatchWithAdditionalPrices(
      req.params.id,
      req.body,
    );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Product batch updated successfully',
    batch,
  });
});

// Delete Product Batch
const deleteProductBatch = catchAsync(async (req, res) => {
  await productBatchService.deleteProductBatch(req.params.id, req.user.id); // assumes `req.user.id` is available
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Product batch deleted successfully',
  });
});
const getProductByStoreStock = catchAsync(async (req, res) => {
  const { storeId } = req.params; // Changed from stockId to storeId
  const results = await productBatchService.getProductByStoreStock(storeId);

  if (!results || results.length === 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'No store stocks found for this store',
    );
  }

  res.status(httpStatus.OK).send({
    success: true,
    data: results, // Send the entire array
    message: 'Store stocks retrieved successfully',
  });
});

// Controller: Get product by shop stock
const getProductByShopStock = catchAsync(async (req, res) => {
  const { shopId } = req.params;
  const results = await productBatchService.getProductByShopStock(shopId);

  if (!results) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Shop stock not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    data: results, // Send the entire array
    message: 'Store stocks retrieved successfully',
  });
});

// Get Product Info by Batch ID
const getProductInfoByBatchIdController = catchAsync(async (req, res) => {
  const productInfo = await productBatchService.getProductInfoByBatchId(
    req.params.id,
  );
  if (!productInfo) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Product not found for given batch ID',
    );
  }

  res.status(httpStatus.OK).send({
    success: true,
    product: productInfo,
  });
});
module.exports = {
  createProductBatch,
  getProductBatch,
  getProductBatches,
  updateProductBatch,
  deleteProductBatch,
  getProductByStoreStock,
  getProductByShopStock,
  getProductInfoByBatchIdController,
};
