const httpStatus = require('http-status');
const { subMonths } = require('date-fns');

const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

const getProductBatchById = async (batchId) => {
  if (!batchId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Batch ID is required');
  }

  const productBatch = await prisma.productBatch.findUnique({
    where: { id: batchId },
    include: {
      product: {},
      StockLedger: {
        orderBy: {
          movementDate: 'desc',
        },
        take: 10,
      },
      StoreStock: true,
    },
  });

  if (!productBatch) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product batch not found');
  }

  return productBatch;
};

const getAllProductBatches = async ({ startDate, endDate } = {}) => {
  const whereClause = {};
  const twelveMonthsAgo = subMonths(new Date(), 12); // Default to last 12 months

  // Convert string dates to Date objects if they exist
  const startDateObj = startDate ? new Date(startDate) : undefined;
  const endDateObj = endDate ? new Date(endDate) : undefined;

  // Filter by createdAt (batch creation date)
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
      gte: twelveMonthsAgo,
      lte: endDateObj,
    };
  } else {
    whereClause.createdAt = {
      gte: twelveMonthsAgo,
    };
  }

  const productBatches = await prisma.productBatch.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    include: {
      product: {
        select: {
          name: true,
          productCode: true,
        },
      },
      store: {
        select: {
          name: true,
        },
      },
      StoreStock: true,
      ShopStock: true,
    },
  });

  return {
    productBatches,
    count: productBatches.length,
  };
};
const getProductBatches = async (productId, shopId) => {
  const productBatches = await prisma.productBatch.findMany({
    where: {
      productId,
      ShopStock: {
        some: {
          shopId,
          quantity: {
            gt: 0, // Stock not zero
          },
          status: 'Available', // Only available stock
          batch: {
            expiryDate: {
              gt: new Date(), // Not expired (expiry date greater than current date)
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      product: {
        select: {
          name: true,
          productCode: true,
          unitOfMeasure: true,
          sellPrice: true,
        },
      },
      ShopStock: {
        where: {
          shopId,
          quantity: { gt: 0 },
          status: 'Available',
        },
        include: {
          unitOfMeasure: true,
        },
      },
    },
  });

  return {
    productBatches,
    count: productBatches.length,
  };
};

const deleteProductBatch = async (batchId, userId) => {
  if (!batchId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Batch ID is required');
  }

  // Check if batch exists and get current stock
  const existingBatch = await prisma.productBatch.findUnique({
    where: { id: batchId },
    include: {
      StoreStock: true,
    },
  });

  if (!existingBatch) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product batch not found');
  }

  // Check if batch has any stock transactions or is referenced elsewhere
  const hasTransactions = await prisma.stockLedger.count({
    where: { batchId },
  });

  if (hasTransactions > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot delete batch with existing stock transactions',
    );
  }

  // Use transaction to ensure all related data is deleted
  return prisma.$transaction(async (tx) => {
    // Delete additional prices

    // Delete store stock entries
    await tx.storeStock.deleteMany({
      where: { batchId },
    });

    // Delete the batch
    const deletedBatch = await tx.productBatch.delete({
      where: { id: batchId },
    });

    // Create audit log entry
    await tx.auditLog.create({
      data: {
        action: 'DELETE',
        entity: 'ProductBatch',
        entityId: batchId,
        userId,
        details: `Deleted batch ${deletedBatch.batchNumber} with stock: ${deletedBatch.stock}`,
      },
    });

    return deletedBatch;
  });
};
const getProductBatchByBatchNumber = async (batchNumber) => {
  const batch = await prisma.productBatch.findFirst({
    where: {
      batchNumber,
    },
  });
  return !!batch;
};
const createProductBatchWithAdditionalPrices = async (productBatchBody) => {
  // Check if product batch with same batch number already exists
  if (await getProductBatchByBatchNumber(productBatchBody.batchNumber)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Batch number already exists');
  }

  // Optional: Validate that the product exists
  const product = await prisma.product.findUnique({
    where: {
      id: productBatchBody.productId,
    },
  });

  if (!product) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Product does not exist');
  }

  // Format the expiryDate if provided and create a copy without additionalPrices
  const { ...batchData } = productBatchBody;

  const formattedData = {
    ...batchData,
    expiryDate: batchData.expiryDate
      ? new Date(batchData.expiryDate).toISOString()
      : undefined,
  };

  // Create product batch with additional prices
  const productBatch = await prisma.productBatch.create({
    data: {
      ...formattedData,
      // Include additional prices if provided - use AdditionalPrice instead of additionalPrices
    },
  });

  return productBatch;
};

const updateProductBatchWithAdditionalPrices = async (batchId, updateBody) => {
  // Check if product batch exists
  const existingBatch = await prisma.productBatch.findUnique({
    where: { id: batchId },
  });

  if (!existingBatch) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product batch not found');
  }

  // Separate additionalPrices from the rest of the update data
  const { ...batchData } = updateBody;

  // Format the expiryDate if provided
  const formattedData = {
    ...batchData,
    expiryDate: batchData.expiryDate
      ? new Date(batchData.expiryDate).toISOString()
      : undefined,
  };

  // Handle additional prices update

  const updatedBatch = await prisma.productBatch.update({
    where: { id: batchId },
    data: {
      ...formattedData,
    },
  });

  return updatedBatch;
};

