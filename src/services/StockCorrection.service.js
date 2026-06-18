const httpStatus = require('http-status');
const { subMonths } = require('date-fns');

const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Get StockCorrection by ID
const getStockCorrectionById = async (id) => {
  try {
    if (!id || typeof id !== 'string') {
      throw new Error('Invalid stock correction ID');
    }
    const stockCorrection = await prisma.stockCorrection.findUnique({
      where: { id },
      include: {
        purchase: true,
        createdBy: true,
        updatedBy: true,
        store: true,
        showroom: true,
        items: {
          include: {
            material: true,
          },
        },
      },
    });
    return stockCorrection;
  } catch (error) {
    if (error.code) {
      console.error('Prisma error code:', error.code);
    }
    if (
      error.message.includes('connect') ||
      error.message.includes('connection')
    ) {
      console.error('Database connection error');
    }
    if (
      error.message.includes('Invalid value') ||
      error.message.includes('malformed')
    ) {
      console.error('Invalid ID format');
    }
    throw error;
  }
};

// Get material stock quantity by material ID
const getMaterialStockQuantity = async (materialId) => {
  try {
    if (!materialId || typeof materialId !== 'string') {
      throw new Error('Invalid material ID');
    }

    const material = await prisma.material.findUnique({
      where: { id: materialId },
      select: {
        name: true,
      },
    });

    if (!material) {
      return null;
    }

    const totalStock = await prisma.inventoryStock.aggregate({
      where: {
        materialId,
        status: 'Available',
      },
      _sum: {
        quantity: true,
      },
    });
    return {
      materialId,
      materialName: material.name,
      totalQuantity: totalStock._sum.quantity || 0,
    };
  } catch (error) {
    if (error.code) {
      console.error('Prisma error code:', error.code);
    }
    if (
      error.message.includes('connect') ||
      error.message.includes('connection')
    ) {
      console.error('Database connection error');
    }
    throw error;
  }
};
const getMaterialStockQuantityreserve = async (materialId) => {
  try {
    if (!materialId || typeof materialId !== 'string') {
      throw new Error('Invalid material ID');
    }

    const material = await prisma.material.findUnique({
      where: { id: materialId },
      select: {
        name: true,
      },
    });

    if (!material) {
      return null;
    }

    // Physical inventory stock
    const totalStock = await prisma.inventoryStock.aggregate({
      where: {
        materialId,
        status: 'Available',
      },
      _sum: {
        quantity: true,
      },
    });

    // Reserved stock from other projects
    const reservedMaterials =
      await prisma.proformaItemMaterial.findMany({
        where: {
          materialId,
          status: {
            in: ['PENDING', 'PARTIALLY'],
          },
        },
        select: {
          quantity: true,
          additionalQuantity: true,
          givenquantity: true,
        },
      });

    // Calculate reserved remaining quantity
    const reservedQuantity =
      reservedMaterials.reduce((sum, item) => {
        const reserved =
          (item.quantity || 0) +
          (item.additionalQuantity || 0) -
          (item.givenquantity || 0);

        return sum + (reserved > 0 ? reserved : 0);
      }, 0);

    const physicalQuantity =
      totalStock._sum.quantity || 0;

    // Final available quantity
    const remainingQuantity =
      physicalQuantity - reservedQuantity;

    return {
      materialId,
      materialName: material.name,

      // frontend expects this
      totalQuantity:
        remainingQuantity > 0
          ? remainingQuantity
          : 0,
    };
  } catch (error) {
    if (error.code) {
      console.error(
        'Prisma error code:',
        error.code,
      );
    }

    if (
      error.message.includes('connect') ||
      error.message.includes('connection')
    ) {
      console.error(
        'Database connection error',
      );
    }

    throw error;
  }
};
const getStockCorrectionsByPurchaseId = async (purchaseId) => {
  const stockCorrections = await prisma.stockCorrection.findMany({
    where: {
      purchaseId,
    },
    include: {
      purchase: true,
      createdBy: true,
      updatedBy: true,
      items: {
        include: {
          material: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
  return stockCorrections;
};

const getStockCorrectionByReference = async (reference) => {
  const stockCorrection = await prisma.stockCorrection.findFirst({
    where: { reference },
  });
  return stockCorrection;
};

const getAllStockCorrections = async ({ startDate, endDate } = {}) => {
  const whereClause = {};
  const threeMonthsAgo = subMonths(new Date(), 12);

  const startDateObj = startDate ? new Date(startDate) : undefined;
  const endDateObj = endDate ? new Date(endDate) : undefined;

  if (startDateObj && isNaN(startDateObj.getTime())) {
    throw new Error('Invalid startDate format');
  }
  if (endDateObj && isNaN(endDateObj.getTime())) {
    throw new Error('Invalid endDate format');
  }

  if (startDateObj && endDateObj) {
    whereClause.createdAt = { gte: startDateObj, lte: endDateObj };
  } else if (startDateObj) {
    whereClause.createdAt = { gte: startDateObj, lte: new Date() };
  } else if (endDateObj) {
    whereClause.createdAt = { gte: threeMonthsAgo, lte: endDateObj };
  } else {
    whereClause.createdAt = { gte: threeMonthsAgo };
  }

  const stockCorrections = await prisma.stockCorrection.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      reference: true,
      reason: true,
      status: true,
      notes: true,
      createdAt: true,
      shortCode: true,
    },
  });

  return {
    stockCorrections,
    count: stockCorrections.length,
  };
};

const generateShortCode = async () => {
  try {
    const result = await prisma.$queryRaw`
      SELECT MAX(CAST(SUBSTRING("shortCode" FROM 4) AS INTEGER)) as maxNumber
      FROM "StockCorrection"
      WHERE "shortCode" LIKE 'SC-%'
    `;

    const maxNumber = result[0]?.maxNumber || 0;
    const nextNumber = maxNumber + 1;

    return `SC-${String(nextNumber).padStart(6, '0')}`;
  } catch (error) {
    const timestamp = Date.now();
    return `SC-EMG-${timestamp.toString().slice(-8)}`;
  }
};

const createStockCorrection = async (stockCorrectionBody, userId) => {
  const shortCode = await generateShortCode();

  const { items: itemsString, ...restStockCorrectionBody } = stockCorrectionBody;
  const items = typeof itemsString === 'string' ? JSON.parse(itemsString) : itemsString;

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Stock correction must have at least one item',
    );
  }

  // Get ismaterial from body (default to false for items)
  const ismaterial = stockCorrectionBody.ismaterial === true;

  // Validate items using map instead of for loop
  const itemsWithDetails = await Promise.all(
    items.map(async (item, index) => {
      // Validate based on type
      if (ismaterial) {
        if (!item.materialId) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Item ${index + 1} is missing required field (materialId)`,
          );
        }

        const material = await prisma.material.findUnique({
          where: { id: item.materialId },
        });

        if (!material) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Material with ID ${item.materialId} not found`,
          );
        }
      } else {
        if (!item.itemId) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Item ${index + 1} is missing required field (itemId)`,
          );
        }

        const productItem = await prisma.items.findUnique({
          where: { id: item.itemId },
        });

        if (!productItem) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Item with ID ${item.itemId} not found`,
          );
        }
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

      // Return the appropriate fields based on type
      if (ismaterial) {
        return {
          materialId: item.materialId,
          quantity: item.quantity,
        };
      } else {
        return {
          itemId: item.itemId,
          quantity: item.quantity,
        };
      }
    }),
  );

  const cleanedStockCorrectionBody = {
    ...restStockCorrectionBody,
    purchaseId:
      restStockCorrectionBody.purchaseId === ''
        ? null
        : restStockCorrectionBody.purchaseId,
  };

  const stockCorrection = await prisma.stockCorrection.create({
    data: {
      ...cleanedStockCorrectionBody,
      shortCode,
      ismaterial: ismaterial, // Set the ismaterial flag
      createdById: userId,
      updatedById: userId,
      items: {
        create: itemsWithDetails,
      },
    },
    include: {
      items: {
        include: {
          material: true,
          item: true,
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
  const existingStockCorrection = await getStockCorrectionById(
    stockCorrectionId,
  );
  if (!existingStockCorrection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Stock correction not found');
  }

  if (existingStockCorrection.status !== 'PENDING') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot update ${existingStockCorrection.status.toLowerCase()} stock correction`,
    );
  }

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

  const { items: itemsString, ...restStockCorrectionBody } = stockCorrectionBody;
  const items = typeof itemsString === 'string' ? JSON.parse(itemsString) : itemsString;

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Stock correction must have at least one item',
    );
  }

  // Get ismaterial from body (default to existing value if not provided)
  const ismaterial = stockCorrectionBody.ismaterial !== undefined 
    ? stockCorrectionBody.ismaterial 
    : existingStockCorrection.ismaterial;

  // Validate items using map
  const itemsWithDetails = await Promise.all(
    items.map(async (item, index) => {
      // Validate based on type
      if (ismaterial) {
        if (!item.materialId) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Item ${index + 1} is missing required field (materialId)`,
          );
        }

        const material = await prisma.material.findUnique({
          where: { id: item.materialId },
        });

        if (!material) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Material with ID ${item.materialId} not found`,
          );
        }
      } else {
        if (!item.itemId) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Item ${index + 1} is missing required field (itemId)`,
          );
        }

        const productItem = await prisma.items.findUnique({
          where: { id: item.itemId },
        });

        if (!productItem) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Item with ID ${item.itemId} not found`,
          );
        }
      }

      // Return the appropriate fields based on type
      if (ismaterial) {
        return {
          materialId: item.materialId,
          quantity: item.quantity,
        };
      } else {
        return {
          itemId: item.itemId,
          quantity: item.quantity,
        };
      }
    }),
  );

  const cleanedStockCorrectionBody = {
    ...restStockCorrectionBody,
    purchaseId:
      restStockCorrectionBody.purchaseId === ''
        ? null
        : restStockCorrectionBody.purchaseId,
  };

  const result = await prisma.$transaction(async (tx) => {
    await tx.stockCorrectionItem.deleteMany({
      where: { correctionId: stockCorrectionId },
    });

    const stockCorrection = await tx.stockCorrection.update({
      where: { id: stockCorrectionId },
      data: {
        ...cleanedStockCorrectionBody,
        ismaterial: ismaterial, // Update the ismaterial flag if changed
        updatedById: userId,
        items: {
          create: itemsWithDetails,
        },
      },
      include: {
        items: {
          include: {
            material: true,
            item: true,
          },
        },
      },
    });

    return stockCorrection;
  });

  return result;
};

// Approve StockCorrection - updated to handle both items and materials
const approveStockCorrection = async (stockCorrectionId, userId) => {
  const stockCorrection = await prisma.stockCorrection.findUnique({
    where: { id: stockCorrectionId },
    include: {
      items: {
        include: {
          material: {
            select: {
              id: true,
              name: true,
            },
          },
          item: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  if (!stockCorrection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Stock correction not found');
  }

  if (stockCorrection.status !== 'PENDING') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Stock correction is already ${stockCorrection.status.toLowerCase()}`,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const ismaterial = stockCorrection.ismaterial;

    // Check for negative stock BEFORE processing
    const stockCheckPromises = stockCorrection.items
      .filter((item) => item.quantity < 0)
      .map(async (item) => {
        const itemName = ismaterial 
          ? item.material?.name || `Material ID: ${item.materialId}`
          : item.item?.name || `Item ID: ${item.itemId}`;
        const absoluteQuantity = Math.abs(item.quantity);

        let inventoryStock;
        if (ismaterial) {
          inventoryStock = await tx.inventoryStock.findFirst({
            where: {
              materialId: item.materialId,
              storeId: stockCorrection.storeId || undefined,
              showroomId: stockCorrection.showroomId || undefined,
            },
          });
        } else {
          inventoryStock = await tx.itemStock.findFirst({
            where: {
              itemId: item.itemId,
              storeId: stockCorrection.storeId || undefined,
              showroomId: stockCorrection.showroomId || undefined,
            },
          });
        }
        
        const currentStock = inventoryStock?.quantity || 0;

        if (currentStock < absoluteQuantity) {
          return {
            itemName,
            required: absoluteQuantity,
            available: currentStock,
          };
        }
        return null;
      });

    const stockCheckResults = await Promise.all(stockCheckPromises);
    const insufficientStockItems = stockCheckResults.filter((result) => result !== null);

    if (insufficientStockItems.length > 0) {
      const errorDetails = insufficientStockItems
        .map((item) => `${item.itemName}: Required ${item.required}, Available ${item.available}`)
        .join('; ');

      const errorMessage = insufficientStockItems.length === 1
        ? `Insufficient stock: ${errorDetails}`
        : `Insufficient stock for multiple items: ${errorDetails}`;

      throw new ApiError(httpStatus.BAD_REQUEST, errorMessage);
    }

    // Process each item
    await Promise.all(
      stockCorrection.items.map(async (item, index) => {
        const itemName = ismaterial 
          ? item.material?.name || `Material ID: ${item.materialId}`
          : item.item?.name || `Item ID: ${item.itemId}`;
        
        const isAddition = item.quantity > 0;
        const movementType = isAddition ? 'IN' : 'OUT';
        const absoluteQuantity = Math.abs(item.quantity);
        const notes = isAddition
          ? `Stock addition for "${itemName}": ${stockCorrection.reason.toLowerCase()}`
          : `Stock subtraction for "${itemName}": ${stockCorrection.reason.toLowerCase()}`;

        const now = new Date();
        const timestamp = now.getTime();
        const uniqueReference = `${stockCorrection.shortCode || 'SC'}-${timestamp}-${index + 1}`;

        if (ismaterial) {
          // Handle Material Stock
          const existingStock = await tx.inventoryStock.findFirst({
            where: {
              materialId: item.materialId,
              storeId: stockCorrection.storeId || undefined,
              showroomId: stockCorrection.showroomId || undefined,
            },
          });

          if (existingStock) {
            await tx.inventoryStock.update({
              where: { id: existingStock.id },
              data: {
                quantity: isAddition
                  ? { increment: absoluteQuantity }
                  : { decrement: absoluteQuantity },
                status: 'Available',
                lastUpdated: new Date(),
              },
            });
          } else if (isAddition) {
            await tx.inventoryStock.create({
              data: {
                materialId: item.materialId,
                storeId: stockCorrection.storeId || undefined,
                showroomId: stockCorrection.showroomId || undefined,
                quantity: absoluteQuantity,
                status: 'Available',
                lastUpdated: new Date(),
              },
            });
          } else {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Cannot subtract ${absoluteQuantity} from non-existent stock for "${itemName}"`
            );
          }

          // Create stock ledger entry
          await tx.stockLedger.create({
            data: {
              materialId: item.materialId,
              storeId: stockCorrection.storeId || undefined,
              showroomId: stockCorrection.showroomId || undefined,
              movementType,
              quantity: absoluteQuantity,
              reference: uniqueReference,
              userId,
              notes: notes,
              movementDate: now,
            },
          });
        } else {
          // Handle Item Stock
          const existingStock = await tx.itemStock.findFirst({
            where: {
              itemId: item.itemId,
              storeId: stockCorrection.storeId || undefined,
              showroomId: stockCorrection.showroomId || undefined,
            },
          });

          if (existingStock) {
            await tx.itemStock.update({
              where: { id: existingStock.id },
              data: {
                quantity: isAddition
                  ? { increment: absoluteQuantity }
                  : { decrement: absoluteQuantity },
              },
            });
          } else if (isAddition) {
            await tx.itemStock.create({
              data: {
                itemId: item.itemId,
                storeId: stockCorrection.storeId || undefined,
                showroomId: stockCorrection.showroomId || undefined,
                quantity: absoluteQuantity,
              },
            });
          } else {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Cannot subtract ${absoluteQuantity} from non-existent stock for "${itemName}"`
            );
          }

          // Create item stock ledger entry
          await tx.itemStockLedger.create({
            data: {
              itemId: item.itemId,
              storeId: stockCorrection.storeId || undefined,
              showroomId: stockCorrection.showroomId || undefined,
              movementType,
              quantity: absoluteQuantity,
              reference: uniqueReference,
              userId,
              notes: notes,
            },
          });
        }
      })
    );

    // Update stock correction status to APPROVED
    const updatedStockCorrection = await tx.stockCorrection.update({
      where: { id: stockCorrectionId },
      data: {
        status: 'APPROVED',
        updatedById: userId,
      },
    });

    // Create log entry
    const itemNames = stockCorrection.items
      .map((item) => {
        if (ismaterial) {
          return item.material?.name || `Material ID: ${item.materialId}`;
        } else {
          return item.item?.name || `Item ID: ${item.itemId}`;
        }
      })
      .join(', ');

    await tx.log.create({
      data: {
        action: `Approved stock correction ${stockCorrection.reference || stockCorrection.id} for items: ${itemNames}`,
        userId,
      },
    });

    return updatedStockCorrection;
  });

  return result;
};

