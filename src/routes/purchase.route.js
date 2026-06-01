const express = require('express');

const router = express.Router();
const { purchaseController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// Create a purchase
router.post(
  '/api/purchases',
  auth,
  checkPermission('CREATE_PURCHASE'),
  purchaseController.createPurchase,
);

// Get a purchase by ID
router.get(
  '/api/purchases/:id',
  //   checkPermission('VIEW_PURCHASE'),
  purchaseController.getPurchase,
);

// Get a purchase by invoice number
router.get(
  '/api/purchases/invoice/:invoiceNo',
  auth,
  //   checkPermission('VIEW_PURCHASE'),
  purchaseController.getPurchaseByInvoice,
);

// Get all purchases
router.get(
  '/api/purchases',
  auth,
  //   checkPermission('VIEW_ALL_PURCHASES'),
  purchaseController.getPurchases,
);

// Update a purchase
router.put(
  '/api/purchases/:id',
  auth,
  checkPermission('UPDATE_PURCHASE'),
  purchaseController.updatePurchase,
);
router.put(
  '/api/purchases/accept/:id',
  auth,
  //   checkPermission('UPDATE_PURCHASE'),
  purchaseController.acceptPurchase,
);

// Delete a purchase
router.delete(
  '/api/purchases/:id',
  auth,
  checkPermission('DELETE_PURCHASE'),
  purchaseController.deletePurchase,
);

module.exports = router;
