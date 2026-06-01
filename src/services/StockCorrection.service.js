const httpStatus = require('http-status');
const { subMonths } = require('date-fns');

const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Get StockCorrection by ID
const getStockCorrectionById = async (id) => {
  const stockCorrection = await prisma.stockCorrection.findUnique({
    where: { id },
    include: {
      store: true,
      shop: true,
      purchase: true,
      transfer: true,
      createdBy: true,
      updatedBy: true,
      items: {
        include: {
          product: true,
          unitOfMeasure: true,
        },
      },
    },
  });
  return stockCorrection;
};

const getStockCorrectionsByPurchaseId = async (purchaseId) => {
  const stockCorrections = await prisma.stockCorrection.findMany({
    where: {
      purchaseId,
    },
    include: {
      store: true,
      shop: true,
      purchase: true,
      transfer: true,
      createdBy: true,
      updatedBy: true,
      items: {
        include: {
          product: true,
          unitOfMeasure: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc', // Optional: order by creation date, newest first
    },
  });
  return stockCorrections;
};
// Get StockCorrection by reference
const getStockCorrectionByReference = async (reference) => {
  const stockCorrection = await prisma.stockCorrection.findFirst({
    where: { reference },
  });
  return stockCorrection;
};

// Get all StockCorrections
const getAllStockCorrections = async ({ startDate, endDate } = {}) => {
  const whereClause = {};
  const threeMonthsAgo = subMonths(new Date(), 12); // Default time range

  // Convert string dates to Date objects if they exist
  const startDateObj = startDate ? new Date(startDate) : undefined;
  const endDateObj = endDate ? new Date(endDate) : undefined;

  // Build the date filter
  if (startDateObj && endDateObj) {
    whereClause.createdAt = {
      gte: startDateObj,
      lte: endDateObj,
    };
  } else if (startDateObj) {
    whereClause.createdAt = {
      gte: startDateObj,
      lte: new Date(),
    };
  } else if (endDateObj) {
    whereClause.createdAt = {
      gte: threeMonthsAgo,
      lte: endDateObj,
    };
  } else {
    whereClause.createdAt = {
      gte: threeMonthsAgo,
    };
  }

  const stockCorrections = await prisma.stockCorrection.findMany({
    where: whereClause,
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      store: true,
      shop: true,
      _count: {
        select: { items: true },
      },
    },
  });

  return {
    stockCorrections,
    count: stockCorrections.length,
  };
};
const generateShortCode = async () => {
  const count = await prisma.stockCorrection.count();
  return `SC-${String(count + 1).padStart(6, '0')}`;
};
// Create StockCorrection
const createStockCorrection = async (stockCorrectionBody, userId) => {
  // Check if reference already exists
  const shortCode = await generateShortCode();

  // Parse items if it's a string
  const { items: itemsString, ...restStockCorrectionBody } =
    stockCorrectionBody;
  const items =
    typeof itemsString === 'string' ? JSON.parse(itemsString) : itemsString;

  // Validate items
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Stock correction must have at least one item',
    );
  }

  // Validate individual item properties
  items.forEach((item, index) => {
    if (!item.productId || !item.unitOfMeasureId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${
          index + 1
        } is missing required fields (productId or unitOfMeasureId)`,
      );
    }
    if (
      item.quantity === undefined ||
      item.quantity === null ||
      Number.isNaN(item.quantity)
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid quantity`,
      );
    }
    if (item.quantity === 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} quantity cannot be zero`,
      );
    }

    // Validate dimensions - both must be provided together or neither
    const hasHeight = item.height !== undefined && item.height !== null;
    const hasWidth = item.width !== undefined && item.width !== null;

    if (hasHeight !== hasWidth) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${
          index + 1
        }: Both height and width must be provided together for dimension-based items`,
      );
    }

    // If dimensions are provided, validate they are positive
    if (hasHeight && hasWidth) {
      if (item.height <= 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${
            index + 1
          } has invalid height. Height must be greater than 0.`,
        );
      }
      if (item.width <= 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${index + 1} has invalid width. Width must be greater than 0.`,
        );
      }
    }
  });

  // Clean up empty string values
  const cleanedStockCorrectionBody = {
    ...restStockCorrectionBody,
    storeId:
      restStockCorrectionBody.storeId === ''
        ? null
        : restStockCorrectionBody.storeId,
    shopId:
      restStockCorrectionBody.shopId === ''
        ? null
        : restStockCorrectionBody.shopId,
    purchaseId:
      restStockCorrectionBody.purchaseId === ''
        ? null
        : restStockCorrectionBody.purchaseId,
    transferId:
      restStockCorrectionBody.transferId === ''
        ? null
        : restStockCorrectionBody.transferId,
  };

  // Validate location
  if (
    !cleanedStockCorrectionBody.storeId &&
    !cleanedStockCorrectionBody.shopId
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Either store or shop must be specified',
    );
  }

  // Create the stock correction
  const stockCorrection = await prisma.stockCorrection.create({
    data: {
      ...cleanedStockCorrectionBody,
      shortCode, // Add this field
      createdById: userId,
      updatedById: userId,
      items: {
        create: items.map((item) => ({
          productId: item.productId,
          unitOfMeasureId: item.unitOfMeasureId,
          quantity: item.quantity,
          // Add height and width if they exist
          ...(item.height !== undefined && { height: item.height }),
          ...(item.width !== undefined && { width: item.width }),
        })),
      },
    },
    include: {
      items: {
        include: {
          unitOfMeasure: true,
          product: {
            include: {
              colour: true,
              category: true,
            },
          },
        },
      },
    },
  });

  return stockCorrection;
};

