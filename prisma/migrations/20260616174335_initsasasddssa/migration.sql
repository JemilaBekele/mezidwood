-- AlterTable
ALTER TABLE `users` ADD COLUMN `showroomId` CHAR(36) NULL,
    ADD COLUMN `storeId` CHAR(36) NULL;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_showroomId_fkey` FOREIGN KEY (`showroomId`) REFERENCES `Showroom`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;
