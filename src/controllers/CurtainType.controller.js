const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { curtainTypeService } = require('../services');
const ApiError = require('../utils/ApiError');

/* ──────────────── CURTAIN TYPE ──────────────── */

// Create CurtainType
const createCurtainType = catchAsync(async (req, res) => {
  const curtainType = await curtainTypeService.createCurtainType(req.body);
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Curtain type created successfully',
    curtainType,
  });
});

// Get CurtainType by ID
const getCurtainType = catchAsync(async (req, res) => {
  const curtainType = await curtainTypeService.getCurtainTypeById(
    req.params.id,
  );
  if (!curtainType) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Curtain type not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    curtainType,
  });
});

// Get all CurtainTypes
const getCurtainTypes = catchAsync(async (req, res) => {
  const { includeProducts, page, limit, search } = req.query;

  const options = {
    includeProducts: includeProducts === 'true',
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 10,
    search,
  };

  const result = await curtainTypeService.getAllCurtainTypes(options);
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Update CurtainType
const updateCurtainType = catchAsync(async (req, res) => {
  const curtainType = await curtainTypeService.updateCurtainType(
    req.params.id,
    req.body,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Curtain type updated successfully',
    curtainType,
  });
});

// Delete CurtainType
const deleteCurtainType = catchAsync(async (req, res) => {
  await curtainTypeService.deleteCurtainType(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Curtain type deleted successfully',
  });
});

/* ──────────────── MOVEMENT TYPE ──────────────── */

// Create MovementType
const createMovementType = catchAsync(async (req, res) => {
  const movementType = await curtainTypeService.createMovementType(req.body);
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Movement type created successfully',
    movementType,
  });
});

// Get MovementType by ID
const getMovementType = catchAsync(async (req, res) => {
  const movementType = await curtainTypeService.getMovementTypeById(
    req.params.id,
  );
  if (!movementType) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Movement type not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    movementType,
  });
});

// Get all MovementTypes
const getMovementTypes = catchAsync(async (req, res) => {
  const { page, limit, search } = req.query;

  const options = {
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 10,
    search,
  };

  const result = await curtainTypeService.getAllMovementTypes(options);
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Update MovementType
const updateMovementType = catchAsync(async (req, res) => {
  const movementType = await curtainTypeService.updateMovementType(
    req.params.id,
    req.body,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Movement type updated successfully',
    movementType,
  });
});

// Delete MovementType
const deleteMovementType = catchAsync(async (req, res) => {
  await curtainTypeService.deleteMovementType(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Movement type deleted successfully',
  });
});

/* ──────────────── EXPORTS ──────────────── */
module.exports = {
  // CurtainType
  createCurtainType,
  getCurtainType,
  getCurtainTypes,
  updateCurtainType,
  deleteCurtainType,

  // MovementType
  createMovementType,
  getMovementType,
  getMovementTypes,
  updateMovementType,
  deleteMovementType,
};
