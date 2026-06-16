const express = require('express');

const router = express.Router();
const { bankController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// Create Bank
router.post(
  '/api/banks',
  auth,
  checkPermission('CREATE_BANK'),
  bankController.createBank,
);

// Get all Banks
router.get('/api/banks', bankController.getBanks);

// Get Bank by ID
router.get(
  '/api/banks/:id',
  auth,
  // checkPermission('VIEW_BANK'),
  bankController.getBank,
);

// Search Banks by Name
router.get(
  '/api/banks/search/name',
  auth,
  // checkPermission('VIEW_BANK'),
  bankController.searchBanks,
);

// Update Bank
router.put(
  '/api/banks/:id',
  auth,
  checkPermission('UPDATE_BANK'),
  bankController.updateBank,
);

// Delete Bank
router.delete(
  '/api/banks/:id',
  auth,
  checkPermission('DELETE_BANK'),
  bankController.deleteBank,
);

module.exports = router;
