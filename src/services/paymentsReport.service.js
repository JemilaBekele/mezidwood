const httpStatus = require('http-status');
const prisma = require('./prisma');
const ApiError = require('../utils/ApiError');
const money = require('../utils/money');

const toNum = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const round2 = (value) => Math.round(toNum(value) * 100) / 100;

// Inclusive whole-day range; either side may be omitted
const buildDayRange = (startDate, endDate) => {
  if (!startDate && !endDate) return undefined;
  const range = {};
  if (startDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    range.gte = start;
  }
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    range.lte = end;
  }
  return range;
};

/**
 * Payments received: PI payments (ProformaInvoiceBank) + sale payments (SellPayment).
 * Filters: startDate, endDate (payment date), customerId, bankId, type (all | proforma | sale)
 */
const getPaymentsReport = async ({
  startDate,
  endDate,
  customerId,
  bankId,
  type = 'all',
} = {}) => {
  const createdAt = buildDayRange(startDate, endDate);
  const includeProforma = type === 'all' || type === 'proforma';
  const includeSales = type === 'all' || type === 'sale';

  const [piPayments, salePayments] = await Promise.all([
    includeProforma
      ? prisma.proformaInvoiceBank.findMany({
          where: {
            ...(createdAt && { createdAt }),
            ...(bankId && { bankId }),
            ...(customerId && { proformaInvoice: { customerId } }),
          },
          include: {
            bank: { select: { id: true, bankName: true, accountNumber: true } },
            createdBy: { select: { id: true, name: true } },
            proformaInvoice: {
              select: {
                id: true,
                piNumber: true,
                total: true,
                balance: true,
                customer: { select: { id: true, name: true, phone1: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        })
      : [],
    includeSales
      ? prisma.sellPayment.findMany({
          where: {
            // Sale payments are dated by when the customer paid.
            ...(createdAt && { paidDate: createdAt }),
            ...(bankId && { bankId }),
            ...(customerId && { sell: { customerId } }),
          },
          include: {
            bank: { select: { id: true, bankName: true, accountNumber: true } },
            createdBy: { select: { id: true, name: true } },
            sell: {
              select: {
                id: true,
                invoiceNo: true,
                grandTotal: true,
                balance: true,
                customer: { select: { id: true, name: true, phone1: true } },
              },
            },
          },
          orderBy: { paidDate: 'desc' },
        })
      : [],
  ]);

  const rows = [
    ...piPayments.map((p) => ({
      id: p.id,
      type: 'PROFORMA',
      date: p.createdAt,
      documentId: p.proformaInvoice?.id || null,
      invoiceNo: p.proformaInvoice?.piNumber || '-',
      customer: p.proformaInvoice?.customer || null,
      bank: p.bank,
      amount: round2(p.amount),
      paidBy: p.paidBy || null,
      receivedBy: p.createdBy?.name || null,
      invoiceTotal: round2(p.proformaInvoice?.total),
      invoiceBalance: round2(p.proformaInvoice?.balance),
    })),
    ...salePayments.map((p) => ({
      id: p.id,
      type: 'SALE',
      date: p.paidDate || p.createdAt,
      documentId: p.sell?.id || null,
      invoiceNo: p.sell?.invoiceNo || '-',
      customer: p.sell?.customer || null,
      bank: p.bank,
      amount: round2(p.amount),
      paidBy: p.paidBy || null,
      receivedBy: p.createdBy?.name || null,
      invoiceTotal: round2(p.sell?.grandTotal),
      invoiceBalance: round2(p.sell?.balance),
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Totals per bank
  const bankMap = new Map();
  rows.forEach((row) => {
    const key = row.bank?.id || 'unknown';
    if (!bankMap.has(key)) {
      bankMap.set(key, {
        bankId: row.bank?.id || null,
        bankName: row.bank?.bankName || 'Unknown bank',
        accountNumber: row.bank?.accountNumber || null,
        proformaAmount: 0,
        saleAmount: 0,
        total: 0,
        count: 0,
      });
    }
    const entry = bankMap.get(key);
    if (row.type === 'PROFORMA') entry.proformaAmount += row.amount;
    else entry.saleAmount += row.amount;
    entry.total += row.amount;
    entry.count += 1;
  });
  const byBank = Array.from(bankMap.values())
    .map((b) => ({
      ...b,
      proformaAmount: round2(b.proformaAmount),
      saleAmount: round2(b.saleAmount),
      total: round2(b.total),
    }))
    .sort((a, b) => b.total - a.total);

  const proformaTotal = rows
    .filter((r) => r.type === 'PROFORMA')
    .reduce((sum, r) => sum + r.amount, 0);
  const saleTotal = rows
    .filter((r) => r.type === 'SALE')
    .reduce((sum, r) => sum + r.amount, 0);

  return {
    period: {
      startDate: startDate || null,
      endDate: endDate || null,
    },
    summary: {
      totalReceived: round2(proformaTotal + saleTotal),
      proformaTotal: round2(proformaTotal),
      saleTotal: round2(saleTotal),
      paymentCount: rows.length,
      proformaCount: piPayments.length,
      saleCount: salePayments.length,
      customerCount: new Set(rows.map((r) => r.customer?.id).filter(Boolean)).size,
    },
    byBank,
    payments: rows,
  };
};

// ==================== EDIT / DELETE PAYMENTS ====================
// Every change re-computes the invoice's paid amount, balance and payment
// status inside the same transaction, so ledger rows and totals never disagree.

const paymentStatusFor = (balance, totalPaid) => {
  if (money.isSettled(balance)) return 'PAID';
  if (money.isPositive(totalPaid)) return 'PARTIAL';
  return 'PENDING';
};

const parseAmount = (amount) => {
  const value = money.round(amount);
  if (!money.isPositive(value)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Payment amount must be greater than zero');
  }
  return value;
};

const assertBankExists = async (tx, bankId) => {
  const bank = await tx.bank.findUnique({ where: { id: bankId } });
  if (!bank) throw new ApiError(httpStatus.NOT_FOUND, 'Bank not found');
};

// Only fields that were sent are changed
const buildPaymentChanges = async (tx, updates, currentAmount) => {
  const data = {};
  let newAmount = money.toNumber(currentAmount);

  if (updates.amount !== undefined) {
    newAmount = parseAmount(updates.amount);
    data.amount = newAmount;
  }
  if (updates.bankId !== undefined) {
    if (!updates.bankId) throw new ApiError(httpStatus.BAD_REQUEST, 'Bank is required');
    await assertBankExists(tx, updates.bankId);
    data.bankId = updates.bankId;
  }
  if (updates.paidBy !== undefined) {
    data.paidBy = updates.paidBy || null;
  }
  if (updates.date !== undefined) {
    const date = new Date(updates.date);
    if (Number.isNaN(date.getTime())) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid payment date');
    }
    data.createdAt = date;
  }
  if (Object.keys(data).length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Nothing to update');
  }
  return { data, newAmount };
};

// ── PI payments (ProformaInvoiceBank) ─────────────────────────
// amountPaid is adjusted by the difference (not re-summed from bank rows),
// because PI payments added without a bank have no ProformaInvoiceBank row.

const applyProformaPaymentChange = async (tx, invoiceId, oldAmount, newAmount) => {
  const invoice = await tx.proformaInvoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new ApiError(httpStatus.NOT_FOUND, 'Proforma invoice not found');

  const total = money.toNumber(invoice.total);
  const newTotalPaid = money.round(
    money.toNumber(invoice.amountPaid) - money.toNumber(oldAmount) + money.toNumber(newAmount),
  );

  if (money.greaterThan(newTotalPaid, total)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Total paid (${newTotalPaid}) would exceed the invoice total (${total})`,
    );
  }
  const safeTotalPaid = newTotalPaid < 0 ? 0 : newTotalPaid;
  const newBalance = money.subtract(total, safeTotalPaid);

  return tx.proformaInvoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid: safeTotalPaid,
      balance: newBalance,
      // A cancelled invoice keeps its CANCELLED payment status
      paymentStatus:
        invoice.paymentStatus === 'CANCELLED'
          ? 'CANCELLED'
          : paymentStatusFor(newBalance, safeTotalPaid),
    },
    select: { id: true, piNumber: true, total: true, amountPaid: true, balance: true, paymentStatus: true },
  });
};

const updateProformaPayment = async (paymentId, updates = {}) =>
  prisma.$transaction(
    async (tx) => {
      const payment = await tx.proformaInvoiceBank.findUnique({ where: { id: paymentId } });
      if (!payment) throw new ApiError(httpStatus.NOT_FOUND, 'PI payment not found');

      const { data, newAmount } = await buildPaymentChanges(tx, updates, payment.amount);
      const invoice = await applyProformaPaymentChange(
        tx,
        payment.proformaInvoiceId,
        payment.amount,
        newAmount,
      );
      const updatedPayment = await tx.proformaInvoiceBank.update({
        where: { id: paymentId },
        data,
        include: {
          bank: { select: { id: true, bankName: true, accountNumber: true } },
          createdBy: { select: { id: true, name: true } },
        },
      });
      return { payment: updatedPayment, invoice };
    },
    { timeout: 10000, maxWait: 5000 },
  );

const deleteProformaPayment = async (paymentId) =>
  prisma.$transaction(
    async (tx) => {
      const payment = await tx.proformaInvoiceBank.findUnique({ where: { id: paymentId } });
      if (!payment) throw new ApiError(httpStatus.NOT_FOUND, 'PI payment not found');

      const invoice = await applyProformaPaymentChange(tx, payment.proformaInvoiceId, payment.amount, 0);
      await tx.proformaInvoiceBank.delete({ where: { id: paymentId } });
      return { deletedPaymentId: paymentId, invoice };
    },
    { timeout: 10000, maxWait: 5000 },
  );

// ── Sale payments (SellPayment) ───────────────────────────────
// totalPaid is re-summed from the sale's payment rows (same as addSellPayment).

const recalculateSell = async (tx, sellId) => {
  const sell = await tx.sell.findUnique({
    where: { id: sellId },
    include: { sellPayments: { select: { amount: true } } },
  });
  if (!sell) throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');

  const grandTotal = money.toNumber(sell.grandTotal);
  const totalPaid = money.sum(sell.sellPayments.map((p) => p.amount));
  if (money.greaterThan(totalPaid, grandTotal)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Total paid (${totalPaid}) would exceed the sale total (${grandTotal})`,
    );
  }
  const balance = Math.max(money.subtract(grandTotal, totalPaid), 0);

  return tx.sell.update({
    where: { id: sellId },
    data: {
      totalPaid,
      balance,
      paymentStatus:
        sell.paymentStatus === 'CANCELLED' ? 'CANCELLED' : paymentStatusFor(balance, totalPaid),
    },
    select: { id: true, invoiceNo: true, grandTotal: true, totalPaid: true, balance: true, paymentStatus: true },
  });
};

const updateSellPayment = async (paymentId, updates = {}) =>
  prisma.$transaction(
    async (tx) => {
      const payment = await tx.sellPayment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new ApiError(httpStatus.NOT_FOUND, 'Sale payment not found');

      const { data } = await buildPaymentChanges(tx, updates, payment.amount);
      // A sale payment's date is its paid date (createdAt stays the record time).
      if (data.createdAt) {
        data.paidDate = data.createdAt;
        delete data.createdAt;
      }
      const updatedPayment = await tx.sellPayment.update({
        where: { id: paymentId },
        data,
        include: {
          bank: { select: { id: true, bankName: true, accountNumber: true } },
          createdBy: { select: { id: true, name: true } },
        },
      });
      // Throws (and rolls back the edit) if the new amount overpays the sale
      const sell = await recalculateSell(tx, payment.sellId);
      return { payment: updatedPayment, sell };
    },
    { timeout: 10000, maxWait: 5000 },
  );

const deleteSellPayment = async (paymentId) =>
  prisma.$transaction(
    async (tx) => {
      const payment = await tx.sellPayment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new ApiError(httpStatus.NOT_FOUND, 'Sale payment not found');

      await tx.sellPayment.delete({ where: { id: paymentId } });
      const sell = await recalculateSell(tx, payment.sellId);
      return { deletedPaymentId: paymentId, sell };
    },
    { timeout: 10000, maxWait: 5000 },
  );

module.exports = {
  getPaymentsReport,
  updateProformaPayment,
  deleteProformaPayment,
  updateSellPayment,
  deleteSellPayment,
};
