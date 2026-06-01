const httpStatus = require('http-status');
const { subMonths } = require('date-fns');

const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Get Transfer by ID
const getTransferById = async (id) => {
  const transfer = await prisma.transfer.findUnique({
    where: { id },
    include: {
      sourceStore: true,
      sourceShop: true,
      destStore: true,
      destShop: true,
      createdBy: true,
      updatedBy: true,
      items: {
        include: {
          product: true,
          unitOfMeasure: true, // ✅ Added unit of measure
        },
      },
    },
  });
  return transfer;
};
// Get product batch info by transfer ID

// Get Transfer by reference
const getTransferByReference = async (reference) => {
  const transfer = await prisma.transfer.findFirst({
    where: { reference },
  });
  return transfer;
};

// Get all Transfers
const getAllTransfers = async ({ startDate, endDate } = {}) => {
  const whereClause = {};
  const threeMonthsAgo = subMonths(new Date(), 12); // Default time range

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
      gte: threeMonthsAgo,
      lte: endDateObj,
    };
  } else {
    whereClause.movementDate = {
      gte: threeMonthsAgo,
    };
  }

  const transfers = await prisma.transfer.findMany({
    where: whereClause,
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      sourceStore: true,
      sourceShop: true,
      destStore: true,
      destShop: true,
      createdBy: true,
      updatedBy: true,
      _count: {
        select: { items: true },
      },
    },
  });

  return {
    transfers,
    count: transfers.length,
  };
};

