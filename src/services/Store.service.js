const httpStatus = require('http-status');
const { subMonths } = require('date-fns');

const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Get Store by ID
const getStoreById = async (id) => {
  const store = await prisma.store.findUnique({
    where: { id },
    include: {
      inventoryStocks: true,
      itemStocks: true,
      purchases: true,
    },
  });
  return store;
};

// Get Store by Name
const getStoreByName = async (name) => {
  const store = await prisma.store.findFirst({
    where: { name },
  });
  return store;
};

const getAllStore = async () => {
  const stores = await prisma.store.findMany({
    include: {
      inventoryStocks: true,
      itemStocks: true,
    },
  });

  return {
    stores,
    count: stores.length,
  };
};

// Get all Stores
const getAllStores = async (userId, filter = {}) => {
  // Get the user with their accessible stores
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      stores: { select: { id: true } },
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  // If user is admin, return all stores
  if (user.admin) {
    const stores = await prisma.store.findMany({
      where: filter,
      orderBy: {
        name: 'asc',
      },
      include: {
        inventoryStocks: true,
        itemStocks: true,
        purchases: true,
      },
    });

    return {
      stores,
      count: stores.length,
    };
  }

  // Regular user: filter by accessible stores
  const accessibleStoreIds = user.stores.map((store) => store.id);

  // If user has no stores, return empty array
  if (accessibleStoreIds.length === 0) {
    return {
      stores: [],
      count: 0,
    };
  }

  const stores = await prisma.store.findMany({
    where: {
      ...filter,
      id: { in: accessibleStoreIds },
    },
    orderBy: {
      name: 'asc',
    },
    include: {
      inventoryStocks: true,
      itemStocks: true,
      purchases: true,
    },
  });

  return {
    stores,
    count: stores.length,
  };
};

// Create Store
const createStore = async (storeBody) => {
  // Check if store with same name already exists
  if (await getStoreByName(storeBody.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Store name already taken');
  }

  // If trying to create a main store, ensure no other main store exists
  if (storeBody.isMain) {
    const existingMainStore = await prisma.store.findFirst({
      where: { isMain: true },
    });

    if (existingMainStore) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Only one main store is allowed',
      );
    }
  }

  const store = await prisma.store.create({
    data: storeBody,
    include: {
      inventoryStocks: true,
      itemStocks: true,
      purchases: true,
    },
  });
  return store;
};

// Update Store
const updateStore = async (id, updateBody) => {
  const existingStore = await getStoreById(id);
  if (!existingStore) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Store not found');
  }

  // Check if name is being updated to an existing store name
  if (updateBody.name && updateBody.name !== existingStore.name) {
    if (await getStoreByName(updateBody.name)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Store name already taken');
    }
  }

  // If trying to set isMain to true, ensure no other main store exists
  if (updateBody.isMain === true && !existingStore.isMain) {
    const existingMainStore = await prisma.store.findFirst({
      where: {
        isMain: true,
        id: { not: id },
      },
    });

    if (existingMainStore) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Only one main store is allowed',
      );
    }
  }

  const updatedStore = await prisma.store.update({
    where: { id },
    data: updateBody,
    include: {
      inventoryStocks: true,
      itemStocks: true,
      purchases: true,
    },
  });

  return updatedStore;
};

// Delete Store
const deleteStore = async (id) => {
  const existingStore = await getStoreById(id);
  if (!existingStore) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Store not found');
  }

  // Prevent deletion of main store if it's the only one
  if (existingStore.isMain) {
    const storeCount = await prisma.store.count();
    if (storeCount === 1) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cannot delete the only main store',
      );
    }
  }

  await prisma.store.delete({
    where: { id },
  });

  return { message: 'Store deleted successfully' };
};

// Set a store as main (ensuring only one main exists)
const setMainStore = async (id) => {
  const existingStore = await getStoreById(id);
  if (!existingStore) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Store not found');
  }

  // Use transaction to ensure atomic operation
  const result = await prisma.$transaction(async (tx) => {
    // Set all stores to isMain: false
    await tx.store.updateMany({
      where: { isMain: true },
      data: { isMain: false },
    });

    // Set the selected store as main
    const updatedStore = await tx.store.update({
      where: { id },
      data: { isMain: true },
      include: {
        inventoryStocks: true,
        itemStocks: true,
        purchases: true,
      },
    });

    return updatedStore;
  });

  return result;
};

// Get main store
const getMainStore = async () => {
  const mainStore = await prisma.store.findFirst({
    where: { isMain: true },
    include: {
      inventoryStocks: true,
      itemStocks: true,
      purchases: true,
    },
  });

  if (!mainStore) {
    throw new ApiError(httpStatus.NOT_FOUND, 'No main store found');
  }

  return mainStore;
};

