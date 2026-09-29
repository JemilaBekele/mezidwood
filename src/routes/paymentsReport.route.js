const express = require('express');
const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');
const paymentsReportService = require('../services/paymentsReport.service');

const { getPaymentsReport } = paymentsReportService;

const router = express.Router();

// Payments received (PI + sale payments) with date, customer, bank and type filters
router.get(
  '/api/reports/payments',
  auth,
  checkPermission('VIEW_COMBINED_REPORT'),
  catchAsync(async (req, res) => {
    const { startDate, endDate, customerId, bankId, type } = req.query;
    const data = await getPaymentsReport({
      startDate,
      endDate,
      customerId,
      bankId,
      type: ['proforma', 'sale'].includes(type) ? type : 'all',
    });
    res.status(httpStatus.OK).json({
      success: true,
      message: 'Payments report fetched successfully',
      data,
    });
  }),
);

// Body for edits (all optional, only sent fields change): { amount, bankId, paidBy, date }
const pickUpdates = (body = {}) => {
  const updates = {};
  ['amount', 'bankId', 'paidBy', 'date'].forEach((key) => {
    if (body[key] !== undefined) updates[key] = body[key];
  });
  return updates;
};

// Edit a PI payment (updates the invoice's amountPaid, balance, paymentStatus)
router.patch(
  '/api/reports/payments/proforma/:id',
  auth,
  checkPermission('EDIT_PAYMENT_TO_PROFORMA_INVOICE'),
  catchAsync(async (req, res) => {
    const data = await paymentsReportService.updateProformaPayment(
      req.params.id,
      pickUpdates(req.body),
    );
    res.status(httpStatus.OK).json({
      success: true,
      message: 'PI payment updated successfully',
      data,
    });
  }),
);

// Delete a PI payment (updates the invoice's amountPaid, balance, paymentStatus)
router.delete(
  '/api/reports/payments/proforma/:id',
  auth,
  checkPermission('DELETE_PAYMENT_TO_PROFORMA_INVOICE'),
  catchAsync(async (req, res) => {
    const data = await paymentsReportService.deleteProformaPayment(
      req.params.id,
    );
    res.status(httpStatus.OK).json({
      success: true,
      message: 'PI payment deleted successfully',
      data,
    });
  }),
);

// Edit a sale payment (updates the sale's totalPaid, balance, paymentStatus)
router.patch(
  '/api/reports/payments/sale/:id',
  auth,
  checkPermission('ADD_SELL_PAYMENT'),
  catchAsync(async (req, res) => {
    const data = await paymentsReportService.updateSellPayment(
      req.params.id,
      pickUpdates(req.body),
    );
    res.status(httpStatus.OK).json({
      success: true,
      message: 'Sale payment updated successfully',
      data,
    });
  }),
);

// Delete a sale payment (updates the sale's totalPaid, balance, paymentStatus)
router.delete(
  '/api/reports/payments/sale/:id',
  auth,
  checkPermission('ADD_SELL_PAYMENT'),
  catchAsync(async (req, res) => {
    const data = await paymentsReportService.deleteSellPayment(req.params.id);
    res.status(httpStatus.OK).json({
      success: true,
      message: 'Sale payment deleted successfully',
      data,
    });
  }),
);

module.exports = router;
