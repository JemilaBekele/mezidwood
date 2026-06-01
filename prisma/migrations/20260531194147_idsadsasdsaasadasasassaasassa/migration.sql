-- AlterTable
ALTER TABLE `stock_ledgers` MODIFY `movementType` ENUM('IN', 'OUT', 'TRANSFER', 'ADJUSTMENT', 'RETERN', 'TRANSFORM') NOT NULL;
