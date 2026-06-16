const express = require('express');

const router = express.Router();
const { sellController } = require('../controllers');
const auth = require('../middlewares/auth');
const { debugUploadSellFiles } = require('../utils/multer');

const checkPermission = require('../middlewares/permission.middleware');

// ==================== CREATE SELL ====================
router.post(
  '/api/sells',
  auth,
  checkPermission('CREATE_SELL'),
  sellController.createSell,
);

//  ==================== GET ALL SELLS ====================
router.get(
  '/api/sells',
  auth,
  checkPermission('VIEW_ALL_SELLS'),
  sellController.getSells,
);
router.post(
  '/api/sells/:saleId/deliver',
  auth,

  checkPermission('DELIVER_ALL_SALE_ITEMS'),
  sellController.deliverSaleItems,
);
//  ==================== GET ALL SELLS ====================
router.get(
  '/api/sells/not-approved/store',
  // checkPermission('VIEW_SELL'),
  sellController.getAllSellsnotApproved,
);
router.get(
  '/api/sells/user/based',
  auth,

  checkPermission('VIEW_SELL'),
  sellController.getSellbyuser,
);

// ==================== GET SELL BY ID ====================
router.get('/api/sells/:id', sellController.getSell);

// ==================== GET SELL BY INVOICE NUMBER ====================
router.get(
  '/api/sells/invoice/:invoiceNo',
  // checkPermission('VIEW_SELL'),
  sellController.getSellByInvoiceNo,
);

// ==================== UPDATE SELL ====================
router.put(
  '/api/sells/:id',
  auth,
  checkPermission('UPDATE_SELL'),
  sellController.updateSell,
);

// ==================== DELETE SELL ====================
router.delete(
  '/api/sells/:id',
  auth,
  checkPermission('DELETE_SELL'),
  sellController.deleteSell,
);

// ==================== ADD SELL PAYMENT ====================
router.post(
  '/api/sells/:id/payments',
  auth,
  checkPermission('ADD_SELL_PAYMENT'),
  sellController.addSellPayment,
);

// ==================== GET SELL PAYMENT HISTORY ====================
router.get(
  '/api/sells/:sellId/payments',
  // checkPermission('VIEW_SELL_PAYMENT'),
  sellController.getSellPaymentHistory,
);

// ==================== UPDATE SALE STATUS ====================
router.patch(
  '/api/sells/:id/status',
  auth,
  checkPermission('UPDATE_SELL_STATUS'),
  sellController.updateSaleStatus,
);

// ==================== CANCEL SALE ====================
router.post(
  '/api/sells/:id/cancel',
  auth,
  checkPermission('UPDATE_SELL_STATUS'),
  sellController.cancelSale,
);

// ==================== UNLOCK SELL ====================
router.patch(
  '/api/sells/:id/unlock',
  auth,
  // checkPermission('UNLOCK_SELL'),
  sellController.unlockSell,
);

// ==================== GET SELL STATISTICS ====================
router.get(
  '/api/sells/statistics',
  // checkPermission('VIEW_SELL_STATISTICS'),
  sellController.getSellStatistics,
);
router.put(
  '/api/sell/:id/upload/file',
  auth,
  (req, res, next) => {
    // Log raw chunks as they come in
    const oldWrite = res.write;
    const oldEnd = res.end;
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      // Log first 500 chars to see the boundary
      const buffer = Buffer.concat(chunks);
      const preview = buffer.toString('utf8', 0, Math.min(500, buffer.length));
    });

    next();
  },
  debugUploadSellFiles,
  checkPermission('UPDATE_SELL'),

  sellController.addSellFiles,
);
module.exports = router;
