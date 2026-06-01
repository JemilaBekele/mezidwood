const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { dashboardService } = require('../services');

// ==================== COUNT CARDS ====================
const getCountCards = catchAsync(async (req, res) => {
  const data = await dashboardService.getCountCards();

  res.status(httpStatus.OK).send({
    success: true,
    data,
  });
});

// ==================== PAYMENT BAR CHART ====================
const getPaymentBarChart = catchAsync(async (req, res) => {
  const data = await dashboardService.getPaymentBarChart();

  res.status(httpStatus.OK).send({
    success: true,
    data,
  });
});

// ==================== LOW STOCK ALERT ====================
const getLowStockAlerts = catchAsync(async (req, res) => {
  const data = await dashboardService.getLowStockAlerts();

  res.status(httpStatus.OK).send({
    success: true,
    data,
  });
});

// ==================== TOP PURCHASE PRODUCTS ====================
const getTopPurchaseProducts = catchAsync(async (req, res) => {
  const limit = req.query.limit || 5;

  const data = await dashboardService.getTopPurchaseProducts(Number(limit));

  res.status(httpStatus.OK).send({
    success: true,
    data,
  });
});

// ==================== TOP SOLD PRODUCTS ====================
const getTopSoldProducts = catchAsync(async (req, res) => {
  const limit = req.query.limit || 5;

  const data = await dashboardService.getTopSoldProducts(Number(limit));

  res.status(httpStatus.OK).send({
    success: true,
    data,
  });
});

// ==================== AGING INVENTORY ====================
const getAgingInventory = catchAsync(async (req, res) => {
  const limit = req.query.limit || 10;

  const data = await dashboardService.getAgingInventory(Number(limit));

  res.status(httpStatus.OK).send({
    success: true,
    data,
  });
});

// ==================== COMPLETE DASHBOARD ====================
const getCompleteDashboardData = catchAsync(async (req, res) => {
  const data = await dashboardService.getCompleteDashboardData();

  res.status(httpStatus.OK).send({
    success: true,
    data,
  });
});

// ==================== DASHBOARD WITH FILTER ====================
const getDashboardDataWithFilters = catchAsync(async (req, res) => {
  const filters = {
    startDate: req.query.startDate,
    endDate: req.query.endDate,
    branchId: req.query.branchId,
    shopId: req.query.shopId,
    storeId: req.query.storeId,
  };

  const data = await dashboardService.getDashboardDataWithFilters(filters);

  res.status(httpStatus.OK).send({
    success: true,
    data,
  });
});

// ==================== MONTHLY SALES TREND ====================
const getMonthlySalesTrend = catchAsync(async (req, res) => {
  const months = req.query.months || 6;

  const data = await dashboardService.getMonthlySalesTrend(Number(months));

  res.status(httpStatus.OK).send({
    success: true,
    data,
  });
});

module.exports = {
  getCountCards,
  getPaymentBarChart,
  getLowStockAlerts,
  getTopPurchaseProducts,
  getTopSoldProducts,
  getAgingInventory,
  getCompleteDashboardData,
  getDashboardDataWithFilters,
  getMonthlySalesTrend,
};
