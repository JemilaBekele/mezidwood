/* eslint-disable no-nested-ternary */
/* eslint-disable no-restricted-syntax */
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');
const { uploadImage } = require('../utils/upload.util');

// Create Material with image
// Helper function to properly parse boolean values from form data
const parseBoolean = (value) => {
  if (value === undefined || value === null) return undefined;

  // If it's already a boolean, return it
  if (typeof value === 'boolean') return value;

  // If it's a string, check for "true" or "false" (case insensitive)
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    // If it's a non-boolean string, return undefined (don't set the field)
    return undefined;
  }

  // For numbers: 0 = false, 1 = true
  if (typeof value === 'number') {
    return value === 1;
  }

  return undefined;
};
const createMaterial = async (materialData, files) => {
  // Log incoming data for debugging
  console.log(
    'Creating material with data:',
    JSON.stringify(materialData, null, 2),
  );
  console.log('Files received:', files ? Object.keys(files) : 'No files');

  const {
    name,
    color,
    size,
    plainMDF,
    laminatedMDF,
    wood,
    metal,
    accessory,
    other,
    materialTypeId,
    unitOfMeasureId,
  } = materialData;

  // Validate required fields (color is now optional like size)
  if (!name || !materialTypeId) {
    console.log('Validation failed: Missing required fields', {
      name,
      materialTypeId,
    });
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Material name and category are required',
    );
  }

  // Validate name
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Material name cannot be empty');
  }

  // Validate color only if provided (optional)
  let trimmedColor = null;
  if (color !== undefined && color !== null && color !== '') {
    trimmedColor = color.trim();
    if (trimmedColor.length === 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Material color cannot be empty if provided',
      );
    }
    console.log('Color provided:', trimmedColor);
  } else {
    console.log('Color not provided, will be set to null in database');
  }

  // Validate size only if provided (optional)
  let trimmedSize = null;
  if (size !== undefined && size !== null && size !== '') {
    trimmedSize = size.trim();
    if (trimmedSize.length === 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Material size cannot be empty if provided',
      );
    }
    console.log('Size provided:', trimmedSize);
  } else {
    console.log('Size not provided, will be set to null in database');
  }

  // Check if material category exists
  const materialCategory = await prisma.materialCategory.findUnique({
    where: { id: materialTypeId },
  });

  if (!materialCategory) {
    console.log('Material category not found:', materialTypeId);
    throw new ApiError(httpStatus.BAD_REQUEST, 'Material category not found');
  }

  // Validate unitOfMeasureId if provided
  if (unitOfMeasureId) {
    const unitOfMeasure = await prisma.unitOfMeasure.findUnique({
      where: { id: unitOfMeasureId },
    });

    if (!unitOfMeasure) {
      console.log('Unit of measure not found:', unitOfMeasureId);
      throw new ApiError(httpStatus.BAD_REQUEST, 'Unit of measure not found');
    }
  }

  // Optional: prevent duplicate material (name + color + size) within the same category
  const existingMaterialWhereClause = {
    name: trimmedName,
    materialTypeId,
  };

  // Only add color to the query if it's provided
  if (trimmedColor !== null) {
    existingMaterialWhereClause.color = trimmedColor;
  }

  // Only add size to the query if it's provided
  if (trimmedSize !== null) {
    existingMaterialWhereClause.size = trimmedSize;
  }

  console.log(
    'Checking for existing material with:',
    existingMaterialWhereClause,
  );

  const existingMaterial = await prisma.material.findFirst({
    where: existingMaterialWhereClause,
  });

  if (existingMaterial) {
    const colorText = trimmedColor ? `, color: ${trimmedColor}` : '';
    const sizeText = trimmedSize ? `, size: ${trimmedSize}` : '';
    console.log('Duplicate material found:', existingMaterial.id);
    throw new ApiError(
      httpStatus.CONFLICT,
      `Material already exists with same name${colorText}${sizeText} in this category`,
    );
  }

  // Handle image upload
  let imageUrl = null;
  const imageFile = Array.isArray(files?.image) ? files.image[0] : files?.image;

  if (imageFile) {
    try {
      console.log('Uploading image file:', imageFile.name);
      imageUrl = await uploadImage(imageFile, 'material_images');
      console.log('Image uploaded successfully:', imageUrl);
    } catch (err) {
      console.error('ERROR: Image upload failed:', err);
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Material image processing failed',
      );
    }
  }

  // Prepare data object with optional boolean fields
  const data = {
    name: trimmedName,
    materialTypeId,
    imageUrl: imageUrl || materialData.imageUrl || null,
  };

  // Add color only if it's provided
  if (trimmedColor !== null) {
    data.color = trimmedColor;
  }

  // Add size only if it's provided
  if (trimmedSize !== null) {
    data.size = trimmedSize;
  }

  // Add unitOfMeasureId if provided
  if (unitOfMeasureId) {
    data.unitOfMeasureId = unitOfMeasureId;
  }

  // Add optional boolean fields if provided using proper parsing
  const booleanFields = [
    'plainMDF',
    'laminatedMDF',
    'wood',
    'metal',
    'accessory',
    'other',
  ];
  booleanFields.forEach((field) => {
    const value = materialData[field];
    if (value !== undefined && value !== null && value !== '') {
      const parsedValue = parseBoolean(value);
      if (parsedValue !== undefined) {
        data[field] = parsedValue;
        console.log(`Setting ${field}:`, parsedValue);
      }
    }
  });

  console.log('Final data object to save:', JSON.stringify(data, null, 2));

  try {
    // Create material
    const material = await prisma.material.create({
      data,
      include: {
        materialType: {
          select: {
            id: true,
            name: true,
          },
        },
        unitOfMeasure: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    console.log('Material created successfully:', material.id);
    return material;
  } catch (dbError) {
    console.error('Database error details:', {
      code: dbError.code,
      message: dbError.message,
      meta: dbError.meta,
      stack: dbError.stack,
    });

    // Check for specific Prisma errors
    if (dbError.code === 'P2002') {
      throw new ApiError(
        httpStatus.CONFLICT,
        'A material with these details already exists',
      );
    } else if (dbError.code === 'P2003') {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid reference ID provided',
      );
    } else if (dbError.code === 'P2011') {
      // Null constraint violation
      console.error(
        'Null constraint violation. Check if required fields are missing.',
      );
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Required field is missing: ${
          dbError.meta?.target_column || 'unknown'
        }`,
      );
    } else {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Database error: ${dbError.message}`,
      );
    }
  }
};
// Update Material with image
const updateMaterial = async (id, updateBody, files) => {
  // DEBUG: Log raw boolean values from update body
  if (updateBody.plainMDF !== undefined) {
    if (typeof updateBody.plainMDF === 'string') {
      console.log(
        '  - Boolean() on this string:',
        Boolean(updateBody.plainMDF),
      );
      console.log(
        '  - parseBoolean() on this string:',
        parseBoolean(updateBody.plainMDF),
      );
    }
  }
  if (updateBody.laminatedMDF !== undefined) {
    if (typeof updateBody.laminatedMDF === 'string') {
    }
  }
  if (updateBody.wood !== undefined) {
    console.log(
      'updateBody.wood - value:',
      updateBody.wood,
      '| type:',
      typeof updateBody.wood,
    );
    if (typeof updateBody.wood === 'string') {
      console.log('  - Boolean() on this string:', Boolean(updateBody.wood));
      console.log(
        '  - parseBoolean() on this string:',
        parseBoolean(updateBody.wood),
      );
    }
  }
  if (updateBody.metal !== undefined) {
    console.log(
      'updateBody.metal - value:',
      updateBody.metal,
      '| type:',
      typeof updateBody.metal,
    );
    if (typeof updateBody.metal === 'string') {
      console.log('  - Boolean() on this string:', Boolean(updateBody.metal));
      console.log(
        '  - parseBoolean() on this string:',
        parseBoolean(updateBody.metal),
      );
    }
  }
  // ✅ Add accessory and other debug logs
  if (updateBody.accessory !== undefined) {
    console.log(
      'updateBody.accessory - value:',
      updateBody.accessory,
      '| type:',
      typeof updateBody.accessory,
    );
    if (typeof updateBody.accessory === 'string') {
      console.log(
        '  - Boolean() on this string:',
        Boolean(updateBody.accessory),
      );
      console.log(
        '  - parseBoolean() on this string:',
        parseBoolean(updateBody.accessory),
      );
    }
  }
  if (updateBody.other !== undefined) {
    console.log(
      'updateBody.other - value:',
      updateBody.other,
      '| type:',
      typeof updateBody.other,
    );
    if (typeof updateBody.other === 'string') {
      console.log('  - Boolean() on this string:', Boolean(updateBody.other));
      console.log(
        '  - parseBoolean() on this string:',
        parseBoolean(updateBody.other),
      );
    }
  }

  // Check if material exists
  const existingMaterial = await prisma.material.findUnique({
    where: { id },
    include: {
      materialType: {
        select: {
          id: true,
          name: true,
        },
      },
      unitOfMeasure: {
        // ✅ Include unitOfMeasure in existing material
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!existingMaterial) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Material not found');
  }

  // Handle image upload if new image is provided
  let { imageUrl } = existingMaterial;
  const imageFile = Array.isArray(files?.image) ? files.image[0] : files?.image;

  if (imageFile) {
    try {
      imageUrl = await uploadImage(imageFile, 'material_images');
    } catch (err) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Material image processing failed',
      );
    }
  }

  // Clean update body and handle boolean conversions properly
  const cleanedUpdateBody = {};

  for (const [key, value] of Object.entries(updateBody)) {
    if (value !== undefined && value !== null && value !== '') {
      const cleanKey = key.replace(/[^a-zA-Z0-9]/g, '');

      // Handle boolean fields with proper parsing
      if (
        [
          'plainMDF',
          'laminatedMDF',
          'wood',
          'metal',
          'accessory',
          'other',
        ].includes(cleanKey)
      ) {
        console.log(`  This is a boolean field`);
        console.log(
          `  Before parseBoolean conversion:`,
          value,
          `(${typeof value})`,
        );

        // Show why string "false" becomes true with Boolean()
        if (typeof value === 'string' && value.toLowerCase() === 'false') {
          console.log(
            `  ⚠️ WARNING: String "${value}" becomes ${Boolean(
              value,
            )} with Boolean() but ${parseBoolean(value)} with parseBoolean()`,
          );
          console.log(
            `  Boolean("false") = true because any non-empty string is truthy`,
          );
          console.log(
            `  parseBoolean("false") = false because it specifically checks for "false" string`,
          );
        }

        const parsedValue = parseBoolean(value);
        if (parsedValue !== undefined) {
          cleanedUpdateBody[cleanKey] = parsedValue;
        } else {
          console.log(`  Skipping ${cleanKey} - invalid boolean value`);
        }
      }
      // ✅ Handle unitOfMeasureId field
      else if (cleanKey === 'unitOfMeasureId') {
        // Validate unitOfMeasureId if provided
        if (value) {
          const unitOfMeasure = await prisma.unitOfMeasure.findUnique({
            where: { id: value },
          });

          if (!unitOfMeasure) {
            throw new ApiError(
              httpStatus.BAD_REQUEST,
              'Unit of measure not found',
            );
          }
        }

        cleanedUpdateBody[cleanKey] = value;
      } else if (typeof value === 'string') {
        cleanedUpdateBody[cleanKey] = value.trim();
      } else {
        cleanedUpdateBody[cleanKey] = value;
      }
    } else {
      console.log(`  Skipping ${key} (value is ${value})`);
    }
    console.log('---');
  }

  // Add imageUrl to update body
  if (imageUrl !== existingMaterial.imageUrl) {
    cleanedUpdateBody.imageUrl = imageUrl;
  }

  // Validate fields if provided
  if (
    cleanedUpdateBody.name !== undefined &&
    cleanedUpdateBody.name.length === 0
  ) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Material name cannot be empty');
  }

  if (
    cleanedUpdateBody.color !== undefined &&
    cleanedUpdateBody.color.length === 0
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Material color cannot be empty',
    );
  }

  if (
    cleanedUpdateBody.size !== undefined &&
    cleanedUpdateBody.size.length === 0
  ) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Material size cannot be empty');
  }

  // Check if material category exists if being updated
  if (cleanedUpdateBody.materialTypeId) {
    const materialCategory = await prisma.materialCategory.findUnique({
      where: { id: cleanedUpdateBody.materialTypeId },
    });

    if (!materialCategory) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Material category not found');
    }
  }

  // Check for duplicates if name, color, size, or category is being updated
  if (
    cleanedUpdateBody.name ||
    cleanedUpdateBody.color ||
    cleanedUpdateBody.size ||
    cleanedUpdateBody.materialTypeId
  ) {
    const nameToCheck = cleanedUpdateBody.name || existingMaterial.name;
    const colorToCheck = cleanedUpdateBody.color || existingMaterial.color;
    const sizeToCheck = cleanedUpdateBody.size || existingMaterial.size;
    const categoryToCheck =
      cleanedUpdateBody.materialTypeId || existingMaterial.materialTypeId;

    const duplicateMaterial = await prisma.material.findFirst({
      where: {
        name: nameToCheck,
        color: colorToCheck,
        size: sizeToCheck,
        materialTypeId: categoryToCheck,
        id: { not: id }, // Exclude current material from duplicate check
      },
    });

    if (duplicateMaterial) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Another material already exists with the same name, color, and size in this category',
      );
    }
  }
  // Update material
  const updatedMaterial = await prisma.material.update({
    where: { id },
    data: cleanedUpdateBody,
    include: {
      materialType: {
        select: {
          id: true,
          name: true,
        },
      },
      unitOfMeasure: {
        // ✅ Include unitOfMeasure in response
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return updatedMaterial;
};

// Delete Material
const deleteMaterial = async (id) => {
  // Check if material exists
  const existingMaterial = await prisma.material.findUnique({
    where: { id },
    include: {
      items: {
        select: { id: true },
      },
    },
  });

  if (!existingMaterial) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Material not found');
  }

  // Prevent delete if material is used in proforma items
  if (existingMaterial.items && existingMaterial.items.length > 0) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'Cannot delete material because it is used in proforma invoice items',
    );
  }

  // Note: You might want to delete the associated image file here
  // if (existingMaterial.imageUrl) {
  //   await deleteImageFile(existingMaterial.imageUrl);
  // }

  // Delete material
  await prisma.material.delete({
    where: { id },
  });

  return { message: 'Material deleted successfully' };
};

