/* eslint-disable no-underscore-dangle */
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Helper function to get start and end of current month
const getCurrentMonthRange = () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { startOfMonth, endOfMonth };
};

// ==================== 1. GET 6 COUNT CARDS ====================
const getCountCards = async () => {
  try {
    const { startOfMonth, endOfMonth } = getCurrentMonthRange();

    // 1. Total Products
    const totalProducts = await prisma.product.count();

    // 2. Total Customers
    const totalCustomers = await prisma.customer.count();

    // 3. Total Suppliers
    const totalSuppliers = await prisma.supplier.count();

    // 4. Total Purchases (This Month)
    const totalPurchases = await prisma.purchase.count({
      where: {
        purchaseDate: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
    });

    // 5. Total Sales (Curtain Orders - PAID)
    const totalSales = await prisma.curtainOrder.count({
      where: {
        paymentStatus: 'PAID',
      },
    });

    // 6. Total Stock Quantity (Store + Shop)
    const storeStock = await prisma.storeStock.aggregate({
      _sum: {
        quantity: true,
      },
    });

    const shopStock = await prisma.shopStock.aggregate({
      _sum: {
        quantity: true,
      },
    });

    const totalStockQuantity =
      (storeStock._sum.quantity || 0) + (shopStock._sum.quantity || 0);

    const result = {
      totalProducts,
      totalCustomers,
      totalSuppliers,
      totalPurchases,
      totalSales,
      totalStockQuantity,
    };

    return result;
  } catch (error) {
    // Log the actual error details

    // If it's a Prisma error, log more details
    if (error.code) {
      console.error('Prisma error code:', error.code);
      console.error('Prisma error meta:', error.meta);
    }

    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Error fetching count cards data: ${error.message}`,
    );
  }
};

// ==================== 2. PAYMENT BAR CHART ====================
const getPaymentBarChart = async () => {
  try {
    const paymentChart = await prisma.curtainOrder.groupBy({
      by: ['paymentStatus'],
      _count: {
        paymentStatus: true,
      },
      _sum: {
        totalAmount: true,
      },
    });

    // Define status labels and colors
    const statusConfig = {
      PENDING: { label: 'Pending', color: '#f59e0b' },
      PAID: { label: 'Paid', color: '#10b981' },
    };

    const chartData = Object.keys(statusConfig).map((status) => {
      const data = paymentChart.find((item) => item.paymentStatus === status);
      return {
        name: statusConfig[status].label,
        value: data?._count.paymentStatus || 0,
        amount: data?._sum.totalAmount || 0,
        fill: statusConfig[status].color,
      };
    });

    return {
      chartData,
      summary: {
        totalOrders: chartData.reduce((sum, item) => sum + item.value, 0),
        totalAmount: chartData.reduce((sum, item) => sum + item.amount, 0),
      },
    };
  } catch (error) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Error fetching payment bar chart data',
    );
  }
};

// ==================== 3. STOCK ALERT (Low Stock) ====================
const getLowStockAlerts = async () => {
  try {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
      },
      include: {
        storeStocks: true,
        shopStocks: true,
        unitOfMeasure: true,
      },
    });

    const lowStockProducts = [];

    for (const product of products) {
      const totalStoreStock = product.storeStocks.reduce(
        (sum, stock) => sum + (stock.quantity || 0),
        0,
      );
      const totalShopStock = product.shopStocks.reduce(
        (sum, stock) => sum + (stock.quantity || 0),
        0,
      );
      const totalStock = totalStoreStock + totalShopStock;

      const warningQuantity = product.warningQuantity || 0;

      if (totalStock <= warningQuantity && warningQuantity > 0) {
        lowStockProducts.push({
          productId: product.id,
          productCode: product.productCode,
          productName: product.name,
          currentStock: totalStock,
          warningQuantity,
          unitOfMeasure: product.unitOfMeasure?.name || 'pcs',
          status: totalStock === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK',
        });
      }
    }

    // Sort by most critical first (lowest stock)
    lowStockProducts.sort((a, b) => a.currentStock - b.currentStock);

    return {
      lowStockCount: lowStockProducts.length,
      lowStockProducts,
    };
  } catch (error) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Error fetching low stock alerts',
    );
  }
};

// ==================== 4. TOP PURCHASE PRODUCTS ====================
const getTopPurchaseProducts = async (limit = 5) => {
  try {
    const topPurchase = await prisma.purchaseItem.groupBy({
      by: ['productId'],
      _sum: {
        quantity: true,
      },
      orderBy: {
        _sum: {
          quantity: 'desc',
        },
      },
      take: limit,
    });

    // Get product details for each top purchase
    const productIds = topPurchase.map((item) => item.productId);
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
      },
      include: {
        unitOfMeasure: true,
      },
    });

    const result = topPurchase.map((purchase) => {
      const product = products.find((p) => p.id === purchase.productId);
      return {
        productId: purchase.productId,
        productCode: product?.productCode,
        productName: product?.name,
        totalPurchasedQuantity: purchase._sum.quantity || 0,
        unitOfMeasure: product?.unitOfMeasure?.name || 'pcs',
      };
    });

    return result;
  } catch (error) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Error fetching top purchase products',
    );
  }
};

// ==================== 5. TOP SOLD PRODUCTS ====================
const getTopSoldProducts = async (limit = 10) => {
  try {
    // Get ALL curtain orders without status filter
    const allOrders = await prisma.curtainOrder.findMany({
      include: {
        measurements: {
          include: {
            thickProduct: {
              include: { unitOfMeasure: true },
            },
            thinProduct: {
              include: { unitOfMeasure: true },
            },
            curtainPole: {
              include: { unitOfMeasure: true },
            },
            curtainPulls: {
              include: { unitOfMeasure: true },
            },
            curtainBrackets: {
              include: { unitOfMeasure: true },
            },
            shatterVerticalProduct: {
              include: { unitOfMeasure: true },
            },
          },
        },
      },
    });

    // Aggregate product quantities using reduce
    const productSales = allOrders.reduce((salesMap, order) => {
      order.measurements.forEach((measurement) => {
        // Thick curtain product
        if (measurement.thickProductId && measurement.thickMeter) {
          const productId = measurement.thickProductId;
          const quantity = measurement.thickMeter;
          salesMap.set(productId, {
            productId,
            productCode: measurement.thickProduct?.productCode,
            productName: measurement.thickProduct?.name,
            totalSoldQuantity:
              (salesMap.get(productId)?.totalSoldQuantity || 0) + quantity,
            unitOfMeasure:
              measurement.thickProduct?.unitOfMeasure?.name || 'meter',
          });
        }

        // Thin curtain product
        if (measurement.thinProductId && measurement.thinMeter) {
          const productId = measurement.thinProductId;
          const quantity = measurement.thinMeter;
          salesMap.set(productId, {
            productId,
            productCode: measurement.thinProduct?.productCode,
            productName: measurement.thinProduct?.name,
            totalSoldQuantity:
              (salesMap.get(productId)?.totalSoldQuantity || 0) + quantity,
            unitOfMeasure:
              measurement.thinProduct?.unitOfMeasure?.name || 'meter',
          });
        }

        // Curtain pole
        if (measurement.curtainPoleId && measurement.curtainPoleQuantity) {
          const productId = measurement.curtainPoleId;
          const quantity = measurement.curtainPoleQuantity;
          salesMap.set(productId, {
            productId,
            productCode: measurement.curtainPole?.productCode,
            productName: measurement.curtainPole?.name,
            totalSoldQuantity:
              (salesMap.get(productId)?.totalSoldQuantity || 0) + quantity,
            unitOfMeasure:
              measurement.curtainPole?.unitOfMeasure?.name || 'pcs',
          });
        }

        // Curtain pulls
        if (measurement.curtainPullsId && measurement.curtainPullsQuantity) {
          const productId = measurement.curtainPullsId;
          const quantity = measurement.curtainPullsQuantity;
          salesMap.set(productId, {
            productId,
            productCode: measurement.curtainPulls?.productCode,
            productName: measurement.curtainPulls?.name,
            totalSoldQuantity:
              (salesMap.get(productId)?.totalSoldQuantity || 0) + quantity,
            unitOfMeasure:
              measurement.curtainPulls?.unitOfMeasure?.name || 'pcs',
          });
        }

        // Curtain brackets
        if (
          measurement.curtainBracketsId &&
          measurement.curtainBracketsQuantity
        ) {
          const productId = measurement.curtainBracketsId;
          const quantity = measurement.curtainBracketsQuantity;
          salesMap.set(productId, {
            productId,
            productCode: measurement.curtainBrackets?.productCode,
            productName: measurement.curtainBrackets?.name,
            totalSoldQuantity:
              (salesMap.get(productId)?.totalSoldQuantity || 0) + quantity,
            unitOfMeasure:
              measurement.curtainBrackets?.unitOfMeasure?.name || 'pcs',
          });
        }

        // Shatter vertical product
        if (measurement.shatterVerticalProductId && measurement.quantity) {
          const productId = measurement.shatterVerticalProductId;
          const { quantity } = measurement;
          salesMap.set(productId, {
            productId,
            productCode: measurement.shatterVerticalProduct?.productCode,
            productName: measurement.shatterVerticalProduct?.name,
            totalSoldQuantity:
              (salesMap.get(productId)?.totalSoldQuantity || 0) + quantity,
            unitOfMeasure:
              measurement.shatterVerticalProduct?.unitOfMeasure?.name || 'pcs',
          });
        }
      });
      return salesMap;
    }, new Map());

    // Convert to array and sort by totalSoldQuantity
    const result = Array.from(productSales.values())
      .sort((a, b) => b.totalSoldQuantity - a.totalSoldQuantity)
      .slice(0, limit);

    return result;
  } catch (error) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Error fetching top sold products',
    );
  }
};

// ==================== 6. AGING INVENTORY ====================
const getAgingInventory = async (limit = 10) => {
  try {
    const today = new Date();

    // Get oldest IN movements that still have stock
    const oldestStockEntries = await prisma.stockLedger.findMany({
      where: {
        movementType: 'IN',
      },
      include: {
        product: {
          include: {
            unitOfMeasure: true,
          },
        },
        store: true,
        shop: true,
      },
      orderBy: {
        movementDate: 'asc',
      },
      take: limit,
    });

    const agingInventory = oldestStockEntries.map((entry) => {
      const movementDate = new Date(entry.movementDate);
      const ageInDays = Math.floor(
        (today - movementDate) / (1000 * 60 * 60 * 24),
      );

      let location = '';
      if (entry.store) location = `Store: ${entry.store.name}`;
      if (entry.shop) location = `Shop: ${entry.shop.name}`;

      return {
        productId: entry.productId,
        productCode: entry.product?.productCode,
        productName: entry.product?.name,
        quantity: entry.quantity || 0,
        unitOfMeasure: entry.product?.unitOfMeasure?.name || 'pcs',
        movementDate: entry.movementDate,
        daysOld: ageInDays,
        location,
        invoiceNo: entry.invoiceNo,
        ageCategory:
          ageInDays <= 30
            ? 'Fresh (0-30 days)'
            : ageInDays <= 90
            ? 'Moderate (31-90 days)'
            : ageInDays <= 180
            ? 'Aging (91-180 days)'
            : 'Old (>180 days)',
      };
    });

    // Calculate aging summary
    const agingSummary = {
      fresh: agingInventory.filter((item) => item.daysOld <= 30).length,
      moderate: agingInventory.filter(
        (item) => item.daysOld > 30 && item.daysOld <= 90,
      ).length,
      aging: agingInventory.filter(
        (item) => item.daysOld > 90 && item.daysOld <= 180,
      ).length,
      old: agingInventory.filter((item) => item.daysOld > 180).length,
    };

    return {
      agingInventory,
      agingSummary,
      totalAgingItems: agingInventory.length,
    };
  } catch (error) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Error fetching aging inventory data',
    );
  }
};

// ==================== COMPLETE DASHBOARD DATA ====================
const getCompleteDashboardData = async () => {
  try {
    // Run all queries in parallel for better performance
    const [
      countCards,
      paymentBarChart,
      lowStockAlerts,
      topPurchaseProducts,
      topSoldProducts,
      agingInventory,
    ] = await Promise.all([
      getCountCards(),
      getPaymentBarChart(),
      getLowStockAlerts(),
      getTopPurchaseProducts(5),
      getTopSoldProducts(5),
      getAgingInventory(10),
    ]);

    return {
      success: true,
      data: {
        // Top Section - 6 Count Cards
        countCards,

        // Middle Section - Payment Bar Chart & Stock Alert
        paymentBarChart,
        stockAlert: lowStockAlerts,

        // Bottom Left - Top Purchase Products
        topPurchaseProducts,

        // Bottom Right - Top Sold Products
        topSoldProducts,

        // Bottom Section - Aging Inventory
        agingInventory,

        // Last Updated Timestamp
        lastUpdated: new Date().toISOString(),
      },
    };
  } catch (error) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Error fetching complete dashboard data',
    );
  }
};

// ==================== ADDITIONAL HELPER FUNCTIONS ====================

// Get dashboard data with date range filters
const getDashboardDataWithFilters = async (filters = {}) => {
  try {
    const { startDate, endDate, branchId, shopId, storeId } = filters;

    const whereClause = {};

    if (startDate && endDate) {
      whereClause.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    if (branchId) {
      whereClause.branchId = branchId;
    }

    if (shopId) {
      whereClause.shopId = shopId;
    }

    if (storeId) {
      whereClause.storeId = storeId;
    }

    // Get filtered count cards
    const totalProducts = await prisma.product.count();
    const totalCustomers = await prisma.customer.count();
    const totalSuppliers = await prisma.supplier.count();

    const totalPurchases = await prisma.purchase.count({
      where: whereClause,
    });

    const totalSales = await prisma.curtainOrder.count({
      where: {
        paymentStatus: 'PAID',
        ...whereClause,
      },
    });

    // Get filtered payment chart
    const paymentChart = await prisma.curtainOrder.groupBy({
      by: ['paymentStatus'],
      where: whereClause,
      _count: {
        paymentStatus: true,
      },
      _sum: {
        totalAmount: true,
      },
    });

    return {
      countCards: {
        totalProducts,
        totalCustomers,
        totalSuppliers,
        totalPurchases,
        totalSales,
      },
      paymentChart,
    };
  } catch (error) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Error fetching filtered dashboard data',
    );
  }
};

// Get monthly sales trend (for additional chart)
const getMonthlySalesTrend = async (months = 6) => {
  try {
    const today = new Date();
    const monthRanges = [];

    // Start from current month and go back 'months' months
    for (let i = 0; i < months; i++) {
      const startOfMonth = new Date(
        today.getFullYear(),
        today.getMonth() - i,
        1,
      );
      const endOfMonth = new Date(
        today.getFullYear(),
        today.getMonth() - i + 1,
        0,
        23,
        59,
        59,
        999,
      );

      monthRanges.push({
        startOfMonth,
        endOfMonth,
        month: startOfMonth.toLocaleString('default', { month: 'short' }),
        year: startOfMonth.getFullYear(),
      });
    }

    // Reverse to show oldest to newest (Jan, Feb, Mar... or current order)
    monthRanges.reverse();

    const salesPromises = monthRanges.map(({ startOfMonth, endOfMonth }) =>
      prisma.curtainOrder.aggregate({
        where: {
          paymentStatus: 'PAID',
          createdAt: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
        _sum: {
          totalAmount: true,
        },
        _count: {
          id: true,
        },
      }),
    );

    const salesResults = await Promise.all(salesPromises);

    const monthlyData = monthRanges.map(
      ({ month, year, startOfMonth }, idx) => ({
        month,
        year,
        sales: Number(salesResults[idx]._sum.totalAmount || 0),
        orders: salesResults[idx]._count.id || 0,
      }),
    );

    return monthlyData;
  } catch (error) {
    console.error('Error fetching monthly sales trend:', error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Error fetching monthly sales trend',
    );
  }
};

module.exports = {
  getCountCards,
  getPaymentBarChart,
  getLowStockAlerts,
  getTopPurchaseProducts,
  getTopSoldProducts,
  getAgingInventory,
  getCompleteDashboardData,

  getDashboardDataWithFilters,
  getMonthlySalesTrend,
};
