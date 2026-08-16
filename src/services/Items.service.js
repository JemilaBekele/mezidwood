/* eslint-disable no-nested-ternary */
/* eslint-disable no-restricted-syntax */
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');
const { uploadImage, deleteImage } = require('../utils/upload.util');

const getItemByIddetail = async (id) => {
  try {

    if (!id || typeof id !== 'string') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Valid item ID is required');
    }

    const item = await prisma.items.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true } },
        type: { select: { id: true, name: true } },
        size: { select: { id: true, name: true } },

        itemStocks: {
          include: {
            store: { select: { id: true, name: true, isMain: true } },
            showroom: { select: { id: true, name: true, isMain: true } },
          },
        },

        itemStockLedgers: {
          take: 20,
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { id: true, name: true } },
            store: { select: { id: true, name: true } },
            showroom: { select: { id: true, name: true } },
          },
        },

        itemMaterials: {
          include: {
            material: {
              select: { id: true, name: true },
            },
          },
        },
        itemImages: true, // Include additional images

        // ✅ Fixed: No orderBy since ProformaInvoiceItem doesn't have createdAt
        proformaInvoiceItems: {
          take: 10,
          include: {
            invoice: {
              select: {
                id: true,
                piNumber: true,
                status: true,
                paymentStatus: true,
                subtotal: true,
                total: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!item) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Item not found');
    }

    // =========================
    // STOCK SUMMARY
    // =========================
    const stockSummary = {
      totalStock: 0,
      availableStock: 0,
      byStore: {},
      byShowroom: {},
    };

    item.itemStocks?.forEach((stock) => {
      stockSummary.totalStock += stock.quantity;

      if (stock.store) {
        stockSummary.byStore[stock.store.name] =
          (stockSummary.byStore[stock.store.name] || 0) + stock.quantity;
      }

      if (stock.showroom) {
        stockSummary.byShowroom[stock.showroom.name] =
          (stockSummary.byShowroom[stock.showroom.name] || 0) + stock.quantity;
      }
    });

    stockSummary.availableStock = stockSummary.totalStock;

    // =========================
    // MOVEMENT SUMMARY
    // =========================
    const movementSummary = {
      totalIn: 0,
      totalOut: 0,
      netChange: 0,
      byType: {},
      byLocation: {},
    };

    item.itemStockLedgers?.forEach((ledger) => {
      if (ledger.movementType === 'IN' || ledger.movementType === 'RETURN') {
        movementSummary.totalIn += ledger.quantity;
      } else if (
        ledger.movementType === 'OUT' ||
        ledger.movementType === 'DAMAGE' ||
        ledger.movementType === 'EXPIRE'
      ) {
        movementSummary.totalOut += ledger.quantity;
      } else if (
        ledger.movementType === 'ADJUSTMENT' ||
        ledger.movementType === 'TRANSFER'
      ) {
        if (ledger.quantity > 0) {
          movementSummary.totalIn += ledger.quantity;
        } else {
          movementSummary.totalOut += Math.abs(ledger.quantity);
        }
      }

      movementSummary.byType[ledger.movementType] =
        (movementSummary.byType[ledger.movementType] || 0) + ledger.quantity;

      let location = 'unknown';

      if (ledger.store) {
        location = `store:${ledger.store.name}`;
      } else if (ledger.showroom) {
        location = `showroom:${ledger.showroom.name}`;
      }

      movementSummary.byLocation[location] =
        (movementSummary.byLocation[location] || 0) + ledger.quantity;
    });

    movementSummary.netChange =
      movementSummary.totalIn - movementSummary.totalOut;

    // =========================
    // PROFORMA INVOICE SUMMARY
    // =========================
    const proformaSummary = {
      totalInvoices: item.proformaInvoiceItems?.length || 0,
      totalQuantity: 0,
      totalValue: 0,
      byStatus: {},
    };

    item.proformaInvoiceItems?.forEach((piItem) => {
      proformaSummary.totalQuantity += piItem.quantity;
      proformaSummary.totalValue += piItem.amount;

      if (piItem.invoice?.status) {
        proformaSummary.byStatus[piItem.invoice.status] =
          (proformaSummary.byStatus[piItem.invoice.status] || 0) + 1;
      }
    });

    // =========================
    // RECENT INVENTORY
    // =========================
    const recentInventory =
      item.itemStocks?.slice(0, 5).map((stock) => ({
        ...stock,
        locationName: stock.store?.name || stock.showroom?.name || 'Unknown',
        locationType: stock.store
          ? 'store'
          : stock.showroom
          ? 'showroom'
          : 'unknown',
      })) || [];

    // =========================
    // CLEAN RESPONSE
    // =========================
    const {
      itemStocks,
      itemStockLedgers,
      itemMaterials,
      proformaInvoiceItems,
      ...base
    } = item;

    const result = {
      ...base,

      stockSummary,
      movementSummary,
      proformaSummary,

      recentInventory,
      recentMovements: itemStockLedgers || [],
      recentProformaInvoices: proformaInvoiceItems || [],

      materialsUsed:
        itemMaterials?.map((m) => ({
          materialId: m.material.id,
          materialName: m.material.name,
          quantity: m.quantity,
          note: m.note,
        })) || [],
    };

    console.log('[getItemById] Success:', {
      id: result.id,
      name: result.name,
      totalStock: result.stockSummary.totalStock,
      movements: result.recentMovements.length,
      proformaInvoices: result.recentProformaInvoices.length,
    });

    return result;
  } catch (error) {
    console.error('[getItemById] Error:', {
      message: error.message,
      stack: error.stack,
      id,
      code: error.code,
    });

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to fetch item details',
    );
  }
};
/**
 * Create Item with Image Upload and Relations
 */
