/* eslint-disable no-restricted-syntax */
const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { productService } = require('../services');
const ApiError = require('../utils/ApiError');

// Create Product
const createProduct = catchAsync(async (req, res) => {
  // Structure files by field name
  const structuredFiles = {};

  if (Array.isArray(req.files)) {
    req.files.forEach((file) => {
      if (!structuredFiles[file.fieldname]) {
        structuredFiles[file.fieldname] = [];
      }
      structuredFiles[file.fieldname].push(file);
    });
  } else if (req.files) {
    for (const [fieldname, files] of Object.entries(req.files)) {
      structuredFiles[fieldname] = Array.isArray(files) ? files : [files];
    }
  }

  // Ensure image field exists even if no file was uploaded
  structuredFiles.image = structuredFiles.image || undefined;

  const product = await productService.createProduct(req.body, structuredFiles);

  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Product created successfully',
    product,
  });
});
const updateProduct = catchAsync(async (req, res) => {
  // Structure files by field name
  const structuredFiles = {};

  if (Array.isArray(req.files)) {
    req.files.forEach((file) => {
      if (!structuredFiles[file.fieldname]) {
        structuredFiles[file.fieldname] = [];
      }
      structuredFiles[file.fieldname].push(file);
    });
  } else if (req.files) {
    for (const [fieldname, files] of Object.entries(req.files)) {
      structuredFiles[fieldname] = Array.isArray(files) ? files : [files];
    }
  }

  // Ensure image field exists even if no file was uploaded
  structuredFiles.image = structuredFiles.image || undefined;

  const product = await productService.updateProduct(
    req.params.id,
    req.body,
    structuredFiles,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Product updated successfully',
    product,
  });
});
const createProductStock = catchAsync(async (req, res) => {
  const { productId } = req.params;
  const userId = req.user.id;

  // Extract stocks array from request body
  // The frontend is sending { stocks: [...] } so we need to extract the array
  let stockData = req.body;

  // Check if the body has a 'stocks' property
  if (stockData && stockData.stocks && Array.isArray(stockData.stocks)) {
    stockData = stockData.stocks;
  } else if (stockData && !Array.isArray(stockData)) {
    // If it's a single object but not in an array, wrap it
    stockData = [stockData];
  }

  try {
    const productBatch = await productService.createProductStock(
      productId,
      stockData, // Now this should be an array
      userId,
    );

    res.status(httpStatus.CREATED).send({
      success: true,
      message: 'Product stock created successfully',
      productBatch,
    });
  } catch (error) {
    res.status(error.statusCode || httpStatus.INTERNAL_SERVER_ERROR).send({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
});
// Update Product

// Get Product by ID
const getProduct = catchAsync(async (req, res) => {
  const product = await productService.getProductById(req.params.id);
  if (!product) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    product,
  });
});

const getBatchesByProduct = catchAsync(async (req, res) => {
  const { productId } = req.params;
  const result = await productService.getBatchesByProduct(productId);
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
// Get Product by Code
const getProductByCode = catchAsync(async (req, res) => {
  const product = await productService.getProductByCode(req.params.code);
  if (!product) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    product,
  });
});

// Get all Products
const getActiveAllProducts = catchAsync(async (req, res) => {
  const result = await productService.getActiveAllProducts();
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

const getProducts = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const result = await productService.getAllProducts(userId);
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getTopSellingProducts = catchAsync(async (req, res) => {
  const { searchTerm, categoryId, subCategoryId } = req.query;
  const userId = req.user.id;

  // Convert empty strings to null and ensure proper parameter assignment
  const processedSearchTerm =
    searchTerm && searchTerm.trim() !== '' ? searchTerm.trim() : null;
  const processedCategoryId =
    categoryId && categoryId.trim() !== '' ? categoryId.trim() : null;
  const processedSubCategoryId =
    subCategoryId && subCategoryId.trim() !== '' ? subCategoryId.trim() : null;

  const result = await productService.getTopSellingProducts(
    userId,
    processedSearchTerm, // This should be the text search
    processedCategoryId, // This should be the category ID
    processedSubCategoryId, // This should be the subcategory ID
  );

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getRandomProductsWithShopStocks = catchAsync(async (req, res) => {
  const result = await productService.getRandomProductsWithShopStocks();

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
// Delete Product
const deleteProduct = catchAsync(async (req, res) => {
  await productService.deleteProduct(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Product deleted successfully',
  });
});
const createProductBatchsingle = catchAsync(async (req, res) => {
  const productBatch = await productService.createProductBatchsingle(req.body);
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Product batch created successfully',
    data: productBatch,
  });
});
const getProductById = catchAsync(async (req, res) => {
  const { productId } = req.params;
  const userId = req.user.id;
  const productDetails = await productService.getProductDetails(
    productId,
    userId,
  );

  if (!productDetails) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  }

  res.status(httpStatus.OK).send({ product: productDetails });
});
const getProductBatchesByShopsController = catchAsync(async (req, res) => {
  const { productId } = req.params;

  const batches = await productService.getProductBatchesByShops(productId);

  if (!batches || batches.length === 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'No available batches found for this product',
    );
  }
  res.status(httpStatus.OK).send({ batches });
});
// getProductBatchesByShopsForUser
const getProductBatchesByShopsForUser = catchAsync(async (req, res) => {
  const { productId } = req.params;
  const userId = req.user.id;
  const batches = await productService.getProductBatchesByShopsForUser(
    productId,
    userId,
  );

  if (!batches || batches.length === 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'No available batches found for this product',
    );
  }

  res.status(httpStatus.OK).send({ batches });
});

module.exports = {
  createProductStock,
  createProduct,
  getProduct,
  getProductByCode,
  getProducts,
  updateProduct,
  deleteProduct,
  getBatchesByProduct,
  createProductBatchsingle,
  getProductById,
  getProductBatchesByShopsController,
  getTopSellingProducts,
  getActiveAllProducts,
  getRandomProductsWithShopStocks,
  getProductBatchesByShopsForUser,
};