// Update StockCorrection
const updateStockCorrection = async (
  stockCorrectionId,
  stockCorrectionBody,
  userId,
) => {
  // Check if stock correction exists
  const existingStockCorrection = await getStockCorrectionById(
    stockCorrectionId,
  );
  if (!existingStockCorrection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Stock correction not found');
  }

  // Cannot update approved or rejected stock corrections
  if (existingStockCorrection.status !== 'PENDING') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot update ${existingStockCorrection.status.toLowerCase()} stock correction`,
    );
  }

  // Check if reference already exists (excluding current stock correction)
  if (
    stockCorrectionBody.reference &&
    stockCorrectionBody.reference !== existingStockCorrection.reference
  ) {
    if (await getStockCorrectionByReference(stockCorrectionBody.reference)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Stock correction reference already taken',
      );
    }
  }

  // Parse items if it's a string
  const { items: itemsString, ...restStockCorrectionBody } =
    stockCorrectionBody;
  const items =
    typeof itemsString === 'string' ? JSON.parse(itemsString) : itemsString;

  // Validate items
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Stock correction must have at least one item',
    );
  }

  // Validate individual item properties
  items.forEach((item, index) => {
    if (!item.productId || !item.unitOfMeasureId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${
          index + 1
        } is missing required fields (productId or unitOfMeasureId)`,
      );
    }

    // Validate quantity if provided
    if (item.quantity !== undefined) {
      if (item.quantity === 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${index + 1} quantity cannot be zero`,
        );
      }
    }

    // Validate dimensions - both must be provided together or neither
    const hasHeight = item.height !== undefined && item.height !== null;
    const hasWidth = item.width !== undefined && item.width !== null;

    if (hasHeight !== hasWidth) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${
          index + 1
        }: Both height and width must be provided together for dimension-based items`,
      );
    }

    // If dimensions are provided, validate they are positive
    if (hasHeight && hasWidth) {
      if (item.height <= 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${
            index + 1
          } has invalid height. Height must be greater than 0.`,
        );
      }
      if (item.width <= 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${index + 1} has invalid width. Width must be greater than 0.`,
        );
      }
    }
  });

  // Clean up empty string values
  const cleanedStockCorrectionBody = {
    ...restStockCorrectionBody,
    storeId:
      restStockCorrectionBody.storeId === ''
        ? null
        : restStockCorrectionBody.storeId,
    shopId:
      restStockCorrectionBody.shopId === ''
        ? null
        : restStockCorrectionBody.shopId,
    purchaseId:
      restStockCorrectionBody.purchaseId === ''
        ? null
        : restStockCorrectionBody.purchaseId,
    transferId:
      restStockCorrectionBody.transferId === ''
        ? null
        : restStockCorrectionBody.transferId,
  };

  // Validate location
  if (
    !cleanedStockCorrectionBody.storeId &&
    !cleanedStockCorrectionBody.shopId
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Either store or shop must be specified',
    );
  }

  // Update the stock correction inside a transaction
  const result = await prisma.$transaction(async (tx) => {
    // Delete all existing items
    await tx.stockCorrectionItem.deleteMany({
      where: { correctionId: stockCorrectionId },
    });

    // Update stock correction with cleaned body and new items
    const stockCorrection = await tx.stockCorrection.update({
      where: { id: stockCorrectionId },
      data: {
        ...cleanedStockCorrectionBody,
        updatedById: userId,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            unitOfMeasureId: item.unitOfMeasureId,
            quantity: item.quantity,
            // Add height and width if they exist
            ...(item.height !== undefined && { height: item.height }),
            ...(item.width !== undefined && { width: item.width }),
          })),
        },
      },
      include: {
        items: {
          include: {
            unitOfMeasure: true,
            product: {
              include: {
                colour: true,
                category: true,
              },
            },
          },
        },
      },
    });

    return stockCorrection;
  });

  return result;
};

