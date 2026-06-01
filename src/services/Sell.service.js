const httpStatus = require('http-status');
const { subMonths } = require('date-fns');
const { getIO } = require('../socket/s');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

const getSellById = async (identifier) => {
  const sell = await prisma.sell.findFirst({
    where: {
      OR: [{ id: identifier }, { invoiceNo: identifier }],
    },
    include: {
      branch: true,
      customer: true,
      createdBy: true,
      updatedBy: true,
      items: {
        include: {
          product: {
            include: {
              unitOfMeasure: true,
              category: true,
            },
          },
          shop: true,
          unitOfMeasure: true,
          batches: {
            include: {
              batch: true,
            },
          },
        },
      },
    },
  });
  return sell;
};
const getSellByIdByuser = async (id, userId = null) => {
  // Get the sell with all items first
  const sell = await prisma.sell.findUnique({
    where: { id },
    include: {
      branch: true,
      customer: true,
      createdBy: true,
      updatedBy: true,
      items: {
        include: {
          product: {
            include: {
              unitOfMeasure: true,
              category: true,
            },
          },
          shop: true,
          unitOfMeasure: true,
          batches: {
            include: {
              batch: true, // Just include the batch relation directly
            },
          },
        },
      },
    },
  });
  const existingSell = await prisma.sell.findUnique({
    where: { id },
    select: { locked: true, lockedAt: true },
  });

  // If record is unlocked (false), check time validity
  if (existingSell && existingSell.locked === false) {
    // Case 1: lockedAt is missing → lock immediately
    if (!existingSell.lockedAt) {
      return prisma.sell.update({
        where: { id },
        data: {
          locked: true,
          lockedAt: new Date(),
        },
      });
    }

    // Case 2: lockedAt exists → check 20 minutes rule
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);

    if (existingSell.lockedAt < twentyMinutesAgo) {
      return prisma.sell.update({
        where: { id },
        data: {
          locked: true,
          lockedAt: new Date(),
        },
      });
    }
  }

  if (!sell) return null;

  // If userId is provided, filter items and return both versions
  if (userId) {
    const userWithShops = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        shops: {
          select: { id: true },
        },
      },
    });

    const userShopIds = userWithShops?.shops?.map((shop) => shop.id) || [];

    const filteredItems = sell.items.filter((item) =>
      userShopIds.includes(item.shopId),
    );

    return {
      ...sell,
      items: filteredItems,
      // Include metadata about the filtering
      _metadata: {
        totalItems: sell.items.length,
        accessibleItems: filteredItems.length,
        hasRestrictedAccess: filteredItems.length < sell.items.length,
      },
    };
  }

  return sell;
};

// Get Sell by invoice number
const getSellByInvoiceNo = async (invoiceNo) => {
  const sell = await prisma.sell.findFirst({
    where: { invoiceNo },
    include: {
      branch: true,
      customer: true,
      items: {
        include: {
          product: {
            include: {
              unitOfMeasure: true,
              category: true,
            },
          },
          shop: true,
          unitOfMeasure: true,
          batches: {
            include: {
              batch: true,
            },
          },
        },
      },
    },
  });
  return sell;
};

