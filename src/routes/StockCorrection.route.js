const express = require('express');

const router = express.Router();
const { stockCorrectionController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// Create a stockcorrection
router.post(
  '/api/stock-corrections',
  auth,
  checkPermission('CREATE_STOCK_CORRECTION'),
  stockCorrectionController.createStockCorrection,
);

// Get a stock correction by ID
router.get(
  '/api/stock-corrections/:id',
  auth,
  //   checkPermission('VIEW_STOCK_CORRECTION'),
  stockCorrectionController.getStockCorrection,
);

router.get(
  '/api/stock-corrections/purchase/:id',
  auth,
  // checkPermission('VIEW_STOCK_CORRECTION'), // Uncomment if you have permission checking
  stockCorrectionController.getStockCorrectionsByPurchaseId,
);

// Get a stock correction by reference
router.get(
  '/api/stock-corrections/reference/:reference',
  auth,
  //   checkPermission('VIEW_STOCK_CORRECTION'),
  stockCorrectionController.getStockCorrectionByReference,
);

// Get all stock corrections
router.get(
  '/api/stock-corrections',
  auth,
  //   checkPermission('VIEW_ALL_STOCK_CORRECTIONS'),
  stockCorrectionController.getStockCorrections,
);

// Update a stock correction
router.put(
  '/api/stock-corrections/:id',
  auth,
  checkPermission('UPDATE_STOCK_CORRECTION'),
  stockCorrectionController.updateStockCorrection,
);

// Approve a stock correction
router.post(
  '/api/stock-corrections/:id/approve',
  auth,
  checkPermission('APPROVE_STOCK_CORRECTION'),
  stockCorrectionController.approveStockCorrection,
);

// Reject a stock correction
router.post(
  '/api/stock-corrections/:id/reject',
  auth,
  checkPermission('REJECT_STOCK_CORRECTION'),
  stockCorrectionController.rejectStockCorrection,
);

// Delete a stock correction
router.delete(
  '/api/stock-corrections/:id',
  auth,
  checkPermission('DELETE_STOCK_CORRECTION'),
  stockCorrectionController.deleteStockCorrection,
);

module.exports = router;
