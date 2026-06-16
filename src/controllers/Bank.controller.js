const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { bankService } = require('../services');

// Create Bank
const createBank = async (req, res) => {
  try {
    const bankData = req.body;

    // Use the imported function
    const bank = await bankService.createBank(bankData);

    res.status(201).json({
      success: true,
      data: bank,
    });
  } catch (error) {
    // Handle Prisma unique constraint violation for account number
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        error: `Bank account already exists with account number: ${req.body.accountNumber}`,
      });
    }

    // Handle your custom ApiError
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    // Generic error
    res.status(500).json({
      success: false,
      error: 'Failed to create bank',
    });
  }
};

// Get Bank by ID
const getBank = catchAsync(async (req, res) => {
  const bank = await bankService.getBankById(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    bank,
  });
});

// Get all Banks
const getBanks = catchAsync(async (req, res) => {
  const result = await bankService.getAllBanks();
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Search Banks by Name
const searchBanks = catchAsync(async (req, res) => {
  const { name } = req.query;
  const limit = parseInt(req.query.limit, 10) || 10;

  if (!name) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Search query parameter "name" is required',
    });
  }

  const banks = await bankService.searchBanksByName(name, limit);
  res.status(httpStatus.OK).send({
    success: true,
    banks,
    count: banks.length,
  });
});

// Update Bank
const updateBank = catchAsync(async (req, res) => {
  const bank = await bankService.updateBank(req.params.id, req.body);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Bank updated successfully',
    bank,
  });
});

// Delete Bank
const deleteBank = catchAsync(async (req, res) => {
  await bankService.deleteBank(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Bank deleted successfully',
  });
});

module.exports = {
  createBank,
  getBank,
  getBanks,
  searchBanks,
  updateBank,
  deleteBank,
};
