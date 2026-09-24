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
    const roundNum = (value, decimals = 2) => {
      if (value === null || value === undefined || value === '') return 0;
      const num = Number(value);
      if (isNaN(num) || !isFinite(num)) return 0;
      const factor = 10 ** decimals;
      return Math.round(num * factor) / factor;
    };

    // Helper function to safely get numeric value
    const getNumericValue = (value) => {
      if (value === null || value === undefined || value === '') return 0;
      const num = Number(value);
      return isNaN(num) || !isFinite(num) ? 0 : num;
    };

    // Only used for the small set of fields the frontend's TS types declare
    // as strings ending in "%" (revenueConversionRate, quantityConversionRate,
    // averageConversionRate). Everything else stays a plain number.
    const formatPercent = (value, decimals = 2) =>
      `${roundNum(value, decimals)}%`;

    // Helper function to calculate total from proformas array
    const calculateTotalFromProformas = (proformas) => {
      if (!proformas || !Array.isArray(proformas)) return 0;
      return proformas.reduce((sum, p) => {
        const val = getNumericValue(p.totalValue);
        return sum + val;
      }, 0);
    };

    // Run all analyses in parallel
    const [itemSales, topSalesCreators, topPICreators, topItemsPI] =
      await Promise.all([
        getItemSalesAnalysis(startDate, endDate),
        getTopSalesByCreator(startDate, endDate),
        getTopPIByCreator(startDate, endDate),
        // Expected to group ProformaInvoiceItem rows by categoryId
        // (-> ProductCategory) and still carry itemId/itemName through,
        // since the frontend's combined-item view matches sales items to
        // PI items by itemId.
        getTopItemsFromPI(startDate, endDate),
      ]);
    // Validate that all responses have the expected structure
    const validateResponse = (response, defaultStructure, label) => {
      if (!response || typeof response !== 'object') {
        return defaultStructure;
      }
      return response;
    };

    const defaultItemSales = {
      summary: {
        totalItemsSold: 0,
        totalRevenue: 0,
        totalOrders: 0,
        uniqueItems: 0,
        averagePrice: 0,
      },
      topByQuantity: [],
      topByRevenue: [],
      allItems: [],
      categoryAnalysis: [],
    };

    const defaultTopSalesCreators = {
      summary: { totalRevenue: 0, totalSales: 0, uniqueCreators: 0 },
      topByQuantity: [],
      topByRevenue: [],
      allCreators: [],
    };

    const defaultTopPICreators = {
      summary: { totalProformaValue: 0, totalPI: 0, uniqueCreators: 0 },
      topByValue: [],
      topByQuantity: [],
      topByPICount: [],
      allPreparers: [],
    };

    // categoryId/categoryName sit alongside itemId/itemName (kept for the
    // frontend's itemId-based join in getCombinedItemData).
    const defaultTopItemsPI = {
      summary: {
        totalRequestedQuantity: 0,
        totalRequestedValue: 0,
        totalOrders: 0,
        uniqueCategories: 0,
        averageValue: 0,
      },
      topByQuantity: [],
      topByRevenue: [],
      allItems: [],
      categoryAnalysis: [],
    };

    const validatedItemSales = validateResponse(
      itemSales,
      defaultItemSales,
      'itemSales',
    );
    const validatedTopSalesCreators = validateResponse(
      topSalesCreators,
      defaultTopSalesCreators,
      'topSalesCreators',
    );
    const validatedTopPICreators = validateResponse(
      topPICreators,
      defaultTopPICreators,
      'topPICreators',
    );
    const validatedTopItemsPI = validateResponse(
      topItemsPI,
      defaultTopItemsPI,
      'topItemsPI',
    );

    // CALCULATE TOTAL PI VALUE FROM PROFORMAS
    let calculatedTotalValue = 0;
    let creatorData = null;

    // Method 1: From topByValue (most reliable)
    if (
      validatedTopPICreators.topByValue &&
      Array.isArray(validatedTopPICreators.topByValue) &&
      validatedTopPICreators.topByValue.length > 0
    ) {
      creatorData = validatedTopPICreators.topByValue[0];
      if (creatorData.proformas && Array.isArray(creatorData.proformas)) {
        calculatedTotalValue = calculateTotalFromProformas(
          creatorData.proformas,
        );
      }
    }

    // Method 2: From allPreparers
    if (
      calculatedTotalValue === 0 &&
      validatedTopPICreators.allPreparers &&
      Array.isArray(validatedTopPICreators.allPreparers) &&
      validatedTopPICreators.allPreparers.length > 0
    ) {
      creatorData = validatedTopPICreators.allPreparers[0];
      if (creatorData.proformas && Array.isArray(creatorData.proformas)) {
        calculatedTotalValue = calculateTotalFromProformas(
          creatorData.proformas,
        );
      }
    }

    // Method 3: From topByPICount
    if (
      calculatedTotalValue === 0 &&
      validatedTopPICreators.topByPICount &&
      Array.isArray(validatedTopPICreators.topByPICount) &&
      validatedTopPICreators.topByPICount.length > 0
    ) {
      const piCountData = validatedTopPICreators.topByPICount[0];
      if (piCountData.proformas && Array.isArray(piCountData.proformas)) {
        calculatedTotalValue = calculateTotalFromProformas(
          piCountData.proformas,
        );
        if (!creatorData) creatorData = piCountData;
      }
    }

    // Calculate total from PI items/categories using totalRevenue
    let calculatedItemsTotalValue = 0;
    if (
      validatedTopItemsPI.allItems &&
      Array.isArray(validatedTopItemsPI.allItems)
    ) {
      validatedTopItemsPI.allItems.forEach((entry) => {
        const revenue = getNumericValue(entry.totalRevenue);
        calculatedItemsTotalValue += revenue;
      });
    }

    // Use the calculated values
    const totalPIValueFromCreators = calculatedTotalValue;
    const totalPIValueFromItems =
      calculatedItemsTotalValue > 0
        ? calculatedItemsTotalValue
        : calculatedTotalValue;
    const consistentTotalPIValue = Math.max(
      totalPIValueFromCreators,
      totalPIValueFromItems,
    );

    // Calculate additional metrics
    const totalRevenue = getNumericValue(
      validatedItemSales.summary.totalRevenue,
    );
    const totalItemsSold = getNumericValue(
      validatedItemSales.summary.totalItemsSold,
    );
    const totalRequestedQuantity = getNumericValue(
      validatedTopItemsPI.summary.totalRequestedQuantity,
    );

    const conversionRate =
      totalItemsSold > 0 && totalRequestedQuantity > 0
        ? (totalItemsSold / totalRequestedQuantity) * 100
        : 0;

    const revenueConversionRate =
      totalRevenue > 0 && consistentTotalPIValue > 0
        ? (totalRevenue / consistentTotalPIValue) * 100
        : 0;

    const topItemsComparison = [];
    const topPICategories = (validatedTopItemsPI.topByQuantity || []).slice(
      0,
      5,
    );

    topPICategories.forEach((piCategory, idx) => {
      const categoryId = piCategory.categoryId ?? null;
      const categoryName =
        piCategory.categoryName || piCategory.itemName || 'Unknown Category';

      const soldCategoryEntry = (validatedItemSales.allItems || []).find(
        (sale) => sale && categoryId !== null && sale.categoryId === categoryId,
      );

      if (!soldCategoryEntry) {
        console.log(
          `[getCompleteStaticReport] [${idx}] "${categoryName}" (categoryId=${categoryId}) -> NO MATCH in sales data`,
        );
      } else {
        console.log(
          `[getCompleteStaticReport] [${idx}] "${categoryName}" (categoryId=${categoryId}) -> matched:`,
          JSON.stringify(soldCategoryEntry, null, 2),
        );
      }

      const requestedQty = getNumericValue(piCategory.totalRequestedQuantity);
      const soldQty = soldCategoryEntry
        ? getNumericValue(soldCategoryEntry.totalQuantity)
        : 0;
      const categoryValue = getNumericValue(piCategory.totalRevenue);
      const catConversionRate =
        soldQty && requestedQty ? (soldQty / requestedQty) * 100 : 0;
      const gap = requestedQty - soldQty;

      topItemsComparison.push({
        itemName: categoryName, // kept as `itemName` for frontend ComparisonItem type compatibility
        categoryName,
        categoryId,
        requestedQuantity: roundNum(requestedQty),
        soldQuantity: roundNum(soldQty),
        conversionRate: roundNum(catConversionRate),
        gap: roundNum(gap),
        requestedValue: roundNum(categoryValue),
      });
    });

    // Get top PI preparer with properly calculated values
    let topPIPreparerData = null;
    if (creatorData) {
      const creatorTotal = creatorData.proformas
        ? calculateTotalFromProformas(creatorData.proformas)
        : 0;
      const piCount = creatorData.totalPI || creatorData.totalProformas || 0;
      topPIPreparerData = {
        name: creatorData.creatorName || 'Unknown',
        value: roundNum(creatorTotal),
        piCount: roundNum(piCount, 0),
        percentageOfTotal: 100,
      };
    }

    // Top requested item/category by quantity
    const topRequestedEntry = (validatedTopItemsPI.topByQuantity || [])[0];
    const topRequestedItemData = topRequestedEntry
      ? {
          name:
            topRequestedEntry.categoryName ||
            topRequestedEntry.itemName ||
            'Unknown',
          categoryId: topRequestedEntry.categoryId ?? null,
          quantity: roundNum(topRequestedEntry.totalRequestedQuantity, 0),
          value: roundNum(topRequestedEntry.totalRevenue),
        }
      : null;

    // Top requested item/category by value
    const topRequestedEntryByValue = (validatedTopItemsPI.topByRevenue ||
      [])[0];
    const topRequestedItemByValueData = topRequestedEntryByValue
      ? {
          name:
            topRequestedEntryByValue.categoryName ||
            topRequestedEntryByValue.itemName ||
            'Unknown',
          categoryId: topRequestedEntryByValue.categoryId ?? null,
          value: roundNum(topRequestedEntryByValue.totalRevenue),
          quantity: roundNum(
            topRequestedEntryByValue.totalRequestedQuantity,
            0,
          ),
        }
      : null;

    // Build the response — numeric fields are real numbers; only the
    // *ConversionRate fields (typed as strings in the frontend) carry a
    // formatted "X%" string.
    const response = {
      reportDate: new Date(),
      period: {
        startDate: startDate || 'All time',
        endDate: endDate || 'All time',
      },

      itemSalesAnalysis: {
        ...validatedItemSales,
        summary: {
          ...validatedItemSales.summary,
          totalRevenue: roundNum(validatedItemSales.summary.totalRevenue),
          totalItemsSold: roundNum(
            validatedItemSales.summary.totalItemsSold,
            0,
          ),
          totalOrders: roundNum(validatedItemSales.summary.totalOrders, 0),
          uniqueItems: roundNum(validatedItemSales.summary.uniqueItems, 0),
          averagePrice: roundNum(validatedItemSales.summary.averagePrice),
        },
        topByQuantity: (validatedItemSales.topByQuantity || []).map((item) => ({
          ...item,
          totalQuantity: roundNum(item.totalQuantity, 0),
          totalRevenue: roundNum(item.totalRevenue),
          uniqueCustomers: roundNum(item.uniqueCustomers, 0),
        })),
        topByRevenue: (validatedItemSales.topByRevenue || []).map((item) => ({
          ...item,
          totalQuantity: roundNum(item.totalQuantity, 0),
          totalRevenue: roundNum(item.totalRevenue),
          uniqueCustomers: roundNum(item.uniqueCustomers, 0),
        })),
        allItems: (validatedItemSales.allItems || []).map((item) => ({
          ...item,
          totalQuantity: roundNum(item.totalQuantity, 0),
          totalRevenue: roundNum(item.totalRevenue),
          uniqueCustomers: roundNum(item.uniqueCustomers, 0),
        })),
        categoryAnalysis: (validatedItemSales.categoryAnalysis || []).map(
          (cat) => ({
            ...cat,
            totalQuantity: roundNum(cat.totalQuantity, 0),
            totalRevenue: roundNum(cat.totalRevenue),
            uniqueItems: roundNum(cat.uniqueItems, 0),
          }),
        ),
      },

      salesByCreatorAnalysis: {
        ...validatedTopSalesCreators,
        summary: {
          ...validatedTopSalesCreators.summary,
          totalRevenue: roundNum(
            validatedTopSalesCreators.summary.totalRevenue,
          ),
          totalSales: roundNum(validatedTopSalesCreators.summary.totalSales, 0),
          uniqueCreators: roundNum(
            validatedTopSalesCreators.summary.uniqueCreators,
            0,
          ),
        },
        topByQuantity: (validatedTopSalesCreators.topByQuantity || []).map(
          (creator) => ({
            ...creator,
            totalQuantity: roundNum(creator.totalQuantity, 0),
            totalRevenue: roundNum(creator.totalRevenue),
            totalSales: roundNum(creator.totalSales, 0),
            percentageOfTotal: roundNum(creator.percentageOfTotal),
          }),
        ),
        topByRevenue: (validatedTopSalesCreators.topByRevenue || []).map(
          (creator) => ({
            ...creator,
            totalQuantity: roundNum(creator.totalQuantity, 0),
            totalRevenue: roundNum(creator.totalRevenue),
            totalSales: roundNum(creator.totalSales, 0),
            percentageOfTotal: roundNum(creator.percentageOfTotal),
          }),
        ),
        allCreators: (validatedTopSalesCreators.allCreators || []).map(
          (creator) => ({
            ...creator,
            totalQuantity: roundNum(creator.totalQuantity, 0),
            totalRevenue: roundNum(creator.totalRevenue),
            totalSales: roundNum(creator.totalSales, 0),
            percentageOfTotal: roundNum(creator.percentageOfTotal),
          }),
        ),
      },

      proformaByCreatorAnalysis: {
        ...validatedTopPICreators,
        summary: {
          ...validatedTopPICreators.summary,
          totalProformaValue: roundNum(calculatedTotalValue),
          totalPI: roundNum(validatedTopPICreators.summary.totalProformas, 0),
          uniqueCreators: roundNum(
            validatedTopPICreators.summary.activePreparers,
            0,
          ),
        },
        topByValue: (validatedTopPICreators.topByValue || []).map((creator) => {
          const totalValue = creator.proformas
            ? calculateTotalFromProformas(creator.proformas)
            : 0;
          return {
            ...creator,
            totalValue: roundNum(totalValue),
            totalPI: roundNum(creator.totalPI, 0),
            percentageOfTotal: roundNum(creator.percentageOfTotal),
          };
        }),
        // Used by "Sales & Proforma Performance by Person"
        topByPICount: (validatedTopPICreators.topByPICount || []).map(
          (creator) => {
            const totalValue = creator.proformas
              ? calculateTotalFromProformas(creator.proformas)
              : 0;
            return {
              ...creator,
              totalValue: roundNum(totalValue),
              totalPI: roundNum(creator.totalPI, 0),
              percentageOfTotal: roundNum(creator.percentageOfTotal),
            };
          },
        ),
        allPreparers: (validatedTopPICreators.allPreparers || []).map(
          (creator) => {
            const totalValue = creator.proformas
              ? calculateTotalFromProformas(creator.proformas)
              : 0;
            return {
              ...creator,
              totalQuantity: roundNum(creator.totalItemsRequested, 0),
              totalValue: roundNum(totalValue),
              totalPI: roundNum(creator.totalPI, 0),
              percentageOfTotal: roundNum(creator.percentageOfTotal),
            };
          },
        ),
        allCreators: (validatedTopPICreators.allPreparers || []).map(
          (creator) => {
            const totalValue = creator.proformas
              ? calculateTotalFromProformas(creator.proformas)
              : 0;
            return {
              ...creator,
              totalQuantity: roundNum(creator.totalItemsRequested, 0),
              totalValue: roundNum(totalValue),
              totalPI: roundNum(creator.totalPI, 0),
              percentageOfTotal: roundNum(creator.percentageOfTotal),
            };
          },
        ),
      },

      proformaItemsAnalysis: {
        ...validatedTopItemsPI,
        summary: {
          ...validatedTopItemsPI.summary,
          totalRequestedQuantity: roundNum(
            validatedTopItemsPI.summary.totalRequestedQuantity,
            0,
          ),
          totalRequestedValue: roundNum(
            calculatedItemsTotalValue > 0
              ? calculatedItemsTotalValue
              : calculatedTotalValue,
          ),
          totalOrders: roundNum(validatedTopItemsPI.summary.totalOrders, 0),
          uniqueCategories: roundNum(
            validatedTopItemsPI.summary.uniqueCategories ||
              validatedTopItemsPI.summary.uniqueItemsRequested ||
              validatedTopItemsPI.summary.uniqueItems ||
              0,
            0,
          ),
          averageValue: roundNum(
            validatedTopItemsPI.summary.totalRequestedQuantity > 0
              ? (calculatedItemsTotalValue > 0
                  ? calculatedItemsTotalValue
                  : calculatedTotalValue) /
                  validatedTopItemsPI.summary.totalRequestedQuantity
              : 0,
          ),
        },
        topByQuantity: (validatedTopItemsPI.topByQuantity || []).map(
          (entry) => ({
            ...entry,
            categoryName:
              entry.categoryName || entry.itemName || 'Unknown Category',
            categoryId: entry.categoryId ?? null,
            totalRequestedQuantity: roundNum(entry.totalRequestedQuantity, 0),
            totalValue: roundNum(getNumericValue(entry.totalRevenue)),
          }),
        ),
        topByRevenue: (validatedTopItemsPI.topByRevenue || []).map((entry) => ({
          ...entry,
          categoryName:
            entry.categoryName || entry.itemName || 'Unknown Category',
          categoryId: entry.categoryId ?? null,
          totalRequestedQuantity: roundNum(entry.totalRequestedQuantity, 0),
          totalValue: roundNum(getNumericValue(entry.totalRevenue)),
        })),
        allItems: (validatedTopItemsPI.allItems || []).map((entry) => ({
          ...entry,
          categoryName:
            entry.categoryName || entry.itemName || 'Unknown Category',
          categoryId: entry.categoryId ?? null,
          totalRequestedQuantity: roundNum(entry.totalRequestedQuantity, 0),
          totalValue: roundNum(getNumericValue(entry.totalRevenue)),
        })),
        categoryAnalysis: (validatedTopItemsPI.categoryAnalysis || []).map(
          (cat) => ({
            ...cat,
            totalRequestedQuantity: roundNum(cat.totalRequestedQuantity, 0),
            totalValue: roundNum(getNumericValue(cat.totalValue)),
            uniqueItems: roundNum(cat.uniqueItems, 0),
          }),
        ),
      },

      // Executive Summary — numbers except the two *ConversionRate string fields
      executiveSummary: {
        totalRevenueFromSales: roundNum(totalRevenue),
        totalProformaValue: roundNum(consistentTotalPIValue),
        revenueConversionRate: formatPercent(revenueConversionRate),
        totalItemsSold: roundNum(totalItemsSold, 0),
        totalItemsRequested: roundNum(totalRequestedQuantity, 0),
        quantityConversionRate: formatPercent(conversionRate),

        topSellingItemByQuantity: (validatedItemSales.topByQuantity || [])[0]
          ? {
              name: validatedItemSales.topByQuantity[0].itemName || 'Unknown',
              quantity: roundNum(
                validatedItemSales.topByQuantity[0].totalQuantity,
                0,
              ),
              revenue: roundNum(
                validatedItemSales.topByQuantity[0].totalRevenue,
              ),
            }
          : null,

        topRequestedItemByQuantity: topRequestedItemData,

        topSellingItemByRevenue: (validatedItemSales.topByRevenue || [])[0]
          ? {
              name: validatedItemSales.topByRevenue[0].itemName || 'Unknown',
              revenue: roundNum(
                validatedItemSales.topByRevenue[0].totalRevenue,
              ),
              quantity: roundNum(
                validatedItemSales.topByRevenue[0].totalQuantity,
                0,
              ),
            }
          : null,

        topRequestedItemByValue: topRequestedItemByValueData,

        topSalesPerson: (validatedTopSalesCreators.topByRevenue || [])[0]
          ? {
              name:
                validatedTopSalesCreators.topByRevenue[0].creatorName ||
                'Unknown',
              revenue: roundNum(
                validatedTopSalesCreators.topByRevenue[0].totalRevenue,
              ),
              salesCount: roundNum(
                validatedTopSalesCreators.topByRevenue[0].totalSales,
                0,
              ),
              percentageOfTotal: roundNum(
                validatedTopSalesCreators.topByRevenue[0].percentageOfTotal,
              ),
            }
          : null,

        topPIPreparer: topPIPreparerData,

        averageOrderValue: roundNum(
          (validatedItemSales.summary.totalOrders || 0) > 0
            ? totalRevenue / validatedItemSales.summary.totalOrders
            : 0,
        ),
        averageProformaValue: roundNum(
          (validatedTopItemsPI.summary.totalOrders || 0) > 0
            ? consistentTotalPIValue / validatedTopItemsPI.summary.totalOrders
            : 0,
        ),
        uniqueCustomers: roundNum(
          (validatedItemSales.allItems || []).reduce(
            (sum, item) => sum + (item.uniqueCustomers || 0),
            0,
          ),
          0,
        ),
      },

      // Comparison Analysis — kept as top5ItemsComparison for frontend type
      // compatibility; entries are category-matched (see topItemsComparison above)
      comparisonAnalysis: {
        top5ItemsComparison: topItemsComparison,
        summary: {
          totalGapQuantity: roundNum(
            topItemsComparison.reduce((sum, item) => sum + (item.gap || 0), 0),
          ),
          averageConversionRate: formatPercent(
            topItemsComparison.reduce(
              (sum, item) => sum + (item.conversionRate || 0),
              0,
            ) / (topItemsComparison.length || 1),
          ),
        },
      },

      generatedAt: new Date(),
    };

    return response;
  } catch (error) {
    console.error('[getCompleteStaticReport] ERROR:', error);
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

    const monthlyBreakdown = [];

    for (let month = 0; month < 12; month++) {
      const monthStart = new Date(targetYear, month, 1);
      const monthEnd = new Date(targetYear, month + 1, 0, 23, 59, 59);

      // Get proforma payments for this month (store = false)
      const proformaPayments = await prisma.proformaInvoiceBank.findMany({
        where: {
          proformaInvoice: {
            store: false,
          },
          createdAt: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
        select: {
          amount: true,
        },
      });

      // Get sell payments for this month
      const sellPayments = await prisma.sellPayment.findMany({
        where: {
          createdAt: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
        select: {
          amount: true,
        },
      });

      // Calculate total paid amounts
      const proformaPaid = Number(
        proformaPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
      );

      const sellPaid = Number(
        sellPayments.reduce((sum, s) => sum + (Number(s.amount) || 0), 0),
      );

      // Round to 2 decimal places
      const roundToTwo = (num) => Number(num.toFixed(2));

      const proformaPaidRounded = roundToTwo(proformaPaid);
      const sellPaidRounded = roundToTwo(sellPaid);
      const totalPaid = roundToTwo(proformaPaid + sellPaid);

      monthlyBreakdown.push({
        month,
        monthName: new Date(targetYear, month, 1).toLocaleString('default', {
          month: 'long',
        }),
        proformaPaid: proformaPaidRounded,
        sellPaid: sellPaidRounded,
        totalPaid,
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

      const stageDeliveryDate = deliveryStage.endDate;
      const { requestedDelivery } = project;
      const { newRequestedDelivery } = project;

      // Check if we have at least one requested date to compare
      const hasRequestedDate = requestedDelivery || newRequestedDelivery;

      // Skip if no stage date or no requested date
      if (!stageDeliveryDate || !hasRequestedDate) {
        return acc;
      }

      const stageDate = new Date(stageDeliveryDate);
      let mismatched = false;
      const dateComparisons = {};

      // Helper function to calculate date status
      const getDateStatus = (date) => {
        if (!date) return null;

        try {
          const dateObj = new Date(date);
          if (isNaN(dateObj.getTime())) return null;

          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const compareDate = new Date(date);
          compareDate.setHours(0, 0, 0, 0);

          // Calculate days difference
          const diffDays = Math.ceil(
            (compareDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
          );

          // Compare stage date with requested date
          if (stageDate > dateObj) {
            return {
              status: 'delayed',
              color: 'bg-red-100 text-red-800 border-red-300',
              label: '❌ Delayed',
              badgeVariant: 'destructive',
            };
          }

          // Check if requested date is approaching or overdue
          if (diffDays < 0) {
            return {
              status: 'delayed',
              color: 'bg-red-100 text-red-800 border-red-300',
              label: '⚠️ Overdue!',
              badgeVariant: 'destructive',
            };
          }
          if (diffDays <= 7) {
            return {
              status: 'warning',
              color: 'bg-yellow-100 text-yellow-800 border-yellow-300',
              label: '⚠️ Approaching Deadline',
              badgeVariant: 'secondary',
            };
          }
          return {
            status: 'in-time',
            color: 'bg-green-100 text-green-800 border-green-300',
            label: '✅ In Time',
            badgeVariant: 'default',
          };
        } catch (error) {
          return null;
        }
      };

      // Compare stage with requestedDelivery
      if (requestedDelivery) {
        const requestedDate = new Date(requestedDelivery);
        if (stageDate.toDateString() !== requestedDate.toDateString()) {
          mismatched = true;
          const diffDays = Math.ceil(
            Math.abs(stageDate.getTime() - requestedDate.getTime()) /
              (1000 * 60 * 60 * 24),
          );
          dateComparisons.requestedDelivery = {
            differenceInDays: diffDays,
            whichIsEarlier:
              requestedDate < stageDate
                ? 'Requested Delivery Date'
                : 'Stage Delivery Date',
            suggestion:
              requestedDate < stageDate
                ? 'Consider updating stage delivery date or recalculating schedule'
                : 'Consider updating requested delivery date or checking stage delays',
          };
        } else {
          dateComparisons.requestedDelivery = {
            differenceInDays: 0,
            whichIsEarlier: 'Same Date',
            suggestion: 'Dates are aligned',
          };
        }
      }

      // Compare stage with newRequestedDelivery
      if (newRequestedDelivery) {
        const newRequestedDate = new Date(newRequestedDelivery);
        if (stageDate.toDateString() !== newRequestedDate.toDateString()) {
          mismatched = true;
          const diffDays = Math.ceil(
            Math.abs(stageDate.getTime() - newRequestedDate.getTime()) /
              (1000 * 60 * 60 * 24),
          );
          dateComparisons.newRequestedDelivery = {
            differenceInDays: diffDays,
            whichIsEarlier:
              newRequestedDate < stageDate
                ? 'New Requested Delivery Date'
                : 'Stage Delivery Date',
            suggestion:
              newRequestedDate < stageDate
                ? 'Consider updating stage delivery date or recalculating schedule'
                : 'Consider updating new requested delivery date or checking stage delays',
          };
        } else {
          dateComparisons.newRequestedDelivery = {
            differenceInDays: 0,
            whichIsEarlier: 'Same Date',
            suggestion: 'Dates are aligned',
          };
        }
      }

      // Only include in report if there's a mismatch
      if (mismatched) {
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
                newRequestedDelivery: project.newRequestedDelivery,
                stageDeliveryDate,
              },
              dateComparisons,
              statuses: {
                requestedDeliveryStatus: requestedDelivery
                  ? getDateStatus(requestedDelivery)
                  : null,
                newRequestedDeliveryStatus: newRequestedDelivery
                  ? getDateStatus(newRequestedDelivery)
                  : null,
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
      const { projectEndDate } = project;

      // Skip projects with missing dates
      if (!projectDeliveryDate || !stageDeliveryDate) {
        return acc;
      }

      const projectDate = new Date(projectDeliveryDate);
      const stageDate = new Date(stageDeliveryDate);
      let mismatched = false;
      const dateComparisons = {};

      // Compare project delivery date with stage delivery date
      if (projectDate.toDateString() !== stageDate.toDateString()) {
        mismatched = true;
        const diffDays = Math.ceil(
          Math.abs(projectDate.getTime() - stageDate.getTime()) /
            (1000 * 60 * 60 * 24),
        );
        dateComparisons.projectVsStage = {
          differenceInDays: diffDays,
          whichIsEarlier:
            projectDate < stageDate
              ? 'Project Delivery Date'
              : 'Stage Delivery Date',
          suggestion:
            projectDate < stageDate
              ? 'Consider updating stage delivery date or recalculating schedule'
              : 'Consider updating project delivery date or checking stage delays',
        };
      }

      // Compare requested delivery with stage delivery (if requested exists)
      if (project.requestedDelivery) {
        const requestedDate = new Date(project.requestedDelivery);
        if (requestedDate.toDateString() !== stageDate.toDateString()) {
          mismatched = true;
          const diffDays = Math.ceil(
            Math.abs(requestedDate.getTime() - stageDate.getTime()) /
              (1000 * 60 * 60 * 24),
          );
          dateComparisons.requestedVsStage = {
            differenceInDays: diffDays,
            whichIsEarlier:
              requestedDate < stageDate
                ? 'Requested Delivery Date'
                : 'Stage Delivery Date',
            suggestion:
              requestedDate < stageDate
                ? 'Consider updating stage delivery date or recalculating schedule'
                : 'Consider updating requested delivery date or checking stage delays',
          };
        }
      }

      // Compare new requested delivery with stage delivery (if new requested exists)
      if (project.newRequestedDelivery) {
        const newRequestedDate = new Date(project.newRequestedDelivery);
        if (newRequestedDate.toDateString() !== stageDate.toDateString()) {
          mismatched = true;
          const diffDays = Math.ceil(
            Math.abs(newRequestedDate.getTime() - stageDate.getTime()) /
              (1000 * 60 * 60 * 24),
          );
          dateComparisons.newRequestedVsStage = {
            differenceInDays: diffDays,
            whichIsEarlier:
              newRequestedDate < stageDate
                ? 'New Requested Delivery Date'
                : 'Stage Delivery Date',
            suggestion:
              newRequestedDate < stageDate
                ? 'Consider updating stage delivery date or recalculating schedule'
                : 'Consider updating new requested delivery date or checking stage delays',
          };
        }
      }

      // Only include in report if there's a mismatch
      if (mismatched) {
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
                newRequestedDelivery: project.newRequestedDelivery,
                projectFinalDelivery: projectDeliveryDate,
                stageDeliveryDate,
                projectEndDate,
              },
              dateComparisons,
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
