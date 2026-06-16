const express = require('express');

const router = express.Router();
const { projectStageWorkLogController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// Create Project Stage Work Log
router.post(
  '/api/project-stage-work-logs',
  auth,
  checkPermission('CREATE_PROJECT_STAGE_WORK_LOG'),
  projectStageWorkLogController.createProjectStageWorkLog,
);

// Delete Project Stage Work Log
router.delete(
  '/api/project-stage-work-logs/:id',
  auth,
  checkPermission('DELETE_PROJECT_STAGE_WORK_LOG'),
  projectStageWorkLogController.deleteProjectStageWorkLog,
);

module.exports = router;
