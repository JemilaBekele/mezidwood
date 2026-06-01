const express = require('express');

const router = express.Router();
const { customerSupplierController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// Customer Routes

// Create a customer
router.post(
  '/api/customers',
  auth,
  checkPermission('CREATE_CUSTOMER'),
  customerSupplierController.createCustomer,
);

// Get a customer by ID
router.get(
  '/api/customers/:id',
  auth,
  //   checkPermission('VIEW_CUSTOMER'),
  customerSupplierController.getCustomer,
);

// Get all customers
router.get(
  '/api/customers',
  auth,
  //   checkPermission('VIEW_CUSTOMER'), getCustomersWithFallback
  customerSupplierController.getCustomers,
);
router.get(
  '/api/With/fall/back/customers',
  auth,
  //   checkPermission('VIEW_CUSTOMER'),
  customerSupplierController.getCustomersWithFallback,
);

// Update a customer
router.put(
  '/api/customers/:id',
  auth,
  checkPermission('UPDATE_CUSTOMER'),
  customerSupplierController.updateCustomer,
);

// Delete a customer
router.delete(
  '/api/customers/:id',
  auth,
  checkPermission('DELETE_CUSTOMER'),
  customerSupplierController.deleteCustomer,
);

// Supplier Routes

// Create a supplier
router.post(
  '/api/suppliers',
  auth,
  checkPermission('CREATE_SUPPLIER'),
  customerSupplierController.createSupplier,
);

// Get a supplier by ID
router.get(
  '/api/suppliers/:id',
  auth,
  //   checkPermission('VIEW_SUPPLIER'),
  customerSupplierController.getSupplier,
);

// Get all suppliers
router.get(
  '/api/suppliers',
  auth,
  //   checkPermission('VIEW_SUPPLIER'),
  customerSupplierController.getSuppliers,
);

// Update a supplier
router.put(
  '/api/suppliers/:id',
  auth,
  checkPermission('UPDATE_SUPPLIER'),
  customerSupplierController.updateSupplier,
);

// Delete a supplier
router.delete(
  '/api/suppliers/:id',
  auth,
  checkPermission('DELETE_SUPPLIER'),
  customerSupplierController.deleteSupplier,
);

module.exports = router;
