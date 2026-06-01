const express = require('express');

const router = express.Router();

const { productBatchController } = require('../controllers');
const auth = require('../middlewares/auth');
// const checkPermission = require('../middlewares/permission.middleware');

// Create a product batch
router.post(
  '/api/product-batches',
  auth,
  // checkPermission('CREATE_PRODUCT_BATCH'),
  productBatchController.createProductBatch,
);

// Get a product batch by ID
router.get(
  '/api/product-batches/:id',
  auth,
  // checkPermission('VIEW_PRODUCT_BATCH'),
  productBatchController.getProductBatch,
);

// Get all product batches
router.get(
  '/api/product-batches',
  auth,
  // checkPermission('VIEW_ALL_PRODUCT_BATCHES'),
  productBatchController.getProductBatches,
);
// Get Product Info by Batch ID
router.get(
  '/api/product-batches/product/:id/info',
  auth,
  // checkPermission('VIEW_PRODUCT_INFO_BY_BATCH_ID'),
  productBatchController.getProductInfoByBatchIdController,
);

router.get(
  '/api/find/store/:storeId/stock/product', // cmheckPermission('VIEW_PRODUCT_BY_STORE_STOCK'),
  productBatchController.getProductByStoreStock,
);

// ✅ Get product by shop stock
router.get(
  '/api/find/shop/:shopId/stock/product',
  // checkPermission('VIEW_PRODUCT_BY_SHOP_STOCK'),
  productBatchController.getProductByShopStock,
);
// Update a product batch
router.put(
  '/api/product-batches/:id',
  auth,
  // checkPermission('UPDATE_PRODUCT_BATCH'),
  productBatchController.updateProductBatch,
);

// Delete a product batch
router.delete(
  '/api/product-batches/:id',
  auth,
  // checkPermission('DELETE_PRODUCT_BATCH'),
  productBatchController.deleteProductBatch,
);

module.exports = router;
