const express = require('express');

const router = express.Router();
const { showroomController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// Showroom Routes

// Create a showroom
router.post(
  '/api/showrooms',
  auth,
  checkPermission('CREATE_SHOWROOM'),
  showroomController.createShowroom,
);

// Get a showroom by ID
router.get(
  '/api/showrooms/:id',
  auth,
  // checkPermission('VIEW_SHOWROOM'),
  showroomController.getShowroom,
);

// Get all showrooms
router.get(
  '/api/showrooms',
  auth,
  // checkPermission('VIEW_SHOWROOMS'),
  showroomController.getShowrooms,
);

router.get(
  '/api/showrooms/get/all',
  // checkPermission('VIEW_SHOWROOM'),
  showroomController.getAllShowroom,
);

// Get all showrooms based on user
router.get(
  '/api/showrooms/based/user',
  auth,
  // checkPermission('VIEW_SHOWROOM'),
  showroomController.getAllShowroomsBasedUser,
);

// Set main showroom
router.put(
  '/api/showrooms/:id/set-main',
  auth,
  // checkPermission('UPDATE_SHOWROOM'),
  showroomController.setMainShowroom,
);

// Get main showroom
router.get(
  '/api/showrooms/main',
  auth,
  // checkPermission('VIEW_SHOWROOM'),
  showroomController.getMainShowroom,
);

// Update a showroom
router.put(
  '/api/showrooms/:id',
  auth,
  checkPermission('UPDATE_SHOWROOM'),
  showroomController.updateShowroom,
);

// Delete a showroom
router.delete(
  '/api/showrooms/:id',
  auth,
  checkPermission('DELETE_SHOWROOM'),
  showroomController.deleteShowroom,
);

module.exports = router;
