// services/factoryResetService.js
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Factory Reset - Delete all data
const factoryReset = async () => {
  try {
    console.log('🚨 Starting factory reset...');

    // Disable foreign key checks
    await prisma.$executeRaw`SET FOREIGN_KEY_CHECKS = 0;`;

    // Delete all data in correct dependency order
    await prisma.sellStockCorrectionBatch.deleteMany();
    await prisma.sellStockCorrectionItem.deleteMany();
    await prisma.sellStockCorrection.deleteMany();
    await prisma.sellItemBatch.deleteMany();
    await prisma.sellItem.deleteMany();
    await prisma.sell.deleteMany();
    await prisma.cartItem.deleteMany();
    await prisma.addToCart.deleteMany();
    await prisma.stockCorrectionItem.deleteMany();
    await prisma.stockCorrection.deleteMany();
    await prisma.transferItem.deleteMany();
    await prisma.transfer.deleteMany();
    await prisma.purchaseItem.deleteMany();
    await prisma.purchase.deleteMany();
    await prisma.stockLedger.deleteMany();
    await prisma.shopStock.deleteMany();
    await prisma.storeStock.deleteMany();
    await prisma.productBatch.deleteMany();
    await prisma.log.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.additionalPrice.deleteMany();
    await prisma.product.deleteMany();
    await prisma.subCategory.deleteMany();
    await prisma.category.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.supplier.deleteMany();
    await prisma.unitOfMeasure.deleteMany();
    await prisma.user.deleteMany();
    await prisma.role.deleteMany();
    await prisma.permission.deleteMany();
    await prisma.shop.deleteMany();
    await prisma.store.deleteMany();
    await prisma.branch.deleteMany();
    await prisma.company.deleteMany();

    // Re-enable foreign key checks
    await prisma.$executeRaw`SET FOREIGN_KEY_CHECKS = 1;`;

    console.log('✅ Factory reset completed successfully');
    return {
      success: true,
      message: 'All data has been successfully deleted. Database is now empty.',
    };
  } catch (error) {
    console.error('❌ Factory reset failed:', error);

    // Ensure foreign key checks are re-enabled even if error occurs
    await prisma.$executeRaw`SET FOREIGN_KEY_CHECKS = 1;`.catch(() => {});

    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Factory reset failed: ${error.message}`,
    );
  }
};

module.exports = {
  factoryReset,
};
