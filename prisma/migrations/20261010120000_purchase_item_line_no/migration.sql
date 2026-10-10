-- AlterTable: PurchaseItem.lineNo — the order the lines were entered on the
-- purchase, so the purchase view lists them in that same order.
ALTER TABLE `purchase_items` ADD COLUMN `lineNo` INTEGER NOT NULL DEFAULT 0;
