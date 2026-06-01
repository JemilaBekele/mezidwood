/* eslint-disable no-underscore-dangle */
const prisma = require('./prisma');

class InventoryDashboardService {
  static async getInventoryDashboard() {
    try {
      return await prisma.$transaction(async (tx) => {
        const methods = [
          { name: '_getExpiringBatches', method: this._getExpiringBatches },
          { name: '_getLowStockAlerts', method: this._getLowStockAlerts },
          { name: '_getTopItemsByValue', method: this._getTopItemsByValue },
          {
            name: '_getInventoryAgingReport',
            method: this._getInventoryAgingReport,
          },
        ];

        const results = await Promise.all(
          methods.map(async ({ name, method }) => {
            try {
              const result = await method.call(this, tx);
              return result;
            } catch (error) {
              console.error(`❌ Error in ${name}:`, error.message, error.stack);
              throw error;
            }
          }),
        );

        const [expiringSoon, lowStockItems, topItems, agingReport] = results;

        const dashboardData = {
          alerts: {
            expiringSoon,
            lowStockItems,
          },
          tables: {
            topItems,
            agingReport,
          },
          lastUpdated: new Date(),
        };

        return dashboardData;
      });
    } catch (error) {
      console.error('❌ Transaction failed:', error.message, error.stack);
      throw error;
    } finally {
    }
  }