// Delete StockCorrection
const deleteStockCorrection = async (id, userId) => {
  const existingStockCorrection = await getStockCorrectionById(id);
  if (!existingStockCorrection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Stock correction not found');
  }

  const result = await prisma.$transaction(async (tx) => {
    // Check if stock correction is approved (has stock ledger entries)
    const ledgerEntries = await tx.stockLedger.findMany({
      where: {
        invoiceNo: existingStockCorrection.shortCode,
      },
    });

    const isApproved = ledgerEntries.length > 0;

    if (isApproved) {
      // Reverse all stock operations for approved stock correction
      await Promise.all(
        existingStockCorrection.items.map(async (item) => {
          const operations = [];
          const originalQuantity = item.quantity;
          const isAddition = originalQuantity > 0;
          const absoluteQuantity = Math.abs(originalQuantity);

          // Reverse the stock adjustment (opposite operation)
          if (existingStockCorrection.storeId) {
            const existingStoreStock = await tx.storeStock.findUnique({
              where: {
                storeId_productId: {
                  storeId: existingStockCorrection.storeId,
                  productId: item.productId,
                },
              },
            });

            if (existingStoreStock) {
              const newQuantity = isAddition
                ? existingStoreStock.quantity - absoluteQuantity // Was addition, now subtract
                : existingStoreStock.quantity + absoluteQuantity; // Was subtraction, now add

              if (newQuantity <= 0) {
                // Delete if quantity becomes 0 or negative
                operations.push(
                  tx.storeStock.delete({
                    where: {
                      storeId_productId: {
                        storeId: existingStockCorrection.storeId,
                        productId: item.productId,
                      },
                    },
                  }),
                );
              } else {
                // Update quantity with reverse operation
                operations.push(
                  tx.storeStock.update({
                    where: {
                      storeId_productId: {
                        storeId: existingStockCorrection.storeId,
                        productId: item.productId,
                      },
                    },
                    data: {
                      quantity: isAddition
                        ? { decrement: absoluteQuantity }
                        : { increment: absoluteQuantity },
                    },
                  }),
                );
              }
            }
          } else if (existingStockCorrection.shopId) {
            const existingShopStock = await tx.shopStock.findUnique({
              where: {
                shopId_productId: {
                  shopId: existingStockCorrection.shopId,
                  productId: item.productId,
                },
              },
            });

            if (existingShopStock) {
              const newQuantity = isAddition
                ? existingShopStock.quantity - absoluteQuantity // Was addition, now subtract
                : existingShopStock.quantity + absoluteQuantity; // Was subtraction, now add

              if (newQuantity <= 0) {
                // Delete if quantity becomes 0 or negative
                operations.push(
                  tx.shopStock.delete({
                    where: {
                      shopId_productId: {
                        shopId: existingStockCorrection.shopId,
                        productId: item.productId,
                      },
                    },
                  }),
                );
              } else {
                // Update quantity with reverse operation
                operations.push(
                  tx.shopStock.update({
                    where: {
                      shopId_productId: {
                        shopId: existingStockCorrection.shopId,
                        productId: item.productId,
                      },
                    },
                    data: {
                      quantity: isAddition
                        ? { decrement: absoluteQuantity }
                        : { increment: absoluteQuantity },
                    },
                  }),
                );
              }
            }
          }

          // Create reversal stock ledger entry (opposite movement type)
          const reversalMovementType = isAddition ? 'OUT' : 'IN';
          const reversalNotes = `Stock correction reversal: ${existingStockCorrection.reason.toLowerCase()}`;

          if (existingStockCorrection.storeId) {
            operations.push(
              tx.stockLedger.create({
                data: {
                  productId: item.productId,
                  storeId: existingStockCorrection.storeId,
                  invoiceNo: `REV-${existingStockCorrection.shortCode}`,
                  movementType: reversalMovementType,
                  quantity: absoluteQuantity,
                  unitOfMeasureId: item.unitOfMeasureId,
                  reference: `STOCK-CORRECTION-REVERSAL-${existingStockCorrection.reason}`,
                  userId,
                  notes: reversalNotes,
                  movementDate: new Date(),
                },
              }),
            );
          } else if (existingStockCorrection.shopId) {
            operations.push(
              tx.stockLedger.create({
                data: {
                  productId: item.productId,
                  invoiceNo: `REV-${existingStockCorrection.shortCode}`,
                  shopId: existingStockCorrection.shopId,
                  movementType: reversalMovementType,
                  quantity: absoluteQuantity,
                  unitOfMeasureId: item.unitOfMeasureId,
                  reference: `SHOP-CORRECTION-REVERSAL-${existingStockCorrection.reason}`,
                  userId,
                  notes: reversalNotes,
                  movementDate: new Date(),
                },
              }),
            );
          }

          // Execute all operations for this item
          if (operations.length > 0) {
            await Promise.all(operations);
          }
        }),
      );

      // Delete the original stock ledger entries
      await tx.stockLedger.deleteMany({
        where: {
          invoiceNo: existingStockCorrection.shortCode,
        },
      });
    }

    // Delete all stock correction items
    await tx.stockCorrectionItem.deleteMany({
      where: { correctionId: id },
    });

    // Delete the stock correction
    await tx.stockCorrection.delete({
      where: { id },
    });

    // Create log entry
    await tx.log.create({
      data: {
        action: `Deleted stock correction ${existingStockCorrection.shortCode}${
          isApproved ? ' and reversed stock transactions' : ''
        }`,
        userId,
      },
    });

    return {
      message: `Stock correction deleted successfully${
        isApproved ? ' and stock transactions reversed' : ''
      }`,
      stockReversed: isApproved,
    };
  });

  return result;
};

