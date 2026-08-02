const express = require('express');
const { deliveryEstimationController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');
const validate = require('../middlewares/validate');
const { projectValidation } = require('../validations');

const router = express.Router();

// Create Delivery Estimation createProjectFromDeliveryEstimation
router.post(
  '/api/delivery-estimations',
  auth,
  checkPermission('CREATE_DELIVERY_ESTIMATION'),
  validate(projectValidation.createDeliveryEstimation),
  deliveryEstimationController.createDeliveryEstimation,
);

router.post(
  '/api/delivery-estimations/create-project',
  auth,
  // checkPermission('CREATE_PROJECT_FROM_DELIVERY_ESTIMATION'),
  deliveryEstimationController.createProjectFromDeliveryEstimation,
);
router.post(
  '/api/delivery-estimations/stage-quantities',
  auth,
  validate(projectValidation.deriveStageQuantities),
  deliveryEstimationController.deriveStageQuantities,
);
router.post(
  '/api/delivery-estimations/calculate',
  auth,
  // checkPermission('CALCULATE_DELIVERY_ESTIMATION'),
  validate(projectValidation.calculateDeliveryEstimation),
  deliveryEstimationController.calculateDeliveryEstimation,
);

// Get all Delivery Estimations
router.get(
  '/api/delivery-estimations',
  auth,
  checkPermission('VIEW_DELIVERY_ESTIMATION'),
  deliveryEstimationController.getDeliveryEstimations,
);
router.get(
  '/api/delivery-estimations/All/OnHold',
  auth,
  // checkPermission('VIEW_DELIVERY_ESTIMATION'),
  deliveryEstimationController.getAllOnHoldDeliveryEstimations,
);

// Get Delivery Estimation by ID
router.get(
  '/api/delivery-estimations/:id',
  auth,
  // checkPermission('VIEW_DELIVERY_ESTIMATION'),
  deliveryEstimationController.getDeliveryEstimation,
);

// Search Delivery Estimations by Customer Name
router.get(
  '/api/delivery-estimations/search/customer',
  auth,
  // checkPermission('VIEW_DELIVERY_ESTIMATION'),
  deliveryEstimationController.searchEstimationsByCustomer,
);

// Update Delivery Estimation
router.patch(
  '/api/delivery-estimations/:id',
  auth,
  // checkPermission('UPDATE_DELIVERY_ESTIMATION'),
  deliveryEstimationController.updateDeliveryEstimation,
);

// Delete Delivery Estimation
router.delete(
  '/api/delivery-estimations/:id',
  auth,
  checkPermission('DELETE_DELIVERY_ESTIMATION'),
  deliveryEstimationController.deleteDeliveryEstimation,
);

// Update Delivery Estimation Status
router.patch(
  '/api/delivery-estimations/:id/status',
  auth,
  // checkPermission('UPDATE_DELIVERY_ESTIMATION_STATUS'),
  deliveryEstimationController.updateEstimationStatus,
);

// Put Delivery Estimation on Hold
router.patch(
  '/api/delivery-estimations/:id/hold',
  auth,
  // checkPermission('UPDATE_DELIVERY_ESTIMATION_HOLD'),
  deliveryEstimationController.putEstimationOnHold,
);

// Confirm Delivery Estimation
router.patch(
  '/api/delivery-estimations/:id/confirm',
  auth,
  // checkPermission('CONFIRM_DELIVERY_ESTIMATION'),
  deliveryEstimationController.confirmEstimation,
);

// Get Delivery Estimations by Status
router.get(
  '/api/delivery-estimations/status/:status',
  auth,
  // checkPermission('VIEW_DELIVERY_ESTIMATION'),
  deliveryEstimationController.getEstimationsByStatus,
);

// Get Delivery Estimation Statistics
router.get(
  '/api/delivery-estimations/stats/summary',
  auth,
  // checkPermission('VIEW_DELIVERY_ESTIMATION_STATS'),
  deliveryEstimationController.getEstimationStatistics,
);

// Expire Old Estimations (Admin/System endpoint)
router.post(
  '/api/delivery-estimations/admin/expire-old',
  auth,
  // Add admin middleware if needed
  // requireAdmin,
  deliveryEstimationController.expireOldEstimations,
);

module.exports = router;
