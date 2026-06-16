const express = require('express');

const router = express.Router();
const { companyController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');
const { uploadImacamp } = require('../utils/multer');

router.post(
  '/api/companies',
  auth,
  uploadImacamp,
  checkPermission('CREATE_COMPANY'),
  companyController.createCompany,
);
router.get(
  '/api/companies/:id',
  // auth,
  companyController.getCompany,
);

// Get all companies
router.get(
  '/api/companies',
  auth,
  // checkPermission('VIEW_COMPANY'),
  companyController.getCompanies,
);

// Update a company
router.put(
  '/api/companies/:id',
  auth,
  uploadImacamp,

  checkPermission('UPDATE_COMPANY'),
  companyController.updateCompany,
);

// Delete a company
router.delete(
  '/api/companies/:id',
  auth,
  checkPermission('DELETE_COMPANY'),
  companyController.deleteCompany,
);
router.get(
  '/api/getNotifications',
  auth,
  // checkPermission('VIEW_COMPANY'),
  companyController.getNotifications,
);

// Update a company
router.put(
  '/api/markNotificationAsRead/:notificationId',
  auth,
  // checkPermission('UPDATE_COMPANY'),
  companyController.markNotificationAsRead,
);

module.exports = router;
