const express = require('express');

const router = express.Router();
const { categoryController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// Category Routes
router.post(
  '/api/categories',
  auth,
  checkPermission('CREATE_CATEGORY'),
  categoryController.createCategory,
);

router.get(
  '/api/categories/:id',
  auth,
  //   checkPermission('VIEW_CATEGORY'),
  categoryController.getCategory,
);
router.delete(
  '/api/daily-stage-capacities/reset',
  auth,
  categoryController.resetDailyStageCapacities,
);
// Non-destructive: rebuild the capacity ledger from current projects.
router.post(
  '/api/daily-stage-capacities/rebuild',
  auth,
  categoryController.rebuildCapacityLedger,
);
router.post(
  '/api/daily-stage-capacities/rebuild/week',
  // auth,
  categoryController.rebuildCapacityLedgerweek,
);
router.get(
  '/api/categories',
  checkPermission('VIEW_CATEGORY'),
  categoryController.getCategories,
);
router.get(
  '/api/daily/all/capacity',
  //   checkPermission('VIEW_CATEGORY'),
  categoryController.getAllDailyStageCapacities,
);
router.get(
  '/api/capacity/telemetry',
  categoryController.getCapacityTelemetry,
);
router.get(
  '/api/capacity/stage-load',
  categoryController.getStageLoadRail,
);

router.put(
  '/api/categories/:id',
  auth,
  checkPermission('UPDATE_CATEGORY'),
  categoryController.updateCategory,
);

router.delete(
  '/api/categories/:id',
  auth,
  checkPermission('DELETE_CATEGORY'),
  categoryController.deleteCategory,
);
module.exports = router;
