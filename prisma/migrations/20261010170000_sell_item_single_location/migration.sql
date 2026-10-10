-- Data fix: sale lines sold from a showroom were also given the main store,
-- so delivery took stock from the wrong place. Keep only the showroom on
-- lines not delivered yet (delivered lines keep their history as it was).
UPDATE `sell_items`
SET `storeId` = NULL
WHERE `showroomId` IS NOT NULL
  AND `storeId` IS NOT NULL
  AND `itemSaleStatus` = 'PENDING';
