/* eslint-disable no-nested-ternary */
/* eslint-disable no-restricted-syntax */
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Create Bank
const createBank = async (bankData) => {
  const { bankName, accountNumber } = bankData;

  // Validate required fields
  if (!bankName || !accountNumber) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Bank name and account number are required',
    );
  }

  // Validate bank name is not empty
  if (bankName.trim().length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Bank name cannot be empty');
  }

  // Validate account number format (at least 5 characters)
  if (accountNumber.trim().length < 5) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Account number must be at least 5 characters long',
    );
  }

  // Check if bank already exists with same account number (unique constraint)
  const existingBank = await prisma.bank.findUnique({
    where: { accountNumber },
  });

  if (existingBank) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Bank account already exists with account number: ${accountNumber}`,
    );
  }

  // Create bank
  const bank = await prisma.bank.create({
    data: {
      bankName: bankName.trim(),
      accountNumber: accountNumber.trim(),
    },
  });

  return bank;
};

// Update Bank
const updateBank = async (id, updateBody) => {
  // Check if bank exists
  const existingBank = await prisma.bank.findUnique({
    where: { id },
  });

  if (!existingBank) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Bank not found');
  }

  // Clean the updateBody to remove any undefined or null values
  const cleanedUpdateBody = {};
  for (const [key, value] of Object.entries(updateBody)) {
    if (value !== undefined && value !== null) {
      const cleanKey = key.replace(/[^a-zA-Z0-9]/g, '');
      cleanedUpdateBody[cleanKey] =
        typeof value === 'string' ? value.trim() : value;
    }
  }

  // Validate bank name if provided
  if (cleanedUpdateBody.bankName !== undefined) {
    if (cleanedUpdateBody.bankName.length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Bank name cannot be empty');
    }
  }

  // Update bank
  const updatedBank = await prisma.bank.update({
    where: { id },
    data: cleanedUpdateBody,
  });

  return updatedBank;
};

// Delete Bank
const deleteBank = async (id) => {
  // Check if bank exists
  const existingBank = await prisma.bank.findUnique({
    where: { id },
    include: {
      purchases: {
        select: { id: true },
      },
    },
  });

  if (!existingBank) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Bank not found');
  }

  // Check if bank has associated purchases
  if (existingBank.purchases && existingBank.purchases.length > 0) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'Cannot delete bank because it has associated purchases. Remove or reassign purchases first.',
    );
  }

  // Delete bank
  await prisma.bank.delete({
    where: { id },
  });

  return { message: 'Bank deleted successfully' };
};

// Get all Banks
const getAllBanks = async () => {
  const banks = await prisma.bank.findMany({});
  return {
    banks,
    count: banks.length,
  };
};

// Get Bank by ID
const getBankById = async (id) => {
  const bank = await prisma.bank.findUnique({
    where: { id },
    include: {
      purchases: {
        select: {
          id: true,
          purchaseNumber: true,
          purchaseDate: true,
          // Add other purchase fields you want to include
        },
      },
    },
  });

  if (!bank) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Bank not found');
  }

  return bank;
};

module.exports = {
  createBank,
  updateBank,
  deleteBank,
  getAllBanks,
  getBankById,
};
