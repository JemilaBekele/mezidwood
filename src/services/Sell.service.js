const httpStatus = require('http-status');
const { subMonths } = require('date-fns');
const { getIO } = require('../socket/s');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// ==================== HELPER FUNCTIONS ====================

const generateInvoiceNumber = async () => {
  try {
    const allSells = await prisma.sell.findMany({
      select: { invoiceNo: true },
    });

    let maxNumber = 0;

    if (allSells.length === 0) {
      return 'SEL-00001';
    }

    for (const sell of allSells) {
      const match = sell.invoiceNo.match(/SEL-?(\d+)/i);
      if (match && match[1]) {
        const numericPart = parseInt(match[1], 10);
        if (!isNaN(numericPart) && numericPart > maxNumber) {
          maxNumber = numericPart;
        }
      }
    }

    const nextNumber = maxNumber === 0 ? 1 : maxNumber + 1;
    return `SEL-${nextNumber.toString().padStart(5, '0')}`;
  } catch (error) {
    return `SEL-${Date.now().toString().slice(-8)}`;
  }
};

const calculateTotals = (items) => {
  const subTotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
  const discount = 0; // Can be customized
  const vat = 0; // Can be customized
  const grandTotal = subTotal - discount + vat;

  return { subTotal, discount, vat, grandTotal };
};

// ==================== GET SELL BY ID ====================
const getSellById = async (identifier) => {
  const sell = await prisma.sell.findFirst({
    where: {
      OR: [{ id: identifier }, { invoiceNo: identifier }],
    },
    include: {
      customer: true,
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      updatedBy: {
        select: { id: true, name: true, email: true },
      },
      items: {
        include: {
          item: true,
        },
      },
      sellPayments: {
        include: {
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  return sell;
};

// ==================== GET SELL BY INVOICE NUMBER ====================
const getSellByInvoiceNo = async (invoiceNo) => {
  const sell = await prisma.sell.findFirst({
    where: { invoiceNo },
    include: {
      customer: true,
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      updatedBy: {
        select: { id: true, name: true, email: true },
      },
      items: {
        include: {
          item: true,
        },
      },
      sellPayments: true,
    },
  });
  return sell;
};

// ==================== GET ALL SELLS ====================
const getAllSells = async ({
  startDate,
  endDate,
  saleStatus,
  customerId,
  createdById,
} = {}) => {
  const whereClause = {};
  const twelveMonthsAgo = subMonths(new Date(), 12);

  const startDateObj = startDate ? new Date(startDate) : undefined;
  const endDateObj = endDate ? new Date(endDate) : undefined;

  // Date filtering
  if (startDateObj && endDateObj) {
    whereClause.saleDate = {
      gte: startDateObj,
      lte: endDateObj,
    };
  } else if (startDateObj) {
    whereClause.saleDate = {
      gte: startDateObj,
      lte: new Date(),
    };
  } else if (endDateObj) {
    whereClause.saleDate = {
      gte: twelveMonthsAgo,
      lte: endDateObj,
    };
  } else {
    whereClause.saleDate = {
      gte: twelveMonthsAgo,
    };
  }

  // Optional filters
  if (saleStatus) {
    whereClause.saleStatus = saleStatus;
  }

  if (customerId) {
    whereClause.customerId = customerId;
  }

  // Filter by creator (createdBy) - only if provided
  if (createdById) {
    whereClause.createdById = createdById;
  }

  const sells = await prisma.sell.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    include: {
      customer: true,
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      items: {
        include: {
          item: true,
        },
      },
      sellPayments: {
        select: { id: true, amount: true, createdAt: true },
      },
      _count: {
        select: { items: true },
      },
    },
  });

  return {
    sells,
    count: sells.length,
  };
};
const getAllSellsnotApproved = async ({
  startDate,
  endDate,
  saleStatus,
  customerId,
  createdById,
} = {}) => {
  const whereClause = {};
  const twelveMonthsAgo = subMonths(new Date(), 12);

  const startDateObj = startDate ? new Date(startDate) : undefined;
  const endDateObj = endDate ? new Date(endDate) : undefined;

  // Date filtering
  if (startDateObj && endDateObj) {
    whereClause.saleDate = {
      gte: startDateObj,
      lte: endDateObj,
    };
  } else if (startDateObj) {
    whereClause.saleDate = {
      gte: startDateObj,
      lte: new Date(),
    };
  } else if (endDateObj) {
    whereClause.saleDate = {
      gte: twelveMonthsAgo,
      lte: endDateObj,
    };
  } else {
    whereClause.saleDate = {
      gte: twelveMonthsAgo,
    };
  }

  // 🚀 Always exclude NOT_APPROVED unless explicitly provided
  if (saleStatus) {
    whereClause.saleStatus = saleStatus;
  } else {
    whereClause.saleStatus = {
      not: 'NOT_APPROVED',
    };
  }

  if (customerId) {
    whereClause.customerId = customerId;
  }

  if (createdById) {
    whereClause.createdById = createdById;
  }

  const sells = await prisma.sell.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    include: {
      customer: true,
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      items: {
        include: {
          item: true,
        },
      },
      sellPayments: {
        select: { id: true, amount: true, createdAt: true },
      },
      _count: {
        select: { items: true },
      },
    },
  });

  return {
    sells,
    count: sells.length,
  };
};
// Helper function to get main store
const getMainStore = async () => {
  const mainStore = await prisma.store.findFirst({
    where: { isMain: true },
  });

  if (!mainStore) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'No main store configured. Please set a main store first.',
    );
  }

  return mainStore;
};

