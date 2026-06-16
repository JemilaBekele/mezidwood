const express = require('express');

const router = express.Router();
const auth = require('../middlewares/auth');
const schedulingSettingsController = require('../controllers/SchedulingSettings.controller');

// Read the business-tunable scheduling settings (delivery formula knobs).
router.get(
  '/api/scheduling-settings',
  auth,
  // checkPermission('VIEW_SETTINGS'),
  schedulingSettingsController.getSettings,
);

// Update the scheduling settings (contingency days, difficulty %, working hours).
router.put(
  '/api/scheduling-settings',
  auth,
  // checkPermission('UPDATE_SETTINGS'),
  schedulingSettingsController.updateSettings,
);

module.exports = router;
