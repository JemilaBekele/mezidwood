const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

/* eslint-disable no-restricted-syntax, no-await-in-loop */

// Purchase lines in the order they were entered on the purchase.
const ITEM_ORDER = [{ lineNo: 'asc' }, { createdAt: 'asc' }];

/** Units per material that this purchase has put into its store (its ledger IN rows). */
const purchaseStockIn = async (tx, purchase) => {
  const rows = await tx.stockLedger.findMany({
    where: {
      reference: purchase.invoiceNo,
      movementType: 'IN',
      storeId: purchase.storeId,
    },
  });
  return rows.reduce((acc, r) => {
    acc[r.materialId] = (acc[r.materialId] || 0) + r.quantity;
    return acc;
  }, {});
};

/** Add `quantity` of a material to a store, reusing its existing stock row. */
const addStoreStock = async (tx, materialId, storeId, quantity) => {
  const existing = await tx.inventoryStock.findFirst({
    where: { materialId, storeId, showroomId: null },
  });
  if (existing) {
    await tx.inventoryStock.update({
      where: { id: existing.id },
      data: {
        quantity: { increment: quantity },
        status: 'Available',
        lastUpdated: new Date(),
      },
    });
  } else {
    await tx.inventoryStock.create({
      data: { materialId, storeId, quantity, status: 'Available' },
    });
  }
};

/**
 * Bring the store's stock up to what has been RECEIVED on an approved
 * purchase: each line's accepted quantity, or its ordered quantity when no
 * receipt was recorded. Only ever adds the difference, so it is safe to call
 * on approval and again whenever more of a line is accepted later.
 */
const syncPurchaseStock = async (tx, purchase, userId) => {
  const target = {};
  const unitOf = {};
  purchase.items.forEach((item) => {
    target[item.materialId] =
      (target[item.materialId] || 0) + (item.acceptquantity ?? item.quantity);
    unitOf[item.materialId] =
      item.material?.unitOfMeasureId ?? item.unitOfMeasureId ?? null;
  });

  const already = await purchaseStockIn(tx, purchase);
  const entries = [];
  for (const [materialId, qty] of Object.entries(target)) {
    const add = qty - (already[materialId] || 0);
    if (add > 0) {
      await addStoreStock(tx, materialId, purchase.storeId, add);
      entries.push(
        await tx.stockLedger.create({
          data: {
            materialId,
            movementType: 'IN',
            quantity: add,
            unitId: unitOf[materialId],
            reference: purchase.invoiceNo,
            storeId: purchase.storeId,
            userId,
            notes: `Purchase acceptance - ${purchase.invoiceNo}`,
            movementDate: purchase.purchaseDate,
          },
        }),
      );
    }
  }
  return entries;
};

/**
 * Take back everything a purchase put into stock. Refuses (and changes
 * nothing) when part of it was already used or transferred — that stock is
 * gone, so it must be handled with a stock correction instead.
 */
const reversePurchaseStock = async (tx, purchase) => {
  const added = await purchaseStockIn(tx, purchase);
  const plan = [];
  for (const [materialId, qty] of Object.entries(added)) {
    const rows = await tx.inventoryStock.findMany({
      where: { materialId, storeId: purchase.storeId, showroomId: null },
    });
    const available = rows.reduce((t, r) => t + r.quantity, 0);
    if (available < qty) {
      const material = await tx.material.findUnique({
        where: { id: materialId },
        select: { name: true },
      });
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `${material?.name || materialId}: ${qty} came in on purchase ${
          purchase.invoiceNo
        } but only ${available} is left in the store — some was already used or transferred. ` +
          'Use a stock correction instead.',
      );
    }
    plan.push({ rows, qty });
  }

  for (const { rows, qty } of plan) {
    let left = qty;
    for (const row of rows) {
      if (left <= 0) break;
      const take = Math.min(row.quantity, left);
      if (take > 0) {
        await tx.inventoryStock.update({
          where: { id: row.id },
          data: { quantity: { decrement: take }, lastUpdated: new Date() },
        });
        left -= take;
      }
    }
  }

  await tx.stockLedger.deleteMany({
    where: {
      reference: purchase.invoiceNo,
      movementType: 'IN',
      storeId: purchase.storeId,
    },
  });
};