  static async _getExpiringBatches(tx, days = 365) {
    try {
      const now = new Date();
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + days);

      const result = await tx.$queryRaw`
      SELECT 
        pb._id as batchId,
        pb.batchNumber,
        pb.expiryDate,
        pb.price as unitPrice,
        p.sellPrice,
        p.name as productName,
        p.productCode,
        c.name as categoryName,
        COALESCE(store_stock.total_qty, 0) + COALESCE(shop_stock.total_qty, 0) as totalQuantity,
        DATEDIFF(pb.expiryDate, NOW()) as daysUntilExpiry
      FROM product_batches pb
      INNER JOIN products p ON pb.productId = p._id
      INNER JOIN categories c ON p.categoryId = c._id
      LEFT JOIN (
        SELECT batchId, SUM(quantity) as total_qty 
        FROM store_stocks 
        WHERE status = 'Available'
        GROUP BY batchId
      ) as store_stock ON pb._id = store_stock.batchId
      LEFT JOIN (
        SELECT batchId, SUM(quantity) as total_qty 
        FROM shop_stocks 
        WHERE status = 'Available'
        GROUP BY batchId
      ) as shop_stock ON pb._id = shop_stock.batchId
      WHERE pb.expiryDate IS NOT NULL
        AND pb.expiryDate BETWEEN ${now} AND ${expiryDate}
        AND (COALESCE(store_stock.total_qty, 0) + COALESCE(shop_stock.total_qty, 0)) > 0
      GROUP BY pb._id, pb.batchNumber, pb.expiryDate, pb.price, p.sellPrice, p.name, p.productCode, c.name
      ORDER BY pb.expiryDate ASC
    `;

      return result;
    } catch (error) {
      console.error(
        '❌ _getExpiringBatches failed:',
        error.message,
        error.stack,
      );
      throw error;
    }
  }

  static async _getLowStockAlerts(tx) {
    try {
      const result = await tx.$queryRaw`
      SELECT 
        p._id,
        p.name as productName,
        p.productCode,
        pb.batchNumber,
        pb.warningQuantity,
        COALESCE(store_stock.total_qty, 0) + COALESCE(shop_stock.total_qty, 0) as currentStock,
        c.name as categoryName,
        CASE 
          WHEN (COALESCE(store_stock.total_qty, 0) + COALESCE(shop_stock.total_qty, 0)) = 0 THEN 'OUT_OF_STOCK'
          ELSE 'LOW_STOCK'
        END as alertType,
        ROUND(
          ((COALESCE(store_stock.total_qty, 0) + COALESCE(shop_stock.total_qty, 0)) * 100.0) / 
          NULLIF(pb.warningQuantity, 0), 
          2
        ) as stockPercentage
      FROM products p
      INNER JOIN product_batches pb ON p._id = pb.productId
      INNER JOIN categories c ON p.categoryId = c._id
      LEFT JOIN (
        SELECT batchId, SUM(quantity) as total_qty 
        FROM store_stocks 
        WHERE status = 'Available'
        GROUP BY batchId
      ) as store_stock ON pb._id = store_stock.batchId
      LEFT JOIN (
        SELECT batchId, SUM(quantity) as total_qty 
        FROM shop_stocks 
        WHERE status = 'Available'
        GROUP BY batchId
      ) as shop_stock ON pb._id = shop_stock.batchId
      WHERE pb.warningQuantity IS NOT NULL 
        AND pb.warningQuantity > 0
        AND (
          (COALESCE(store_stock.total_qty, 0) + COALESCE(shop_stock.total_qty, 0)) <= pb.warningQuantity
          OR (COALESCE(store_stock.total_qty, 0) + COALESCE(shop_stock.total_qty, 0)) = 0
        )
      GROUP BY p._id, p.name, p.productCode, pb.batchNumber, pb.warningQuantity, c.name
      ORDER BY 
        CASE 
          WHEN (COALESCE(store_stock.total_qty, 0) + COALESCE(shop_stock.total_qty, 0)) = 0 THEN 0
          ELSE (COALESCE(store_stock.total_qty, 0) + COALESCE(shop_stock.total_qty, 0)) / pb.warningQuantity
        END ASC,
        pb.warningQuantity DESC
      LIMIT 50
    `;

      return result;
    } catch (error) {
      console.error(
        '❌ _getLowStockAlerts failed:',
        error.message,
        error.stack,
      );
      throw error;
    }
  }

  static async _getTopItemsByValue(tx, limit = 10) {
    try {
      const result = await tx.$queryRaw`
    SELECT 
      p._id,
      p.name as productName,
      p.productCode,
      c.name as category,
      SUM(COALESCE(store_stock.total_qty, 0) + COALESCE(shop_stock.total_qty, 0)) as totalQuantity,
      SUM(pb.price * (COALESCE(store_stock.total_qty, 0) + COALESCE(shop_stock.total_qty, 0))) as totalCostValue,
      SUM(p.sellPrice * (COALESCE(store_stock.total_qty, 0) + COALESCE(shop_stock.total_qty, 0))) as totalRetailValue
    FROM products p
    INNER JOIN categories c ON p.categoryId = c._id
    INNER JOIN product_batches pb ON p._id = pb.productId
    LEFT JOIN (
      SELECT batchId, SUM(quantity) as total_qty 
      FROM store_stocks 
      WHERE status = 'Available'
      GROUP BY batchId
    ) as store_stock ON pb._id = store_stock.batchId
    LEFT JOIN (
      SELECT batchId, SUM(quantity) as total_qty 
      FROM shop_stocks 
      WHERE status = 'Available'
      GROUP BY batchId
    ) as shop_stock ON pb._id = shop_stock.batchId
    WHERE (COALESCE(store_stock.total_qty, 0) + COALESCE(shop_stock.total_qty, 0)) > 0
    GROUP BY p._id, p.name, p.productCode, c.name
    ORDER BY totalQuantity DESC  -- Changed from totalCostValue to totalQuantity
    LIMIT ${limit}
  `;

      return result;
    } catch (error) {
      console.error(
        '❌ _getTopItemsByQuantity failed:',
        error.message,
        error.stack,
      );
      throw error;
    }
  }

  static async _getInventoryAgingReport(tx, limit = 50) {
    try {
      // Fixed MySQL query to show only the most aged items
      const result = await tx.$queryRaw`
      SELECT 
        p._id as id,
        p.name as productName,
        p.productCode,
        pb.batchNumber,
        pb.createdAt as batchDate,
        COALESCE(SUM(store_stock.total_qty), 0) + COALESCE(SUM(shop_stock.total_qty), 0) as quantity,
        DATEDIFF(NOW(), pb.createdAt) as daysInInventory,
        SUM(pb.price * (COALESCE(store_stock.total_qty, 0) + COALESCE(shop_stock.total_qty, 0))) as inventoryValue,
        c.name as categoryName
      FROM product_batches pb
      INNER JOIN products p ON pb.productId = p._id
      INNER JOIN categories c ON p.categoryId = c._id
      LEFT JOIN (
        SELECT batchId, SUM(quantity) as total_qty 
        FROM store_stocks 
        WHERE status = 'Available'
        GROUP BY batchId
      ) as store_stock ON pb._id = store_stock.batchId
      LEFT JOIN (
        SELECT batchId, SUM(quantity) as total_qty 
        FROM shop_stocks 
        WHERE status = 'Available'
        GROUP BY batchId
      ) as shop_stock ON pb._id = shop_stock.batchId
      WHERE (COALESCE(store_stock.total_qty, 0) + COALESCE(shop_stock.total_qty, 0)) > 0
        AND DATEDIFF(NOW(), pb.createdAt) >= 30  -- Only show items older than 30 days
      GROUP BY p._id, p.name, p.productCode, pb.batchNumber, pb.createdAt, c.name
      ORDER BY daysInInventory DESC  -- Show oldest items first
      LIMIT ${limit}  -- Limit to show only the most aged items
    `;

      // If no items are older than 30 days, show the oldest items regardless of age
      if (result.length === 0) {
        const fallbackResult = await tx.$queryRaw`
        SELECT 
          p._id as id,
          p.name as productName,
          p.productCode,
          pb.batchNumber,
          pb.createdAt as batchDate,
          COALESCE(SUM(store_stock.total_qty), 0) + COALESCE(SUM(shop_stock.total_qty), 0) as quantity,
          DATEDIFF(NOW(), pb.createdAt) as daysInInventory,
          SUM(pb.price * (COALESCE(store_stock.total_qty, 0) + COALESCE(shop_stock.total_qty, 0))) as inventoryValue,
          c.name as categoryName
        FROM product_batches pb
        INNER JOIN products p ON pb.productId = p._id
        INNER JOIN categories c ON p.categoryId = c._id
        LEFT JOIN (
          SELECT batchId, SUM(quantity) as total_qty 
          FROM store_stocks 
          WHERE status = 'Available'
          GROUP BY batchId
        ) as store_stock ON pb._id = store_stock.batchId
        LEFT JOIN (
          SELECT batchId, SUM(quantity) as total_qty 
          FROM shop_stocks 
          WHERE status = 'Available'
          GROUP BY batchId
        ) as shop_stock ON pb._id = shop_stock.batchId
        WHERE (COALESCE(store_stock.total_qty, 0) + COALESCE(shop_stock.total_qty, 0)) > 0
        GROUP BY p._id, p.name, p.productCode, pb.batchNumber, pb.createdAt, c.name
        ORDER BY daysInInventory DESC  -- Show oldest items first
        LIMIT ${limit}
      `;

        console.log(
          '⚠️ No items older than 30 days. Showing oldest items regardless of age:',
          {
            recordCount: fallbackResult?.length,
            maxAge: fallbackResult[0]?.daysInInventory || 0,
          },
        );

        return fallbackResult;
      }

      console.log('✅ _getInventoryAgingReport success:', {
        recordCount: result?.length,
        maxAge: result[0]?.daysInInventory || 0,
        minAge: result[result.length - 1]?.daysInInventory || 0,
      });

      return result;
    } catch (error) {
      console.error(
        '❌ _getInventoryAgingReport failed:',
        error.message,
        error.stack,
      );
      throw error;
    }
  }
}

module.exports = InventoryDashboardService;
