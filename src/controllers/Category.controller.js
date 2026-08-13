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
const getAllDailyStageCapacities = catchAsync(async (req, res) => {
  const category = await categoryService.getAllDailyStageCapacities(
    req.params.id,
  );
  if (!category) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    category,
  });
});
const resetDailyStageCapacities = catchAsync(async (req, res) => {
  const result = await categoryService.resetDailyStageCapacities();

  res.status(httpStatus.OK).send({
    success: true,
    message: 'All daily stage capacities and allocations deleted successfully.',
    result,
  });
});

// Rebuild the capacity ledger from current projects (non-destructive: re-reserves
// capacity for every in-flight project instead of just deleting it). rebuildCapacityLedger
const rebuildCapacityLedger = catchAsync(async (req, res) => {
  const { mode } = req.body; // "FULL" | "WEEK_ONLY"

  const result = await categoryService.rebuildCapacityLedger();

  const modeLabel =  'WEEK_ONLY' ;

  res.status(httpStatus.OK).send({
    success: true,
    message: `Capacity rebuilt (${modeLabel}) from ${result.rebuilt} project(s).`,
    result,
  });
});
const rebuildCapacityLedgerweek = catchAsync(async (req, res) => {
  const { mode } = req.body; // "FULL" | "WEEK_ONLY"

  const result = await categoryService.rebuildCapacityLedger();

  const modeLabel =  'WEEK_ONLY' ;

  res.status(httpStatus.OK).send({
    success: true,
    message: `Capacity rebuilt (${modeLabel}) from ${result.rebuilt} project(s).`,
    result,
  });
});

/**
 * Reconcile the capacity ledger: recompute every daily counter from its
 * allocation rows. `?dryRun=true` reports the drift without writing.
 *
 * Same implementation as `npm run capacity:rebuild`.
 */
const reconcileCapacityLedger = catchAsync(async (req, res) => {
  const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;
  const result = await categoryService.reconcileCapacityLedger(dryRun);

  res.status(httpStatus.OK).send({
    success: true,
    message: result.clean
      ? 'Capacity ledger is consistent — no drift found.'
      : `${dryRun ? 'Drift found' : 'Ledger repaired'}: ${result.correctedDays} day(s) corrected, ${result.orphanAllocationsDeleted} orphan allocation(s), ${result.emptyDaysDeleted} empty day(s).`,
    result,
  });
});

// Telemetry stats for a date range
const getCapacityTelemetry = catchAsync(async (req, res) => {
  const { from, to, stage } = req.query;
  if (!from || !to) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'from and to query params are required (YYYY-MM-DD)',
    );
  }
  const result = await categoryService.getCapacityTelemetry(from, to, stage);
  res.status(httpStatus.OK).send({ success: true, ...result });
});

// Per-stage load rail for a date range
const getStageLoadRail = catchAsync(async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'from and to query params are required (YYYY-MM-DD)',
    );
  }
  const result = await categoryService.getStageLoadRail(from, to);
  res.status(httpStatus.OK).send({ success: true, ...result });
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
  console.log('Fetched colour:', result.colours); // Debug log

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

module.exports = {
  rebuildCapacityLedgerweek,
  reconcileCapacityLedger,
  resetDailyStageCapacities,
  rebuildCapacityLedger,
  getCapacityTelemetry,
  getStageLoadRail,
  getAllDailyStageCapacities,
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
};
