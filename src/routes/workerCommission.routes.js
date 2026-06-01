// routes/workerCommission.routes.js

const express = require('express');

const router = express.Router();
const workerCommissionController = require('../controllers/workerCommission.controller');
const auth = require('../middlewares/auth');
// const checkPermission = require('../middlewares/permission.middleware');

// Calculate commission for a specific worker
router.post(
  '/api/worker-commissions/calculate',
  auth,
  //   checkPermission('VIEW_WORKER_COMMISSION'),
  workerCommissionController.calculateWorkerCommission,
);

// Get unpaid workercommissions report
router.get(
  '/api/worker-commissions/unpaid-report',
  auth,
  //   checkPermission('VIEW_WORKER_COMMISSION'),
  workerCommissionController.getUnpaidWorkerCommissionsReport,
);

// Get summary of unpaid commissions by worker type
router.get(
  '/api/worker-commissions/unpaid-summary',
  auth,
  //   checkPermission('VIEW_WORKER_COMMISSION'),
  workerCommissionController.getUnpaidCommissionsSummary,
);

// Get all workers with their unpaid commission amounts
router.get(
  '/api/worker-commissions/unpaid-workers',
  auth,
  //   checkPermission('VIEW_WORKER_COMMISSION'),
  workerCommissionController.getAllWorkersWithUnpaidCommissions,
);

// Mark worker as paid
router.post(
  '/api/worker-commissions/mark-paid',
  auth,
  //   checkPermission('PAY_WORKER_COMMISSION'),
  workerCommissionController.markWorkerAsPaid,
);

// Get detailed worker report
router.get(
  '/api/worker-commissions/worker-detail',
  auth,
  //   checkPermission('VIEW_WORKER_COMMISSION'),
  workerCommissionController.getWorkerDetailedReport,
);

module.exports = router;
