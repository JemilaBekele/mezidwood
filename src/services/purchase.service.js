const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Get Purchase by ID
const getPurchaseById = async (id) => {
  console.log('Fetching purchase by ID:', id);
  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: {
      supplier: true,
      store: true,
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

  return purchase;
};

// Get Purchase by invoice number
const getPurchaseByInvoiceNo = async (invoiceNo) => {
  const purchase = await prisma.purchase.findFirst({
    where: { invoiceNo },
  });
  return purchase;
};

// Get all Purchases
const getAllPurchases = async (filter = {}) => {
  const { supplierId, storeId, paymentStatus, startDate, endDate, search } =
    filter;

  const where = {};

  if (supplierId) {
    where.supplierId = supplierId;
  }

  if (storeId) {
    where.storeId = storeId;
  }

  if (paymentStatus) {
    where.paymentStatus = paymentStatus;
  }

  if (startDate || endDate) {
    where.purchaseDate = {};
    if (startDate) {
      where.purchaseDate.gte = new Date(startDate);
    }
    if (endDate) {
      where.purchaseDate.lte = new Date(endDate);
    }
  }

  if (search) {
    where.OR = [
      { invoiceNo: { contains: search, mode: 'insensitive' } },
      { notes: { contains: search, mode: 'insensitive' } },
    ];
  }

  const purchases = await prisma.purchase.findMany({
    where,
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      supplier: true,
      store: true,
      _count: {
        select: { items: true },
      },
    },
  });

  return {
    purchases,
    count: purchases.length,
  };
};

// Create Purchase
// Create Purchase
const createPurchase = async (purchaseBody, userId) => {
  // Check if invoice number already exists
  if (await getPurchaseByInvoiceNo(purchaseBody.invoiceNo)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invoice number already taken');
  }

  // Parse items if it's a string
  const { items: itemsString, ...restPurchaseBody } = purchaseBody;
  const items =
    typeof itemsString === 'string' ? JSON.parse(itemsString) : itemsString;

  // Validate items
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Purchase must have at least one item',
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

    // Validate quantity - always required
    if (!item.quantity || item.quantity <= 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${
          index + 1
        } has invalid quantity. Quantity must be greater than 0.`,
      );
    }

    // Validate dimensions if provided
    if (item.height !== undefined || item.width !== undefined) {
      // If either dimension is provided, both must be valid
      if (!item.height || item.height <= 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${
            index + 1
          } has invalid height. Height must be greater than 0 when dimensions are provided.`,
        );
      }
      if (!item.width || item.width <= 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${
            index + 1
          } has invalid width. Width must be greater than 0 when dimensions are provided.`,
        );
      }
    }

    if (item.unitPrice < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid unit price`,
      );
    }
  });

  // Recalculate totalPrice for security
  const validatedItems = items.map((item) => ({
    ...item,
    totalPrice: item.quantity * item.unitPrice,
  }));

  // Convert purchaseDate to DateTime object
  const purchaseDate = new Date(restPurchaseBody.purchaseDate);
  // Replace global isNaN with Number.isNaN
  if (Number.isNaN(purchaseDate.getTime())) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid purchase date');
  }

  // Calculate totals
  const totalProducts = validatedItems.length;
  const subTotal = validatedItems.reduce(
    (sum, item) => sum + item.totalPrice,
    0,
  );
  const grandTotal = subTotal; // You might add taxes/discounts here later

  // Create the purchase transaction
  const result = await prisma.$transaction(async (tx) => {
    // Create the purchase
    const purchase = await tx.purchase.create({
      data: {
        ...restPurchaseBody,
        purchaseDate,
        totalProducts,
        subTotal,
        grandTotal,
        createdById: userId, // Add created by user ID here

        items: {
          create: validatedItems.map((item) => ({
            productId: item.productId,
            unitOfMeasureId: item.unitOfMeasureId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            // Add height and width if they exist
            ...(item.height !== undefined && { height: item.height }),
            ...(item.width !== undefined && { width: item.width }),
          })),
        },
      },
      include: {
        items: {
          include: {
            product: true,
            unitOfMeasure: true,
          },
        },
        supplier: true,
        store: true,
        createdBy: true, // Include createdBy relation in the response
      },
    });

    return purchase;
  });

  return result;
};

