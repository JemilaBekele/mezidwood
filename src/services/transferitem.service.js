const httpStatus = require('http-status');
const { subMonths } = require('date-fns');

const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Helper function to check if item is material or product
const isMaterialItem = (item) => {
  return item.materialId && !item.itemId;
};

const isProductItem = (item) => {
  return item.itemId && !item.materialId;
};

// Get Transfer by ID with both material and product items
const getTransferById = async (id) => {
  const transfer = await prisma.transfer.findUnique({
    where: { id },
    include: {
      sourceStore: true,
      sourceShowroom: true,
      destStore: true,
      destShowroom: true,
      createdBy: true,
      updatedBy: true,
      items: {
        include: {
          material: {
            include: {
              materialType: true,
              unitOfMeasure: true,
            },
          },
          item: true,
        },
      },
    },
  });
  return transfer;
};

// Get Transfer by shortCode
const getTransferByShortCode = async (shortCode) => {
  const transfer = await prisma.transfer.findUnique({
    where: { shortCode },
  });
  return transfer;
};

// Get all Transfers
const getAllTransfers = async ({ startDate, endDate, type } = {}) => {
  const whereClause = {};
  const twelveMonthsAgo = subMonths(new Date(), 12);

  // Convert string dates to Date objects if they exist
  const startDateObj = startDate ? new Date(startDate) : undefined;
  const endDateObj = endDate ? new Date(endDate) : undefined;

  // Build the date filter
  if (startDateObj && endDateObj) {
    whereClause.movementDate = {
      gte: startDateObj,
      lte: endDateObj,
    };
  } else if (startDateObj) {
    whereClause.movementDate = {
      gte: startDateObj,
      lte: new Date(),
    };
  } else if (endDateObj) {
    whereClause.movementDate = {
      gte: twelveMonthsAgo,
      lte: endDateObj,
    };
  } else {
    whereClause.movementDate = {
      gte: twelveMonthsAgo,
    };
  }

  const transfers = await prisma.transfer.findMany({
    where: whereClause,
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      sourceStore: true,
      sourceShowroom: true,
      destStore: true,
      destShowroom: true,
      createdBy: true,
      updatedBy: true,
      items: {
        include: {
          material: true,
          item: true,
        },
      },
      _count: {
        select: { items: true },
      },
    },
  });

  // Filter by type if specified
  let filteredTransfers = transfers;
  if (type === 'material') {
    filteredTransfers = transfers.filter((t) =>
      t.items.some((item) => item.ismaterial === true),
    );
  } else if (type === 'product') {
    filteredTransfers = transfers.filter((t) =>
      t.items.some((item) => item.ismaterial === false),
    );
  }

  return {
    transfers: filteredTransfers,
    count: filteredTransfers.length,
  };
};

// Generate Short Code
const generateShortCode = async (type) => {
  const prefix = type === 'material' ? 'MATTRF' : 'PRODRF';
  const year = new Date().getFullYear().toString().slice(-2);
  const month = (new Date().getMonth() + 1).toString().padStart(2, '0');

  const latestTransfer = await prisma.transfer.findFirst({
    where: {
      shortCode: {
        startsWith: `${prefix}${year}${month}`,
      },
    },
    orderBy: {
      shortCode: 'desc',
    },
    select: {
      shortCode: true,
    },
  });

  let sequence = 1;
  if (latestTransfer && latestTransfer.shortCode) {
    const lastCode = latestTransfer.shortCode;
    const lastSequence = parseInt(lastCode.slice(-4), 10);
    if (!Number.isNaN(lastSequence)) {
      sequence = lastSequence + 1;
    }
  }

  const sequenceStr = sequence.toString().padStart(4, '0');
  return `${prefix}${year}${month}${sequenceStr}`;
};

