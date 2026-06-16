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

router.get('/api/stores/get/all', storeController.getAllStore);

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

// Set main store
router.put(
  '/api/stores/:id/set-main',
  auth,
  // checkPermission('UPDATE_STORE'),
  storeController.setMainStore,
);

// Get main store
router.get(
  '/api/stores/main',
  auth,
  // checkPermission('VIEW_STORE'),
  storeController.getMainStore,
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

// Get Items by Store
router.get(
  '/api/store/:storeId/items',
  auth,
  // checkPermission('VIEW_ITEM'),
  storeController.getItemsByStore,
);

// Get Materials by Store
router.get(
  '/api/store/:storeId/materials',
  auth,
  // checkPermission('VIEW_MATERIAL'),
  storeController.getMaterialsByStore,
);

// =======================
// Showroom Routes
// =======================

// Get Items by Showroom
router.get(
  '/api/showroom/:showroomId/items',
  auth,
  // checkPermission('VIEW_ITEM'),
  storeController.getItemsByShowroom,
);

// Get Materials by Showroom
router.get(
  '/api/showroom/:showroomId/materials',
  auth,
  // checkPermission('VIEW_MATERIAL'),
  storeController.getMaterialsByShowroom,
);
module.exports = router;
