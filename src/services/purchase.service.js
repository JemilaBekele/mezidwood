const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Get Purchase by ID
const getPurchaseById = async (id) => {
  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: {
      supplier: true,
      bank: true,
      store: true, // Added store
      createdBy: true,
      updatedBy: true,
      items: {
        include: {
          material: true,
          unitOfMeasure: true,
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
  const { supplierId, paymentStatus, startDate, endDate, search } = filter;

  const where = {};

  if (supplierId) {
    where.supplierId = supplierId;
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
      bank: true,
      store: true, // Added store
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

// Create Purchase
const createPurchase = async (purchaseBody, userId) => {
  try {
    console.log('=== CREATE PURCHASE START ===');
    console.log('Purchase Body:', JSON.stringify(purchaseBody, null, 2));
    console.log('User ID:', userId);

    // Check if invoice number already exists
    if (await getPurchaseByInvoiceNo(purchaseBody.invoiceNo)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invoice number already taken',
      );
    }

    // Parse items if it's a string
    const { items: itemsString, ...restPurchaseBody } = purchaseBody;
    console.log('Rest Purchase Body:', restPurchaseBody);
    console.log('Items String:', itemsString);

    const items =
      typeof itemsString === 'string' ? JSON.parse(itemsString) : itemsString;

    console.log('Parsed Items:', JSON.stringify(items, null, 2));

    // Validate items
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Purchase must have at least one item',
      );
    }

    // Validate individual item properties
    items.forEach((item, index) => {
      if (!item.materialId) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${index + 1} is missing required field (materialId)`,
        );
      }
      if (item.quantity <= 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${index + 1} has invalid quantity`,
        );
      }
      if (item.unitPrice < 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${index + 1} has invalid unit price`,
        );
      }
    });

    // Validate that all materials exist and include their unit of measure
    const materialIds = [...new Set(items.map((item) => item.materialId))];
    console.log('Material IDs to validate:', materialIds);

    const materials = await prisma.material.findMany({
      where: { id: { in: materialIds } },
      include: {
        unitOfMeasure: true,
      },
    });

    console.log('Found materials:', materials.length);

    const materialMap = new Map(materials.map((m) => [m.id, m]));

    // Validate materials and prepare items with unitOfMeasure from material
    const validatedItems = items.map((item, index) => {
      const material = materialMap.get(item.materialId);
      if (!material) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${index + 1}: Material with ID ${item.materialId} not found`,
        );
      }

      if (!material.unitOfMeasureId) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Item ${index + 1}: Material "${
            material.name
          }" does not have a unit of measure defined`,
        );
      }

      return {
        ...item,
        materialId: item.materialId,
        unitOfMeasureId: material.unitOfMeasureId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.quantity * item.unitPrice,
      };
    });

    // Convert purchaseDate to DateTime object
    const purchaseDate = new Date(restPurchaseBody.purchaseDate);
    if (Number.isNaN(purchaseDate.getTime())) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid purchase date');
    }

    console.log('Purchase Date:', purchaseDate);

    // Calculate totals
    const totalProducts = validatedItems.length;
    const subTotal = validatedItems.reduce(
      (sum, item) => sum + item.totalPrice,
      0,
    );
    const grandTotal = subTotal;

    console.log('Totals:', { totalProducts, subTotal, grandTotal });

    // Validate that supplier exists
    const supplier = await prisma.supplier.findUnique({
      where: { id: restPurchaseBody.supplierId },
    });

    if (!supplier) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Supplier not found');
    }

    // Validate bank if provided
    if (restPurchaseBody.bankId) {
      const bank = await prisma.bank.findUnique({
        where: { id: restPurchaseBody.bankId },
      });

      if (!bank) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Bank not found');
      }
    }

    // Get the main store automatically (don't accept from frontend)
    const mainStore = await getMainStore();
    console.log('Using main store:', mainStore.name, mainStore.id);

    // Create the purchase transaction
    console.log('Starting database transaction...');

    const result = await prisma.$transaction(async (tx) => {
      // Create the purchase using connect syntax for relations
      const purchase = await tx.purchase.create({
        data: {
          invoiceNo: restPurchaseBody.invoiceNo,
          supplier: {
            connect: { id: restPurchaseBody.supplierId },
          },
          ...(restPurchaseBody.bankId && {
            bank: {
              connect: { id: restPurchaseBody.bankId },
            },
          }),
          // Always use the main store
          store: {
            connect: { id: mainStore.id },
          },
          paymentStatus: restPurchaseBody.paymentStatus || 'PENDING',
          notes: restPurchaseBody.notes || '',
          purchaseDate,
          totalProducts,
          subTotal,
          grandTotal,
          createdBy: {
            connect: { id: userId },
          },
          items: {
            create: validatedItems.map((item) => ({
              material: {
                connect: { id: item.materialId },
              },
              ...(item.unitOfMeasureId && {
                unitOfMeasure: {
                  connect: { id: item.unitOfMeasureId },
                },
              }),
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
            })),
          },
        },
        include: {
          items: {
            include: {
              material: {
                include: {
                  unitOfMeasure: true,
                },
              },
              unitOfMeasure: true,
            },
          },
          supplier: true,
          bank: true,
          store: true,
          createdBy: true,
        },
      });

      console.log('Purchase created successfully with ID:', purchase.id);
      return purchase;
    });

    console.log('=== CREATE PURCHASE SUCCESS ===');
    return result;
  } catch (error) {
    console.error('=== CREATE PURCHASE ERROR ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);

    if (error.code) {
      console.error('Prisma error code:', error.code);
      console.error('Prisma error meta:', error.meta);
    }

    if (error.code === 'P2003') {
      console.error(
        'Foreign key constraint failed on field:',
        error.meta?.field_name,
      );

      if (error.meta?.field_name?.includes('supplierId')) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid supplier ID');
      }
      if (error.meta?.field_name?.includes('bankId')) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid bank ID');
      }
      if (error.meta?.field_name?.includes('storeId')) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid store ID');
      }
      if (error.meta?.field_name?.includes('materialId')) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Invalid material ID in one of the items',
        );
      }
      if (error.meta?.field_name?.includes('unitOfMeasureId')) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Invalid unit of measure ID',
        );
      }
    }

    if (error.code === 'P2002') {
      console.error('Unique constraint failed on field:', error.meta?.target);
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invoice number already exists',
      );
    }

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to create purchase: ${error.message}`,
    );
  }
};

// Update Purchase
const updatePurchase = async (purchaseId, purchaseBody, userId) => {
  const existingPurchase = await getPurchaseById(purchaseId);
  if (!existingPurchase) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase not found');
  }

  if (existingPurchase.createdById !== userId) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'Only the creator can update this purchase',
    );
  }

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

  const { items: itemsString, ...restPurchaseBody } = purchaseBody;
  const items =
    typeof itemsString === 'string' ? JSON.parse(itemsString) : itemsString;

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Purchase must have at least one item',
    );
  }

  items.forEach((item, index) => {
    if (!item.materialId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} is missing required field (materialId)`,
      );
    }
    if (item.quantity <= 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid quantity`,
      );
    }
    if (item.unitPrice < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid unit price`,
      );
    }
  });

  const validatedItems = items.map((item) => ({
    ...item,
    totalPrice: item.quantity * item.unitPrice,
  }));

  let { purchaseDate } = existingPurchase;
  if (restPurchaseBody.purchaseDate) {
    purchaseDate = new Date(restPurchaseBody.purchaseDate);
    if (Number.isNaN(purchaseDate.getTime())) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid purchase date');
    }
  }

  const totalProducts = validatedItems.length;
  const subTotal = validatedItems.reduce(
    (sum, item) => sum + item.totalPrice,
    0,
  );
  const grandTotal = subTotal;

  // Get the main store automatically (don't accept from frontend)
  const mainStore = await getMainStore();

  const result = await prisma.$transaction(async (tx) => {
    await tx.purchaseItem.deleteMany({
      where: {
        purchaseId,
      },
    });

    const purchase = await tx.purchase.update({
      where: {
        id: purchaseId,
      },
      data: {
        invoiceNo: restPurchaseBody.invoiceNo,
        supplierId: restPurchaseBody.supplierId,
        bankId: restPurchaseBody.bankId,
        // Always use the main store (ignore any storeId from frontend)
        storeId: mainStore.id,
        paymentStatus: restPurchaseBody.paymentStatus,
        notes: restPurchaseBody.notes,
        purchaseDate,
        totalProducts,
        subTotal,
        grandTotal,
        updatedById: userId,
        items: {
          create: validatedItems.map((item) => ({
            materialId: item.materialId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
          })),
        },
      },
      include: {
        items: {
          include: {
            material: {
              include: {
                unitOfMeasure: true,
              },
            },
          },
        },
        supplier: true,
        bank: true,
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
const deletePurchase = async (id) => {
  const existingPurchase = await getPurchaseById(id);
  if (!existingPurchase) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase not found');
  }

  await prisma.$transaction(async (tx) => {
    // Check if purchase was approved
    const existingLedgerEntries = await tx.stockLedger.count({
      where: {
        reference: existingPurchase.invoiceNo,
        movementType: 'IN',
      },
    });

    const wasApproved = existingLedgerEntries > 0;

    // REVERSE EVERYTHING if approved
    if (wasApproved && existingPurchase.storeId) {
      // 1. Reverse each item's stock
      await Promise.all(
        existingPurchase.items.map(async (item) => {
          // Get current inventory stock
          const existingInventoryStock = await tx.inventoryStock.findFirst({
            where: {
              materialId: item.materialId,
              storeId: existingPurchase.storeId,
            },
          });

          if (existingInventoryStock) {
            if (existingInventoryStock.quantity <= item.quantity) {
              // Delete inventory stock if quantity becomes zero or negative
              await tx.inventoryStock.delete({
                where: { id: existingInventoryStock.id },
              });
            } else {
              // Update inventory stock quantity
              await tx.inventoryStock.update({
                where: { id: existingInventoryStock.id },
                data: {
                  quantity: {
                    decrement: item.quantity,
                  },
                  status: 'Available',
                  lastUpdated: new Date(),
                },
              });
            }
          }

          // 3. Delete all IN stock ledger entries for this item
          await tx.stockLedger.deleteMany({
            where: {
              reference: existingPurchase.invoiceNo,
              movementType: 'IN',
              materialId: item.materialId,
              storeId: existingPurchase.storeId,
            },
          });
        }),
      );
    }

    // 4. Delete purchase items
    await tx.purchaseItem.deleteMany({
      where: { purchaseId: id },
    });

    // 5. Delete purchase record
    await tx.purchase.delete({
      where: { id },
    });
  });

  return {
    message: 'Purchase deleted successfully',
    wasReversed: true,
    invoiceNo: existingPurchase.invoiceNo,
  };
};

// Accept Purchase (with Store/Showroom location support)
const acceptPurchase = async (purchaseId, paymentStatus, userId) => {
  try {
    const purchase = await prisma.purchase.findUnique({
      where: { id: purchaseId },
      include: {
        items: {
          include: {
            material: {
              include: {
                unitOfMeasure: true,
              },
            },
          },
        },
        store: true,
      },
    });

    if (!purchase) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Purchase not found');
    }

    if (!purchase.storeId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Store is required for inventory management',
      );
    }

    const existingLedgerEntries = await prisma.stockLedger.count({
      where: {
        reference: purchase.invoiceNo,
        movementType: 'IN',
      },
    });

    if (existingLedgerEntries > 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Purchase already accepted');
    }

    const updatedPurchase = await prisma.purchase.update({
      where: { id: purchaseId },
      data: {
        paymentStatus,
        updatedById: userId,
      },
    });

    if (paymentStatus === 'APPROVED') {
      const result = await prisma.$transaction(async (tx) => {
        const materialIds = purchase.items.map((item) => item.materialId);
        const existingInventoryStocks = await tx.inventoryStock.findMany({
          where: {
            storeId: purchase.storeId,
            materialId: { in: materialIds },
          },
        });

        const existingInventoryStockMap = existingInventoryStocks.reduce(
          (acc, stock) => {
            acc[stock.materialId] = stock;
            return acc;
          },
          {},
        );

        const inventoryStockOperations = [];
        const stockLedgerOperations = [];

        purchase.items.forEach((item) => {
          const { materialId, quantity } = item;

          const existingInventoryStock = existingInventoryStockMap[materialId];
          if (existingInventoryStock) {
            inventoryStockOperations.push(
              tx.inventoryStock.update({
                where: { id: existingInventoryStock.id },
                data: {
                  quantity: { increment: quantity },
                  status: 'Available',
                  lastUpdated: new Date(),
                },
              }),
            );
          } else {
            inventoryStockOperations.push(
              tx.inventoryStock.create({
                data: {
                  materialId,
                  storeId: purchase.storeId,
                  quantity,
                  status: 'Available',
                },
              }),
            );
          }

          stockLedgerOperations.push(
            tx.stockLedger.create({
              data: {
                materialId,
                movementType: 'IN',
                quantity,
                unitId: item.material.unitOfMeasureId,
                reference: purchase.invoiceNo,
                storeId: purchase.storeId,
                userId,
                notes: `Purchase acceptance - ${purchase.invoiceNo}`,
                movementDate: purchase.purchaseDate,
              },
            }),
          );
        });

        const [inventoryStockUpdates, stockLedgerEntries] = await Promise.all([
          Promise.all(inventoryStockOperations),
          Promise.all(stockLedgerOperations),
        ]);

        return {
          purchase: updatedPurchase,
          stockLedgerEntries,
          inventoryStockUpdates,
        };
      });

      return result;
    }

    return {
      purchase: updatedPurchase,
      message: `Payment status updated to ${paymentStatus}. No stock created as purchase is not approved.`,
    };
  } catch (error) {
    if (error.code === 'P2025') {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        'Related record not found during transaction',
      );
    }
    throw error;
  }
};
const deleteAllMaterialsAndItems = async () => {
  // Check if anything exists to delete
  const materialCount = await prisma.material.count();
  const itemCount = await prisma.items.count();
  
  if (materialCount === 0 && itemCount === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, 'No materials or items found to delete');
  }

  await prisma.$transaction(async (tx) => {
    // === DELETE ALL MATERIALS RELATED RECORDS ===
    // 1. Delete all stock ledgers
    await tx.stockLedger.deleteMany({});

    // 2. Delete all inventory stocks
    await tx.inventoryStock.deleteMany({});

    // 3. Delete all stock correction items (for materials)
    await tx.stockCorrectionItem.deleteMany({});

    // 4. Delete all transfer items (for materials)
    await tx.transferItem.deleteMany({});

    // 5. Delete all purchase items
    await tx.purchaseItem.deleteMany({});

    // === DELETE ALL ITEMS RELATED RECORDS ===
    // 6. Delete all item stock ledgers
    await tx.itemStockLedger.deleteMany({});

    // 7. Delete all item stocks
    await tx.itemStock.deleteMany({});

    // 8. Delete all proforma invoice items
    await tx.proformaInvoiceItem.deleteMany({});

    // 9. Delete all sell items
    await tx.sellItem.deleteMany({});

    // 10. Delete all stock correction items (for items)
    await tx.stockCorrectionItem.deleteMany({});

    // 11. Delete all transfer items (for items)
    await tx.transferItem.deleteMany({});

    // 12. Delete all item images
    await tx.itemImage.deleteMany({});

    // 13. Delete all item materials (junction table - shared)
    await tx.itemMaterial.deleteMany({});

    // === DELETE MAIN ENTITIES ===
    // 14. Delete ALL items
    await tx.items.deleteMany({});

    // 15. Delete ALL materials
    await tx.material.deleteMany({});
  });

  return {
    message: 'All materials and items deleted successfully',
    materialsDeleted: materialCount,
    itemsDeleted: itemCount,
    totalDeleted: materialCount + itemCount,
    deletedAt: new Date().toISOString(),
  };
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
