// controllers/workerCommission.controller.js

const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const workerCommissionService = require('../services/WorkerCommission.service');
const ApiError = require('../utils/ApiError');

/**
 * Calculate commission for a specific worker
 */
const calculateWorkerCommission = catchAsync(async (req, res) => {
  const { workerId, workerType, startDate, endDate } = req.body;

  if (!workerId || !workerType || !startDate || !endDate) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Missing required fields: workerId, workerType, startDate, endDate',
    );
  }

  const result = await workerCommissionService.calculateWorkerCommission(
    workerId,
    workerType,
    new Date(startDate),
    new Date(endDate),
  );

  res.status(httpStatus.OK).send({
    success: true,
    data: result,
  });
});

/**
 * Get unpaid worker commissions report
 */
// In your route/controller file
const getUnpaidWorkerCommissionsReport = async (req, res) => {
  try {
    const { workerType, startDate, endDate, workerPercent } = req.query;
    // Make sure to extract workerPercent from query params
    const result =
      await workerCommissionService.getUnpaidWorkerCommissionsReport(
        workerType,
        startDate ? new Date(startDate) : null,
        endDate ? new Date(endDate) : null,
        Number(workerPercent) || 0, // Important: Pass the percentage
      );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    // Handle error
  }
};

/**
 * Mark worker as paid
 */
const markWorkerAsPaid = catchAsync(async (req, res) => {
  const { measurementId, workerType, amount } = req.body;
  const userId = req.user?.id;

  if (!measurementId || !workerType || !amount) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Missing required fields: measurementId, workerType, amount',
    );
  }

  if (!userId) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'User not authenticated');
  }

  const result = await workerCommissionService.markWorkerAsPaid(
    measurementId,
    workerType,
    amount,
    userId,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Worker marked as paid successfully',
    data: result,
  });
});

/**
 * Get detailed worker report
 */
const getWorkerDetailedReport = catchAsync(async (req, res) => {
  const { workerId, workerType, startDate, endDate } = req.query;

  if (!workerId || !workerType || !startDate || !endDate) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Missing required fields: workerId, workerType, startDate, endDate',
    );
  }

  const report = await workerCommissionService.getWorkerDetailedReport(
    workerId,
    workerType,
    new Date(startDate),
    new Date(endDate),
  );

  res.status(httpStatus.OK).send({
    success: true,
    data: report,
  });
});

/**
 * Get summary of unpaid commissions by worker type
 */
const getUnpaidCommissionsSummary = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  const thickReport =
    await workerCommissionService.getUnpaidWorkerCommissionsReport(
      'THICK',
      startDate ? new Date(startDate) : null,
      endDate ? new Date(endDate) : null,
    );

  const thinReport =
    await workerCommissionService.getUnpaidWorkerCommissionsReport(
      'THIN',
      startDate ? new Date(startDate) : null,
      endDate ? new Date(endDate) : null,
    );

  const totalUnpaidAmount =
    (thickReport.summary?.totalUnpaidAmount || 0) +
    (thinReport.summary?.totalUnpaidAmount || 0);
  const totalWorkers =
    (thickReport.summary?.totalWorkers || 0) +
    (thinReport.summary?.totalWorkers || 0);
  const totalMeasurements =
    (thickReport.summary?.totalMeasurements || 0) +
    (thinReport.summary?.totalMeasurements || 0);

  res.status(httpStatus.OK).send({
    success: true,
    data: {
      summary: {
        totalUnpaidAmount,
        totalWorkers,
        totalMeasurements,
        reportDate: new Date(),
        dateRange: startDate && endDate ? { startDate, endDate } : null,
      },
      thickWorkers: thickReport.workers || [],
      thinWorkers: thinReport.workers || [],
    },
  });
});

/**
 * Get all workers with their unpaid commission amounts
 */
const getAllWorkersWithUnpaidCommissions = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  // Get both thick and thin unpaid workers
  const thickReport =
    await workerCommissionService.getUnpaidWorkerCommissionsReport(
      'THICK',
      startDate ? new Date(startDate) : null,
      endDate ? new Date(endDate) : null,
    );

  const thinReport =
    await workerCommissionService.getUnpaidWorkerCommissionsReport(
      'THIN',
      startDate ? new Date(startDate) : null,
      endDate ? new Date(endDate) : null,
    );

  const allWorkers = [
    ...(thickReport.workers || []),
    ...(thinReport.workers || []),
  ];

  res.status(httpStatus.OK).send({
    success: true,
    data: {
      workers: allWorkers,
      totalWorkers: allWorkers.length,
      totalUnpaidAmount: allWorkers.reduce(
        (sum, worker) => sum + worker.totalUnpaidAmount,
        0,
      ),
    },
  });
});

module.exports = {
  calculateWorkerCommission,
  getUnpaidWorkerCommissionsReport,
  markWorkerAsPaid,
  getWorkerDetailedReport,
  getUnpaidCommissionsSummary,
  getAllWorkersWithUnpaidCommissions,
};
