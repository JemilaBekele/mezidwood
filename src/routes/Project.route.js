const express = require('express');

const router = express.Router();
const { projectController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// Create Project
router.post(
  '/api/projects',
  auth,
  checkPermission('CREATE_PROJECT'),
  projectController.createProject,
);

// Get all Projects with filtering
router.get(
  '/api/projects',
  auth,
  checkPermission('VIEW_PROJECTS'),
  projectController.getProjects,
);

router.get(
  '/api/projects/By/status',
  // checkPermission('VIEW_PROJECT'),
  projectController.getAllProjectBystatus,
);
router.post(
  '/api/projects/:projectId/auto-schedule',
  auth,
  projectController.autoScheduleProjectStages,
);
router.post(
  '/api/projects/:projectId/manual-schedule',
  auth,
  projectController.manualScheduleProjectStage,
);

// Set schedule mode (AUTO | MANUAL | LOCKED) — lock/unlock a project's dates
router.patch(
  '/api/projects/:id/schedule-mode',
  auth,
  // checkPermission('UPDATE_PROJECT'),
  projectController.setScheduleMode,
);

// Cancel a single stage (release its capacity)
router.patch(
  '/api/projects/:id/cancel-stage',
  auth,
  // checkPermission('UPDATE_STAGE'),
  projectController.cancelProjectStage,
);

// Schedule/delivery audit trail
router.get(
  '/api/projects/:id/schedule-history',
  auth,
  // checkPermission('VIEW_PROJECT'),
  projectController.getScheduleHistory,
);

// Get Project by ID
router.get(
  '/api/projects/:id',
  auth,
  checkPermission('VIEW_PROJECT'),
  projectController.getProject,
);

// Search Projects by customer or invoice
router.get(
  '/api/projects/search/query',
  auth,
  // checkPermission('VIEW_PROJECT'),
  projectController.searchProjects,
);

// Get Projects by Customer ID
router.get(
  '/api/projects/customer/:customerId',
  auth,
  // checkPermission('VIEW_PROJECT'),
  projectController.getCustomerProjects,
);

// Get Project Statistics
router.get(
  '/api/projects/statistics/overview',
  auth,
  // checkPermission('VIEW_PROJECT'),
  projectController.getProjectStatistics,
);

// Update Project
router.put(
  '/api/projects/:id',
  auth,
  checkPermission('UPDATE_PROJECT'),
  projectController.updateProject,
);

// Update Project Status
router.patch(
  '/api/projects/:id/status',
  auth,
  // checkPermission('UPDATE_PROJECT'),
  projectController.updateProjectStatus,
);
router.patch(
  '/api/projects/:id/design/status',
  auth,
  // checkPermission('UPDATE_PROJECT'),
  projectController.updateProjectDesignStatus,
);
// Calculate Project Delivery
router.post(
  '/api/projects/:id/calculate-delivery',
  auth,
  // checkPermission('UPDATE_PROJECT'),
  projectController.calculateDelivery,
);

// Delete Project
router.delete(
  '/api/projects/:id',
  auth,
  checkPermission('DELETE_PROJECT'),
  projectController.deleteProject,
);
router.delete(
  '/api/projects/stage/delete/spe',
  auth,
  checkPermission('DELETE_PROJECT'),
  projectController.deleteProjectStage,
);
// ============================================
// UPDATE PROJECT STAGE
// ============================================
router.put(
  '/api/project-stages/update',
  auth,
  checkPermission('UPDATE_PROJECT_STAGE'),
  projectController.updateProjectStage,
);

// ============================================
// GET CAPACITY ANALYSIS
// ============================================
router.post(
  '/api/project-stages/capacity-analysis',
  auth,
  projectController.getCapacityAnalysis,
);

// ============================================
// GET DAILY CAPACITY STATUS
// ============================================
router.get(
  '/api/project-stages/capacity-status',
  auth,
  projectController.getDailyCapacityStatus,
);

// ============================================
// FORCE OVER-CAPACITY ALLOCATION
// ============================================
router.post(
  '/api/project-stages/over-capacity',
  auth,
  projectController.addOverCapacity,
);

// ============================================
// RESCHEDULE FROM CALENDAR (drag-and-drop)
// ============================================
router.post(
  '/api/projects/:id/reschedule-from-calendar',
  auth,
  projectController.rescheduleFromCalendar,
);

module.exports = router;