const createItem = async (itemData, files) => {
  const { name, price, materials, categoryId, typeId, sizeId, color } =
    itemData;

  // Validate required fields
  if (!name) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Item name is required');
  }

  // Validate name
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Item name cannot be empty');
  }

  // Validate price if provided
  if (price !== undefined && (typeof price !== 'number' || price < 0)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Price must be a non-negative number',
    );
  }

  // Validate color if provided (optional)
  if (color !== undefined && color !== null) {
    const trimmedColor = color.trim();
    if (trimmedColor.length === 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Color cannot be empty string',
      );
    }
  }

  // Validate relations if provided
  if (categoryId) {
    const category = await prisma.productCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
    }
  }

  if (typeId) {
    const type = await prisma.productType.findUnique({
      where: { id: typeId },
    });
    if (!type) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Product type not found');
    }
  }

  if (sizeId) {
    const size = await prisma.size.findUnique({
      where: { id: sizeId },
    });
    if (!size) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Size not found');
    }
  }

  // Validate relation consistency: type and size should belong to same category
  if (typeId && sizeId) {
    const type = await prisma.productType.findUnique({
      where: { id: typeId },
      include: { size: true },
    });

    if (type && type.sizeId !== sizeId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Product type and size are not compatible. The type must belong to the selected size.',
      );
    }
  }

  // Prevent duplicate item by name and color combination
  const existingItem = await prisma.items.findFirst({
    where: {
      name: trimmedName,
      color: color || null,
    },
  });

  if (existingItem) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'Item already exists with the same name and color combination',
    );
  }

  // Handle main image upload
  let imageUrl = null;
  const mainImageFile = files?.image
    ? Array.isArray(files.image)
      ? files.image[0]
      : files.image
    : undefined;

  if (mainImageFile) {
    try {
      imageUrl = await uploadImage(mainImageFile, 'item_images');
    } catch (err) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Item main image processing failed',
      );
    }
  }

  // Handle additional images upload
  const additionalFiles = files?.images || [];
  const additionalFileArray = Array.isArray(additionalFiles)
    ? additionalFiles
    : [additionalFiles];

  const additionalImageUrls = [];
  if (additionalFileArray.length > 0) {
    try {
      for (const imageFile of additionalFileArray) {
        if (imageFile) {
          console.log('Uploading image:', imageFile.originalname || 'unnamed');
          const uploadedUrl = await uploadImage(imageFile, 'item_images');
          console.log('Uploaded URL:', uploadedUrl);
          additionalImageUrls.push({ imageUrl: uploadedUrl });
        }
      }
    } catch (err) {
      console.error('Additional images processing error:', err);
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Additional images processing failed',
      );
    }
  } else {
    console.log('No additional images to process');
  }

  // Validate materials if provided
  if (materials && materials.length > 0) {
    for (const material of materials) {
      if (!material.materialId) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Material ID is required for each material',
        );
      }
      if (!material.quantity || material.quantity < 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Valid quantity is required for each material',
        );
      }

      // Check if material exists
      const existingMaterial = await prisma.material.findUnique({
        where: { id: material.materialId },
      });

      if (!existingMaterial) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Material with ID ${material.materialId} not found`,
        );
      }
    }
  }

  // Create item with materials, main image, additional images, color, and relations

  const item = await prisma.items.create({
    data: {
      name: trimmedName,
      price: price !== undefined ? price : 0,
      imageUrl, // Main image
      color: color || null,
      categoryId: categoryId || null,
      typeId: typeId || null,
      sizeId: sizeId || null,
      itemMaterials:
        materials && materials.length > 0
          ? {
              create: materials.map((material) => ({
                materialId: material.materialId,
                quantity: material.quantity,
                note: material.note || null,
              })),
            }
          : undefined,
      itemImages:
        additionalImageUrls.length > 0
          ? {
              create: additionalImageUrls,
            }
          : undefined,
    },
    include: {
      category: true,
      type: {
        include: {
          size: true,
        },
      },
      size: {
        include: {
          category: true,
        },
      },
      itemMaterials: {
        include: {
          material: true,
        },
      },
      itemImages: true, // Include additional images
    },
  });

  return item;
};

/**
 * Update Item with Image Upload Support and Relations
 */
/**
 * Update Item with Main Image and Additional Images Support
 */
const updateItem = async (id, updateBody, files) => {
  const {
    materials,
    price,
    categoryId,
    typeId,
    sizeId,
    color,
    imagesToDelete,
    ...itemData
  } = updateBody;

  // Check if item exists
  const existingItem = await prisma.items.findUnique({
    where: { id },
    include: {
      itemMaterials: true,
      category: true,
      type: true,
      size: true,
      itemImages: true,
    },
  });

  if (!existingItem) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Item not found');
  }

  // Validate color if provided
  if (color !== undefined && color !== null) {
    const trimmedColor = color.trim();
    if (trimmedColor.length === 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Color cannot be empty string',
      );
    }
  }

  // Validate relations if provided
  if (categoryId) {
    const category = await prisma.productCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
    }
  }

  if (typeId) {
    const type = await prisma.productType.findUnique({
      where: { id: typeId },
    });
    if (!type) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Product type not found');
    }
  }

  if (sizeId) {
    const size = await prisma.size.findUnique({
      where: { id: sizeId },
    });
    if (!size) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Size not found');
    }
  }

  // Validate relation consistency
  if (typeId && sizeId) {
    const type = await prisma.productType.findUnique({
      where: { id: typeId },
      include: { size: true },
    });

    if (type && type.sizeId !== sizeId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Product type and size are not compatible. The type must belong to the selected size.',
      );
    }
  }

  // Handle main image upload
  let { imageUrl } = existingItem;
  const mainImageFile = files?.image
    ? Array.isArray(files.image)
      ? files.image[0]
      : files.image
    : undefined;

  if (mainImageFile) {
    try {
      imageUrl = await uploadImage(mainImageFile, 'item_images');

      // Delete old main image if exists
      if (existingItem.imageUrl) {
        try {
          await deleteImage(existingItem.imageUrl);
        } catch (err) {
          console.warn('Failed to delete old main image:', err);
        }
      }
    } catch (err) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Item main image processing failed',
      );
    }
  } else if (updateBody.imageUrl === null || updateBody.imageUrl === 'null') {
    // If explicitly set to null, remove the main image
    imageUrl = null;

    if (existingItem.imageUrl) {
      try {
        await deleteImage(existingItem.imageUrl);
      } catch (err) {
        console.warn('Failed to delete old main image:', err);
      }
    }
  }

  // Handle additional images upload
  const additionalFiles = files?.images || [];
  const additionalFileArray = Array.isArray(additionalFiles)
    ? additionalFiles
    : [additionalFiles];

  if (additionalFileArray.length > 0) {
    try {
      const newImages = [];
      for (const imageFile of additionalFileArray) {
        if (imageFile) {
          const uploadedUrl = await uploadImage(imageFile, 'item_images');
          newImages.push({
            itemId: id,
            imageUrl: uploadedUrl,
          });
        }
      }

      // Create new additional images
      if (newImages.length > 0) {
        const createdImages = await prisma.itemImage.createMany({
          data: newImages,
        });
        console.log('Created images count:', createdImages.count);
      }
    } catch (err) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Additional images processing failed',
      );
    }
  } else {
    console.log('No additional images to process');
  }

  // Handle deletion of additional images
  if (
    imagesToDelete &&
    Array.isArray(imagesToDelete) &&
    imagesToDelete.length > 0
  ) {
    for (const imageId of imagesToDelete) {
      const imageToDelete = existingItem.itemImages.find(
        (img) => img.id === imageId,
      );

      if (imageToDelete) {
        try {
          await deleteImage(imageToDelete.imageUrl);
        } catch (err) {
          console.warn(`Failed to delete additional image ${imageId}:`, err);
        }
      }
    }

    const deleted = await prisma.itemImage.deleteMany({
      where: {
        id: { in: imagesToDelete },
        itemId: id,
      },
    });
  }

  // Clean update body - IMPORTANT: Keep only the fields we want to update
  const cleanedUpdateBody = {};

  // Add name if provided
  if (itemData.name !== undefined) {
    const trimmedName = itemData.name.trim();
    if (trimmedName.length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Item name cannot be empty');
    }
    cleanedUpdateBody.name = trimmedName;
  }

  // Add price if provided
  if (price !== undefined) {
    if (typeof price !== 'number' || price < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Price must be a non-negative number',
      );
    }
    cleanedUpdateBody.price = price;
  }

  // Add color if provided
  if (color !== undefined) {
    cleanedUpdateBody.color = color || null;
  }

  // Add relations if provided
  if (categoryId !== undefined) {
    cleanedUpdateBody.categoryId = categoryId || null;
  }

  if (typeId !== undefined) {
    cleanedUpdateBody.typeId = typeId || null;
  }

  if (sizeId !== undefined) {
    cleanedUpdateBody.sizeId = sizeId || null;
  }

  // Add imageUrl
  cleanedUpdateBody.imageUrl = imageUrl;

  // Check duplicate name and color combination if updating name or color
  const newName =
    cleanedUpdateBody.name !== undefined
      ? cleanedUpdateBody.name
      : existingItem.name;
  const newColor = color !== undefined ? color || null : existingItem.color;

  if (cleanedUpdateBody.name !== undefined || color !== undefined) {
    const duplicateItem = await prisma.items.findFirst({
      where: {
        name: newName,
        color: newColor,
        id: { not: id },
      },
    });

    if (duplicateItem) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Another item already exists with the same name and color combination',
      );
    }
  }

  // Handle materials update if provided
  if (materials) {
    // Validate materials
    for (const material of materials) {
      if (!material.materialId) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Material ID is required for each material',
        );
      }
      if (!material.quantity || material.quantity < 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Valid quantity is required for each material',
        );
      }

      // Check if material exists
      const existingMaterial = await prisma.material.findUnique({
        where: { id: material.materialId },
      });

      if (!existingMaterial) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Material with ID ${material.materialId} not found`,
        );
      }

      // Check for duplicate material IDs in the update
      const materialIds = materials.map((m) => m.materialId);
      if (
        materialIds.indexOf(material.materialId) !==
        materialIds.lastIndexOf(material.materialId)
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Duplicate material ID ${material.materialId} in update`,
        );
      }
    }

    // Delete existing materials
    await prisma.itemMaterial.deleteMany({
      where: { itemId: id },
    });

    // Create new materials
    await prisma.itemMaterial.createMany({
      data: materials.map((material) => ({
        itemId: id,
        materialId: material.materialId,
        quantity: material.quantity,
        note: material.note || null,
      })),
    });
  }

  // Update item - Only update if there are changes
  const updatedItem = await prisma.items.update({
    where: { id },
    data: cleanedUpdateBody,
    include: {
      category: true,
      type: {
        include: {
          size: true,
        },
      },
      size: {
        include: {
          category: true,
        },
      },
      itemMaterials: {
        include: {
          material: true,
        },
      },
      itemImages: true,
    },
  });
  return updatedItem;
};
/**
 * Delete Item
 */
const deleteItem = async (id) => {
  try {
    // Check if item exists
    const existingItem = await prisma.items.findUnique({
      where: { id },
      include: {
        itemMaterials: true,
        itemStocks: true,
        deliveryEstimationItems: true,
        proformaInvoiceItems: true,
        sellItems: true,
        transferItems: true,
      },
    });

    if (!existingItem) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Item not found');
    }

    // Check for dependencies
    if (existingItem.itemMaterials?.length > 0) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Cannot delete item because it has associated materials',
      );
    }

    if (existingItem.itemStocks?.length > 0) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Cannot delete item because it has associated stock records',
      );
    }

    if (existingItem.deliveryEstimationItems?.length > 0) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Cannot delete item because it is referenced in delivery estimations',
      );
    }

    if (existingItem.proformaInvoiceItems?.length > 0) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Cannot delete item because it is referenced in proforma invoices',
      );
    }

    if (existingItem.sellItems?.length > 0) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Cannot delete item because it is referenced in sales',
      );
    }

    if (existingItem.transferItems?.length > 0) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Cannot delete item because it is referenced in transfers',
      );
    }

    // Delete the image if it exists
    if (existingItem.imageUrl) {
      try {
        await deleteImage(existingItem.imageUrl);
      } catch (err) {
        console.error('Failed to delete item image:', {
          error: err,
          itemId: id,
          imageUrl: existingItem.imageUrl,
          timestamp: new Date().toISOString()
        });
      }
    }

    await prisma.items.delete({
      where: { id },
    });

    return { message: 'Item deleted successfully' };
  } catch (error) {
    console.error('Error in deleteItem function:', {
      error: error,
      itemId: id,
      errorMessage: error.message,
      errorStack: error.stack,
      timestamp: new Date().toISOString()
    });
    throw error; // Re-throw the error after logging
  }
};

/**
 * Get All Items with Relations
 */
const getAllItems = async (filter = {}) => {
  const items = await prisma.items.findMany({
    where: filter,
    orderBy: { createdAt: 'desc' },
    include: {
      category: {
        select: {
          id: true,
          name: true,
        },
      },
      itemImages: {
        select: {
          id: true,
          imageUrl: true,
        },
      },
      type: {
        select: {
          id: true,
          name: true,
          size: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      size: {
        select: {
          id: true,
          name: true,
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      itemMaterials: {
        include: {
          material: true,
        },
      },
      itemStocks: {
        include: {
          store: {
            select: {
              id: true,
              name: true,
              isMain: true,
            },
          },
          showroom: {
            select: {
              id: true,
              name: true,
              isMain: true,
            },
          },
        },
      },
    },
  });

  // Transform the data to include detailed stock information
  const itemsWithStock = items.map((item) => {
    // Group stocks by store
    const storeStocks = [];
    // Group stocks by showroom
    const showroomStocks = [];

    // Track totals
    let totalStoreQuantity = 0;
    let totalShowroomQuantity = 0;

    // Process each stock record
    item.itemStocks.forEach((stock) => {
      if (stock.storeId && stock.store) {
        const existingStore = storeStocks.find(
          (s) => s.storeId === stock.storeId,
        );
        if (existingStore) {
          existingStore.quantity += stock.quantity;
        } else {
          storeStocks.push({
            storeId: stock.store.id,
            storeName: stock.store.name,
            isMain: stock.store.isMain,
            quantity: stock.quantity,
          });
        }
        totalStoreQuantity += stock.quantity;
      }

      if (stock.showroomId && stock.showroom) {
        const existingShowroom = showroomStocks.find(
          (s) => s.showroomId === stock.showroomId,
        );
        if (existingShowroom) {
          existingShowroom.quantity += stock.quantity;
        } else {
          showroomStocks.push({
            showroomId: stock.showroom.id,
            showroomName: stock.showroom.name,
            isMain: stock.showroom.isMain,
            quantity: stock.quantity,
          });
        }
        totalShowroomQuantity += stock.quantity;
      }
    });

    const totalQuantity = totalStoreQuantity + totalShowroomQuantity;

    return {
      id: item.id,
      name: item.name,
      price: item.price,
      imageUrl: item.imageUrl,
      color: item.color,
      category: item.category,
      type: item.type,
      size: item.size,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      itemMaterials: item.itemMaterials,
      itemImages: item.itemImages, // ✅ ADD THIS - Include itemImages in the response

      // Stock details with only locations that have stock
      stockDetails: {
        stores: storeStocks, // Array of stores with stock
        showrooms: showroomStocks, // Array of showrooms with stock
        totalStoreQuantity,
        totalShowroomQuantity,
        totalQuantity,
        stock: totalQuantity,
      },

      // For backward compatibility
      stock: totalQuantity,
    };
  });

  return {
    items: itemsWithStock,
    count: items.length,
  };
};
const getAllItemslist = async (filter = {}) => {
  const items = await prisma.items.findMany({
    where: filter,
    orderBy: { createdAt: 'desc' },
    include: {
      category: {
        select: {
          id: true,
          name: true,
        },
      },
      itemImages: true, // Include additional images

      type: {
        select: {
          id: true,
          name: true,
          size: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      size: {
        select: {
          id: true,
          name: true,
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      itemMaterials: {
        include: {
          material: true,
        },
      },
      itemStocks: {
        include: {
          store: {
            select: {
              id: true,
              name: true,
              isMain: true,
            },
          },
          showroom: {
            select: {
              id: true,
              name: true,
              isMain: true,
            },
          },
        },
      },
    },
  });

  // Transform the data to include detailed stock information and filter by stock > 1
  const itemsWithStock = items
    .map((item) => {
      // Group stocks by store
      const storeStocks = [];
      // Group stocks by showroom
      const showroomStocks = [];

      // Track totals
      let totalStoreQuantity = 0;
      let totalShowroomQuantity = 0;

      // Process each stock record
      item.itemStocks.forEach((stock) => {
        if (stock.storeId && stock.store) {
          const existingStore = storeStocks.find(
            (s) => s.storeId === stock.storeId,
          );
          if (existingStore) {
            existingStore.quantity += stock.quantity;
          } else {
            storeStocks.push({
              storeId: stock.store.id,
              storeName: stock.store.name,
              isMain: stock.store.isMain,
              quantity: stock.quantity,
            });
          }
          totalStoreQuantity += stock.quantity;
        }

        if (stock.showroomId && stock.showroom) {
          const existingShowroom = showroomStocks.find(
            (s) => s.showroomId === stock.showroomId,
          );
          if (existingShowroom) {
            existingShowroom.quantity += stock.quantity;
          } else {
            showroomStocks.push({
              showroomId: stock.showroom.id,
              showroomName: stock.showroom.name,
              isMain: stock.showroom.isMain,
              quantity: stock.quantity,
            });
          }
          totalShowroomQuantity += stock.quantity;
        }
      });

      const totalQuantity = totalStoreQuantity + totalShowroomQuantity;

      // Only return items with total quantity greater than 1
      if (totalQuantity <= 1) {
        return null;
      }

      return {
        id: item.id,
        name: item.name,
        price: item.price,
        imageUrl: item.imageUrl,
        color: item.color,
        category: item.category,
        type: item.type,
        size: item.size,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        itemMaterials: item.itemMaterials,

        // Stock details with only locations that have stock
        stockDetails: {
          stores: storeStocks, // Array of stores with stock
          showrooms: showroomStocks, // Array of showrooms with stock
          totalStoreQuantity,
          totalShowroomQuantity,
          totalQuantity,
          stock: totalQuantity,
        },

        // For backward compatibility
        stock: totalQuantity,
      };
    })
    .filter((item) => item !== null); // Remove null items (those with stock <= 1)

  return {
    items: itemsWithStock,
    count: itemsWithStock.length,
  };
};
const getAllItemsimple = async (filter = {}) => {
  const items = await prisma.items.findMany({
    where: filter,
    orderBy: { createdAt: 'desc' },
    include: {
      category: {
        select: {
          id: true,
          name: true,
        },
      },
      itemImages: true, // Include additional images

      type: {
        select: {
          id: true,
          name: true,
          size: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      size: {
        select: {
          id: true,
          name: true,
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      itemMaterials: {
        include: {
          material: true,
        },
      },
      // Exclude itemStocks to avoid stock calculations
    },
  });

  return {
    items,
    count: items.length,
  };
};
/**
 * Get Item by ID with all relations
 */
const getItemById = async (id) => {
  const item = await prisma.items.findUnique({
    where: { id },
    include: {
      category: {
        select: {
          id: true,
          name: true,
        },
      },
      itemImages: true, // Include additional images

      type: {
        include: {
          size: {
            include: {
              category: true,
            },
          },
        },
      },
      size: {
        include: {
          category: true,
          productTypes: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      itemMaterials: {
        include: {
          material: true,
        },
      },
      itemStocks: {
        select: {
          id: true,
          quantity: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!item) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Item not found');
  }

  return item;
};

/**
 * Get Items by Category
 */
const getItemsByCategory = async (categoryId) => {
  const category = await prisma.productCategory.findUnique({
    where: { id: categoryId },
  });

  if (!category) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
  }

  const items = await prisma.items.findMany({
    where: { categoryId },
    include: {
      type: true,
      size: true,
      itemStocks: {
        select: {
          quantity: true,
        },
      },
    },
  });

  return items;
};

/**
 * Get Items by Type
 */
const getItemsByType = async (typeId) => {
  const type = await prisma.productType.findUnique({
    where: { id: typeId },
  });

  if (!type) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product type not found');
  }

  const items = await prisma.items.findMany({
    where: { typeId },
    include: {
      category: true,
      size: true,
      itemStocks: {
        select: {
          quantity: true,
        },
      },
    },
  });

  return items;
};

/**
 * Get Items by Size
 */
const getItemsBySize = async (sizeId) => {
  const size = await prisma.size.findUnique({
    where: { id: sizeId },
  });

  if (!size) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Size not found');
  }

  const items = await prisma.items.findMany({
    where: { sizeId },
    include: {
      category: true,
      type: true,
      itemStocks: {
        select: {
          quantity: true,
        },
      },
    },
  });

  return items;
};

/**
 * Get Items by Color
 */
const getItemsByColor = async (color) => {
  if (!color) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Color is required');
  }

  const items = await prisma.items.findMany({
    where: { color },
    include: {
      category: true,
      type: true,
      size: true,
      itemStocks: {
        select: {
          quantity: true,
        },
      },
    },
  });

  return items;
};

const getAllProformaInvoicesAndSales = async (filters = {}) => {
  try {
    const {
      startDate,
      endDate,
      status,
      paymentStatus,
      createdById,
      customerId,
      storeId,
      searchTerm,
      type = 'all',
      page = 1,
      limit = 50,
    } = filters;

    const skip = (page - 1) * limit;

    // Build date filter
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        dateFilter.createdAt.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.createdAt.lte = end;
      }
    }

    // Common filter builder for Sales (Sell model uses createdById)
    const buildSalesCommonFilters = () => {
      const common = {};
      if (createdById) common.createdById = createdById;
      if (customerId) common.customerId = customerId;
      if (Object.keys(dateFilter).length)
        common.createdAt = dateFilter.createdAt;
      return common;
    };

    // Common filter builder for Proforma (uses preparedById instead of createdById)
    const buildProformaCommonFilters = () => {
      const common = {};
      if (createdById) common.preparedById = createdById; // Map createdById to preparedById
      if (customerId) common.customerId = customerId;
      if (Object.keys(dateFilter).length)
        common.createdAt = dateFilter.createdAt;
      return common;
    };

    const salesCommonFilters = buildSalesCommonFilters();
    const proformaCommonFilters = buildProformaCommonFilters();

    // Build Proforma Invoice filters - ALWAYS store = false
    const proformaFilters = {
      ...proformaCommonFilters,
      store: false, // Force store to be false
    };

    // Add payment status filter for proforma
    if (
      paymentStatus &&
      ['PENDING', 'PAID', 'PARTIAL', 'UNPAID'].includes(paymentStatus)
    ) {
      proformaFilters.paymentStatus = paymentStatus;
    }

    // Build Sales filters
    const salesFilters = { ...salesCommonFilters };
    if (storeId) salesFilters.storeId = storeId;

    // Add payment status filter for sales
    if (
      paymentStatus &&
      ['PENDING', 'PAID', 'PARTIAL', 'UNPAID'].includes(paymentStatus)
    ) {
      salesFilters.paymentStatus = paymentStatus;
    }

    // Handle status filters separately for each type
    if (status) {
      // Proforma statuses
      const proformaStatuses = [
        'PENDING_ST',
        'APPROVED_ST',
        'SENT_TO_CLIENT',
        'REVISION',
        'APPROVED_CLIENT',
        'APPROVED_CREATE_PROJECT',
        'CANCELLED',
      ];
      if (proformaStatuses.includes(status)) {
        proformaFilters.status = status;
      }

      // Sale statuses
      const saleStatuses = [
        'NOT_APPROVED',
        'APPROVED',
        'PARTIALLY_DELIVERED',
        'DELIVERED',
        'CANCELLED',
      ];
      if (saleStatuses.includes(status)) {
        salesFilters.saleStatus = status;
      }
    }

    // Search filter for invoice number or customer name
    const addSearchFilter = (filters, search, modelType) => {
      if (!search) return filters;

      if (modelType === 'proforma') {
        return {
          ...filters,
          OR: [
            { piNumber: { contains: search, mode: 'insensitive' } },
            { customer: { name: { contains: search, mode: 'insensitive' } } },
          ],
        };
      }
      return {
        ...filters,
        OR: [
          { invoiceNo: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
        ],
      };
    };

    const proformaFinalFilters = addSearchFilter(
      proformaFilters,
      searchTerm,
      'proforma',
    );
    const salesFinalFilters = addSearchFilter(salesFilters, searchTerm, 'sale');

    // DEBUG: Check what proforma invoices exist without filters
    if (type === 'proforma' || type === 'all') {
      try {
        // Get ALL proforma invoices for debugging
        const allProformaInvoices = await prisma.proformaInvoice.findMany({
          take: 10,
          select: {
            id: true,
            piNumber: true,
            status: true,
            paymentStatus: true,
            preparedById: true,
            customerId: true,
            store: true,
          },
        });

        // Get count of proforma invoices by status
        const statusCounts = await prisma.proformaInvoice.groupBy({
          by: ['status'],
          _count: {
            status: true,
          },
        });

        // Get count by payment status
        const paymentStatusCounts = await prisma.proformaInvoice.groupBy({
          by: ['paymentStatus'],
          _count: {
            paymentStatus: true,
          },
        });

        // Check for specific customer
        if (customerId) {
          const customerProformaCount = await prisma.proformaInvoice.count({
            where: {
              customerId,
            },
          });
        }

        // Check for specific preparedBy
        if (createdById) {
          const userProformaCount = await prisma.proformaInvoice.count({
            where: {
              preparedById: createdById,
            },
          });
        }
      } catch (debugError) {
        console.error('Debug error:', debugError);
      }
    }

    // Execute queries based on type
    let proformaInvoices = [];
    let sales = [];
    let proformaCount = 0;
    let salesCount = 0;

    if (type === 'proforma' || type === 'all') {
      try {
        [proformaInvoices, proformaCount] = await Promise.all([
          prisma.proformaInvoice.findMany({
            where: proformaFinalFilters,
            include: {
              customer: {
                select: {
                  id: true,
                  name: true,
                  companyName: true,
                  phone1: true,
                },
              },
              preparedBy: {
                select: {
                  id: true,
                  name: true,
                },
              },
              approvedBy: {
                select: {
                  id: true,
                  name: true,
                },
              },
              items: {
                include: {
                  item: {
                    select: {
                      id: true,
                      name: true,
                      price: true,
                      imageUrl: true,
                    },
                  },
                  proformaItemMaterials: {
                    include: {
                      material: true,
                    },
                  },
                  images: true,
                },
              },
              banks: true,
              attachments: true,
              project: true,
            },
            orderBy: { createdAt: 'desc' },
            skip: type === 'proforma' ? skip : 0,
            take: type === 'proforma' ? limit : undefined,
          }),
          prisma.proformaInvoice.count({ where: proformaFinalFilters }),
        ]);
      } catch (error) {
        console.error('Proforma fetch error details:', error);
        throw new Error(`Proforma fetch error: ${error.message}`);
      }
    }

    if (type === 'sale' || type === 'all') {
      try {
        console.log('Fetching sales...');
        [sales, salesCount] = await Promise.all([
          prisma.sell.findMany({
            where: salesFinalFilters,
            include: {
              store: {
                select: {
                  id: true,
                  name: true,
                  isMain: true,
                },
              },
              customer: {
                select: {
                  id: true,
                  name: true,
                  companyName: true,
                  phone1: true,
                },
              },
              createdBy: {
                select: {
                  id: true,
                  name: true,
                },
              },
              updatedBy: {
                select: {
                  id: true,
                  name: true,
                },
              },
              items: {
                include: {
                  item: {
                    select: {
                      id: true,
                      name: true,
                      price: true,
                      imageUrl: true,
                      color: true,
                      itemStocks: {
                        where: storeId ? { storeId } : undefined,
                        select: { quantity: true },
                      },
                    },
                  },
                },
              },
              sellPayments: true,
            },
            orderBy: { createdAt: 'desc' },
            skip: type === 'sale' ? skip : 0,
            take: type === 'sale' ? limit : undefined,
          }),
          prisma.sell.count({ where: salesFinalFilters }),
        ]);

        // Log the actual sales found (first few)
      } catch (error) {
        console.error('Sales fetch error details:', error);
        throw new Error(`Sales fetch error: ${error.message}`);
      }
    }

    // Transform data for consistent response
    const transformProformaInvoice = (invoice) => {
      try {
        return {
          id: invoice.id,
          invoiceNo: invoice.piNumber,
          type: 'PROFORMA',
          customer: invoice.customer,
          status: invoice.status,
          paymentStatus: invoice.paymentStatus || 'PENDING',
          subtotal: invoice.subtotal || 0,
          vat: invoice.vat || 0,
          total: invoice.total || 0,
          amountPaid: invoice.amountPaid || 0,
          balance: invoice.balance || 0,
          amountDate: invoice.amountDate,
          preparedBy: invoice.preparedBy,
          approvedBy: invoice.approvedBy,
          store: invoice.store ? 'Store Sale' : 'Showroom Sale',
          items:
            invoice.items?.map((item) => ({
              id: item.id,
              description: item.description,
              size: item.size,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              amount: item.amount,
              item: item.item,
              materials: item.proformaItemMaterials,
              images: item.images,
            })) || [],
          banks: invoice.banks || [],
          attachments: invoice.attachments || [],
          project: invoice.project,
          createdAt: invoice.createdAt,
          updatedAt: invoice.updatedAt,
        };
      } catch (error) {
        console.error('Error transforming proforma invoice:', error, invoice);
        return null;
      }
    };

    const transformSale = (sale) => {
      try {
        return {
          id: sale.id,
          invoiceNo: sale.invoiceNo,
          type: 'SALE',
          customer: sale.customer,
          status: sale.saleStatus,
          paymentStatus: sale.paymentStatus || 'PENDING',
          grandTotal: sale.grandTotal || 0,
          balance: sale.balance || 0,
          totalPaid: sale.totalPaid || 0,
          subTotal: sale.subTotal || 0,
          discount: sale.discount || 0,
          vat: sale.vat || 0,
          totalProducts: sale.totalProducts || 0,
          store: sale.store,
          locked: sale.locked || false,
          lockedAt: sale.lockedAt,
          notes: sale.notes,
          saleDate: sale.saleDate,
          items:
            sale.items?.map((item) => ({
              id: item.id,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              itemSaleStatus: item.itemSaleStatus,
              item: {
                ...item.item,
                stock: item.item?.itemStocks?.[0]?.quantity || 0,
              },
            })) || [],
          payments: sale.sellPayments || [],
          createdBy: sale.createdBy,
          updatedBy: sale.updatedBy,
          createdAt: sale.createdAt,
          updatedAt: sale.updatedAt,
        };
      } catch (error) {
        console.error('Error transforming sale:', error, sale);
        return null;
      }
    };

    // Prepare response
    let allItems = [];
    let totalCount = 0;

    if (type === 'proforma') {
      allItems = proformaInvoices
        .map(transformProformaInvoice)
        .filter((item) => item !== null);
      totalCount = proformaCount;
    } else if (type === 'sale') {
      allItems = sales.map(transformSale).filter((item) => item !== null);
      totalCount = salesCount;
    } else {
      const transformedProforma = proformaInvoices
        .map(transformProformaInvoice)
        .filter((item) => item !== null);
      const transformedSales = sales
        .map(transformSale)
        .filter((item) => item !== null);
      allItems = [...transformedProforma, ...transformedSales]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(skip, skip + limit);
      totalCount = proformaCount + salesCount;
    }

    const response = {
      success: true,
      data: allItems,
      pagination: {
        currentPage: page,
        itemsPerPage: limit,
        totalItems: totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1,
        hasNextPage: page * limit < totalCount,
        hasPrevPage: page > 1,
      },
      summary: {
        proformaCount,
        salesCount,
        totalCount,
        ...(startDate &&
          endDate && {
            dateRange: {
              from: startDate,
              to: endDate,
            },
          }),
        ...(createdById && { filteredByUser: createdById }),
        ...(status && { filteredByStatus: status }),
        ...(paymentStatus && { filteredByPaymentStatus: paymentStatus }),
      },
    };

    return response;
  } catch (error) {
    // Return error response instead of throwing
    return {
      success: false,
      error: error.message,
      data: [],
      pagination: {
        currentPage: 1,
        itemsPerPage: 50,
        totalItems: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
      summary: {
        proformaCount: 0,
        salesCount: 0,
        totalCount: 0,
      },
    };
  }
};
const acceptInitialItemStockBulk = async (items, userId) => {
  try {
    if (!items || items.length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Items are required');
    }

    const results = [];

    await prisma.$transaction(async (tx) => {
      for (const entry of items) {
        const { itemId, initialQuantity, storeId, showroomId } = entry;

        // Validation
        if (!itemId) {
          throw new ApiError(httpStatus.BAD_REQUEST, 'Item ID is required');
        }

        if (!initialQuantity || initialQuantity <= 0) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            'Initial quantity must be greater than 0',
          );
        }

        if (!storeId && !showroomId) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            'Either store or showroom must be specified',
          );
        }

        // Check item
        const item = await tx.items.findUnique({
          where: { id: itemId },
        });

        if (!item) {
          throw new ApiError(httpStatus.NOT_FOUND, 'Item not found');
        }

        // Check store/showroom
        let store = null;
        let showroom = null;

        if (storeId) {
          store = await tx.store.findUnique({ where: { id: storeId } });
          if (!store)
            throw new ApiError(httpStatus.NOT_FOUND, 'Store not found');
        }

        if (showroomId) {
          showroom = await tx.showroom.findUnique({
            where: { id: showroomId },
          });
          if (!showroom)
            throw new ApiError(httpStatus.NOT_FOUND, 'Showroom not found');
        }

        // Prevent duplicate initial stock
        const existing = await tx.itemStockLedger.count({
          where: {
            itemId,
            storeId: storeId || null,
            showroomId: showroomId || null,
            movementType: 'IN',
            notes: { contains: 'Initial stock setup' },
          },
        });

        if (existing > 0) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Initial stock already set for item ${item.name}`,
          );
        }

        // Stock update/create
        let itemStock = await tx.itemStock.findFirst({
          where: {
            itemId,
            storeId: storeId || null,
            showroomId: showroomId || null,
          },
        });

        if (itemStock) {
          itemStock = await tx.itemStock.update({
            where: { id: itemStock.id },
            data: {
              quantity: { increment: initialQuantity },
              updatedAt: new Date(),
            },
          });
        } else {
          itemStock = await tx.itemStock.create({
            data: {
              itemId,
              storeId: storeId || null,
              showroomId: showroomId || null,
              quantity: initialQuantity,
            },
          });
        }

        // Ledger entry
        const stockLedger = await tx.itemStockLedger.create({
          data: {
            itemId,
            movementType: 'IN',
            quantity: initialQuantity,
            reference: `INITIAL-${Date.now()}-${itemId.slice(0, 6)}`,
            storeId: storeId || null,
            showroomId: showroomId || null,
            userId,
            notes: `Initial stock setup for ${item.name}`,
            createdAt: new Date(),
          },
        });

        results.push({
          itemId,
          itemName: item.name,
          quantity: initialQuantity,
          storeId,
          showroomId,
          itemStock,
          stockLedger,
        });
      }
    });

    return {
      success: true,
      processed: results.length,
      results,
      message: 'All initial stocks processed successfully',
    };
  } catch (error) {
    if (error.code === 'P2025') {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        'Related record not found during transaction',
      );
    }
    throw error;
  }
};
module.exports = {
  acceptInitialItemStockBulk,
  getItemByIddetail,
  createItem,
  updateItem,
  deleteItem,
  getAllItems,
  getAllItemslist,
  getAllItemsimple,
  getItemById,
  getItemsByCategory,
  getItemsByType,
  getItemsBySize,
  getItemsByColor,
  getAllProformaInvoicesAndSales,
};
