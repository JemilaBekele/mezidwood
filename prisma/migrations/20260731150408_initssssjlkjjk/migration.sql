-- AlterTable
ALTER TABLE `proforma_invoice_items` ADD COLUMN `categoryId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `proforma_invoice_items` ADD CONSTRAINT `proforma_invoice_items_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `ProductCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