// ==================== CREATE SELL ====================
const createSell = async (sellBody, userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

  // Get the main store automatically
  const mainStore = await getMainStore();

  const { items: itemsString, ...restSellBody } = sellBody;
  const items =
    typeof itemsString === 'string' ? JSON.parse(itemsString) : itemsString;

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Sale must have at least one item',
    );
  }

  const invoiceNo = await generateInvoiceNumber();

  // Validate items
  const itemIds = items.map((item) => item.itemId).filter(Boolean);

  if (itemIds.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'All items must have an itemId');
  }

  // Fetch items for validation
  const itemsWithData = await prisma.items.findMany({
    where: { id: { in: itemIds } },
  });

  // Validate items exist
  const missingItem = items.find(
    (item) => !itemsWithData.some((i) => i.id === item.itemId),
  );

  if (missingItem) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      `Item with ID ${missingItem.itemId} not found`,
    );
  }

  // Calculate totals
  const enhancedItems = items.map((item) => {
    const itemData = itemsWithData.find((i) => i.id === item.itemId);
    const unitPrice = item.unitPrice || itemData.price;
    const totalPrice = unitPrice * item.quantity;

    return {
      itemId: item.itemId,
      quantity: item.quantity,
      unitPrice,
      totalPrice,
    };
  });

  const { subTotal, discount, vat, grandTotal } =
    calculateTotals(enhancedItems);

  // Create the sell record with main store
  const sell = await prisma.sell.create({
    data: {
      invoiceNo,
      customerId: restSellBody.customerId || null,
      storeId: mainStore.id, // Always use main store
      subTotal,
      discount,
      vat,
      grandTotal,
      totalPaid: 0,
      balance: grandTotal, // Balance equals grandTotal initially
      totalProducts: enhancedItems.length,
      saleStatus: 'NOT_APPROVED',
      paymentStatus: 'PENDING',
      saleDate: restSellBody.saleDate
        ? new Date(restSellBody.saleDate)
        : new Date(),
      notes: restSellBody.notes,
      createdById: userId,
      updatedById: userId,
      items: {
        create: enhancedItems.map((item) => ({
          itemId: item.itemId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
        })),
      },
    },
    include: {
      customer: true,
      store: true, // Include store in response
      items: {
        include: {
          item: true,
        },
      },
    },
  });

  return sell;
};