const getProductByStoreStock = async (storeId) => {
  try {
    const storeStocks = await prisma.storeStock.findMany({
      where: {
        storeId,
      },
      include: {
        product: {
          include: {
            category: true,
            colour: true,
            unitOfMeasure: true,
          },
        },
        store: true,
        unitOfMeasure: true,
        variants: {
          where: {
            quantity: {
              gt: 0, // 👈 ONLY FETCH VARIANTS WITH QUANTITY > 0
            },
          },
          orderBy: [{ height: 'asc' }, { width: 'asc' }],
        },
      },
    });

    if (!storeStocks || storeStocks.length === 0) {
      return [];
    }

    const result = storeStocks
      .filter((stock) => stock.product) // Only include stocks with valid products
      .map((storeStock) => {
        const { product } = storeStock;

        const hasVariants =
          storeStock.variants && storeStock.variants.length > 0;

        const availableQuantity = hasVariants
          ? storeStock.variants.reduce((sum, v) => sum + v.quantity, 0)
          : storeStock.quantity || 0;

        const totalArea = hasVariants
          ? storeStock.variants.reduce(
              (sum, v) => sum + v.height * v.width * v.quantity,
              0,
            )
          : null;

        return {
          id: storeStock.id,
          storeId: storeStock.storeId,
          productId: storeStock.productId,
          quantity: storeStock.quantity,
          status: storeStock.status,
          createdAt: storeStock.createdAt,
          updatedAt: storeStock.updatedAt,

          store: {
            id: storeStock.store.id,
            name: storeStock.store.name,
            branchId: storeStock.store.branchId,
          },

          product: {
            id: product.id,
            productCode: product.productCode,
            name: product.name,
            generic: product.generic,
            description: product.description,
            sellPrice: product.sellPrice,
            imageUrl: product.imageUrl,
            isActive: product.isActive,
            warningQuantity: product.warningQuantity,
            category: product.category,
            colour: product.colour,
            unitOfMeasure: product.unitOfMeasure,
          },

          unitOfMeasure: storeStock.unitOfMeasure,

          availableQuantity,
          totalArea,
          conversionFactor: storeStock.unitOfMeasure?.conversionFactor || 1,

          variants: hasVariants
            ? storeStock.variants.map((variant) => ({
                id: variant.id,
                height: variant.height,
                width: variant.width,
                quantity: variant.quantity,
                area: variant.height * variant.width,
                totalArea: variant.height * variant.width * variant.quantity,
              }))
            : [],

          stockType: hasVariants ? 'dimension' : 'quantity',
          hasVariants,
          variantCount: hasVariants ? storeStock.variants.length : 0,
          uniqueDimensions: hasVariants
            ? storeStock.variants.map((v) => `${v.height}x${v.width}`)
            : [],
        };
      })
      .filter((item) => item.availableQuantity > 0); // 👈 FILTER OUT PRODUCTS WITH ZERO TOTAL STOCK

    return result;
  } catch (error) {
    console.error('Error in getProductByStoreStock:', error);
    throw error;
  }
};
// Similar improvements for getProductByShopStock
const getProductByShopStock = async (shopId) => {
  try {
    const shopStocks = await prisma.shopStock.findMany({
      where: {
        shopId,
      },
      include: {
        product: {
          include: {
            category: true,
            colour: true,
            unitOfMeasure: true,
            curtainType: true,
            AdditionalPrice: {
              where: {
                OR: [{ shopId }, { shopId: null }],
              },
            },
          },
        },
        shop: {
          include: {
            branch: true,
          },
        },
        unitOfMeasure: true,
        variants: {
          where: {
            quantity: {
              gt: 0, // 👈 ONLY FETCH VARIANTS WITH QUANTITY > 0
            },
          },
          orderBy: [{ height: 'asc' }, { width: 'asc' }],
        },
      },
    });

    if (!shopStocks || shopStocks.length === 0) {
      return [];
    }

    const result = shopStocks
      .filter((stock) => stock.product)
      .map((shopStock) => {
        const { product, shop } = shopStock;

        const hasVariants = shopStock.variants && shopStock.variants.length > 0;

        const availableQuantity = hasVariants
          ? shopStock.variants.reduce((sum, v) => sum + v.quantity, 0)
          : shopStock.quantity || 0;

        const totalArea = hasVariants
          ? shopStock.variants.reduce(
              (sum, v) => sum + v.height * v.width * v.quantity,
              0,
            )
          : null;

        const calculateFinalPrice = () => {
          const basePrice = parseFloat(product.sellPrice || 0);
          const applicablePrices = product.AdditionalPrice.filter(
            (price) => price.shopId === shopId || price.shopId === null,
          );
          const additionalTotal = applicablePrices.reduce((sum, price) => {
            return sum + parseFloat(price.price || 0);
          }, 0);
          return basePrice + additionalTotal;
        };

        const isCurtainProduct =
          product.category?.name?.toLowerCase().includes('curtain') ||
          product.curtainType !== null;

        return {
          id: shopStock.id,
          shopId: shopStock.shopId,
          productId: shopStock.productId,
          quantity: shopStock.quantity,
          status: shopStock.status,
          createdAt: shopStock.createdAt,
          updatedAt: shopStock.updatedAt,

          shop: {
            id: shop.id,
            name: shop.name,
            branchId: shop.branchId,
            branch: shop.branch
              ? {
                  id: shop.branch.id,
                  name: shop.branch.name,
                  address: shop.branch.address,
                  phone: shop.branch.phone,
                  email: shop.branch.email,
                }
              : null,
          },

          product: {
            id: product.id,
            productCode: product.productCode,
            name: product.name,
            generic: product.generic,
            description: product.description,
            sellPrice: product.sellPrice,
            imageUrl: product.imageUrl,
            isActive: product.isActive,
            warningQuantity: product.warningQuantity,
            fabricName: product.fabricName,
            thickCurtain: product.thickCurtain,
            thinCurtain: product.thinCurtain,
            pullsCurtain: product.pullsCurtain,
            poleCurtain: product.poleCurtain,
            bracketsCurtain: product.bracketsCurtain,
            shatterVertical: product.shatterVertical,
            pricePerMeter: product.pricePerMeter,
            category: product.category,
            colour: product.colour,
            curtainType: product.curtainType,
            unitOfMeasure: product.unitOfMeasure,
            additionalPrices: product.AdditionalPrice.map((price) => ({
              id: price.id,
              label: price.label,
              price: price.price,
              shopId: price.shopId,
            })),
          },

          unitOfMeasure: shopStock.unitOfMeasure,
          availableQuantity,
          totalArea,
          finalSellPrice: calculateFinalPrice(),
          isCurtainProduct,
          unitOfMeasureMatches:
            shopStock.unitOfMeasureId === product.unitOfMeasureId,

          variants: hasVariants
            ? shopStock.variants.map((variant) => ({
                id: variant.id,
                height: variant.height,
                width: variant.width,
                quantity: variant.quantity,
                area: variant.height * variant.width,
                totalArea: variant.height * variant.width * variant.quantity,
              }))
            : [],

          stockType: hasVariants ? 'dimension' : 'quantity',
          hasVariants,
          variantCount: hasVariants ? shopStock.variants.length : 0,
          uniqueDimensions: hasVariants
            ? shopStock.variants.map((v) => `${v.height}x${v.width}`)
            : [],
        };
      })
      .filter((item) => item.availableQuantity > 0); // 👈 FILTER OUT PRODUCTS WITH ZERO TOTAL STOCK

    return result;
  } catch (error) {
    console.error('Error in getProductByShopStock:', error);
    if (error.code) console.error('Error code:', error.code);
    if (error.meta) console.error('Error meta:', error.meta);
    throw new Error(
      `Failed to fetch products for shop ${shopId}: ${error.message}`,
    );
  }
};

const getProductInfoByBatchId = async (batchId) => {
  const batch = await prisma.productBatch.findUnique({
    where: { id: batchId },
    select: {
      product: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!batch || !batch.product) return null;

  return { id: batch.product.id, name: batch.product.name };
};

module.exports = {
  getProductBatchById,
  getAllProductBatches,
  deleteProductBatch,
  createProductBatchWithAdditionalPrices,
  updateProductBatchWithAdditionalPrices,
  getProductByStoreStock,
  getProductByShopStock,
  getProductInfoByBatchId,
  getProductBatches,
};
