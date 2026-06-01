const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { categoryService } = require('../services');
const ApiError = require('../utils/ApiError');

// Create Category
const createCategory = catchAsync(async (req, res) => {
  const category = await categoryService.createCategory(req.body);
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Category created successfully',
    category,
  });
});

// Get Category by ID
const getCategory = catchAsync(async (req, res) => {
  const category = await categoryService.getCategoryById(req.params.id);
  if (!category) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    category,
  });
});

// Get all Categories
const getCategories = catchAsync(async (req, res) => {
  const result = await categoryService.getAllCategories();
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Update Category
const updateCategory = catchAsync(async (req, res) => {
  const category = await categoryService.updateCategory(
    req.params.id,
    req.body,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Category updated successfully',
    category,
  });
});

// Delete Category
const deleteCategory = catchAsync(async (req, res) => {
  await categoryService.deleteCategory(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Category deleted successfully',
  });
});

const createColour = catchAsync(async (req, res) => {
  const colour = await categoryService.createColour(req.body);

  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Colour created successfully',
    colour,
  });
});

// Get Colour by ID
const getColour = catchAsync(async (req, res) => {
  const colour = await categoryService.getColourById(req.params.id);
  if (!colour) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Colour not found');
  }

  res.status(httpStatus.OK).send({
    success: true,
    colour,
  });
});

// Get all Colours (with pagination & filtering)
const getColours = catchAsync(async (req, res) => {
  const filter = {
    name: req.query.name,
  };

  const options = {
    sortBy: req.query.sortBy,
    order: req.query.order,
    page: Number(req.query.page),
    limit: Number(req.query.limit),
  };

  const result = await categoryService.getAllColours(filter, options);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Update Colour
const updateColour = catchAsync(async (req, res) => {
  const colour = await categoryService.updateColour(req.params.id, req.body);

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Colour updated successfully',
    colour,
  });
});

// Delete Colour
const deleteColour = catchAsync(async (req, res) => {
  const result = await categoryService.deleteColour(req.params.id);

  res.status(httpStatus.OK).send({
    success: true,
    message: result.message,
    deletedColour: result.deletedColour,
  });
});

const getTopSellingProductsController = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  const result = await categoryService.getTopSellingProducts({
    startDate,
    endDate,
  });

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Top selling products retrieved successfully',
    data: result,
  });
});

const getTopTailorsByMetersController = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  const result = await categoryService.getTopTailorsByMeters({
    startDate,
    endDate,
  });

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Top tailors by meters retrieved successfully',
    data: result,
  });
});

const getWorkerLogPerformanceController = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  const result = await categoryService.getWorkerLogPerformance({
    startDate,
    endDate,
  });

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Worker log performance retrieved successfully',
    data: result,
  });
});

const getTopPerformersDashboardController = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  const result = await categoryService.getTopPerformersDashboard({
    startDate,
    endDate,
  });

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Top performers dashboard retrieved successfully',
    data: result,
  });
});

module.exports = {
  createCategory,
  getCategory,
  getCategories,
  updateCategory,
  deleteCategory,
  createColour,
  getColour,
  getColours,
  updateColour,
  deleteColour,
   getTopSellingProductsController,
  getTopTailorsByMetersController,
  getWorkerLogPerformanceController,
  getTopPerformersDashboardController,
};
