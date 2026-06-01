const express = require('express');

const router = express.Router();
const { curtainTypeController } = require('../controllers'); // Assuming your controller is curtainTypeController.js
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

/* ──────────────── CURTAIN TYPE ROUTES ──────────────── */

// Create CurtainType
router.post(
  '/api/curtain-types',
  auth,
  checkPermission('CREATE_CURTAIN_TYPE'),
  curtainTypeController.createCurtainType,
);

// Get CurtainType by ID
router.get(
  '/api/curtain-types/:id',
  auth,
  // checkPermission('VIEW_CURTAIN_TYPE'),
  curtainTypeController.getCurtainType,
);

// Get all CurtainTypes
router.get(
  '/api/curtain-types',
  auth,
  // checkPermission('VIEW_CURTAIN_TYPE'),
  curtainTypeController.getCurtainTypes,
);

// Update CurtainType
router.put(
  '/api/curtain-types/:id',
  auth,
  checkPermission('UPDATE_CURTAIN_TYPE'),
  curtainTypeController.updateCurtainType,
);

// Delete CurtainType
router.delete(
  '/api/curtain-types/:id',
  auth,
  checkPermission('DELETE_CURTAIN_TYPE'),
  curtainTypeController.deleteCurtainType,
);

/* ──────────────── MOVEMENT TYPE ROUTES ──────────────── */

// Create MovementType
router.post(
  '/api/movement-types',
  auth,
  checkPermission('CREATE_MOVEMENT_TYPE'),
  curtainTypeController.createMovementType,
);

// Get MovementType by ID
router.get(
  '/api/movement-types/:id',
  auth,
  // checkPermission('VIEW_MOVEMENT_TYPE'),
  curtainTypeController.getMovementType,
);

// Get all MovementTypes
router.get(
  '/api/movement-types',
  // checkPermission('VIEW_MOVEMENT_TYPE'),
  curtainTypeController.getMovementTypes,
);

// Update MovementType
router.put(
  '/api/movement-types/:id',
  auth,
  checkPermission('UPDATE_MOVEMENT_TYPE'),
  curtainTypeController.updateMovementType,
);

// Delete MovementType
router.delete(
  '/api/movement-types/:id',
  auth,
  checkPermission('DELETE_MOVEMENT_TYPE'),
  curtainTypeController.deleteMovementType,
);

module.exports = router;
