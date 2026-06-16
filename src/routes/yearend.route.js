// routes/v1/yearEndReset.js
const express = require('express');
const { yearEndResetController } = require('../controllers');
const auth = require('../middlewares/auth');
// const checkPermission = require('../../middlewares/permission.middleware');

const router = express.Router();
router.post('/api/factory-reset', auth, yearEndResetController.factoryReset);
router.post('/api/year-end-reset', auth, yearEndResetController.yearEndReset);
module.exports = router;
