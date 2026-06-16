const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { productConfigurationService } = require('../services');
const ApiError = require('../utils/ApiError');

// ==================== ProductCategory Controllers ====================

const createProductCategory = catchAsync(async (req, res) => {
  const category = await productConfigurationService.createProductCategory(
    req.body,
  );
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Product category created successfully',
    category,
  });
});

const getProductCategory = catchAsync(async (req, res) => {
  const category = await productConfigurationService.getProductCategoryById(
    req.params.id,
  );
  if (!category) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product category not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    category,
  });
});

const getAllProductCategories = catchAsync(async (req, res) => {
  const { search } = req.query;
  let filter = {};

  if (search) {
    filter = {
      name: {
        contains: search,
        mode: 'insensitive',
      },
    };
  }

  const result = await productConfigurationService.getAllProductCategories(
    filter,
  );
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

const updateProductCategory = catchAsync(async (req, res) => {
  const category = await productConfigurationService.updateProductCategory(
    req.params.id,
    req.body,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Product category updated successfully',
    category,
  });
});

const deleteProductCategory = catchAsync(async (req, res) => {
  const result = await productConfigurationService.deleteProductCategory(
    req.params.id,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: result.message,
  });
});

// ==================== ProductType Controllers ====================

const createProductType = catchAsync(async (req, res) => {
  const productType = await productConfigurationService.createProductType(
    req.body,
  );
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Product type created successfully',
    productType,
  });
});

const getProductType = catchAsync(async (req, res) => {
  const productType = await productConfigurationService.getProductTypeById(
    req.params.id,
  );
  if (!productType) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product type not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    productType,
  });
});

const getAllProductTypes = catchAsync(async (req, res) => {
  const { search } = req.query;
  let filter = {};

  if (search) {
    filter = {
      name: {
        contains: search,
        mode: 'insensitive',
      },
    };
  }

  const result = await productConfigurationService.getAllProductTypes(filter);
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

const updateProductType = catchAsync(async (req, res) => {
  const productType = await productConfigurationService.updateProductType(
    req.params.id,
    req.body,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Product type updated successfully',
    productType,
  });
});

const deleteProductType = catchAsync(async (req, res) => {
  const result = await productConfigurationService.deleteProductType(
    req.params.id,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: result.message,
  });
});

// ==================== Size Controllers ====================

const createSize = catchAsync(async (req, res) => {
  const size = await productConfigurationService.createSize(req.body);
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Size created successfully',
    size,
  });
});

const getSize = catchAsync(async (req, res) => {
  const size = await productConfigurationService.getSizeById(req.params.id);
  if (!size) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Size not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    size,
  });
});

const getAllSizes = catchAsync(async (req, res) => {
  const { search } = req.query;
  let filter = {};

  if (search) {
    filter = {
      name: {
        contains: search,
        mode: 'insensitive',
      },
    };
  }

  const result = await productConfigurationService.getAllSizes(filter);
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

const updateSize = catchAsync(async (req, res) => {
  const size = await productConfigurationService.updateSize(
    req.params.id,
    req.body,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Size updated successfully',
    size,
  });
});

const deleteSize = catchAsync(async (req, res) => {
  const result = await productConfigurationService.deleteSize(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: result.message,
  });
});

module.exports = {
  // ProductCategory exports
  createProductCategory,
  getProductCategory,
  getAllProductCategories,
  updateProductCategory,
  deleteProductCategory,

  // ProductType exports
  createProductType,
  getProductType,
  getAllProductTypes,
  updateProductType,
  deleteProductType,

  // Size exports
  createSize,
  getSize,
  getAllSizes,
  updateSize,
  deleteSize,
};
