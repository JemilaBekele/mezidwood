const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { branchService } = require('../services');
const ApiError = require('../utils/ApiError');

// Create Branch
const createBranch = catchAsync(async (req, res) => {
  const branch = await branchService.createBranch(req.body);
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Branch created successfully',
    branch,
  });
});

// Get Branch by ID
const getBranch = catchAsync(async (req, res) => {
  const branch = await branchService.getBranchById(req.params.id);
  if (!branch) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Branch not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    branch,
  });
});

// Get all Branches
const getBranches = catchAsync(async (req, res) => {
  const result = await branchService.getAllBranches();
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Update Branch
const updateBranch = catchAsync(async (req, res) => {
  const branch = await branchService.updateBranch(req.params.id, req.body);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Branch updated successfully',
    branch,
  });
});

// Delete Branch
const deleteBranch = catchAsync(async (req, res) => {
  await branchService.deleteBranch(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Branch deleted successfully',
  });
});
const getAllProducts = catchAsync(async (req, res) => {
  const userId = req.user?.id;
  const result = await branchService.getAllProducts(userId);

  res.status(200).json({
    status: 'success',
    data: {
      products: result.products,
      count: result.count,
      userAccessibleShops: result.userAccessibleShops,
    },
  });
});
const getEstimatedCurtainDeliveryTime = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  const result = await branchService.getEstimatedCurtainDeliveryTime(
    startDate,
    endDate,
  );

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
module.exports = {
  createBranch,
  getBranch,
  getBranches,
  updateBranch,
  deleteBranch,
  getAllProducts,
  getEstimatedCurtainDeliveryTime,
};