// Create Transfer
const generateShortCode = async () => {
  const prefix = 'TRF';
  const year = new Date().getFullYear().toString().slice(-2);
  const month = (new Date().getMonth() + 1).toString().padStart(2, '0');

  // Find the latest transfer for this month/year to get the sequence number
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

// Create Transfer
const createTransfer = async (transferBody, userId) => {
  // Generate short code first
  const shortCode = await generateShortCode();

  // Check if reference already exists
  if (
    transferBody.reference &&
    (await getTransferByReference(transferBody.reference))
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Transfer reference already taken',
    );
  }

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

  // Validate individual item properties
  items.forEach((item, index) => {
    if (!item.productId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} is missing required field (productId)`,
      );
    }
    if (item.quantity <= 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid quantity`,
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

  // Get all product IDs to fetch their unit of measures
  const productIds = items.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: {
      id: {
        in: productIds,
      },
    },
    select: {
      id: true,
      unitOfMeasureId: true,
    },
  });

  // Create a map of productId to unitOfMeasureId
  const productUnitMap = {};
  products.forEach((product) => {
    productUnitMap[product.id] = product.unitOfMeasureId;
  });

  // Check if all products were found
  items.forEach((item, index) => {
    if (!productUnitMap[item.productId]) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${
          index + 1
        }: Product not found or has no unit of measure defined`,
      );
    }
  });

  // Clean up empty string values
  const cleanedTransferBody = {
    ...restTransferBody,
    shortCode, // Add the generated short code
    sourceStoreId:
      restTransferBody.sourceStoreId === ''
        ? null
        : restTransferBody.sourceStoreId,
    sourceShopId:
      restTransferBody.sourceShopId === ''
        ? null
        : restTransferBody.sourceShopId,
    destStoreId:
      restTransferBody.destStoreId === '' ? null : restTransferBody.destStoreId,
    destShopId:
      restTransferBody.destShopId === '' ? null : restTransferBody.destShopId,
  };

  // Validate source and destination
  if (
    cleanedTransferBody.sourceType === 'STORE' &&
    !cleanedTransferBody.sourceStoreId
  ) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Source store ID is required');
  }

  if (
    cleanedTransferBody.sourceType === 'SHOP' &&
    !cleanedTransferBody.sourceShopId
  ) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Source shop ID is required');
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
    cleanedTransferBody.destinationType === 'SHOP' &&
    !cleanedTransferBody.destShopId
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Destination shop ID is required',
    );
  }

  // Check if source and destination are different
  if (
    (cleanedTransferBody.sourceType === 'STORE' &&
      cleanedTransferBody.destinationType === 'STORE' &&
      cleanedTransferBody.sourceStoreId === cleanedTransferBody.destStoreId) ||
    (cleanedTransferBody.sourceType === 'SHOP' &&
      cleanedTransferBody.destinationType === 'SHOP' &&
      cleanedTransferBody.sourceShopId === cleanedTransferBody.destShopId)
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Source and destination cannot be the same',
    );
  }

  // Create the transfer
  const transfer = await prisma.transfer.create({
    data: {
      ...cleanedTransferBody,
      createdById: userId,
      items: {
        create: items.map((item) => ({
          productId: item.productId,
          unitOfMeasureId: productUnitMap[item.productId],
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
          product: true,
        },
      },
    },
  });

  return transfer;
};

// Update Transfer
const updateTransfer = async (transferId, transferBody, userId) => {
  // Check if transfer exists
  const existingTransfer = await getTransferById(transferId);
  if (!existingTransfer) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Transfer not found');
  }
  if (existingTransfer.createdById !== userId) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'Only the creator can update this transfer',
    );
  }
  // Cannot update completed or cancelled transfers
  if (existingTransfer.status !== 'PENDING') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot update ${existingTransfer.status.toLowerCase()} transfer`,
    );
  }

  // Check if reference already exists (excluding current transfer)
  if (
    transferBody.reference &&
    transferBody.reference !== existingTransfer.reference
  ) {
    if (await getTransferByReference(transferBody.reference)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Transfer reference already taken',
      );
    }
  }

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

  // Validate individual item properties
  items.forEach((item, index) => {
    if (!item.productId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} is missing required field (productId)`,
      );
    }
    if (item.quantity <= 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid quantity`,
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

  // Get all product IDs to fetch their unit of measures
  const productIds = items.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: {
      id: {
        in: productIds,
      },
    },
    select: {
      id: true,
      unitOfMeasureId: true,
    },
  });

  // Create a map of productId to unitOfMeasureId
  const productUnitMap = {};
  products.forEach((product) => {
    productUnitMap[product.id] = product.unitOfMeasureId;
  });

  // Check if all products were found
  items.forEach((item, index) => {
    if (!productUnitMap[item.productId]) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${
          index + 1
        }: Product not found or has no unit of measure defined`,
      );
    }
  });

  // Clean up empty string values
  const cleanedTransferBody = {
    ...restTransferBody,
    sourceStoreId:
      restTransferBody.sourceStoreId === ''
        ? null
        : restTransferBody.sourceStoreId,
    sourceShopId:
      restTransferBody.sourceShopId === ''
        ? null
        : restTransferBody.sourceShopId,
    destStoreId:
      restTransferBody.destStoreId === '' ? null : restTransferBody.destStoreId,
    destShopId:
      restTransferBody.destShopId === '' ? null : restTransferBody.destShopId,
  };

  // Validate source and destination
  if (
    cleanedTransferBody.sourceType === 'STORE' &&
    !cleanedTransferBody.sourceStoreId
  ) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Source store ID is required');
  }

  if (
    cleanedTransferBody.sourceType === 'SHOP' &&
    !cleanedTransferBody.sourceShopId
  ) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Source shop ID is required');
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
    cleanedTransferBody.destinationType === 'SHOP' &&
    !cleanedTransferBody.destShopId
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Destination shop ID is required',
    );
  }

  // Check if source and destination are different
  if (
    (cleanedTransferBody.sourceType === 'STORE' &&
      cleanedTransferBody.destinationType === 'STORE' &&
      cleanedTransferBody.sourceStoreId === cleanedTransferBody.destStoreId) ||
    (cleanedTransferBody.sourceType === 'SHOP' &&
      cleanedTransferBody.destinationType === 'SHOP' &&
      cleanedTransferBody.sourceShopId === cleanedTransferBody.destShopId)
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Source and destination cannot be the same',
    );
  }

  // Update the transfer inside a transaction
  const result = await prisma.$transaction(async (tx) => {
    // Delete all existing items
    await tx.transferItem.deleteMany({
      where: { transferId },
    });

    // Update transfer with cleaned body and new items
    const transfer = await tx.transfer.update({
      where: { id: transferId },
      data: {
        ...cleanedTransferBody,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            unitOfMeasureId: productUnitMap[item.productId],
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
            product: true,
          },
        },
      },
    });

    return transfer;
  });

  return result;
};

const deleteTransfer = async (id, userId) => {
  const existingTransfer = await getTransferById(id);
  if (!existingTransfer) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Transfer not found');
  }

  const result = await prisma.$transaction(async (tx) => {
    // Check if transfer is completed (has stock ledger entries)
    const ledgerEntries = await tx.stockLedger.findMany({
      where: {
        reference: `TRANSFER-${existingTransfer.shortCode}`,
      },
    });

    const isCompleted = ledgerEntries.length > 0;

    if (isCompleted) {
      // Reverse all stock operations for completed transfer
      await Promise.all(
        existingTransfer.items.map(async (item, index) => {
          const operations = [];
          const sourceInvoiceNo = `${existingTransfer.shortCode}-OUT-${index}`;
          const destinationInvoiceNo = `${existingTransfer.shortCode}-IN-${index}`;

          // Reverse source operations (add back stock to source)
          if (
            existingTransfer.sourceType === 'STORE' &&
            existingTransfer.sourceStoreId
          ) {
            operations.push(
              tx.storeStock.update({
                where: {
                  storeId_productId: {
                    storeId: existingTransfer.sourceStoreId,
                    productId: item.productId,
                  },
                },
                data: {
                  quantity: { increment: item.quantity },
                },
              }),
              tx.stockLedger.create({
                data: {
                  productId: item.productId,
                  storeId: existingTransfer.sourceStoreId,
                  invoiceNo: `REV-${sourceInvoiceNo}`,
                  movementType: 'IN',
                  quantity: item.quantity,
                  unitOfMeasureId: item.unitOfMeasureId,
                  reference: `TRANSFER-REVERSAL-${existingTransfer.shortCode}`,
                  userId,
                  notes: `Transfer reversal - stock returned from ${existingTransfer.destinationType.toLowerCase()}`,
                  movementDate: new Date(),
                },
              }),
            );
          } else if (
            existingTransfer.sourceType === 'SHOP' &&
            existingTransfer.sourceShopId
          ) {
            operations.push(
              tx.shopStock.update({
                where: {
                  shopId_productId: {
                    shopId: existingTransfer.sourceShopId,
                    productId: item.productId,
                  },
                },
                data: {
                  quantity: { increment: item.quantity },
                },
              }),
              tx.stockLedger.create({
                data: {
                  productId: item.productId,
                  invoiceNo: `REV-${sourceInvoiceNo}`,
                  shopId: existingTransfer.sourceShopId,
                  movementType: 'IN',
                  quantity: item.quantity,
                  unitOfMeasureId: item.unitOfMeasureId,
                  reference: `TRANSFER-REVERSAL-${existingTransfer.shortCode}`,
                  userId,
                  notes: `Transfer reversal - stock returned from ${existingTransfer.destinationType.toLowerCase()}`,
                  movementDate: new Date(),
                },
              }),
            );
          }

          // Reverse destination operations (remove stock from destination)
          if (
            existingTransfer.destinationType === 'STORE' &&
            existingTransfer.destStoreId
          ) {
            const existingStoreStock = await tx.storeStock.findUnique({
              where: {
                storeId_productId: {
                  storeId: existingTransfer.destStoreId,
                  productId: item.productId,
                },
              },
            });

            if (existingStoreStock) {
              const newQuantity = existingStoreStock.quantity - item.quantity;

              if (newQuantity <= 0) {
                // Delete if quantity becomes 0 or negative
                operations.push(
                  tx.storeStock.delete({
                    where: {
                      storeId_productId: {
                        storeId: existingTransfer.destStoreId,
                        productId: item.productId,
                      },
                    },
                  }),
                );
              } else {
                // Update quantity
                operations.push(
                  tx.storeStock.update({
                    where: {
                      storeId_productId: {
                        storeId: existingTransfer.destStoreId,
                        productId: item.productId,
                      },
                    },
                    data: {
                      quantity: { decrement: item.quantity },
                    },
                  }),
                );
              }
            }

            operations.push(
              tx.stockLedger.create({
                data: {
                  productId: item.productId,
                  invoiceNo: `REV-${destinationInvoiceNo}`,
                  storeId: existingTransfer.destStoreId,
                  movementType: 'OUT',
                  quantity: item.quantity,
                  unitOfMeasureId: item.unitOfMeasureId,
                  reference: `TRANSFER-REVERSAL-${existingTransfer.shortCode}`,
                  userId,
                  notes: `Transfer reversal - stock returned to ${existingTransfer.sourceType.toLowerCase()}`,
                  movementDate: new Date(),
                },
              }),
            );
          } else if (
            existingTransfer.destinationType === 'SHOP' &&
            existingTransfer.destShopId
          ) {
            const existingShopStock = await tx.shopStock.findUnique({
              where: {
                shopId_productId: {
                  shopId: existingTransfer.destShopId,
                  productId: item.productId,
                },
              },
            });

            if (existingShopStock) {
              const newQuantity = existingShopStock.quantity - item.quantity;

              if (newQuantity <= 0) {
                // Delete if quantity becomes 0 or negative
                operations.push(
                  tx.shopStock.delete({
                    where: {
                      shopId_productId: {
                        shopId: existingTransfer.destShopId,
                        productId: item.productId,
                      },
                    },
                  }),
                );
              } else {
                // Update quantity
                operations.push(
                  tx.shopStock.update({
                    where: {
                      shopId_productId: {
                        shopId: existingTransfer.destShopId,
                        productId: item.productId,
                      },
                    },
                    data: {
                      quantity: { decrement: item.quantity },
                    },
                  }),
                );
              }
            }

            operations.push(
              tx.stockLedger.create({
                data: {
                  productId: item.productId,
                  invoiceNo: `REV-${destinationInvoiceNo}`,
                  shopId: existingTransfer.destShopId,
                  movementType: 'OUT',
                  quantity: item.quantity,
                  unitOfMeasureId: item.unitOfMeasureId,
                  reference: `TRANSFER-REVERSAL-${existingTransfer.shortCode}`,
                  userId,
                  notes: `Transfer reversal - stock returned to ${existingTransfer.sourceType.toLowerCase()}`,
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
          reference: `TRANSFER-${existingTransfer.shortCode}`,
        },
      });
    }

    // Delete all transfer items
    await tx.transferItem.deleteMany({
      where: { transferId: id },
    });

    // Delete the transfer
    await tx.transfer.delete({
      where: { id },
    });

    // Create log entry
    await tx.log.create({
      data: {
        action: `Deleted transfer ${existingTransfer.shortCode}${
          isCompleted ? ' and reversed stock transactions' : ''
        }`,
        userId,
      },
    });

    return {
      message: `Transfer deleted successfully${
        isCompleted ? ' and stock transactions reversed' : ''
      }`,
      stockReversed: isCompleted,
    };
  });

  return result;
};
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
    // Get all unit of measures for the transfer items
    const unitOfMeasureIds = transfer.items.map((item) => item.unitOfMeasureId);
    const unitOfMeasures = await tx.unitOfMeasure.findMany({
      where: { id: { in: unitOfMeasureIds } },
    });

    const unitOfMeasureMap = unitOfMeasures.reduce((acc, uom) => {
      acc[uom.id] = uom;
      return acc;
    }, {});

    // Get base units for all products to check if we need conversion
    const productIds = transfer.items.map((item) => item.productId);
    const baseUnits = await tx.unitOfMeasure.findMany({
      where: {
        base: true,
        products: {
          some: {
            id: { in: productIds },
          },
        },
      },
    });

    const baseUnitMap = {};
    baseUnits.forEach((unit) => {
      productIds.forEach((productId) => {
        baseUnitMap[productId] = unit;
      });
    });

    // FIRST: Validate all stock availability before making any changes
    for (const item of transfer.items) {
      const quantityToUse = item.quantity;
      const hasDimensions = item.height && item.width && item.height > 0 && item.width > 0;

      // Validate source stock
      if (transfer.sourceType === 'STORE' && transfer.sourceStoreId) {
        if (hasDimensions) {
          const sourceStoreStock = await tx.storeStock.findUnique({
            where: {
              storeId_productId: {
                storeId: transfer.sourceStoreId,
                productId: item.productId,
              },
            },
            include: {
              variants: true,
            },
          });

          if (!sourceStoreStock) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Source store stock not found for product ${item.productId}`,
            );
          }

          const sourceVariant = sourceStoreStock.variants.find(
            (v) =>
              Math.abs(v.height - (item.height || 0)) < 0.01 &&
              Math.abs(v.width - (item.width || 0)) < 0.01,
          );

          if (!sourceVariant) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Variant ${item.height}x${item.width} not found in source store`,
            );
          }

          if (sourceVariant.quantity < quantityToUse) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Insufficient variant stock in source store. Available: ${sourceVariant.quantity}, Requested: ${quantityToUse}`,
            );
          }

          // Check if after decrement it would become negative
          if (sourceVariant.quantity - quantityToUse < 0) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Cannot transfer. Variant ${item.height}x${item.width} would have negative stock. Available: ${sourceVariant.quantity}, Requested: ${quantityToUse}`,
            );
          }
        } else {
          const sourceStoreStock = await tx.storeStock.findUnique({
            where: {
              storeId_productId: {
                storeId: transfer.sourceStoreId,
                productId: item.productId,
              },
            },
          });

          if (!sourceStoreStock) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Source store stock not found for product ${item.productId}`,
            );
          }

          if (sourceStoreStock.quantity < quantityToUse) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Insufficient stock in source store. Available: ${sourceStoreStock.quantity}, Requested: ${quantityToUse}`,
            );
          }

          // Check if after decrement it would become negative
          if (sourceStoreStock.quantity - quantityToUse < 0) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Cannot transfer. Product would have negative stock. Available: ${sourceStoreStock.quantity}, Requested: ${quantityToUse}`,
            );
          }
        }
      } else if (transfer.sourceType === 'SHOP' && transfer.sourceShopId) {
        if (hasDimensions) {
          const sourceShopStock = await tx.shopStock.findUnique({
            where: {
              shopId_productId: {
                shopId: transfer.sourceShopId,
                productId: item.productId,
              },
            },
            include: {
              variants: true,
            },
          });

          if (!sourceShopStock) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Source shop stock not found for product ${item.productId}`,
            );
          }

          const sourceVariant = sourceShopStock.variants.find(
            (v) =>
              Math.abs(v.height - (item.height || 0)) < 0.01 &&
              Math.abs(v.width - (item.width || 0)) < 0.01,
          );

          if (!sourceVariant) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Variant ${item.height}x${item.width} not found in source shop`,
            );
          }

          if (sourceVariant.quantity < quantityToUse) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Insufficient variant stock in source shop. Available: ${sourceVariant.quantity}, Requested: ${quantityToUse}`,
            );
          }

          // Check if after decrement it would become negative
          if (sourceVariant.quantity - quantityToUse < 0) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Cannot transfer. Variant ${item.height}x${item.width} would have negative stock. Available: ${sourceVariant.quantity}, Requested: ${quantityToUse}`,
            );
          }
        } else {
          const sourceShopStock = await tx.shopStock.findUnique({
            where: {
              shopId_productId: {
                shopId: transfer.sourceShopId,
                productId: item.productId,
              },
            },
          });

          if (!sourceShopStock) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Source shop stock not found for product ${item.productId}`,
            );
          }

          if (sourceShopStock.quantity < quantityToUse) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Insufficient stock in source shop. Available: ${sourceShopStock.quantity}, Requested: ${quantityToUse}`,
            );
          }

          // Check if after decrement it would become negative
          if (sourceShopStock.quantity - quantityToUse < 0) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              `Cannot transfer. Product would have negative stock. Available: ${sourceShopStock.quantity}, Requested: ${quantityToUse}`,
            );
          }
        }
      }
    }

    // Prepare all operations for each transfer item
    const operations = await Promise.all(
      transfer.items.map(async (item, index) => {
        const unitOfMeasure = unitOfMeasureMap[item.unitOfMeasureId];

        if (!unitOfMeasure) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Unit of measure not found for item ${item.id}`,
          );
        }

        const quantityToUse = item.quantity;
        const itemOperations = [];

        // Check if this is a variant-based item (has height and width)
        const hasDimensions =
          item.height && item.width && item.height > 0 && item.width > 0;

        // Create unique invoice numbers for each ledger entry by appending item index and movement type
        const sourceInvoiceNo = `${transfer.shortCode}-OUT-${index}`;
        const destinationInvoiceNo = `${transfer.shortCode}-IN-${index}`;

        // Remove stock from source operations with variant support
        if (transfer.sourceType === 'STORE' && transfer.sourceStoreId) {
          if (hasDimensions) {
            // Find the specific variant in source store
            const sourceStoreStock = await tx.storeStock.findUnique({
              where: {
                storeId_productId: {
                  storeId: transfer.sourceStoreId,
                  productId: item.productId,
                },
              },
              include: {
                variants: true,
              },
            });

            const sourceVariant = sourceStoreStock.variants.find(
              (v) =>
                Math.abs(v.height - (item.height || 0)) < 0.01 &&
                Math.abs(v.width - (item.width || 0)) < 0.01,
            );

            // Deduct from variant
            itemOperations.push(
              tx.storeProductVariant.update({
                where: { id: sourceVariant.id },
                data: {
                  quantity: { decrement: quantityToUse },
                },
              }),
              // Also update the main store stock total quantity
              tx.storeStock.update({
                where: {
                  storeId_productId: {
                    storeId: transfer.sourceStoreId,
                    productId: item.productId,
                  },
                },
                data: {
                  quantity: { decrement: quantityToUse },
                },
              }),
              tx.stockLedger.create({
                data: {
                  productId: item.productId,
                  storeId: transfer.sourceStoreId,
                  invoiceNo: sourceInvoiceNo,
                  movementType: 'OUT',
                  quantity: quantityToUse,
                  height: item.height,
                  width: item.width,
                  unitOfMeasureId: item.unitOfMeasureId,
                  reference: `TRANSFER-${transfer.shortCode}`,
                  userId,
                  notes: `Transfer out to ${transfer.destinationType.toLowerCase()} - Variant: ${
                    item.height
                  }x${item.width}`,
                  movementDate: new Date(),
                },
              }),
            );
          } else {
            // Regular quantity-based item
            itemOperations.push(
              tx.storeStock.update({
                where: {
                  storeId_productId: {
                    storeId: transfer.sourceStoreId,
                    productId: item.productId,
                  },
                },
                data: {
                  quantity: { decrement: quantityToUse },
                },
              }),
              tx.stockLedger.create({
                data: {
                  productId: item.productId,
                  storeId: transfer.sourceStoreId,
                  invoiceNo: sourceInvoiceNo,
                  movementType: 'OUT',
                  quantity: quantityToUse,
                  unitOfMeasureId: item.unitOfMeasureId,
                  reference: `TRANSFER-${transfer.shortCode}`,
                  userId,
                  notes: `Transfer out to ${transfer.destinationType.toLowerCase()}`,
                  movementDate: new Date(),
                },
              }),
            );
          }
        } else if (transfer.sourceType === 'SHOP' && transfer.sourceShopId) {
          if (hasDimensions) {
            // Find the specific variant in source shop
            const sourceShopStock = await tx.shopStock.findUnique({
              where: {
                shopId_productId: {
                  shopId: transfer.sourceShopId,
                  productId: item.productId,
                },
              },
              include: {
                variants: true,
              },
            });

            const sourceVariant = sourceShopStock.variants.find(
              (v) =>
                Math.abs(v.height - (item.height || 0)) < 0.01 &&
                Math.abs(v.width - (item.width || 0)) < 0.01,
            );

            // Deduct from variant
            itemOperations.push(
              tx.shopProductVariant.update({
                where: { id: sourceVariant.id },
                data: {
                  quantity: { decrement: quantityToUse },
                },
              }),
              // Also update the main shop stock total quantity
              tx.shopStock.update({
                where: {
                  shopId_productId: {
                    shopId: transfer.sourceShopId,
                    productId: item.productId,
                  },
                },
                data: {
                  quantity: { decrement: quantityToUse },
                },
              }),
              tx.stockLedger.create({
                data: {
                  productId: item.productId,
                  shopId: transfer.sourceShopId,
                  invoiceNo: sourceInvoiceNo,
                  movementType: 'OUT',
                  quantity: quantityToUse,
                  height: item.height,
                  width: item.width,
                  unitOfMeasureId: item.unitOfMeasureId,
                  reference:
                    transfer.reference || `TRANSFER-${transfer.shortCode}`,
                  userId,
                  notes: `Transfer out to ${transfer.destinationType.toLowerCase()} - Variant: ${
                    item.height
                  }x${item.width}`,
                  movementDate: new Date(),
                },
              }),
            );
          } else {
            // Regular quantity-based item
            itemOperations.push(
              tx.shopStock.update({
                where: {
                  shopId_productId: {
                    shopId: transfer.sourceShopId,
                    productId: item.productId,
                  },
                },
                data: {
                  quantity: { decrement: quantityToUse },
                },
              }),
              tx.stockLedger.create({
                data: {
                  productId: item.productId,
                  invoiceNo: sourceInvoiceNo,
                  shopId: transfer.sourceShopId,
                  movementType: 'OUT',
                  quantity: quantityToUse,
                  unitOfMeasureId: item.unitOfMeasureId,
                  reference:
                    transfer.reference || `TRANSFER-${transfer.shortCode}`,
                  userId,
                  notes: `Transfer out to ${transfer.destinationType.toLowerCase()}`,
                  movementDate: new Date(),
                },
              }),
            );
          }
        }

        // Add stock to destination operations with variant support
        if (transfer.destinationType === 'STORE' && transfer.destStoreId) {
          if (hasDimensions) {
            // Handle destination store stock addition with variants
            // First, ensure the store stock exists
            const destStoreStock = await tx.storeStock.upsert({
              where: {
                storeId_productId: {
                  storeId: transfer.destStoreId,
                  productId: item.productId,
                },
              },
              update: {
                quantity: { increment: quantityToUse },
              },
              create: {
                storeId: transfer.destStoreId,
                productId: item.productId,
                quantity: quantityToUse,
                unitOfMeasureId: item.unitOfMeasureId,
                status: 'Available',
              },
            });

            // Then handle the variant
            const existingVariant = await tx.storeProductVariant.findUnique({
              where: {
                storeStockId_height_width: {
                  storeStockId: destStoreStock.id,
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
                    quantity: { increment: quantityToUse },
                  },
                }),
              );
            } else {
              // Create new variant
              itemOperations.push(
                tx.storeProductVariant.create({
                  data: {
                    storeStockId: destStoreStock.id,
                    height: item.height,
                    width: item.width,
                    quantity: quantityToUse,
                  },
                }),
              );
            }

            // Add stock ledger entry
            itemOperations.push(
              tx.stockLedger.create({
                data: {
                  productId: item.productId,
                  invoiceNo: destinationInvoiceNo,
                  storeId: transfer.destStoreId,
                  movementType: 'IN',
                  quantity: quantityToUse,
                  height: item.height,
                  width: item.width,
                  unitOfMeasureId: item.unitOfMeasureId,
                  reference:
                    transfer.reference || `TRANSFER-${transfer.shortCode}`,
                  userId,
                  notes: `Transfer in from ${transfer.sourceType.toLowerCase()} - Variant: ${
                    item.height
                  }x${item.width}`,
                  movementDate: new Date(),
                },
              }),
            );
          } else {
            // Regular quantity-based item for store
            itemOperations.push(
              tx.storeStock.upsert({
                where: {
                  storeId_productId: {
                    storeId: transfer.destStoreId,
                    productId: item.productId,
                  },
                },
                update: {
                  quantity: { increment: quantityToUse },
                },
                create: {
                  storeId: transfer.destStoreId,
                  productId: item.productId,
                  quantity: quantityToUse,
                  unitOfMeasureId: item.unitOfMeasureId,
                  status: 'Available',
                },
              }),
              tx.stockLedger.create({
                data: {
                  productId: item.productId,
                  invoiceNo: destinationInvoiceNo,
                  storeId: transfer.destStoreId,
                  movementType: 'IN',
                  quantity: quantityToUse,
                  unitOfMeasureId: item.unitOfMeasureId,
                  reference:
                    transfer.reference || `TRANSFER-${transfer.shortCode}`,
                  userId,
                  notes: `Transfer in from ${transfer.sourceType.toLowerCase()}`,
                  movementDate: new Date(),
                },
              }),
            );
          }
        } else if (transfer.destinationType === 'SHOP' && transfer.destShopId) {
          if (hasDimensions) {
            // Handle destination shop stock addition with variants
            // First, ensure the shop stock exists
            const destShopStock = await tx.shopStock.upsert({
              where: {
                shopId_productId: {
                  shopId: transfer.destShopId,
                  productId: item.productId,
                },
              },
              update: {
                quantity: { increment: quantityToUse },
              },
              create: {
                shopId: transfer.destShopId,
                productId: item.productId,
                quantity: quantityToUse,
                unitOfMeasureId: item.unitOfMeasureId,
                status: 'Available',
              },
            });

            // Then handle the variant
            const existingVariant = await tx.shopProductVariant.findUnique({
              where: {
                shopStockId_height_width: {
                  shopStockId: destShopStock.id,
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
                    quantity: { increment: quantityToUse },
                  },
                }),
              );
            } else {
              // Create new variant
              itemOperations.push(
                tx.shopProductVariant.create({
                  data: {
                    shopStockId: destShopStock.id,
                    height: item.height,
                    width: item.width,
                    quantity: quantityToUse,
                  },
                }),
              );
            }

            // Add stock ledger entry
            itemOperations.push(
              tx.stockLedger.create({
                data: {
                  productId: item.productId,
                  invoiceNo: destinationInvoiceNo,
                  shopId: transfer.destShopId,
                  movementType: 'IN',
                  quantity: quantityToUse,
                  height: item.height,
                  width: item.width,
                  unitOfMeasureId: item.unitOfMeasureId,
                  reference:
                    transfer.reference || `TRANSFER-${transfer.shortCode}`,
                  userId,
                  notes: `Transfer in from ${transfer.sourceType.toLowerCase()} - Variant: ${
                    item.height
                  }x${item.width}`,
                  movementDate: new Date(),
                },
              }),
            );
          } else {
            // Regular quantity-based item for shop
            itemOperations.push(
              tx.shopStock.upsert({
                where: {
                  shopId_productId: {
                    shopId: transfer.destShopId,
                    productId: item.productId,
                  },
                },
                update: {
                  quantity: { increment: quantityToUse },
                },
                create: {
                  shopId: transfer.destShopId,
                  productId: item.productId,
                  quantity: quantityToUse,
                  unitOfMeasureId: item.unitOfMeasureId,
                  status: 'Available',
                },
              }),
              tx.stockLedger.create({
                data: {
                  productId: item.productId,
                  invoiceNo: destinationInvoiceNo,
                  shopId: transfer.destShopId,
                  movementType: 'IN',
                  quantity: quantityToUse,
                  unitOfMeasureId: item.unitOfMeasureId,
                  reference:
                    transfer.reference || `TRANSFER-${transfer.shortCode}`,
                  userId,
                  notes: `Transfer in from ${transfer.sourceType.toLowerCase()}`,
                  movementDate: new Date(),
                },
              }),
            );
          }
        }

        return itemOperations;
      }),
    );

    // Flatten all operations and execute them in parallel
    const allOperations = operations.flat();
    await Promise.all(allOperations);

    // Update transfer status to COMPLETED
    const updatedTransfer = await tx.transfer.update({
      where: { id: transferId },
      data: {
        status: 'COMPLETED',
        updatedById: userId,
      },
    });

    // Create log entry
    await tx.log.create({
      data: {
        action: `Completed transfer ${transfer.reference || transfer.id} with ${
          transfer.items.length
        } items`,
        userId,
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

  // Create log entry
  await prisma.log.create({
    data: {
      action: `Cancelled transfer ${transfer.reference || transfer.id}`,
      userId,
    },
  });

  return updatedTransfer;
};

const bulkUpdateAdditionalPrices = async (batchUpdates) => {
  try {
    const results = await prisma.$transaction(async (tx) => {
      // Process all additional prices in parallel
      const allResults = await Promise.all(
        batchUpdates.flatMap((item) =>
          item.additionalPrices.map(async (price) => {
            // First try to find if this price already exists
            const existingPrice = await tx.additionalPrice.findFirst({
              where: {
                batchId: item.batchId,
                label: price.label,
              },
            });

            if (existingPrice) {
              // Update existing price
              return tx.additionalPrice.update({
                where: { id: existingPrice.id },
                data: { price: price.price },
              });
            }
            // Create new price
            return tx.additionalPrice.create({
              data: {
                batchId: item.batchId,
                label: price.label,
                price: price.price,
              },
            });
          }),
        ),
      );

      // Fetch updated batches
      const updatedBatches = await tx.productBatch.findMany({
        where: {
          id: { in: batchUpdates.map((b) => b.batchId) },
        },
        include: {
          AdditionalPrice: true,
        },
      });

      return {
        totalProcessed: allResults.length,
        batches: updatedBatches,
      };
    });

    return results;
  } catch (error) {
    throw new Error(`Bulk update failed: ${error.message}`);
  }
};

module.exports = {
  getTransferById,
  getTransferByReference,
  getAllTransfers,
  createTransfer,
  updateTransfer,
  deleteTransfer,
  completeTransfer,
  cancelTransfer,
  bulkUpdateAdditionalPrices,
};