// Get all Sells
const getAllSells = async ({
  startDate,
  endDate,
  saleStatus,
  branchId,
} = {}) => {
  const whereClause = {};
  const twelveMonthsAgo = subMonths(new Date(), 12); // Default time range

  // Convert string dates to Date objects if they exist
  const startDateObj = startDate ? new Date(startDate) : undefined;
  const endDateObj = endDate ? new Date(endDate) : undefined;

  // Build the date filter
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

  // Add sale status filter if provided
  if (saleStatus) {
    whereClause.saleStatus = saleStatus;
  }

  // Add branch filter if provided
  if (branchId) {
    whereClause.branchId = branchId;
  }

  const sells = await prisma.sell.findMany({
    where: whereClause,
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      branch: true,
      customer: true,
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      items: {
        include: {
          product: {
            include: {
              unitOfMeasure: true,
              category: true,
            },
          },
          shop: true,
          unitOfMeasure: true,
          batches: {
            include: {
              batch: true,
            },
          },
        },
      },
      SellStockCorrection: {
        select: {
          id: true,
          status: true, // Only including status as requested
          createdAt: true,
        },
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

const generateInvoiceNumber = async () => {
  try {
    console.log('🔢 [INVOICE] Generating invoice number...');

    // Get all invoice numbers
    const allSells = await prisma.sell.findMany({
      select: { invoiceNo: true },
    });

    let maxNumber = 0;

    if (allSells.length === 0) {
      // No invoices exist, start from 00001
      const invoiceNumber = 'INV-00001';
      console.log('✅ [INVOICE] First invoice:', invoiceNumber);
      return invoiceNumber;
    }

    // Find the maximum numeric invoice number
    for (const sell of allSells) {
      // Extract numeric part from any format
      const match = sell.invoiceNo.match(/INV-?(\d+)/i);
      if (match && match[1]) {
        const numericPart = parseInt(match[1], 10);
        if (!isNaN(numericPart) && numericPart > maxNumber) {
          maxNumber = numericPart;
        }
      }
    }

    const nextNumber = maxNumber === 0 ? 1 : maxNumber + 1;
    console.log(
      '🔢 [INVOICE] Max number found:',
      maxNumber,
      'Next:',
      nextNumber,
    );

    // Format: Always 5 digits
    const invoiceNumber = `INV-${nextNumber.toString().padStart(5, '0')}`;
    console.log('✅ [INVOICE] Generated:', invoiceNumber);

    return invoiceNumber;
  } catch (error) {
    console.error('❌ [INVOICE ERROR]:', error);
    return `INV-${Date.now().toString().slice(-8)}`;
  }
};
// Create Sell
// Create Sell
const createSell = async (sellBody, userId) => {
  console.log(sellBody);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { branch: true },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

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
  // Check if discount exists
  const checkdiscount = restSellBody.discount || 0;
  const hasDiscount = checkdiscount > 0;
  // Extract product IDs and shop IDs from items
  const productIds = items.map((item) => item.productId).filter(Boolean);
  const shopIds = items.map((item) => item.shopId).filter(Boolean);

  if (productIds.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'All items must have a productId',
    );
  }

  if (shopIds.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'All items must have a shopId');
  }

  // Fetch products with their additional prices and unit of measure
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: {
      unitOfMeasure: true,
      AdditionalPrice: {
        where: {
          OR: [
            { shopId: null }, // Global additional prices
            { shopId: { in: shopIds } }, // Shop-specific additional prices
          ],
        },
      },
    },
  });

  // Fetch available shop stocks for validation - corrected query
  const shopStocks = await prisma.shopStock.findMany({
    where: {
      shopId: { in: shopIds },
      status: 'Available',
      quantity: { gt: 0 },
      batch: {
        productId: { in: productIds }, // Access productId through batch relation
      },
    },
    include: {
      batch: {
        include: {
          product: true, // Include product to access productId
        },
      },
      shop: true,
    },
  });

  let allItemsApproved = true;
  const enhancedItems = items.map((item, index) => {
    if (!item.productId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} is missing productId`,
      );
    }

    if (!item.shopId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} is missing shopId`,
      );
    }

    const product = products.find((p) => p.id === item.productId);
    if (!product) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid productId`,
      );
    }

    // Check available stock for this product in the selected shop (for validation only)
    const availableStock = shopStocks
      .filter(
        (stock) =>
          stock.batch.productId === item.productId &&
          stock.shopId === item.shopId,
      )
      .reduce((sum, stock) => sum + stock.quantity, 0);

    if (item.quantity <= 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid quantity`,
      );
    }

    if (item.quantity > availableStock) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} quantity (${
          item.quantity
        }) exceeds available stock (${availableStock}) in shop`,
      );
    }

    // ✅ Ensure unitPrice is converted to a number
    const unitPrice = Number(item.unitPrice);
    if (
      typeof unitPrice !== 'number' ||
      Number.isNaN(unitPrice) ||
      unitPrice < 0
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid unit price`,
      );
    }

    // ✅ Get standard price from product

    // ✅ Get additional prices for THIS specific shop (both global and shop-specific)
    const shopAdditionalPrices = product.AdditionalPrice.filter(
      (ap) => ap.shopId === null || ap.shopId === item.shopId,
    );

    // ✅ Check if unit price matches standard price OR any additional price for this shop
    const isAdditionalPrice = shopAdditionalPrices.some(
      (ap) => ap.price === unitPrice,
    );

    const isPriceValid = isAdditionalPrice;

    // If any item has invalid price, mark the entire sale as not approved
    if (!isPriceValid) {
      allItemsApproved = false;
    }

    return {
      ...item,
      productId: item.productId,
      shopId: item.shopId,
      unitOfMeasureId: item.unitOfMeasureId || product.unitOfMeasureId,
      unitPrice,
      isPriceValid, // Track if this item's price is valid
      availableStock, // Store available stock for reference
    };
  });

  const subTotal = enhancedItems.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );
  const discount = restSellBody.discount || 0;
  const vat = restSellBody.vat || 0;
  const grandTotal = subTotal - discount + vat;

  // Determine sale status based on price validation
  const saleStatus =
    allItemsApproved && !hasDiscount ? 'APPROVED' : 'NOT_APPROVED';

  // Create only the sell record without stock updates
  const sell = await prisma.sell.create({
    data: {
      invoiceNo,
      customerId: restSellBody.customerId,
      totalProducts: enhancedItems.length,
      subTotal,
      discount,
      vat,
      grandTotal,
      NetTotal: grandTotal,
      saleStatus, // Set status based on price validation
      saleDate: restSellBody.saleDate
        ? new Date(restSellBody.saleDate)
        : new Date(),
      notes: restSellBody.notes,
      branchId: user.branchId,
      createdById: userId,
      updatedById: userId,
      items: {
        create: enhancedItems.map((item) => ({
          productId: item.productId,
          shopId: item.shopId,
          unitOfMeasureId: item.unitOfMeasureId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.unitPrice * item.quantity,
          itemSaleStatus: 'PENDING', // Default status for items
        })),
      },
    },
    include: {
      branch: true,
      customer: true,
      createdBy: { select: { id: true, name: true, email: true } },
      items: {
        include: {
          product: {
            include: {
              unitOfMeasure: true,
              category: true,
            },
          },
          unitOfMeasure: true,
          shop: true,
        },
      },
    },
  });

  if (saleStatus === 'APPROVED') {
    try {
      const uniqueShopIds = sell.items
        .map((item) => item.shopId)
        .filter(Boolean)
        .filter((shopId, index, array) => array.indexOf(shopId) === index);

      // Find users who have access to these shops
      const usersWithShopAccess = await prisma.user.findMany({
        where: {
          shops: {
            some: {
              id: { in: uniqueShopIds },
            },
          },
          status: 'Active', // Only active users
        },
        select: {
          id: true,
          name: true,
          email: true,
          shops: {
            where: {
              id: { in: uniqueShopIds },
            },
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Create shop notifications (store in database)
      const shopNotifications = await Promise.allSettled(
        uniqueShopIds.map((shopId) =>
          prisma.notification.create({
            data: {
              shopId,
              title: 'Sale Approved - Prepare for Delivery',
              message: `Sale #${sell.invoiceNo} has been approved and is ready for delivery preparation`,
              type: 'SELL_READY_FOR_DELIVERY',
              relatedEntityType: 'SELL',
            },
          }),
        ),
      );

      // Get the Socket.IO instance
      const io = getIO();

      // Create notification object for real-time sending
      const realTimeNotification = {
        title: 'New Sale Approved',
        message: `Sale #${sell.invoiceNo} has been approved and needs delivery preparation`,
        type: 'SELL_READY_FOR_DELIVERY',
        relatedEntityType: 'SELL',
        saleId: sell.id,
        invoiceNo: sell.invoiceNo,
        timestamp: new Date().toISOString(),
      };
      // Send real-time notifications to users with shop access
      usersWithShopAccess.forEach((user) => {
        // Send to each user individually - remove 'user:' prefix
        io.to(user.id).emit('new-notification', realTimeNotification);

        // Also send to user's shops for additional targeting
        user.shops.forEach((shop) => {
          // Remove prefixes to match what frontend will join
          io.to(`${user.id}:${shop.id}`).emit(
            'new-notification',
            realTimeNotification,
          );
        });
      });

      // Log statistics
      const successfulShopCount = shopNotifications.filter(
        (result) => result.status === 'fulfilled',
      ).length;

      console.log(
        `📢 Successfully processed notifications for ${successfulShopCount} shops and ${usersWithShopAccess.length} users for approved sale #${sell.invoiceNo}`,
      );
    } catch (notificationError) {
      console.error(
        '❌ Unexpected error in notification process:',
        notificationError,
      );
    }
  }

  return sell;
};

// Update Sell
const updateSell = async (sellId, sellBody, userId) => {
  // Check if sell exists
  const existingSell = await getSellById(sellId);
  if (!existingSell) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }
  // ✅ DON'T UPDATE IF LOCK IS TRUE
  if (existingSell.locked === true) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot update locked sale');
  }

  // Cannot update delivered or cancelled sells
  if (
    ['DELIVERED', 'PARTIALLY_DELIVERED', 'CANCELLED'].includes(
      existingSell.saleStatus,
    )
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot update ${existingSell.saleStatus.toLowerCase()} sale`,
    );
  }

  // Check if invoice number already exists (excluding current sell)
  if (sellBody.invoiceNo && sellBody.invoiceNo !== existingSell.invoiceNo) {
    if (await getSellByInvoiceNo(sellBody.invoiceNo)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invoice number already taken',
      );
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { branch: true },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

  const { items: itemsString, ...restSellBody } = sellBody;
  const items =
    typeof itemsString === 'string' ? JSON.parse(itemsString) : itemsString;

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Sale must have at least one item',
    );
  }

  // ✅ DISCOUNT LOGIC: Check if discount exists in the update request
  // If discount is not provided in the update, use the existing discount
  const newDiscount =
    restSellBody.discount !== undefined
      ? Number(restSellBody.discount)
      : existingSell.discount;

  // Track if discount is being changed from zero to non-zero or vice versa
  const existingDiscountWasZero = existingSell.discount === 0;
  const newDiscountIsZero = newDiscount === 0;
  const discountChangedFromZeroToNonZero =
    existingDiscountWasZero && !newDiscountIsZero;
  const discountChangedFromNonZeroToZero =
    !existingDiscountWasZero && newDiscountIsZero;

  // ✅ HAS DISCOUNT LOGIC: Sale has discount if newDiscount > 0
  const hasDiscount = newDiscount > 0;

  // Extract product IDs and shop IDs from items
  const productIds = items.map((item) => item.productId).filter(Boolean);
  const shopIds = items.map((item) => item.shopId).filter(Boolean);

  if (productIds.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'All items must have a productId',
    );
  }

  if (shopIds.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'All items must have a shopId');
  }

  // Fetch products with their additional prices and unit of measure
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: {
      unitOfMeasure: true,
      AdditionalPrice: {
        where: {
          OR: [
            { shopId: null }, // Global additional prices
            { shopId: { in: shopIds } }, // Shop-specific additional prices
          ],
        },
      },
    },
  });

  // Fetch available shop stocks for validation
  const shopStocks = await prisma.shopStock.findMany({
    where: {
      shopId: { in: shopIds },
      status: 'Available',
      quantity: { gt: 0 },
      batch: {
        productId: { in: productIds },
      },
    },
    include: {
      batch: {
        include: {
          product: true,
        },
      },
      shop: true,
    },
  });

  let allItemsApproved = true;
  const enhancedItems = items.map((item, index) => {
    if (!item.productId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} is missing productId`,
      );
    }

    if (!item.shopId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} is missing shopId`,
      );
    }

    const product = products.find((p) => p.id === item.productId);
    if (!product) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid productId`,
      );
    }

    // Check available stock for this product in the selected shop
    // For updates, we need to consider the existing sale quantities
    const availableStock = shopStocks
      .filter(
        (stock) =>
          stock.batch.productId === item.productId &&
          stock.shopId === item.shopId,
      )
      .reduce((sum, stock) => sum + stock.quantity, 0);

    // For update, we need to add back the quantities from existing sale items
    const existingItem = existingSell.items.find(
      (existing) =>
        existing.productId === item.productId &&
        existing.shopId === item.shopId,
    );

    const adjustedAvailableStock = existingItem
      ? availableStock + existingItem.quantity
      : availableStock;

    if (item.quantity <= 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid quantity`,
      );
    }

    if (item.quantity > adjustedAvailableStock) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} quantity (${
          item.quantity
        }) exceeds available stock (${adjustedAvailableStock}) in shop`,
      );
    }

    // ✅ Ensure unitPrice is converted to a number
    const unitPrice = Number(item.unitPrice);
    if (
      typeof unitPrice !== 'number' ||
      Number.isNaN(unitPrice) ||
      unitPrice < 0
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid unit price`,
      );
    }

    // ✅ Get standard price from product

    // ✅ Get additional prices for THIS specific shop (both global and shop-specific)
    const shopAdditionalPrices = product.AdditionalPrice.filter(
      (ap) => ap.shopId === null || ap.shopId === item.shopId,
    );

    // ✅ Check if unit price matches standard price OR any additional price for this shop
    const isAdditionalPrice = shopAdditionalPrices.some(
      (ap) => ap.price === unitPrice,
    );

    const isPriceValid = isAdditionalPrice;

    // If any item has invalid price, mark the entire sale as not approved
    if (!isPriceValid) {
      allItemsApproved = false;
    }

    return {
      ...item,
      productId: item.productId,
      shopId: item.shopId,
      unitOfMeasureId: item.unitOfMeasureId || product.unitOfMeasureId,
      unitPrice,
      isPriceValid, // Track if this item's price is valid
      availableStock: adjustedAvailableStock, // Store adjusted available stock for reference
    };
  });

  const subTotal = enhancedItems.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );
  const discount = newDiscount; // Use the calculated newDiscount
  const vat = restSellBody.vat || existingSell.vat || 0;
  const grandTotal = subTotal - discount + vat;

  // ✅ DETERMINE SALE STATUS BASED ON PRICE VALIDATION AND DISCOUNT LOGIC
  // Rules:
  // 1. If any item has invalid price → NOT_APPROVED
  // 2. If there's any discount (newDiscount > 0) → NOT_APPROVED
  // 3. Only APPROVED if all items have valid prices AND no discount

  let saleStatus;

  // If discount is being added (changed from 0 to > 0), force NOT_APPROVED
  if (discountChangedFromZeroToNonZero) {
    saleStatus = 'NOT_APPROVED';
  }
  // If discount is being removed (changed from > 0 to 0), check if items are valid
  else if (discountChangedFromNonZeroToZero) {
    saleStatus = allItemsApproved ? 'APPROVED' : 'NOT_APPROVED';
  }
  // If discount value is not changing, maintain existing logic
  else {
    // If there's a discount (existing or new), sale cannot be approved
    // eslint-disable-next-line no-lonely-if
    if (hasDiscount) {
      saleStatus = 'NOT_APPROVED';
    } else {
      // No discount, check item prices
      saleStatus = allItemsApproved ? 'APPROVED' : 'NOT_APPROVED';
    }
  }

  // Update the sell inside a transaction
  const result = await prisma.$transaction(async (tx) => {
    // Delete all existing items
    await tx.sellItem.deleteMany({
      where: { sellId },
    });

    // Update sell with new items, totals, and status
    const sell = await tx.sell.update({
      where: { id: sellId },
      data: {
        customerId: restSellBody.customerId || existingSell.customerId,
        totalProducts: enhancedItems.length,
        subTotal,
        discount,
        vat,
        grandTotal,
        NetTotal: grandTotal,
        saleStatus, // Set status based on price validation AND discount logic
        saleDate: restSellBody.saleDate
          ? new Date(restSellBody.saleDate)
          : existingSell.saleDate,
        notes: restSellBody.notes || existingSell.notes,
        updatedById: userId,
        items: {
          create: enhancedItems.map((item) => ({
            productId: item.productId,
            shopId: item.shopId,
            unitOfMeasureId: item.unitOfMeasureId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.unitPrice * item.quantity,
            itemSaleStatus: 'PENDING', // Default status for items
          })),
        },
      },
      include: {
        branch: true,
        customer: true,
        createdBy: { select: { id: true, name: true, email: true } },
        items: {
          include: {
            product: {
              include: {
                unitOfMeasure: true,
                category: true,
              },
            },
            unitOfMeasure: true,
            shop: true,
          },
        },
      },
    });
    return sell;
  });

  // ✅ ADD NOTIFICATION CREATION HERE - Only if sell status changed to APPROVED
  if (existingSell.saleStatus !== 'APPROVED' && saleStatus === 'APPROVED') {
    try {
      const uniqueShopIds = result.items
        .map((item) => item.shopId)
        .filter(Boolean)
        .filter((shopId, index, array) => array.indexOf(shopId) === index);

      // Find users who have access to these shops
      const usersWithShopAccess = await prisma.user.findMany({
        where: {
          shops: {
            some: {
              id: { in: uniqueShopIds },
            },
          },
          status: 'Active', // Only active users
        },
        select: {
          id: true,
          name: true,
          email: true,
          shops: {
            where: {
              id: { in: uniqueShopIds },
            },
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Create shop notifications (store in database)
      const shopNotifications = await Promise.allSettled(
        uniqueShopIds.map((shopId) =>
          prisma.notification.create({
            data: {
              shopId,
              title: 'Sale Approved - Prepare for Delivery',
              message: `Sale #${result.invoiceNo} has been approved and is ready for delivery preparation`,
              type: 'SELL_READY_FOR_DELIVERY',
              relatedEntityType: 'SELL',
            },
          }),
        ),
      );

      // Get the Socket.IO instance
      const io = getIO();

      // Create notification object for real-time sending
      const realTimeNotification = {
        title: 'Sale Updated & Approved',
        message: `Sale #${result.invoiceNo} has been updated and approved, ready for delivery preparation`,
        type: 'SELL_READY_FOR_DELIVERY',
        relatedEntityType: 'SELL',
        saleId: result.id,
        invoiceNo: result.invoiceNo,
        timestamp: new Date().toISOString(),
      };
      // Send real-time notifications to users with shop access
      // eslint-disable-next-line no-shadow
      usersWithShopAccess.forEach((user) => {
        // Send to each user individually - remove 'user:' prefix
        io.to(user.id).emit('new-notification', realTimeNotification);

        // Also send to user's shops for additional targeting
        user.shops.forEach((shop) => {
          // Remove prefixes to match what frontend will join
          io.to(`${user.id}:${shop.id}`).emit(
            'new-notification',
            realTimeNotification,
          );
        });
      });

      // Log statistics
      const successfulShopCount = shopNotifications.filter(
        (result) => result.status === 'fulfilled',
      ).length;

      console.log(
        `📢 Successfully processed notifications for ${successfulShopCount} shops and ${usersWithShopAccess.length} users for updated & approved sale #${result.invoiceNo}`,
      );
    } catch (notificationError) {
      console.error(
        '❌ Unexpected error in notification process:',
        notificationError,
      );
      // Don't throw error - the sale was updated successfully
    }
  }

  return result;
};
// Delete Sell
const deleteSell = async (id, userId) => {
  const existingSell = await getSellById(id);
  if (!existingSell) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }
  if (existingSell.locked === true) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot update locked sale');
  }

  // Delete the sell with stock reversal
  await prisma.$transaction(async (tx) => {
    // Get all sell items with their batches
    const sellItemsWithBatches = await tx.sellItem.findMany({
      where: { sellId: id },
      include: {
        batches: {
          include: {
            batch: true,
          },
        },
        shop: true,
        unitOfMeasure: true,
      },
    });

    // Prepare operations for stock reversal
    const reversalOperations = [];

    // Reverse stock for each delivered item
    sellItemsWithBatches.forEach((sellItem) => {
      // Only reverse stock if the item was delivered (has batches)
      if (
        sellItem.batches.length > 0 &&
        sellItem.itemSaleStatus === 'DELIVERED'
      ) {
        sellItem.batches.forEach((sellItemBatch) => {
          const quantityToRestore = sellItemBatch.quantity;

          // Restore stock to shop for this specific batch
          reversalOperations.push(
            tx.shopStock.update({
              where: {
                shopId_batchId: {
                  shopId: sellItem.shopId,
                  batchId: sellItemBatch.batchId,
                },
              },
              data: {
                quantity: { increment: quantityToRestore },
              },
            }),
          );

          // Create reverse stock ledger entry (IN movement to reverse the OUT)
          reversalOperations.push(
            tx.stockLedger.create({
              data: {
                batchId: sellItemBatch.batchId,
                shopId: sellItem.shopId,
                movementType: 'IN',
                quantity: quantityToRestore,
                unitOfMeasureId: sellItem.unitOfMeasureId,
                reference: `Sell-Delete-${existingSell.invoiceNo}`,
                userId,
                notes: `Sale deletion - Stock reversal for Item: ${sellItem.id}`,
                movementDate: new Date(),
              },
            }),
          );
        });
      }
    });

    // Delete all sell item batches first (due to foreign key constraints)
    const sellItemIds = sellItemsWithBatches.map((item) => item.id);
    if (sellItemIds.length > 0) {
      await tx.sellItemBatch.deleteMany({
        where: {
          sellItemId: { in: sellItemIds },
        },
      });
    }

    // Execute stock reversal operations if any
    if (reversalOperations.length > 0) {
      await Promise.all(reversalOperations);
    }

    // Delete all sell items
    await tx.sellItem.deleteMany({
      where: { sellId: id },
    });

    // Delete the sell
    await tx.sell.delete({
      where: { id },
    });

    // Create log entry for the deletion with stock reversal info
    const deliveredItems = sellItemsWithBatches.filter(
      (item) => item.itemSaleStatus === 'DELIVERED' && item.batches.length > 0,
    );

    let logMessage = `Sale ${existingSell.invoiceNo} deleted`;

    if (deliveredItems.length > 0) {
      const totalItemsReversed = deliveredItems.length;
      const totalBatchesReversed = deliveredItems.reduce(
        (sum, item) => sum + item.batches.length,
        0,
      );
      const totalQuantityReversed = deliveredItems.reduce(
        (sum, item) =>
          sum +
          item.batches.reduce((itemSum, batch) => itemSum + batch.quantity, 0),
        0,
      );

      logMessage += ` - Stock reversed: ${totalItemsReversed} items, ${totalBatchesReversed} batches, ${totalQuantityReversed} units`;
    }

    await tx.log.create({
      data: {
        action: logMessage,
        userId,
      },
    });
  });

  return { message: 'Sale deleted successfully with stock reversal' };
};

