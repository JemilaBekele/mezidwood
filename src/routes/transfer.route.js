// routes/transfer.routes.js
const express = require('express');

const router = express.Router();
const { transferController } = require('../controllers');
const auth = require('../middlewares/auth');
// const checkPermission = require('../middlewares/permission.middleware');

// Create a transfer
router.post(
  '/api/transfers',
  auth,
  //   checkPermission('CREATE_TRANSFER'),
  transferController.createTransfer,
);

// Get a transfer by ID
router.get(
  '/api/transfers/:id',
  auth,
  //   checkPermission('VIEW_TRANSFER'),
  transferController.getTransfer,
);

// Get a transfer by reference
router.get(
  '/api/transfers/reference/:reference',
  auth,
  //   checkPermission('VIEW_TRANSFER'),
  transferController.getTransferByReference,
);

// Get all transfers
router.get(
  '/api/transfers',
  auth,
  //   checkPermission('VIEW_ALL_TRANSFERS'),
  transferController.getTransfers,
);

// Update a transfer
router.put(
  '/api/transfers/:id',
  auth,
  //   checkPermission('UPDATE_TRANSFER'),
  transferController.updateTransfer,
);
// Get batches by transfer ID

// Bulk update additional prices
router.put(
  '/api/transfers/batches/additional-prices',
  auth,
  // checkPermission('UPDATE_ADDITIONAL_PRICES'), // optional permission check
  transferController.bulkUpdatePrices,
);
// Complete a transfer
router.post(
  '/api/transfers/:id/complete',
  auth,
  //   checkPermission('COMPLETE_TRANSFER'),
  transferController.completeTransfer,
);

// Cancel a transfer
router.post(
  '/api/transfers/:id/cancel',
  auth,
  //   checkPermission('CANCEL_TRANSFER'),
  transferController.cancelTransfer,
);

// Delete a transfer
router.delete(
  '/api/transfers/:id',
  auth,
  //   checkPermission('DELETE_TRANSFER'),
  transferController.deleteTransfer,
);

module.exports = router;
