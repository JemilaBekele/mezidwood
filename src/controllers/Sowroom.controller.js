const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { showroomService } = require('../services');
const ApiError = require('../utils/ApiError');

// Create Showroom
const createShowroom = catchAsync(async (req, res) => {
  const showroom = await showroomService.createShowroom(req.body);
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Showroom created successfully',
    showroom,
  });
});

// Get Showroom by ID
const getShowroom = catchAsync(async (req, res) => {
  const showroom = await showroomService.getShowroomById(req.params.id);
  if (!showroom) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Showroom not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    showroom,
  });
});

// Get all Showrooms
const getShowrooms = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const result = await showroomService.getAllShowrooms(userId);
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

const getAllShowroom = catchAsync(async (req, res) => {
  const result = await showroomService.getAllShowroom();
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Get all Showrooms based on user
const getAllShowroomsBasedUser = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const result = await showroomService.getAllShowroomsBasedUser(userId);
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Set Main Showroom
const setMainShowroom = catchAsync(async (req, res) => {
  const showroom = await showroomService.setMainShowroom(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Main showroom set successfully',
    showroom,
  });
});

// Get Main Showroom
const getMainShowroom = catchAsync(async (req, res) => {
  const showroom = await showroomService.getMainShowroom();
  res.status(httpStatus.OK).send({
    success: true,
    showroom,
  });
});

// Update Showroom
const updateShowroom = catchAsync(async (req, res) => {
  const showroom = await showroomService.updateShowroom(
    req.params.id,
    req.body,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Showroom updated successfully',
    showroom,
  });
});

// Delete Showroom
const deleteShowroom = catchAsync(async (req, res) => {
  await showroomService.deleteShowroom(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Showroom deleted successfully',
  });
});

module.exports = {
  createShowroom,
  getAllShowroom,
  getShowroom,
  getShowrooms,
  updateShowroom,
  deleteShowroom,
  getAllShowroomsBasedUser,
  setMainShowroom,
  getMainShowroom,
};
