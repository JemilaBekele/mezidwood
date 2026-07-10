const express = require('express');

const router = express.Router();
const { itemController } = require('../controllers');
const auth = require('../middlewares/auth');
const { uploadImageitem } = require('../utils/multer');

const checkPermission = require('../middlewares/permission.middleware');

// Create Item
router.post(
  '/api/items',
  auth,
  uploadImageitem,
  checkPermission('CREATE_PRODUCT'),
  itemController.createItem,
);

// Get All Items
router.get(
  '/api/items/Proforma/Invoices/Sales',
  auth,
  // checkPermission('VIEW_ITEM'),
  itemController.getAllProformaInvoicesAndSales,
);
router.get(
  '/api/items/get/all',
  auth,
  checkPermission('VIEW_PRODUCT_ALL'),
  itemController.getAllItems,
);
router.get(
  '/api/items/get/all/list/pos/all',
  auth,
  // checkPermission('VIEW_ITEM'),
  itemController.getAllItemslist,
);
// Get All Items
router.get(
  '/api/items/get/all/simple',
  auth,
  // checkPermission('VIEW_ITEM'),
  itemController.getAllItemsimple,
);

// Get Item by ID
router.get(
  '/api/items/:id',
  auth,
  // checkPermission('VIEW_ITEM'),
  itemController.getItem,
);

// Update Item
router.put(
  '/api/items/:id',
  auth,
  uploadImageitem,

  checkPermission('UPDATE_PRODUCT'),
  itemController.updateItem,
);

// Delete Item
router.delete(
  '/api/items/:id',
  auth,
  checkPermission('DELETE_PRODUCT'),
  itemController.deleteItem,
);
// GET ITEM DETAIL
router.get(
  '/api/items/:id/detail',
  auth,
  // checkPermission('VIEW_ITEM'),
  itemController.getItemDetail,
);

router.post(
  '/api/items/accept-initial-stock',
  auth,
  // checkPermission('MANAGE_ITEM_STOCK'),
  itemController.acceptInitialItemStock,
);
module.exports = router;