// Approve StockCorrection

const approveStockCorrection = async (stockCorrectionId, userId) => {
  try {
    const stockCorrection = await getStockCorrectionById(stockCorrectionId);

    if (!stockCorrection) {
      console.error('Stock correction not found');
      throw new ApiError(httpStatus.NOT_FOUND, 'Stock correction not found');
    }

    if (stockCorrection.status !== 'PENDING') {
      console.error(
        'Stock correction already processed:',
        stockCorrection.status,
      );
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Stock correction is already ${stockCorrection.status.toLowerCase()}`,
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      try {
        // Get all unit of measures for the stock correction items
        const unitOfMeasureIds = stockCorrection.items.map(
          (item) => item.unitOfMeasureId,
        );

        const unitOfMeasures = await tx.unitOfMeasure.findMany({
          where: { id: { in: unitOfMeasureIds } },
        });

        const unitOfMeasureMap = unitOfMeasures.reduce((acc, uom) => {
          acc[uom.id] = uom;
          return acc;
        }, {});
        // Check for negative stock BEFORE processing
        const insufficientStockItems = [];

        // For each item, check if there's enough stock for subtractions
        await Promise.all(
          stockCorrection.items.map(async (item) => {
            try {
              const quantityToUse = item.quantity;
              const hasDimensions =
                item.height && item.width && item.height > 0 && item.width > 0;

              // Only need to check for negative quantities (subtractions)
              if (quantityToUse < 0) {
                const absoluteQuantity = Math.abs(quantityToUse);
                if (stockCorrection.storeId) {
                  const storeStock = await tx.storeStock.findUnique({
                    where: {
                      storeId_productId: {
                        storeId: stockCorrection.storeId,
                        productId: item.productId,
                      },
                    },
                    include: {
                      variants: true,
                    },
                  });

                  if (hasDimensions) {
                    // Check variant-specific stock
                    const variant = storeStock?.variants?.find(
                      (v) =>
                        Math.abs(v.height - (item.height || 0)) < 0.01 &&
                        Math.abs(v.width - (item.width || 0)) < 0.01,
                    );

                    const currentStock = variant?.quantity || 0;

                    if (currentStock < absoluteQuantity) {
                      insufficientStockItems.push({
                        productId: item.productId,
                        dimensions: `${item.height}x${item.width}`,
                        required: absoluteQuantity,
                        available: currentStock,
                        location: 'store',
                        locationId: stockCorrection.storeId,
                      });
                    }
                  } else {
                    const currentStock = storeStock?.quantity || 0;

                    if (currentStock < absoluteQuantity) {
                      insufficientStockItems.push({
                        productId: item.productId,
                        required: absoluteQuantity,
                        available: currentStock,
                        location: 'store',
                        locationId: stockCorrection.storeId,
                      });
                    }
                  }
                } else if (stockCorrection.shopId) {
                  const shopStock = await tx.shopStock.findUnique({
                    where: {
                      shopId_productId: {
                        shopId: stockCorrection.shopId,
                        productId: item.productId,
                      },
                    },
                    include: {
                      variants: true,
                    },
                  });

                  if (hasDimensions) {
                    // Check variant-specific stock
                    const variant = shopStock?.variants?.find(
                      (v) =>
                        Math.abs(v.height - (item.height || 0)) < 0.01 &&
                        Math.abs(v.width - (item.width || 0)) < 0.01,
                    );

                    const currentStock = variant?.quantity || 0;

                    if (currentStock < absoluteQuantity) {
                      insufficientStockItems.push({
                        productId: item.productId,
                        dimensions: `${item.height}x${item.width}`,
                        required: absoluteQuantity,
                        available: currentStock,
                        location: 'shop',
                        locationId: stockCorrection.shopId,
                      });
                    }
                  } else {
                    const currentStock = shopStock?.quantity || 0;

                    if (currentStock < absoluteQuantity) {
                      insufficientStockItems.push({
                        productId: item.productId,
                        required: absoluteQuantity,
                        available: currentStock,
                        location: 'shop',
                        locationId: stockCorrection.shopId,
                      });
                    }
                  }
                }
              } else {
                console.log('Item is addition or zero, no stock check needed');
              }
            } catch (itemError) {
              throw itemError;
            }
          }),
        );

        // If there are insufficient stock items, throw an error
        if (insufficientStockItems.length > 0) {
          const errorDetails = insufficientStockItems
            .map(
              (item) =>
                `Product ${item.productId}${
                  item.dimensions ? ` (${item.dimensions})` : ''
                }: Required ${item.required}, Available ${item.available}`,
            )
            .join('; ');

          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Insufficient stock for subtraction: ${errorDetails}`,
          );
        }

        // Prepare all operations for each stock correction item
        const operations = await Promise.all(
          stockCorrection.items.map(async (item, index) => {
            try {
              const unitOfMeasure = unitOfMeasureMap[item.unitOfMeasureId];

              if (!unitOfMeasure) {
                throw new ApiError(
                  httpStatus.BAD_REQUEST,
                  `Unit of measure not found for item ${item.id}`,
                );
              }

              const quantityToUse = item.quantity;
              const isAddition = quantityToUse > 0;
              const movementType = isAddition ? 'IN' : 'OUT';
              const absoluteQuantity = Math.abs(quantityToUse);
              const hasDimensions =
                item.height && item.width && item.height > 0 && item.width > 0;
              const notes = hasDimensions
                ? `Stock correction: ${
                    isAddition ? 'Added' : 'Removed'
                  } ${absoluteQuantity} (${item.height}x${item.width}) - ${
                    stockCorrection.reason
                  }`
                : `Stock correction: ${
                    isAddition ? 'Added' : 'Removed'
                  } ${absoluteQuantity} - ${stockCorrection.reason}`;

              const itemOperations = [];

              // Update stock based on location (store or shop)
              if (stockCorrection.storeId) {
                if (hasDimensions) {
                  // Handle dimension-based store stock
                  const storeStock = await tx.storeStock.findUnique({
                    where: {
                      storeId_productId: {
                        storeId: stockCorrection.storeId,
                        productId: item.productId,
                      },
                    },
                  });

                  if (!storeStock && !isAddition) {
                    throw new ApiError(
                      httpStatus.BAD_REQUEST,
                      `Store stock not found for product ${item.productId}`,
                    );
                  }

                  if (storeStock) {
                    // Find or create the variant
                    const existingVariant =
                      await tx.storeProductVariant.findUnique({
                        where: {
                          storeStockId_height_width: {
                            storeStockId: storeStock.id,
                            height: item.height,
                            width: item.width,
                          },
                        },
                      });

                    if (existingVariant) {
                      // Update existing variant
                      itemOperations.push(
                        tx.storeProductVariant.update({
                          where: { id: existingVariant.id },
                          data: {
                            quantity: isAddition
                              ? { increment: absoluteQuantity }
                              : { decrement: absoluteQuantity },
                          },
                        }),
                      );
                    } else {
                      // Create new variant (only for additions)
                      if (!isAddition) {
                        throw new ApiError(
                          httpStatus.BAD_REQUEST,
                          `Cannot remove stock from non-existent variant ${item.height}x${item.width}`,
                        );
                      }
                      itemOperations.push(
                        tx.storeProductVariant.create({
                          data: {
                            storeStockId: storeStock.id,
                            height: item.height,
                            width: item.width,
                            quantity: absoluteQuantity,
                          },
                        }),
                      );
                    }

                    // Update total store stock quantity
                    const allVariants = await tx.storeProductVariant.findMany({
                      where: { storeStockId: storeStock.id },
                    });

                    const totalQuantity = allVariants.reduce(
                      (sum, v) => sum + v.quantity,
                      0,
                    );

                    itemOperations.push(
                      tx.storeStock.update({
                        where: { id: storeStock.id },
                        data: { quantity: totalQuantity },
                      }),
                    );
                  }
                } else {
                  // Handle quantity-based store stock
                  itemOperations.push(
                    tx.storeStock.upsert({
                      where: {
                        storeId_productId: {
                          storeId: stockCorrection.storeId,
                          productId: item.productId,
                        },
                      },
                      update: {
                        quantity: isAddition
                          ? { increment: absoluteQuantity }
                          : { decrement: absoluteQuantity },
                      },
                      create: {
                        storeId: stockCorrection.storeId,
                        productId: item.productId,
                        quantity: isAddition ? absoluteQuantity : 0,
                        unitOfMeasureId: item.unitOfMeasureId,
                        status: 'Available',
                      },
                    }),
                  );
                }

                // Create stock ledger entry for store
                itemOperations.push(
                  tx.stockLedger.create({
                    data: {
                      productId: item.productId,
                      storeId: stockCorrection.storeId,
                      invoiceNo: stockCorrection.shortCode,
                      movementType: 'ADJUSTMENT',
                      quantity: absoluteQuantity,
                      ...(hasDimensions && {
                        height: item.height,
                        width: item.width,
                      }),
                      unitOfMeasureId: item.unitOfMeasureId,
                      reference:
                        stockCorrection.reference || stockCorrection.shortCode,
                      userId,
                      notes,
                      movementDate: new Date(),
                    },
                  }),
                );
              } else if (stockCorrection.shopId) {
                if (hasDimensions) {
                  // Handle dimension-based shop stock
                  const shopStock = await tx.shopStock.findUnique({
                    where: {
                      shopId_productId: {
                        shopId: stockCorrection.shopId,
                        productId: item.productId,
                      },
                    },
                  });

                  if (!shopStock && !isAddition) {
                    throw new ApiError(
                      httpStatus.BAD_REQUEST,
                      `Shop stock not found for product ${item.productId}`,
                    );
                  }

                  if (shopStock) {
                    // Find or create the variant
                    const existingVariant =
                      await tx.shopProductVariant.findUnique({
                        where: {
                          shopStockId_height_width: {
                            shopStockId: shopStock.id,
                            height: item.height,
                            width: item.width,
                          },
                        },
                      });

                    if (existingVariant) {
                      // Update existing variant
                      itemOperations.push(
                        tx.shopProductVariant.update({
                          where: { id: existingVariant.id },
                          data: {
                            quantity: isAddition
                              ? { increment: absoluteQuantity }
                              : { decrement: absoluteQuantity },
                          },
                        }),
                      );
                    } else {
                      // Create new variant (only for additions)
                      if (!isAddition) {
                        throw new ApiError(
                          httpStatus.BAD_REQUEST,
                          `Cannot remove stock from non-existent variant ${item.height}x${item.width}`,
                        );
                      }
                      itemOperations.push(
                        tx.shopProductVariant.create({
                          data: {
                            shopStockId: shopStock.id,
                            height: item.height,
                            width: item.width,
                            quantity: absoluteQuantity,
                          },
                        }),
                      );
                    }

                    // Update total shop stock quantity
                    const allVariants = await tx.shopProductVariant.findMany({
                      where: { shopStockId: shopStock.id },
                    });

                    const totalQuantity = allVariants.reduce(
                      (sum, v) => sum + v.quantity,
                      0,
                    );

                    itemOperations.push(
                      tx.shopStock.update({
                        where: { id: shopStock.id },
                        data: { quantity: totalQuantity },
                      }),
                    );
                  }
                } else {
                  // Handle quantity-based shop stock
                  itemOperations.push(
                    tx.shopStock.upsert({
                      where: {
                        shopId_productId: {
                          shopId: stockCorrection.shopId,
                          productId: item.productId,
                        },
                      },
                      update: {
                        quantity: isAddition
                          ? { increment: absoluteQuantity }
                          : { decrement: absoluteQuantity },
                      },
                      create: {
                        shopId: stockCorrection.shopId,
                        productId: item.productId,
                        quantity: isAddition ? absoluteQuantity : 0,
                        unitOfMeasureId: item.unitOfMeasureId,
                        status: 'Available',
                      },
                    }),
                  );
                }

                // Create stock ledger entry for shop
                itemOperations.push(
                  tx.stockLedger.create({
                    data: {
                      productId: item.productId,
                      invoiceNo: stockCorrection.shortCode,
                      shopId: stockCorrection.shopId,
                      movementType: 'ADJUSTMENT',
                      quantity: absoluteQuantity,
                      ...(hasDimensions && {
                        height: item.height,
                        width: item.width,
                      }),
                      unitOfMeasureId: item.unitOfMeasureId,
                      reference:
                        stockCorrection.reference || stockCorrection.shortCode,
                      userId,
                      notes,
                      movementDate: new Date(),
                    },
                  }),
                );
              }

              return itemOperations;
            } catch (itemOpError) {
              console.error(
                `Error preparing operations for item ${index + 1}:`,
                {
                  itemId: item.id,
                  productId: item.productId,
                  error: itemOpError.message,
                  stack: itemOpError.stack,
                },
              );
              throw itemOpError;
            }
          }),
        );

        // Flatten all operations and execute them in parallel
        const allOperations = operations.flat();

        try {
          const operationResults = await Promise.all(allOperations);
          console.log(
            'All operations completed successfully:',
            operationResults.length,
          );
        } catch (error) {
          console.error('Error executing operations:', {
            error: error.message,
            stack: error.stack,
            code: error.code,
            meta: error.meta,
          });
          throw error;
        }

        // Update stock correction status to APPROVED
        const updatedStockCorrection = await tx.stockCorrection.update({
          where: { id: stockCorrectionId },
          data: {
            status: 'APPROVED',
            approvedBy: {
              connect: { id: userId },
            },
            updatedBy: {
              connect: { id: userId },
            },
          },
        });

        // Create log entry
        await tx.log.create({
          data: {
            action: `Approved stock correction ${
              stockCorrection.reference || stockCorrection.shortCode
            } with ${stockCorrection.items.length} items`,
            userId,
          },
        });

        return updatedStockCorrection;
      } catch (transactionError) {
        console.error('Transaction error:', {
          error: transactionError.message,
          stack: transactionError.stack,
          code: transactionError.code,
          meta: transactionError.meta,
        });
        throw transactionError;
      }
    });

    return result;
  } catch (error) {
    console.error('FATAL ERROR in approveStockCorrection:', {
      error: error.message,
      stack: error.stack,
      stockCorrectionId,
      userId,
      httpStatus: error.statusCode || error.status || 'unknown',
      code: error.code,
      meta: error.meta,
    });

    // Re-throw the error to be handled by the calling function
    throw error;
  }
};

// Reject StockCorrection
const rejectStockCorrection = async (stockCorrectionId, userId) => {
  const stockCorrection = await getStockCorrectionById(stockCorrectionId);

  if (!stockCorrection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Stock correction not found');
  }

  if (stockCorrection.status !== 'PENDING') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot reject ${stockCorrection.status.toLowerCase()} stock correction`,
    );
  }

  const updatedStockCorrection = await prisma.stockCorrection.update({
    where: { id: stockCorrectionId },
    data: {
      status: 'REJECTED',
      updatedById: userId,
    },
  });

  // Create log entry
  await prisma.log.create({
    data: {
      action: `Rejected stock correction ${
        stockCorrection.reference || stockCorrection.id
      }`,
      userId,
    },
  });

  return updatedStockCorrection;
};

module.exports = {
  getStockCorrectionById,
  getStockCorrectionByReference,
  getAllStockCorrections,
  createStockCorrection,
  updateStockCorrection,
  deleteStockCorrection,
  approveStockCorrection,
  rejectStockCorrection,
  getStockCorrectionsByPurchaseId,
};