const getAllStockLedgers = async ({ startDate, endDate } = {}) => {
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

  const stockLedgers = await prisma.stockLedger.findMany({
    where: whereClause,
    orderBy: { movementDate: 'desc' },
    include: {
      batch: {
        select: {
          batchNumber: true,
          product: {
            select: {
              name: true,
              productCode: true,
            },
          },
        },
      },
      unitOfMeasure: true,
      store: {
        select: {
          name: true,
        },
      },
      shop: {
        select: {
          name: true,
        },
      },
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  });

  return {
    stockLedgers,
    count: stockLedgers.length,
  };
};

const getAllShopStocks = async ({ startDate, endDate } = {}) => {
  const whereClause = {};

  // Add filters if provided
  const threeMonthsAgo = subMonths(new Date(), 12); // Default time range

  // Convert string dates to Date objects if they exist
  const startDateObj = startDate ? new Date(startDate) : undefined;
  const endDateObj = endDate ? new Date(endDate) : undefined;

  // Build the date filter using createdAt instead of movementDate
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

  const shopStocks = await prisma.shopStock.findMany({
    where: whereClause,
    orderBy: { updatedAt: 'desc' },
    include: {
      shop: {
        select: {
          name: true,
        },
      },
      unitOfMeasure: true,
      batch: {
        select: {
          batchNumber: true,
          product: {
            select: {
              name: true,
              category: true,
            },
          },
        },
      },
    },
  });
  return {
    shopStocks,
    count: shopStocks.length,
  };
};

const getAllStoresStocks = async ({ startDate, endDate } = {}) => {
  const whereClause = {};
  const oneYearAgo = subMonths(new Date(), 12); // Default time range

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
      gte: oneYearAgo,
      lte: endDateObj,
    };
  } else {
    whereClause.createdAt = {
      gte: oneYearAgo,
    };
  }

  const storeStocks = await prisma.storeStock.findMany({
    where: {
      store: whereClause,
    },
    orderBy: { createdAt: 'desc' },
    include: {
      store: {
        include: {
          branch: {
            select: {
              name: true,
              id: true,
            },
          },
        },
      },
      batch: {
        select: {
          batchNumber: true,
          product: {
            select: {
              name: true,
              id: true,
              productCode: true,
            },
          },
        },
      },
      unitOfMeasure: true,
    },
  });

  // Transform the data to match your table columns
  const transformedData = storeStocks.map((stock) => ({
    id: stock.id,
    unitOfMeasure: stock.unitOfMeasure,
    quantity: stock.quantity,
    status: stock.status,
    createdAt: stock.createdAt,
    batch: {
      batchNumber: stock.batch.batchNumber,
      product: {
        name: stock.batch.product.name,
        id: stock.batch.product.id,
        productCode: stock.batch.product.productCode,
      },
    },
    store: {
      name: stock.store.name,
      id: stock.store.id,
    },
    branch: {
      name: stock.store.branch.name,
      id: stock.store.branch.id,
    },
  }));

  return {
    storeStocks: transformedData,
    count: storeStocks.length,
  };
};
// services/itemService.js
const getItemsByStoreId = async (storeId) => {
  try {
    // Validate storeId
    if (!storeId) {
      throw new Error('Store ID is required');
    }

    // LOG 1: Check input
    console.log('Fetching items for storeId:', storeId);

    // Get items with stock > 1 for the specified store
    const items = await prisma.items.findMany({
      where: {
        itemStocks: {
          some: {
            storeId,
            quantity: {
              gt: 0, // stock greater than zero
            },
          },
        },
      },
      include: {
        itemStocks: {
          where: {
            storeId,
            quantity: {
              gt: 0,
            },
          },
          select: {
            quantity: true,
            storeId: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        category: true,
        type: true,
        size: true,
      },
    });

    // LOG 2: Check raw results
    console.log('Raw items found:', items.length);
    console.log('First item sample:', JSON.stringify(items[0], null, 2));
    
    // LOG 3: Check itemStocks for each item
    items.forEach((item, index) => {
      console.log(`Item ${index + 1} (${item.name}):`, {
        itemId: item.id,
        stocksCount: item.itemStocks.length,
        stocks: item.itemStocks
      });
    });

    // Format the response
    const formattedItems = items.map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      imageUrl: item.imageUrl,
      color: item.color,
      category: item.category?.name || null,
      type: item.type?.typeName || null,
      size: item.size?.name || null,
      stockQuantity: item.itemStocks[0]?.quantity || 0,
      storeId,
    }));

    // LOG 4: Check formatted results
    console.log('Formatted items count:', formattedItems.length);
    console.log('First formatted item:', formattedItems[0]);

    return {
      success: true,
      storeId,
      productType: 'items',
      count: formattedItems.length,
      products: formattedItems,
    };
  } catch (error) {
    console.error('Error fetching items by store ID:', error);
    throw error;
  }
};
const getMaterialsByStoreId = async (storeId) => {
  try {
    // Validate storeId
    if (!storeId) {
      throw new Error('Store ID is required');
    }

    // Get materials with stock > 1 for the specified store
    const materials = await prisma.material.findMany({
      where: {
        inventoryStocks: {
          some: {
            storeId,
            quantity: {
              gt: 0, // stock greater than one
            },
          },
        },
      },
      include: {
        inventoryStocks: {
          where: {
            storeId,
            quantity: {
              gt: 0,
            },
          },
          select: {
            quantity: true,
            status: true,
            storeId: true,
            lastUpdated: true,
          },
        },
        materialType: true,
        unitOfMeasure: true,
      },
    });

    // Format the response
    const formattedMaterials = materials.map((material) => ({
      id: material.id,
      name: material.name,
      color: material.color,
      size: material.size,
      plainMDF: material.plainMDF,
      laminatedMDF: material.laminatedMDF,
      wood: material.wood,
      metal: material.metal,
      accessory: material.accessory,
      other: material.other,
      imageUrl: material.imageUrl,
      materialType: material.materialType?.name || null,
      unitOfMeasure: material.unitOfMeasure?.name || null,
      stockQuantity: material.inventoryStocks[0]?.quantity || 0,
      stockStatus: material.inventoryStocks[0]?.status || null,
      storeId,
    }));

    return {
      success: true,
      storeId,
      productType: 'materials',
      count: formattedMaterials.length,
      products: formattedMaterials,
    };
  } catch (error) {
    console.error('Error fetching materials by store ID:', error);
    throw error;
  }
};
// services/showroomMaterialService.js
const getMaterialsByShowroomId = async (showroomId) => {
  try {
    // Validate showroomId
    if (!showroomId) {
      throw new Error('Showroom ID is required');
    }

    // Get materials with stock > 1 for the specified showroom
    const materials = await prisma.material.findMany({
      where: {
        inventoryStocks: {
          some: {
            showroomId,
            quantity: {
              gt: 0, // stock greater than one
            },
          },
        },
      },
      include: {
        inventoryStocks: {
          where: {
            showroomId,
            quantity: {
              gt: 0,
            },
          },
          select: {
            quantity: true,
            status: true,
            showroomId: true,
            lastUpdated: true,
          },
        },
        materialType: true,
        unitOfMeasure: true,
      },
    });

    // Format the response
    const formattedMaterials = materials.map((material) => ({
      id: material.id,
      name: material.name,
      color: material.color,
      size: material.size,
      plainMDF: material.plainMDF,
      laminatedMDF: material.laminatedMDF,
      wood: material.wood,
      metal: material.metal,
      accessory: material.accessory,
      other: material.other,
      imageUrl: material.imageUrl,
      materialType: material.materialType?.name || null,
      unitOfMeasure: material.unitOfMeasure?.name || null,
      stockQuantity: material.inventoryStocks[0]?.quantity || 0,
      stockStatus: material.inventoryStocks[0]?.status || null,
      showroomId,
    }));

    return {
      success: true,
      showroomId,
      productType: 'materials',
      count: formattedMaterials.length,
      products: formattedMaterials,
    };
  } catch (error) {
    console.error('Error fetching materials by showroom ID:', error);
    throw error;
  }
};
// services/showroomItemService.js
const getItemsByShowroomId = async (showroomId) => {
  try {
    // Validate showroomId
    if (!showroomId) {
      throw new Error('Showroom ID is required');
    }

    // Get items with stock > 1 for the specified showroom
    const items = await prisma.items.findMany({
      where: {
        itemStocks: {
          some: {
            showroomId,
            quantity: {
              gt: 0, // stock greater than zero
            },
          },
        },
      },
      include: {
        itemStocks: {
          where: {
            showroomId,
            quantity: {
              gt: 0,
            },
          },
          select: {
            quantity: true,
            showroomId: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        category: true,
        type: true,
        size: true,
      },
    });

    // Format the response
    const formattedItems = items.map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      imageUrl: item.imageUrl,
      color: item.color,
      category: item.category?.name || null,
      type: item.type?.typeName || null,
      size: item.size?.name || null,
      stockQuantity: item.itemStocks[0]?.quantity || 0,
      showroomId,
    }));

    return {
      success: true,
      showroomId,
      productType: 'items',
      count: formattedItems.length,
      products: formattedItems,
    };
  } catch (error) {
    console.error('Error fetching items by showroom ID:', error);
    throw error;
  }
};

module.exports = {
  getAllStore,
  getStoreById,
  getStoreByName,
  getAllStores,
  createStore,
  updateStore,
  deleteStore,
  getAllStockLedgers,
  getAllShopStocks,
  getAllStoresStocks,
  setMainStore,
  getMainStore,
  getItemsByStoreId,
  getMaterialsByStoreId,
  getMaterialsByShowroomId,
  getItemsByShowroomId,
};
