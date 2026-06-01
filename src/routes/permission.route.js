const express = require('express');

const router = express.Router();
const auth = require('../middlewares/auth');
const { permissionController } = require('../controllers');

// Permission Routes
// router.post('/api/permissions', permissionController.createPermission);
router.get('/api/permissions', auth, permissionController.getAllPermissions);
router.get(
  '/api/roles/:roleName/permissions',
  permissionController.getPermissionsByRoleName,
);

// router.get(
//   '/api/permissions/:id',
//   auth,
//   permissionController.getPermissionById,
// );
// router.get(
//   '/api/permissions/name/:name',
//   auth,
//   permissionController.getPermissionByName,
// );
// router.put('/api/permissions/:id', auth, permissionController.updatePermission);
router.delete(
  '/api/permissions/:id',
  auth,
  permissionController.deletePermission,
);

module.exports = router;
