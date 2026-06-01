const express = require('express');

const router = express.Router();
const auth = require('../middlewares/auth');
const { roleController } = require('../controllers');

// Role Routes
router.post('/api/roles', roleController.createRole);
router.get('/api/roles', roleController.getAllRoles);
router.get('/api/roles/:id', roleController.getRoleById);
router.put('/api/roles/:id', auth, roleController.updateRole);
router.delete('/api/roles/:id', auth, roleController.deleteRole);

module.exports = router;
