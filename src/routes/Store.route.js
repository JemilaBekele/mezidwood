const express = require('express');

const router = express.Router();
const { storeController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// Store Routes

// Create a store
router.post(
  '/api/stores',
  auth,
  checkPermission('CREATE_STORE'),
  storeController.createStore,
);
router.get(
  '/api/stores/get/all',
  // checkPermission('CREATE_STORE'),
  storeController.getAllStore,
);

// Get a store by ID
router.get(
  '/api/stores/:id',
  auth,
  // checkPermission('VIEW_STORE'),
  storeController.getStore,
);

// Get all stores (with query parameters support)
router.get(
  '/api/stores',
  auth,
  // checkPermission('VIEW_STORE'),
  storeController.getStores,
);

// Update a store
router.put(
  '/api/stores/:id',
  auth,
  checkPermission('UPDATE_STORE'),
  storeController.updateStore,
);

// Delete a store
router.delete(
  '/api/stores/:id',
  auth,
  checkPermission('DELETE_STORE'),
  storeController.deleteStore,
);
router.get('/api/stores/ledgers/all', auth, storeController.getAllStockLedgers);
router.get('/api/stores/shop/stocks', auth, storeController.getAllShopStocks);
router.get(
  '/api/stores/store/stocks',
  auth,
  storeController.getAllStoresStocks,
);
module.exports = router;
