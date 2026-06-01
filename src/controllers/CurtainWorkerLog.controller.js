const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { curtainWorkerLogService } = require('../services');
const ApiError = require('../utils/ApiError');

// Create CurtainWorkerLog
const createCurtainWorkerLog = catchAsync(async (req, res) => {
  // Add createdById from authenticated user
  const logData = {
    ...req.body,
    createdById: req.user.id, // Assuming user is attached to req by auth middleware
  };

  const curtainWorkerLog = await curtainWorkerLogService.createCurtainWorkerLog(
    logData,
  );

  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Curtain worker log created successfully',
    curtainWorkerLog,
  });
});

// Update CurtainWorkerLog
const updateCurtainWorkerLog = catchAsync(async (req, res) => {
  const curtainWorkerLog = await curtainWorkerLogService.updateCurtainWorkerLog(
    req.params.id,
    req.body,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Curtain worker log updated successfully',
    curtainWorkerLog,
  });
});

// Get CurtainWorkerLogs by Employee ID
const getCurtainWorkerLogsByEmployee = catchAsync(async (req, res) => {
  const { workerId } = req.params;

  const result = await curtainWorkerLogService.getCurtainWorkerLogsByEmployee(
    workerId,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Curtain worker logs retrieved successfully',
    ...result,
  });
});

// Get CurtainWorkerLogs by Curtain Measurement ID
const getCurtainWorkerLogsByMeasurement = catchAsync(async (req, res) => {
  const { curtainMeasurementId } = req.params;

  const result =
    await curtainWorkerLogService.getCurtainWorkerLogsByMeasurement(
      curtainMeasurementId,
    );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Curtain worker logs retrieved successfully',
    ...result,
  });
});

// Optional: Get single CurtainWorkerLog by ID (if needed)
const getCurtainWorkerLogById = catchAsync(async (req, res) => {
  const curtainWorkerLog =
    await curtainWorkerLogService.getCurtainWorkerLogById(req.params.id);

  if (!curtainWorkerLog) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Curtain worker log not found');
  }

  res.status(httpStatus.OK).send({
    success: true,
    curtainWorkerLog,
  });
});

// Optional: Delete CurtainWorkerLog (if needed)
const deleteCurtainWorkerLog = catchAsync(async (req, res) => {
  // Note: You'll need to add this method to the service first
  await curtainWorkerLogService.deleteCurtainWorkerLog(req.params.id);

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Curtain worker log deleted successfully',
  });
});
// Bulk Approve Curtain Worker Logs
const bulkApproveCurtainWorkerLogs = catchAsync(async (req, res) => {
  const { logIds } = req.body;

  const result = await curtainWorkerLogService.bulkApproveCurtainWorkerLogs(
    logIds,
    req.user.id,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Bulk approval completed',
    data: result,
  });
});

// Reject Curtain Worker Log
const rejectCurtainWorkerLog = catchAsync(async (req, res) => {
  const { rejectionReason } = req.body;

  const result = await curtainWorkerLogService.rejectCurtainWorkerLog(
    req.params.id,
    req.user.id,
    rejectionReason,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Curtain worker log rejected successfully',
    data: result,
  });
});
module.exports = {
  rejectCurtainWorkerLog,
  bulkApproveCurtainWorkerLogs,
  createCurtainWorkerLog,
  updateCurtainWorkerLog,
  getCurtainWorkerLogsByEmployee,
  getCurtainWorkerLogsByMeasurement,
  getCurtainWorkerLogById,
  deleteCurtainWorkerLog,
};
