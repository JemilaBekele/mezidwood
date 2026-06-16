const express = require('express');

const router = express.Router();
const { transferController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// Create a transfer
router.post(
  '/api/transfers',
  auth,
  checkPermission('CREATE_TRANSFER'),
  transferController.createTransfer,
);

// Get all transfers (with optional filtering)
router.get(
  '/api/transfers/getall',
  auth,
  checkPermission('VIEW_ALL_TRANSFERS'),
  transferController.getTransfers,
);

// Get transfer statistics
router.get(
  '/api/transfers/stats',
  auth,
  // checkPermission('VIEW_TRANSFER_STATS'),
  transferController.getTransferStats,
);

// Get transfer by shortCode (must come before /:id to avoid conflict)
router.get(
  '/api/transfers/shortcode/:shortCode',
  auth,
  // checkPermission('VIEW_TRANSFER'),
  transferController.getTransferByShortCode,
);

// Get transfer items by transfer ID
router.get(
  '/api/transfers/:id/items',
  auth,
  // checkPermission('VIEW_TRANSFER'),
  transferController.getTransferItems,
);

// Get transfer by ID
router.get(
  '/api/transfers/:id',
  auth,
  checkPermission('VIEW_TRANSFER'),
  transferController.getTransfer,
);

// Update a transfer (only PENDING status)
router.put(
  '/api/transfers/:id',
  auth,
  checkPermission('UPDATE_TRANSFER'),
  transferController.updateTransfer,
);

// Complete a transfer (process stock movement)
router.post(
  '/api/transfers/:id/complete',
  auth,
  checkPermission('COMPLETE_TRANSFER'),
  transferController.completeTransfer,
);

// Cancel a transfer (only PENDING status)
router.post(
  '/api/transfers/:id/cancel',
  auth,
  checkPermission('CANCEL_TRANSFER'),
  transferController.cancelTransfer,
);

// Delete a transfer (reverses stock if completed)
router.delete(
  '/api/transfers/:id',
  auth,
  checkPermission('DELETE_TRANSFER'),
  transferController.deleteTransfer,
);

module.exports = router;
