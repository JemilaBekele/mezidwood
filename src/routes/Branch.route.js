const express = require('express');

const router = express.Router();
const { branchController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// Create a branch
router.post(
  '/api/branches',
  auth,
  checkPermission('CREATE_BRANCH'),
  branchController.createBranch,
);

// Get a branch by ID getAllProducts
router.get(
  '/api/all/Products/stock/employee',
  auth,
  branchController.getAllProducts,
);
router.get(
  '/api/branches/:id',
  auth,
  checkPermission('VIEW_BRANCH'),
  branchController.getBranch,
);

// Get all branches
router.get(
  '/api/branches',
  // checkPermission('VIEW_BRANCH'),
  branchController.getBranches,
);

// Update a branch
router.put(
  '/api/branches/:id',
  auth,
  checkPermission('UPDATE_BRANCH'),
  branchController.updateBranch,
);

// Delete a branch
router.delete(
  '/api/branches/:id',
  auth,
  checkPermission('DELETE_BRANCH'),
  branchController.deleteBranch,
);
router.get(
  '/api/curtain-orders/estimated/delivery/date',
  auth,
  branchController.getEstimatedCurtainDeliveryTime,
);
module.exports = router;
