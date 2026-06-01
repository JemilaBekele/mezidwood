const express = require('express');

const router = express.Router();
const { dashboardController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// ==================== COUNT CARDS ====================
router.get(
  '/api/dashboard/count-cards',
  auth,
  // checkPermission('VIEW_DASHBOARD_MAIN'),
  dashboardController.getCountCards,
);

// ==================== PAYMENT BAR CHART ====================
router.get(
  '/api/dashboard/payment-chart',
  auth,
  // checkPermission('VIEW_DASHBOARD_MAIN'),
  dashboardController.getPaymentBarChart,
);

// ==================== LOW STOCK ALERT ====================
router.get(
  '/api/dashboard/low-stock',
  auth,
  // checkPermission('VIEW_DASHBOARD_MAIN'),
  dashboardController.getLowStockAlerts,
);

// ==================== TOP PURCHASE PRODUCTS ====================
router.get(
  '/api/dashboard/top-purchase',
  auth,
  // checkPermission('VIEW_DASHBOARD_MAIN'),
  dashboardController.getTopPurchaseProducts,
);

// ==================== TOP SOLD PRODUCTS ====================
router.get(
  '/api/dashboard/top-sold',
  auth,
  // checkPermission('VIEW_DASHBOARD_MAIN'),
  dashboardController.getTopSoldProducts,
);

// ==================== AGING INVENTORY ====================
router.get(
  '/api/dashboard/aging-inventory',
  auth,
  // checkPermission('VIEW_DASHBOARD_MAIN'),
  dashboardController.getAgingInventory,
);

// ==================== COMPLETE DASHBOARD ====================
router.get(
  '/api/dashboard',
  auth,
  // checkPermission('VIEW_DASHBOARD_MAIN'),
  dashboardController.getCompleteDashboardData,
);

// ==================== DASHBOARD WITH FILTER ====================
router.get(
  '/api/dashboard/filter',
  auth,
  // checkPermission('VIEW_DASHBOARD_MAIN'),
  dashboardController.getDashboardDataWithFilters,
);

// ==================== MONTHLY SALES TREND ====================
router.get(
  '/api/dashboard/monthly-trend',
  auth,
  // checkPermission('VIEW_DASHBOARD_MAIN'),
  dashboardController.getMonthlySalesTrend,
);

module.exports = router;