const createTransfer = async (transferBody, userId) => {
  // Parse items if it's a string
  const { items: itemsString, ...restTransferBody } = transferBody;
  const items =
    typeof itemsString === 'string' ? JSON.parse(itemsString) : itemsString;

  // Validate items
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Transfer must have at least one item',
    );
  }

  // Determine transfer type (material or product) based on ismaterial flag
  const hasMaterial = items.some((item) => item.ismaterial === true);
  const hasProduct = items.some((item) => item.ismaterial === false);

  if (hasMaterial && hasProduct) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Transfer cannot contain both materials and products. Please create separate transfers.',
    );
  }

  const transferType = hasMaterial ? 'material' : 'product';
  const shortCode = await generateShortCode(transferType);

  // Validate individual item properties using map and find
  const invalidItems = items
    .map((item, index) => {
      if (transferType === 'material' && !item.materialId) {
        return `Item ${index + 1} is missing materialId`;
      }
      if (transferType === 'product' && !item.itemId) {
        return `Item ${index + 1} is missing itemId`;
      }
      if (item.quantity <= 0) {
        return `Item ${index + 1} has invalid quantity`;
      }
      return null;
    })
    .filter(error => error !== null);

  if (invalidItems.length > 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, invalidItems[0]);
  }

  // Verify all items exist
  if (transferType === 'material') {
    const materialIds = items.map((item) => item.materialId);
    const materials = await prisma.material.findMany({
      where: { id: { in: materialIds } },
      select: { id: true, name: true },
    });
    if (materials.length !== materialIds.length) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'One or more materials not found',
      );
    }
  } else {
    const productIds = items.map((item) => item.itemId);
    const products = await prisma.items.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true },
    });
    if (products.length !== productIds.length) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'One or more products not found',
      );
    }
  }

  // Clean up empty string values
  const cleanedTransferBody = {
    ...restTransferBody,
    shortCode,
    sourceStoreId:
      restTransferBody.sourceStoreId === ''
        ? null
        : restTransferBody.sourceStoreId,
    sourceShowroomId:
      restTransferBody.sourceShowroomId === ''
        ? null
        : restTransferBody.sourceShowroomId,
    destStoreId:
      restTransferBody.destStoreId === '' ? null : restTransferBody.destStoreId,
    destShowroomId:
      restTransferBody.destShowroomId === ''
        ? null
        : restTransferBody.destShowroomId,
  };

  // Validate source and destination
  if (
    cleanedTransferBody.sourceType === 'STORE' &&
    !cleanedTransferBody.sourceStoreId
  ) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Source store ID is required');
  }
  if (
    cleanedTransferBody.sourceType === 'SHOWROOM' &&
    !cleanedTransferBody.sourceShowroomId
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Source showroom ID is required',
    );
  }
  if (
    cleanedTransferBody.destinationType === 'STORE' &&
    !cleanedTransferBody.destStoreId
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Destination store ID is required',
    );
  }
  if (
    cleanedTransferBody.destinationType === 'SHOWROOM' &&
    !cleanedTransferBody.destShowroomId
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Destination showroom ID is required',
    );
  }

  // Check if source and destination are different
  if (
    (cleanedTransferBody.sourceType === 'STORE' &&
      cleanedTransferBody.destinationType === 'STORE' &&
      cleanedTransferBody.sourceStoreId === cleanedTransferBody.destStoreId) ||
    (cleanedTransferBody.sourceType === 'SHOWROOM' &&
      cleanedTransferBody.destinationType === 'SHOWROOM' &&
      cleanedTransferBody.sourceShowroomId ===
        cleanedTransferBody.destShowroomId)
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Source and destination cannot be the same',
    );
  }

  // STOCK CHECK REMOVED - No longer validating source stock availability

  // Create the transfer
  const transfer = await prisma.transfer.create({
    data: {
      ...cleanedTransferBody,
      createdById: userId,
      status: 'PENDING',
      movementDate: new Date(),
      items: {
        create: items.map((item) => ({
          materialId: item.materialId || null,
          itemId: item.itemId || null,
          quantity: item.quantity,
          ismaterial: transferType === 'material',
        })),
      },
    },
    include: {
      items: {
        include: {
          material: {
            include: { materialType: true, unitOfMeasure: true },
          },
          item: {
            include: { category: true, type: true, size: true },
          },
        },
      },
      sourceStore: true,
      sourceShowroom: true,
      destStore: true,
      destShowroom: true,
      createdBy: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  return transfer;
};

// Update transfer function (stock check removed)
const updateTransfer = async (transferId, transferBody, userId) => {
  // Parse items if it's a string
  const { items: itemsString, ...restTransferBody } = transferBody;
  const items =
    typeof itemsString === 'string' ? JSON.parse(itemsString) : itemsString;

  // Validate items
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Transfer must have at least one item',
    );
  }

  // Determine transfer type
  const hasMaterial = items.some((item) => item.ismaterial === true);
  const hasProduct = items.some((item) => item.ismaterial === false);

  if (hasMaterial && hasProduct) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Transfer cannot contain both materials and products',
    );
  }

  const transferType = hasMaterial ? 'material' : 'product';

  // Validate individual item properties using map and filter
  const invalidItems = items
    .map((item, index) => {
      if (transferType === 'material' && !item.materialId) {
        return `Item ${index + 1} is missing materialId`;
      }
      if (transferType === 'product' && !item.itemId) {
        return `Item ${index + 1} is missing itemId`;
      }
      if (item.quantity <= 0) {
        return `Item ${index + 1} has invalid quantity`;
      }
      return null;
    })
    .filter(error => error !== null);

  if (invalidItems.length > 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, invalidItems[0]);
  }

  // Clean up empty string values
  const cleanedTransferBody = {
    ...restTransferBody,
    sourceStoreId:
      restTransferBody.sourceStoreId === ''
        ? null
        : restTransferBody.sourceStoreId,
    sourceShowroomId:
      restTransferBody.sourceShowroomId === ''
        ? null
        : restTransferBody.sourceShowroomId,
    destStoreId:
      restTransferBody.destStoreId === '' ? null : restTransferBody.destStoreId,
    destShowroomId:
      restTransferBody.destShowroomId === ''
        ? null
        : restTransferBody.destShowroomId,
  };

  // STOCK CHECK REMOVED - No longer validating source stock availability for updates

  // Update the transfer
  const transfer = await prisma.transfer.update({
    where: { id: transferId },
    data: {
      ...cleanedTransferBody,
      updatedById: userId,
      items: {
        // Delete existing items and create new ones
        deleteMany: {},
        create: items.map((item) => ({
          materialId: item.materialId || null,
          itemId: item.itemId || null,
          quantity: item.quantity,
          ismaterial: transferType === 'material',
        })),
      },
    },
    include: {
      items: {
        include: {
          material: {
            include: { materialType: true, unitOfMeasure: true },
          },
          item: {
            include: { category: true, type: true, size: true },
          },
        },
      },
      sourceStore: true,
      sourceShowroom: true,
      destStore: true,
      destShowroom: true,
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      updatedBy: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  return transfer;
};

// Delete Transfer
// Delete Transfer
const deleteTransfer = async (id, userId) => {
  const existingTransfer = await getTransferById(id);
  if (!existingTransfer) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Transfer not found');
  }

  await prisma.$transaction(async (tx) => {
    // Check if transfer was completed by checking for ledger entries
    const existingLedgerEntries = await tx.stockLedger.count({
      where: {
        reference: `TRANSFER-${existingTransfer.shortCode}`,
      },
    });

    const existingItemLedgerEntries = await tx.itemStockLedger.count({
      where: {
        reference: `TRANSFER-${existingTransfer.shortCode}`,
      },
    });

    const wasCompleted = existingLedgerEntries > 0 || existingItemLedgerEntries > 0;

    // REVERSE EVERYTHING if completed
    if (wasCompleted) {
      await Promise.all(
        existingTransfer.items.map(async (item) => {
          if (item.ismaterial) {
            // Handle material reversal
            // 1. Return stock to source
            if (existingTransfer.sourceType === 'STORE' && existingTransfer.sourceStoreId) {
              // Add stock back to source store
              const sourceStock = await tx.inventoryStock.findFirst({
                where: {
                  materialId: item.materialId,
                  storeId: existingTransfer.sourceStoreId,
                },
              });

              if (sourceStock) {
                await tx.inventoryStock.update({
                  where: { id: sourceStock.id },
                  data: {
                    quantity: {
                      increment: item.quantity,
                    },
                    status: 'Available',
                    lastUpdated: new Date(),
                  },
                });
              } else {
                await tx.inventoryStock.create({
                  data: {
                    materialId: item.materialId,
                    storeId: existingTransfer.sourceStoreId,
                    quantity: item.quantity,
                    status: 'Available',
                    lastUpdated: new Date(),
                  },
                });
              }

              // Create reversal ledger entry for source
              await tx.stockLedger.create({
                data: {
                  materialId: item.materialId,
                  storeId: existingTransfer.sourceStoreId,
                  movementType: 'IN',
                  quantity: item.quantity,
                  reference: `TRANSFER-REVERSAL-${existingTransfer.shortCode}`,
                  userId,
                  notes: `Transfer reversal - stock returned to source`,
                  movementDate: new Date(),
                },
              });
            } else if (existingTransfer.sourceType === 'SHOWROOM' && existingTransfer.sourceShowroomId) {
              // Add stock back to source showroom
              const sourceStock = await tx.inventoryStock.findFirst({
                where: {
                  materialId: item.materialId,
                  showroomId: existingTransfer.sourceShowroomId,
                },
              });

              if (sourceStock) {
                await tx.inventoryStock.update({
                  where: { id: sourceStock.id },
                  data: {
                    quantity: {
                      increment: item.quantity,
                    },
                    status: 'Available',
                    lastUpdated: new Date(),
                  },
                });
              } else {
                await tx.inventoryStock.create({
                  data: {
                    materialId: item.materialId,
                    showroomId: existingTransfer.sourceShowroomId,
                    quantity: item.quantity,
                    status: 'Available',
                    lastUpdated: new Date(),
                  },
                });
              }

              await tx.stockLedger.create({
                data: {
                  materialId: item.materialId,
                  showroomId: existingTransfer.sourceShowroomId,
                  movementType: 'IN',
                  quantity: item.quantity,
                  reference: `TRANSFER-REVERSAL-${existingTransfer.shortCode}`,
                  userId,
                  notes: `Transfer reversal - stock returned to source`,
                  movementDate: new Date(),
                },
              });
            }

            // 2. Remove stock from destination
            if (existingTransfer.destinationType === 'STORE' && existingTransfer.destStoreId) {
              const destStock = await tx.inventoryStock.findFirst({
                where: {
                  materialId: item.materialId,
                  storeId: existingTransfer.destStoreId,
                },
              });

              if (destStock) {
                if (destStock.quantity <= item.quantity) {
                  // Delete inventory stock if quantity becomes zero or negative
                  await tx.inventoryStock.delete({
                    where: { id: destStock.id },
                  });
                } else {
                  await tx.inventoryStock.update({
                    where: { id: destStock.id },
                    data: {
                      quantity: {
                        decrement: item.quantity,
                      },
                      lastUpdated: new Date(),
                    },
                  });
                }
              }

              await tx.stockLedger.create({
                data: {
                  materialId: item.materialId,
                  storeId: existingTransfer.destStoreId,
                  movementType: 'OUT',
                  quantity: item.quantity,
                  reference: `TRANSFER-REVERSAL-${existingTransfer.shortCode}`,
                  userId,
                  notes: `Transfer reversal - stock removed from destination`,
                  movementDate: new Date(),
                },
              });
            } else if (existingTransfer.destinationType === 'SHOWROOM' && existingTransfer.destShowroomId) {
              const destStock = await tx.inventoryStock.findFirst({
                where: {
                  materialId: item.materialId,
                  showroomId: existingTransfer.destShowroomId,
                },
              });

              if (destStock) {
                if (destStock.quantity <= item.quantity) {
                  await tx.inventoryStock.delete({
                    where: { id: destStock.id },
                  });
                } else {
                  await tx.inventoryStock.update({
                    where: { id: destStock.id },
                    data: {
                      quantity: {
                        decrement: item.quantity,
                      },
                      lastUpdated: new Date(),
                    },
                  });
                }
              }

              await tx.stockLedger.create({
                data: {
                  materialId: item.materialId,
                  showroomId: existingTransfer.destShowroomId,
                  movementType: 'OUT',
                  quantity: item.quantity,
                  reference: `TRANSFER-REVERSAL-${existingTransfer.shortCode}`,
                  userId,
                  notes: `Transfer reversal - stock removed from destination`,
                  movementDate: new Date(),
                },
              });
            }

            // 3. Delete original stock ledger entries for this item
            await tx.stockLedger.deleteMany({
              where: {
                reference: `TRANSFER-${existingTransfer.shortCode}`,
                movementType: 'IN',
                materialId: item.materialId,
                OR: [
                  { storeId: existingTransfer.destStoreId },
                  { showroomId: existingTransfer.destShowroomId },
                ],
              },
            });

            await tx.stockLedger.deleteMany({
              where: {
                reference: `TRANSFER-${existingTransfer.shortCode}`,
                movementType: 'OUT',
                materialId: item.materialId,
                OR: [
                  { storeId: existingTransfer.sourceStoreId },
                  { showroomId: existingTransfer.sourceShowroomId },
                ],
              },
            });

          } else {
            // Handle product/item reversal
            // 1. Return stock to source
            if (existingTransfer.sourceType === 'STORE' && existingTransfer.sourceStoreId) {
              const sourceStock = await tx.itemStock.findFirst({
                where: {
                  itemId: item.itemId,
                  storeId: existingTransfer.sourceStoreId,
                },
              });

              if (sourceStock) {
                await tx.itemStock.update({
                  where: { id: sourceStock.id },
                  data: {
                    quantity: {
                      increment: item.quantity,
                    },
                  },
                });
              } else {
                await tx.itemStock.create({
                  data: {
                    itemId: item.itemId,
                    storeId: existingTransfer.sourceStoreId,
                    quantity: item.quantity,
                  },
                });
              }

              await tx.itemStockLedger.create({
                data: {
                  itemId: item.itemId,
                  storeId: existingTransfer.sourceStoreId,
                  movementType: 'IN',
                  quantity: item.quantity,
                  reference: `TRANSFER-REVERSAL-${existingTransfer.shortCode}`,
                  userId,
                  notes: `Transfer reversal - stock returned to source`,
                },
              });
            } else if (existingTransfer.sourceType === 'SHOWROOM' && existingTransfer.sourceShowroomId) {
              const sourceStock = await tx.itemStock.findFirst({
                where: {
                  itemId: item.itemId,
                  showroomId: existingTransfer.sourceShowroomId,
                },
              });

              if (sourceStock) {
                await tx.itemStock.update({
                  where: { id: sourceStock.id },
                  data: {
                    quantity: {
                      increment: item.quantity,
                    },
                  },
                });
              } else {
                await tx.itemStock.create({
                  data: {
                    itemId: item.itemId,
                    showroomId: existingTransfer.sourceShowroomId,
                    quantity: item.quantity,
                  },
                });
              }

              await tx.itemStockLedger.create({
                data: {
                  itemId: item.itemId,
                  showroomId: existingTransfer.sourceShowroomId,
                  movementType: 'IN',
                  quantity: item.quantity,
                  reference: `TRANSFER-REVERSAL-${existingTransfer.shortCode}`,
                  userId,
                  notes: `Transfer reversal - stock returned to source`,
                },
              });
            }

            // 2. Remove stock from destination
            if (existingTransfer.destinationType === 'STORE' && existingTransfer.destStoreId) {
              const destStock = await tx.itemStock.findFirst({
                where: {
                  itemId: item.itemId,
                  storeId: existingTransfer.destStoreId,
                },
              });

              if (destStock) {
                if (destStock.quantity <= item.quantity) {
                  await tx.itemStock.delete({
                    where: { id: destStock.id },
                  });
                } else {
                  await tx.itemStock.update({
                    where: { id: destStock.id },
                    data: {
                      quantity: {
                        decrement: item.quantity,
                      },
                    },
                  });
                }
              }

              await tx.itemStockLedger.create({
                data: {
                  itemId: item.itemId,
                  storeId: existingTransfer.destStoreId,
                  movementType: 'OUT',
                  quantity: item.quantity,
                  reference: `TRANSFER-REVERSAL-${existingTransfer.shortCode}`,
                  userId,
                  notes: `Transfer reversal - stock removed from destination`,
                },
              });
            } else if (existingTransfer.destinationType === 'SHOWROOM' && existingTransfer.destShowroomId) {
              const destStock = await tx.itemStock.findFirst({
                where: {
                  itemId: item.itemId,
                  showroomId: existingTransfer.destShowroomId,
                },
              });

              if (destStock) {
                if (destStock.quantity <= item.quantity) {
                  await tx.itemStock.delete({
                    where: { id: destStock.id },
                  });
                } else {
                  await tx.itemStock.update({
                    where: { id: destStock.id },
                    data: {
                      quantity: {
                        decrement: item.quantity,
                      },
                    },
                  });
                }
              }

              await tx.itemStockLedger.create({
                data: {
                  itemId: item.itemId,
                  showroomId: existingTransfer.destShowroomId,
                  movementType: 'OUT',
                  quantity: item.quantity,
                  reference: `TRANSFER-REVERSAL-${existingTransfer.shortCode}`,
                  userId,
                  notes: `Transfer reversal - stock removed from destination`,
                },
              });
            }

            // 3. Delete original item stock ledger entries for this item
            await tx.itemStockLedger.deleteMany({
              where: {
                reference: `TRANSFER-${existingTransfer.shortCode}`,
                movementType: 'IN',
                itemId: item.itemId,
                OR: [
                  { storeId: existingTransfer.destStoreId },
                  { showroomId: existingTransfer.destShowroomId },
                ],
              },
            });

            await tx.itemStockLedger.deleteMany({
              where: {
                reference: `TRANSFER-${existingTransfer.shortCode}`,
                movementType: 'OUT',
                itemId: item.itemId,
                OR: [
                  { storeId: existingTransfer.sourceStoreId },
                  { showroomId: existingTransfer.sourceShowroomId },
                ],
              },
            });
          }
        }),
      );
    }

    // 4. Delete transfer items
    await tx.transferItem.deleteMany({
      where: { transferId: id },
    });

    // 5. Delete transfer record
    await tx.transfer.delete({
      where: { id },
    });
  });

  return {
    message: 'Transfer deleted successfully',
    wasReversed: true,
    shortCode: existingTransfer.shortCode,
  };
};

// Complete Transfer
const completeTransfer = async (transferId, userId) => {
  const transfer = await getTransferById(transferId);

  if (!transfer) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Transfer not found');
  }

  if (transfer.status !== 'PENDING') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Transfer is already ${transfer.status.toLowerCase()}`,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // Process all transfer items in parallel using map
    await Promise.all(
      transfer.items.map(async (item) => {
        console.log(
          `Processing item: ${item.id}, isMaterial: ${item.ismaterial}, quantity: ${item.quantity}`,
        );

        if (item.ismaterial) {
          // Handle Material Stock Movement
          // Remove from source
          if (transfer.sourceType === 'STORE' && transfer.sourceStoreId) {
            const sourceStock = await tx.inventoryStock.findFirst({
              where: {
                materialId: item.materialId,
                storeId: transfer.sourceStoreId,
              },
            });

            console.log(`Source stock found:`, sourceStock);

            if (!sourceStock || sourceStock.quantity < item.quantity) {
              throw new ApiError(
                httpStatus.BAD_REQUEST,
                `Insufficient stock for material ${
                  item.material?.name || item.materialId
                } at source. Available: ${
                  sourceStock?.quantity || 0
                }, Required: ${item.quantity}`,
              );
            }

            // CORRECTED: Use decrement directly as the value
            await tx.inventoryStock.update({
              where: { id: sourceStock.id },
              data: {
                quantity: {
                  decrement: item.quantity,
                },
                lastUpdated: new Date(),
                // Only update status if quantity becomes zero
                ...(sourceStock.quantity - item.quantity === 0 && {
                  status: 'OutOfStock',
                }),
              },
            });

            await tx.stockLedger.create({
              data: {
                materialId: item.materialId,
                storeId: transfer.sourceStoreId,
                movementType: 'OUT',
                quantity: item.quantity,
                reference: `TRANSFER-${transfer.shortCode}`,
                userId,
                notes: `Transfer out to ${transfer.destinationType.toLowerCase()}`,
                movementDate: new Date(),
              },
            });
          } else if (
            transfer.sourceType === 'SHOWROOM' &&
            transfer.sourceShowroomId
          ) {
            const sourceStock = await tx.inventoryStock.findFirst({
              where: {
                materialId: item.materialId,
                showroomId: transfer.sourceShowroomId,
              },
            });

            console.log(`Source stock found:`, sourceStock);

            if (!sourceStock || sourceStock.quantity < item.quantity) {
              throw new ApiError(
                httpStatus.BAD_REQUEST,
                `Insufficient stock for material ${
                  item.material?.name || item.materialId
                } at source. Available: ${
                  sourceStock?.quantity || 0
                }, Required: ${item.quantity}`,
              );
            }

            // CORRECTED: Use decrement directly as the value
            await tx.inventoryStock.update({
              where: { id: sourceStock.id },
              data: {
                quantity: {
                  decrement: item.quantity,
                },
                lastUpdated: new Date(),
                ...(sourceStock.quantity - item.quantity === 0 && {
                  status: 'OutOfStock',
                }),
              },
            });

            await tx.stockLedger.create({
              data: {
                materialId: item.materialId,
                showroomId: transfer.sourceShowroomId,
                movementType: 'OUT',
                quantity: item.quantity,
                reference: `TRANSFER-${transfer.shortCode}`,
                userId,
                notes: `Transfer out to ${transfer.destinationType.toLowerCase()}`,
                movementDate: new Date(),
              },
            });
          }

          // Add to destination
          if (transfer.destinationType === 'STORE' && transfer.destStoreId) {
            const destStock = await tx.inventoryStock.findFirst({
              where: {
                materialId: item.materialId,
                storeId: transfer.destStoreId,
              },
            });

            console.log(`Destination stock found:`, destStock);

            if (destStock) {
              // CORRECTED: Use increment directly as the value
              await tx.inventoryStock.update({
                where: { id: destStock.id },
                data: {
                  quantity: {
                    increment: item.quantity,
                  },
                  lastUpdated: new Date(),
                  status: 'Available',
                },
              });
            } else {
              await tx.inventoryStock.create({
                data: {
                  materialId: item.materialId,
                  storeId: transfer.destStoreId,
                  quantity: item.quantity,
                  status: 'Available',
                  lastUpdated: new Date(),
                },
              });
            }

            await tx.stockLedger.create({
              data: {
                materialId: item.materialId,
                storeId: transfer.destStoreId,
                movementType: 'IN',
                quantity: item.quantity,
                reference: `TRANSFER-${transfer.shortCode}`,
                userId,
                notes: `Transfer in from ${transfer.sourceType.toLowerCase()}`,
                movementDate: new Date(),
              },
            });
          } else if (
            transfer.destinationType === 'SHOWROOM' &&
            transfer.destShowroomId
          ) {
            const destStock = await tx.inventoryStock.findFirst({
              where: {
                materialId: item.materialId,
                showroomId: transfer.destShowroomId,
              },
            });

            console.log(`Destination stock found:`, destStock);

            if (destStock) {
              // CORRECTED: Use increment directly as the value
              await tx.inventoryStock.update({
                where: { id: destStock.id },
                data: {
                  quantity: {
                    increment: item.quantity,
                  },
                  lastUpdated: new Date(),
                  status: 'Available',
                },
              });
            } else {
              await tx.inventoryStock.create({
                data: {
                  materialId: item.materialId,
                  showroomId: transfer.destShowroomId,
                  quantity: item.quantity,
                  status: 'Available',
                  lastUpdated: new Date(),
                },
              });
            }

            await tx.stockLedger.create({
              data: {
                materialId: item.materialId,
                showroomId: transfer.destShowroomId,
                movementType: 'IN',
                quantity: item.quantity,
                reference: `TRANSFER-${transfer.shortCode}`,
                userId,
                notes: `Transfer in from ${transfer.sourceType.toLowerCase()}`,
                movementDate: new Date(),
              },
            });
          }
        } else {
          // Handle Product/Item Stock Movement
          // Remove from source
          if (transfer.sourceType === 'STORE' && transfer.sourceStoreId) {
            const sourceStock = await tx.itemStock.findFirst({
              where: {
                itemId: item.itemId,
                storeId: transfer.sourceStoreId,
              },
            });

            console.log(`Source item stock found:`, sourceStock);

            if (!sourceStock || sourceStock.quantity < item.quantity) {
              throw new ApiError(
                httpStatus.BAD_REQUEST,
                `Insufficient stock for product ${
                  item.item?.name || item.itemId
                } at source. Available: ${
                  sourceStock?.quantity || 0
                }, Required: ${item.quantity}`,
              );
            }

            // CORRECTED: Use decrement directly as the value
            await tx.itemStock.update({
              where: { id: sourceStock.id },
              data: {
                quantity: {
                  decrement: item.quantity,
                },
              },
            });

            await tx.itemStockLedger.create({
              data: {
                itemId: item.itemId,
                storeId: transfer.sourceStoreId,
                movementType: 'OUT',
                quantity: item.quantity,
                reference: `TRANSFER-${transfer.shortCode}`,
                userId,
                notes: `Transfer out to ${transfer.destinationType.toLowerCase()}`,
              },
            });
          } else if (
            transfer.sourceType === 'SHOWROOM' &&
            transfer.sourceShowroomId
          ) {
            const sourceStock = await tx.itemStock.findFirst({
              where: {
                itemId: item.itemId,
                showroomId: transfer.sourceShowroomId,
              },
            });

            console.log(`Source item stock found:`, sourceStock);

            if (!sourceStock || sourceStock.quantity < item.quantity) {
              throw new ApiError(
                httpStatus.BAD_REQUEST,
                `Insufficient stock for product ${
                  item.item?.name || item.itemId
                } at source. Available: ${
                  sourceStock?.quantity || 0
                }, Required: ${item.quantity}`,
              );
            }

            // CORRECTED: Use decrement directly as the value
            await tx.itemStock.update({
              where: { id: sourceStock.id },
              data: {
                quantity: {
                  decrement: item.quantity,
                },
              },
            });

            await tx.itemStockLedger.create({
              data: {
                itemId: item.itemId,
                showroomId: transfer.sourceShowroomId,
                movementType: 'OUT',
                quantity: item.quantity,
                reference: `TRANSFER-${transfer.shortCode}`,
                userId,
                notes: `Transfer out to ${transfer.destinationType.toLowerCase()}`,
              },
            });
          }

          // Add to destination
          if (transfer.destinationType === 'STORE' && transfer.destStoreId) {
            const destStock = await tx.itemStock.findFirst({
              where: {
                itemId: item.itemId,
                storeId: transfer.destStoreId,
              },
            });

            console.log(`Destination item stock found:`, destStock);

            if (destStock) {
              // CORRECTED: Use increment directly as the value
              await tx.itemStock.update({
                where: { id: destStock.id },
                data: {
                  quantity: {
                    increment: item.quantity,
                  },
                },
              });
            } else {
              await tx.itemStock.create({
                data: {
                  itemId: item.itemId,
                  storeId: transfer.destStoreId,
                  quantity: item.quantity,
                },
              });
            }

            await tx.itemStockLedger.create({
              data: {
                itemId: item.itemId,
                storeId: transfer.destStoreId,
                movementType: 'IN',
                quantity: item.quantity,
                reference: `TRANSFER-${transfer.shortCode}`,
                userId,
                notes: `Transfer in from ${transfer.sourceType.toLowerCase()}`,
              },
            });
          } else if (
            transfer.destinationType === 'SHOWROOM' &&
            transfer.destShowroomId
          ) {
            const destStock = await tx.itemStock.findFirst({
              where: {
                itemId: item.itemId,
                showroomId: transfer.destShowroomId,
              },
            });

            console.log(`Destination item stock found:`, destStock);

            if (destStock) {
              // CORRECTED: Use increment directly as the value
              await tx.itemStock.update({
                where: { id: destStock.id },
                data: {
                  quantity: {
                    increment: item.quantity,
                  },
                },
              });
            } else {
              await tx.itemStock.create({
                data: {
                  itemId: item.itemId,
                  showroomId: transfer.destShowroomId,
                  quantity: item.quantity,
                },
              });
            }

            await tx.itemStockLedger.create({
              data: {
                itemId: item.itemId,
                showroomId: transfer.destShowroomId,
                movementType: 'IN',
                quantity: item.quantity,
                reference: `TRANSFER-${transfer.shortCode}`,
                userId,
                notes: `Transfer in from ${transfer.sourceType.toLowerCase()}`,
              },
            });
          }
        }

        console.log(`Successfully processed item: ${item.id}`);
      }),
    );

    // Update transfer status to COMPLETED
    const updatedTransfer = await tx.transfer.update({
      where: { id: transferId },
      data: {
        status: 'COMPLETED',
        updatedById: userId,
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

    return updatedTransfer;
  });

  return result;
};

// Cancel Transfer
const cancelTransfer = async (transferId, userId) => {
  const transfer = await getTransferById(transferId);

  if (!transfer) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Transfer not found');
  }

  if (transfer.status !== 'PENDING') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot cancel ${transfer.status.toLowerCase()} transfer`,
    );
  }

  const updatedTransfer = await prisma.transfer.update({
    where: { id: transferId },
    data: {
      status: 'CANCELLED',
      updatedById: userId,
    },
  });

  return updatedTransfer;
};

module.exports = {
  getTransferById,
  getTransferByShortCode,
  getAllTransfers,
  createTransfer,
  updateTransfer,
  deleteTransfer,
  completeTransfer,
  cancelTransfer,
};