// ==================== UPDATE SELL ====================
const updateSell = async (sellId, sellBody, userId) => {
  const existingSell = await getSellById(sellId);
  if (!existingSell) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }

  if (existingSell.locked === true) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot update locked sale');
  }

  if (['DELIVERED', 'CANCELLED'].includes(existingSell.saleStatus)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot update ${existingSell.saleStatus.toLowerCase()} sale`,
    );
  }

  // Get the main store automatically (ignore any storeId from frontend)
  const mainStore = await getMainStore();

  const { items: itemsString, ...restSellBody } = sellBody;
  const items =
    typeof itemsString === 'string' ? JSON.parse(itemsString) : itemsString;

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Sale must have at least one item',
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // Delete current items
    await tx.sellItem.deleteMany({
      where: { sellId },
    });

    // Validate new items
    const itemIds = items.map((item) => item.itemId).filter(Boolean);
    const itemsWithData = await tx.items.findMany({
      where: { id: { in: itemIds } },
    });

    items.forEach((item) => {
      const itemData = itemsWithData.find((i) => i.id === item.itemId);
      if (!itemData) {
        throw new ApiError(
          httpStatus.NOT_FOUND,
          `Item with ID ${item.itemId} not found`,
        );
      }
    });

    // Calculate new totals
    const enhancedItems = items.map((item) => {
      const itemData = itemsWithData.find((i) => i.id === item.itemId);
      const unitPrice = item.unitPrice || itemData.price;
      const totalPrice = unitPrice * item.quantity;

      return {
        itemId: item.itemId,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
      };
    });

    const { subTotal, discount, vat, grandTotal } =
      calculateTotals(enhancedItems);

    // Update sell with main store
    const updatedSell = await tx.sell.update({
      where: { id: sellId },
      data: {
        customerId: restSellBody.customerId || existingSell.customerId,
        storeId: mainStore.id, // Always use main store (ignore any frontend value)
        subTotal,
        discount,
        vat,
        grandTotal,
        balance: grandTotal, // Reset balance to grandTotal on update
        totalProducts: enhancedItems.length,
        updatedById: userId,
        saleStatus: 'NOT_APPROVED', // Reset status on update
        items: {
          create: enhancedItems.map((item) => ({
            itemId: item.itemId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
          })),
        },
      },
      include: {
        customer: true,
        store: true, // Include store in response
        items: {
          include: {
            item: true,
          },
        },
      },
    });

    return updatedSell;
  });

  return result;
};

// ==================== DELETE SELL ====================
const deleteSell = async (id, userId) => {
  const existingSell = await getSellById(id);
  if (!existingSell) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }

  if (existingSell.locked === true) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot delete locked sale');
  }

  await prisma.$transaction(async (tx) => {
    // Get all sell items
    const sellItems = await tx.sellItem.findMany({
      where: { sellId: id },
    });

    // Restore stock for all items
    for (const sellItem of sellItems) {
      await tx.itemStock.update({
        where: { itemId: sellItem.itemId },
        data: {
          quantity: { increment: sellItem.quantity },
        },
      });

      await tx.itemStockLedger.create({
        data: {
          itemId: sellItem.itemId,
          movementType: 'IN',
          quantity: sellItem.quantity,
          reference: `Sell-Delete-${existingSell.invoiceNo}`,
          notes: `Stock restored from deleted sale`,
          userId,
        },
      });
    }

    // Delete sell items
    await tx.sellItem.deleteMany({
      where: { sellId: id },
    });

    // Delete sell payments
    await tx.sellPayment.deleteMany({
      where: { sellId: id },
    });

    // Delete sell
    await tx.sell.delete({
      where: { id },
    });
  });

  return { message: 'Sale deleted successfully' };
};

// ==================== ADD SELL PAYMENT ====================
const addSellPayment = async (sellId, paymentData, userId) => {
  const { amount, bankId, paidBy } = paymentData;

  // Validate amount
  if (!amount || amount <= 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Payment amount must be greater than 0',
    );
  }

  // Validate bankId
  if (!bankId) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Bank ID is required for payment',
    );
  }

  // Validate paidBy
  if (!paidBy) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Paid by information is required',
    );
  }

  // Verify bank exists
  const bank = await prisma.bank.findUnique({
    where: { id: bankId },
  });

  if (!bank) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Bank not found');
  }

  // Fetch sell with payments
  const sell = await prisma.sell.findUnique({
    where: { id: sellId },
    include: {
      sellPayments: true,
    },
  });

  if (!sell) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sell not found');
  }

  // Check if sale is cancelled
  if (sell.saleStatus === 'CANCELLED') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot add payment to cancelled sale',
    );
  }

  // Calculate current total paid
  const currentTotalPaid = sell.sellPayments.reduce(
    (sum, payment) => sum + payment.amount,
    0,
  );
  const newTotalPaid = currentTotalPaid + amount;
  const remainingBalance = sell.grandTotal - currentTotalPaid;

  // Check if payment exceeds remaining balance
  if (newTotalPaid > sell.grandTotal) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Payment amount exceeds remaining balance (${remainingBalance})`,
    );
  }

  // Determine payment status
  let paymentStatus;
  if (newTotalPaid >= sell.grandTotal) {
    paymentStatus = 'PAID';
  } else if (newTotalPaid > 0) {
    paymentStatus = 'PARTIAL';
  } else {
    paymentStatus = 'PENDING';
  }

  const newBalance = sell.grandTotal - newTotalPaid;

  // Start transaction
  const result = await prisma.$transaction(async (tx) => {
    // Create payment record
    const payment = await tx.sellPayment.create({
      data: {
        sellId,
        amount,
        bankId,
        paidBy,
        createdById: userId,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
        bank: {
          select: { id: true, bankName: true, accountNumber: true }, // Fixed: changed 'name' to 'bankName'
        },
      },
    });

    // Update sell record
    const updatedSell = await tx.sell.update({
      where: { id: sellId },
      data: {
        totalPaid: newTotalPaid,
        balance: newBalance,
        paymentStatus,
      },
      include: {
        customer: true,
        sellPayments: {
          orderBy: { createdAt: 'desc' },
          include: {
            createdBy: {
              select: { id: true, name: true, email: true },
            },
            bank: {
              select: { id: true, bankName: true, accountNumber: true }, // Fixed: changed 'name' to 'bankName'
            },
          },
        },
      },
    });

    return { payment, sell: updatedSell };
  });

  return result;
};