// Update Purchase
const updatePurchase = async (purchaseId, purchaseBody, userId) => {
  // Check if purchase exists
  const existingPurchase = await getPurchaseById(purchaseId);
  if (!existingPurchase) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase not found');
  }

  // Check if current user is the creator of this purchase
  if (existingPurchase.createdById !== userId) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'Only the creator can update this purchase',
    );
  }

  // Check if invoice number already exists (excluding current purchase)
  if (
    purchaseBody.invoiceNo &&
    purchaseBody.invoiceNo !== existingPurchase.invoiceNo
  ) {
    if (await getPurchaseByInvoiceNo(purchaseBody.invoiceNo)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invoice number already taken',
      );
    }
  }

  // Parse items if it's a string
  const { items: itemsString, ...restPurchaseBody } = purchaseBody;
  const items =
    typeof itemsString === 'string' ? JSON.parse(itemsString) : itemsString;

  // Validate items
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Purchase must have at least one item',
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

    // Validate quantity - always required
    if (!item.quantity || item.quantity <= 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${
          index + 1
        } has invalid quantity. Quantity must be greater than 0.`,
      );
    }

    // Validate dimensions if provided
    if (item.height !== undefined || item.width !== undefined) {
      // If either dimension is provided, both must be valid
      if (!item.height || item.height <= 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${
            index + 1
          } has invalid height. Height must be greater than 0 when dimensions are provided.`,
        );
      }
      if (!item.width || item.width <= 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${
            index + 1
          } has invalid width. Width must be greater than 0 when dimensions are provided.`,
        );
      }
    }

    if (item.unitPrice < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid unit price`,
      );
    }
  });

  // Recalculate totalPrice for security
  const validatedItems = items.map((item) => ({
    ...item,
    totalPrice: item.quantity * item.unitPrice,
  }));

  // Convert purchaseDate to DateTime object if provided
  let { purchaseDate } = existingPurchase;
  if (restPurchaseBody.purchaseDate) {
    purchaseDate = new Date(restPurchaseBody.purchaseDate);
    if (Number.isNaN(purchaseDate.getTime())) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid purchase date');
    }
  }

  // Calculate totals
  const totalProducts = validatedItems.length;
  const subTotal = validatedItems.reduce(
    (sum, item) => sum + item.totalPrice,
    0,
  );
  const grandTotal = subTotal; // You might add taxes/discounts here later

  // Update the purchase transaction
  const result = await prisma.$transaction(async (tx) => {
    // First delete all existing items
    await tx.purchaseItem.deleteMany({
      where: {
        purchaseId,
      },
    });

    // Update the purchase
    const purchase = await tx.purchase.update({
      where: {
        id: purchaseId,
      },
      data: {
        ...restPurchaseBody,
        purchaseDate,
        totalProducts,
        subTotal,
        grandTotal,
        updatedById: userId, // Add updated by user ID here
        items: {
          create: validatedItems.map((item) => ({
            productId: item.productId,
            unitOfMeasureId: item.unitOfMeasureId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            // Add height and width if they exist
            ...(item.height !== undefined && { height: item.height }),
            ...(item.width !== undefined && { width: item.width }),
          })),
        },
      },
      include: {
        items: {
          include: {
            product: true,
            unitOfMeasure: true,
          },
        },
        supplier: true,
        store: true,
        createdBy: true,
        updatedBy: true,
      },
    });

    return purchase;
  });

  return result;
};

// Delete Purchase
const deletePurchase = async (id, userId) => {
  const existingPurchase = await getPurchaseById(id);
  if (!existingPurchase) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase not found');
  }

  await prisma.$transaction(async (tx) => {
    // Check if this purchase was approved (has stock ledger entries)
    const existingLedgerEntries = await tx.stockLedger.count({
      where: {
        reference: existingPurchase.invoiceNo,
        movementType: 'IN',
      },
    });

    const wasApproved = existingLedgerEntries > 0;

    // Process all items in parallel
    await Promise.all(
      existingPurchase.items.map(async (item) => {
        const operations = [];

        // Only reverse stock operations if purchase was approved
        if (wasApproved) {
          // 1. Create reversal stock ledger entry
          operations.push(
            tx.stockLedger.create({
              data: {
                productId: item.productId,
                storeId: existingPurchase.storeId,
                movementType: 'OUT',
                quantity: item.quantity,
                unitOfMeasureId: item.unitOfMeasureId,
                reference: `PURCHASE-DELETE-${existingPurchase.invoiceNo}`,
                userId,
                notes: `Stock reversed from deleted purchase ${existingPurchase.invoiceNo}`,
                movementDate: new Date(),
              },
            }),
          );

          // 2. Update StoreStock (no batch relation anymore)
          const existingStoreStock = await tx.storeStock.findUnique({
            where: {
              storeId_productId: {
                storeId: existingPurchase.storeId,
                productId: item.productId,
              },
            },
          });

          if (existingStoreStock) {
            const newQuantity = existingStoreStock.quantity - item.quantity;

            if (newQuantity <= 0) {
              // Delete the store stock if quantity becomes 0 or negative
              operations.push(
                tx.storeStock.delete({
                  where: {
                    storeId_productId: {
                      storeId: existingPurchase.storeId,
                      productId: item.productId,
                    },
                  },
                }),
              );
            } else {
              // Update the store stock quantity
              operations.push(
                tx.storeStock.update({
                  where: {
                    storeId_productId: {
                      storeId: existingPurchase.storeId,
                      productId: item.productId,
                    },
                  },
                  data: {
                    quantity: {
                      decrement: item.quantity,
                    },
                  },
                }),
              );
            }
          }
        }

        // Execute all operations for this item
        if (operations.length > 0) {
          await Promise.all(operations);
        }
      }),
    );

    // Delete all purchase items
    await tx.purchaseItem.deleteMany({
      where: { purchaseId: id },
    });

    // Delete the purchase
    await tx.purchase.delete({
      where: { id },
    });

    // Create log entry
    await tx.log.create({
      data: {
        action: `Deleted purchase ${existingPurchase.invoiceNo}${
          wasApproved ? ' and reversed stock' : ''
        }`,
        userId,
      },
    });
  });

  return { message: 'Purchase deleted successfully' };
};

