/*
  Warnings:

  - You are about to alter the column `balance` on the `sells` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Double`.
  - You are about to alter the column `totalPaid` on the `sells` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Double`.
  - You are about to drop the `_proformaitemmaterialtomaterial` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `deliveryestimation` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[deliveryEstimationcode]` on the table `projects` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE `_proformaitemmaterialtomaterial` DROP FOREIGN KEY `_ProformaItemMaterialToMaterial_A_fkey`;

-- DropForeignKey
ALTER TABLE `_proformaitemmaterialtomaterial` DROP FOREIGN KEY `_ProformaItemMaterialToMaterial_B_fkey`;

-- DropForeignKey
ALTER TABLE `deliveryestimation` DROP FOREIGN KEY `DeliveryEstimation_createdById_fkey`;

-- DropForeignKey
ALTER TABLE `deliveryestimation` DROP FOREIGN KEY `DeliveryEstimation_updatedById_fkey`;

-- DropForeignKey
ALTER TABLE `project_stage_work_logs` DROP FOREIGN KEY `project_stage_work_logs_projectStageId_fkey`;

-- DropForeignKey
ALTER TABLE `project_stages` DROP FOREIGN KEY `project_stages_projectId_fkey`;

-- DropIndex
DROP INDEX `notifications_read_idx` ON `notifications`;

-- DropIndex
DROP INDEX `project_stage_work_logs_projectStageId_fkey` ON `project_stage_work_logs`;

-- DropIndex
DROP INDEX `project_stages_projectId_fkey` ON `project_stages`;

-- DropIndex
DROP INDEX `Showroom_isMain_key` ON `showroom`;

-- DropIndex
DROP INDEX `Store_isMain_key` ON `store`;

-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `userId` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `proforma_invoice_banks` MODIFY `amount` DECIMAL(12, 2) NULL;

-- AlterTable
ALTER TABLE `proforma_invoice_items` MODIFY `unitPrice` DECIMAL(12, 2) NOT NULL,
    MODIFY `amount` DECIMAL(12, 2) NOT NULL;

-- AlterTable
ALTER TABLE `proforma_invoices` MODIFY `subtotal` DECIMAL(12, 2) NOT NULL,
    MODIFY `vat` DECIMAL(12, 2) NULL DEFAULT 0,
    MODIFY `total` DECIMAL(12, 2) NOT NULL,
    MODIFY `amountPaid` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    MODIFY `balance` DECIMAL(12, 2) NOT NULL;

-- AlterTable
ALTER TABLE `project_stages` ADD COLUMN `projectendDate` DATETIME(3) NULL,
    ADD COLUMN `projectstartDate` DATETIME(3) NULL,
    MODIFY `startDate` DATETIME(3) NULL,
    MODIFY `endDate` DATETIME(3) NULL,
    MODIFY `startDateTime` DATETIME(3) NULL,
    MODIFY `endDateTime` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `sells` MODIFY `balance` DOUBLE NOT NULL DEFAULT 0,
    MODIFY `totalPaid` DOUBLE NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE `_proformaitemmaterialtomaterial`;

-- DropTable
DROP TABLE `deliveryestimation`;

-- CreateTable
CREATE TABLE `delivery_estimations` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `customerName` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `difficulty` ENUM('EASY', 'MEDIUM', 'HARD') NOT NULL,
    `totalQuantity` INTEGER NOT NULL,
    `estimatedDays` INTEGER NOT NULL,
    `estimatedDelivery` DATETIME(3) NOT NULL,
    `holdUntil` DATETIME(3) NULL,
    `DESIGN` INTEGER NULL,
    `METAL_WORKS` INTEGER NULL,
    `CNC` INTEGER NULL,
    `CUTTING` INTEGER NULL,
    `EDGE_BANDING` INTEGER NULL,
    `ASSEMBLY` INTEGER NULL,
    `PAINTING` INTEGER NULL,
    `FINISHING` INTEGER NULL,
    `DELIVERY` INTEGER NULL,
    `PURCHASING` INTEGER NULL,
    `INSTALLATION` INTEGER NULL,
    `itemsSnapshot` JSON NULL,
    `projectId` VARCHAR(191) NULL,
    `piId` VARCHAR(191) NULL,
    `status` ENUM('ESTIMATED', 'ON_HOLD', 'CONFIRMED', 'PROJECT_CREATED', 'EXPIRED') NOT NULL DEFAULT 'ESTIMATED',
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `delivery_estimations_code_key`(`code`),
    INDEX `delivery_estimations_status_idx`(`status`),
    INDEX `delivery_estimations_createdAt_idx`(`createdAt`),
    INDEX `delivery_estimations_status_holdUntil_idx`(`status`, `holdUntil`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `daily_stage_capacities_date_idx` ON `daily_stage_capacities`(`date`);

-- CreateIndex
CREATE INDEX `notifications_userId_read_created_at_idx` ON `notifications`(`userId`, `read`, `created_at`);

-- CreateIndex
CREATE INDEX `project_stages_projectId_stage_idx` ON `project_stages`(`projectId`, `stage`);

-- CreateIndex
CREATE INDEX `project_stages_stage_startDate_endDate_idx` ON `project_stages`(`stage`, `startDate`, `endDate`);

-- CreateIndex
CREATE INDEX `project_stages_stage_finished_idx` ON `project_stages`(`stage`, `finished`);

-- CreateIndex
CREATE UNIQUE INDEX `projects_deliveryEstimationcode_key` ON `projects`(`deliveryEstimationcode`);

-- AddForeignKey
ALTER TABLE `project_stage_work_logs` ADD CONSTRAINT `project_stage_work_logs_projectStageId_fkey` FOREIGN KEY (`projectStageId`) REFERENCES `project_stages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_deliveryEstimationcode_fkey` FOREIGN KEY (`deliveryEstimationcode`) REFERENCES `delivery_estimations`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_stages` ADD CONSTRAINT `project_stages_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_estimations` ADD CONSTRAINT `delivery_estimations_piId_fkey` FOREIGN KEY (`piId`) REFERENCES `proforma_invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_estimations` ADD CONSTRAINT `delivery_estimations_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_estimations` ADD CONSTRAINT `delivery_estimations_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`_id`) ON DELETE CASCADE ON UPDATE CASCADE;