// Delete StockCorrection
// Delete StockCorrection
const deleteStockCorrection = async (id, userId) => {
  const existingStockCorrection = await getStockCorrectionById(id);
  if (!existingStockCorrection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Stock correction not found');
  }

  await prisma.$transaction(async (tx) => {
    // Check if stock correction was approved
    const existingLedgerEntries = await tx.stockLedger.count({
      where: {
        reference: {
          contains: existingStockCorrection.shortCode,
        },
      },
    });

    const wasApproved = existingLedgerEntries > 0;

    // REVERSE EVERYTHING if approved
    if (wasApproved) {
      await Promise.all(
        existingStockCorrection.items.map(async (item) => {
          const isAddition = item.quantity > 0;
          const absoluteQuantity = Math.abs(item.quantity);
          const isMaterial = existingStockCorrection.ismaterial;

          if (isMaterial) {
            // Handle material reversal
            // 1. Reverse the stock correction
            const existingInventoryStock = await tx.inventoryStock.findFirst({
              where: {
                materialId: item.materialId,
                storeId: existingStockCorrection.storeId || undefined,
                showroomId: existingStockCorrection.showroomId || undefined,
              },
            });

            if (existingInventoryStock) {
              // If it was an addition, subtract it; if it was a subtraction, add it back
              const newQuantity = isAddition
                ? existingInventoryStock.quantity - absoluteQuantity
                : existingInventoryStock.quantity + absoluteQuantity;

              if (newQuantity <= 0) {
                await tx.inventoryStock.delete({
                  where: { id: existingInventoryStock.id },
                });
              } else {
                await tx.inventoryStock.update({
                  where: { id: existingInventoryStock.id },
                  data: {
                    quantity: newQuantity,
                    status: 'Available',
                    lastUpdated: new Date(),
                  },
                });
              }
            } else if (!isAddition) {
              // If we're trying to reverse a subtraction but stock doesn't exist (shouldn't happen)
              // Just skip - stock was likely already removed
              console.warn(
                `Stock not found for material ${item.materialId} during reversal of subtraction`
              );
            }

            // 2. Create reversal ledger entry
            const reversalMovementType = isAddition ? 'OUT' : 'IN';
            await tx.stockLedger.create({
              data: {
                materialId: item.materialId,
                storeId: existingStockCorrection.storeId || undefined,
                showroomId: existingStockCorrection.showroomId || undefined,
                movementType: reversalMovementType,
                quantity: absoluteQuantity,
                reference: `STOCK-CORRECTION-REVERSAL-${existingStockCorrection.shortCode}`,
                userId,
                notes: `Stock correction reversal: ${existingStockCorrection.reason.toLowerCase()}`,
                movementDate: new Date(),
              },
            });

            // 3. Delete original stock ledger entries for this item
            await tx.stockLedger.deleteMany({
              where: {
                reference: {
                  contains: existingStockCorrection.shortCode,
                },
                materialId: item.materialId,
              },
            });
          } else {
            // Handle item/product reversal
            const existingItemStock = await tx.itemStock.findFirst({
              where: {
                itemId: item.itemId,
                storeId: existingStockCorrection.storeId || undefined,
                showroomId: existingStockCorrection.showroomId || undefined,
              },
            });

            if (existingItemStock) {
              const newQuantity = isAddition
                ? existingItemStock.quantity - absoluteQuantity
                : existingItemStock.quantity + absoluteQuantity;

              if (newQuantity <= 0) {
                await tx.itemStock.delete({
                  where: { id: existingItemStock.id },
                });
              } else {
                await tx.itemStock.update({
                  where: { id: existingItemStock.id },
                  data: {
                    quantity: newQuantity,
                  },
                });
              }
            } else if (!isAddition) {
              console.warn(
                `Item stock not found for item ${item.itemId} during reversal of subtraction`
              );
            }

            // Create reversal item stock ledger entry
            const reversalMovementType = isAddition ? 'OUT' : 'IN';
            await tx.itemStockLedger.create({
              data: {
                itemId: item.itemId,
                storeId: existingStockCorrection.storeId || undefined,
                showroomId: existingStockCorrection.showroomId || undefined,
                movementType: reversalMovementType,
                quantity: absoluteQuantity,
                reference: `STOCK-CORRECTION-REVERSAL-${existingStockCorrection.shortCode}`,
                userId,
                notes: `Stock correction reversal: ${existingStockCorrection.reason.toLowerCase()}`,
              },
            });

            // Delete original item stock ledger entries for this item
            await tx.itemStockLedger.deleteMany({
              where: {
                reference: {
                  contains: existingStockCorrection.shortCode,
                },
                itemId: item.itemId,
              },
            });
          }
        }),
      );

      // 4. Delete any remaining stock ledger entries
      await tx.stockLedger.deleteMany({
        where: {
          reference: {
            contains: existingStockCorrection.shortCode,
          },
        },
      });

      // 5. Delete any remaining item stock ledger entries
      await tx.itemStockLedger.deleteMany({
        where: {
          reference: {
            contains: existingStockCorrection.shortCode,
          },
        },
      });
    }

    // 6. Delete stock correction items
    await tx.stockCorrectionItem.deleteMany({
      where: { correctionId: id },
    });

    // 7. Delete stock correction record
    await tx.stockCorrection.delete({
      where: { id },
    });

    // 8. Create log entry
    await tx.log.create({
      data: {
        action: `Deleted stock correction ${existingStockCorrection.shortCode}${
          wasApproved ? ' and reversed stock transactions' : ''
        }`,
        userId,
      },
    });
  });

  return {
    message: `Stock correction deleted successfully${
      wasApproved ? ' and stock transactions reversed' : ''
    }`,
    wasReversed: wasApproved,
    shortCode: existingStockCorrection.shortCode,
  };
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
  getMaterialStockQuantity,
  getMaterialStockQuantityreserve,
};