// Get Purchase by ID
const getPurchaseById = async (id) => {
  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: {
      supplier: true,
      bank: true,
      store: true, // Added store
      createdBy: { select: { id: true, name: true, email: true } },
      updatedBy: { select: { id: true, name: true, email: true } },
      items: {
        orderBy: ITEM_ORDER,
        include: {
          material: true,
          unitOfMeasure: true,
        },
      },
    },
  });

  return purchase;
};
const acceptPurchaseItem = async (itemId, { acceptquantity }) => {
  try {
    // Validate input
    if (acceptquantity === undefined || acceptquantity === null) {
      throw new Error('acceptquantity is required');
    }

    if (!Number.isInteger(acceptquantity) || acceptquantity < 0) {
      throw new Error('acceptquantity must be a non-negative integer');
    }

    // Fetch existing purchase item
    const existingItem = await prisma.purchaseItem.findUnique({
      where: { id: itemId },
    });

    if (!existingItem) {
      throw new Error('Purchase item not found');
    }

    // ✅ Calculate new accepted total:
    //    - If a past value exists (not null/0), ADD to it
    //    - Otherwise use the incoming value as-is
    const previousAccepted = existingItem.acceptquantity ?? 0;
    const newAcceptedTotal =
      previousAccepted > 0 ? previousAccepted + acceptquantity : acceptquantity;

    // Prevent accepting more than ordered (after summing)
    if (newAcceptedTotal > existingItem.quantity) {
      throw new Error(
        `Total accepted quantity (${newAcceptedTotal}) cannot exceed ordered quantity (${existingItem.quantity}). ` +
        `Already accepted: ${previousAccepted}, attempting to add: ${acceptquantity}.`
      );
    }

    // Determine if fully accepted
    const isfullyaccepted = newAcceptedTotal === existingItem.quantity;

    // Update item; on an already-approved purchase the newly received units
    // go into stock right away.
    const updatedItem = await prisma.$transaction(async (tx) => {
      const item = await tx.purchaseItem.update({
        where: { id: itemId },
        data: {
          acceptquantity: newAcceptedTotal,
          isfullyaccepted,
        },
        include: {
          material: true,
          unitOfMeasure: true,
        },
      });

      const purchase = await tx.purchase.findUnique({
        where: { id: existingItem.purchaseId },
        include: { items: { include: { material: true } } },
      });
      if (purchase?.paymentStatus === 'APPROVED' && purchase.storeId) {
        await syncPurchaseStock(tx, purchase, purchase.updatedById);
      }

      return item;
    });

    return updatedItem;
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    throw error;
  }
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
          // Stock is only added by approving (acceptPurchase), so a purchase
          // can never be born APPROVED without its stock.
          paymentStatus:
            restPurchaseBody.paymentStatus === 'APPROVED'
              ? 'PENDING'
              : restPurchaseBody.paymentStatus || 'PENDING',
          notes: restPurchaseBody.notes || '',
          purchaseDate,
          totalProducts,
          subTotal,
          grandTotal,
          createdBy: {
            connect: { id: userId },
          },
          items: {
            create: validatedItems.map((item, index) => ({
              lineNo: index,
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
            orderBy: ITEM_ORDER,
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
          createdBy: { select: { id: true, name: true, email: true } },
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

  // Its stock is already in the store: editing the lines would leave stock
  // and purchase disagreeing. Set it back to PENDING first (reverses stock).
  if (existingPurchase.paymentStatus === 'APPROVED') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'An approved purchase cannot be edited. Change its status back to PENDING first.',
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

  const materials = await prisma.material.findMany({
    where: { id: { in: [...new Set(items.map((item) => item.materialId))] } },
    select: { id: true, unitOfMeasureId: true },
  });
  const unitOf = new Map(materials.map((m) => [m.id, m.unitOfMeasureId]));

  const validatedItems = items.map((item) => ({
    ...item,
    unitOfMeasureId: unitOf.get(item.materialId) || null,
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
        // Status changes (and their stock) go through acceptPurchase only.
        notes: restPurchaseBody.notes,
        purchaseDate,
        totalProducts,
        subTotal,
        grandTotal,
        updatedById: userId,
        items: {
          create: validatedItems.map((item, index) => ({
            lineNo: index,
            materialId: item.materialId,
            unitOfMeasureId: item.unitOfMeasureId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
          })),
        },
      },
      include: {
        items: {
          orderBy: ITEM_ORDER,
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
        createdBy: { select: { id: true, name: true, email: true } },
        updatedBy: { select: { id: true, name: true, email: true } },
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
    // Take back the stock it added (refuses if some was already used).
    if (existingPurchase.storeId) {
      await reversePurchaseStock(tx, existingPurchase);
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
          orderBy: ITEM_ORDER,
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

    const wasApproved = purchase.paymentStatus === 'APPROVED';
    if (wasApproved && paymentStatus === 'APPROVED') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Purchase already accepted');
    }

    return await prisma.$transaction(async (tx) => {
      // Rejecting / moving an approved purchase back to PENDING takes its
      // stock back out (refused if some was already used).
      if (wasApproved) await reversePurchaseStock(tx, purchase);

      const updatedPurchase = await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          paymentStatus,
          updatedById: userId,
        },
      });

      if (paymentStatus === 'APPROVED') {
        const stockLedgerEntries = await syncPurchaseStock(
          tx,
          purchase,
          userId,
        );
        return { purchase: updatedPurchase, stockLedgerEntries };
      }

      return {
        purchase: updatedPurchase,
        message: wasApproved
          ? `Payment status updated to ${paymentStatus}. Stock from this purchase was taken back out.`
          : `Payment status updated to ${paymentStatus}. No stock created as purchase is not approved.`,
      };
    });
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

module.exports = {
  getPurchaseById,
  getPurchaseByInvoiceNo,
  getAllPurchases,
  createPurchase,
  updatePurchase,
  deletePurchase,
  acceptPurchase,
  acceptPurchaseItem,
};
