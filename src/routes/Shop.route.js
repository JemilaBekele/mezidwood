const express = require('express');

const router = express.Router();
const { shopController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// Create a shop
router.post(
  '/api/shops',
  auth,
  checkPermission('CREATE_SHOP'),
  shopController.createShop,
);

// Get a shop by ID
router.get(
  '/api/shops/:id',
  auth,
  // checkPermission('VIEW_SHOP'),
  shopController.getShop,
);

// Get all shops getAvailableBatchesByProductAndShop
router.get(
  '/api/shops',
  auth,
  // checkPermission('VIEW_SHOP'),
  shopController.getShops,
);
router.get(
  '/api/shops/get/all',
  // checkPermission('VIEW_SHOP'),
  shopController.getAllshop,
);

router.get(
  '/api/shops/based/user',
  auth,
  // checkPermission('VIEW_SHOP'),
  shopController.getAllShopsbaseduser,
);

// Get available batches by product and shop
router.get(
  '/api/shops/:shopId/products/:productId/batches',
  auth,
  // checkPermission('VIEW_SHOP'),
  shopController.getAvailableBatchesByProductAndShop,
);
router.get(
  '/api/shops/:shopId/products/:productId/batches/user/based',
  auth,
  // checkPermission('VIEW_SHOP'),
  shopController.UsergetAvailableBatchesByProductAndShop,
);
// Update a shop
router.put(
  '/api/shops/:id',
  auth,
  checkPermission('UPDATE_SHOP'),
  shopController.updateShop,
);

// Delete a shop
router.delete(
  '/api/shops/:id',
  auth,
  checkPermission('DELETE_SHOP'),
  shopController.deleteShop,
);

module.exports = router;
