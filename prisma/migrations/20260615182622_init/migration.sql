-- CreateTable
CREATE TABLE `pi_logs` (
    `_id` CHAR(36) NOT NULL,
    `action` VARCHAR(1000) NOT NULL,
    `piuserId` CHAR(36) NULL,
    `proformaId` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pi_logs_proformaId_key`(`proformaId`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pi_logs` ADD CONSTRAINT `pi_logs_piuserId_fkey` FOREIGN KEY (`piuserId`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pi_logs` ADD CONSTRAINT `pi_logs_proformaId_fkey` FOREIGN KEY (`proformaId`) REFERENCES `proforma_invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