// ==================== GET SELL PAYMENT HISTORY ====================
const getSellPaymentHistory = async (sellId) => {
  const sell = await prisma.sell.findUnique({
    where: { id: sellId },
    include: {
      sellPayments: {
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
      },
      customer: true,
    },
  });

  if (!sell) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sell not found');
  }

  return {
    sell: {
      id: sell.id,
      invoiceNo: sell.invoiceNo,
      grandTotal: sell.grandTotal,
      totalPaid: sell.totalPaid,
      balance: sell.balance,
      paymentStatus: sell.paymentStatus,
      customer: sell.customer,
    },
    payments: sell.sellPayments,
    summary: {
      totalPayments: sell.sellPayments.length,
      totalAmountPaid: sell.totalPaid,
      remainingBalance: sell.balance,
      isFullyPaid: sell.paymentStatus === 'PAID',
    },
  };
};

// ==================== UPDATE SALE STATUS ====================
const updateSaleStatus = async (saleId, newStatus, userId) => {
  const sale = await getSellById(saleId);

  if (!sale) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }

  const allowedTransitions = {
    NOT_APPROVED: ['APPROVED', 'CANCELLED'],
    APPROVED: ['DELIVERED', 'CANCELLED'],
    PARTIALLY_DELIVERED: ['DELIVERED', 'CANCELLED'],
    DELIVERED: [],
    CANCELLED: [],
  };

  if (!allowedTransitions[sale.saleStatus]?.includes(newStatus)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot change status from ${sale.saleStatus} to ${newStatus}`,
    );
  }

  const updatedSale = await prisma.sell.update({
    where: { id: saleId },
    data: {
      saleStatus: newStatus,
      updatedById: userId,
    },
    include: {
      items: {
        include: {
          item: true,
        },
      },
      customer: true,
    },
  });

  // Send notifications for APPROVED status
  if (newStatus === 'APPROVED') {
    const io = getIO();
    const notification = {
      title: 'Sale Approved',
      message: `Sale #${updatedSale.invoiceNo} has been approved`,
      type: 'SELL_APPROVED',
      relatedEntityType: 'SELL',
      saleId: updatedSale.id,
      invoiceNo: updatedSale.invoiceNo,
      timestamp: new Date().toISOString(),
    };
    io.emit('new-notification', notification);
  }

  return updatedSale;
};

