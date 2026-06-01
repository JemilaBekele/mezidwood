const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Get Shop by ID
const getShopById = async (id) => {
  const shop = await prisma.shop.findUnique({
    where: { id },
    include: {
      branch: true,
    },
  });
  return shop;
};

// Get Shop by Name
const getShopByName = async (name) => {
  const shop = await prisma.shop.findFirst({
    where: { name },
  });
  return shop;
};

const getAllshop = async () => {
  const shops = await prisma.shop.findMany();
  return {
    shops,
    count: shops.length,
  };
};
// Get all Shops

const getAllShops = async (userId) => {
  // Get the user with their accessible shops
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      shops: { select: { id: true } },
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  // If user is admin, return all shops
  if (user.admin) {
    const shops = await prisma.shop.findMany({
      orderBy: {
        name: 'asc',
      },
      include: {
        branch: true,
      },
    });

    return {
      shops,
      count: shops.length,
    };
  }

  // Regular user: filter by accessible shops
  const accessibleShopIds = user.shops.map((shop) => shop.id);

  // If user has no shops, return empty array
  if (accessibleShopIds.length === 0) {
    return {
      shops: [],
      count: 0,
    };
  }

  const shops = await prisma.shop.findMany({
    where: {
      id: { in: accessibleShopIds }, // Filter by accessible shops
    },
    orderBy: {
      name: 'asc',
    },
    include: {
      branch: true,
    },
  });

  return {
    shops,
    count: shops.length,
  };
};
const getAllShopsbaseduser = async (userId = null) => {
  // If no userId provided, return all shops (for admin/superuser scenarios)
  if (!userId) {
    const shops = await prisma.shop.findMany({
      orderBy: {
        name: 'asc',
      },
      include: {
        branch: true,
      },
    });

    return {
      shops,
      count: shops.length,
    };
  }

  // For specific user, return only their allowed shops
  const user = await prisma.user.findUnique({
    where: {
      id: userId, // Changed from userId to id
    },
    include: {
      branch: true,
      shops: true, // Include all shops assigned to the user
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  return {
    shops: user.shops,
    count: user.shops.length,
  };
};

// Create Shop
const createShop = async (shopBody) => {
  // Check if shop with same name already exists
  if (await getShopByName(shopBody.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Shop name already taken');
  }

  // Validate branch exists
  const branchExists = await prisma.branch.findUnique({
    where: { id: shopBody.branchId },
  });
  if (!branchExists) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Branch not found');
  }

  const shop = await prisma.shop.create({
    data: shopBody,
    include: {
      branch: true,
    },
  });
  return shop;
};

// Update Shop
const updateShop = async (id, updateBody) => {
  const existingShop = await getShopById(id);
  if (!existingShop) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Shop not found');
  }

  // Check if name is being updated to an existing shop name
  if (updateBody.name && updateBody.name !== existingShop.name) {
    if (await getShopByName(updateBody.name)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Shop name already taken');
    }
  }

  // Validate branch exists if being updated
  if (updateBody.branchId) {
    const branchExists = await prisma.branch.findUnique({
      where: { id: updateBody.branchId },
    });
    if (!branchExists) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Branch not found');
    }
  }

  const updatedShop = await prisma.shop.update({
    where: { id },
    data: updateBody,
    include: {
      branch: true,
    },
  });

  return updatedShop;
};

// Delete Shop getAllShopsbaseduser
const deleteShop = async (id) => {
  const existingShop = await getShopById(id);
  if (!existingShop) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Shop not found');
  }

  await prisma.shop.delete({
    where: { id },
  });

  return { message: 'Shop deleted successfully' };
};
const UsergetAvailableBatchesByProductAndShop = async (productId, userId) => {
  // First, get the user with their allowed shops

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      shops: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Extract shop IDs from user's allowed shops
  const userShopIds = user.shops.map((shop) => shop.id);

  if (userShopIds.length === 0) {
    return {
      batches: [],
      count: 0,
    };
  }

  // Check if the requested product exists
  const productExists = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });

  if (!productExists) {
    return {
      batches: [],
      count: 0,
    };
  }

  // Get batches available in any of the user's allowed shops
  const batches = await prisma.productBatch.findMany({
    where: {
      productId,
      ShopStock: {
        some: {
          shopId: {
            in: userShopIds,
          },
          status: 'Available',
          quantity: {
            gt: 0,
          },
        },
      },
    },
    orderBy: [{ expiryDate: 'asc' }, { batchNumber: 'asc' }],
    include: {
      product: {
        include: {
          unitOfMeasure: true,
          category: true,
          subCategory: true,
        },
      },
      store: true,
      AdditionalPrice: {
        where: {
          OR: [{ shopId: { in: userShopIds } }, { shopId: null }],
        },
      },
      ShopStock: {
        where: {
          shopId: {
            in: userShopIds,
          },
          status: 'Available',
          quantity: {
            gt: 0,
          },
        },
        include: {
          unitOfMeasure: true,
        },
      },
    },
  });

  return {
    batches,
    count: batches.length,
  };
};
const getAvailableBatchesByProductAndShop = async (productId, shopId) => {
  try {
    // Check if the requested product exists
    const productExists = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });

    if (!productExists) {
      return {
        batches: [],
        additionalPrices: [],
        count: 0,
      };
    }

    // Check if shop exists
    const shopExists = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true },
    });

    if (!shopExists) {
      return {
        batches: [],
        additionalPrices: [],
        count: 0,
      };
    }

    // Get additional prices for this product and shop
    const additionalPrices = await prisma.additionalPrice.findMany({
      where: {
        productId,
        OR: [
          { shopId }, // Shop-specific additional prices
          { shopId: null }, // Global additional prices
        ],
      },
      orderBy: {
        price: 'asc',
      },
    });

    // Main query for batches
    const batches = await prisma.productBatch.findMany({
      where: {
        productId,
        ShopStock: {
          some: {
            shopId,
            status: 'Available',
            quantity: {
              gt: 0,
            },
          },
        },
      },
      orderBy: [{ expiryDate: 'asc' }, { batchNumber: 'asc' }],
      include: {
        product: {
          include: {
            unitOfMeasure: true,
            category: true,
            subCategory: true,
          },
        },
        store: true,
        ShopStock: {
          where: {
            shopId,
            status: 'Available',
          },
          include: {
            unitOfMeasure: true,
          },
        },
      },
    });

    return {
      batches,
      additionalPrices,
      count: batches.length,
    };
  } catch (error) {
    console.error('💥 Error in getAvailableBatchesByProductAndShop:', error);
    throw error;
  }
};
module.exports = {
  getShopById,
  getAllshop,
  getShopByName,
  getAllShops,
  createShop,
  updateShop,
  deleteShop,
  getAvailableBatchesByProductAndShop,
  getAllShopsbaseduser,
  UsergetAvailableBatchesByProductAndShop,
};
