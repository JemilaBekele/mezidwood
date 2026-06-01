/* eslint-disable no-underscore-dangle */
// services/sellService.js
const { subMonths, startOfDay, endOfDay } = require('date-fns');
const prisma = require('./prisma');

const getSellTrend = async (filters = {}) => {
  const { branchId, startDate, endDate } = filters;

  // Build where clause
  const whereClause = {};

  if (branchId) {
    whereClause.branchId = branchId;
  }

  if (startDate && endDate) {
    whereClause.saleDate = {
      gte: new Date(startDate),
      lte: new Date(endDate),
    };
  }

  // Get all sells and group by year+month
  const sells = await prisma.sell.findMany({
    where: whereClause,
    select: {
      saleDate: true,
      NetTotal: true,
    },
    orderBy: {
      saleDate: 'asc',
    },
  });

  // Reduce into month-year buckets
  const monthlyTotals = {};

  sells.forEach((s) => {
    const date = new Date(s.saleDate);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      '0',
    )}`; // e.g. "2025-09"
    monthlyTotals[key] = (monthlyTotals[key] || 0) + (s.NetTotal ?? 0);
  });

  // Convert into chart-friendly data
  const chartData = Object.entries(monthlyTotals)
    .map(([key, total]) => {
      const [year, month] = key.split('-').map(Number);
      return {
        month: new Date(year, month - 1).toLocaleString('default', {
          month: 'long',
          year: 'numeric',
        }),
        total: parseFloat(total.toFixed(2)),
        year,
        monthNumber: month,
      };
    })
    .sort((a, b) => {
      // Sort by year and month
      if (a.year !== b.year) return a.year - b.year;
      return a.monthNumber - b.monthNumber;
    });

  return chartData;
};

const getTotalSold = async ({
  startDate,
  endDate,
  branchId,
  saleStatus,
} = {}) => {
  // Convert incoming strings (if any) to Date objects
  const startDateObj = startDate ? new Date(startDate) : null;
  const endDateObj = endDate ? new Date(endDate) : null;

  // Build where clause dynamically
  const whereClause = {};

  if (startDateObj && endDateObj) {
    whereClause.saleDate = { gte: startDateObj, lte: endDateObj };
  } else if (startDateObj) {
    whereClause.saleDate = { gte: startDateObj };
  } else if (endDateObj) {
    whereClause.saleDate = { lte: endDateObj };
  }

  if (branchId) {
    whereClause.branchId = branchId;
  }

  if (saleStatus) {
    whereClause.saleStatus = saleStatus;
  }

  // Aggregate NetTotal sum
  const result = await prisma.sell.aggregate({
    where: whereClause,
    _sum: {
      NetTotal: true,
    },
    _count: {
      id: true,
    },
  });

  return {
    totalSold: result._sum.NetTotal ?? 0,
    totalSales: result._count.id ?? 0,
    startDate: startDateObj,
    endDate: endDateObj,
  };
};

const getAllSells = async ({
  startDate,
  endDate,
  createdById,
  customerId,
  branchId,
  saleStatus,
  itemSaleStatus,
} = {}) => {
  const whereClause = {};
  const twelveMonthsAgo = subMonths(new Date(), 12); // Default time range

  // Convert string dates to Date objects if they exist
  const startDateObj = startDate ? new Date(startDate) : undefined;
  const endDateObj = endDate ? new Date(endDate) : undefined;

  // Build the date filter
  if (startDateObj && endDateObj) {
    whereClause.saleDate = {
      gte: startDateObj,
      lte: endDateObj,
    };
  } else if (startDateObj) {
    whereClause.saleDate = {
      gte: startDateObj,
      lte: new Date(),
    };
  } else if (endDateObj) {
    whereClause.saleDate = {
      gte: twelveMonthsAgo,
      lte: endDateObj,
    };
  } else {
    whereClause.saleDate = {
      gte: twelveMonthsAgo,
    };
  }

  // Add createdBy filter if provided
  if (createdById) {
    whereClause.createdById = createdById;
  }

  // Add customer filter if provided
  if (customerId) {
    whereClause.customerId = customerId;
  }

  // Add branch filter if provided
  if (branchId) {
    whereClause.branchId = branchId;
  }

  // Add saleStatus filter if provided
  if (saleStatus) {
    whereClause.saleStatus = saleStatus;
  }

  // Build items include with optional itemSaleStatus filter
  const itemsInclude = {
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
  };

  // Add itemSaleStatus filter to items if provided
  if (itemSaleStatus) {
    itemsInclude.where = {
      itemSaleStatus,
    };
  }

  const sells = await prisma.sell.findMany({
    where: whereClause,
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      branch: true,
      customer: true,
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      updatedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      items: itemsInclude,
      _count: {
        select: { items: true },
      },
    },
  });

  return {
    sells,
    count: sells.length,
  };
};

/**
 * Service to generate sales reports including:
 * - Top items by quantity sold
 * - Top items by revenue
 * - Slow-moving items
 * - Top sellers (users)
 */
const generateSalesReports = async ({
  startDate,
  endDate,
  shopId,
  branchId,
  limit = 10,
  slowMoveThreshold = 10,
} = {}) => {
  // Default date range: last 12 months
  const twelveMonthsAgo = subMonths(new Date(), 12);

  // Convert string dates to Date objects if they exist
  const startDateObj = startDate
    ? startOfDay(new Date(startDate))
    : startOfDay(twelveMonthsAgo);
  const endDateObj = endDate
    ? endOfDay(new Date(endDate))
    : endOfDay(new Date());

  const dateFilter = {
    gte: startDateObj,
    lte: endDateObj,
  };

  // Base where clause for sells
  const sellWhereClause = {
    saleDate: dateFilter,
    saleStatus: {
      in: ['APPROVED', 'DELIVERED', 'PARTIALLY_DELIVERED'],
    },
  };

  // Add branch filter if provided
  if (branchId) {
    sellWhereClause.branchId = branchId;
  }

  try {
    // Get ALL products with their sales data first
    const allProductsSales = await prisma.sellItem.groupBy({
      by: ['productId'],
      where: {
        sell: sellWhereClause,
        ...(shopId && { shopId }),
        itemSaleStatus: 'DELIVERED',
      },
      _sum: {
        quantity: true,
        totalPrice: true,
      },
      orderBy: {
        _sum: {
          quantity: 'desc',
        },
      },
    });

    if (allProductsSales.length === 0) {
      return {
        reportPeriod: {
          startDate: startDateObj,
          endDate: endDateObj,
        },
        filters: {
          shopId,
          branchId,
          limit,
          slowMoveThreshold,
        },
        summary: {
          totalItemsAnalyzed: 0,
          totalSellers: 0,
          totalSlowMovingItems: 0,
          totalTopItems: 0,
        },
        reports: {
          topItemsByQuantity: [],
          topItemsByRevenue: [],
          topItemsByValue: [],
          slowMovingItems: [],
          topSellers: [],
        },
      };
    }

    // 1. Top Items by Quantity - Take the top N items by quantity
    const topItemsByQuantity = allProductsSales
      .filter((item) => (item._sum.quantity || 0) > 0)
      .slice(0, limit);

    // 2. Top Items by Revenue - Sort by revenue and take top N
    const topItemsByRevenue = [...allProductsSales]
      .filter((item) => (item._sum.totalPrice || 0) > 0)
      .sort((a, b) => (b._sum.totalPrice || 0) - (a._sum.totalPrice || 0))
      .slice(0, limit);

    // 3. Slow Moving Items - Exclude top items and get items with low quantities
    const topProductIds = new Set(
      topItemsByQuantity.map((item) => item.productId),
    );

    const slowMovingItems = allProductsSales
      .filter((item) => (item._sum.quantity || 0) > 0) // Exclude zero quantities
      .filter((item) => (item._sum.quantity || 0) <= slowMoveThreshold) // Below threshold
      .filter((item) => !topProductIds.has(item.productId)) // Exclude top items
      .sort((a, b) => (a._sum.quantity || 0) - (b._sum.quantity || 0)) // Sort by lowest quantity first
      .slice(0, limit);

    // 4. Top Sellers (Users with most sales)
    const topSellers = await prisma.sell.groupBy({
      by: ['createdById'],
      where: sellWhereClause,
      _sum: {
        NetTotal: true,
        grandTotal: true,
      },
      _count: {
        id: true,
      },
      orderBy: {
        _sum: {
          NetTotal: 'desc',
        },
      },
      take: limit,
    });

    // Get batch-level data for detailed reporting
    const batchSalesData = await prisma.sellItemBatch.groupBy({
      by: ['batchId'],
      where: {
        sellItem: {
          sell: sellWhereClause,
          ...(shopId && { shopId }),
          itemSaleStatus: 'DELIVERED',
        },
      },
      _sum: {
        quantity: true,
      },
    });

    // Enrich product data
    const enrichProductData = async (productGroups) => {
      const productIds = productGroups
        .map((item) => item.productId)
        .filter((id) => id);

      if (productIds.length === 0) return [];

      const products = await prisma.product.findMany({
        where: {
          id: { in: productIds },
        },
        include: {
          category: true,
          subCategory: true,
          unitOfMeasure: true,
          batches: {
            include: {
              product: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
            take: 1, // Get only the most recent batch for display
          },
        },
      });

      return productGroups.map((item) => {
        const product = products.find((p) => p.id === item.productId);
        const latestBatch = product?.batches?.[0] || null;

        // Calculate average price per unit
        const avgPrice =
          item._sum.quantity > 0
            ? (item._sum.totalPrice || 0) / item._sum.quantity
            : 0;

        return {
          productId: item.productId,
          product: product || null,
          quantity: item._sum.quantity || 0,
          revenue: item._sum.totalPrice || 0,
          avgPrice: parseFloat(avgPrice.toFixed(2)),
          batchNumber: latestBatch?.batchNumber || 'N/A',
          expiryDate: latestBatch?.expiryDate || null,
          category: product?.category?.name || 'N/A',
          valueScore:
            (item._sum.quantity || 0) * parseFloat(avgPrice.toFixed(2)),
        };
      });
    };

    // Enrich seller data with user information
    const enrichSellerData = async (sellerGroups) => {
      const userIds = sellerGroups
        .map((seller) => seller.createdById)
        .filter((id) => id);

      if (userIds.length === 0) return [];

      const users = await prisma.user.findMany({
        where: {
          id: { in: userIds },
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });

      return sellerGroups.map((seller) => {
        const user = users.find((u) => u.id === seller.createdById);
        return {
          userId: seller.createdById,
          user: user || null,
          totalRevenue: seller._sum.NetTotal || 0,
          totalGrossRevenue: seller._sum.grandTotal || 0,
          totalOrders: seller._count.id || 0,
        };
      });
    };

    // Execute all enrichment in parallel
    const [
      enrichedTopItemsByQuantity,
      enrichedTopItemsByRevenue,
      enrichedSlowMovingItems,
      enrichedTopSellers,
    ] = await Promise.all([
      enrichProductData(topItemsByQuantity),
      enrichProductData(topItemsByRevenue),
      enrichProductData(slowMovingItems),
      enrichSellerData(topSellers),
    ]);

    // 5. Top Items by Value (combining quantity and revenue)
    const topItemsByValue = [...enrichedTopItemsByQuantity]
      .sort((a, b) => b.valueScore - a.valueScore)
      .slice(0, limit);

    return {
      reportPeriod: {
        startDate: startDateObj,
        endDate: endDateObj,
      },
      filters: {
        shopId,
        branchId,
        limit,
        slowMoveThreshold,
      },
      summary: {
        totalItemsAnalyzed: allProductsSales.length,
        totalSellers: enrichedTopSellers.length,
        totalSlowMovingItems: enrichedSlowMovingItems.length,
        totalTopItems: enrichedTopItemsByQuantity.length,
        totalProducts: allProductsSales.length,
      },
      reports: {
        topItemsByQuantity: enrichedTopItemsByQuantity,
        topItemsByRevenue: enrichedTopItemsByRevenue,
        topItemsByValue,
        slowMovingItems: enrichedSlowMovingItems,
        topSellers: enrichedTopSellers,
      },
    };
  } catch (error) {
    throw new Error(`Failed to generate sales reports: ${error.message}`);
  }
};

// service/dashboardService.js

/**
 * Get count of approved sales items waiting to be delivered
 * Filtered by user ID and shop ID
 */

const getUserDashboardSummary = async (userId) => {
  try {
    // Get user with shops, stores, and counts in a single query
    const userWithData = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        shops: {
          select: {
            id: true,
            name: true,
          },
        },
        stores: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            shops: true,
            stores: true,
          },
        },
      },
    });

    if (!userWithData) {
      throw new Error('User not found');
    }

    const userShopIds = userWithData.shops.map((shop) => shop.id);
    const userStoreIds = userWithData.stores.map((store) => store.id);

    // Early return if user has no shops or stores
    if (userShopIds.length === 0 && userStoreIds.length === 0) {
      return {
        userShopsCount: 0,
        userStoresCount: 0,
        approvedSalesCount: 0,
        pendingDelivery: {
          totalItems: 0,
          shopsWithPending: 0,
          breakdown: [],
        },
        stockAlerts: {
          lowStockProducts: [],
          expiredProducts: [],
          expiringSoonProducts: [],
        },
        shopStockSummary: [],
        storeStockSummary: [],
      };
    }

    // Get pending delivery counts by shop - Updated for new model
    const pendingDeliveryData = await prisma.sellItem.groupBy({
      by: ['shopId'],
      where: {
        shopId: {
          in: userShopIds,
        },
        itemSaleStatus: 'PENDING',
        sell: {
          saleStatus: 'APPROVED',
        },
      },
      _count: {
        id: true,
      },
    });

    // Get approved sales count - Updated for new model
    const approvedSalesCount = await prisma.sell.count({
      where: {
        items: {
          some: {
            shopId: {
              in: userShopIds,
            },
          },
        },
        saleStatus: 'APPROVED',
      },
    });

    // Calculate date for 1 year from now for expiry alerts
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    // Get shop stock summary with expiry and low stock alerts
    const shopStockSummary = await prisma.shopStock.findMany({
      where: {
        shopId: {
          in: userShopIds,
        },
        quantity: {
          gt: 0,
        },
      },
      include: {
        shop: {
          select: {
            name: true,
          },
        },
        batch: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                productCode: true,
              },
            },
          },
        },
        unitOfMeasure: {
          select: {
            name: true,
            symbol: true,
          },
        },
      },
    });

    // Get store stock summary with expiry and low stock alerts
    const storeStockSummary = await prisma.storeStock.findMany({
      where: {
        storeId: {
          in: userStoreIds,
        },
        quantity: {
          gt: 0,
        },
      },
      include: {
        store: {
          select: {
            name: true,
          },
        },
        batch: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                productCode: true,
              },
            },
          },
        },
        unitOfMeasure: {
          select: {
            name: true,
            symbol: true,
          },
        },
      },
    });

    // Get sales statistics for user's shops
    const salesStats = await prisma.sell.aggregate({
      where: {
        items: {
          some: {
            shopId: {
              in: userShopIds,
            },
          },
        },
        saleStatus: {
          in: ['APPROVED', 'DELIVERED', 'PARTIALLY_DELIVERED'],
        },
      },
      _sum: {
        grandTotal: true,
        NetTotal: true,
        subTotal: true,
      },
      _count: {
        id: true,
      },
    });

    // Get delivered items count for user's shops
    const deliveredItemsCount = await prisma.sellItem.count({
      where: {
        shopId: {
          in: userShopIds,
        },
        itemSaleStatus: 'DELIVERED',
      },
    });

    // Create shop map for easy lookup
    const shopMap = userWithData.shops.reduce((acc, shop) => {
      acc[shop.id] = shop;
      return acc;
    }, {});

    // Format pending items breakdown
    const pendingItemsByShop = pendingDeliveryData.map((item) => ({
      shopId: item.shopId,
      shopName: shopMap[item.shopId]?.name || 'Unknown Shop',
      pendingCount: item._count.id,
    }));

    const totalPendingItems = pendingDeliveryData.reduce(
      (total, item) => total + item._count.id,
      0,
    );

    // Analyze stock for alerts
    const lowStockProducts = [];
    const expiredProducts = [];
    const expiringSoonProducts = [];

    const now = new Date();

    // Check shop stocks
    shopStockSummary.forEach((stock) => {
      const productInfo = {
        id: stock.batch.product.id,
        name: stock.batch.product.name,
        productCode: stock.batch.product.productCode,
        batchId: stock.batch.id,
        batchNumber: stock.batch.batchNumber,
        location: 'shop',
        locationName: stock.shop.name,
        quantity: stock.quantity,
        unit: stock.unitOfMeasure.symbol || stock.unitOfMeasure.name,
        expiryDate: stock.batch.expiryDate,
        warningQuantity: stock.batch.warningQuantity || 0,
      };

      // Check for low stock
      if (
        stock.batch.warningQuantity &&
        stock.quantity <= stock.batch.warningQuantity
      ) {
        lowStockProducts.push({
          ...productInfo,
          alertType: 'LOW_STOCK',
          message: `Low stock alert: Only ${stock.quantity} ${stock.unitOfMeasure.symbol} remaining`,
        });
      }

      // Check for expiry
      if (stock.batch.expiryDate) {
        if (stock.batch.expiryDate <= now) {
          expiredProducts.push({
            ...productInfo,
            alertType: 'EXPIRED',
            message: `Product expired on ${stock.batch.expiryDate.toLocaleDateString()}`,
          });
        } else if (stock.batch.expiryDate <= oneYearFromNow) {
          expiringSoonProducts.push({
            ...productInfo,
            alertType: 'EXPIRING_SOON',
            message: `Product expires on ${stock.batch.expiryDate.toLocaleDateString()}`,
          });
        }
      }

      // Check for zero stock (sold out)
      if (stock.quantity === 0) {
        lowStockProducts.push({
          ...productInfo,
          alertType: 'OUT_OF_STOCK',
          message: 'Product is out of stock',
        });
      }
    });

    // Check store stocks
    storeStockSummary.forEach((stock) => {
      const productInfo = {
        id: stock.batch.product.id,
        name: stock.batch.product.name,
        productCode: stock.batch.product.productCode,
        batchId: stock.batch.id,
        batchNumber: stock.batch.batchNumber,
        location: 'store',
        locationName: stock.store.name,
        quantity: stock.quantity,
        unit: stock.unitOfMeasure.symbol || stock.unitOfMeasure.name,
        expiryDate: stock.batch.expiryDate,
        warningQuantity: stock.batch.warningQuantity || 0,
      };

      // Check for low stock
      if (
        stock.batch.warningQuantity &&
        stock.quantity <= stock.batch.warningQuantity
      ) {
        lowStockProducts.push({
          ...productInfo,
          alertType: 'LOW_STOCK',
          message: `Low stock alert: Only ${stock.quantity} ${stock.unitOfMeasure.symbol} remaining`,
        });
      }

      // Check for expiry
      if (stock.batch.expiryDate) {
        if (stock.batch.expiryDate <= now) {
          expiredProducts.push({
            ...productInfo,
            alertType: 'EXPIRED',
            message: `Product expired on ${stock.batch.expiryDate.toLocaleDateString()}`,
          });
        } else if (stock.batch.expiryDate <= oneYearFromNow) {
          expiringSoonProducts.push({
            ...productInfo,
            alertType: 'EXPIRING_SOON',
            message: `Product expires on ${stock.batch.expiryDate.toLocaleDateString()}`,
          });
        }
      }

      // Check for zero stock
      if (stock.quantity === 0) {
        lowStockProducts.push({
          ...productInfo,
          alertType: 'OUT_OF_STOCK',
          message: 'Product is out of stock',
        });
      }
    });

    // Format shop stock summary for response
    const formattedShopStock = shopStockSummary.map((stock) => ({
      shopId: stock.shopId,
      shopName: stock.shop.name,
      productId: stock.batch.product.id,
      productName: stock.batch.product.name,
      productCode: stock.batch.product.productCode,
      batchId: stock.batch.id,
      batchNumber: stock.batch.batchNumber,
      quantity: stock.quantity,
      unit: stock.unitOfMeasure.symbol || stock.unitOfMeasure.name,
      status: stock.status,
      expiryDate: stock.batch.expiryDate,
      hasExpiryAlert:
        stock.batch.expiryDate && stock.batch.expiryDate <= oneYearFromNow,
      hasLowStockAlert:
        stock.batch.warningQuantity &&
        stock.quantity <= stock.batch.warningQuantity,
    }));

    // Format store stock summary for response
    const formattedStoreStock = storeStockSummary.map((stock) => ({
      storeId: stock.storeId,
      storeName: stock.store.name,
      productId: stock.batch.product.id,
      productName: stock.batch.product.name,
      productCode: stock.batch.product.productCode,
      batchId: stock.batch.id,
      batchNumber: stock.batch.batchNumber,
      quantity: stock.quantity,
      unit: stock.unitOfMeasure.symbol || stock.unitOfMeasure.name,
      status: stock.status,
      expiryDate: stock.batch.expiryDate,
      hasExpiryAlert:
        stock.batch.expiryDate && stock.batch.expiryDate <= oneYearFromNow,
      hasLowStockAlert:
        stock.batch.warningQuantity &&
        stock.quantity <= stock.batch.warningQuantity,
    }));

    const result = {
      userShopsCount: userWithData._count.shops,
      userStoresCount: userWithData._count.stores,
      approvedSalesCount,
      salesStats: {
        totalSales: salesStats._count.id || 0,
        totalRevenue: salesStats._sum.NetTotal || 0,
        totalGrossRevenue: salesStats._sum.grandTotal || 0,
        totalSubTotal: salesStats._sum.subTotal || 0,
        deliveredItemsCount,
      },
      pendingDelivery: {
        totalItems: totalPendingItems,
        shopsWithPending: pendingItemsByShop.length,
        breakdown: pendingItemsByShop,
      },
      stockAlerts: {
        lowStockProducts,
        expiredProducts,
        expiringSoonProducts,
        totalAlerts:
          lowStockProducts.length +
          expiredProducts.length +
          expiringSoonProducts.length,
      },
      shopStockSummary: formattedShopStock,
      storeStockSummary: formattedStoreStock,
      summary: {
        totalProductsInShops: formattedShopStock.length,
        totalProductsInStores: formattedStoreStock.length,
        totalUniqueProducts: [
          ...new Set([
            ...formattedShopStock.map((s) => s.productId),
            ...formattedStoreStock.map((s) => s.productId),
          ]),
        ].length,
        criticalAlerts:
          expiredProducts.length +
          lowStockProducts.filter((p) => p.alertType === 'OUT_OF_STOCK').length,
      },
    };

    return result;
  } catch (error) {
    throw new Error(`Failed to get dashboard summary: ${error.message}`);
  }
};
const getSalesCreatorDashboardSummary = async (userId) => {
  try {
    // Get user with basic info
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Get sales counts by status for this creator
    const salesCounts = await prisma.sell.groupBy({
      by: ['saleStatus'],
      where: {
        createdById: userId,
      },
      _count: {
        id: true,
      },
    });

    // Convert counts to an object for easy access
    const statusCounts = salesCounts.reduce((acc, item) => {
      acc[item.saleStatus] = item._count.id;
      return acc;
    }, {});

    // Get total sales count
    const totalSales = await prisma.sell.count({
      where: {
        createdById: userId,
      },
    });

    // Get recent approved sales (last 10)
    const recentApprovedSales = await prisma.sell.findMany({
      where: {
        createdById: userId,
        saleStatus: 'APPROVED',
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone1: true,
          },
        },
        items: {
          include: {
            product: {
              select: {
                name: true,
              },
            },
            shop: {
              select: {
                name: true,
              },
            },
            batches: {
              include: {
                batch: {
                  select: {
                    batchNumber: true,
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
      take: 10,
    });

    // Get sales statistics for the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentSalesStats = await prisma.sell.groupBy({
      by: ['saleStatus'],
      where: {
        createdById: userId,
        createdAt: {
          gte: thirtyDaysAgo,
        },
      },
      _count: {
        id: true,
      },
    });

    const recentStatusCounts = recentSalesStats.reduce((acc, item) => {
      acc[item.saleStatus] = item._count.id;
      return acc;
    }, {});

    // Get total revenue from approved and delivered sales
    const revenueData = await prisma.sell.aggregate({
      where: {
        createdById: userId,
        saleStatus: {
          in: ['APPROVED', 'DELIVERED', 'PARTIALLY_DELIVERED'],
        },
      },
      _sum: {
        grandTotal: true,
        NetTotal: true,
        subTotal: true,
        discount: true,
        vat: true,
      },
    });

    // Get pending delivery items count for this sales creator
    const pendingDeliveryItems = await prisma.sellItem.count({
      where: {
        sell: {
          createdById: userId,
          saleStatus: 'APPROVED',
        },
        itemSaleStatus: 'PENDING',
      },
    });

    // Get delivered items count for this sales creator
    const deliveredItems = await prisma.sellItem.count({
      where: {
        sell: {
          createdById: userId,
        },
        itemSaleStatus: 'DELIVERED',
      },
    });

    // Format recent sales for the response
    const formattedRecentSales = recentApprovedSales.map((sale) => ({
      id: sale.id,
      invoiceNo: sale.invoiceNo,
      customerName: sale.customer?.name || 'Walk-in Customer',
      customerPhone: sale.customer?.phone1,
      grandTotal: sale.grandTotal,
      netTotal: sale.NetTotal,
      subTotal: sale.subTotal,
      discount: sale.discount,
      vat: sale.vat,
      totalProducts: sale.totalProducts,
      saleDate: sale.saleDate,
      shopNames: [...new Set(sale.items.map((item) => item.shop.name))],
      productNames: [...new Set(sale.items.map((item) => item.product.name))],
      totalItems: sale.items.reduce((sum, item) => sum + item.quantity, 0),
      createdAt: sale.createdAt,
    }));

    const result = {
      userInfo: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      salesOverview: {
        totalSales,
        approved: statusCounts.APPROVED || 0,
        delivered: statusCounts.DELIVERED || 0,
        cancelled: statusCounts.CANCELLED || 0,
        notApproved: statusCounts.NOT_APPROVED || 0,
        partiallyDelivered: statusCounts.PARTIALLY_DELIVERED || 0,
        pendingDeliveryItems,
        deliveredItems,
      },
      recentActivity: {
        last30Days: {
          approved: recentStatusCounts.APPROVED || 0,
          delivered: recentStatusCounts.DELIVERED || 0,
          cancelled: recentStatusCounts.CANCELLED || 0,
          notApproved: recentStatusCounts.NOT_APPROVED || 0,
          partiallyDelivered: recentStatusCounts.PARTIALLY_DELIVERED || 0,
        },
        revenue: {
          grandTotal: revenueData._sum.grandTotal || 0,
          netTotal: revenueData._sum.NetTotal || 0,
          subTotal: revenueData._sum.subTotal || 0,
          totalDiscount: revenueData._sum.discount || 0,
          totalVat: revenueData._sum.vat || 0,
        },
      },
      recentApprovedSales: formattedRecentSales,
    };

    console.log('Sales Creator Dashboard Summary:', result);
    return result;
  } catch (error) {
    console.error('Sales creator dashboard error:', error);
    throw new Error(
      `Failed to get sales creator dashboard summary: ${error.message}`,
    );
  }
};
module.exports = {
  getSellTrend,
  getTotalSold,
  getAllSells,
  generateSalesReports,
  getUserDashboardSummary,
  getSalesCreatorDashboardSummary,
};
