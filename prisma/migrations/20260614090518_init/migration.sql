-- CreateTable
CREATE TABLE `users` (
    `_id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `userCode` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `admin` BOOLEAN NOT NULL DEFAULT false,
    `password` VARCHAR(191) NOT NULL,
    `roleId` CHAR(36) NOT NULL,
    `status` ENUM('Active', 'Inactive', 'Suspended') NOT NULL DEFAULT 'Active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `lastLoginAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Role` (
    `_id` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Role_name_key`(`name`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Permission` (
    `_id` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Permission_name_key`(`name`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermission` (
    `_id` CHAR(36) NOT NULL,
    `roleId` CHAR(36) NOT NULL,
    `permissionId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RolePermission_roleId_permissionId_key`(`roleId`, `permissionId`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `companies` (
    `_id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `addressTow` VARCHAR(191) NULL,
    `tiktok` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `tinAddress` VARCHAR(191) NULL,
    `TIN` VARCHAR(191) NULL,
    `From` VARCHAR(191) NULL,
    `logo` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `companies_email_key`(`email`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_logs` (
    `_id` CHAR(36) NOT NULL,
    `action` VARCHAR(1000) NOT NULL,
    `userId` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customers` (
    `_id` CHAR(36) NOT NULL,
    `first_name` VARCHAR(191) NOT NULL,
    `companyName` VARCHAR(255) NULL,
    `isdefault` BOOLEAN NOT NULL DEFAULT true,
    `phone1` VARCHAR(191) NOT NULL,
    `phone2` VARCHAR(191) NULL,
    `tinNumber` VARCHAR(100) NULL,
    `address` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `suppliers` (
    `_id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `contactName` VARCHAR(255) NULL,
    `phone` VARCHAR(50) NULL,
    `email` VARCHAR(255) NULL,
    `address` VARCHAR(191) NULL,
    `city` VARCHAR(100) NULL,
    `country` VARCHAR(100) NULL,
    `tinNumber` VARCHAR(100) NULL,
    `notes` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `banks` (
    `id` VARCHAR(191) NOT NULL,
    `bankName` VARCHAR(191) NOT NULL,
    `accountNumber` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `banks_accountNumber_key`(`accountNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `units_of_measure` (
    `_id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(191) NULL,
    `base` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `units_of_measure_name_key`(`name`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Showroom` (
    `_id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isMain` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `Showroom_isMain_key`(`isMain`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Store` (
    `_id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isMain` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `Store_isMain_key`(`isMain`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stockledger` (
    `_id` CHAR(36) NOT NULL,
    `movementType` ENUM('IN', 'OUT', 'ADJUSTMENT', 'TRANSFER', 'RETURN', 'DAMAGE', 'EXPIRE') NOT NULL,
    `quantity` INTEGER NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `storeId` VARCHAR(191) NULL,
    `showroomId` VARCHAR(191) NULL,
    `unitId` VARCHAR(191) NULL,
    `reference` VARCHAR(191) NULL,
    `movementDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventorystocks` (
    `_id` CHAR(36) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `status` ENUM('Available', 'In_Use', 'Reserved', 'Broken', 'Lost', 'Disposed', 'Expired', 'DAMAGED', 'Sold') NOT NULL DEFAULT 'Available',
    `storeId` VARCHAR(191) NULL,
    `showroomId` VARCHAR(191) NULL,
    `last_updated` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `inventorystocks_materialId_storeId_showroomId_key`(`materialId`, `storeId`, `showroomId`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `materials` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NULL,
    `size` VARCHAR(191) NULL,
    `plainMDF` BOOLEAN NULL,
    `laminatedMDF` BOOLEAN NULL,
    `wood` BOOLEAN NULL,
    `metal` BOOLEAN NULL,
    `accessory` BOOLEAN NULL,
    `other` BOOLEAN NULL,
    `imageUrl` VARCHAR(191) NULL,
    `warningStockLevel` INTEGER NULL DEFAULT 10,
    `unitOfMeasureId` VARCHAR(191) NULL,
    `materialTypeId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchases` (
    `_id` CHAR(36) NOT NULL,
    `invoiceNo` VARCHAR(191) NOT NULL,
    `supplierId` CHAR(36) NOT NULL,
    `bankId` CHAR(36) NULL,
    `storeId` CHAR(36) NOT NULL,
    `paymentStatus` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `totalProducts` INTEGER NOT NULL DEFAULT 0,
    `subTotal` DOUBLE NOT NULL DEFAULT 0,
    `grandTotal` DOUBLE NOT NULL DEFAULT 0,
    `notes` VARCHAR(191) NULL,
    `purchaseDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `purchases_invoiceNo_key`(`invoiceNo`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_items` (
    `_id` CHAR(36) NOT NULL,
    `purchaseId` CHAR(36) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `unitOfMeasureId` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL,
    `unitPrice` DOUBLE NOT NULL DEFAULT 0,
    `totalPrice` DOUBLE NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `item_materials` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `item_materials_itemId_materialId_key`(`itemId`, `materialId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductCategory` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProductCategory_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Size` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `categoryId` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductType` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `sizeId` VARCHAR(191) NULL,

    UNIQUE INDEX `ProductType_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `items` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `price` INTEGER NOT NULL DEFAULT 0,
    `imageUrl` VARCHAR(191) NULL,
    `color` VARCHAR(191) NULL,
    `categoryId` VARCHAR(191) NULL,
    `typeId` VARCHAR(191) NULL,
    `sizeId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `item_stocks` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `storeId` VARCHAR(191) NULL,
    `showroomId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `item_stocks_itemId_storeId_showroomId_key`(`itemId`, `storeId`, `showroomId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ItemStockLedger` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `movementType` ENUM('IN', 'OUT', 'ADJUSTMENT', 'TRANSFER', 'RETURN', 'DAMAGE', 'EXPIRE') NOT NULL,
    `quantity` INTEGER NOT NULL,
    `reference` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `storeId` VARCHAR(191) NULL,
    `showroomId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sell_payments` (
    `_id` CHAR(36) NOT NULL,
    `sellId` CHAR(36) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `createdById` CHAR(36) NULL,
    `bankId` VARCHAR(191) NOT NULL,
    `paidBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sells` (
    `_id` CHAR(36) NOT NULL,
    `invoiceNo` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NULL,
    `documentUrl` VARCHAR(191) NULL,
    `paymentStatus` ENUM('PENDING', 'PARTIAL', 'PAID', 'CANCELLED', 'NONE') NOT NULL DEFAULT 'PENDING',
    `grandTotal` DOUBLE NOT NULL DEFAULT 0,
    `balance` INTEGER NOT NULL DEFAULT 0,
    `totalPaid` INTEGER NOT NULL DEFAULT 0,
    `storeId` CHAR(36) NOT NULL,
    `saleStatus` ENUM('NOT_APPROVED', 'PARTIALLY_DELIVERED', 'APPROVED', 'DELIVERED', 'CANCELLED') NOT NULL DEFAULT 'NOT_APPROVED',
    `locked` BOOLEAN NOT NULL DEFAULT false,
    `lockedAt` DATETIME(3) NULL,
    `customerId` CHAR(36) NULL,
    `totalProducts` INTEGER NOT NULL DEFAULT 0,
    `subTotal` DOUBLE NOT NULL DEFAULT 0,
    `discount` DOUBLE NOT NULL DEFAULT 0,
    `vat` DOUBLE NOT NULL DEFAULT 0,
    `notes` VARCHAR(191) NULL,
    `saleDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sells_invoiceNo_key`(`invoiceNo`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sell_items` (
    `_id` CHAR(36) NOT NULL,
    `sellId` CHAR(36) NOT NULL,
    `itemId` CHAR(36) NOT NULL,
    `itemSaleStatus` ENUM('PENDING', 'DELIVERED', 'REJECTED', 'PARTIALLY_DELIVERED') NOT NULL DEFAULT 'PENDING',
    `quantity` INTEGER NOT NULL,
    `unitPrice` DOUBLE NOT NULL DEFAULT 0,
    `totalPrice` DOUBLE NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transfers` (
    `_id` CHAR(36) NOT NULL,
    `shortCode` VARCHAR(191) NOT NULL,
    `sourceType` ENUM('STORE', 'SHOWROOM') NOT NULL,
    `sourceStoreId` CHAR(36) NULL,
    `sourceShowroomId` CHAR(36) NULL,
    `destinationType` ENUM('STORE', 'SHOWROOM') NOT NULL,
    `destStoreId` CHAR(36) NULL,
    `destShowroomId` CHAR(36) NULL,
    `reference` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `movementDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `transfers_shortCode_key`(`shortCode`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transfer_items` (
    `_id` CHAR(36) NOT NULL,
    `transferId` CHAR(36) NOT NULL,
    `ismaterial` BOOLEAN NOT NULL DEFAULT false,
    `itemId` CHAR(36) NULL,
    `materialId` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `proforma_invoice_banks` (
    `id` VARCHAR(191) NOT NULL,
    `proformaInvoiceId` VARCHAR(191) NOT NULL,
    `bankId` VARCHAR(191) NOT NULL,
    `paidBy` VARCHAR(191) NULL,
    `createdById` CHAR(36) NULL,
    `amount` DOUBLE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `proforma_invoice_items` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `size` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL,
    `unitPrice` DOUBLE NOT NULL,
    `amount` DOUBLE NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `additionalDescription` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `proforma_invoices` (
    `id` VARCHAR(191) NOT NULL,
    `piNumber` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `paymentStatus` ENUM('PENDING', 'PARTIAL', 'PAID', 'CANCELLED', 'NONE') NOT NULL DEFAULT 'PENDING',
    `store` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('PENDING_ST', 'APPROVED_ST', 'SENT_TO_CLIENT', 'REVISION', 'APPROVED_CLIENT', 'CANCELLED', 'APPROVED_CREATE_PROJECT') NOT NULL,
    `subtotal` DOUBLE NOT NULL,
    `vat` DOUBLE NULL DEFAULT 0,
    `total` DOUBLE NOT NULL,
    `amountPaid` DOUBLE NOT NULL DEFAULT 0,
    `balance` DOUBLE NOT NULL,
    `amountDate` DATETIME(3) NULL,
    `preparedById` CHAR(36) NULL,
    `approvedById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `proforma_invoices_piNumber_key`(`piNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `proforma_item_materials` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `additionalQuantity` INTEGER NULL DEFAULT 0,
    `givenquantity` INTEGER NULL DEFAULT 0,
    `note` TEXT NULL,
    `status` ENUM('PENDING', 'ISSUED', 'PARTIALLY', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `issuedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `proforma_item_materials_itemId_materialId_key`(`itemId`, `materialId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `proforma_invoice_item_images` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `material_issues` (
    `id` VARCHAR(191) NOT NULL,
    `proformaItemMaterialId` VARCHAR(191) NOT NULL,
    `issuedById` VARCHAR(191) NULL,
    `givenToId` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL,
    `note` TEXT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attachments` (
    `id` VARCHAR(191) NOT NULL,
    `proformaInvoiceId` VARCHAR(191) NULL,
    `fileUrl` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_logs` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `note` TEXT NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_stage_work_logs` (
    `id` VARCHAR(191) NOT NULL,
    `projectStageId` VARCHAR(191) NOT NULL,
    `doneUnits` DOUBLE NOT NULL,
    `hours` DOUBLE NULL,
    `doneById` CHAR(36) NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `projects` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `deliveryEstimationcode` VARCHAR(191) NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,
    `designStatus` ENUM('INITIATED', 'MODELING', 'DRAFTING', 'CUTLIST', 'BOQ', 'FINISHED') NULL,
    `designFinished` DATETIME(3) NULL,
    `designById` CHAR(36) NULL,
    `status` ENUM('INVOICE', 'DESIGN', 'PURCHASING', 'METAL_WORKS', 'CNC', 'CUTTING', 'EDGE_BANDING', 'ASSEMBLY', 'PAINTING', 'FINISHING', 'DELIVERY', 'INSTALLATION', 'COMPLETED', 'CANCELLED') NULL,
    `difficulty` ENUM('EASY', 'MEDIUM', 'HARD') NOT NULL DEFAULT 'EASY',
    `scheduleMode` ENUM('AUTO', 'MANUAL', 'LOCKED') NOT NULL DEFAULT 'AUTO',
    `requestedDelivery` DATETIME(3) NULL,
    `calculatedDelivery` DATETIME(3) NULL,
    `manualDelivery` DATETIME(3) NULL,
    `finalDelivery` DATETIME(3) NULL,
    `totalFinishedPercent` INTEGER NOT NULL DEFAULT 0,
    `totalDays` INTEGER NULL,
    `totalProjectQuantity` INTEGER NULL,
    `completedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `projects_invoiceId_key`(`invoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scheduling_settings` (
    `id` VARCHAR(191) NOT NULL,
    `contingencyDays` INTEGER NOT NULL DEFAULT 3,
    `easyPercent` DOUBLE NOT NULL DEFAULT 0,
    `mediumPercent` DOUBLE NOT NULL DEFAULT 0.4,
    `hardPercent` DOUBLE NOT NULL DEFAULT 0.5,
    `workingHoursPerDay` DOUBLE NOT NULL DEFAULT 7.5,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `schedule_history` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `event` ENUM('CREATED', 'RESCHEDULED', 'STAGE_COMPLETED', 'STAGE_CANCELLED', 'PROJECT_CANCELLED', 'MANUAL_OVERRIDE', 'CAPACITY_RELEASED', 'DELIVERY_RECOMPUTED', 'MODE_CHANGED') NOT NULL,
    `trigger` ENUM('USER', 'CRON', 'COMPLETION', 'CANCELLATION', 'SYSTEM') NOT NULL,
    `stage` ENUM('INVOICE', 'DESIGN', 'PURCHASING', 'METAL_WORKS', 'CNC', 'CUTTING', 'EDGE_BANDING', 'ASSEMBLY', 'PAINTING', 'FINISHING', 'DELIVERY', 'INSTALLATION', 'COMPLETED', 'CANCELLED') NULL,
    `oldDelivery` DATETIME(3) NULL,
    `newDelivery` DATETIME(3) NULL,
    `reason` TEXT NULL,
    `byUserId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `schedule_history_projectId_idx`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `holidays` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `recurring` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `holidays_date_key`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `capacity_lots` (
    `id` VARCHAR(191) NOT NULL,
    `stage` ENUM('DESIGN', 'METAL_WORKS', 'CNC', 'CUTTING', 'EDGE_BANDING', 'ASSEMBLY', 'PAINTING', 'FINISHING', 'DELIVERY') NOT NULL,
    `days` INTEGER NOT NULL,
    `capacity` INTEGER NULL,
    `workingHours` DOUBLE NOT NULL DEFAULT 7.5,
    `parallelSlots` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `capacity_lots_stage_key`(`stage`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_stage_capacities` (
    `id` VARCHAR(191) NOT NULL,
    `stage` ENUM('DESIGN', 'METAL_WORKS', 'CNC', 'CUTTING', 'EDGE_BANDING', 'ASSEMBLY', 'PAINTING', 'FINISHING', 'DELIVERY') NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `usedCapacity` DOUBLE NOT NULL DEFAULT 0,
    `maxCapacity` DOUBLE NOT NULL,
    `workingHours` DOUBLE NOT NULL DEFAULT 7.5,
    `usedHours` DOUBLE NOT NULL DEFAULT 0,
    `maxHours` DOUBLE NOT NULL,
    `shift` ENUM('MORNING', 'AFTERNOON', 'FULL_DAY', 'CUSTOM') NOT NULL DEFAULT 'FULL_DAY',
    `customStartTime` DATETIME(3) NULL,
    `customEndTime` DATETIME(3) NULL,
    `overCapacityUsed` DOUBLE NOT NULL DEFAULT 0,
    `overHoursCapacityUsed` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `daily_stage_capacities_stage_date_key`(`stage`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_stages` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `stage` ENUM('INVOICE', 'DESIGN', 'PURCHASING', 'METAL_WORKS', 'CNC', 'CUTTING', 'EDGE_BANDING', 'ASSEMBLY', 'PAINTING', 'FINISHING', 'DELIVERY', 'INSTALLATION', 'COMPLETED', 'CANCELLED') NOT NULL,
    `capacityDays` INTEGER NOT NULL,
    `workUnits` DOUBLE NULL,
    `finished` BOOLEAN NOT NULL DEFAULT false,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `startDateTime` DATETIME(3) NOT NULL,
    `endDateTime` DATETIME(3) NOT NULL,
    `shift` ENUM('MORNING', 'AFTERNOON', 'FULL_DAY', 'CUSTOM') NULL DEFAULT 'FULL_DAY',
    `timeTaken` INTEGER NULL,
    `customStartTime` DATETIME(3) NULL,
    `customEndTime` DATETIME(3) NULL,
    `actualWorkUnits` DOUBLE NULL,
    `autoSchedule` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('ACTIVE', 'IN_PROGRESS', 'CANCELLED', 'COMPLETED') NOT NULL DEFAULT 'ACTIVE',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_stage_capacity_allocations` (
    `id` VARCHAR(191) NOT NULL,
    `projectStageId` VARCHAR(191) NOT NULL,
    `dailyStageCapacityId` VARCHAR(191) NOT NULL,
    `allocatedUnits` DOUBLE NOT NULL,
    `allocatedHours` DOUBLE NOT NULL,
    `shift` ENUM('MORNING', 'AFTERNOON', 'FULL_DAY', 'CUSTOM') NOT NULL DEFAULT 'FULL_DAY',
    `startDateTime` DATETIME(3) NOT NULL,
    `endDateTime` DATETIME(3) NOT NULL,
    `customStartTime` DATETIME(3) NULL,
    `customEndTime` DATETIME(3) NULL,
    `isOverCapacity` BOOLEAN NOT NULL DEFAULT false,
    `allocationDate` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `project_stage_capacity_allocations_projectStageId_idx`(`projectStageId`),
    INDEX `project_stage_capacity_allocations_dailyStageCapacityId_idx`(`dailyStageCapacityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryEstimation` (
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
    `status` ENUM('ESTIMATED', 'ON_HOLD', 'CONFIRMED', 'PROJECT_CREATED', 'EXPIRED') NOT NULL DEFAULT 'ESTIMATED',
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DeliveryEstimation_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_corrections` (
    `_id` CHAR(36) NOT NULL,
    `shortCode` VARCHAR(191) NOT NULL,
    `ismaterial` BOOLEAN NOT NULL DEFAULT false,
    `storeId` VARCHAR(191) NULL,
    `showroomId` VARCHAR(191) NULL,
    `reason` ENUM('PURCHASE_ERROR', 'EXPIRED', 'DAMAGED', 'MANUAL_ADJUSTMENT') NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `purchaseId` CHAR(36) NULL,
    `reference` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `createdById` CHAR(36) NULL,
    `updatedById` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `stock_corrections_shortCode_key`(`shortCode`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_correction_items` (
    `_id` CHAR(36) NOT NULL,
    `correctionId` CHAR(36) NOT NULL,
    `itemId` CHAR(36) NULL,
    `materialId` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `_id` CHAR(36) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `type` ENUM('SELL_READY_FOR_DELIVERY', 'SELL_CANCELLED', 'Done', 'Payment', 'Inventory', 'System', 'Approval') NOT NULL,
    `read` BOOLEAN NOT NULL DEFAULT false,
    `relatedEntityType` ENUM('SELL', 'MaintenanceRequest', 'Invoice', 'PurchaseOrder', 'InventoryRequest') NULL,
    `relatedEntityId` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `read_at` DATETIME(3) NULL,

    INDEX `notifications_read_idx`(`read`),
    PRIMARY KEY (`_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_ProformaItemMaterialToMaterial` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_ProformaItemMaterialToMaterial_AB_unique`(`A`, `B`),
    INDEX `_ProformaItemMaterialToMaterial_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `Permission`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_logs` ADD CONSTRAINT `stock_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stockledger` ADD CONSTRAINT `stockledger_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stockledger` ADD CONSTRAINT `stockledger_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stockledger` ADD CONSTRAINT `stockledger_showroomId_fkey` FOREIGN KEY (`showroomId`) REFERENCES `Showroom`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stockledger` ADD CONSTRAINT `stockledger_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `units_of_measure`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stockledger` ADD CONSTRAINT `fk_stockledger_user` FOREIGN KEY (`userId`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventorystocks` ADD CONSTRAINT `inventorystocks_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventorystocks` ADD CONSTRAINT `inventorystocks_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventorystocks` ADD CONSTRAINT `inventorystocks_showroomId_fkey` FOREIGN KEY (`showroomId`) REFERENCES `Showroom`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `materials` ADD CONSTRAINT `materials_unitOfMeasureId_fkey` FOREIGN KEY (`unitOfMeasureId`) REFERENCES `units_of_measure`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `materials` ADD CONSTRAINT `materials_materialTypeId_fkey` FOREIGN KEY (`materialTypeId`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_bankId_fkey` FOREIGN KEY (`bankId`) REFERENCES `banks`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_items` ADD CONSTRAINT `purchase_items_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `purchases`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_items` ADD CONSTRAINT `purchase_items_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_items` ADD CONSTRAINT `purchase_items_unitOfMeasureId_fkey` FOREIGN KEY (`unitOfMeasureId`) REFERENCES `units_of_measure`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `item_materials` ADD CONSTRAINT `item_materials_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `item_materials` ADD CONSTRAINT `item_materials_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Size` ADD CONSTRAINT `Size_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `ProductCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductType` ADD CONSTRAINT `ProductType_sizeId_fkey` FOREIGN KEY (`sizeId`) REFERENCES `Size`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `items` ADD CONSTRAINT `items_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `ProductCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `items` ADD CONSTRAINT `items_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `ProductType`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `items` ADD CONSTRAINT `items_sizeId_fkey` FOREIGN KEY (`sizeId`) REFERENCES `Size`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `item_stocks` ADD CONSTRAINT `item_stocks_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `item_stocks` ADD CONSTRAINT `item_stocks_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `item_stocks` ADD CONSTRAINT `item_stocks_showroomId_fkey` FOREIGN KEY (`showroomId`) REFERENCES `Showroom`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItemStockLedger` ADD CONSTRAINT `ItemStockLedger_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItemStockLedger` ADD CONSTRAINT `ItemStockLedger_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItemStockLedger` ADD CONSTRAINT `ItemStockLedger_showroomId_fkey` FOREIGN KEY (`showroomId`) REFERENCES `Showroom`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItemStockLedger` ADD CONSTRAINT `ItemStockLedger_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sell_payments` ADD CONSTRAINT `sell_payments_sellId_fkey` FOREIGN KEY (`sellId`) REFERENCES `sells`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sell_payments` ADD CONSTRAINT `sell_payments_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sell_payments` ADD CONSTRAINT `sell_payments_bankId_fkey` FOREIGN KEY (`bankId`) REFERENCES `banks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sells` ADD CONSTRAINT `sells_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sells` ADD CONSTRAINT `sells_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sells` ADD CONSTRAINT `sells_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sells` ADD CONSTRAINT `sells_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sell_items` ADD CONSTRAINT `sell_items_sellId_fkey` FOREIGN KEY (`sellId`) REFERENCES `sells`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sell_items` ADD CONSTRAINT `sell_items_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_sourceStoreId_fkey` FOREIGN KEY (`sourceStoreId`) REFERENCES `Store`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_sourceShowroomId_fkey` FOREIGN KEY (`sourceShowroomId`) REFERENCES `Showroom`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_destStoreId_fkey` FOREIGN KEY (`destStoreId`) REFERENCES `Store`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_destShowroomId_fkey` FOREIGN KEY (`destShowroomId`) REFERENCES `Showroom`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfer_items` ADD CONSTRAINT `transfer_items_transferId_fkey` FOREIGN KEY (`transferId`) REFERENCES `transfers`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfer_items` ADD CONSTRAINT `transfer_items_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transfer_items` ADD CONSTRAINT `transfer_items_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `materials`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proforma_invoice_banks` ADD CONSTRAINT `proforma_invoice_banks_proformaInvoiceId_fkey` FOREIGN KEY (`proformaInvoiceId`) REFERENCES `proforma_invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proforma_invoice_banks` ADD CONSTRAINT `proforma_invoice_banks_bankId_fkey` FOREIGN KEY (`bankId`) REFERENCES `banks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proforma_invoice_banks` ADD CONSTRAINT `proforma_invoice_banks_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proforma_invoice_items` ADD CONSTRAINT `proforma_invoice_items_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `proforma_invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proforma_invoice_items` ADD CONSTRAINT `proforma_invoice_items_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proforma_invoices` ADD CONSTRAINT `proforma_invoices_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proforma_invoices` ADD CONSTRAINT `proforma_invoices_preparedById_fkey` FOREIGN KEY (`preparedById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proforma_invoices` ADD CONSTRAINT `proforma_invoices_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proforma_item_materials` ADD CONSTRAINT `proforma_item_materials_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `proforma_invoice_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proforma_item_materials` ADD CONSTRAINT `proforma_item_materials_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `proforma_invoice_item_images` ADD CONSTRAINT `proforma_invoice_item_images_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `proforma_invoice_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `material_issues` ADD CONSTRAINT `material_issues_proformaItemMaterialId_fkey` FOREIGN KEY (`proformaItemMaterialId`) REFERENCES `proforma_item_materials`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `material_issues` ADD CONSTRAINT `material_issues_issuedById_fkey` FOREIGN KEY (`issuedById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `material_issues` ADD CONSTRAINT `material_issues_givenToId_fkey` FOREIGN KEY (`givenToId`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attachments` ADD CONSTRAINT `attachments_proformaInvoiceId_fkey` FOREIGN KEY (`proformaInvoiceId`) REFERENCES `proforma_invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_logs` ADD CONSTRAINT `project_logs_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_logs` ADD CONSTRAINT `project_logs_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_stage_work_logs` ADD CONSTRAINT `project_stage_work_logs_projectStageId_fkey` FOREIGN KEY (`projectStageId`) REFERENCES `project_stages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_stage_work_logs` ADD CONSTRAINT `project_stage_work_logs_doneById_fkey` FOREIGN KEY (`doneById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `proforma_invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_designById_fkey` FOREIGN KEY (`designById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_history` ADD CONSTRAINT `schedule_history_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_history` ADD CONSTRAINT `schedule_history_byUserId_fkey` FOREIGN KEY (`byUserId`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_stages` ADD CONSTRAINT `project_stages_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_stage_capacity_allocations` ADD CONSTRAINT `project_stage_capacity_allocations_projectStageId_fkey` FOREIGN KEY (`projectStageId`) REFERENCES `project_stages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_stage_capacity_allocations` ADD CONSTRAINT `project_stage_capacity_allocations_dailyStageCapacityId_fkey` FOREIGN KEY (`dailyStageCapacityId`) REFERENCES `daily_stage_capacities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryEstimation` ADD CONSTRAINT `DeliveryEstimation_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryEstimation` ADD CONSTRAINT `DeliveryEstimation_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_corrections` ADD CONSTRAINT `stock_corrections_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `Store`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_corrections` ADD CONSTRAINT `stock_corrections_showroomId_fkey` FOREIGN KEY (`showroomId`) REFERENCES `Showroom`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_corrections` ADD CONSTRAINT `stock_corrections_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `purchases`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_corrections` ADD CONSTRAINT `stock_corrections_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_corrections` ADD CONSTRAINT `stock_corrections_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_correction_items` ADD CONSTRAINT `stock_correction_items_correctionId_fkey` FOREIGN KEY (`correctionId`) REFERENCES `stock_corrections`(`_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_correction_items` ADD CONSTRAINT `stock_correction_items_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_correction_items` ADD CONSTRAINT `stock_correction_items_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `materials`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ProformaItemMaterialToMaterial` ADD CONSTRAINT `_ProformaItemMaterialToMaterial_A_fkey` FOREIGN KEY (`A`) REFERENCES `proforma_item_materials`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ProformaItemMaterialToMaterial` ADD CONSTRAINT `_ProformaItemMaterialToMaterial_B_fkey` FOREIGN KEY (`B`) REFERENCES `proforma_item_materials`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