const completeSaleDelivery = async (saleId, deliveryData, userId) => {
  const sell = await getSellById(saleId);

  if (!sell) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }

  return prisma.$transaction(async (tx) => {
    // Get all unit of measures for the sale items
    const unitOfMeasureIds = sell.items.map((item) => item.unitOfMeasureId);
    const unitOfMeasures = await tx.unitOfMeasure.findMany({
      where: { id: { in: unitOfMeasureIds } },
    });

    const unitOfMeasureMap = unitOfMeasures.reduce((acc, uom) => {
      acc[uom.id] = uom;
      return acc;
    }, {});

    // Get sell items that are being delivered
    const sellItemsToDeliver = await tx.sellItem.findMany({
      where: {
        id: { in: deliveryData.items.map((item) => item.itemId) },
        sellId: saleId,
      },
    });

    if (sellItemsToDeliver.length === 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'No valid items found for delivery. Please check the provided item IDs.',
      );
    }

    // Validate delivery data structure
    if (!deliveryData.items || !Array.isArray(deliveryData.items)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid delivery data format. Expected items array.',
      );
    }

    // Validate all items and batches first
    deliveryData.items.forEach((deliveryItem) => {
      const sellItem = sellItemsToDeliver.find(
        (item) => item.id === deliveryItem.itemId,
      );

      if (!sellItem) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${deliveryItem.itemId} not found in sale`,
        );
      }

      const unitOfMeasure = unitOfMeasureMap[sellItem.unitOfMeasureId];

      if (!unitOfMeasure) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Unit of measure not found for item ${sellItem.id}`,
        );
      }

      // Validate item status transition
      const allowedItemTransitions = {
        PENDING: ['DELIVERED', 'CANCELLED'],
        DELIVERED: ['RETURNED'],
        CANCELLED: [],
        RETURNED: [],
      };

      if (
        !allowedItemTransitions[sellItem.itemSaleStatus]?.includes('DELIVERED')
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Cannot deliver item ${sellItem.id} from current status: ${sellItem.itemSaleStatus}. Item must be in PENDING status to be delivered.`,
        );
      }

      // Validate that batches exist for this item in delivery data
      if (
        !deliveryItem.batches ||
        !Array.isArray(deliveryItem.batches) ||
        deliveryItem.batches.length === 0
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${sellItem.id} has no batches specified in delivery data`,
        );
      }

      // Validate total batch quantities match item quantity
      const totalBatchQuantity = deliveryItem.batches.reduce(
        (sum, batch) => sum + (batch.quantity || 0),
        0,
      );
      if (totalBatchQuantity !== sellItem.quantity) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${sellItem.id}: Total batch quantities (${totalBatchQuantity}) do not match item quantity (${sellItem.quantity})`,
        );
      }

      // Validate each batch
      deliveryItem.batches.forEach((batch, index) => {
        if (!batch.batchId) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Batch ${index + 1} for item ${sellItem.id} is missing batchId`,
          );
        }
        if (!batch.quantity || batch.quantity <= 0) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Batch ${batch.batchId} for item ${sellItem.id} has invalid quantity`,
          );
        }
      });
    });

    // Prepare operations for creating batches and processing delivery
    const operations = deliveryData.items.flatMap((deliveryItem) => {
      const sellItem = sellItemsToDeliver.find(
        (item) => item.id === deliveryItem.itemId,
      );
      const itemOperations = [];

      // First, create SellItemBatch records for this item
      deliveryItem.batches.forEach((batch) => {
        itemOperations.push(
          tx.sellItemBatch.create({
            data: {
              sellItemId: deliveryItem.itemId,
              batchId: batch.batchId,
              quantity: batch.quantity,
            },
          }),
        );
      });

      // Process each batch for stock updates
      deliveryItem.batches.forEach((batch) => {
        const quantityToUse = batch.quantity;

        // Remove stock from shop for this specific batch
        itemOperations.push(
          tx.shopStock.update({
            where: {
              shopId_batchId: {
                shopId: sellItem.shopId,
                batchId: batch.batchId,
              },
            },
            data: {
              quantity: { decrement: quantityToUse },
            },
          }),
        );

        // Create stock ledger entry for this batch
        itemOperations.push(
          tx.stockLedger.create({
            data: {
              batchId: batch.batchId,
              shopId: sellItem.shopId,
              movementType: 'OUT',
              quantity: quantityToUse,
              unitOfMeasureId: sellItem.unitOfMeasureId,
              reference: `Sell-${sell.invoiceNo}`,
              userId,
              notes: `Sale delivery to customer - Item: ${sellItem.id}`,
              movementDate: new Date(),
            },
          }),
        );
      });

      // Update item status to DELIVERED
      itemOperations.push(
        tx.sellItem.update({
          where: { id: deliveryItem.itemId },
          data: { itemSaleStatus: 'DELIVERED' },
        }),
      );

      return itemOperations;
    });

    const updatedItems = deliveryData.items.map((deliveryItem) => {
      const sellItem = sellItemsToDeliver.find(
        (item) => item.id === deliveryItem.itemId,
      );
      return {
        id: sellItem.id,
        shopId: sellItem.shopId,
        previousStatus: sellItem.itemSaleStatus,
        newStatus: 'DELIVERED',
        batchCount: deliveryItem.batches.length,
        totalQuantity: sellItem.quantity,
      };
    });

    // Execute all operations in parallel
    await Promise.all(operations);

    // Recalculate overall sale status based on all item statuses
    const allSaleItems = await tx.sellItem.findMany({
      where: { sellId: saleId },
      include: {
        batches: true,
      },
    });

    const itemStatuses = allSaleItems.map((item) => item.itemSaleStatus);
    let newSaleStatus;

    // Determine overall status based on individual item statuses
    if (itemStatuses.every((status) => status === 'DELIVERED')) {
      newSaleStatus = 'DELIVERED';
    } else if (itemStatuses.every((status) => status === 'CANCELLED')) {
      newSaleStatus = 'CANCELLED';
    } else if (itemStatuses.every((status) => status === 'RETURNED')) {
      newSaleStatus = 'RETURNED';
    } else if (itemStatuses.some((status) => status === 'DELIVERED')) {
      // If any items are delivered, status should be PARTIALLY_DELIVERED (mixed status)
      newSaleStatus = 'PARTIALLY_DELIVERED';
    } else if (itemStatuses.every((status) => status === 'PENDING')) {
      newSaleStatus = 'NOT_APPROVED';
    } else {
      // Default fallback
      newSaleStatus = 'NOT_APPROVED';
    }

    // Update the sale status
    const finalUpdatedSale = await tx.sell.update({
      where: { id: saleId },
      data: {
        saleStatus: newSaleStatus,
        updatedById: userId,
      },
      include: {
        items: {
          include: {
            shop: true,
            product: true,
            unitOfMeasure: true,
            batches: {
              include: {
                batch: true,
              },
            },
          },
        },
        customer: true,
        branch: true,
      },
    });

    // Group delivered items by shop for better logging
    const shopDeliveries = updatedItems.reduce((acc, item) => {
      if (!acc[item.shopId]) {
        acc[item.shopId] = { items: 0, batches: 0, quantity: 0 };
      }
      acc[item.shopId].items += 1;
      acc[item.shopId].batches += item.batchCount;
      acc[item.shopId].quantity += item.totalQuantity;
      return acc;
    }, {});

    // Create log entry for delivered items
    const shopSummary = Object.entries(shopDeliveries)
      .map(
        ([shopId, stats]) => `Shop${shopId}:${stats.items}i,${stats.batches}b`,
      )
      .join('; ');

    await tx.log.create({
      data: {
        action: `Sale ${sell.invoiceNo} delivered: ${shopSummary}`,
        userId,
      },
    });

    return finalUpdatedSale;
  });
};
const deliverAllSaleItems = async (saleId, deliveryData, userId) => {
  const sell = await getSellById(saleId);

  if (!sell) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }

  // Get all items that can be delivered (PENDING status)
  const deliverableItems = sell.items.filter(
    (item) => item.itemSaleStatus === 'PENDING',
  );

  if (deliverableItems.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'No deliverable items found in this sale. All items are either already delivered, cancelled, or returned.',
    );
  }

  return completeSaleDelivery(saleId, deliveryData, userId);
};

const partialSaleDelivery = async (saleId, deliveryData, userId) => {
  return completeSaleDelivery(saleId, deliveryData, userId);
};

const updateSaleStatus = async (saleId, newStatus, userId) => {
  const sale = await getSellById(saleId);

  if (!sale) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }

  // Validate status transition
  const allowedTransitions = {
    NOT_APPROVED: ['APPROVED', 'CANCELLED'],
    APPROVED: ['DELIVERED', 'CANCELLED'],
    DELIVERED: ['RETURNED'],
    CANCELLED: [],
    RETURNED: [],
  };

  if (!allowedTransitions[sale.saleStatus]?.includes(newStatus)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot change status from ${sale.saleStatus} to ${newStatus}`,
    );
  }

  // Use prisma.sell.update() instead of prisma.sale.update()
  const updatedSale = await prisma.sell.update({
    where: { id: saleId },
    data: {
      saleStatus: newStatus,
      updatedById: userId,
    },
    include: {
      items: {
        include: {
          shop: true,
        },
      },
      customer: true,
    },
  });

  // Create log entry
  await prisma.log.create({
    data: {
      action: `Updated sale ${sale.invoiceNo} status from ${sale.saleStatus} to ${newStatus}`,
      userId,
    },
  });

  // ✅ ADD REAL-TIME NOTIFICATIONS HERE - For status changes to APPROVED or CANCELLED
  if (newStatus === 'APPROVED' || newStatus === 'CANCELLED') {
    try {
      const uniqueShopIds = updatedSale.items
        .map((item) => item.shopId)
        .filter(Boolean)
        .filter((shopId, index, array) => array.indexOf(shopId) === index);

      // Find users who have access to these shops
      const usersWithShopAccess = await prisma.user.findMany({
        where: {
          shops: {
            some: {
              id: { in: uniqueShopIds },
            },
          },
          status: 'Active', // Only active users
        },
        select: {
          id: true,
          name: true,
          email: true,
          shops: {
            where: {
              id: { in: uniqueShopIds },
            },
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Determine notification type and message based on status
      const notificationConfig = {
        APPROVED: {
          type: 'SELL_READY_FOR_DELIVERY',
          title: 'Sale Approved - Prepare for Delivery',
          message: `Sale #${updatedSale.invoiceNo} has been approved and is ready for delivery preparation`,
          realTimeTitle: 'Sale Approved',
          realTimeMessage: `Sale #${updatedSale.invoiceNo} has been approved and needs delivery preparation`,
        },
        CANCELLED: {
          type: 'SELL_CANCELLED',
          title: 'Sale Cancelled',
          message: `Sale #${updatedSale.invoiceNo} has been cancelled`,
          realTimeTitle: 'Sale Cancelled',
          realTimeMessage: `Sale #${updatedSale.invoiceNo} has been cancelled`,
        },
      };

      const config = notificationConfig[newStatus];

      // Create shop notifications (store in database)
      const shopNotifications = await Promise.allSettled(
        uniqueShopIds.map((shopId) =>
          prisma.notification.create({
            data: {
              shopId,
              title: config.title,
              message: config.message,
              type: config.type,
              relatedEntityType: 'SELL',
            },
          }),
        ),
      );

      // Get the Socket.IO instance
      const io = getIO();

      // Create notification object for real-time sending
      const realTimeNotification = {
        title: config.realTimeTitle,
        message: config.realTimeMessage,
        type: config.type,
        relatedEntityType: 'SELL',
        saleId: updatedSale.id,
        invoiceNo: updatedSale.invoiceNo,
        status: newStatus,
        timestamp: new Date().toISOString(),
      };

      // ✅ FIXED: Remove prefixes to match frontend
      // Send real-time notifications to shops

      // Send real-time notifications to users with shop access
      usersWithShopAccess.forEach((user) => {
        // Send to each user individually - remove 'user:' prefix
        io.to(user.id).emit('new-notification', realTimeNotification);
        console.log(
          `✅ Sent real-time notification to user ${user.name} (${user.id})`,
        );

        // Also send to user's shops for additional targeting
        user.shops.forEach((shop) => {
          // Remove prefixes to match what frontend will join
          io.to(`${user.id}:${shop.id}`).emit(
            'new-notification',
            realTimeNotification,
          );
        });
      });

      // Log statistics
      const successfulShopCount = shopNotifications.filter(
        (result) => result.status === 'fulfilled',
      ).length;

      console.log(
        `📢 Successfully processed ${newStatus.toLowerCase()} notifications for ${successfulShopCount} shops and ${
          usersWithShopAccess.length
        } users for sale #${updatedSale.invoiceNo}`,
      );
    } catch (notificationError) {
      console.error(
        `❌ Unexpected error in ${newStatus.toLowerCase()} notification process:`,
        notificationError,
      );
      // Don't throw error - the sale status was updated successfully
    }
  }

  return updatedSale;
};

// Update Payment Status
const updatePaymentStatus = async (saleId, newPaymentStatus, userId) => {
  const sale = await getSellById(saleId);

  if (!sale) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }

  const updatedSale = await prisma.sell.update({
    where: { id: saleId },
    data: {
      paymentStatus: newPaymentStatus,
      updatedById: userId,
    },
    include: {
      items: true,
      customer: true,
    },
  });

  // Create log entry
  await prisma.log.create({
    data: {
      action: `Updated sale ${sale.invoiceNo} payment status to ${newPaymentStatus}`,
      userId,
    },
  });

  return updatedSale;
};

// Cancel Sale (Before delivery)
const cancelSale = async (saleId, userId) => {
  const sale = await getSellById(saleId);

  if (!sale) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }

  if (sale.saleStatus === 'DELIVERED') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot cancel delivered sale. Use return instead.',
    );
  }

  const updatedSale = await prisma.sell.update({
    where: { id: saleId },
    data: {
      saleStatus: 'CANCELLED',
      updatedById: userId,
    },
    include: {
      items: {
        include: {
          shop: true,
        },
      },
      customer: true,
    },
  });

  // Create log entry
  await prisma.log.create({
    data: {
      action: `Cancelled sale ${sale.invoiceNo}`,
      userId,
    },
  });

  // ✅ ADD REAL-TIME NOTIFICATIONS HERE - Create cancellation notifications
  try {
    const uniqueShopIds = updatedSale.items
      .map((item) => item.shopId)
      .filter(Boolean)
      .filter((shopId, index, array) => array.indexOf(shopId) === index);

    // Find users who have access to these shops
    const usersWithShopAccess = await prisma.user.findMany({
      where: {
        shops: {
          some: {
            id: { in: uniqueShopIds },
          },
        },
        status: 'Active', // Only active users
      },
      select: {
        id: true,
        name: true,
        email: true,
        shops: {
          where: {
            id: { in: uniqueShopIds },
          },
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Create shop notifications (store in database)
    const shopNotifications = await Promise.allSettled(
      uniqueShopIds.map((shopId) =>
        prisma.notification.create({
          data: {
            shopId,
            title: 'Sale Cancelled',
            message: `Sale #${updatedSale.invoiceNo} has been cancelled`,
            type: 'SELL_CANCELLED',
            relatedEntityType: 'SELL',
          },
        }),
      ),
    );

    // Get the Socket.IO instance
    const io = getIO();

    // Create notification object for real-time sending
    const realTimeNotification = {
      title: 'Sale Cancelled',
      message: `Sale #${updatedSale.invoiceNo} has been cancelled`,
      type: 'SELL_CANCELLED',
      relatedEntityType: 'SELL',
      saleId: updatedSale.id,
      invoiceNo: updatedSale.invoiceNo,
      timestamp: new Date().toISOString(),
    };

    // ✅ FIXED: Remove prefixes to match frontend
    // Send real-time notifications to shops
    shopNotifications
      .filter((result, index) => result.status === 'fulfilled')
      .forEach((result, index) => {
        const shopId = uniqueShopIds[index];
        const notification = result.value;

        // Remove 'shop:' prefix to match frontend
        io.to(shopId).emit('new-notification', notification);
      });

    // Send real-time notifications to users with shop access
    usersWithShopAccess.forEach((user) => {
      // Send to each user individually - remove 'user:' prefix
      io.to(user.id).emit('new-notification', realTimeNotification);

      // Also send to user's shops for additional targeting
      user.shops.forEach((shop) => {
        // Remove prefixes to match what frontend will join
        io.to(`${user.id}:${shop.id}`).emit(
          'new-notification',
          realTimeNotification,
        );
      });
    });

    // Log statistics
    const successfulShopCount = shopNotifications.filter(
      (result) => result.status === 'fulfilled',
    ).length;

    console.log(
      `📢 Successfully processed cancellation notifications for ${successfulShopCount} shops and ${usersWithShopAccess.length} users for sale #${updatedSale.invoiceNo}`,
    );
  } catch (notificationError) {
    console.error(
      '❌ Unexpected error in cancellation notification process:',
      notificationError,
    );
    // Don't throw error - the sale was cancelled successfully
  }

  return updatedSale;
};
const getAllSellsuser = async ({
  startDate,
  endDate,
  userId,
  customerName,
  status, // This parameter should actually be called saleStatus for clarity
  page = 1,
  limit = 20,
}) => {
  // Validate required parameters
  if (!userId) {
    throw new Error('User ID is required');
  }

  // Initialize where clause with required condition
  const whereClause = {
    createdById: userId,
  };
  // Fix: Use saleStatus instead of status
  if (status) {
    // Handle multiple statuses (comma-separated) or single status
    if (status.includes(',')) {
      const statuses = status
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s);
      if (statuses.length > 0) {
        // Fix: Use saleStatus field name
        whereClause.saleStatus = { in: statuses };
      }
    } else {
      // Fix: Use saleStatus field name
      whereClause.saleStatus = status;
    }
  }

  // Handle date filtering
  try {
    if (startDate && endDate) {
      // Both dates provided
      const startOfRange = new Date(startDate);
      const endOfRange = new Date(endDate);

      if (
        Number.isNaN(startOfRange.getTime()) ||
        Number.isNaN(endOfRange.getTime())
      ) {
        throw new Error('Invalid date format');
      }

      // Set start to beginning of day, end to end of day
      startOfRange.setHours(0, 0, 0, 0);
      endOfRange.setHours(23, 59, 59, 999);

      whereClause.createdAt = {
        gte: startOfRange,
        lte: endOfRange,
      };
    } else if (startDate && !endDate) {
      // Only start date provided
      const startOfRange = new Date(startDate);
      if (Number.isNaN(startOfRange.getTime())) {
        throw new Error('Invalid start date format');
      }
      startOfRange.setHours(0, 0, 0, 0);
      whereClause.createdAt = { gte: startOfRange };
    } else if (endDate && !startDate) {
      // Only end date provided
      const endOfRange = new Date(endDate);
      if (Number.isNaN(endOfRange.getTime())) {
        throw new Error('Invalid end date format');
      }
      endOfRange.setHours(23, 59, 59, 999);
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

      whereClause.createdAt = {
        gte: twelveMonthsAgo,
        lte: endOfRange,
      };
    } else {
      // No dates provided, default to last 12 months
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 2);
      whereClause.createdAt = { gte: twelveMonthsAgo };
    }
  } catch (error) {
    throw new Error(`Invalid date: ${error.message}`);
  }

  // Calculate pagination
  const skip = (page - 1) * limit;

  // Check available saleStatus values in database
  try {
    // Fix: Use the correct field name and enum values
    const distinctSaleStatuses = await prisma.sell.findMany({
      where: {
        createdById: userId,
        createdAt: whereClause.createdAt,
      },
      distinct: ['saleStatus'], // Fix: Use 'saleStatus' instead of 'status'
      select: {
        saleStatus: true, // Fix: Select saleStatus field
      },
    });

    // Also check counts for each status
    const statusCounts = await Promise.all(
      distinctSaleStatuses.map(async (item) => {
        const count = await prisma.sell.count({
          where: {
            createdById: userId,
            saleStatus: item.saleStatus, // Fix: Use saleStatus
            createdAt: whereClause.createdAt,
          },
        });
        return { status: item.saleStatus, count };
      }),
    );

    // Check specifically for the requested status
    if (status) {
      const requestedStatusCount = await prisma.sell.count({
        where: {
          createdById: userId,
          saleStatus: status.includes(',')
            ? {
                in: status
                  .split(',')
                  .map((s) => s.trim())
                  .filter((s) => s),
              }
            : status,
          createdAt: whereClause.createdAt,
        },
      });
    }
  } catch (error) {
    console.log('   Error checking saleStatuses:', error.message);
  }

  // Execute the query with pagination
  const [sells, totalCount] = await Promise.all([
    prisma.sell.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        branch: true,
        customer: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        items: {
          include: {
            product: {
              include: {
                unitOfMeasure: true,
                category: true,
              },
            },
            shop: true,
            unitOfMeasure: true,
            batches: {
              include: {
                batch: {
                  include: {
                    product: true,
                  },
                },
              },
            },
          },
        },
        SellStockCorrection: {
          select: {
            id: true,
            status: true,
          },
        },
        _count: {
          select: { items: true },
        },
      },
    }),
    prisma.sell.count({
      where: whereClause,
    }),
  ]);

  // Apply customer name filtering in memory if needed
  let filteredSells = sells;
  if (customerName && customerName.trim()) {
    const customerNameLower = customerName.trim().toLowerCase();

    const beforeFilterCount = filteredSells.length;
    filteredSells = sells.filter(
      (sell) =>
        sell.customer &&
        sell.customer.name &&
        sell.customer.name.toLowerCase().includes(customerNameLower),
    );
  }

  return {
    sells: filteredSells,
    count: filteredSells.length,
    totalCount,
  };
};

