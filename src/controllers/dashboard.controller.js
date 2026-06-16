const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { reportService } = require('../services');

// Get Complete Static Report
const getCompleteStaticReport = catchAsync(async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const report = await reportService.getCompleteStaticReport(
      startDate,
      endDate,
    );

    res.status(httpStatus.OK).json({
      success: true,
      message: 'Complete static report fetched successfully',
      data: report,
    });
  } catch (error) {
    // Handle custom ApiError
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Failed to fetch complete static report',
    });
  }
});
// ==================== CONTROLLER ====================

const getMonthlyBreakdown = catchAsync(async (req, res) => {
  try {
    const { year } = req.query;

    const result = await reportService.getMonthlyBreakdown(
      year ? Number(year) : null,
    );

    res.status(httpStatus.OK).json({
      success: true,
      message: 'Monthly breakdown fetched successfully',
      data: result,
    });
  } catch (error) {

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Failed to fetch monthly breakdown',
    });
  }
});

// Get Combined Report
const getCombinedReport = catchAsync(async (req, res) => {
  try {
    const { lowStockThreshold, topItemsLimit, startDate, endDate } = req.query;

    const report = await reportService.getCombinedReport({
      lowStockThreshold: lowStockThreshold ? Number(lowStockThreshold) : 10,
      topItemsLimit: topItemsLimit ? Number(topItemsLimit) : 10,
      startDate,
      endDate,
    });

    res.status(httpStatus.OK).json({
      success: true,
      message: 'Combined report fetched successfully',
      data: report,
    });
  } catch (error) {
    // Handle custom ApiError
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Failed to fetch combined report',
    });
  }
});

// Get Dashboard Count Cards
const getDashboardCounts = catchAsync(async (req, res) => {
  try {
    const counts = await reportService.getDashboardCounts();

    res.status(httpStatus.OK).json({
      success: true,
      message: 'Count cards fetched successfully',
      data: counts,
    });
  } catch (error) {
    // Prisma error handling
    if (error.code) {
      console.error('Prisma error code:', error.code);
      console.error('Prisma error meta:', error.meta);
    }

    // Handle custom ApiError
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Failed to fetch count cards',
    });
  }
});
const getDetailedFinishedProductsReport = catchAsync(async (req, res) => {
  try {
    const { startDate, endDate, materialTypes } = req.query;

    // Default material types
    const parsedMaterialTypes = materialTypes
      ? materialTypes.split(',')
      : ['plainMDF', 'laminatedMDF', 'wood', 'metal'];

    const report =
      await reportService.getDetailedFinishedProductsReportFunctional(
        new Date(startDate),
        new Date(endDate),
        parsedMaterialTypes,
      );

    res.status(httpStatus.OK).json({
      success: true,
      message: 'Detailed finished products report fetched successfully',
      data: report,
    });
  } catch (error) {
    // Prisma error handling
    if (error.code) {
      console.error('Prisma error code:', error.code);
      console.error('Prisma error meta:', error.meta);
    }

    // Handle custom ApiError
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Failed to fetch detailed finished products report',
    });
  }
});
const getDeliveryDateComparisonReport = catchAsync(async (req, res) => {
  try {
    const report =
      await reportService.getDeliveryDateComparisonReportFunctional();

    res.status(httpStatus.OK).json({
      success: true,
      message: 'Delivery date comparison report fetched successfully',
      data: report,
    });
  } catch (error) {
    // Prisma error handling
    if (error.code) {
      console.error('Prisma error code:', error.code);
      console.error('Prisma error meta:', error.meta);
    }

    // Handle custom ApiError
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Failed to fetch delivery date comparison report',
    });
  }
});
module.exports = {
  getDeliveryDateComparisonReport,
  getDetailedFinishedProductsReport,
  getCompleteStaticReport,
  getCombinedReport,
  getDashboardCounts,
  getMonthlyBreakdown,
};