// Get All Materials
const getAllMaterials = async () => {
  const materials = await prisma.material.findMany({
    include: {
      materialType: {
        select: {
          id: true,
          name: true,
        },
      },
      unitOfMeasure: {
        select: {
          id: true,
          name: true,
          symbol: true,
        },
      },
      inventoryStocks: {
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
    orderBy: { createdAt: 'desc' },
  });

  // Get all stores and showrooms for complete listing
  const [allStores, allShowrooms] = await Promise.all([
    prisma.store.findMany({
      select: {
        id: true,
        name: true,
        isMain: true,
      },
      orderBy: {
        name: 'asc',
      },
    }),
    prisma.showroom.findMany({
      select: {
        id: true,
        name: true,
        isMain: true,
      },
      orderBy: {
        name: 'asc',
      },
    }),
  ]);

  // Transform the data to include detailed stock information
  const materialsWithStock = materials.map((material) => {
    // Group stocks by store
    const storeStocks = {};
    // Group stocks by showroom
    const showroomStocks = {};
    // Group stocks by status
    const stockByStatus = {};

    // Process each stock record
    material.inventoryStocks?.forEach((stock) => {
      // Store grouping
      if (stock.storeId && stock.store) {
        if (!storeStocks[stock.storeId]) {
          storeStocks[stock.storeId] = {
            quantity: 0,
            storeId: stock.store.id,
            storeName: stock.store.name,
            isMain: stock.store.isMain,
          };
        }
        storeStocks[stock.storeId].quantity += stock.quantity;
      }

      // Showroom grouping
      if (stock.showroomId && stock.showroom) {
        if (!showroomStocks[stock.showroomId]) {
          showroomStocks[stock.showroomId] = {
            quantity: 0,
            showroomId: stock.showroom.id,
            showroomName: stock.showroom.name,
            isMain: stock.showroom.isMain,
          };
        }
        showroomStocks[stock.showroomId].quantity += stock.quantity;
      }

      // Status grouping
      const { status } = stock;
      if (!stockByStatus[status]) {
        stockByStatus[status] = 0;
      }
      stockByStatus[status] += stock.quantity || 0;
    });

    // Calculate totals
    const totalStoreQuantity = Object.values(storeStocks).reduce(
      (sum, s) => sum + s.quantity,
      0,
    );
    const totalShowroomQuantity = Object.values(showroomStocks).reduce(
      (sum, s) => sum + s.quantity,
      0,
    );
    const totalQuantity = totalStoreQuantity + totalShowroomQuantity;

    // Create complete arrays with all stores/showrooms (including those with 0 quantity)
    const storesWithStock = allStores.map((store) => ({
      storeId: store.id,
      storeName: store.name,
      isMain: store.isMain,
      quantity: storeStocks[store.id]?.quantity || 0,
    }));

    const showroomsWithStock = allShowrooms.map((showroom) => ({
      showroomId: showroom.id,
      showroomName: showroom.name,
      isMain: showroom.isMain,
      quantity: showroomStocks[showroom.id]?.quantity || 0,
    }));

    // Filter out stores and showrooms with zero quantity (optional)
    const nonZeroStores = storesWithStock.filter((store) => store.quantity > 0);
    const nonZeroShowrooms = showroomsWithStock.filter(
      (showroom) => showroom.quantity > 0,
    );

    return {
      id: material.id,
      name: material.name,
      description: material.description,
      materialType: material.materialType,
      unitOfMeasure: material.unitOfMeasure,
      createdAt: material.createdAt,
      updatedAt: material.updatedAt,
      color: material.color,
      size: material.size,  // This will now be included in the response

      // Boolean fields
      plainMDF: material.plainMDF || false,
      laminatedMDF: material.laminatedMDF || false,
      wood: material.wood || false,
      metal: material.metal || false,
      accessory: material.accessory || false,
      other: material.other || false,
      imageUrl: material.imageUrl || null,
      // Stock details with location breakdown
      stockDetails: {
        // Store breakdown - all stores
        stores: storesWithStock,
        // Store breakdown - only stores with stock
        storesWithStock: nonZeroStores,
        totalStoreQuantity,

        // Showroom breakdown - all showrooms
        showrooms: showroomsWithStock,
        // Showroom breakdown - only showrooms with stock
        showroomsWithStock: nonZeroShowrooms,
        totalShowroomQuantity,

        // Status breakdown
        stockByStatus,

        // Grand total
        totalQuantity,

        // For backward compatibility
        stock: totalQuantity,
      },

      // For backward compatibility
      currentStock: totalQuantity,
      stockByStatus,
    };
  });

  return {
    materials: materialsWithStock,
    count: materials.length,
  };
};

const getMaterialById = async (id) => {
  try {
    console.log('[getMaterialById] Fetching material with ID:', id);

    // Validate ID format
    if (!id || typeof id !== 'string') {
      console.error('[getMaterialById] Invalid ID provided:', id);
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Valid material ID is required',
      );
    }

    const material = await prisma.material.findUnique({
      where: { id },
      include: {
        materialType: {
          select: {
            id: true,
            name: true,
          },
        },
        unitOfMeasure: {
          select: {
            id: true,
            name: true,
            symbol: true,
          },
        },
        inventoryStocks: {
          orderBy: {
            lastUpdated: 'desc',
          },
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
        stockLedgers: {
          take: 20,
          orderBy: {
            movementDate: 'desc',
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
            unit: {
              select: {
                name: true,
                symbol: true,
              },
            },
            store: {
              select: {
                id: true,
                name: true,
              },
            },
            showroom: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        purchaseItems: {
          take: 10,
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            purchase: {
              select: {
                id: true,
                invoiceNo: true,
                purchaseDate: true,
              },
            },
            unitOfMeasure: {
              select: {
                name: true,
              },
            },
          },
        },
        stockCorrectionItems: {
          take: 10,
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            correction: {
              select: {
                id: true,
                shortCode: true,
                reason: true,
                status: true,
                createdAt: true,
              },
            },
          },
        },
        itemMaterials: {
          include: {
            item: {
              select: {
                id: true,
                name: true,
                price: true,
              },
            },
          },
          take: 10,
        },
      },
    });

    if (!material) {
      console.log('[getMaterialById] Material not found for ID:', id);
      throw new ApiError(httpStatus.NOT_FOUND, 'Material not found');
    }

    console.log(
      '[getMaterialById] Successfully fetched material:',
      material.id,
    );

    // Calculate stock summaries with location details
    const stockSummary = {
      totalStock: 0,
      availableStock: 0,
      reservedStock: 0,
      damagedStock: 0,
      expiredStock: 0,
      byStatus: {},
      byLocation: {},
      byStore: {},
      byShowroom: {},
    };

    // Group inventory stocks by status and location
    material.inventoryStocks?.forEach((stock) => {
      // Track by status
      stockSummary.totalStock += stock.quantity;
      stockSummary.byStatus[stock.status] =
        (stockSummary.byStatus[stock.status] || 0) + stock.quantity;

      // Track by location with names
      let locationName = 'unknown';
      if (stock.store) {
        locationName = `store:${stock.store.name}`;
        // Track by store
        stockSummary.byStore[stock.store.name] =
          (stockSummary.byStore[stock.store.name] || 0) + stock.quantity;
      } else if (stock.showroom) {
        locationName = `showroom:${stock.showroom.name}`;
        // Track by showroom
        stockSummary.byShowroom[stock.showroom.name] =
          (stockSummary.byShowroom[stock.showroom.name] || 0) + stock.quantity;
      }

      stockSummary.byLocation[locationName] =
        (stockSummary.byLocation[locationName] || 0) + stock.quantity;

      // Categorize by status
      if (stock.status === 'Available') {
        stockSummary.availableStock += stock.quantity;
      } else if (stock.status === 'Reserved' || stock.status === 'In_Use') {
        stockSummary.reservedStock += stock.quantity;
      } else if (stock.status === 'DAMAGED' || stock.status === 'Broken') {
        stockSummary.damagedStock += stock.quantity;
      } else if (stock.status === 'Expired') {
        stockSummary.expiredStock += stock.quantity;
      }
    });

    console.log('[getMaterialById] Stock summary calculated:', {
      totalStock: stockSummary.totalStock,
      availableStock: stockSummary.availableStock,
      inventoryCount: material.inventoryStocks?.length || 0,
      storesWithStock: Object.keys(stockSummary.byStore).length,
      showroomsWithStock: Object.keys(stockSummary.byShowroom).length,
    });

    // Calculate stock movement summaries with location info
    const movementSummary = {
      totalIn: 0,
      totalOut: 0,
      netChange: 0,
      byType: {},
      byLocation: {},
    };

    material.stockLedgers?.forEach((ledger) => {
      // Track by movement type
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

      // Track by location
      let locationName = 'unknown';
      if (ledger.store) {
        locationName = `store:${ledger.store.name}`;
      } else if (ledger.showroom) {
        locationName = `showroom:${ledger.showroom.name}`;
      }

      movementSummary.byLocation[locationName] =
        (movementSummary.byLocation[locationName] || 0) + ledger.quantity;
    });

    movementSummary.netChange =
      movementSummary.totalIn - movementSummary.totalOut;

    console.log('[getMaterialById] Movement summary calculated:', {
      totalIn: movementSummary.totalIn,
      totalOut: movementSummary.totalOut,
      netChange: movementSummary.netChange,
      movementCount: material.stockLedgers?.length || 0,
    });

    // Enhance inventory stocks with location names for recent inventory
    const enhancedInventory =
      material.inventoryStocks?.slice(0, 5).map((stock) => ({
        ...stock,
        locationName: stock.store?.name || stock.showroom?.name || 'Unknown',
        locationType: stock.store
          ? 'store'
          : stock.showroom
          ? 'showroom'
          : 'unknown',
      })) || [];

    // Remove the raw arrays and return enhanced object
    const {
      inventoryStocks,
      stockLedgers,
      purchaseItems,
      stockCorrectionItems,
      itemMaterials,
      ...materialBase
    } = material;

    const result = {
      ...materialBase,
      stockSummary,
      movementSummary,
      recentInventory: enhancedInventory,
      recentMovements: stockLedgers || [],
      recentPurchases: purchaseItems || [],
      recentCorrections: stockCorrectionItems || [],
      itemUsage:
        itemMaterials?.map((im) => ({
          itemId: im.item.id,
          itemName: im.item.name,
          quantity: im.quantity,
          note: im.note,
        })) || [],
    };

    console.log('[getMaterialById] Successfully processed material data');
    console.log('[getMaterialById] Result summary:', {
      id: result.id,
      name: result.name,
      totalStock: result.stockSummary.totalStock,
      recentMovements: result.recentMovements.length,
      recentPurchases: result.recentPurchases.length,
      locationsWithStock: Object.keys(result.stockSummary.byLocation).length,
    });

    return result;
  } catch (error) {
    console.error('[getMaterialById] Error occurred:', {
      message: error.message,
      stack: error.stack,
      id,
      errorName: error.name,
      errorCode: error.code,
      errorMeta: error.meta,
    });

    // Handle specific Prisma errors
    if (error.code === 'P2023') {
      console.error('[getMaterialById] Invalid ID format:', id);
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid material ID format');
    }

    if (error.code === 'P2001') {
      console.error('[getMaterialById] Record does not exist:', id);
      throw new ApiError(httpStatus.NOT_FOUND, 'Material not found');
    }

    if (error.code === 'P2025') {
      console.error('[getMaterialById] Record not found for operation:', id);
      throw new ApiError(httpStatus.NOT_FOUND, 'Material not found');
    }

    // Handle validation errors
    if (error.name === 'PrismaClientValidationError') {
      console.error(
        '[getMaterialById] Prisma validation error - check your includes:',
        error.message,
      );
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Database query configuration error',
      );
    }

    // Re-throw ApiError as is
    if (error instanceof ApiError) {
      throw error;
    }

    // Log unexpected errors and throw generic error
    console.error('[getMaterialById] Unexpected error:', error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to fetch material details',
    );
  }
};
const getMaterialId = async (id) => {
  const material = await prisma.material.findUnique({
    where: { id },
    include: {
      unitOfMeasure: true,
      materialType: true,
    },
  });

  return material;
};
// Get Materials by Category ID
const getMaterialsByCategoryId = async (categoryId) => {
  // Check if category exists
  const category = await prisma.materialCategory.findUnique({
    where: { id: categoryId },
  });

  if (!category) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Material category not found');
  }

  const materials = await prisma.material.findMany({
    where: { materialTypeId: categoryId },
    include: {
      materialType: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    materials,
    count: materials.length,
  };
};
const getMaterialStockById = async (materialId) => {
  // Check if material exists
  const material = await prisma.material.findUnique({
    where: { id: materialId },
    include: {
      materialType: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!material) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Material not found');
  }

  // Get available stock
  const availableStocks = await prisma.inventoryStock.findMany({
    where: {
      materialId,
      status: 'Available',
    },
    select: {
      quantity: true,
    },
  });

  const totalAvailableStock = availableStocks.reduce(
    (sum, stock) => sum + stock.quantity,
    0,
  );

  return {
    ...material,
    availableStock: totalAvailableStock,
  };
};
async function checkAndUpdatePurchasingStage(tx, invoiceId, userId) {
  // Get all materials for this invoice
  const invoice = await tx.proformaInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: {
        include: {
          proformaItemMaterials: true,
        },
      },
    },
  });

  if (!invoice) {
    console.warn('Invoice not found for checking material status');
    return;
  }

  // Collect all materials from all items
  const allMaterials = [];
  invoice.items.forEach((item) => {
    if (item.proformaItemMaterials && item.proformaItemMaterials.length > 0) {
      allMaterials.push(...item.proformaItemMaterials);
    }
  });

  if (allMaterials.length === 0) {
    return; // No materials to check
  }

  // Check if all materials are issued
  const allIssued = allMaterials.every((material) => {
    const totalRequired =
      (material.quantity || 0) + (material.additionalQuantity || 0);
    const totalGiven = material.givenquantity || 0;
    return totalGiven >= totalRequired && material.status === 'ISSUED';
  });

  if (!allIssued) {
    return; // Not all materials are issued yet
  }

  // Find the purchasing stage for this invoice's project
  const project = await tx.project.findFirst({
    where: { invoiceId },
    include: {
      stages: {
        where: { stage: 'PURCHASING' },
      },
    },
  });

  if (!project || project.stages.length === 0) {
    console.warn('No purchasing stage found for this project');
    return;
  }

  const purchasingStage = project.stages[0];

  // Calculate total work units (sum of all material quantities)
  const totalWorkUnits = allMaterials.reduce((sum, material) => {
    return sum + (material.quantity || 0) + (material.additionalQuantity || 0);
  }, 0);

  // Update the purchasing stage
  await tx.projectStage.update({
    where: { id: purchasingStage.id },
    data: {
      finished: true,
      endDate: new Date(),
      status: 'COMPLETED',
      workUnits: totalWorkUnits,
      actualWorkUnits: totalWorkUnits, // Set actualWorkUnits to match workUnits
    },
  });

  // Create a log entry
  await tx.projectLog.create({
    data: {
      projectId: project.id,
      note: `Purchasing stage completed. All ${allMaterials.length} materials have been issued. Total work units: ${totalWorkUnits}`,
      createdById: userId,
    },
  });

  console.log(`✅ Purchasing stage completed for project ${project.id}`);
}
const updateProformaMaterialStatus = async (
  proformaMaterialId,
  status,
  userId,
  givenToId,
  givenquantity,
  additionalQuantity,
) => {
  try {
    // Define valid status values
    const validStatuses = ['PENDING', 'ISSUED', 'PARTIALLY', 'CANCELLED'];

    // Validate status transition
    if (!validStatuses.includes(status)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid status');
    }

    // Fetch proforma material with required relations
    const proformaMaterial = await prisma.proformaItemMaterial.findUnique({
      where: { id: proformaMaterialId },
      include: {
        material: {
          include: {
            unitOfMeasure: true,
          },
        },
        item: {
          include: {
            invoice: {
              include: {
                customer: true, // ✅ Add this to load customer data
                items: {
                  include: {
                    proformaItemMaterials: true,
                  },
                },
              },
            },
          },
        },
        materialIssues: {
          orderBy: {
            issuedAt: 'desc',
          },
        },
      },
    });
    if (!proformaMaterial) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Proforma material not found');
    }

    // Calculate total quantities from all issues
    const existingTotalGiven = proformaMaterial.materialIssues.reduce(
      (sum, issue) => sum + issue.quantity,
      0,
    );

    const newTotalGiven = (givenquantity || 0) + (additionalQuantity || 0);
    const finalTotalGiven = existingTotalGiven + newTotalGiven;
    const totalRequiredQuantity =
      proformaMaterial.quantity + (proformaMaterial.additionalQuantity || 0);

    // Determine the actual status based on quantities
    let finalStatus = status;

    // Auto-determine status if PARTIALLY is requested
    if (status === 'PARTIALLY') {
      if (finalTotalGiven >= totalRequiredQuantity) {
        finalStatus = 'ISSUED';
      } else if (finalTotalGiven === 0) {
        finalStatus = 'PENDING';
      } else {
        finalStatus = 'PARTIALLY';
      }
    }

    // Validate based on final status
    if (
      (finalStatus === 'ISSUED' || finalStatus === 'PARTIALLY') &&
      !givenToId
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'givenToId is required when issuing material',
      );
    }

    // Validate quantities
    if (
      (finalStatus === 'ISSUED' || finalStatus === 'PARTIALLY') &&
      newTotalGiven <= 0
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Given quantity must be greater than 0',
      );
    }

    if (finalTotalGiven > totalRequiredQuantity) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Total given quantity (${finalTotalGiven}) cannot exceed required quantity (${totalRequiredQuantity})`,
      );
    }

    return await prisma.$transaction(async (tx) => {
      // Handle stock and create material issue record for ISSUE or PARTIALLY
      if (finalStatus === 'ISSUED' || finalStatus === 'PARTIALLY') {
        // Get inventory stock for the user
        const inventoryStock = await tx.inventoryStock.findFirst({
          where: {
            materialId: proformaMaterial.materialId,
          },
        });
        if (!inventoryStock) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            "Material not found in user's stock",
          );
        }

        if (inventoryStock.quantity < newTotalGiven) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            `Insufficient stock. Available: ${inventoryStock.quantity}, Required: ${newTotalGiven}`,
          );
        }

        // Withdraw from stock
        await tx.inventoryStock.update({
          where: { id: inventoryStock.id },
          data: {
            quantity: {
              decrement: newTotalGiven,
            },
            lastUpdated: new Date(),
            updatedAt: new Date(),
          },
        });

        // Get customer name safely
        const customerName = proformaMaterial.item?.invoice?.customer?.name || 
                            proformaMaterial.item?.invoice?.customer?.companyName || 
                            'Unknown Customer';

        // Create stock ledger entry with correct reference
        await tx.stockLedger.create({
          data: {
            materialId: proformaMaterial.materialId,
            movementType: 'OUT',
            quantity: newTotalGiven,
            unitId: proformaMaterial.material.unitOfMeasureId,
            reference: `Proforma-${proformaMaterial.item?.invoice?.piNumber}-Customer-${customerName}`,
            userId,
            notes: `Material issued for proforma invoice ${
              proformaMaterial.item.invoice.piNumber
            }${finalStatus === 'PARTIALLY' ? ' (Partial Issue)' : ''}`,
            movementDate: new Date(),
          },
        });

        // Create material issue record
        await tx.materialIssue.create({
          data: {
            proformaItemMaterialId: proformaMaterialId,
            issuedById: userId,
            givenToId,
            quantity: newTotalGiven,
            note: `Issued ${newTotalGiven} units${
              givenquantity ? ` (Given: ${givenquantity})` : ''
            }${
              additionalQuantity ? ` (Additional: ${additionalQuantity})` : ''
            }`,
            issuedAt: new Date(),
          },
        });

        // Update proforma material with new totals and status
        const updated = await tx.proformaItemMaterial.update({
          where: { id: proformaMaterialId },
          data: {
            status: finalStatus,
            givenquantity: {
              increment: givenquantity || 0,
            },
            additionalQuantity: {
              increment: additionalQuantity || 0,
            },
            updatedAt: new Date(),
          },
          include: {
            material: true,
            materialIssues: {
              include: {
                issuedBy: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
                givenTo: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
              orderBy: {
                issuedAt: 'desc',
              },
            },
          },
        });

        // Check if all materials are issued and update purchasing stage
        await checkAndUpdatePurchasingStage(
          tx,
          proformaMaterial.item.invoice.id,
          userId,
        );

        return updated;
      }

      // Handle CANCELLATION
      if (finalStatus === 'CANCELLED') {
        // Only allow cancellation if material was previously issued or partially issued
        if (
          proformaMaterial.status !== 'ISSUED' &&
          proformaMaterial.status !== 'PARTIALLY'
        ) {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            'Only issued or partially issued materials can be cancelled',
          );
        }

        // Return stock to inventory for all issued quantities
        if (existingTotalGiven > 0) {
          // Get the user who issued the materials (use the first issue's issuedById)
          const firstIssue = proformaMaterial.materialIssues[0];
          const issuedByUserId = firstIssue?.issuedById;

          if (issuedByUserId) {
            const currentStock = await tx.inventoryStock.findFirst({
              where: {
                materialId: proformaMaterial.materialId,
                userId: issuedByUserId,
              },
            });

            if (currentStock) {
              await tx.inventoryStock.update({
                where: { id: currentStock.id },
                data: {
                  quantity: {
                    increment: existingTotalGiven,
                  },
                  lastUpdated: new Date(),
                  updatedAt: new Date(),
                },
              });

              // Get customer name for cancellation reference
              const customerName = proformaMaterial.item?.invoice?.customer?.name || 
                                  proformaMaterial.item?.invoice?.customer?.companyName || 
                                  'Unknown Customer';

              // Create stock ledger entry for return
              await tx.stockLedger.create({
                data: {
                  materialId: proformaMaterial.materialId,
                  movementType: 'IN',
                  quantity: existingTotalGiven,
                  unitId: proformaMaterial.material.unitOfMeasureId,
                  reference: `CANCELLED-Proforma-${proformaMaterial.item.invoice.piNumber}-Customer-${customerName}`,
                  userId: issuedByUserId,
                  notes: `Stock returned due to cancellation of proforma material`,
                  movementDate: new Date(),
                },
              });
            }
          }
        }

        // Update status to cancelled (keep the issue history)
        const updated = await tx.proformaItemMaterial.update({
          where: { id: proformaMaterialId },
          data: {
            status: finalStatus,
            updatedAt: new Date(),
          },
          include: {
            material: true,
            materialIssues: {
              include: {
                issuedBy: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
                givenTo: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
              orderBy: {
                issuedAt: 'desc',
              },
            },
          },
        });

        return updated;
      }

      // Handle RESET TO PENDING
      if (finalStatus === 'PENDING') {
        // Only allow reset to pending if cancelled
        if (proformaMaterial.status !== 'CANCELLED') {
          throw new ApiError(
            httpStatus.BAD_REQUEST,
            'Only cancelled materials can be reset to pending',
          );
        }

        // Delete all material issues
        await tx.materialIssue.deleteMany({
          where: {
            proformaItemMaterialId: proformaMaterialId,
          },
        });

        // Reset to pending with zero quantities
        const updated = await tx.proformaItemMaterial.update({
          where: { id: proformaMaterialId },
          data: {
            status: finalStatus,
            givenquantity: 0,
            additionalQuantity: 0,
            updatedAt: new Date(),
          },
        });

        return updated;
      }

      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid status transition');
    });
  } catch (error) {
    console.error('Error in updateProformaMaterialStatus:', error);

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to update proforma material status',
    );
  }
};

/**
 * Helper function to check if all materials are issued and update purchasing stage
 */
async function checkAndUpdatePurchasingStage(tx, invoiceId, userId) {
  // Get all materials for this invoice with customer info
  const invoice = await tx.proformaInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: true, // ✅ Include customer here too
      items: {
        include: {
          proformaItemMaterials: true,
        },
      },
    },
  });

  if (!invoice) {
    console.warn('Invoice not found for checking material status');
    return;
  }

  // Collect all materials from all items
  const allMaterials = [];
  invoice.items.forEach(item => {
    if (item.proformaItemMaterials && item.proformaItemMaterials.length > 0) {
      allMaterials.push(...item.proformaItemMaterials);
    }
  });

  if (allMaterials.length === 0) {
    return; // No materials to check
  }

  // Check if all materials are issued
  const allIssued = allMaterials.every(material => {
    const totalRequired = (material.quantity || 0) + (material.additionalQuantity || 0);
    const totalGiven = material.givenquantity || 0;
    return totalGiven >= totalRequired && material.status === 'ISSUED';
  });

  if (!allIssued) {
    return; // Not all materials are issued yet
  }

  // Find the purchasing stage for this invoice's project
  const project = await tx.project.findFirst({
    where: { invoiceId: invoiceId },
    include: {
      stages: {
        where: { stage: 'PURCHASING' },
      },
    },
  });

  if (!project || project.stages.length === 0) {
    console.warn('No purchasing stage found for this project');
    return;
  }

  const purchasingStage = project.stages[0];

  // Calculate total work units (sum of all material quantities)
  const totalWorkUnits = allMaterials.reduce((sum, material) => {
    return sum + (material.quantity || 0) + (material.additionalQuantity || 0);
  }, 0);

  // Update the purchasing stage
  await tx.projectStage.update({
    where: { id: purchasingStage.id },
    data: {
      finished: true,
      endDate: new Date(),
      status: 'COMPLETED',
      workUnits: totalWorkUnits,
      actualWorkUnits: totalWorkUnits,
      timeTaken: Math.ceil(
        (new Date().getTime() - new Date(purchasingStage.startDate).getTime()) /
        (1000 * 60 * 60 * 24)
      ),
    },
  });

  // Create a log entry
  await tx.projectLog.create({
    data: {
      projectId: project.id,
      note: `Purchasing stage completed. All ${allMaterials.length} materials have been issued. Total work units: ${totalWorkUnits}`,
      createdById: userId,
    },
  });

 
    await tx.project.update({
      where: { id: project.id },
      data: {
        updatedAt: new Date(),
      },
    });

 
  

  console.log(`✅ Purchasing stage completed for project ${project.id}`);
}



/**
 * Helper function to check if all materials are issued and update purchasing stage
 */


const acceptInitialStock = async (materialId, initialQuantity, userId) => {
  try {
    // Validate required parameters
    if (!materialId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Material ID is required');
    }

    if (!initialQuantity || initialQuantity < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Initial quantity must be greater than 0',
      );
    }

    // Get default store (main store)
    const defaultStore = await prisma.store.findFirst({
      where: { isMain: true },
    });

    if (!defaultStore) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Default store not found');
    }

    // Check if material exists
    const material = await prisma.material.findUnique({
      where: { id: materialId },
      include: {
        unitOfMeasure: true,
      },
    });

    if (!material) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Material not found');
    }

    // Check if initial stock already exists for this material in default store
    const existingLedgerEntries = await prisma.stockLedger.count({
      where: {
        materialId,
        storeId: defaultStore.id,
        movementType: 'IN',
        notes: {
          contains: 'Initial stock setup',
        },
      },
    });

    if (existingLedgerEntries > 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Initial stock already set for this material in default store',
      );
    }

    // Use transaction to ensure data consistency
    const result = await prisma.$transaction(async (tx) => {
      // Check if inventory stock exists
      const existingInventoryStock = await tx.inventoryStock.findFirst({
        where: {
          materialId,
          storeId: defaultStore.id,
        },
      });

      let inventoryStock;
      if (existingInventoryStock) {
        // Update existing inventory stock
        inventoryStock = await tx.inventoryStock.update({
          where: { id: existingInventoryStock.id },
          data: {
            quantity: { increment: initialQuantity },
            status: 'Available',
            lastUpdated: new Date(),
          },
        });
      } else {
        // Create new inventory stock
        inventoryStock = await tx.inventoryStock.create({
          data: {
            materialId,
            storeId: defaultStore.id,
            quantity: initialQuantity,
            status: 'Available',
          },
        });
      }

      // Create stock ledger entry
      const stockLedger = await tx.stockLedger.create({
        data: {
          materialId,
          movementType: 'IN',
          quantity: initialQuantity,
          unitId: material.unitOfMeasureId,
          reference: `INITIAL-${Date.now()}`,
          storeId: defaultStore.id,
          userId,
          notes: `Initial stock setup for ${material.name} - ${initialQuantity} units`,
          movementDate: new Date(),
        },
      });

      return {
        material,
        store: defaultStore,
        inventoryStock,
        stockLedger,
        message: `Initial stock of ${initialQuantity} units set for ${material.name} in default store`,
      };
    });

    return result;
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
  acceptInitialStock,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  getAllMaterials,
  getMaterialById,
  getMaterialsByCategoryId,
  getMaterialStockById,
  updateProformaMaterialStatus,
  getMaterialId,
};