// ==================== CANCEL SALE ====================
const cancelSale = async (saleId, userId) => {
  const sale = await getSellById(saleId);

  if (!sale) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }

  if (sale.saleStatus === 'DELIVERED') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot cancel delivered sale');
  }

  const updatedSale = await prisma.$transaction(async (tx) => {
    // Restore stock for all items
    const sellItems = await tx.sellItem.findMany({
      where: { sellId: saleId },
    });

    for (const sellItem of sellItems) {
      await tx.itemStock.update({
        where: { itemId: sellItem.itemId },
        data: {
          quantity: { increment: sellItem.quantity },
        },
      });

      await tx.itemStockLedger.create({
        data: {
          itemId: sellItem.itemId,
          movementType: 'IN',
          quantity: sellItem.quantity,
          reference: `Sell-Cancel-${sale.invoiceNo}`,
          notes: `Stock restored from cancelled sale`,
          userId,
        },
      });
    }

    return await tx.sell.update({
      where: { id: saleId },
      data: {
        saleStatus: 'CANCELLED',
        updatedById: userId,
      },
      include: {
        customer: true,
        items: {
          include: {
            item: true,
          },
        },
      },
    });
  });

  return updatedSale;
};

// ==================== UNLOCK SELL ====================
const unlockSell = async (id) => {
  const currentSell = await prisma.sell.findUnique({
    where: { id },
  });

  if (!currentSell) {
    throw new Error(`Sell with id ${id} not found`);
  }

  const newLockedState = !currentSell.locked;

  const sell = await prisma.sell.update({
    where: { id },
    data: {
      locked: newLockedState,
      lockedAt: new Date(),
    },
  });

  return sell;
};

// ==================== GET SELL STATISTICS ====================
const getSellStatistics = async ({ startDate, endDate } = {}) => {
  const whereClause = {};
  const twelveMonthsAgo = subMonths(new Date(), 12);

  const startDateObj = startDate ? new Date(startDate) : twelveMonthsAgo;
  const endDateObj = endDate ? new Date(endDate) : new Date();

  whereClause.saleDate = {
    gte: startDateObj,
    lte: endDateObj,
  };

  const sells = await prisma.sell.findMany({
    where: whereClause,
    include: {
      sellPayments: true,
    },
  });

  const totalSales = sells.length;
  const totalRevenue = sells.reduce((sum, sell) => sum + sell.grandTotal, 0);
  const totalPaid = sells.reduce((sum, sell) => sum + sell.totalPaid, 0);
  const totalBalance = sells.reduce((sum, sell) => sum + sell.balance, 0);

  const statusCounts = {
    NOT_APPROVED: sells.filter((s) => s.saleStatus === 'NOT_APPROVED').length,
    APPROVED: sells.filter((s) => s.saleStatus === 'APPROVED').length,
    PARTIALLY_DELIVERED: sells.filter(
      (s) => s.saleStatus === 'PARTIALLY_DELIVERED',
    ).length,
    DELIVERED: sells.filter((s) => s.saleStatus === 'DELIVERED').length,
    CANCELLED: sells.filter((s) => s.saleStatus === 'CANCELLED').length,
  };

  const paymentStatusCounts = {
    PENDING: sells.filter((s) => s.paymentStatus === 'PENDING').length,
    PARTIAL: sells.filter((s) => s.paymentStatus === 'PARTIAL').length,
    PAID: sells.filter((s) => s.paymentStatus === 'PAID').length,
    CANCELLED: sells.filter((s) => s.paymentStatus === 'CANCELLED').length,
  };

  return {
    totalSales,
    totalRevenue,
    totalPaid,
    totalBalance,
    statusCounts,
    paymentStatusCounts,
    dateRange: {
      start: startDateObj,
      end: endDateObj,
    },
  };
};
// services/delivery.service.js

