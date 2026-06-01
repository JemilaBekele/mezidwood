const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { expenseService } = require('../services');
const ApiError = require('../utils/ApiError');

// Create Expense
const createExpense = catchAsync(async (req, res) => {
  const userId = req.user.id; // Assuming you have user info in req.user
  const expense = await expenseService.createExpense(req.body, userId);
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Expense created successfully',
    expense,
  });
});

// Get Expense by ID
const getExpense = catchAsync(async (req, res) => {
  const expense = await expenseService.getExpenseById(req.params.id);
  if (!expense) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Expense not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    expense,
  });
});

// Get all Expenses (with filters)
const getExpenses = catchAsync(async (req, res) => {
  const userId = req.user?.id; // Optional: for filtering by user
  const filters = {
    startDate: req.query.startDate,
    endDate: req.query.endDate,
    minAmount: req.query.minAmount,
    maxAmount: req.query.maxAmount,
    search: req.query.search,
  };

  const result = await expenseService.getAllExpenses(userId, filters);
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Get Expenses by Date Range
const getExpensesByDateRange = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Start date and end date are required',
    );
  }

  const userId = req.user?.id;
  const result = await expenseService.getExpensesByDateRange(
    startDate,
    endDate,
    userId,
  );

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Get Expense Summary by Month
const getExpenseSummaryByMonth = catchAsync(async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const userId = req.user?.id;

  const result = await expenseService.getExpenseSummaryByMonth(year, userId);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Get Expense Statistics
const getExpenseStatistics = catchAsync(async (req, res) => {
  const userId = req.user?.id;
  const statistics = await expenseService.getExpenseStatistics(userId);

  res.status(httpStatus.OK).send({
    success: true,
    statistics,
  });
});

// Update Expense
const updateExpense = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const expense = await expenseService.updateExpense(
    req.params.id,
    req.body,
    userId,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Expense updated successfully',
    expense,
  });
});

// Delete Expense
const deleteExpense = catchAsync(async (req, res) => {
  const userId = req.user.id;
  await expenseService.deleteExpense(req.params.id, userId);

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Expense deleted successfully',
  });
});

// Delete Bulk Expenses
const deleteBulkExpenses = catchAsync(async (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Please provide an array of expense IDs to delete',
    );
  }

  const userId = req.user.id;
  const result = await expenseService.deleteBulkExpenses(ids, userId);

  res.status(httpStatus.OK).send({
    success: true,
    message: `${result.deletedCount} expense(s) deleted successfully`,
    ...result,
  });
});

// Create Bulk Expenses
const createBulkExpenses = catchAsync(async (req, res) => {
  const { expenses } = req.body;

  if (!expenses || !Array.isArray(expenses) || expenses.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Please provide an array of expenses to create',
    );
  }

  const userId = req.user.id;
  const result = await expenseService.createBulkExpenses(expenses, userId);

  res.status(httpStatus.CREATED).send({
    success: true,
    message: `${result.createdCount} expense(s) created successfully`,
    ...result,
  });
});

module.exports = {
  createExpense,
  createBulkExpenses,
  getExpense,
  getExpenses,
  getExpensesByDateRange,
  getExpenseSummaryByMonth,
  getExpenseStatistics,
  updateExpense,
  deleteExpense,
  deleteBulkExpenses,
};
