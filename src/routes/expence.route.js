const express = require('express');

const router = express.Router();
const { expenseController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// Create Expense
router.post(
  '/api/expenses',
  auth,
  //   checkPermission('CREATE_EXPENSE'),
  expenseController.createExpense,
);

// Create Bulk Expenses
router.post(
  '/api/expenses/bulk',
  auth,
  //   checkPermission('CREATE_EXPENSE'),
  expenseController.createBulkExpenses,
);

// Get all Expenses (with filters)
router.get(
  '/api/expenses',
  auth,
  // checkPermission('VIEW_EXPENSE'),
  expenseController.getExpenses,
);

// Get Expenses by Date Range
router.get(
  '/api/expenses/by-date-range',
  auth,
  // checkPermission('VIEW_EXPENSE'),
  expenseController.getExpensesByDateRange,
);

// Get Expense Summary by Month
router.get(
  '/api/expenses/summary-by-month',
  auth,
  // checkPermission('VIEW_EXPENSE'),
  expenseController.getExpenseSummaryByMonth,
);

// Get Expense Statistics
router.get(
  '/api/expenses/statistics',
  auth,
  // checkPermission('VIEW_EXPENSE'),
  expenseController.getExpenseStatistics,
);

// Get Expense by ID
router.get(
  '/api/expenses/:id',
  auth,
  // checkPermission('VIEW_EXPENSE'),
  expenseController.getExpense,
);

// Update Expense
router.patch(
  '/api/expenses/:id',
  auth,
  //   checkPermission('UPDATE_EXPENSE'),
  expenseController.updateExpense,
);

// Delete Expense
router.delete(
  '/api/expenses/:id',
  auth,
  //   checkPermission('DELETE_EXPENSE'),
  expenseController.deleteExpense,
);

// Delete Bulk Expenses
router.delete(
  '/api/expenses/bulk/delete',
  auth,
  //   checkPermission('DELETE_EXPENSE'),
  expenseController.deleteBulkExpenses,
);

module.exports = router;
