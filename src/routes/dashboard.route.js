const express = require('express');

const router = express.Router();
const { reportController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// Get Complete Static Report
router.get(
  '/api/reports/complete-static',
  auth,
  // checkPermission('VIEW_COMPLETE_STATISTICAL_REPORT'),
  reportController.getCompleteStaticReport,
);
router.get(
  '/api/reports/detailed-finished-products',
  auth,
  checkPermission('VIEW_DETAILED_FINISHED_PRODUCTS'),
  reportController.getDetailedFinishedProductsReport,
);
// Get Monthly Breakdown
router.get(
  '/api/reports/monthly-breakdown',
  auth,
  checkPermission('VIEW_DASHBOARD_COUNTS'),
  reportController.getMonthlyBreakdown,
);
// Get Combined Report
router.get(
  '/api/reports/combined',
  auth,
  // checkPermission('VIEW_COMBINED_REPORT'),
  reportController.getCombinedReport,
);

// Get Dashboard Count Cards
router.get(
  '/api/reports/count-cards',
  auth,
  checkPermission('VIEW_DASHBOARD_COUNTS'),
  reportController.getDashboardCounts,
);
router.get(
  '/api/reports/delivery-date-comparison',
  auth,
  // checkPermission('VIEW_DELIVERY_DATE_REPORT'),
  reportController.getDeliveryDateComparisonReport,
);
module.exports = router;
