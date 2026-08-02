-- Working-time configuration + delivery-estimation stage alignment
--
-- 1. scheduling_settings gains the working-time window that used to be
--    hardcoded in config.js (working days, shift open/close, lunch, timezone).
--    workingHoursPerDay becomes a DERIVED column, rewritten from the window on
--    every save.
-- 2. DeliveryEstimation gains the two time-based stages the project schedules
--    but the estimate never carried (PURCHASING, INSTALLATION), a snapshot of
--    the items it was quoted from, and a link to the project it became.
--
-- Safe to run on a populated database: every column is nullable or has a
-- default matching the previous hardcoded behaviour, so existing rows keep the
-- exact schedule semantics they had before this migration.

-- ---------------------------------------------------------------- --
-- 1. scheduling_settings: working-time window
-- ---------------------------------------------------------------- --
ALTER TABLE `scheduling_settings`
  ADD COLUMN `workingDays`    VARCHAR(191) NOT NULL DEFAULT '1,2,3,4,5,6',
  ADD COLUMN `shiftStartHour` DOUBLE       NOT NULL DEFAULT 8.5,
  ADD COLUMN `shiftEndHour`   DOUBLE       NOT NULL DEFAULT 17.0,
  ADD COLUMN `lunchStartHour` DOUBLE       NOT NULL DEFAULT 12.5,
  ADD COLUMN `lunchEndHour`   DOUBLE       NOT NULL DEFAULT 13.5,
  ADD COLUMN `timezone`       VARCHAR(191) NOT NULL DEFAULT 'Africa/Addis_Ababa';

-- Re-derive workingHoursPerDay from the window so the stored value can never
-- contradict the hours the scheduler actually works. For the defaults this is
-- (17.0 - 8.5) - (13.5 - 12.5) = 7.5, i.e. unchanged for existing rows.
UPDATE `scheduling_settings`
SET `workingHoursPerDay` =
      (`shiftEndHour` - `shiftStartHour`)
      - (CASE WHEN `lunchEndHour` > `lunchStartHour`
              THEN `lunchEndHour` - `lunchStartHour`
              ELSE 0 END);

-- ---------------------------------------------------------------- --
-- 2. DeliveryEstimation: full stage set + provenance + project link
-- ---------------------------------------------------------------- --
ALTER TABLE `DeliveryEstimation`
  ADD COLUMN `PURCHASING`    INT  NULL,
  ADD COLUMN `INSTALLATION`  INT  NULL,
  ADD COLUMN `itemsSnapshot` JSON NULL,
  ADD COLUMN `projectId`     VARCHAR(191) NULL;

-- Backfill the time-based stages for existing estimates from the unit total
-- (DESIGN is the "everything" stage), matching engine.withTimeBasedStages().
-- Without this, re-opening an old estimate would recompute a longer timeline
-- than the one the customer was quoted.
UPDATE `DeliveryEstimation`
SET `PURCHASING`   = COALESCE(`DESIGN`, 0),
    `INSTALLATION` = COALESCE(`DESIGN`, 0)
WHERE `PURCHASING` IS NULL;

-- Link estimates that were already converted, so the new queryable link is not
-- empty for historical rows.
UPDATE `DeliveryEstimation` de
JOIN `projects` p ON p.`deliveryEstimationcode` = de.`code`
SET de.`projectId` = p.`id`
WHERE de.`projectId` IS NULL;
