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
// ==================== 1. GET 7 COUNT CARDS ====================

// services/Report.service.js

const getLowStockMaterialReport = async () => {
  try {
    // Get all materials with their inventory stocks
    const materialsWithStock = await prisma.material.findMany({
      include: {
        inventoryStocks: {
          select: {
            quantity: true,
            storeId: true,
            showroomId: true,
          },
        },
        materialType: {
          select: {
            name: true,
          },
        },
        unitOfMeasure: {
          select: {
            name: true,
          },
        },
      },
    });

    const lowStockMaterials = materialsWithStock
      .map((material) => {
        const totalStock = material.inventoryStocks.reduce(
          (sum, stock) => sum + stock.quantity,
          0,
        );

        // Use material's specific warning level, fallback to 10 if null
        const warningLevel = material.warningStockLevel ?? 10;

        return {
          id: material.id,
          name: material.name,
          color: material.color,
          size: material.size,
          materialType: material.materialType?.name || 'Uncategorized',
          unitOfMeasure: material.unitOfMeasure?.name || 'Unit',
          totalStock,
          warningStockLevel: warningLevel,
          // Material properties
          plainMDF: material.plainMDF,
          laminatedMDF: material.laminatedMDF,
          wood: material.wood,
          metal: material.metal,
          accessory: material.accessory,
          other: material.other,
          imageUrl: material.imageUrl,
          // Location details
          locations: material.inventoryStocks.map((stock) => ({
            quantity: stock.quantity,
            type: stock.storeId ? 'Store' : 'Showroom',
          })),
        };
      })
      .filter((material) => material.totalStock <= material.warningStockLevel)
      .sort((a, b) => a.totalStock - b.totalStock);

    // Calculate additional statistics
    const criticalMaterials = lowStockMaterials.filter(
      (material) => material.totalStock === 0,
    );

    const warningMaterials = lowStockMaterials.filter(
      (material) =>
        material.totalStock > 0 &&
        material.totalStock <= material.warningStockLevel,
    );

    return {
      threshold: 'dynamic', // Each material has its own threshold
      totalLowStockMaterials: lowStockMaterials.length,
      criticalCount: criticalMaterials.length,
      warningCount: warningMaterials.length,
      lowStockMaterials,
      generatedAt: new Date(),
    };
  } catch (error) {
    console.error('Error in getLowStockMaterialReport:', error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Error fetching low stock material report: ${error.message}`,
    );
  }
};
const getTopPurchasedItems = async (limit = 10, startDate, endDate) => {
  try {
    // Build date filter
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.purchaseDate = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    // Get all purchase items with material info
    const purchaseItems = await prisma.purchaseItem.findMany({
      where: dateFilter.purchaseDate ? { purchase: dateFilter } : {},
      include: {
        material: {
          select: {
            id: true,
            name: true,
            materialType: {
              select: {
                name: true,
              },
            },
            unitOfMeasure: {
              select: {
                name: true,
                symbol: true,
              },
            },
          },
        },
        purchase: {
          select: {
            purchaseDate: true,
            supplier: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    // Aggregate quantities by material
    const materialMap = new Map();

    purchaseItems.forEach((item) => {
      const { materialId } = item;
      if (materialMap.has(materialId)) {
        const existing = materialMap.get(materialId);
        existing.totalQuantity += item.quantity;
        existing.totalValue += item.totalPrice;
      } else {
        materialMap.set(materialId, {
          materialId: item.material.id,
          materialName: item.material.name,
          category: item.material.materialType?.name || 'Uncategorized',
          unit: item.material.unitOfMeasure?.symbol || 'pcs',
          totalQuantity: item.quantity,
          totalValue: item.totalPrice,
          purchaseCount: 1,
          suppliers: [item.purchase.supplier.name],
        });
      }
    });

    // Convert to array and sort by total quantity
    const topMaterials = Array.from(materialMap.values())
      .map((item) => ({
        ...item,
        averagePrice: item.totalValue / item.totalQuantity,
      }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, limit);

    return {
      limit,
      period:
        startDate && endDate
          ? { startDate, endDate }
          : { startDate: 'All time', endDate: 'All time' },
      totalItems: topMaterials.length,
      topPurchasedItems: topMaterials,
      generatedAt: new Date(),
    };
  } catch (error) {
    console.error('Error in getTopPurchasedItems:', error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Error fetching top purchased items report: ${error.message}`,
    );
  }
};

