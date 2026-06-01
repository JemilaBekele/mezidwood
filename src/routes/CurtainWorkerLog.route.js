const express = require('express');

const router = express.Router();
const { curtainWorkerLogController } = require('../controllers');
const auth = require('../middlewares/auth');
// const checkPermission = require('../middlewares/permission.middleware');

// Create a CurtainWorkerLog
router.post(
  '/api/curtain-worker-logs',
  auth,
  // checkPermission('CREATE_CURTAIN_WORKER_LOG'),
  curtainWorkerLogController.createCurtainWorkerLog,
);

// Update a CurtainWorkerLog
router.put(
  '/api/curtain-worker-logs/:id',
  auth,
  // checkPermission('UPDATE_CURTAIN_WORKER_LOG'),
  curtainWorkerLogController.updateCurtainWorkerLog,
);
router.post(
  '/api/curtain-worker-logs/bulk-approve',
  auth,
  curtainWorkerLogController.bulkApproveCurtainWorkerLogs,
);

// Reject Log
router.post(
  '/api/curtain-worker-logs/:id/reject',
  auth,
  curtainWorkerLogController.rejectCurtainWorkerLog,
);
// Get CurtainWorkerLogs by Employee ID
router.get(
  '/api/curtain-worker-logs/employee/:workerId',
  auth,
  // checkPermission('VIEW_CURTAIN_WORKER_LOGS'),
  curtainWorkerLogController.getCurtainWorkerLogsByEmployee,
);

// Get CurtainWorkerLogs by Curtain Measurement ID
router.get(
  '/api/curtain-worker-logs/measurement/:curtainMeasurementId',
  auth,
  // checkPermission('VIEW_CURTAIN_WORKER_LOGS'),
  curtainWorkerLogController.getCurtainWorkerLogsByMeasurement,
);

// Optional: Get a CurtainWorkerLog by ID
router.get(
  '/api/curtain-worker-logs/:id',
  auth,
  // checkPermission('VIEW_CURTAIN_WORKER_LOG'),
  curtainWorkerLogController.getCurtainWorkerLogById,
);

// Optional: Delete a CurtainWorkerLog
router.delete(
  '/api/curtain-worker-logs/:id',
  auth,
  // checkPermission('DELETE_CURTAIN_WORKER_LOG'),
  curtainWorkerLogController.deleteCurtainWorkerLog,
);

module.exports = router;
