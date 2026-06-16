const express = require('express');

const router = express.Router();
const auth = require('../middlewares/auth');
const { roleController } = require('../controllers');

// Role Routes
router.post('/api/roles', roleController.createRole);
router.get('/api/roles', roleController.getAllRoles);
router.get('/api/roles/:id', roleController.getRoleById);
// router.get('/api/roles/name/:name', auth, roleController.getRoleByName);
router.put('/api/roles/:id', auth, roleController.updateRole);
router.delete('/api/roles/:id', auth, roleController.deleteRole);

// // Role-Permission Relationship Routes
// router.post(
//   '/api/roles/:roleId/permissions',

//   roleController.assignPermissions,
// );
// router.post(
//   '/api/roles/:roleId/permissions/:permissionId',
//   auth,
//   roleController.addPermission,
// );
// router.delete(
//   '/api/roles/:roleId/permissions/:permissionId',
//   auth,
//   roleController.removePermission,
// );

module.exports = router;
