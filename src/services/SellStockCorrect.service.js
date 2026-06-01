/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
const httpStatus = require('http-status');
const { subMonths } = require('date-fns');

const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Get SellStockCorrection by ID
const getSellStockCorrectionById = async (id) => {
  const sellStockCorrection = await prisma.sellStockCorrection.findUnique({
    where: { id },
    include: {
      sell: true,
      createdBy: true,
      updatedBy: true,
      items: {
        include: {
          product: true,
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
  return sellStockCorrection;
};
const getSellStockCorrectionfilterId = async (sellId, userId) => {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    if (!sellId) {
      throw new Error('Sell ID is required');
    }

    // First, get the user with their assigned shops
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        shops: {
          select: { id: true },
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Get user's shop IDs for permission check
    const userShopIds = user.shops.map((shop) => shop.id);

    // Get ALL sell stock corrections for this sell ID
    const sellStockCorrections = await prisma.sellStockCorrection.findMany({
      where: { sellId },
      include: {
        sell: true,
        createdBy: true,
        updatedBy: true,
        items: {
          include: {
            product: true,
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

    if (!sellStockCorrections || sellStockCorrections.length === 0) {
      return [];
    }

    // If user is admin, return all corrections without filtering
    if (user.admin) {
      return sellStockCorrections;
    }

    // Filter items within each correction based on user's shop permissions
    const filteredCorrections = sellStockCorrections.map((correction) => {
      const filteredItems = correction.items.filter((item) => {
        // If item has no shop, include it
        if (!item.shopId) {
          return true;
        }

        // Check if user has permission for this shop
        return userShopIds.includes(item.shopId);
      });

      return {
        ...correction,
        items: filteredItems,
      };
    });

    return filteredCorrections;
  } catch (error) {
    throw new Error(`Failed to get sell stock corrections: ${error.message}`);
  }
};

// Get SellStockCorrection by reference
const getSellStockCorrectionByReference = async (reference) => {
  const sellStockCorrection = await prisma.sellStockCorrection.findFirst({
    where: { reference },
  });
  return sellStockCorrection;
};

// Get all SellStockCorrections
const getAllSellStockCorrections = async ({ startDate, endDate } = {}) => {
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

  const sellStockCorrections = await prisma.sellStockCorrection.findMany({
    where: whereClause,
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      sell: true,
      _count: {
        select: { items: true },
      },
    },
  });

  return {
    sellStockCorrections,
    count: sellStockCorrections.length,
  };
};

// Get SellStockCorrections by Sell ID
const getSellStockCorrectionsBySellId = async (sellId) => {
  const sellStockCorrections = await prisma.sellStockCorrection.findMany({
    where: {
      sellId,
    },
    include: {
      sell: true,
      createdBy: true,
      updatedBy: true,
      items: {
        include: {
          product: true,
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
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
  return sellStockCorrections;
};

const createSellStockCorrection = async (sellStockCorrectionBody, userId) => {
  const { items: itemsString, ...restSellStockCorrectionBody } =
    sellStockCorrectionBody;
  const items =
    typeof itemsString === 'string' ? JSON.parse(itemsString) : itemsString;

  // Validate items array exists
  if (!items || !Array.isArray(items)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Sell stock correction must have items array',
    );
  }

  // Filter out items with zero quantity
  const nonZeroItems = items.filter((item) => Number(item.quantity) !== 0);

  // Check if there are any items left after filtering
  if (nonZeroItems.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Sell stock correction must have at least one item with non-zero quantity',
    );
  }

  // Validate individual item properties and calculate totals
  let totalCorrectionAmount = 0;
  const itemsWithCalculations = nonZeroItems.map((item, index) => {
    if (!item.productId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} is missing required field (productId)`,
      );
    }
    if (!item.unitOfMeasureId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} is missing required field (unitOfMeasureId)`,
      );
    }
    if (
      item.quantity === undefined ||
      item.quantity === null ||
      Number.isNaN(Number(item.quantity))
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid quantity`,
      );
    }
    // Removed zero quantity validation since we filtered them out

    if (!item.unitPrice || item.unitPrice < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} must have a valid unit price`,
      );
    }

    // Validate batches if provided
    if (item.batches && Array.isArray(item.batches)) {
      const batchQuantitySum = item.batches.reduce(
        (sum, batch) => sum + (batch.quantity || 0),
        0,
      );
      // Use the actual quantity (could be negative) for comparison
      if (batchQuantitySum !== item.quantity) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${
            index + 1
          } batch quantities (${batchQuantitySum}) must match item quantity (${
            item.quantity
          })`,
        );
      }
    }

    // Calculate total price for the item
    const totalPrice = item.unitPrice * Math.abs(item.quantity);
    // For negative quantities, subtract from total
    totalCorrectionAmount += item.quantity >= 0 ? totalPrice : -totalPrice;

    return {
      ...item,
      totalPrice,
    };
  });

  // Clean up empty string values
  const cleanedSellStockCorrectionBody = {
    ...restSellStockCorrectionBody,
    sellId:
      restSellStockCorrectionBody.sellId === ''
        ? null
        : restSellStockCorrectionBody.sellId,
  };

  // Create the sell stock correction
  const sellStockCorrection = await prisma.sellStockCorrection.create({
    data: {
      ...cleanedSellStockCorrectionBody,
      total: totalCorrectionAmount,
      createdById: userId,
      updatedById: userId,
      items: {
        create: itemsWithCalculations.map((item) => ({
          productId: item.productId,
          shopId: item.shopId || null,
          unitOfMeasureId: item.unitOfMeasureId,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          quantity: item.quantity, // Keep the original negative/positive value
          batches:
            item.batches && item.batches.length > 0
              ? {
                  create: item.batches.map((batch) => ({
                    batchId: batch.batchId,
                    quantity: batch.quantity,
                  })),
                }
              : undefined,
        })),
      },
    },
    include: {
      items: {
        include: {
          product: true,
          unitOfMeasure: true,
          shop: true,
          batches: {
            include: {
              batch: true,
            },
          },
        },
      },
    },
  });

  return sellStockCorrection;
};

// Update SellStockCorrection
const updateSellStockCorrection = async (
  sellStockCorrectionId,
  sellStockCorrectionBody,
  userId,
) => {
  // Check if sell stock correction exists
  const existingSellStockCorrection = await getSellStockCorrectionById(
    sellStockCorrectionId,
  );
  if (!existingSellStockCorrection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sell stock correction not found');
  }

  // Cannot update approved or rejected sell stock corrections
  if (existingSellStockCorrection.status !== 'PENDING') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot update ${existingSellStockCorrection.status.toLowerCase()} sell stock correction`,
    );
  }

  // Check if reference already exists (excluding current sell stock correction)
  if (
    sellStockCorrectionBody.reference &&
    sellStockCorrectionBody.reference !== existingSellStockCorrection.reference
  ) {
    if (
      await getSellStockCorrectionByReference(sellStockCorrectionBody.reference)
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Sell stock correction reference already taken',
      );
    }
  }

  // Parse items if it's a string
  const { items: itemsString, ...restSellStockCorrectionBody } =
    sellStockCorrectionBody;
  const items =
    typeof itemsString === 'string' ? JSON.parse(itemsString) : itemsString;

  // Validate items
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Sell stock correction must have at least one item',
    );
  }

  // Validate individual item properties and calculate totals
  let totalCorrectionAmount = 0;
  const itemsWithCalculations = items.map((item, index) => {
    if (!item.productId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} is missing required field (productId)`,
      );
    }
    if (!item.unitOfMeasureId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} is missing required field (unitOfMeasureId)`,
      );
    }
    if (
      item.quantity === undefined ||
      item.quantity === null ||
      Number.isNaN(Number(item.quantity))
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid quantity`,
      );
    }
    // Accept negative numbers but not zero
    if (Number(item.quantity) === 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} quantity cannot be zero`,
      );
    }
    if (!item.unitPrice || item.unitPrice < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} must have a valid unit price`,
      );
    }

    // Validate batches if provided
    if (item.batches && Array.isArray(item.batches)) {
      const batchQuantitySum = item.batches.reduce(
        (sum, batch) => sum + (batch.quantity || 0),
        0,
      );
      // Use the actual quantity (could be negative) for comparison
      if (batchQuantitySum !== item.quantity) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${
            index + 1
          } batch quantities (${batchQuantitySum}) must match item quantity (${
            item.quantity
          })`,
        );
      }
    }

    // Calculate total price for the item
    const totalPrice = item.unitPrice * Math.abs(item.quantity);
    // For negative quantities, subtract from total
    totalCorrectionAmount += item.quantity >= 0 ? totalPrice : -totalPrice;

    return {
      ...item,
      totalPrice,
    };
  });

  // Clean up empty string values
  const cleanedSellStockCorrectionBody = {
    ...restSellStockCorrectionBody,
    sellId:
      restSellStockCorrectionBody.sellId === ''
        ? null
        : restSellStockCorrectionBody.sellId,
  };

  // Update the sell stock correction inside a transaction
  const result = await prisma.$transaction(async (tx) => {
    // Delete all existing batches first
    await tx.sellStockCorrectionBatch.deleteMany({
      where: {
        correctionItem: {
          correctionId: sellStockCorrectionId,
        },
      },
    });

    // Delete all existing items
    await tx.sellStockCorrectionItem.deleteMany({
      where: { correctionId: sellStockCorrectionId },
    });

    // Update sell stock correction with cleaned body and new items
    const sellStockCorrection = await tx.sellStockCorrection.update({
      where: { id: sellStockCorrectionId },
      data: {
        ...cleanedSellStockCorrectionBody,
        total: totalCorrectionAmount,
        updatedById: userId,
        items: {
          create: itemsWithCalculations.map((item) => ({
            productId: item.productId,
            shopId: item.shopId || null,
            unitOfMeasureId: item.unitOfMeasureId,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            quantity: item.quantity, // Keep the original negative/positive value
            batches:
              item.batches && item.batches.length > 0
                ? {
                    create: item.batches.map((batch) => ({
                      batchId: batch.batchId,
                      quantity: batch.quantity,
                    })),
                  }
                : undefined,
          })),
        },
      },
      include: {
        items: {
          include: {
            product: true,
            unitOfMeasure: true,
            shop: true,
            batches: {
              include: {
                batch: true,
              },
            },
          },
        },
      },
    });

    return sellStockCorrection;
  });

  return result;
};

const approveSellStockCorrection = async (
  sellStockCorrectionId,
  userId,
  deliveredItemIds = [],
) => {
  const sellStockCorrection = await getSellStockCorrectionById(
    sellStockCorrectionId,
  );

  if (!sellStockCorrection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sell stock correction not found');
  }

  if (sellStockCorrection.status === 'APPROVED') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Sell stock correction is already ${sellStockCorrection.status.toLowerCase()}`,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // First, update the itemSaleStatus for the delivered items
    if (deliveredItemIds.length > 0) {
      await tx.sellStockCorrectionItem.updateMany({
        where: {
          id: { in: deliveredItemIds },
          correctionId: sellStockCorrectionId,
        },
        data: {
          itemSaleStatus: 'DELIVERED',
          updatedAt: new Date(),
        },
      });
    }

    // Fetch updated sell stock correction with items
    const updatedSellStockCorrection = await tx.sellStockCorrection.findUnique({
      where: { id: sellStockCorrectionId },
      include: {
        items: {
          include: {
            batches: true,
            unitOfMeasure: true,
          },
        },
      },
    });

    if (!updatedSellStockCorrection) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        'Sell stock correction not found after update',
      );
    }

    // Determine the final status based on delivered items
    const allItemsCount = updatedSellStockCorrection.items.length;
    const deliveredItemsCount = updatedSellStockCorrection.items.filter(
      (item) => item.itemSaleStatus === 'DELIVERED',
    ).length;

    let finalStatus = 'APPROVED';
    if (deliveredItemsCount === 0) {
      finalStatus = 'PENDING';
    } else if (deliveredItemsCount > 0 && deliveredItemsCount < allItemsCount) {
      finalStatus = 'PARTIAL';
    }

    // Get unit of measures
    const unitOfMeasureIds = updatedSellStockCorrection.items
      .map((item) => item.unitOfMeasureId)
      .filter((id) => id);

    const unitOfMeasures = await tx.unitOfMeasure.findMany({
      where: { id: { in: unitOfMeasureIds } },
    });

    const unitOfMeasureMap = unitOfMeasures.reduce((acc, uom) => {
      acc[uom.id] = uom;
      return acc;
    }, {});

    // Get the associated sell with its items to calculate net total
    let sell = null;
    let netTotalAdjustment = 0;

    if (updatedSellStockCorrection.sellId) {
      sell = await tx.sell.findUnique({
        where: { id: updatedSellStockCorrection.sellId },
        include: {
          items: {
            include: {
              batches: {
                include: {
                  batch: true,
                },
              },
              unitOfMeasure: true,
            },
          },
        },
      });

      if (!sell) {
        throw new ApiError(httpStatus.NOT_FOUND, 'Associated sell not found');
      }

      // Calculate net total adjustment based on DELIVERED stock correction items only
      netTotalAdjustment = updatedSellStockCorrection.items.reduce(
        (adjustment, correctionItem) => {
          // Only include delivered items in the adjustment
          if (correctionItem.itemSaleStatus !== 'DELIVERED') {
            console.log(`Skipping item ${correctionItem.id} - status: ${correctionItem.itemSaleStatus}`);
            return adjustment;
          }

          const unitOfMeasure =
            unitOfMeasureMap[correctionItem.unitOfMeasureId];

          if (!unitOfMeasure) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Unit of measure not found for item ${correctionItem.id}`,
            );
          }

          console.log(`Processing correction item:`, {
            id: correctionItem.id,
            productId: correctionItem.productId,
            quantity: correctionItem.quantity,
            unitPrice: correctionItem.unitPrice,
            status: correctionItem.itemSaleStatus
          });

          // Calculate adjustment: quantity × unitPrice
          // Negative quantity = negative adjustment (customer pays less)
          // Positive quantity = positive adjustment (customer pays more)
          const itemAdjustment = correctionItem.quantity * correctionItem.unitPrice;
          console.log(`Item adjustment: ${correctionItem.quantity} × ${correctionItem.unitPrice} = ${itemAdjustment}`);
          
          return adjustment + itemAdjustment;
        },
        0,
      );

      console.log('Final netTotalAdjustment:', netTotalAdjustment);
      console.log('Original sell NetTotal:', sell.NetTotal);
    }

    // Prepare all operations for each DELIVERED sell stock correction item
    const operationsPromises = updatedSellStockCorrection.items.map(
      async (item) => {
        // Only process delivered items
        if (item.itemSaleStatus !== 'DELIVERED') {
          console.log(`Skipping stock update for item ${item.id} - status: ${item.itemSaleStatus}`);
          return [];
        }

        const unitOfMeasure = unitOfMeasureMap[item.unitOfMeasureId];

        if (!unitOfMeasure) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Unit of measure not found for item ${item.id}`,
          );
        }

        const quantityToUse = item.quantity;
        const isAddition = quantityToUse > 0;
        const movementType = isAddition ? 'OUT' : 'IN';
        const absoluteQuantity = Math.abs(quantityToUse);
        const notes = isAddition
          ? `Sell stock subtraction: ${
              updatedSellStockCorrection.notes || 'correction'
            }`
          : `Sell stock addition: ${
              updatedSellStockCorrection.notes || 'correction'
            }`;

        const itemOperations = [];

        // Handle batch-level stock updates if batches are specified
        if (item.batches && item.batches.length > 0) {
          // Check stock availability before processing
          for (const correctionBatch of item.batches) {
            const batchQuantity = correctionBatch.quantity;
            const { batchId } = correctionBatch;

            if (item.shopId) {
              // Check current stock for this batch
              const currentStock = await tx.shopStock.findUnique({
                where: {
                  shopId_batchId: {
                    shopId: item.shopId,
                    batchId,
                  },
                },
              });

              // For subtractions (OUT movement), check if enough stock exists
              if (isAddition) {
                // isAddition means positive quantity (OUT movement)
                if (currentStock && currentStock.quantity < batchQuantity) {
                  throw new ApiError(
                    httpStatus.BAD_REQUEST,
                    `Insufficient stock for batch ${batchId}. Available: ${currentStock.quantity}, Required: ${batchQuantity}`,
                  );
                }
              }

              itemOperations.push(
                tx.shopStock.upsert({
                  where: {
                    shopId_batchId: {
                      shopId: item.shopId,
                      batchId,
                    },
                  },
                  update: {
                    quantity: isAddition
                      ? { decrement: batchQuantity }
                      : { increment: batchQuantity },
                  },
                  create: {
                    shopId: item.shopId,
                    batchId,
                    quantity: isAddition ? -batchQuantity : batchQuantity,
                    unitOfMeasureId: item.unitOfMeasureId,
                    status: 'Available',
                  },
                }),
              );

              // Create stock ledger entry for each batch
              itemOperations.push(
                tx.stockLedger.create({
                  data: {
                    batchId,
                    shopId: item.shopId,
                    movementType,
                    quantity: batchQuantity,
                    unitOfMeasureId: item.unitOfMeasureId,
                    reference:
                      updatedSellStockCorrection.reference ||
                      `SELL-CORRECTION-${updatedSellStockCorrection.id}`,
                    userId,
                    notes: `${notes} (Batch: ${batchId})`,
                    movementDate: new Date(),
                  },
                }),
              );
            }
          }
        } else if (item.shopId) {
          // Check product-level stock availability
          const currentStocks = await tx.shopStock.findMany({
            where: {
              shopId: item.shopId,
              batch: {
                productId: item.productId,
              },
            },
            include: {
              batch: true,
            },
          });

          const totalAvailableStock = currentStocks.reduce(
            (sum, stock) => sum + stock.quantity,
            0,
          );

          // For subtractions (OUT movement), check if enough stock exists
          if (isAddition) {
            // isAddition means positive quantity (OUT movement)
            if (totalAvailableStock < absoluteQuantity) {
              throw new ApiError(
                httpStatus.BAD_REQUEST,
                `Insufficient stock for product. Available: ${totalAvailableStock}, Required: ${absoluteQuantity}`,
              );
            }
          }

          // Fallback to product-level stock update if no batches specified and shopId exists
          itemOperations.push(
            tx.shopStock.upsert({
              where: {
                shopId_batchId: {
                  shopId: item.shopId,
                  batchId: 'no-batch',
                },
              },
              update: {
                quantity: isAddition
                  ? { decrement: absoluteQuantity }
                  : { increment: absoluteQuantity },
              },
              create: {
                shopId: item.shopId,
                batchId: 'no-batch',
                quantity: isAddition ? -absoluteQuantity : absoluteQuantity,
                unitOfMeasureId: item.unitOfMeasureId,
                status: 'Available',
              },
            }),
          );

          // Create stock ledger entry for shop
          itemOperations.push(
            tx.stockLedger.create({
              data: {
                batchId: null,
                shopId: item.shopId,
                movementType,
                quantity: absoluteQuantity,
                unitOfMeasureId: item.unitOfMeasureId,
                reference:
                  updatedSellStockCorrection.reference ||
                  `SELL-CORRECTION-${updatedSellStockCorrection.id}`,
                userId,
                notes,
                movementDate: new Date(),
              },
            }),
          );
        }

        return itemOperations;
      },
    );

    // Wait for all promises to resolve and flatten the results
    const operationsArrays = await Promise.all(operationsPromises);
    const allOperations = operationsArrays.flat();

    // Execute all operations
    if (allOperations.length > 0) {
      await Promise.all(allOperations);
    }

    // Update sell's net total if there's an associated sell and netTotalAdjustment is not zero
    if (sell && netTotalAdjustment !== 0) {
      const newNetTotal = sell.NetTotal + netTotalAdjustment;

      // Ensure net total doesn't go negative
      const finalNetTotal = Math.max(0, newNetTotal);

      console.log(`Updating sell NetTotal: ${sell.NetTotal} + ${netTotalAdjustment} = ${newNetTotal}`);
      console.log(`Final NetTotal: ${finalNetTotal}`);

      await tx.sell.update({
        where: { id: sell.id },
        data: {
          NetTotal: finalNetTotal,
          updatedById: userId,
          updatedAt: new Date(),
        },
      });
    } else {
      console.log('No net total update needed:', {
        hasSell: !!sell,
        netTotalAdjustment,
        sellNetTotal: sell?.NetTotal
      });
    }

    // Update sell stock correction status based on delivery status
    const finalSellStockCorrection = await tx.sellStockCorrection.update({
      where: { id: sellStockCorrectionId },
      data: {
        status: finalStatus,
        updatedById: userId,
        updatedAt: new Date(),
      },
      include: {
        items: {
          select: {
            id: true,
            itemSaleStatus: true,
            productId: true,
            quantity: true,
          },
        },
      },
    });

    // Create log entry
    const deliveredItemsText =
      deliveredItemIds.length > 0
        ? `Marked ${deliveredItemIds.length} items as delivered`
        : 'No items marked as delivered';

    await tx.log.create({
      data: {
        action: `Updated sell stock correction ${
          updatedSellStockCorrection.reference || updatedSellStockCorrection.id
        }. Status: ${finalStatus}. ${deliveredItemsText}. ${
          sell && netTotalAdjustment !== 0
            ? `Net total adjusted by ${netTotalAdjustment}`
            : 'No net total adjustment'
        }`,
        userId,
      },
    });

    return {
      ...finalSellStockCorrection,
      netTotalAdjustment: netTotalAdjustment || 0,
      previousNetTotal: sell ? sell.NetTotal : null,
      newNetTotal:
        sell && netTotalAdjustment !== 0
          ? Math.max(0, sell.NetTotal + netTotalAdjustment)
          : sell
          ? sell.NetTotal
          : null,
      deliveredItemsCount,
      totalItemsCount: allItemsCount,
    };
  });

  return result;
};
const deleteSellStockCorrection = async (id, userId) => {
  const existingSellStockCorrection = await getSellStockCorrectionById(id);
  if (!existingSellStockCorrection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sell stock correction not found');
  }

  return prisma.$transaction(async (tx) => {
    // Get all sell stock correction items with their batches for reversal
    const correctionItemsWithBatches =
      await tx.sellStockCorrectionItem.findMany({
        where: { correctionId: id },
        include: {
          batches: {
            include: {
              batch: true,
            },
          },
          shop: true,
          unitOfMeasure: true,
          product: true,
        },
      });

    // Prepare operations for stock reversal (only for APPROVED corrections)
    const reversalOperations = [];
    let netTotalAdjustment = 0;

    // If the correction was approved, reverse the stock movements
    if (existingSellStockCorrection.status === 'APPROVED') {
      // Get the associated sell to calculate net total reversal
      let sell = null;
      if (existingSellStockCorrection.sellId) {
        sell = await tx.sell.findUnique({
          where: { id: existingSellStockCorrection.sellId },
          include: {
            items: {
              include: {
                unitOfMeasure: true,
              },
            },
          },
        });
      }

      // Reverse each correction item
      correctionItemsWithBatches.forEach((item) => {
        const originalQuantity = item.quantity;
        const isAddition = originalQuantity > 0;
        const reverseMovementType = isAddition ? 'IN' : 'OUT'; // Reverse the original movement
        const absoluteQuantity = Math.abs(originalQuantity);

        // Calculate net total adjustment for reversal
        if (sell) {
          if (isAddition) {
            // For additions: Use the correction item's unit price (reverse subtraction)
            const itemValueAdjustment = absoluteQuantity * item.unitPrice;
            netTotalAdjustment -= itemValueAdjustment;
          } else {
            // For subtractions: Find the corresponding sell item and use its unit price (reverse addition)
            const sellItem = sell.items.find(
              (s) => s.productId === item.productId && s.shopId === item.shopId,
            );
            if (sellItem) {
              const itemValueAdjustment = absoluteQuantity * sellItem.unitPrice;
              netTotalAdjustment += itemValueAdjustment;
            }
          }
        }

        // Handle batch-level stock reversal if batches exist
        if (item.batches && item.batches.length > 0) {
          item.batches.forEach((correctionBatch) => {
            const batchQuantity = correctionBatch.quantity;
            const { batchId } = correctionBatch;

            if (item.shopId) {
              // Reverse the stock update - do the opposite of the original operation
              reversalOperations.push(
                tx.shopStock.update({
                  where: {
                    shopId_batchId: {
                      shopId: item.shopId,
                      batchId,
                    },
                  },
                  data: {
                    quantity: isAddition
                      ? { increment: batchQuantity } // Reverse subtraction by adding
                      : { decrement: batchQuantity }, // Reverse addition by subtracting
                  },
                }),
              );

              // Create reverse stock ledger entry
              reversalOperations.push(
                tx.stockLedger.create({
                  data: {
                    batchId,
                    shopId: item.shopId,
                    movementType: reverseMovementType,
                    quantity: batchQuantity,
                    unitOfMeasureId: item.unitOfMeasureId,
                    reference: `SELL-CORRECTION-REVERSAL-${id}`,
                    userId,
                    notes: `Sell stock correction reversal - ${
                      isAddition
                        ? 'Adding back subtracted stock'
                        : 'Removing added stock'
                    } for Item: ${item.id} (Batch: ${batchId})`,
                    movementDate: new Date(),
                  },
                }),
              );
            }
          });
        } else if (item.shopId) {
          // Fallback to product-level stock reversal
          reversalOperations.push(
            tx.shopStock.update({
              where: {
                shopId_batchId: {
                  shopId: item.shopId,
                  batchId: 'no-batch',
                },
              },
              data: {
                quantity: isAddition
                  ? { increment: absoluteQuantity } // Reverse subtraction
                  : { decrement: absoluteQuantity }, // Reverse addition
              },
            }),
          );

          // Create reverse stock ledger entry for shop
          reversalOperations.push(
            tx.stockLedger.create({
              data: {
                batchId: null,
                shopId: item.shopId,
                movementType: reverseMovementType,
                quantity: absoluteQuantity,
                unitOfMeasureId: item.unitOfMeasureId,
                reference: `SELL-CORRECTION-REVERSAL-${id}`,
                userId,
                notes: `Sell stock correction reversal - ${
                  isAddition
                    ? 'Adding back subtracted stock'
                    : 'Removing added stock'
                } for Item: ${item.id}`,
                movementDate: new Date(),
              },
            }),
          );
        }
      });

      // Reverse net total adjustment if there's an associated sell
      if (sell && netTotalAdjustment !== 0) {
        const newNetTotal = sell.NetTotal + netTotalAdjustment;

        // Ensure net total doesn't go negative
        const finalNetTotal = Math.max(0, newNetTotal);

        reversalOperations.push(
          tx.sell.update({
            where: { id: sell.id },
            data: {
              NetTotal: finalNetTotal,
              updatedById: userId,
              updatedAt: new Date(),
            },
          }),
        );
      }

      // Execute all reversal operations
      if (reversalOperations.length > 0) {
        await Promise.all(reversalOperations);
      }
    }

    // Delete all sell stock correction batches first
    await tx.sellStockCorrectionBatch.deleteMany({
      where: {
        correctionItem: {
          correctionId: id,
        },
      },
    });

    // Delete all sell stock correction items
    await tx.sellStockCorrectionItem.deleteMany({
      where: { correctionId: id },
    });

    // Delete the sell stock correction
    await tx.sellStockCorrection.delete({
      where: { id },
    });

    // Create log entry with reversal details
    let logMessage = `Sell stock correction ${
      existingSellStockCorrection.reference || id
    } deleted`;

    if (existingSellStockCorrection.status === 'APPROVED') {
      const totalItemsReversed = correctionItemsWithBatches.length;
      const totalBatchesReversed = correctionItemsWithBatches.reduce(
        (sum, item) => sum + (item.batches?.length || 0),
        0,
      );

      logMessage += ` - Stock reversal completed: ${totalItemsReversed} items, ${totalBatchesReversed} batches`;

      if (netTotalAdjustment !== 0) {
        logMessage += `, Net total adjusted by ${netTotalAdjustment}`;
      }
    } else {
      logMessage += ` (status: ${existingSellStockCorrection.status})`;
    }

    await tx.log.create({
      data: {
        action: logMessage,
        userId,
      },
    });

    return {
      message: `Sell stock correction deleted successfully${
        existingSellStockCorrection.status === 'APPROVED'
          ? ' with stock reversal'
          : ''
      }`,
      reversalPerformed: existingSellStockCorrection.status === 'APPROVED',
      netTotalAdjustment:
        existingSellStockCorrection.status === 'APPROVED'
          ? netTotalAdjustment
          : 0,
    };
  });
};
// Reject SellStockCorrection
const rejectSellStockCorrection = async (sellStockCorrectionId, userId) => {
  const sellStockCorrection = await getSellStockCorrectionById(
    sellStockCorrectionId,
  );

  if (!sellStockCorrection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sell stock correction not found');
  }

  if (sellStockCorrection.status !== 'PENDING') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot reject ${sellStockCorrection.status.toLowerCase()} sell stock correction`,
    );
  }

  const updatedSellStockCorrection = await prisma.sellStockCorrection.update({
    where: { id: sellStockCorrectionId },
    data: {
      status: 'REJECTED',
      updatedById: userId,
    },
  });

  // Create log entry
  await prisma.log.create({
    data: {
      action: `Rejected sell stock correction ${
        sellStockCorrection.reference || sellStockCorrection.id
      }`,
      userId,
    },
  });

  return updatedSellStockCorrection;
};
const getSellByIdforsellcorrection = async (id) => {
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
              batch: {
                include: {
                  product: {
                    include: {
                      unitOfMeasure: true,
                      category: true,
                      subCategory: true,
                    },
                  },
                  store: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!sell) {
    return null;
  }

  // Collect all batch IDs and shop IDs to query shop stock in one go
  const batchIds = [];
  const shopBatchPairs = [];

  sell.items.forEach((item) => {
    item.batches.forEach((sellBatch) => {
      batchIds.push(sellBatch.batchId);
      shopBatchPairs.push({
        batchId: sellBatch.batchId,
        shopId: item.shopId,
      });
    });
  });

  // Get all relevant shop stock records in one query
  const shopStocks = await prisma.shopStock.findMany({
    where: {
      OR: shopBatchPairs.map((pair) => ({
        batchId: pair.batchId,
        shopId: pair.shopId,
        status: 'Available',
      })),
    },
    include: {
      unitOfMeasure: true,
      shop: true,
    },
  });

  // Create a map for quick lookup: { `${batchId}-${shopId}`: shopStock }
  const shopStockMap = new Map();
  shopStocks.forEach((stock) => {
    const key = `${stock.batchId}-${stock.shopId}`;
    shopStockMap.set(key, stock);
  });

  // Enhance items with batch availability
  const enhancedItems = sell.items.map((item) => {
    const batchesWithAvailability = item.batches.map((sellBatch) => {
      const key = `${sellBatch.batchId}-${item.shopId}`;
      const shopStock = shopStockMap.get(key);

      return {
        ...sellBatch,
        batch: {
          ...sellBatch.batch,
          availableQuantity: shopStock ? shopStock.quantity : 0,
          availableShopStock: shopStock || null,
        },
      };
    });

    return {
      ...item,
      batches: batchesWithAvailability,
    };
  });

  return {
    ...sell,
    items: enhancedItems,
  };
};
module.exports = {
  getSellStockCorrectionById,
  getSellStockCorrectionByReference,
  getAllSellStockCorrections,
  getSellStockCorrectionsBySellId,
  createSellStockCorrection,
  updateSellStockCorrection,
  deleteSellStockCorrection,
  approveSellStockCorrection,
  rejectSellStockCorrection,
  getSellByIdforsellcorrection,
  getSellStockCorrectionfilterId,
};
