const express = require('express');

const router = express.Router();
const auth = require('../middlewares/auth');
const { stage } = require('../controllers');
const checkPermission = require('../middlewares/permission.middleware');

router.get(
  '/api/metal-work-projects',
  auth,
  checkPermission('VIEW_METAL_WORK_PROJECTS'),
  stage.getMetalWorkProjects,
);

router.get(
  '/api/stage/design-projects',
  auth,
  checkPermission('VIEW_DESIGN_PROJECTS'),
  stage.getDesignProjects,
);
router.get(
  '/api/stage/design-projects/bydesigner',
  auth,
  checkPermission('VIEW_DESIGN_PROJECTS_BY_DESIGNER'),
  stage.getbyDesignProject,
);
router.get(
  '/api/stage/design-projects/Unassigned',
  auth,
  checkPermission('VIEW_UNASSIGNED_DESIGN_PROJECTS'),
  stage.getUnassignedDesignProjects,
);
router.get(
  '/api/stage/purchasing-projects',
  auth,
  checkPermission('VIEW_PURCHASING_PROJECTS'),
  stage.getPurchasingProjects,
);
// Get all purchases with stock check (with optional filters)
router.get(
  '/api/purchases/usage/report',
  auth,
  checkPermission('VIEW_MATERIAL_USAGE_REPORT'),
  stage.getMaterialUsageReport,
);
router.get(
  '/api/stage/cnc-work-projects',
  auth,
  checkPermission('VIEW_CNC_PROJECTS'),
  stage.getCNCProjects,
);
router.get(
  '/api/stage/cutting-work-projects',
  auth,
  checkPermission('VIEW_CUTTING_PROJECTS'),
  stage.getCuttingProjects,
);
router.get(
  '/api/stage/EdgeBanding-projects',
  auth,
  checkPermission('VIEW_EDGE_BANDING_PROJECTS'),
  stage.getEdgeBandingProjects,
);
router.get(
  '/api/stage/Assembly-projects',
  auth,
  checkPermission('VIEW_ASSEMBLY_PROJECTS'),
  stage.getAssemblyProjects,
);
router.get(
  '/api/stage/painting-projects',
  auth,
  checkPermission('VIEW_PAINTING_PROJECTS'),
  stage.getPaintingProjects,
);
router.get(
  '/api/stage/finished-projects',
  auth,
  checkPermission('VIEW_FINISHED_PROJECTS'),
  stage.getFinishingProjects,
);
router.get(
  '/api/stage/delivery-projects',
  auth,
  checkPermission('VIEW_DELIVERY_PROJECTS'),
  stage.getDeliveryProjects,
);
router.get(
  '/api/stage/instalation-projects',
  auth,
  checkPermission('VIEW_INSTALLATION_PROJECTS'),
  stage.getInstallationProjects,
);

module.exports = router;
