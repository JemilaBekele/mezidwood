-- AlterTable
ALTER TABLE `purchase_items` ADD COLUMN `acceptquantity` INTEGER NULL,
    ADD COLUMN `isfullyaccepted` BOOLEAN NOT NULL DEFAULT false;
