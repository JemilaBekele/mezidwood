-- CreateTable
CREATE TABLE `CapacityLotHistory` (
    `id` VARCHAR(191) NOT NULL,
    `capacityLotId` VARCHAR(191) NOT NULL,
    `stage` ENUM('DESIGN', 'METAL_WORKS', 'CNC', 'CUTTING', 'EDGE_BANDING', 'ASSEMBLY', 'PAINTING', 'FINISHING', 'DELIVERY') NOT NULL,
    `oldDays` INTEGER NULL,
    `newDays` INTEGER NULL,
    `oldCapacity` INTEGER NULL,
    `newCapacity` INTEGER NULL,
    `action` ENUM('CREATED', 'UPDATED') NOT NULL,
    `changedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CapacityLotHistory_capacityLotId_idx`(`capacityLotId`),
    INDEX `CapacityLotHistory_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CapacityLotHistory` ADD CONSTRAINT `CapacityLotHistory_capacityLotId_fkey` FOREIGN KEY (`capacityLotId`) REFERENCES `capacity_lots`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CapacityLotHistory` ADD CONSTRAINT `CapacityLotHistory_changedById_fkey` FOREIGN KEY (`changedById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;
