const express = require('express');

const router = express.Router();
const { materialController } = require('../controllers');
const auth = require('../middlewares/auth');
const { uploadImage } = require('../utils/multer');

const checkPermission = require('../middlewares/permission.middleware');

// Create Material
router.post(
  '/api/materials',
  auth,
  uploadImage,

  checkPermission('CREATE_MATERIAL'),
  materialController.createMaterial,
);

// Get all Materials
router.get(
  '/api/materials',
  auth,
  checkPermission('VIEW_MATERIAL_ALL'),
  materialController.getMaterials,
);

// Get Material by ID
router.get(
  '/api/materials/:id',
  auth,
  checkPermission('VIEW_MATERIAL'),
  materialController.getMaterial,
);
router.get(
  '/api/materials/viewmaterial/:id',
  // checkPermission('VIEW_MATERIAL'),
  materialController.getMaterialId,
);

router.get(
  '/api/materials/Stock/available/:id',
  auth,
  // checkPermission('VIEW_MATERIAL'),
  materialController.getMaterialStockById,
);
router.patch(
  '/api/proforma-materials/:id/status',
  auth,
  materialController.updateProformaMaterialStatus,
);
// Update Material
router.put(
  '/api/materials/:id',
  auth,
  uploadImage,
  checkPermission('UPDATE_MATERIAL'),
  materialController.updateMaterial,
);

// Delete Material
router.delete(
  '/api/materials/:id',
  auth,
  checkPermission('DELETE_MATERIAL'),
  materialController.deleteMaterial,
);
router.post(
  '/api/materials/accept-initial-stock',
  auth,
  // checkPermission('MANAGE_MATERIAL_STOCK'),
  materialController.acceptInitialStock,
);
module.exports = router;