// Get all Sells filtered by user's shops
const getAllSellsForStore = async ({
  startDate,
  endDate,
  userId,
  customerName,
  salesPersonName,
  status,
} = {}) => {
  const whereClause = { saleStatus: { not: 'NOT_APPROVED' } };
  const twelveMonthsAgo = subMonths(new Date(), 12);

  // Convert string dates to Date objects if they exist
  const startDateObj = startDate ? new Date(startDate) : undefined;
  const endDateObj = endDate ? new Date(endDate) : undefined;

  // Build the date filter
  if (startDateObj && endDateObj) {
    // Adjust for end date to include the entire day
    const adjustedEndDate = new Date(endDateObj);
    adjustedEndDate.setHours(23, 59, 59, 999);

    whereClause.saleDate = {
      gte: startDateObj,
      lte: adjustedEndDate,
    };
  } else if (startDateObj) {
    whereClause.saleDate = {
      gte: startDateObj,
      lte: new Date(),
    };
  } else if (endDateObj) {
    // Adjust for end date to include the entire day
    const adjustedEndDate = new Date(endDateObj);
    adjustedEndDate.setHours(23, 59, 59, 999);

    whereClause.saleDate = {
      gte: twelveMonthsAgo,
      lte: adjustedEndDate,
    };
  } else {
    whereClause.saleDate = {
      gte: twelveMonthsAgo,
    };
  }

  // Filter by status if provided
  if (status) {
    if (Array.isArray(status) && status.length > 0) {
      whereClause.saleStatus = {
        in: status,
      };
    } else if (typeof status === 'string') {
      whereClause.saleStatus = status;
    } else if (status === 'all') {
      delete whereClause.saleStatus;
    }
  }

  // If userId is provided, get user's shops and filter sells by those shops
  let userShopIds = [];
  if (userId) {
    const userWithShops = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        shops: {
          select: { id: true },
        },
      },
    });

    if (userWithShops && userWithShops.shops.length > 0) {
      userShopIds = userWithShops.shops.map((shop) => shop.id);

      // Check if there are any SellItems with these shop IDs
      const sellItemsCount = await prisma.sellItem.count({
        where: {
          shopId: {
            in: userShopIds,
          },
        },
      });

      // Check which sells have items with these shop IDs
      if (sellItemsCount > 0) {
        const sellsWithShopItems = await prisma.sell.findMany({
          where: {
            saleStatus: { not: 'NOT_APPROVED' },
            items: {
              some: {
                shopId: {
                  in: userShopIds,
                },
              },
            },
          },
          take: 5,
          select: {
            id: true,
            invoiceNo: true,
            saleDate: true,
            items: {
              select: {
                id: true,
                shopId: true,
              },
            },
          },
        });
      }

      whereClause.items = {
        some: {
          shopId: {
            in: userShopIds,
          },
        },
      };
    } else {
      return {
        sells: [],
        count: 0,
      };
    }
  }

  try {
    const sells = await prisma.sell.findMany({
      where: whereClause,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        branch: true,
        customer: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        items: {
          include: {
            product: {
              include: {
                unitOfMeasure: true,
                category: true,
              },
            },
            shop: true,
            unitOfMeasure: true,
            batches: {
              include: {
                batch: {
                  include: {
                    product: true,
                  },
                },
              },
            },
          },
        },
        SellStockCorrection: {
          select: {
            id: true,
            status: true, // Only including status as requested
          },
        },
        _count: {
          select: { items: true },
        },
      },
    });
    // If we're using case-insensitive filtering in memory
    let filteredSells = sells;

    // Apply case-insensitive filtering in memory if needed
    if (customerName && customerName.trim()) {
      const customerNameLower = customerName.trim().toLowerCase();
      filteredSells = filteredSells.filter(
        (sell) =>
          sell.customer &&
          sell.customer.name.toLowerCase().includes(customerNameLower),
      );
    }

    if (salesPersonName && salesPersonName.trim()) {
      const salesPersonNameLower = salesPersonName.trim().toLowerCase();
      filteredSells = filteredSells.filter(
        (sell) =>
          sell.createdBy &&
          sell.createdBy.name.toLowerCase().includes(salesPersonNameLower),
      );
    }

    return {
      sells: filteredSells,
      count: filteredSells.length,
    };
  } catch (error) {
    console.error('Error fetching sells:', error);
    throw error;
  }
};

const unlockSell = async (id) => {
  const currentSell = await prisma.sell.findUnique({
    where: { id },
  });

  if (!currentSell) {
    throw new Error(`Sell with id ${id} not found`);
  }

  const newLockedState = !currentSell.locked;

  // Always set lockedAt to current time when changing state
  const sell = await prisma.sell.update({
    where: { id },
    data: {
      locked: newLockedState,
      lockedAt: new Date(), // Always set to current time
    },
  });

  return sell;
};
module.exports = {
  unlockSell,
  getSellById,
  getSellByInvoiceNo,
  getAllSells,
  createSell,
  updateSell,
  deleteSell,
  deliverAllSaleItems,
  completeSaleDelivery,
  updateSaleStatus,
  updatePaymentStatus,
  cancelSale,
  partialSaleDelivery,
  getAllSellsuser,
  getAllSellsForStore,
  getSellByIdByuser,
};
