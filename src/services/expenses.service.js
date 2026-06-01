const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Get Expense by ID
const getExpenseById = async (id) => {
  const expense = await prisma.expense.findUnique({
    where: { id },
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });
  return expense;
};

// Get Expense by Title
const getExpenseByTitle = async (title) => {
  const expense = await prisma.expense.findFirst({
    where: { title },
  });
  return expense;
};

// Get all expenses
const getAllExpenses = async (userId = null, filters = {}) => {
  const { startDate, endDate, minAmount, maxAmount, search } = filters;

  // Build where clause
  const where = {};

  // Date range filter
  if (startDate || endDate) {
    where.expenseDate = {};
    if (startDate) {
      where.expenseDate.gte = new Date(startDate);
    }
    if (endDate) {
      where.expenseDate.lte = new Date(endDate);
    }
  }

  // Amount range filter
  if (minAmount !== undefined || maxAmount !== undefined) {
    where.amount = {};
    if (minAmount !== undefined) {
      where.amount.gte = parseFloat(minAmount);
    }
    if (maxAmount !== undefined) {
      where.amount.lte = parseFloat(maxAmount);
    }
  }

  // Search in title or description
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  // If userId provided, check if user has access to all expenses or only their own
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { admin: true },
    });

    // If user is not admin, only show their own expenses
    if (user && !user.admin) {
      where.createdById = userId;
    }
  }

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: {
      expenseDate: 'desc',
    },
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  // Calculate summary statistics
  const totalAmount = expenses.reduce(
    (sum, expense) => sum + expense.amount,
    0,
  );
  const averageAmount = expenses.length > 0 ? totalAmount / expenses.length : 0;

  return {
    expenses,
    count: expenses.length,
    summary: {
      totalAmount,
      averageAmount,
      minAmount:
        expenses.length > 0 ? Math.min(...expenses.map((e) => e.amount)) : 0,
      maxAmount:
        expenses.length > 0 ? Math.max(...expenses.map((e) => e.amount)) : 0,
    },
  };
};

// Get expenses by date range
const getExpensesByDateRange = async (startDate, endDate, userId = null) => {
  const where = {
    expenseDate: {
      gte: new Date(startDate),
      lte: new Date(endDate),
    },
  };

  // If userId provided and user is not admin, filter by createdBy
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { admin: true },
    });

    if (user && !user.admin) {
      where.createdById = userId;
    }
  }

  const expenses = await prisma.expense.findMany({
    where,
    orderBy: {
      expenseDate: 'desc',
    },
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  const totalAmount = expenses.reduce(
    (sum, expense) => sum + expense.amount,
    0,
  );

  return {
    expenses,
    count: expenses.length,
    totalAmount,
    dateRange: { startDate, endDate },
  };
};

// Get expense summary by month
const getExpenseSummaryByMonth = async (year, userId = null) => {
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);

  const where = {
    expenseDate: {
      gte: startDate,
      lte: endDate,
    },
  };

  // If userId provided and user is not admin, filter by createdBy
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { admin: true },
    });

    if (user && !user.admin) {
      where.createdById = userId;
    }
  }

  const expenses = await prisma.expense.findMany({
    where,
    select: {
      amount: true,
      expenseDate: true,
    },
  });

  // Group by month
  const monthlySummary = Array(12)
    .fill(0)
    .map((_, index) => ({
      month: index + 1,
      monthName: new Date(year, index, 1).toLocaleString('default', {
        month: 'long',
      }),
      totalAmount: 0,
      count: 0,
    }));

  expenses.forEach((expense) => {
    const month = new Date(expense.expenseDate).getMonth();
    monthlySummary[month].totalAmount += expense.amount;
    monthlySummary[month].count += 1;
  });

  const totalYearlyAmount = monthlySummary.reduce(
    (sum, month) => sum + month.totalAmount,
    0,
  );

  return {
    monthlySummary,
    year,
    totalYearlyAmount,
    totalExpenses: expenses.length,
  };
};

