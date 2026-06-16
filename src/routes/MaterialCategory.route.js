const express = require('express');

const router = express.Router();
const { materialCategoryController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// ✅ Create MaterialCategory
router.post(
  '/api/material-categories',
  auth,
  checkPermission('CREATE_MATERIAL_CATEGORY'),
  materialCategoryController.createMaterialCategory,
);

// ✅ Get all Material Categories
router.get(
  '/api/material-categories',
  // checkPermission('VIEW_MATERIAL_CATEGORY'),
  materialCategoryController.getMaterialCategories,
);

// ✅ Get Material Category by ID
router.get(
  '/api/material-categories/:id',
  auth,
  // checkPermission('VIEW_MATERIAL_CATEGORY'),
  materialCategoryController.getMaterialCategory,
);

// ✅ Search Material Category by Name
router.get(
  '/api/material-categories/search/name/:name',
  auth,
  // checkPermission('VIEW_MATERIAL_CATEGORY'),
  materialCategoryController.getMaterialCategoryByName,
);

// ✅ Update Material Category
router.put(
  '/api/material-categories/:id',
  auth,
  checkPermission('UPDATE_MATERIAL_CATEGORY'),
  materialCategoryController.updateMaterialCategory,
);

// ✅ Delete Material Category
router.delete(
  '/api/material-categories/:id',
  auth,
  checkPermission('DELETE_MATERIAL_CATEGORY'),
  materialCategoryController.deleteMaterialCategory,
);

module.exports = router;
