/*
  Warnings:

  - You are about to drop the column `showroomId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `storeId` on the `users` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE `users` DROP FOREIGN KEY `users_showroomId_fkey`;

-- DropForeignKey
ALTER TABLE `users` DROP FOREIGN KEY `users_storeId_fkey`;

-- DropIndex
DROP INDEX `users_showroomId_fkey` ON `users`;

-- DropIndex
DROP INDEX `users_storeId_fkey` ON `users`;

-- AlterTable
ALTER TABLE `users` DROP COLUMN `showroomId`,
    DROP COLUMN `storeId`;

-- CreateTable
CREATE TABLE `item_images` (
    `id` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_UserShowrooms` (
    `A` CHAR(36) NOT NULL,
    `B` CHAR(36) NOT NULL,

    UNIQUE INDEX `_UserShowrooms_AB_unique`(`A`, `B`),
    INDEX `_UserShowrooms_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_UserStores` (
    `A` CHAR(36) NOT NULL,
    `B` CHAR(36) NOT NULL,

    UNIQUE INDEX `_UserStores_AB_unique`(`A`, `B`),
    INDEX `_UserStores_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `item_images` ADD CONSTRAINT `item_images_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_UserShowrooms` ADD CONSTRAINT `_UserShowrooms_A_fkey` FOREIGN KEY (`A`) REFERENCES `Showroom`(`_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_UserShowrooms` ADD CONSTRAINT `_UserShowrooms_B_fkey` FOREIGN KEY (`B`) REFERENCES `users`(`_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_UserStores` ADD CONSTRAINT `_UserStores_A_fkey` FOREIGN KEY (`A`) REFERENCES `Store`(`_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_UserStores` ADD CONSTRAINT `_UserStores_B_fkey` FOREIGN KEY (`B`) REFERENCES `users`(`_id`) ON DELETE CASCADE ON UPDATE CASCADE;