const getTopSoldProducts = async (limit = 10, startDate, endDate) => {
  try {
    // Build date filter for sells
    const sellDateFilter = {};
    if (startDate && endDate) {
      sellDateFilter.saleDate = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    // Get all sell items with their items info
    const sellItems = await prisma.sellItem.findMany({
      where: {
        sell: sellDateFilter,
        itemSaleStatus: 'DELIVERED', // Only count delivered items
      },
      include: {
        item: {
          select: {
            id: true,
            name: true,
            price: true,
            color: true,
            imageUrl: true,
            category: {
              select: {
                name: true,
              },
            },
            type: {
              select: {
                name: true,
              },
            },
            size: {
              select: {
                name: true,
              },
            },
          },
        },
        sell: {
          select: {
            saleDate: true,
            customer: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    // Aggregate quantities by item
    const itemMap = new Map();

    sellItems.forEach((sellItem) => {
      const { itemId } = sellItem;
      if (itemMap.has(itemId)) {
        const existing = itemMap.get(itemId);
        existing.totalQuantity += sellItem.quantity;
        existing.totalRevenue += sellItem.totalPrice;
        existing.orderCount += 1;
      } else {
        itemMap.set(itemId, {
          itemId: sellItem.item.id,
          itemName: sellItem.item.name,
          category: sellItem.item.category?.name || 'Uncategorized',
          type: sellItem.item.type?.name || 'Standard',
          size: sellItem.item.size?.name || 'One Size',
          color: sellItem.item.color,
          price: sellItem.item.price,
          imageUrl: sellItem.item.imageUrl,
          totalQuantity: sellItem.quantity,
          totalRevenue: sellItem.totalPrice,
          orderCount: 1,
        });
      }
    });

    // Convert to array and sort by total quantity
    const topItems = Array.from(itemMap.values())
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, limit);

    return {
      limit,
      period:
        startDate && endDate
          ? { startDate, endDate }
          : { startDate: 'All time', endDate: 'All time' },
      totalSoldItems: topItems.length,
      topSoldProducts: topItems,
      generatedAt: new Date(),
    };
  } catch (error) {
    console.error('Error in getTopSoldProducts:', error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Error fetching top sold products report: ${error.message}`,
    );
  }
};

const getTopRequestedProductsFromPI = async (
  limit = 10,
  startDate,
  endDate,
) => {
  try {
    // Build date filter for proforma invoices (store = false)
    const piDateFilter = {};
    if (startDate && endDate) {
      piDateFilter.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    // Get proforma invoice items where store = false
    const proformaItems = await prisma.proformaInvoiceItem.findMany({
      where: {
        invoice: {
          store: false,
          ...piDateFilter,
        },
      },
      include: {
        item: {
          select: {
            id: true,
            name: true,
            price: true,
            color: true,
            imageUrl: true,
            category: {
              select: {
                name: true,
              },
            },
            type: {
              select: {
                name: true,
              },
            },
            size: {
              select: {
                name: true,
              },
            },
          },
        },
        invoice: {
          select: {
            piNumber: true,
            createdAt: true,
            customer: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    // Aggregate quantities by item for proforma invoices
    const piItemMap = new Map();

    proformaItems.forEach((piItem) => {
      if (!piItem.item) return; // Skip if no item associated

      const { itemId } = piItem;
      if (piItemMap.has(itemId)) {
        const existing = piItemMap.get(itemId);
        existing.totalRequestedQuantity += piItem.quantity;
        existing.totalValue += piItem.amount;
        existing.piCount += 1;
      } else {
        piItemMap.set(itemId, {
          itemId: piItem.item.id,
          itemName: piItem.item.name,
          category: piItem.item.category?.name || 'Uncategorized',
          type: piItem.item.type?.name || 'Standard',
          size: piItem.item.size?.name || 'One Size',
          color: piItem.item.color,
          price: piItem.item.price,
          imageUrl: piItem.item.imageUrl,
          totalRequestedQuantity: piItem.quantity,
          totalValue: piItem.amount,
          piCount: 1,
        });
      }
    });

    // Convert to array and sort by total requested quantity
    const topRequestedItems = Array.from(piItemMap.values())
      .sort((a, b) => b.totalRequestedQuantity - a.totalRequestedQuantity)
      .slice(0, limit);

    return {
      limit,
      period:
        startDate && endDate
          ? { startDate, endDate }
          : { startDate: 'All time', endDate: 'All time' },
      source: 'Proforma Invoices (Store = false)',
      totalRequestedItems: topRequestedItems.length,
      topRequestedProducts: topRequestedItems,
      generatedAt: new Date(),
    };
  } catch (error) {
    console.error('Error in getTopRequestedProductsFromPI:', error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Error fetching top requested products from PI report: ${error.message}`,
    );
  }
};

const getTopItemsFromPI = async (startDate, endDate) => {
  try {
    // Date filter for customer orders (store = false)
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    // Get all proforma invoice items from customer orders (store = false)
    const piItems = await prisma.proformaInvoiceItem.findMany({
      where: {
        invoice: {
          store: false, // Customer orders only
          ...dateFilter,
        },
      },
      include: {
        item: {
          include: {
            category: true,
            type: true,
            size: true,
          },
        },
        invoice: {
          include: {
            preparedBy: {
              select: {
                name: true,
                email: true,
              },
            },
            customer: true,
          },
        },
      },
    });

    // Analyze by item
    const itemAnalysis = new Map();
    let totalRequestedQuantity = 0;
    let totalRequestedValue = 0;

    piItems.forEach((piItem) => {
      if (!piItem.item) return;

      const { itemId } = piItem;
      const { quantity } = piItem;
      const value = piItem.amount;

      totalRequestedQuantity += quantity;
      totalRequestedValue += value;

      if (itemAnalysis.has(itemId)) {
        const existing = itemAnalysis.get(itemId);
        existing.totalRequestedQuantity += quantity;
        existing.totalValue += value;
        existing.piCount += 1;
        existing.customers.add(piItem.invoice.customer?.name || 'Unknown');
      } else {
        itemAnalysis.set(itemId, {
          itemId: piItem.item.id,
          itemName: piItem.item.name,
          category: piItem.item.category?.name || 'Uncategorized',
          type: piItem.item.type?.name || 'Standard',
          size: piItem.item.size?.name || 'One Size',
          color: piItem.item.color,
          price: piItem.item.price,
          imageUrl: piItem.item.imageUrl,
          totalRequestedQuantity: quantity,
          totalValue: value,
          totalRevenue: value, // Alias for consistency
          piCount: 1,
          customers: new Set([piItem.invoice.customer?.name || 'Unknown']),
        });
      }
    });

    // Convert Set to count and array
    const finalAnalysis = Array.from(itemAnalysis.values()).map((item) => ({
      ...item,
      uniqueCustomers: item.customers.size,
      customerList: Array.from(item.customers),
    }));

    // Sort and rank items
    const itemsByQuantity = finalAnalysis
      .sort((a, b) => b.totalRequestedQuantity - a.totalRequestedQuantity)
      .map((item, index) => ({ rank: index + 1, ...item }));

    const itemsByRevenue = finalAnalysis
      .sort((a, b) => b.totalValue - a.totalValue)
      .map((item, index) => ({ rank: index + 1, ...item }));

    return {
      type: 'CUSTOMER_ORDERS',
      source: 'Proforma Invoices (Store = false)',
      period: { startDate, endDate },
      summary: {
        totalRequestedQuantity,
        totalRequestedValue,
        uniqueItemsRequested: itemAnalysis.size,
        averageItemValue: totalRequestedValue / totalRequestedQuantity || 0,
        totalOrders: piItems.length,
      },
      topByQuantity: itemsByQuantity.slice(0, 10),
      topByRevenue: itemsByRevenue.slice(0, 10), // Added this for consistency
      topByValue: itemsByRevenue.slice(0, 10), // Keep for backward compatibility
      allItems: itemsByQuantity,
      generatedAt: new Date(),
    };
  } catch (error) {
    console.error('Error in getTopItemsFromPI:', error);
    throw error;
  }
};
const getItemSalesAnalysis = async (startDate, endDate) => {
  try {
    // Date filter for completed sales
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.saleDate = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    // Get all sold items from completed sales (PAID)
    const soldItems = await prisma.sellItem.findMany({
      where: {
        sell: {
          ...dateFilter,
          paymentStatus: 'PAID', // Only completed sales
        },
        itemSaleStatus: 'DELIVERED',
      },
      include: {
        item: {
          include: {
            category: true,
            type: true,
            size: true,
          },
        },
        sell: {
          include: {
            createdBy: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            customer: true,
          },
        },
      },
    });

    // Analyze by item
    const itemAnalysis = new Map();
    let totalRevenue = 0;
    let totalQuantity = 0;

    soldItems.forEach((sale) => {
      const { itemId } = sale;
      const revenue = sale.totalPrice;
      const { quantity } = sale;

      totalRevenue += revenue;
      totalQuantity += quantity;

      if (itemAnalysis.has(itemId)) {
        const existing = itemAnalysis.get(itemId);
        existing.totalQuantity += quantity;
        existing.totalRevenue += revenue;
        existing.orderCount += 1;
        existing.customers.add(sale.sell.customer?.name || 'Walk-in');
      } else {
        itemAnalysis.set(itemId, {
          itemId: sale.item.id,
          itemName: sale.item.name,
          category: sale.item.category?.name || 'Uncategorized',
          type: sale.item.type?.name || 'Standard',
          size: sale.item.size?.name || 'One Size',
          color: sale.item.color,
          price: sale.item.price,
          imageUrl: sale.item.imageUrl,
          totalQuantity: quantity,
          totalRevenue: revenue,
          totalValue: revenue, // Alias for consistency
          orderCount: 1,
          customers: new Set([sale.sell.customer?.name || 'Walk-in']),
        });
      }
    });

    // Convert Set to count and array
    const finalAnalysis = Array.from(itemAnalysis.values()).map((item) => ({
      ...item,
      uniqueCustomers: item.customers.size,
      customerList: Array.from(item.customers),
    }));

    // Sort and rank items
    const itemsByQuantity = finalAnalysis
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .map((item, index) => ({ rank: index + 1, ...item }));

    const itemsByRevenue = finalAnalysis
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .map((item, index) => ({ rank: index + 1, ...item }));

    return {
      type: 'COMPLETED_SALES',
      period: { startDate, endDate },
      summary: {
        totalItemsSold: totalQuantity,
        totalRevenue,
        uniqueItemsSold: itemAnalysis.size,
        averageItemValue: totalRevenue / totalQuantity || 0,
        totalOrders: soldItems.length,
      },
      topByQuantity: itemsByQuantity.slice(0, 10),
      topByRevenue: itemsByRevenue.slice(0, 10),
      topByValue: itemsByRevenue.slice(0, 10), // Added for consistency
      allItems: itemsByQuantity,
      generatedAt: new Date(),
    };
  } catch (error) {
    console.error('Error in getItemSalesAnalysis:', error);
    throw error;
  }
};

const getTopSalesByCreator = async (startDate, endDate) => {
  try {
    // Date filter
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.saleDate = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    // Get all sales with creator info
    const sales = await prisma.sell.findMany({
      where: {
        ...dateFilter,
        paymentStatus: 'PAID',
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        items: {
          include: {
            item: true,
          },
        },
        customer: true,
      },
    });

    // Analyze by creator
    const creatorAnalysis = new Map();
    let totalOverallRevenue = 0;
    let totalOverallSales = 0;

    sales.forEach((sale) => {
      const creatorId = sale.createdBy?.id || 'unknown';
      const saleRevenue = sale.grandTotal;
      const saleItemsCount = sale.items.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );

      totalOverallRevenue += saleRevenue;
      totalOverallSales += 1;

      if (creatorAnalysis.has(creatorId)) {
        const existing = creatorAnalysis.get(creatorId);
        existing.totalRevenue += saleRevenue;
        existing.totalSales += 1;
        existing.totalItemsSold += saleItemsCount;
        existing.sales.push({
          saleId: sale.id,
          invoiceNo: sale.invoiceNo,
          customerName: sale.customer?.name || 'Walk-in Customer',
          revenue: saleRevenue,
          itemsCount: saleItemsCount,
          date: sale.saleDate,
        });
      } else {
        creatorAnalysis.set(creatorId, {
          creatorId: creatorId === 'unknown' ? null : creatorId,
          creatorName: sale.createdBy?.name || 'Unknown User',
          creatorEmail: sale.createdBy?.email || 'N/A',
          totalRevenue: saleRevenue,
          totalSales: 1,
          totalItemsSold: saleItemsCount,
          sales: [
            {
              saleId: sale.id,
              invoiceNo: sale.invoiceNo,
              customerName: sale.customer?.name || 'Walk-in Customer',
              revenue: saleRevenue,
              itemsCount: saleItemsCount,
              date: sale.saleDate,
            },
          ],
        });
      }
    });

    // Sort creators by revenue and sales
    const topByRevenue = Array.from(creatorAnalysis.values())
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .map((creator, index) => ({
        rank: index + 1,
        ...creator,
        percentageOfTotal: (creator.totalRevenue / totalOverallRevenue) * 100,
      }));

    const topBySalesCount = Array.from(creatorAnalysis.values())
      .sort((a, b) => b.totalSales - a.totalSales)
      .map((creator, index) => ({
        rank: index + 1,
        ...creator,
        percentageOfTotal: (creator.totalSales / totalOverallSales) * 100,
      }));

    return {
      period: { startDate, endDate },
      summary: {
        totalRevenue: totalOverallRevenue,
        totalSales: totalOverallSales,
        activeSalesPeople: creatorAnalysis.size,
        averageSaleValue: totalOverallRevenue / totalOverallSales || 0,
      },
      topByRevenue: topByRevenue.slice(0, 10),
      topBySalesCount: topBySalesCount.slice(0, 10),
      allCreators: topByRevenue,
      generatedAt: new Date(),
    };
  } catch (error) {
    console.error('Error in getTopSalesByCreator:', error);
    throw error;
  }
};

const getTopPIByCreator = async (startDate, endDate) => {
  try {
    // Date filter
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    // Get all proforma invoices with store = false
    const proformas = await prisma.proformaInvoice.findMany({
      where: {
        store: false,
        ...dateFilter,
      },
      include: {
        preparedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        items: {
          include: {
            item: true,
          },
        },
        customer: true,
      },
    });

    // Analyze by creator
    const creatorPIAnalysis = new Map();
    let totalOverallValue = 0;
    let totalOverallPI = 0;

    proformas.forEach((pi) => {
      const creatorId = pi.preparedBy?.id || 'unknown';
      const piTotal = pi.total;

      totalOverallValue += piTotal;
      totalOverallPI += 1;

      if (creatorPIAnalysis.has(creatorId)) {
        const existing = creatorPIAnalysis.get(creatorId);
        existing.totalValue += piTotal;
        existing.totalPI += 1;
        existing.totalItemsRequested += pi.items.length;
        existing.proformas.push({
          piId: pi.id,
          piNumber: pi.piNumber,
          customerName: pi.customer?.name || 'Unknown Customer',
          totalValue: piTotal,
          itemsCount: pi.items.length,
          date: pi.createdAt,
          status: pi.status,
        });
      } else {
        creatorPIAnalysis.set(creatorId, {
          creatorId: creatorId === 'unknown' ? null : creatorId,
          creatorName: pi.preparedBy?.name || 'Unknown User',
          creatorEmail: pi.preparedBy?.email || 'N/A',
          totalValue: piTotal,
          totalPI: 1,
          totalItemsRequested: pi.items.length,
          proformas: [
            {
              piId: pi.id,
              piNumber: pi.piNumber,
              customerName: pi.customer?.name || 'Unknown Customer',
              totalValue: piTotal,
              itemsCount: pi.items.length,
              date: pi.createdAt,
              status: pi.status,
            },
          ],
        });
      }
    });

    // Sort creators by value and count
    const topByValue = Array.from(creatorPIAnalysis.values())
      .sort((a, b) => b.totalValue - a.totalValue)
      .map((creator, index) => ({
        rank: index + 1,
        ...creator,
        percentageOfTotal: (creator.totalValue / totalOverallValue) * 100,
      }));

    const topByPICount = Array.from(creatorPIAnalysis.values())
      .sort((a, b) => b.totalPI - a.totalPI)
      .map((creator, index) => ({
        rank: index + 1,
        ...creator,
        percentageOfTotal: (creator.totalPI / totalOverallPI) * 100,
      }));

    return {
      period: { startDate, endDate },
      summary: {
        totalProformaValue: totalOverallValue,
        totalProformas: totalOverallPI,
        activePreparers: creatorPIAnalysis.size,
        averageProformaValue: totalOverallValue / totalOverallPI || 0,
      },
      topByValue: topByValue.slice(0, 10),
      topByPICount: topByPICount.slice(0, 10),
      allPreparers: topByValue,
      generatedAt: new Date(),
    };
  } catch (error) {
    console.error('Error in getTopPIByCreator:', error);
    throw error;
  }
};

const getCompleteStaticReport = async (startDate, endDate) => {
  try {
    // Run all analyses in parallel
    const [itemSales, topSalesCreators, topPICreators, topItemsPI] =
      await Promise.all([
        getItemSalesAnalysis(startDate, endDate),
        getTopSalesByCreator(startDate, endDate),
        getTopPIByCreator(startDate, endDate),
        getTopItemsFromPI(startDate, endDate),
      ]);

    // Calculate additional metrics
    const conversionRate =
      itemSales.summary.totalItemsSold > 0 &&
      topItemsPI.summary.totalRequestedQuantity > 0
        ? (
            (itemSales.summary.totalItemsSold /
              topItemsPI.summary.totalRequestedQuantity) *
            100
          ).toFixed(2)
        : 0;

    const revenueConversionRate =
      itemSales.summary.totalRevenue > 0 &&
      topItemsPI.summary.totalRequestedValue > 0
        ? (
            (itemSales.summary.totalRevenue /
              topItemsPI.summary.totalRequestedValue) *
            100
          ).toFixed(2)
        : 0;

    // FIX: Ensure consistency between total PI value from items and creators
    // Calculate total PI value from creators to ensure consistency
    const totalPIValueFromCreators = topPICreators.summary.totalProformaValue;
    const totalPIValueFromItems = topItemsPI.summary.totalRequestedValue;

    // Use the maximum or average to ensure consistency (or log warning)
    const consistentTotalPIValue = Math.max(
      totalPIValueFromCreators,
      totalPIValueFromItems,
    );

    // Log warning if there's a discrepancy
    if (Math.abs(totalPIValueFromCreators - totalPIValueFromItems) > 0.01) {
      console.warn(
        `PI Value mismatch: Creators report ${totalPIValueFromCreators}, Items report ${totalPIValueFromItems}`,
      );
    }

    // Find matching items between PI and Sales for comparison
    const topItemsComparison = [];
    const topPIItems = topItemsPI.topByQuantity.slice(0, 5);
    const topSoldItems = itemSales.topByQuantity.slice(0, 5);

    topPIItems.forEach((piItem) => {
      const soldItem = itemSales.allItems.find(
        (sale) => sale.itemId === piItem.itemId,
      );
      topItemsComparison.push({
        itemName: piItem.itemName,
        requestedQuantity: piItem.totalRequestedQuantity,
        soldQuantity: soldItem?.totalQuantity || 0,
        conversionRate:
          soldItem?.totalQuantity && piItem.totalRequestedQuantity
            ? (
                (soldItem.totalQuantity / piItem.totalRequestedQuantity) *
                100
              ).toFixed(2)
            : 0,
        gap: piItem.totalRequestedQuantity - (soldItem?.totalQuantity || 0),
      });
    });

    return {
      reportDate: new Date(),
      period: {
        startDate: startDate || 'All time',
        endDate: endDate || 'All time',
      },

      // Individual Reports
      itemSalesAnalysis: itemSales,
      salesByCreatorAnalysis: topSalesCreators,
      proformaByCreatorAnalysis: topPICreators,
      proformaItemsAnalysis: topItemsPI,

      // Executive Summary - FIXED to use consistent values
      executiveSummary: {
        // Revenue Metrics - Use consistent total
        totalRevenueFromSales: itemSales.summary.totalRevenue,
        totalProformaValue: consistentTotalPIValue, // FIXED: Use consistent value
        revenueConversionRate: `${revenueConversionRate}%`,

        // Quantity Metrics
        totalItemsSold: itemSales.summary.totalItemsSold,
        totalItemsRequested: topItemsPI.summary.totalRequestedQuantity,
        quantityConversionRate: `${conversionRate}%`,

        // Top Performers - Quantity
        topSellingItemByQuantity: itemSales.topByQuantity[0]
          ? {
              name: itemSales.topByQuantity[0].itemName,
              quantity: itemSales.topByQuantity[0].totalQuantity,
              revenue: itemSales.topByQuantity[0].totalRevenue,
            }
          : null,

        topRequestedItemByQuantity: topItemsPI.topByQuantity[0]
          ? {
              name: topItemsPI.topByQuantity[0].itemName,
              quantity: topItemsPI.topByQuantity[0].totalRequestedQuantity,
              value: topItemsPI.topByQuantity[0].totalValue,
            }
          : null,

        // Top Performers - Revenue
        topSellingItemByRevenue: itemSales.topByRevenue[0]
          ? {
              name: itemSales.topByRevenue[0].itemName,
              revenue: itemSales.topByRevenue[0].totalRevenue,
              quantity: itemSales.topByRevenue[0].totalQuantity,
            }
          : null,

        topRequestedItemByValue: topItemsPI.topByRevenue[0]
          ? {
              name: topItemsPI.topByRevenue[0].itemName,
              value: topItemsPI.topByRevenue[0].totalValue,
              quantity: topItemsPI.topByRevenue[0].totalRequestedQuantity,
            }
          : null,

        // Creator Performance
        topSalesPerson: topSalesCreators.topByRevenue[0]
          ? {
              name: topSalesCreators.topByRevenue[0].creatorName,
              revenue: topSalesCreators.topByRevenue[0].totalRevenue,
              salesCount: topSalesCreators.topByRevenue[0].totalSales,
              percentageOfTotal:
                topSalesCreators.topByRevenue[0].percentageOfTotal,
            }
          : null,

        topPIPreparer: topPICreators.topByValue[0]
          ? {
              name: topPICreators.topByValue[0].creatorName,
              value: topPICreators.topByValue[0].totalValue,
              piCount: topPICreators.topByValue[0].totalPI,
              percentageOfTotal: topPICreators.topByValue[0].percentageOfTotal,
            }
          : null,

        // Performance Indicators
        averageOrderValue:
          itemSales.summary.totalOrders > 0
            ? itemSales.summary.totalRevenue / itemSales.summary.totalOrders
            : 0,
        averageProformaValue:
          topItemsPI.summary.totalOrders > 0
            ? topItemsPI.summary.totalRequestedValue /
              topItemsPI.summary.totalOrders
            : 0,
        uniqueCustomers: itemSales.allItems.reduce(
          (sum, item) => sum + item.uniqueCustomers,
          0,
        ),
      },

      // Comparison Analysis
      comparisonAnalysis: {
        top5ItemsComparison: topItemsComparison,
        summary: {
          totalGapQuantity: topItemsComparison.reduce(
            (sum, item) => sum + item.gap,
            0,
          ),
          averageConversionRate: (
            topItemsComparison.reduce(
              (sum, item) => sum + parseFloat(item.conversionRate),
              0,
            ) / topItemsComparison.length
          ).toFixed(2),
        },
      },

      generatedAt: new Date(),
    };
  } catch (error) {
    console.error('Error in getCompleteStaticReport:', error);
    throw error;
  }
};
const getCombinedReport = async (options = {}) => {
  const {
    lowStockThreshold = null, // Changed: null means use individual material thresholds
    topItemsLimit = 10,
    startDate,
    endDate,
  } = options;

  try {
    // Run all reports in parallel for better performance
    const [lowStock, topPurchased, topSold, topRequested] = await Promise.all([
      getLowStockMaterialReport(lowStockThreshold), // Pass null for per-material thresholds
      getTopPurchasedItems(topItemsLimit, startDate, endDate),
      getTopSoldProducts(topItemsLimit, startDate, endDate),
      getTopRequestedProductsFromPI(topItemsLimit, startDate, endDate),
    ]);

    return {
      lowStockReport: lowStock,
      topPurchasedItemsReport: topPurchased,
      topSoldProductsReport: topSold,
      topRequestedProductsReport: topRequested,
      reportDate: new Date(),
      summary: {
        // Updated for materials
        totalLowStockMaterials: lowStock.totalLowStockMaterials,
        criticalMaterials: lowStock.criticalCount || 0,
        warningMaterials: lowStock.warningCount || 0,
        // Keep existing metrics
        topPurchasedCount: topPurchased.totalItems,
        topSoldCount: topSold.totalSoldItems,
        topRequestedCount: topRequested.totalRequestedItems,
      },
    };
  } catch (error) {
    console.error('Error in getCombinedReport:', error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Error fetching combined report: ${error.message}`,
    );
  }
};
const getDashboardCounts = async () => {
  try {
    // Count total customers
    const totalCustomers = await prisma.customer.count();

    // Count total suppliers
    const totalSuppliers = await prisma.supplier.count();

    // Count projects with ALL stages finished (all ProjectStage.finished = true)
    const totalApprovedFinishedProjects = await prisma.project.count({
      where: {
        stages: {
          every: {
            finished: true,
          },
        },
      },
    });

    // Count projects with at least one stage NOT finished (projects in process)
    const totalProjectsInProcess = await prisma.project.count({
      where: {
        stages: {
          some: {
            finished: false,
          },
        },
      },
    });

    return {
      totalCustomers,
      totalSuppliers,
      totalApprovedFinishedProjects,
      totalProjectsInProcess,
      generatedAt: new Date(),
    };
  } catch (error) {
    console.error('Error in getDashboardCounts:', error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Error fetching dashboard counts: ${error.message}`,
    );
  }
};
const getMonthlyBreakdown = async (year = null) => {
  try {
    const targetYear = year || new Date().getFullYear();
    const startDate = new Date(targetYear, 0, 1);
    const endDate = new Date(targetYear, 11, 31, 23, 59, 59);

    // Get all Proforma Invoice payments for the year
    const proformaPayments = await prisma.proformaInvoiceBank.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        proformaInvoice: {
          select: {
            store: true,
          },
        },
      },
    });

    // Get all Sell payments for the year
    const sellPayments = await prisma.sellPayment.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    const monthlyBreakdown = [];

    for (let month = 0; month < 12; month++) {
      const monthStart = new Date(targetYear, month, 1);
      const monthEnd = new Date(targetYear, month + 1, 0, 23, 59, 59);

      // Filter proforma payments for this month (store = false)
      const monthProformaPayments = proformaPayments.filter((p) => {
        const pDate = new Date(p.createdAt);
        return (
          pDate >= monthStart &&
          pDate <= monthEnd &&
          p.proformaInvoice.store === false
        );
      });

      // Filter sell payments for this month
      const monthSellPayments = sellPayments.filter((s) => {
        const sDate = new Date(s.createdAt);
        return sDate >= monthStart && sDate <= monthEnd;
      });

      // Calculate totals from payments
      const proformaPaid = Number(
        monthProformaPayments.reduce(
          (sum, p) => sum + (Number(p.amount) || 0),
          0,
        ),
      );

      const sellPaid = Number(
        monthSellPayments.reduce((sum, s) => sum + (Number(s.amount) || 0), 0),
      );

      // Get total gains for the month (from invoices)
      const monthProformas = await prisma.proformaInvoice.findMany({
        where: {
          store: false,
          createdAt: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
        select: {
          total: true,
        },
      });

      const monthSales = await prisma.sell.findMany({
        where: {
          saleDate: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
        select: {
          grandTotal: true,
        },
      });

      const proformaGain = Number(
        monthProformas.reduce((sum, p) => sum + (Number(p.total) || 0), 0),
      );

      const sellGain = Number(
        monthSales.reduce((sum, s) => sum + (Number(s.grandTotal) || 0), 0),
      );

      // Round to 2 decimal places
      const roundToTwo = (num) => Number(num.toFixed(2));

      const proformaGainRounded = roundToTwo(proformaGain);
      const proformaPaidRounded = roundToTwo(proformaPaid);
      const sellGainRounded = roundToTwo(sellGain);
      const sellPaidRounded = roundToTwo(sellPaid);

      const proformaOutstanding = proformaGainRounded - proformaPaidRounded;
      const sellOutstanding = sellGainRounded - sellPaidRounded;
      const combinedGain = proformaGainRounded + sellGainRounded;
      const combinedPaid = proformaPaidRounded + sellPaidRounded;
      const combinedOutstanding = combinedGain - combinedPaid;

      monthlyBreakdown.push({
        month,
        monthName: new Date(targetYear, month, 1).toLocaleString('default', {
          month: 'long',
        }),
        proforma: {
          gain: proformaGainRounded,
          paid: proformaPaidRounded,
          outstanding: proformaOutstanding,
          collectionRate:
            proformaGainRounded > 0
              ? Number(
                  ((proformaPaidRounded / proformaGainRounded) * 100).toFixed(
                    2,
                  ),
                )
              : 0,
        },
        sales: {
          gain: sellGainRounded,
          paid: sellPaidRounded,
          outstanding: sellOutstanding,
          collectionRate:
            sellGainRounded > 0
              ? Number(((sellPaidRounded / sellGainRounded) * 100).toFixed(2))
              : 0,
        },
        combined: {
          gain: combinedGain,
          paid: combinedPaid,
          outstanding: combinedOutstanding,
          collectionRate:
            combinedGain > 0
              ? Number(((combinedPaid / combinedGain) * 100).toFixed(2))
              : 0,
        },
      });
    }

    return monthlyBreakdown;
  } catch (error) {
    console.error('Error in getMonthlyBreakdown:', error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Error fetching monthly breakdown: ${error.message}`,
    );
  }
};
const getDetailedFinishedProductsReportFunctional = async (
  startDate,
  endDate,
  materialTypes = ['plainMDF', 'laminatedMDF', 'wood', 'metal'],
) => {
  try {
    // Fix: Adjust end date to include the entire day
    // Convert dates to proper Date objects and adjust for timezone
    const startDateTime = new Date(startDate);
    startDateTime.setHours(0, 0, 0, 0);

    const endDateTime = new Date(endDate);
    endDateTime.setHours(23, 59, 59, 999); // Include the entire end day

    console.log(
      'Searching for work logs between:',
      startDateTime,
      'and',
      endDateTime,
    );

    // Find projects with FINISHING stage work logs within the date range
    const finishedProjects = await prisma.project.findMany({
      where: {
        stages: {
          some: {
            stage: 'FINISHING',
            finished: true,
            projectStageWorkLogs: {
              some: {
                createdAt: {
                  gte: startDateTime,
                  lte: endDateTime,
                },
              },
            },
          },
        },
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        invoice: {
          include: {
            items: {
              include: {
                proformaItemMaterials: {
                  include: {
                    material: true,
                  },
                },
                item: true, // Include the related item for additional details
              },
            },
          },
        },
        stages: {
          where: {
            stage: 'FINISHING',
          },
          include: {
            projectStageWorkLogs: {
              where: {
                createdAt: {
                  gte: startDateTime,
                  lte: endDateTime,
                },
              },
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        },
      },
    });

    console.log(
      `Found ${finishedProjects.length} projects with finishing work logs in date range`,
    );

    // Extract all products with their materials and work log dates
    const allProducts = finishedProjects.flatMap((project) => {
      const finishingStage = project.stages.find(
        (stage) => stage.stage === 'FINISHING',
      );

      // Get the latest work log date within the range as the finished date
      const latestWorkLog = finishingStage?.projectStageWorkLogs?.[0];
      const finishedDate = latestWorkLog?.createdAt || finishingStage?.endDate;

      // Get all work log dates for this project (for reference)
      const workLogDates =
        finishingStage?.projectStageWorkLogs?.map((log) => log.createdAt) || [];

      return project.invoice.items.map((invoiceItem) => ({
        productId: invoiceItem.id,
        productName: invoiceItem.item?.name || invoiceItem.description || '',
        productDescription: invoiceItem.description,
        size: invoiceItem.size,
        productQuantity: invoiceItem.quantity,
        projectId: project.id,
        piNumber: project.invoice.piNumber,
        customer: project.customer
          ? {
              id: project.customer.id,
              name: project.customer.name,
              email: project.customer.email,
              phone: project.customer.phone,
            }
          : null,
        customerName: project.customer?.name || 'No Customer Assigned',
        finishedDate,
        workLogDates,
        materials: invoiceItem.proformaItemMaterials.map((itemMaterial) => ({
          name: itemMaterial.material?.name?.toLowerCase() || '',
          quantity: itemMaterial.quantity || 0,
          material: itemMaterial.material,
        })),
      }));
    });

    // Group by product and aggregate materials
    const productMap = allProducts.reduce((map, product) => {
      if (!map.has(product.productId)) {
        map.set(product.productId, {
          productId: product.productId,
          productName: product.productName,
          productDescription: product.productDescription,
          size: product.size,
          productQuantity: product.productQuantity,
          projectId: product.projectId,
          piNumber: product.piNumber,
          customer: product.customer,
          customerName: product.customerName,
          finishedDate: product.finishedDate,
          workLogDates: product.workLogDates,
          plainMDF: 0,
          laminatedMDF: 0,
          wood: 0,
          metal: 0,
        });
      }

      const productData = map.get(product.productId);

      // Aggregate material quantities
      product.materials.forEach((material) => {
        const materialName = material.name;
        const { quantity } = material;
        const materialObj = material.material;

        // Method 1: Check the boolean flags from the Material model first
        if (
          materialTypes.includes('plainMDF') &&
          materialObj?.plainMDF === true
        ) {
          productData.plainMDF += quantity;
        } else if (
          materialTypes.includes('laminatedMDF') &&
          materialObj?.laminatedMDF === true
        ) {
          productData.laminatedMDF += quantity;
        } else if (
          materialTypes.includes('wood') &&
          materialObj?.wood === true
        ) {
          productData.wood += quantity;
        } else if (
          materialTypes.includes('metal') &&
          materialObj?.metal === true
        ) {
          productData.metal += quantity;
        }
        // Method 2: Check name patterns
        else if (
          materialTypes.includes('plainMDF') &&
          (materialName.includes('plain mdf') ||
            materialName.includes('plain madf') ||
            materialName === 'plainmdf' ||
            materialName === 'plainmadf')
        ) {
          productData.plainMDF += quantity;
        } else if (
          materialTypes.includes('laminatedMDF') &&
          (materialName.includes('laminated mdf') ||
            materialName.includes('lam mdf') ||
            materialName === 'laminated')
        ) {
          productData.laminatedMDF += quantity;
        } else if (
          materialTypes.includes('wood') &&
          (materialName.includes('wood') ||
            materialName.includes('timber') ||
            materialName.includes('solid wood'))
        ) {
          productData.wood += quantity;
        } else if (
          materialTypes.includes('metal') &&
          (materialName.includes('metal') ||
            materialName.includes('iron') ||
            materialName.includes('steel'))
        ) {
          productData.metal += quantity;
        }
      });

      return map;
    }, new Map());

    // Filter and format products
    const products = Array.from(productMap.values())
      .filter(
        (product) =>
          product.plainMDF > 0 ||
          product.laminatedMDF > 0 ||
          product.wood > 0 ||
          product.metal > 0,
      )
      .map((product) => ({
        ...product,
        materialUsage: {
          plainMDF: product.plainMDF,
          laminatedMDF: product.laminatedMDF,
          wood: product.wood,
          metal: product.metal,
        },
      }));

    // Calculate totals
    const totals = products.reduce(
      (acc, product) => ({
        plainMDF: acc.plainMDF + product.plainMDF,
        laminatedMDF: acc.laminatedMDF + product.laminatedMDF,
        wood: acc.wood + product.wood,
        metal: acc.metal + product.metal,
      }),
      { plainMDF: 0, laminatedMDF: 0, wood: 0, metal: 0 },
    );

    // Group by customer for byproduct analysis
    const byCustomer = products.reduce((acc, product) => {
      const { customerName } = product;
      if (!acc[customerName]) {
        acc[customerName] = {
          customerName,
          customer: product.customer,
          projects: new Set(),
          products: [],
          materialTotals: {
            plainMDF: 0,
            laminatedMDF: 0,
            wood: 0,
            metal: 0,
          },
        };
      }

      acc[customerName].projects.add(product.projectId);
      acc[customerName].products.push(product);
      acc[customerName].materialTotals.plainMDF += product.plainMDF;
      acc[customerName].materialTotals.laminatedMDF += product.laminatedMDF;
      acc[customerName].materialTotals.wood += product.wood;
      acc[customerName].materialTotals.metal += product.metal;

      return acc;
    }, {});

    // Convert sets to arrays and format by customer data
    const byCustomerFormatted = Object.values(byCustomer).map((customer) => ({
      ...customer,
      projects: Array.from(customer.projects),
      totalProducts: customer.products.length,
    }));

    // Group by PI number for byproduct analysis
    const byPINumber = products.reduce((acc, product) => {
      const { piNumber } = product;
      if (!acc[piNumber]) {
        acc[piNumber] = {
          piNumber,
          customerName: product.customerName,
          customer: product.customer,
          projectId: product.projectId,
          products: [],
          materialTotals: {
            plainMDF: 0,
            laminatedMDF: 0,
            wood: 0,
            metal: 0,
          },
        };
      }

      acc[piNumber].products.push(product);
      acc[piNumber].materialTotals.plainMDF += product.plainMDF;
      acc[piNumber].materialTotals.laminatedMDF += product.laminatedMDF;
      acc[piNumber].materialTotals.wood += product.wood;
      acc[piNumber].materialTotals.metal += product.metal;

      return acc;
    }, {});

    // Format by PI number data
    const byPINumberFormatted = Object.values(byPINumber).map((pi) => ({
      ...pi,
      totalProducts: pi.products.length,
    }));

    return {
      dateRange: {
        startDate: startDateTime,
        endDate: endDateTime,
        originalStartDate: startDate,
        originalEndDate: endDate,
      },
      summary: {
        totalProjects: finishedProjects.length,
        totalProducts: products.length,
        totalMaterialUsage: totals,
        totalCustomers: Object.keys(byCustomer).length,
        totalPIs: Object.keys(byPINumber).length,
      },
      products,
      byCustomer: byCustomerFormatted,
      byPINumber: byPINumberFormatted,
      generatedAt: new Date(),
    };
  } catch (error) {
    console.error('Error in getDetailedFinishedProductsReport:', error);
    throw new Error(
      `Error fetching detailed finished products report: ${error.message}`,
    );
  }
};
const getDeliveryDateComparisonReportFunctional = async () => {
  try {
    const projects = await prisma.project.findMany({
      include: {
        stages: {
          where: {
            finished: false,
          },
          orderBy: {
            startDate: 'asc',
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            phone1: true,
            address: true,
          },
        },
        invoice: {
          select: {
            piNumber: true,
            customerId: true,
          },
        },
      },
    });

    const initialReport = {
      generatedAt: new Date(),
      summary: {
        totalProjectsAnalyzed: projects.length,
        projectsWithMismatch: 0,
      },
      mismatchedProjects: [],
    };

    const report = projects.reduce((acc, project) => {
      const deliveryStage = project.stages.find(
        (stage) => stage.stage === 'DELIVERY',
      );

      // Skip projects without delivery stage
      if (!deliveryStage) {
        return acc;
      }

      const projectDeliveryDate =
        project.manualDelivery || project.calculatedDelivery;
      const stageDeliveryDate = deliveryStage.endDate;

      // Skip projects with missing dates
      if (!projectDeliveryDate || !stageDeliveryDate) {
        return acc;
      }

      const projectDate = new Date(projectDeliveryDate);
      const stageDate = new Date(stageDeliveryDate);

      if (projectDate.toDateString() !== stageDate.toDateString()) {
        const diffDays = Math.ceil(
          Math.abs(projectDate.getTime() - stageDate.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        return {
          ...acc,
          summary: {
            ...acc.summary,
            projectsWithMismatch: acc.summary.projectsWithMismatch + 1,
          },
          mismatchedProjects: [
            ...acc.mismatchedProjects,
            {
              projectId: project.id,
              customerName: project.customer?.name || 'No Customer',
              customerPhone: project.customer?.phone1 || 'No Phone',
              piNumber: project.invoice?.piNumber || project.invoiceId,
              projectStatus: project.status,
              dates: {
                calculatedDelivery: project.calculatedDelivery,
                manualDelivery: project.manualDelivery,
                requestedDelivery: project.requestedDelivery,
                projectFinalDelivery: projectDeliveryDate,
                stageDeliveryDate,
              },
              comparison: {
                differenceInDays: diffDays,
                whichIsEarlier:
                  projectDate < stageDate
                    ? 'Project Delivery Date'
                    : 'Stage Delivery Date',
                suggestion:
                  projectDate < stageDate
                    ? 'Consider updating stage delivery date or recalculating schedule'
                    : 'Consider updating project delivery date or checking stage delays',
              },
              scheduleMode: project.scheduleMode,
              difficulty: project.difficulty,
            },
          ],
        };
      }

      return acc;
    }, initialReport);

    return report;
  } catch (error) {
    console.error('Error in delivery report service:', error);
    throw error;
  }
};
const getCompletedProjectsReport = async () => {
  try {
    const projects = await prisma.project.findMany({
      where: {
        status: 'COMPLETED',
      },

      include: {
        stages: {
          orderBy: {
            startDate: 'asc',
          },
        },

        customer: {
          select: {
            id: true,
            name: true,
            phone1: true,
            address: true,
          },
        },

        invoice: {
          select: {
            piNumber: true,
            customerId: true,
          },
        },
      },
    });

    const initialReport = {
      generatedAt: new Date(),
      summary: {
        totalProjectsAnalyzed: projects.length,
        projectsWithMismatch: 0,
      },
      mismatchedProjects: [],
    };

    const report = projects.reduce((acc, project) => {
      const deliveryStage = project.stages.find(
        (stage) => stage.stage === 'DELIVERY',
      );

      // Skip projects without delivery stage
      if (!deliveryStage) {
        return acc;
      }

      const projectDeliveryDate =
        project.manualDelivery || project.calculatedDelivery;
      const stageDeliveryDate = deliveryStage.endDate;

      // Skip projects with missing dates
      if (!projectDeliveryDate || !stageDeliveryDate) {
        return acc;
      }

      const projectDate = new Date(projectDeliveryDate);
      const stageDate = new Date(stageDeliveryDate);

      if (projectDate.toDateString() !== stageDate.toDateString()) {
        const diffDays = Math.ceil(
          Math.abs(projectDate.getTime() - stageDate.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        return {
          ...acc,
          summary: {
            ...acc.summary,
            projectsWithMismatch: acc.summary.projectsWithMismatch + 1,
          },
          mismatchedProjects: [
            ...acc.mismatchedProjects,
            {
              projectId: project.id,
              customerName: project.customer?.name || 'No Customer',
              customerPhone: project.customer?.phone1 || 'No Phone',
              piNumber: project.invoice?.piNumber || project.invoiceId,
              projectStatus: project.status,
              dates: {
                calculatedDelivery: project.calculatedDelivery,
                manualDelivery: project.manualDelivery,
                requestedDelivery: project.requestedDelivery,
                projectFinalDelivery: projectDeliveryDate,
                stageDeliveryDate,
              },
              comparison: {
                differenceInDays: diffDays,
                whichIsEarlier:
                  projectDate < stageDate
                    ? 'Project Delivery Date'
                    : 'Stage Delivery Date',
                suggestion:
                  projectDate < stageDate
                    ? 'Consider updating stage delivery date or recalculating schedule'
                    : 'Consider updating project delivery date or checking stage delays',
              },
              scheduleMode: project.scheduleMode,
              difficulty: project.difficulty,
            },
          ],
        };
      }

      return acc;
    }, initialReport);

    return report;
  } catch (error) {
    console.error('Error in delivery report service:', error);
    throw error;
  }
};
module.exports = {
  getDeliveryDateComparisonReportFunctional,
  getDetailedFinishedProductsReportFunctional,
  getMonthlyBreakdown,
  getItemSalesAnalysis,
  getTopSalesByCreator,
  getTopPIByCreator,
  getTopItemsFromPI,
  getCompleteStaticReport,
  getDashboardCounts,
  getLowStockMaterialReport,
  getTopPurchasedItems,
  getTopSoldProducts,
  getTopRequestedProductsFromPI,
  getCombinedReport,
  getCompletedProjectsReport,
};