const deliverSaleItems = async (saleId, deliveryItems, userId) => {
  try {
    // Get the sale with its items and store relation
    let sale;
    try {
      sale = await prisma.sell.findUnique({
        where: { id: saleId },
        include: {
          store: true, // Include store relation directly
          items: {
            include: {
              item: {
                include: {
                  itemStocks: true, // Get all stocks, we'll filter by storeId
                },
              },
            },
          },
        },
      });
    } catch (prismaError) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Database error: ${prismaError.message}`,
      );
    }

    if (!sale) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
    }

    // Get the store ID directly from the sale
    const saleStoreId = sale.storeId;

    // Check if sale can be delivered
    if (sale.saleStatus === 'CANCELLED') {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cannot deliver a cancelled sale',
      );
    }

    if (sale.saleStatus === 'DELIVERED') {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Sale is already fully delivered',
      );
    }

    // Validate all delivery items first
    const validationErrors = deliveryItems
      .map((deliveryItem) => {
        const sellItem = sale.items.find(
          (item) => item.id === deliveryItem.sellItemId,
        );

        if (!sellItem) {
          return `Sell item ${deliveryItem.sellItemId} not found`;
        }

        // Get stock for the sale's store
        const itemStock = sellItem.item?.itemStocks?.find(
          (stock) => stock.storeId === saleStoreId,
        );
        const availableStock = itemStock?.quantity || 0;

        if (sellItem.itemSaleStatus === 'DELIVERED') {
          return `Item ${sellItem.item.name} is already fully delivered`;
        }

        if (deliveryItem.quantityDelivered > sellItem.quantity) {
          return `Cannot deliver more than ordered quantity for item ${sellItem.item.name}`;
        }

        if (deliveryItem.quantityDelivered > availableStock) {
          return `Insufficient stock for item ${sellItem.item.name} at store ${
            sale.store?.name || saleStoreId
          }. Available: ${availableStock}, Requested: ${
            deliveryItem.quantityDelivered
          }`;
        }

        if (deliveryItem.quantityDelivered <= 0) {
          return `Delivery quantity must be greater than 0 for item ${sellItem.item.name}`;
        }

        return null;
      })
      .filter((error) => error !== null);

    if (validationErrors.length > 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, validationErrors.join(', '));
    }

    // Process each delivery item
    const updatePromises = deliveryItems.map(async (deliveryItem) => {
      const sellItem = sale.items.find(
        (item) => item.id === deliveryItem.sellItemId,
      );

      if (!sellItem) {
        throw new Error(`Sell item not found: ${deliveryItem.sellItemId}`);
      }

      // Update stock for the sale's store
      if (deliveryItem.quantityDelivered > 0) {
        // Find the existing stock record for this item at the sale's store
        const existingStock = await prisma.itemStock.findFirst({
          where: {
            itemId: sellItem.itemId,
            storeId: saleStoreId,
          },
        });

        if (existingStock) {
          // Update existing stock
          await prisma.itemStock.update({
            where: { id: existingStock.id },
            data: {
              quantity: {
                decrement: deliveryItem.quantityDelivered,
              },
            },
          });
        } else {
          // If no stock record exists, throw error
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `No stock record found for item ${sellItem.item.name} at store ${
              sale.store?.name || saleStoreId
            }`,
          );
        }

        // Create ledger entry with store reference
        await prisma.itemStockLedger.create({
          data: {
            itemId: sellItem.itemId,
            movementType: 'OUT',
            quantity: -deliveryItem.quantityDelivered,
            reference: `Sale delivery for invoice ${sale.invoiceNo}`,
            notes: `Delivered ${deliveryItem.quantityDelivered} units for sale item ${sellItem.id}`,
            storeId: saleStoreId, // Use store ID from sale
            userId,
          },
        });
      }

      // Update sell item to DELIVERED regardless of quantity delivered
      const updatedSellItem = await prisma.sellItem.update({
        where: { id: deliveryItem.sellItemId },
        data: {
          itemSaleStatus: 'DELIVERED',
        },
        include: {
          item: true,
        },
      });

      return updatedSellItem;
    });

    const updatedItems = await Promise.all(updatePromises);

    // Check if all items in the sale are now DELIVERED
    const currentSale = await prisma.sell.findUnique({
      where: { id: saleId },
      include: {
        items: true,
      },
    });

    const allItemsDelivered = currentSale.items.every(
      (item) => item.itemSaleStatus === 'DELIVERED',
    );

    const anyItemDelivered = currentSale.items.some(
      (item) => item.itemSaleStatus === 'DELIVERED',
    );

    // Determine new sale status
    let newSaleStatus;
    if (allItemsDelivered) {
      newSaleStatus = 'DELIVERED';
    } else if (anyItemDelivered) {
      newSaleStatus = 'PARTIALLY_DELIVERED';
    } else {
      newSaleStatus = sale.saleStatus;
    }

    // Update sale status if changed
    let updatedSale = sale;
    if (newSaleStatus !== sale.saleStatus) {
      updatedSale = await prisma.sell.update({
        where: { id: saleId },
        data: {
          saleStatus: newSaleStatus,
          updatedById: userId,
          updatedAt: new Date(),
        },
        include: {
          items: true,
          customer: true,
          store: true,
          createdBy: true,
        },
      });
    }

    const finalResult = {
      sale: updatedSale,
      items: updatedItems,
      summary: {
        allItemsDelivered,
        anyItemDelivered,
        totalItemsDelivered: updatedItems.length,
        saleStatus: newSaleStatus,
      },
    };

    return finalResult;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Delivery failed: ${error.message}`,
    );
  }
};
const addSellFiles = async (sellId, userId, structuredFiles = {}) => {
  // Validate userId
  if (!userId) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'User ID is required');
  }

  // Check if sell exists
  const existingSell = await prisma.sell.findUnique({
    where: { id: sellId },
    select: {
      id: true,
      invoiceNo: true,
      imageUrl: true,
      documentUrl: true,
    },
  });

  if (!existingSell) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }

  try {
    let { imageUrl } = existingSell;
    let { documentUrl } = existingSell;

    // Handle image upload from structuredFiles
    if (structuredFiles.image && structuredFiles.image.length > 0) {
      const imageFile = structuredFiles.image[0];
      let fileUrl = imageFile.path;

      // Convert Windows path to URL format
      fileUrl = fileUrl.replace(/\\/g, '/');
      // Extract the path after 'uploads'
      const uploadsIndex = fileUrl.indexOf('/uploads/');
      if (uploadsIndex !== -1) {
        fileUrl = fileUrl.substring(uploadsIndex);
      } else {
        // If no 'uploads' in path, just use the filename
        fileUrl = `/uploads/sell/images/${imageFile.filename}`;
      }

      imageUrl = fileUrl;
    }

    // Handle document upload from structuredFiles
    if (structuredFiles.document && structuredFiles.document.length > 0) {
      const documentFile = structuredFiles.document[0];
      let fileUrl = documentFile.path;

      // Convert Windows path to URL format
      fileUrl = fileUrl.replace(/\\/g, '/');
      // Extract the path after 'uploads'
      const uploadsIndex = fileUrl.indexOf('/uploads/');
      if (uploadsIndex !== -1) {
        fileUrl = fileUrl.substring(uploadsIndex);
      } else {
        // If no 'uploads' in path, just use the filename
        fileUrl = `/uploads/sell/documents/${documentFile.filename}`;
      }

      documentUrl = fileUrl;
    }

    // Update sell record with both files
    const updatedSell = await prisma.$transaction(async (prismaTx) => {
      const sell = await prismaTx.sell.update({
        where: { id: sellId },
        data: {
          imageUrl,
          documentUrl,
        },
      });

      // Create log entry
      const addedFiles = [];
      if (structuredFiles.image && structuredFiles.image.length > 0)
        addedFiles.push('image');
      if (structuredFiles.document && structuredFiles.document.length > 0)
        addedFiles.push('document');

      if (addedFiles.length > 0) {
        await prismaTx.log.create({
          data: {
            action: `Added/Updated ${addedFiles.join(' and ')} for sale ${
              existingSell.invoiceNo
            }`,
            userId,
          },
        });
      }

      return sell;
    });

    return {
      success: true,
      message: `${structuredFiles.image ? 'Image' : ''}${
        structuredFiles.image && structuredFiles.document ? ' and ' : ''
      }${
        structuredFiles.document ? 'Document' : ''
      } added/updated successfully`,
      data: updatedSell,
    };
  } catch (error) {
    if (error.code) {
      console.error('Prisma error code:', error.code);
    }

    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to add files to sale: ${error.message}`,
    );
  }
};
// ==================== EXPORTS ====================
module.exports = {
  addSellFiles,
  deliverSaleItems,
  getAllSellsnotApproved,
  getSellById,
  getSellByInvoiceNo,
  getAllSells,
  createSell,
  updateSell,
  deleteSell,
  addSellPayment,
  getSellPaymentHistory,
  updateSaleStatus,
  cancelSale,
  unlockSell,
  getSellStatistics,
};
