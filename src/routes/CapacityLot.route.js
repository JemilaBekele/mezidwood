const express = require('express');

const router = express.Router();
const { capacityController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// Create Capacity Slot
router.post(
  '/api/capacity-slots',
  auth,
  checkPermission('CREATE_CAPACITY_SLOT'),
  capacityController.createCapacitySlot,
);
// Capacity Report
router.get('/api/reports/capacity', auth, capacityController.getCapacityReport);
// Get all Capacity Slots
router.get(
  '/api/capacity-slots',
  // checkPermission('VIEW_CAPACITY_SLOT'),
  capacityController.getCapacitySlots,
);

// Get Capacity Slot by ID
router.get(
  '/api/capacity-slots/:id',
  auth,
  // checkPermission('VIEW_CAPACITY_SLOT'),
  capacityController.getCapacitySlot,
);

// Get Capacity Slot by Stage
router.get(
  '/api/capacity-slots/stage/:stage',
  auth,
  // checkPermission('VIEW_CAPACITY_SLOT'),
  capacityController.getCapacitySlotByStage,
);

// Update Capacity Slot
router.put(
  '/api/capacity-slots/:id',
  auth,
  checkPermission('UPDATE_CAPACITY_SLOT'),
  capacityController.updateCapacitySlot,
);

// Delete Capacity Slot
router.delete(
  '/api/capacity-slots/:id',
  auth,
  checkPermission('DELETE_CAPACITY_SLOT'),
  capacityController.deleteCapacitySlot,
);

module.exports = router;
