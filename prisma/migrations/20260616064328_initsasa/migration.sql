/*
  Warnings:

  - You are about to alter the column `proformaId` on the `pi_logs` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `Char(36)`.

*/
-- DropForeignKey
ALTER TABLE `pi_logs` DROP FOREIGN KEY `pi_logs_proformaId_fkey`;

-- DropIndex
DROP INDEX `pi_logs_proformaId_key` ON `pi_logs`;

-- AlterTable
ALTER TABLE `pi_logs` MODIFY `proformaId` CHAR(36) NOT NULL;

-- AddForeignKey
ALTER TABLE `pi_logs` ADD CONSTRAINT `pi_logs_proformaId_fkey` FOREIGN KEY (`proformaId`) REFERENCES `proforma_invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
