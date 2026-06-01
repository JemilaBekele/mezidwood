const express = require('express');

const router = express.Router();
const auth = require('../middlewares/auth');
const { rolePermissionController } = require('../controllers');

// Role-Permission Relationship Routes
router.post(
  '/api/role-permissions',
  auth,
  rolePermissionController.createRolePermission,
);
router.post(
  '/api/role-permissions/assign',
  auth,
  rolePermissionController.assignRolePermissions,
);
router.put(
  '/api/role/permissions/update/assign',
  auth,
  rolePermissionController.updateRolePermissions,
);
router.get(
  '/api/role-permissions',
  auth,
  rolePermissionController.getAllRolePermissions,
);
router.delete(
  '/api/role-permissions/:id',
  auth,
  rolePermissionController.deleteRolePermission,
);

module.exports = router;
