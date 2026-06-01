const express = require('express');

const router = express.Router();
const { curtainOrderController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// Create a curtain order
router.post(
  '/api/curtain-orders',
  auth,
  checkPermission('CREATE_CURTAIN_ORDER'),
  curtainOrderController.createCurtainOrder,
);
router.post(
  '/api/curtain/measurements/order/:orderId',
  auth,
  curtainOrderController.createCurtainMeasurement,
);
router.patch(
  '/api/curtain/measurements/order/:orderId/bulk-update',
  auth,
  curtainOrderController.bulkUpdateCurtainMeasurements,
);
router.put(
  '/api/curtain-orders/:orderId/delivery-deadline',
  auth,
  checkPermission('UPDATE_CURTAIN_DELIVERY_DEADLINE'), // Optional like your branch routes
  curtainOrderController.updateCurtainOrderDeliveryDeadlineController,
);
// Update measurements   by order  createsecondCurtainMeasurement, updatesecondCurtainOrderShop, ,
router.put(
  '/api/curtain-measurements/order/:orderId',
  auth,
  curtainOrderController.updateCurtainOrderShop,
);
// router.put(
//   '/api/curtain-orders/:orderId/delivery-deadline',
//   auth,
//   curtainOrderController.updateCurtainOrderDeliveryDeadlineController,
// );
router.get(
  '/api/reports/worker-payments',
  auth,
  curtainOrderController.getWorkerPaymentReportController,
);

router.put(
  '/api/curtain-measurements/:measurementId/mark-paid',
  auth,
  curtainOrderController.markWorkerAsPaidController,
);
router.get(
  '/api/curtain-orders/pending',
  auth,
  curtainOrderController.getPendingCurtainOrdersController,
);
router.post(
  '/api/curtain/measurements/seconds/order/:orderId',
  auth,
  curtainOrderController.createsecondCurtainMeasurement,
);
router.patch(
  '/api/curtain/orders/:orderId/payment',
  auth,
  checkPermission('UPDATE_CURTAIN_ORDER_PAYMENT'), // Optional like your branch routes
  curtainOrderController.updateCurtainOrderPaymentController,
);
router.get(
  '/api/reports/invoice',
  auth,
  curtainOrderController.getInvoiceReportController,
);
/**
 * 📊 Update order & payment status
 */
router.get(
  '/api/curtain/orders/delivered/by/me/getall',
  auth,
  curtainOrderController.getCurtainOrdersByDeliveredByController,
);

router.patch(
  '/api/curtain/orders/:orderId/status',
  auth,
  checkPermission('UPDATE_CURTAIN_ORDER_STATUS'), // Optional like your branch routes
  curtainOrderController.updateCurtainOrderStatusController,
);
// Update measurements by order  createsecondCurtainMeasurement, updatesecondCurtainOrderShop, ,
router.put(
  '/api/curtain-measurements/seconds/order/:orderId',
  auth,
  curtainOrderController.updatesecondCurtainOrderShop,
);
// Get a curtain order by ID getthikthinCurtainOrderById,getshatterCurtainOrderById
router.get(
  '/api/curtain-orders/:id',
  auth,
  checkPermission('VIEW_CURTAIN_ORDER'), // Optional like your branch routes
  curtainOrderController.getCurtainOrder,
);
router.get(
  '/api/curtain/orders/thikthin/:id',
  auth,
  // checkPermission('VIEW_CURTAIN_ORDER'), // Optional like your branch routes
  curtainOrderController.getthikthinCurtainOrderById,
);
router.get(
  '/api/curtain/orders/shatter/:id',
  // auth,
  // checkPermission('VIEW_CURTAIN_ORDER'), // Optional like your branch routes
  curtainOrderController.getshatterCurtainOrderById,
);
// Add this to your existing curtainOrder routes file
router.patch(
  '/api/curtain/measurements/shatter-vertical/order/:orderId/bulk-update',
  auth,
  curtainOrderController.bulkUpdateShatterVerticalMeasurementsController,
);
// Get all curtain orders
router.get(
  '/api/curtain-orders',
  auth,
  // checkPermission('VIEW_CURTAIN_ORDER'), // Optional like your branch routes
  curtainOrderController.getCurtainOrders,
);

// Get my curtain orders (created by current user)
router.get(
  '/api/curtain-orders/my/orders',
  auth,
  // checkPermission('VIEW_CURTAIN_ORDER'), // Optional like your branch routes
  curtainOrderController.getMyCurtainOrders,
);

// Get curtain orders by customer ID
router.get(
  '/api/curtain-orders/customer/:customerId',
  auth,
  // checkPermission('VIEW_CURTAIN_ORDER'), // Optional like your branch routes
  curtainOrderController.getCurtainOrdersByCustomer,
);

// Search curtain orders by criteria
router.get(
  '/api/curtain-orders/search',
  auth,
  // checkPermission('VIEW_CURTAIN_ORDER'), // Optional like your branch routes
  curtainOrderController.searchCurtainOrders,
);

// Update a curtain order
router.put(
  '/api/curtain-orders/:id',
  auth,
  checkPermission('UPDATE_CURTAIN_ORDER'),
  curtainOrderController.updateCurtainOrder,
);

// Delete a curtain order
router.delete(
  '/api/curtain-orders/:id',
  auth,
  checkPermission('DELETE_CURTAIN_ORDER'),
  curtainOrderController.deleteCurtainOrder,
);
router.delete(
  '/api/curtain-measurements/:id',
  auth,
  //   checkPermission('DELETE_CURTAIN_MEASUREMENT'),
  curtainOrderController.deleteCurtainMeasurement,
);

// Get curtain orders by creator (user ID) - Admin only
router.get(
  '/api/curtain-orders/creator/:userId',
  auth,
  //   checkPermission('VIEW_CURTAIN_ORDER'), // Keep permission check for admin access
  curtainOrderController.getCurtainOrdersByCreator,
);

module.exports = router;
