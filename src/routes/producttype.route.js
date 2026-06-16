const express = require('express');

const router = express.Router();
const { productConfigurationController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// ==================== ProductCategory Routes ====================

// Create a productcategory
router.post(
  '/api/productcategory',
  auth,
  checkPermission('CREATE_PRODUCT_CATEGORY'),
  productConfigurationController.createProductCategory,
);

// Get all product categories
router.get(
  '/api/productcategory',
  productConfigurationController.getAllProductCategories,
);

// Get product category by ID
router.get(
  '/api/productcategory/:id',
  auth,
  // checkPermission('VIEW_PRODUCT_CATEGORY'),
  productConfigurationController.getProductCategory,
);

// Update product category
router.put(
  '/api/productcategory/:id',
  auth,
  checkPermission('UPDATE_PRODUCT_CATEGORY'),
  productConfigurationController.updateProductCategory,
);

// Delete product category
router.delete(
  '/api/productcategory/:id',
  auth,
  checkPermission('DELETE_PRODUCT_CATEGORY'),
  productConfigurationController.deleteProductCategory,
);

// ==================== ProductType Routes ====================

// Create a product type
router.post(
  '/api/producttypes',
  auth,
  checkPermission('CREATE_PRODUCT_TYPE'),
  productConfigurationController.createProductType,
);

// Get all product types
router.get(
  '/api/producttypes',
  productConfigurationController.getAllProductTypes,
);

// Get product type by ID
router.get(
  '/api/producttypes/:id',
  auth,
  // checkPermission('VIEW_PRODUCT_TYPE'),
  productConfigurationController.getProductType,
);

// Update product type
router.put(
  '/api/producttypes/:id',
  auth,
  checkPermission('UPDATE_PRODUCT_TYPE'),
  productConfigurationController.updateProductType,
);

// Delete product type
router.delete(
  '/api/producttypes/:id',
  auth,
  checkPermission('DELETE_PRODUCT_TYPE'),
  productConfigurationController.deleteProductType,
);

// ==================== Size Routes ====================

// Create a size
router.post(
  '/api/productsizes',
  auth,
  checkPermission('CREATE_SIZE'),
  productConfigurationController.createSize,
);

// Get all sizes
router.get('/api/productsizes', productConfigurationController.getAllSizes);

// Get size by ID
router.get(
  '/api/productsizes/:id',
  auth,
  // checkPermission('VIEW_SIZE'),
  productConfigurationController.getSize,
);

// Update size
router.put(
  '/api/productsizes/:id',
  auth,
  checkPermission('UPDATE_SIZE'),
  productConfigurationController.updateSize,
);

// Delete size
router.delete(
  '/api/productsizes/:id',
  auth,
  checkPermission('DELETE_SIZE'),
  productConfigurationController.deleteSize,
);

module.exports = router;
