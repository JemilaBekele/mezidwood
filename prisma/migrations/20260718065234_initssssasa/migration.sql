-- AlterTable
ALTER TABLE `sell_items` ADD COLUMN `showroomId` VARCHAR(191) NULL,
    ADD COLUMN `storeId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `sell_items` ADD CONSTRAINT `sell_items_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sell_items` ADD CONSTRAINT `sell_items_showroomId_fkey` FOREIGN KEY (`showroomId`) REFERENCES `Showroom`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;
