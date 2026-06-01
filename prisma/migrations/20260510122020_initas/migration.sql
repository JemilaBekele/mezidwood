/*
  Warnings:

  - You are about to drop the column `isBox` on the `additional_prices` table. All the data in the column will be lost.
  - You are about to drop the column `additiveType` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `boxSize` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `brandId` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `generic` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `hasBox` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `numberunitOfMeasure` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `oilType` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `viscosity` on the `products` table. All the data in the column will be lost.
  - You are about to drop the column `isBox` on the `purchase_items` table. All the data in the column will be lost.
  - You are about to drop the column `documentUrl` on the `purchases` table. All the data in the column will be lost.
  - You are about to drop the column `imageUrl` on the `purchases` table. All the data in the column will be lost.
  - You are about to drop the column `shopId` on the `purchases` table. All the data in the column will be lost.
  - You are about to drop the column `isBox` on the `stock_correction_items` table. All the data in the column will be lost.
  - You are about to drop the column `boxQuantity` on the `stock_ledgers` table. All the data in the column will be lost.
  - You are about to drop the column `pieceQuantity` on the `stock_ledgers` table. All the data in the column will be lost.
  - You are about to drop the column `isBox` on the `transfer_items` table. All the data in the column will be lost.
  - You are about to drop the `brands` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `proforma_items` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `proformas` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `sell_items` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `sell_payments` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `sell_stock_correction_items` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `sell_stock_corrections` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `sells` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[name]` on the table `unitofmeasure` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `unitOfMeasureId` to the `purchase_items` table without a default value. This is not possible if the table is not empty.
  - Made the column `storeId` on table `purchases` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `unitOfMeasureId` to the `shop_stocks` table without a default value. This is not possible if the table is not empty.
  - Added the required column `unitOfMeasureId` to the `stock_correction_items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `unitOfMeasureId` to the `stock_ledgers` table without a default value. This is not possible if the table is not empty.
  - Added the required column `unitOfMeasureId` to the `store_stocks` table without a default value. This is not possible if the table is not empty.
  - Added the required column `unitOfMeasureId` to the `transfer_items` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `products` DROP FOREIGN KEY `products_brandId_fkey`;

-- DropForeignKey
ALTER TABLE `proforma_items` DROP FOREIGN KEY `proforma_items_productId_fkey`;

-- DropForeignKey
ALTER TABLE `proforma_items` DROP FOREIGN KEY `proforma_items_proformaId_fkey`;

-- DropForeignKey
ALTER TABLE `proformas` DROP FOREIGN KEY `proformas_createdById_fkey`;

-- DropForeignKey
ALTER TABLE `proformas` DROP FOREIGN KEY `proformas_customerId_fkey`;

-- DropForeignKey
ALTER TABLE `proformas` DROP FOREIGN KEY `proformas_shopId_fkey`;

-- DropForeignKey
ALTER TABLE `proformas` DROP FOREIGN KEY `proformas_updatedById_fkey`;

-- DropForeignKey
ALTER TABLE `purchases` DROP FOREIGN KEY `purchases_shopId_fkey`;

-- DropForeignKey
ALTER TABLE `purchases` DROP FOREIGN KEY `purchases_storeId_fkey`;

-- DropForeignKey
ALTER TABLE `sell_items` DROP FOREIGN KEY `sell_items_productId_fkey`;

-- DropForeignKey
ALTER TABLE `sell_items` DROP FOREIGN KEY `sell_items_sellId_fkey`;

-- DropForeignKey
ALTER TABLE `sell_items` DROP FOREIGN KEY `sell_items_shopId_fkey`;

-- DropForeignKey
ALTER TABLE `sell_payments` DROP FOREIGN KEY `sell_payments_createdById_fkey`;

-- DropForeignKey
ALTER TABLE `sell_payments` DROP FOREIGN KEY `sell_payments_sellId_fkey`;

-- DropForeignKey
ALTER TABLE `sell_stock_correction_items` DROP FOREIGN KEY `sell_stock_correction_items_correctionId_fkey`;

-- DropForeignKey
ALTER TABLE `sell_stock_correction_items` DROP FOREIGN KEY `sell_stock_correction_items_productId_fkey`;

-- DropForeignKey
ALTER TABLE `sell_stock_correction_items` DROP FOREIGN KEY `sell_stock_correction_items_shopId_fkey`;

-- DropForeignKey
ALTER TABLE `sell_stock_corrections` DROP FOREIGN KEY `sell_stock_corrections_createdById_fkey`;

-- DropForeignKey
ALTER TABLE `sell_stock_corrections` DROP FOREIGN KEY `sell_stock_corrections_sellId_fkey`;

-- DropForeignKey
ALTER TABLE `sell_stock_corrections` DROP FOREIGN KEY `sell_stock_corrections_updatedById_fkey`;

-- DropForeignKey
ALTER TABLE `sells` DROP FOREIGN KEY `sells_branchId_fkey`;

-- DropForeignKey
ALTER TABLE `sells` DROP FOREIGN KEY `sells_createdById_fkey`;

-- DropForeignKey
ALTER TABLE `sells` DROP FOREIGN KEY `sells_customerId_fkey`;

-- DropForeignKey
ALTER TABLE `sells` DROP FOREIGN KEY `sells_updatedById_fkey`;

-- DropIndex
DROP INDEX `products_brandId_fkey` ON `products`;

-- DropIndex
DROP INDEX `purchases_shopId_fkey` ON `purchases`;

-- DropIndex
DROP INDEX `purchases_storeId_fkey` ON `purchases`;

-- DropIndex
DROP INDEX `UnitOfMeasure_symbol_key` ON `unitofmeasure`;

-- AlterTable
ALTER TABLE `additional_prices` DROP COLUMN `isBox`;

-- AlterTable
ALTER TABLE `products` DROP COLUMN `additiveType`,
    DROP COLUMN `boxSize`,
    DROP COLUMN `brandId`,
    DROP COLUMN `generic`,
    DROP COLUMN `hasBox`,
    DROP COLUMN `numberunitOfMeasure`,
    DROP COLUMN `oilType`,
    DROP COLUMN `viscosity`,
    ADD COLUMN `bracketsCurtain` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `colourId` VARCHAR(191) NULL,
    ADD COLUMN `curtainTypeId` CHAR(36) NULL,
    ADD COLUMN `fabricName` VARCHAR(191) NULL,
    ADD COLUMN `poleCurtain` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `pricePerMeter` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `pullsCurtain` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `shatterVertical` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `thickCurtain` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `thinCurtain` BOOLEAN NULL DEFAULT false,
    MODIFY `imageUrl` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `purchase_items` DROP COLUMN `isBox`,
    ADD COLUMN `height` DOUBLE NULL,
    ADD COLUMN `unitOfMeasureId` VARCHAR(191) NOT NULL,
    ADD COLUMN `width` DOUBLE NULL;

-- AlterTable
ALTER TABLE `purchases` DROP COLUMN `documentUrl`,
    DROP COLUMN `imageUrl`,
    DROP COLUMN `shopId`,
    MODIFY `storeId` CHAR(36) NOT NULL,
    MODIFY `paymentStatus` ENUM('PAID', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE `shop_stocks` ADD COLUMN `unitOfMeasureId` VARCHAR(191) NOT NULL,
    MODIFY `quantity` INTEGER NULL;

-- AlterTable
ALTER TABLE `stock_correction_items` DROP COLUMN `isBox`,
    ADD COLUMN `height` DOUBLE NULL,
    ADD COLUMN `unitOfMeasureId` VARCHAR(191) NOT NULL,
    ADD COLUMN `width` DOUBLE NULL;

-- AlterTable
ALTER TABLE `stock_corrections` ADD COLUMN `approvedById` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `stock_ledgers` DROP COLUMN `boxQuantity`,
    DROP COLUMN `pieceQuantity`,
    ADD COLUMN `height` DOUBLE NULL,
    ADD COLUMN `quantity` INTEGER NULL,
    ADD COLUMN `unitOfMeasureId` VARCHAR(191) NOT NULL,
    ADD COLUMN `width` DOUBLE NULL;

-- AlterTable
ALTER TABLE `store_stocks` ADD COLUMN `unitOfMeasureId` VARCHAR(191) NOT NULL,
    MODIFY `quantity` INTEGER NULL;

-- AlterTable
ALTER TABLE `transfer_items` DROP COLUMN `isBox`,
    ADD COLUMN `height` DOUBLE NULL,
    ADD COLUMN `unitOfMeasureId` VARCHAR(191) NOT NULL,
    ADD COLUMN `width` DOUBLE NULL;

-- AlterTable
ALTER TABLE `unitofmeasure` ADD COLUMN `base` BOOLEAN NOT NULL DEFAULT false,
    MODIFY `symbol` VARCHAR(191) NULL;

-- DropTable
DROP TABLE `brands`;

-- DropTable
DROP TABLE `proforma_items`;

-- DropTable
DROP TABLE `proformas`;

-- DropTable
DROP TABLE `sell_items`;

-- DropTable
DROP TABLE `sell_payments`;

-- DropTable
DROP TABLE `sell_stock_correction_items`;

-- DropTable
DROP TABLE `sell_stock_corrections`;

-- DropTable
DROP TABLE `sells`;

-- CreateTable
CREATE TABLE `StoreProductVariant` (
    `id` VARCHAR(191) NOT NULL,
    `storeStockId` VARCHAR(191) NOT NULL,
    `height` DOUBLE NOT NULL,
    `width` DOUBLE NOT NULL,
    `quantity` INTEGER NOT NULL,

    UNIQUE INDEX `StoreProductVariant_storeStockId_height_width_key`(`storeStockId`, `height`, `width`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShopProductVariant` (
    `id` VARCHAR(191) NOT NULL,
    `shopStockId` VARCHAR(191) NOT NULL,
    `height` DOUBLE NOT NULL,
    `width` DOUBLE NOT NULL,
    `quantity` INTEGER NOT NULL,

    UNIQUE INDEX `ShopProductVariant_shopStockId_height_width_key`(`shopStockId`, `height`, `width`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `colours` (
    `_id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `curtain_types` (
    `_id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `curtain_types_name_key`(`name`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `movement_types` (
    `_id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `movement_types_name_key`(`name`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expenses` (
    `_id` CHAR(36) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `amount` DOUBLE NOT NULL,
    `expenseDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `curtain_orders` (
    `_id` CHAR(36) NOT NULL,
    `code` VARCHAR(191) NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `movementTypeId` CHAR(36) NULL,
    `curtainStatus` ENUM('PENDING', 'FINISHED', 'RETURNED', 'COMPLETED', 'CANCELLED', 'DELIVERED') NOT NULL DEFAULT 'PENDING',
    `curtainstatusnote` VARCHAR(191) NULL,
    `paymentStatus` ENUM('PAID', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `deliveredById` CHAR(36) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `isSiteMeasured` BOOLEAN NOT NULL DEFAULT false,
    `siteMeasurePrice` DECIMAL(10, 2) NULL,
    `remark` VARCHAR(191) NULL,
    `issueDate` DATETIME(3) NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,
    `deliveryDeadline` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `totalAmount` DECIMAL(10, 2) NULL,
    `balance` DECIMAL(10, 2) NULL,
    `totalPaid` DECIMAL(10, 2) NULL,
    `ShopId` CHAR(36) NULL,

    UNIQUE INDEX `curtain_orders_code_key`(`code`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `curtain_payments` (
    `_id` CHAR(36) NOT NULL,
    `curtainOrderId` CHAR(36) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `paymentMethod` ENUM('CASH', 'TELEBIRR', 'TRANSFER', 'CBE', 'AWASH', 'DASHEN', 'ABYSSINIA', 'HIBRET', 'NIB', 'OROMIA', 'BERHAN', 'BUNNA', 'ZEMEN', 'ENAT', 'COOP', 'WEGAGEN', 'AMHARA', 'TSEHAY', 'GOH', 'HIJRA', 'SIINQEE', 'SHABELLE', 'AHMAD', 'ADDIS', 'LION', 'GADA', 'RAYA') NULL,
    `note` VARCHAR(191) NULL,
    `paymentDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `curtain_measurements` (
    `_id` CHAR(36) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `roomName` VARCHAR(191) NOT NULL,
    `width` DOUBLE NOT NULL,
    `height` DOUBLE NOT NULL,
    `extrawidth` DOUBLE NULL,
    `quantity` INTEGER NULL,
    `pricePerUnit` DECIMAL(10, 2) NULL,
    `unitprice` DECIMAL(10, 2) NULL,
    `price` DECIMAL(10, 2) NULL,
    `remark` VARCHAR(191) NULL,
    `size` ENUM('TWO_POINT_FIVE', 'THREE', 'NORMAL') NULL,
    `createdById` CHAR(36) NULL,
    `shatterVerticalProductId` CHAR(36) NULL,
    `curtainSize` DOUBLE NULL,
    `thickProductId` CHAR(36) NULL,
    `thickVariant` VARCHAR(191) NULL,
    `thickMeter` INTEGER NULL,
    `thickPrice` INTEGER NULL,
    `thinProductId` CHAR(36) NULL,
    `thinVariant` VARCHAR(191) NULL,
    `thinMeter` INTEGER NULL,
    `thinPrice` INTEGER NULL,
    `curtainPoleId` CHAR(36) NULL,
    `curtainPoleQuantity` INTEGER NULL,
    `curtainPolePrice` INTEGER NULL,
    `curtainPullsId` CHAR(36) NULL,
    `curtainPullsQuantity` INTEGER NULL,
    `curtainBracketsId` CHAR(36) NULL,
    `curtainBracketsQuantity` INTEGER NULL,
    `curtainPullsBracketsPrice` INTEGER NULL,
    `thickWorkerId` CHAR(36) NULL,
    `thickWorkerPaid` BOOLEAN NOT NULL DEFAULT false,
    `thickWorkerPaidDate` DATETIME(3) NULL,
    `thickWorkerPaidAmount` INTEGER NULL,
    `thinWorkerId` CHAR(36) NULL,
    `thinWorkerPaid` BOOLEAN NOT NULL DEFAULT false,
    `thinWorkerPaidDate` DATETIME(3) NULL,
    `thinWorkerPaidAmount` INTEGER NULL,
    `workerPrice` INTEGER NULL,
    `totalWorkerMeter` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedById` CHAR(36) NULL,

    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `curtain_worker_logs` (
    `_id` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `curtainMeasurementId` VARCHAR(191) NOT NULL,
    `shopProductVariantId` CHAR(36) NULL,
    `workerId` CHAR(36) NULL,
    `workerType` ENUM('THICK', 'THIN') NOT NULL,
    `extrawidthAssigned` DOUBLE NULL,
    `widthmeterAssigned` DOUBLE NULL,
    `heightmeterAssigned` DOUBLE NULL,
    `quantityAssigned` INTEGER NULL,
    `heightmeterCompleted` DOUBLE NULL,
    `widthmeterCompleted` DOUBLE NULL,
    `extrawidthCompleted` DOUBLE NULL,
    `quantityCompleted` INTEGER NULL,
    `note` VARCHAR(191) NULL,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `unitofmeasure_name_key` ON `unitofmeasure`(`name`);

-- AddForeignKey
ALTER TABLE `store_stocks` ADD CONSTRAINT `store_stocks_unitOfMeasureId_fkey` FOREIGN KEY (`unitOfMeasureId`) REFERENCES `unitofmeasure`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoreProductVariant` ADD CONSTRAINT `StoreProductVariant_storeStockId_fkey` FOREIGN KEY (`storeStockId`) REFERENCES `store_stocks`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shop_stocks` ADD CONSTRAINT `shop_stocks_unitOfMeasureId_fkey` FOREIGN KEY (`unitOfMeasureId`) REFERENCES `unitofmeasure`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShopProductVariant` ADD CONSTRAINT `ShopProductVariant_shopStockId_fkey` FOREIGN KEY (`shopStockId`) REFERENCES `shop_stocks`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_ledgers` ADD CONSTRAINT `stock_ledgers_unitOfMeasureId_fkey` FOREIGN KEY (`unitOfMeasureId`) REFERENCES `unitofmeasure`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_colourId_fkey` FOREIGN KEY (`colourId`) REFERENCES `colours`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_curtainTypeId_fkey` FOREIGN KEY (`curtainTypeId`) REFERENCES `curtain_types`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_orders` ADD CONSTRAINT `curtain_orders_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_orders` ADD CONSTRAINT `curtain_orders_movementTypeId_fkey` FOREIGN KEY (`movementTypeId`) REFERENCES `movement_types`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_orders` ADD CONSTRAINT `curtain_orders_deliveredById_fkey` FOREIGN KEY (`deliveredById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_orders` ADD CONSTRAINT `curtain_orders_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_orders` ADD CONSTRAINT `curtain_orders_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_orders` ADD CONSTRAINT `curtain_orders_ShopId_fkey` FOREIGN KEY (`ShopId`) REFERENCES `shops`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_payments` ADD CONSTRAINT `curtain_payments_curtainOrderId_fkey` FOREIGN KEY (`curtainOrderId`) REFERENCES `curtain_orders`(`_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_payments` ADD CONSTRAINT `curtain_payments_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_measurements` ADD CONSTRAINT `curtain_measurements_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `curtain_orders`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_measurements` ADD CONSTRAINT `curtain_measurements_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_measurements` ADD CONSTRAINT `curtain_measurements_shatterVerticalProductId_fkey` FOREIGN KEY (`shatterVerticalProductId`) REFERENCES `products`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_measurements` ADD CONSTRAINT `curtain_measurements_thickProductId_fkey` FOREIGN KEY (`thickProductId`) REFERENCES `products`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_measurements` ADD CONSTRAINT `curtain_measurements_thinProductId_fkey` FOREIGN KEY (`thinProductId`) REFERENCES `products`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_measurements` ADD CONSTRAINT `curtain_measurements_curtainPoleId_fkey` FOREIGN KEY (`curtainPoleId`) REFERENCES `products`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_measurements` ADD CONSTRAINT `curtain_measurements_curtainPullsId_fkey` FOREIGN KEY (`curtainPullsId`) REFERENCES `products`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_measurements` ADD CONSTRAINT `curtain_measurements_curtainBracketsId_fkey` FOREIGN KEY (`curtainBracketsId`) REFERENCES `products`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_measurements` ADD CONSTRAINT `curtain_measurements_thickWorkerId_fkey` FOREIGN KEY (`thickWorkerId`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_measurements` ADD CONSTRAINT `curtain_measurements_thinWorkerId_fkey` FOREIGN KEY (`thinWorkerId`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_measurements` ADD CONSTRAINT `curtain_measurements_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_worker_logs` ADD CONSTRAINT `curtain_worker_logs_curtainMeasurementId_fkey` FOREIGN KEY (`curtainMeasurementId`) REFERENCES `curtain_measurements`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_worker_logs` ADD CONSTRAINT `curtain_worker_logs_shopProductVariantId_fkey` FOREIGN KEY (`shopProductVariantId`) REFERENCES `ShopProductVariant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_worker_logs` ADD CONSTRAINT `curtain_worker_logs_workerId_fkey` FOREIGN KEY (`workerId`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curtain_worker_logs` ADD CONSTRAINT `curtain_worker_logs_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `stores`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_items` ADD CONSTRAINT `purchase_items_unitOfMeasureId_fkey` FOREIGN KEY (`unitOfMeasureId`) REFERENCES `unitofmeasure`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfer_items` ADD CONSTRAINT `transfer_items_unitOfMeasureId_fkey` FOREIGN KEY (`unitOfMeasureId`) REFERENCES `unitofmeasure`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_corrections` ADD CONSTRAINT `stock_corrections_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_correction_items` ADD CONSTRAINT `stock_correction_items_unitOfMeasureId_fkey` FOREIGN KEY (`unitOfMeasureId`) REFERENCES `unitofmeasure`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