// Create Expense
const createExpense = async (expenseBody, userId) => {
  // Check if expense with same title already exists (optional validation)
  if (await getExpenseByTitle(expenseBody.title)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Expense with this title already exists',
    );
  }

  // Validate amount is positive
  if (expenseBody.amount <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Amount must be greater than 0');
  }

  // Validate expense date is not in the future (optional)
  const expenseDate = new Date(expenseBody.expenseDate);
  if (expenseDate > new Date()) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Expense date cannot be in the future',
    );
  }

  const expense = await prisma.expense.create({
    data: {
      title: expenseBody.title,
      description: expenseBody.description || null,
      amount: parseFloat(expenseBody.amount),
      expenseDate,
      createdBy: userId ? { connect: { id: userId } } : undefined,
    },
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return expense;
};

// Create multiple expenses (bulk create)
const createBulkExpenses = async (expensesArray, userId) => {
  const createdExpenses = [];
  const errors = [];

  for (let i = 0; i < expensesArray.length; i++) {
    const expenseBody = expensesArray[i];
    try {
      // Validate amount is positive
      if (expenseBody.amount <= 0) {
        errors.push({ index: i, error: 'Amount must be greater than 0' });
        continue;
      }

      const expenseDate = new Date(expenseBody.expenseDate);
      if (expenseDate > new Date()) {
        errors.push({
          index: i,
          error: 'Expense date cannot be in the future',
        });
        continue;
      }

      const expense = await prisma.expense.create({
        data: {
          title: expenseBody.title,
          description: expenseBody.description || null,
          amount: parseFloat(expenseBody.amount),
          expenseDate,
          createdBy: userId ? { connect: { id: userId } } : undefined,
        },
      });
      createdExpenses.push(expense);
    } catch (error) {
      errors.push({ index: i, error: error.message });
    }
  }

  return {
    success: createdExpenses,
    errors,
    createdCount: createdExpenses.length,
    failedCount: errors.length,
  };
};

// Update Expense
const updateExpense = async (id, updateBody, userId) => {
  const existingExpense = await getExpenseById(id);
  if (!existingExpense) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Expense not found');
  }

  // Check if user has permission to update (only creator or admin)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { admin: true },
  });

  if (!user.admin && existingExpense.createdById !== userId) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'You can only update your own expenses',
    );
  }

  // Check if title is being updated to an existing expense title
  if (updateBody.title && updateBody.title !== existingExpense.title) {
    if (await getExpenseByTitle(updateBody.title)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Expense with this title already exists',
      );
    }
  }

  // Validate amount if being updated
  if (updateBody.amount && updateBody.amount <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Amount must be greater than 0');
  }

  // Validate expense date if being updated
  if (updateBody.expenseDate) {
    const expenseDate = new Date(updateBody.expenseDate);
    if (expenseDate > new Date()) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Expense date cannot be in the future',
      );
    }
  }

  const updatedExpense = await prisma.expense.update({
    where: { id },
    data: {
      title: updateBody.title,
      description: updateBody.description,
      amount: updateBody.amount ? parseFloat(updateBody.amount) : undefined,
      expenseDate: updateBody.expenseDate
        ? new Date(updateBody.expenseDate)
        : undefined,
    },
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return updatedExpense;
};

// Delete Expense
const deleteExpense = async (id, userId) => {
  const existingExpense = await getExpenseById(id);
  if (!existingExpense) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Expense not found');
  }

  // Check if user has permission to delete (only creator or admin)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { admin: true },
  });

  if (!user.admin && existingExpense.createdById !== userId) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'You can only delete your own expenses',
    );
  }

  await prisma.expense.delete({
    where: { id },
  });

  return { message: 'Expense deleted successfully' };
};

// Delete multiple expenses (bulk delete)
const deleteBulkExpenses = async (ids, userId) => {
  // Get all expenses to check permissions
  const expenses = await prisma.expense.findMany({
    where: { id: { in: ids } },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { admin: true },
  });

  // Filter expenses that user can delete
  const deletableIds = expenses
    .filter((expense) => user.admin || expense.createdById === userId)
    .map((expense) => expense.id);

  if (deletableIds.length === 0) {
    throw new ApiError(httpStatus.FORBIDDEN, 'No expenses found to delete');
  }

  const deleted = await prisma.expense.deleteMany({
    where: { id: { in: deletableIds } },
  });

  return {
    deletedCount: deleted.count,
    notDeletedCount: ids.length - deleted.count,
  };
};

// Get expense statistics
const getExpenseStatistics = async (userId = null) => {
  const where = {};

  // If userId provided and user is not admin, filter by createdBy
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { admin: true },
    });

    if (user && !user.admin) {
      where.createdById = userId;
    }
  }

  const expenses = await prisma.expense.findMany({
    where,
    select: {
      amount: true,
      expenseDate: true,
      title: true,
    },
  });

  const totalExpenses = expenses.length;
  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);
  const averageAmount = totalExpenses > 0 ? totalAmount / totalExpenses : 0;

  // Get today's expenses
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayExpenses = expenses.filter((e) => {
    const expenseDate = new Date(e.expenseDate);
    return expenseDate >= today && expenseDate < tomorrow;
  });

  const todayTotal = todayExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Get current month expenses
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const monthStart = new Date(currentYear, currentMonth, 1);
  const monthEnd = new Date(currentYear, currentMonth + 1, 0);

  const monthExpenses = expenses.filter((e) => {
    const expenseDate = new Date(e.expenseDate);
    return expenseDate >= monthStart && expenseDate <= monthEnd;
  });

  const monthTotal = monthExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Get top 5 largest expenses
  const topExpenses = [...expenses]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  return {
    summary: {
      totalExpenses,
      totalAmount,
      averageAmount,
    },
    today: {
      count: todayExpenses.length,
      totalAmount: todayTotal,
    },
    currentMonth: {
      count: monthExpenses.length,
      totalAmount: monthTotal,
    },
    topExpenses,
  };
};

module.exports = {
  getExpenseById,
  getExpenseByTitle,
  getAllExpenses,
  getExpensesByDateRange,
  getExpenseSummaryByMonth,
  createExpense,
  createBulkExpenses,
  updateExpense,
  deleteExpense,
  deleteBulkExpenses,
  getExpenseStatistics,
};