const acceptPurchase = async (purchaseId, paymentStatus, userId) => {
  try {
    const purchase = await prisma.purchase.findUnique({
      where: { id: purchaseId },
      include: {
        items: {
          include: {
            product: true,
            unitOfMeasure: true,
          },
        },
        store: true,
      },
    });

    if (!purchase) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Purchase not found');
    }

    // Check if purchase is already accepted (has stock ledger entries)
    const existingLedgerEntries = await prisma.stockLedger.count({
      where: {
        reference: purchase.invoiceNo,
        movementType: 'IN',
      },
    });

    if (existingLedgerEntries > 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Purchase already accepted');
    }

    // Update payment status
    const updatedPurchase = await prisma.purchase.update({
      where: { id: purchaseId },
      data: {
        paymentStatus,
        updatedById: userId,
      },
    });

    // Only create stock for approved purchases
    if (paymentStatus === 'APPROVED') {
      const result = await prisma.$transaction(
        async (tx) => {
          // First, create/update all store stocks and variants
          const stockPromises = purchase.items.map(async (item) => {
            const { productId, quantity, unitOfMeasureId, height, width } =
              item;

            // Validate quantity
            if (quantity <= 0) {
              throw new ApiError(
                httpStatus.BAD_REQUEST,
                `Invalid quantity for item ${item.id || productId}`,
              );
            }

            // Check if this is a dimension-based item
            const isDimensionBased =
              height != null && width != null && height > 0 && width > 0;

            // Validate dimensions for dimension-based items
            if (isDimensionBased) {
              if (height <= 0 || width <= 0) {
                throw new ApiError(
                  httpStatus.BAD_REQUEST,
                  `Invalid dimensions for item ${
                    item.id || productId
                  }: height and width must be positive numbers`,
                );
              }
            }

            // Find or create the main store stock record
            const mainStoreStock = await tx.storeStock.upsert({
              where: {
                storeId_productId: {
                  storeId: purchase.storeId,
                  productId,
                },
              },
              create: {
                storeId: purchase.storeId,
                productId,
                quantity: 0,
                unitOfMeasureId,
                status: 'Available',
              },
              update: {}, // Don't update anything on conflict
            });

            if (isDimensionBased) {
              // Handle dimension-based item
              // Use findUnique with composite unique constraint instead of findFirst for better performance
              const existingVariant = await tx.storeProductVariant.findUnique({
                where: {
                  storeStockId_height_width: {
                    storeStockId: mainStoreStock.id,
                    height,
                    width,
                  },
                },
              });

              if (existingVariant) {
                // Update existing variant
                await tx.storeProductVariant.update({
                  where: { id: existingVariant.id },
                  data: {
                    quantity: {
                      increment: quantity,
                    },
                  },
                });
              } else {
                // Create new variant
                await tx.storeProductVariant.create({
                  data: {
                    storeStockId: mainStoreStock.id,
                    height,
                    width,
                    quantity,
                  },
                });
              }

              // Create stock ledger entry with dimensions
              await tx.stockLedger.create({
                data: {
                  productId,
                  storeId: purchase.storeId,
                  movementType: 'IN',
                  height,
                  width,
                  quantity,
                  unitOfMeasureId,
                  reference: purchase.invoiceNo,
                  userId,
                  notes: `Purchase acceptance - ${purchase.invoiceNo} - Added ${quantity} piece(s) (${height}x${width})`,
                  movementDate: purchase.purchaseDate || new Date(),
                },
              });

              return {
                storeStockId: mainStoreStock.id,
                isDimensionBased: true,
                variantCount: 1,
              };
            }

            // Handle quantity-based item (no dimensions)
            await tx.storeStock.update({
              where: { id: mainStoreStock.id },
              data: {
                quantity: {
                  increment: quantity,
                },
              },
            });

            // Create stock ledger entry without dimensions
            await tx.stockLedger.create({
              data: {
                productId,
                storeId: purchase.storeId,
                movementType: 'IN',
                quantity,
                unitOfMeasureId,
                reference: purchase.invoiceNo,
                userId,
                notes: `Purchase acceptance - ${purchase.invoiceNo}`,
                movementDate: purchase.purchaseDate || new Date(),
              },
            });

            return {
              storeStockId: mainStoreStock.id,
              isDimensionBased: false,
              variantCount: 0,
            };
          });

          // Execute all stock operations
          const stockResults = await Promise.all(stockPromises);

          // Get unique store stock IDs that had dimension-based updates
          const dimensionStoreStockIds = [
            ...new Set(
              stockResults
                .filter((result) => result.isDimensionBased)
                .map((result) => result.storeStockId),
            ),
          ];

          // Update total quantities for store stocks that had dimension variants
          if (dimensionStoreStockIds.length > 0) {
            const updateTotalPromises = dimensionStoreStockIds.map(
              async (stockId) => {
                // Get all variants for this store stock
                const variants = await tx.storeProductVariant.findMany({
                  where: { storeStockId: stockId },
                });

                // Calculate total quantity from all variants
                const totalQuantity = variants.reduce(
                  (sum, v) => sum + v.quantity,
                  0,
                );

                // Update the main store stock total quantity
                await tx.storeStock.update({
                  where: { id: stockId },
                  data: { quantity: totalQuantity },
                });

                return { stockId, totalQuantity };
              },
            );

            await Promise.all(updateTotalPromises);
          }

          // Create log entry
          await tx.log.create({
            data: {
              action: `Accepted purchase ${purchase.invoiceNo} with ${purchase.items.length} items. Payment status: ${paymentStatus}`,
              userId,
            },
          });

          // Fetch updated store stocks with variants for response
          const updatedStoreStocks = await tx.storeStock.findMany({
            where: {
              storeId: purchase.storeId,
              productId: {
                in: purchase.items.map((item) => item.productId),
              },
            },
            include: {
              variants: {
                orderBy: [{ height: 'asc' }, { width: 'asc' }],
              },
            },
          });

          // Get all stock ledger entries created
          const stockLedgerEntries = await tx.stockLedger.findMany({
            where: {
              reference: purchase.invoiceNo,
              movementType: 'IN',
            },
            orderBy: {
              createdAt: 'asc',
            },
          });

          return {
            purchase: updatedPurchase,
            stockLedgerEntries,
            storeStockUpdates: updatedStoreStocks,
            summary: {
              totalItems: purchase.items.length,
              dimensionBasedItems: stockResults.filter(
                (r) => r.isDimensionBased,
              ).length,
              quantityBasedItems: stockResults.filter(
                (r) => !r.isDimensionBased,
              ).length,
            },
          };
        },
        {
          timeout: 10000, // 10 second timeout for large purchases
        },
      );

      return result;
    }

    // For non-APPROVED status, just update the payment status and return
    await prisma.log.create({
      data: {
        action: `Updated payment status of purchase ${purchase.invoiceNo} to ${paymentStatus}`,
        userId,
      },
    });

    return {
      purchase: updatedPurchase,
      message: `Payment status updated to ${paymentStatus}. No stock created as purchase is not approved.`,
    };
  } catch (error) {
    // Handle specific Prisma errors
    if (error.code === 'P2002') {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Unique constraint violation. This might indicate a duplicate variant.',
      );
    }
    if (error.code === 'P2025') {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        'Related record not found during transaction',
      );
    }
    if (error.code === 'P2034') {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Transaction failed due to a conflict. Please try again.',
      );
    }

    // Re-throw ApiError instances
    if (error instanceof ApiError) {
      throw error;
    }

    // Log unexpected errors
    console.error('Unexpected error in acceptPurchase:', error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'An unexpected error occurred while accepting the purchase',
    );
  }
};
module.exports = {
  getPurchaseById,
  getPurchaseByInvoiceNo,
  getAllPurchases,
  createPurchase,
  updatePurchase,
  deletePurchase,
  acceptPurchase,
};
