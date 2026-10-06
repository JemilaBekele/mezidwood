-- AlterTable: SellPayment.paidDate (when the customer actually paid).
-- Existing payments take their recorded date (createdAt) so reports do not shift.
ALTER TABLE `sell_payments` ADD COLUMN `paidDate` DATETIME(3) NULL;

UPDATE `sell_payments` SET `paidDate` = `createdAt`;

ALTER TABLE `sell_payments` MODIFY `paidDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
