const express = require('express');

const router = express.Router();
const { proformaInvoiceController } = require('../controllers');
const auth = require('../middlewares/auth');
const { debugUploadProformaInvoice } = require('../utils/multer');

const checkPermission = require('../middlewares/permission.middleware');

// Create ProformaInvoice
// Add a debug middleware BEFORE multer
// Add this middleware right before multer
router.post(
  '/api/proforma-invoices',
  auth,
  debugUploadProformaInvoice,
  checkPermission('CREATE_PROFORMA'),
  proformaInvoiceController.createProformaInvoice,
);
router.post(
  '/api/proforma-invoices/:invoiceId/attachments',
  auth,
  debugUploadProformaInvoice,
  checkPermission('UPDATE_PROFORMA'), // Or 'ADD_ATTACHMENT' permission
  proformaInvoiceController.addAttachments,
);
// Get all Proforma Invoices with filters
router.get(
  '/api/proforma-invoices',
  auth,
  checkPermission('VIEW_ALL_PROFORMA'),
  proformaInvoiceController.getProformaInvoices,
);
router.get(
  '/api/proforma-invoices/mypiinvoices',
  auth,
  checkPermission('VIEW_PROFORMA'),
  proformaInvoiceController.getAllProformaInvoicesmy,
);

// Get Proforma Invoice by ID
router.get(
  '/api/proforma-invoices/:id',
  // checkPermission('VIEW_PROFORMA_INVOICE'),
  proformaInvoiceController.getProformaInvoice,
);

// Get Proforma Invoice by PI Number
router.get(
  '/api/proforma-invoices/number/:piNumber',
  auth,
  // checkPermission('VIEW_PROFORMA_INVOICE'),
  proformaInvoiceController.getProformaInvoiceByPInumber,
);

// Update Proforma Invoice updateProformaInvoiceseco
router.put(
  '/api/proforma-invoices/:id',
  auth,
  debugUploadProformaInvoice,
  checkPermission('UPDATE_PROFORMA'),

  proformaInvoiceController.updateProformaInvoice,
);
router.put(
  '/api/proforma-invoices/secondupdate/:id',
  auth,
  debugUploadProformaInvoice,
  checkPermission('UPDATE_PROFORMA'),

  proformaInvoiceController.updateProformaInvoiceseco,
);
// Delete Proforma Invoice
router.delete(
  '/api/proforma-invoices/:id',
  auth,
  checkPermission('DELETE_PROFORMA'),
  proformaInvoiceController.deleteProformaInvoice,
);

// Update Proforma Invoice Status
router.patch(
  '/api/proforma-invoices/:id/status',
  auth,
  checkPermission('UPDATE_PROFORMA_STATUS'),
  proformaInvoiceController.updateProformaInvoiceStatus,
);
router.patch(
  '/api/proforma-invoices/:id/additional-quantity',
  auth,
  // checkPermission('UPDATE_PROFORMA_INVOICE'),
  proformaInvoiceController.updateProformaInvoiceAdditionalQuantity,
);
// Add Payment to Proforma Invoice
router.post(
  '/api/proforma-invoices/:id/payments',
  auth,
  // checkPermission('ADD_PAYMENT_TO_INVOICE'),
  proformaInvoiceController.addPaymentToInvoice,
);

// Get Proforma Invoice Summary (for dashboard)
router.get(
  '/api/proforma-invoices/summary/dashboard',
  auth,
  // checkPermission('VIEW_PROFORMA_INVOICE_SUMMARY'),
  proformaInvoiceController.getInvoiceSummary,
);

// Generate Proforma Invoice Report
router.get(
  '/api/proforma-invoices/reports/generate',
  auth,
  // checkPermission('GENERATE_INVOICE_REPORT'),
  proformaInvoiceController.generateInvoiceReport,
);

// Validate PI Number
router.get(
  '/api/proforma-invoices/validate/pi-number',
  auth,
  // checkPermission('VIEW_PROFORMA_INVOICE'),
  proformaInvoiceController.validatePINumber,
);

module.exports = router;
