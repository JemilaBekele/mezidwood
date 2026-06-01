/* eslint-disable no-underscore-dangle */
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');
const { uploadImage } = require('../utils/upload.util');

// Get Product by ID
const getProductById = async (id) => {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: true,
      unitOfMeasure: true,
      AdditionalPrice: {
        // ✅ Include additional prices
        include: {
          shop: true,
        },
      },
    },
  });
  return product;
};
const getAllProducts = async (userId) => {
  // First, get the user with their accessible shops and stores
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      shops: {
        select: { id: true },
      },
      stores: {
        select: { id: true },
      },
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Get only the shops and stores the user has access to
  const accessibleShopIds = user.shops.map((shop) => shop.id);
  const accessibleStoreIds = user.stores.map((store) => store.id);

  // Get shops and stores the user can access with branch information
  const [shops, stores] = await Promise.all([
    prisma.shop.findMany({
      where: {
        id: { in: accessibleShopIds },
      },
      select: {
        id: true,
        name: true,
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.store.findMany({
      where: {
        id: { in: accessibleStoreIds },
      },
      select: {
        id: true,
        name: true,
        branch: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
  ]);

  // Create maps for shop and store names including branch info
  const shopMap = Object.fromEntries(shops.map((shop) => [shop.id, shop.name]));
  const storeMap = Object.fromEntries(
    stores.map((store) => [store.id, store.name]),
  );

  // Get all products with their stock information including variants
  const products = await prisma.product.findMany({
    orderBy: {
      name: 'asc',
    },
    include: {
      category: true,
      unitOfMeasure: true,
      colour: true,
      AdditionalPrice: {
        include: {
          shop: true,
        },
      },
      // Include shop stocks with their variants
      shopStocks: {
        where: {
          status: 'Available',
          shopId: { in: accessibleShopIds },
        },
        include: {
          shop: {
            select: { id: true, name: true },
          },
          variants: true, // Include variants for dimension-based items
        },
      },
      // Include store stocks with their variants
      storeStocks: {
        where: {
          status: 'Available',
          storeId: { in: accessibleStoreIds },
        },
        include: {
          store: {
            select: { id: true, name: true },
          },
          variants: true, // Include variants for dimension-based items
        },
      },
    },
  });

  // DEBUG: Log raw product data to see what's coming from the database
  products.forEach((product) => {
    // Check shop stocks with variants
    if (product.shopStocks && product.shopStocks.length > 0) {
      product.shopStocks.forEach((stock) => {
        stock.variants?.forEach((variant, vIdx) => {
          console.log(
            `        Variant ${vIdx + 1}: ${variant.height}x${
              variant.width
            } - Qty: ${variant.quantity}`,
          );
        });
      });
    } else {
      console.log('  No shop stocks');
    }

    // Check store stocks with variants
    if (product.storeStocks && product.storeStocks.length > 0) {
      product.storeStocks.forEach((stock) => {
        stock.variants?.forEach((variant, vIdx) => {
          console.log(
            `        Variant ${vIdx + 1}: ${variant.height}x${
              variant.width
            } - Qty: ${variant.quantity}`,
          );
        });
      });
    } else {
      console.log('  No store stocks');
    }
  });

  // Calculate detailed stock information for each product
  const productsWithDetailedStock = products.map((product) => {
    // Structures for quantity-based stocks (no variants)
    const shopStocks = {};
    const storeStocks = {};

    // Structures for dimension-based stocks (with variants)
    const shopDimensionStocks = {};
    const storeDimensionStocks = {};

    let totalShopStock = 0;
    let totalStoreStock = 0;

    // Totals for dimension-based stocks (count of pieces)
    let totalShopDimensionPieces = 0;
    let totalStoreDimensionPieces = 0;

    // Totals for dimension-based stocks (sum of height*width for area calculations)
    let totalShopDimensionArea = 0;
    let totalStoreDimensionArea = 0;

    // Initialize accessible shops with 0 quantity
    shops.forEach((shop) => {
      shopStocks[shop.name] = 0;
      shopDimensionStocks[shop.name] = {
        pieces: 0,
        dimensions: [], // Array of { height, width, quantity }
        totalArea: 0,
      };
    });

    // Initialize accessible stores with 0 quantity
    stores.forEach((store) => {
      storeStocks[store.name] = 0;
      storeDimensionStocks[store.name] = {
        pieces: 0,
        dimensions: [], // Array of { height, width, quantity }
        totalArea: 0,
      };
    });

    // DEBUG: Track stock processing

    // Process shop stocks
    product.shopStocks.forEach((shopStock) => {
      const shopName = shopMap[shopStock.shopId] || shopStock.shop?.name;

      if (shopName) {
        // Check if this stock has variants (dimension-based)
        if (shopStock.variants && shopStock.variants.length > 0) {
          // Process each variant
          shopStock.variants.forEach((variant) => {
            const area = variant.height * variant.width;
            // Initialize if this shop doesn't exist in dimension stocks yet
            if (!shopDimensionStocks[shopName]) {
              shopDimensionStocks[shopName] = {
                pieces: 0,
                dimensions: [],
                totalArea: 0,
              };
            }

            // Update dimension stocks for this shop
            shopDimensionStocks[shopName].pieces += variant.quantity;
            shopDimensionStocks[shopName].totalArea += area * variant.quantity;

            // Add to dimensions array
            shopDimensionStocks[shopName].dimensions.push({
              height: variant.height,
              width: variant.width,
              quantity: variant.quantity,
              area,
            });

            totalShopDimensionPieces += variant.quantity;
            totalShopDimensionArea += area * variant.quantity;
          });
        } else {
          // Quantity-based stock - use the main quantity field
          if (!shopStocks[shopName]) {
            shopStocks[shopName] = 0;
          }
          shopStocks[shopName] += shopStock.quantity || 0;
          totalShopStock += shopStock.quantity || 0;
        }
      } else {
        console.log(`⚠️ Shop not found for ID: ${shopStock.shopId}`);
      }
    });

    // Process store stocks
    product.storeStocks.forEach((storeStock) => {
      const storeName = storeMap[storeStock.storeId] || storeStock.store?.name;

      if (storeName) {
        // Check if this stock has variants (dimension-based)
        if (storeStock.variants && storeStock.variants.length > 0) {
          // Process each variant
          storeStock.variants.forEach((variant) => {
            const area = variant.height * variant.width;

            // Initialize if this store doesn't exist in dimension stocks yet
            if (!storeDimensionStocks[storeName]) {
              storeDimensionStocks[storeName] = {
                pieces: 0,
                dimensions: [],
                totalArea: 0,
              };
            }

            // Update dimension stocks for this store
            storeDimensionStocks[storeName].pieces += variant.quantity;
            storeDimensionStocks[storeName].totalArea +=
              area * variant.quantity;

            // Add to dimensions array
            storeDimensionStocks[storeName].dimensions.push({
              height: variant.height,
              width: variant.width,
              quantity: variant.quantity,
              area,
            });

            totalStoreDimensionPieces += variant.quantity;
            totalStoreDimensionArea += area * variant.quantity;
          });
        } else {
          // Quantity-based stock - use the main quantity field
          if (!storeStocks[storeName]) {
            storeStocks[storeName] = 0;
          }
          storeStocks[storeName] += storeStock.quantity || 0;
          totalStoreStock += storeStock.quantity || 0;
        }
      } else {
        console.log(`⚠️ Store not found for ID: ${storeStock.storeId}`);
      }
    });

    // Log dimension details
    Object.entries(shopDimensionStocks).forEach(([shopName, dimInfo]) => {
      if (dimInfo.pieces > 0) {
        console.log(
          `  Shop ${shopName}: ${dimInfo.pieces} pieces, area: ${dimInfo.totalArea}`,
        );
        console.log(`    Dimensions:`, dimInfo.dimensions);
      }
    });

    Object.entries(storeDimensionStocks).forEach(([storeName, dimInfo]) => {
      if (dimInfo.pieces > 0) {
        console.log(
          `  Store ${storeName}: ${dimInfo.pieces} pieces, area: ${dimInfo.totalArea}`,
        );
        console.log(`    Dimensions:`, dimInfo.dimensions);
      }
    });

    // Convert shopStocks to include branch info
    const shopStocksWithBranch = {};
    Object.entries(shopStocks).forEach(([shopName, quantity]) => {
      const shop =
        shops.find((s) => s.name === shopName) ||
        product.shopStocks.find((s) => s.shop?.name === shopName)?.shop;
      shopStocksWithBranch[shopName] = {
        quantity,
        branchId: shop?.branch?.id,
        branchName: shop?.branch?.name,
      };
    });

    // Convert storeStocks to include branch info
    const storeStocksWithBranch = {};
    Object.entries(storeStocks).forEach(([storeName, quantity]) => {
      const store =
        stores.find((s) => s.name === storeName) ||
        product.storeStocks.find((s) => s.store?.name === storeName)?.store;
      storeStocksWithBranch[storeName] = {
        quantity,
        branchId: store?.branch?.id,
        branchName: store?.branch?.name,
      };
    });

    // Convert shop dimension stocks to include branch info
    const shopDimensionStocksWithBranch = {};
    Object.entries(shopDimensionStocks).forEach(([shopName, dimInfo]) => {
      const shop =
        shops.find((s) => s.name === shopName) ||
        product.shopStocks.find((s) => s.shop?.name === shopName)?.shop;
      shopDimensionStocksWithBranch[shopName] = {
        ...dimInfo,
        branchId: shop?.branch?.id,
        branchName: shop?.branch?.name,
      };
    });

    // Convert store dimension stocks to include branch info
    const storeDimensionStocksWithBranch = {};
    Object.entries(storeDimensionStocks).forEach(([storeName, dimInfo]) => {
      const store =
        stores.find((s) => s.name === storeName) ||
        product.storeStocks.find((s) => s.store?.name === storeName)?.store;
      storeDimensionStocksWithBranch[storeName] = {
        ...dimInfo,
        branchId: store?.branch?.id,
        branchName: store?.branch?.name,
      };
    });

    const totalStock = totalShopStock + totalStoreStock;
    const totalDimensionPieces =
      totalShopDimensionPieces + totalStoreDimensionPieces;
    const totalDimensionArea = totalShopDimensionArea + totalStoreDimensionArea;

    return {
      ...product,
      stockSummary: {
        // Regular quantity-based stocks
        shopStocks: shopStocksWithBranch,
        storeStocks: storeStocksWithBranch,
        totalShopStock,
        totalStoreStock,
        totalStock,

        // Dimension-based stocks
        shopDimensionStocks: shopDimensionStocksWithBranch,
        storeDimensionStocks: storeDimensionStocksWithBranch,
        totalShopDimensionPieces,
        totalStoreDimensionPieces,
        totalDimensionPieces,
        totalShopDimensionArea,
        totalStoreDimensionArea,
        totalDimensionArea,

        // Combined totals
        totalAllItems: totalStock + totalDimensionPieces,
        hasDimensionStock: totalDimensionPieces > 0,
        hasQuantityStock: totalStock > 0,
      },
    };
  });

  // DEBUG: Overall summary
  productsWithDetailedStock.forEach((product) => {
    console.log(
      `${product.name}: Qty: ${product.stockSummary.totalStock}, Dim: ${product.stockSummary.totalDimensionPieces}, Total: ${product.stockSummary.totalAllItems}`,
    );
  });

  // Calculate overall totals across all products
  const overallTotals = productsWithDetailedStock.reduce(
    (totals, product) => {
      // Calculate shop-wise totals for quantity-based stocks
      const shopTotals = { ...totals.shopTotals };
      Object.entries(product.stockSummary.shopStocks).forEach(
        ([shopName, stockInfo]) => {
          shopTotals[shopName] =
            (shopTotals[shopName] || 0) + stockInfo.quantity;
        },
      );

      // Calculate store-wise totals for quantity-based stocks
      const storeTotals = { ...totals.storeTotals };
      Object.entries(product.stockSummary.storeStocks).forEach(
        ([storeName, stockInfo]) => {
          storeTotals[storeName] =
            (storeTotals[storeName] || 0) + stockInfo.quantity;
        },
      );

      // Calculate shop-wise totals for dimension-based stocks (pieces)
      const shopDimensionTotals = { ...totals.shopDimensionTotals };
      Object.entries(product.stockSummary.shopDimensionStocks).forEach(
        ([shopName, dimensionInfo]) => {
          shopDimensionTotals[shopName] =
            (shopDimensionTotals[shopName] || 0) + dimensionInfo.pieces;
        },
      );

      // Calculate store-wise totals for dimension-based stocks (pieces)
      const storeDimensionTotals = { ...totals.storeDimensionTotals };
      Object.entries(product.stockSummary.storeDimensionStocks).forEach(
        ([storeName, dimensionInfo]) => {
          storeDimensionTotals[storeName] =
            (storeDimensionTotals[storeName] || 0) + dimensionInfo.pieces;
        },
      );

      // Calculate shop-wise totals for dimension-based stocks (area)
      const shopDimensionAreaTotals = { ...totals.shopDimensionAreaTotals };
      Object.entries(product.stockSummary.shopDimensionStocks).forEach(
        ([shopName, dimensionInfo]) => {
          shopDimensionAreaTotals[shopName] =
            (shopDimensionAreaTotals[shopName] || 0) + dimensionInfo.totalArea;
        },
      );

      // Calculate store-wise totals for dimension-based stocks (area)
      const storeDimensionAreaTotals = { ...totals.storeDimensionAreaTotals };
      Object.entries(product.stockSummary.storeDimensionStocks).forEach(
        ([storeName, dimensionInfo]) => {
          storeDimensionAreaTotals[storeName] =
            (storeDimensionAreaTotals[storeName] || 0) +
            dimensionInfo.totalArea;
        },
      );

      return {
        totalShopStock:
          totals.totalShopStock + product.stockSummary.totalShopStock,
        totalStoreStock:
          totals.totalStoreStock + product.stockSummary.totalStoreStock,
        totalAllStock: totals.totalAllStock + product.stockSummary.totalStock,

        totalShopDimensionPieces:
          totals.totalShopDimensionPieces +
          product.stockSummary.totalShopDimensionPieces,
        totalStoreDimensionPieces:
          totals.totalStoreDimensionPieces +
          product.stockSummary.totalStoreDimensionPieces,
        totalAllDimensionPieces:
          totals.totalAllDimensionPieces +
          product.stockSummary.totalDimensionPieces,

        totalShopDimensionArea:
          totals.totalShopDimensionArea +
          product.stockSummary.totalShopDimensionArea,
        totalStoreDimensionArea:
          totals.totalStoreDimensionArea +
          product.stockSummary.totalStoreDimensionArea,
        totalAllDimensionArea:
          totals.totalAllDimensionArea +
          product.stockSummary.totalDimensionArea,

        shopTotals,
        storeTotals,
        shopDimensionTotals,
        storeDimensionTotals,
        shopDimensionAreaTotals,
        storeDimensionAreaTotals,
      };
    },
    {
      totalShopStock: 0,
      totalStoreStock: 0,
      totalAllStock: 0,

      totalShopDimensionPieces: 0,
      totalStoreDimensionPieces: 0,
      totalAllDimensionPieces: 0,

      totalShopDimensionArea: 0,
      totalStoreDimensionArea: 0,
      totalAllDimensionArea: 0,

      shopTotals: Object.fromEntries(shops.map((shop) => [shop.name, 0])),
      storeTotals: Object.fromEntries(stores.map((store) => [store.name, 0])),

      shopDimensionTotals: Object.fromEntries(
        shops.map((shop) => [shop.name, 0]),
      ),
      storeDimensionTotals: Object.fromEntries(
        stores.map((store) => [store.name, 0]),
      ),

      shopDimensionAreaTotals: Object.fromEntries(
        shops.map((shop) => [shop.name, 0]),
      ),
      storeDimensionAreaTotals: Object.fromEntries(
        stores.map((store) => [store.name, 0]),
      ),
    },
  );

  // Add overallTotals to each product
  const productsWithTotals = productsWithDetailedStock.map((product) => ({
    ...product,
    overallTotals,
  }));

  return {
    products: productsWithTotals,
    count: products.length,
  };
};

const getActiveAllProducts = async (filter = {}, includeInactive = false) => {
  const whereClause = includeInactive ? filter : { ...filter, isActive: true };

  const products = await prisma.product.findMany({
    where: whereClause,
    orderBy: { name: 'asc' },
    include: {
      category: true,
      unitOfMeasure: true,
    },
  });

  return {
    products,
    count: products.length,
  };
};

// Get Product by Product Code
const getProductByCode = async (productCode) => {
  const product = await prisma.product.findFirst({
    where: { productCode },
  });
  return product;
};

const getBatchesByProduct = async (productId) => {
  const batches = await prisma.productBatch.findMany({
    where: {
      productId, // Filter by the provided productId
    },
    orderBy: [
      { expiryDate: 'asc' }, // Sort by expiry date (earliest first)
      { batchNumber: 'asc' },
    ],
    include: {
      product: true,
      store: true,
    },
  });
  return {
    batches,
    count: batches.length,
  };
};

const parseFormData = (data) => {
  const parsed = { ...data };

  // Boolean fields
  if (parsed.isActive !== undefined) {
    parsed.isActive = parsed.isActive === 'true' || parsed.isActive === true;
  }

  // Number fields
  if (
    parsed.sellPrice !== undefined &&
    parsed.sellPrice !== null &&
    parsed.sellPrice !== ''
  ) {
    parsed.sellPrice = parseFloat(parsed.sellPrice);
  } else if (parsed.sellPrice === '') {
    parsed.sellPrice = null;
  }

  return parsed;
};
const generateUniqueProductCode = async () => {
  const prefix = 'PROD'; // You can customize this prefix
  const maxAttempts = 10;
  let productCode;

  // Generate multiple codes at once and check them in a single query
  const codeAttempts = Array.from({ length: maxAttempts }, () => {
    const randomNumber = Math.floor(10000 + Math.random() * 90000); // 5-digit random number
    return `${prefix}-${randomNumber}`;
  });

  // Check all codes at once
  const existingProducts = await Promise.all(
    codeAttempts.map((code) => getProductByCode(code)),
  );

  // Find the first unique code
  const uniqueCodeIndex = existingProducts.findIndex((product) => !product);

  if (uniqueCodeIndex !== -1) {
    productCode = codeAttempts[uniqueCodeIndex];
  } else {
    // Fallback: use timestamp for uniqueness
    const timestamp = Date.now();
    productCode = `${prefix}-${timestamp}`;
  }

  return productCode;
};
const getProductByName = async (productName) => {
  if (!productName || productName.trim() === '') {
    return null;
  }

  return prisma.product.findFirst({
    where: {
      name: {
        equals: productName,
      },
    },
  });
};
const createProduct = async (productBody, files) => {
  // Generate product code if not provided
  let { productCode } = productBody;
  const { name } = productBody;

  if (!productCode || productCode.trim() === '') {
    productCode = await generateUniqueProductCode();
  }

  // Check if product with same code already exists
  const existingByCode = await getProductByCode(productCode);

  if (existingByCode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Product code already taken');
  }

  const existingByName = await getProductByName(name);

  if (existingByName) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Product name already exists');
  }

  const parsedData = parseFormData(productBody);
  parsedData.productCode = productCode; // Add generated code to parsed data

  let imageUrl = null;

  // Process the product image if provided
  const imageFile = Array.isArray(files?.image) ? files.image[0] : files?.image;

  if (imageFile) {
    try {
      imageUrl = await uploadImage(imageFile, 'product_images');
    } catch (err) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Product image processing failed',
      );
    }
  }

  const { additionalPrices, ...productData } = parsedData;
  // Handle optional foreign keys - if empty string, set to null
  if (productData.colourId === '') {
    productData.colourId = null;
  }
  if (productData.curtainTypeId === '') {
    productData.curtainTypeId = null;
  }

  // Verify colourId exists if provided
  if (productData.colourId && productData.colourId !== null) {
    const colourExists = await prisma.colour.findUnique({
      where: { id: productData.colourId },
    });
    if (!colourExists) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid colour ID');
    }
  }

  // Verify curtainTypeId exists if provided
  if (productData.curtainTypeId && productData.curtainTypeId !== null) {
    const curtainTypeExists = await prisma.curtainType.findUnique({
      where: { id: productData.curtainTypeId },
    });
    if (!curtainTypeExists) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid curtain type ID');
    }
  }

  console.log('Boolean conversion - Before:');
  console.log(
    'thickCurtain:',
    productData.thickCurtain,
    typeof productData.thickCurtain,
  );
  console.log(
    'thinCurtain:',
    productData.thinCurtain,
    typeof productData.thinCurtain,
  );
  console.log(
    'pullsCurtain:',
    productData.pullsCurtain,
    typeof productData.pullsCurtain,
  );

  // Helper function to properly convert to boolean
  const toBoolean = (value) => {
    if (value === undefined || value === null) return false;

    if (typeof value === 'boolean') return value;

    if (typeof value === 'string') {
      // Handle string values - "true" or "1" become true, "false" or "0" become false
      const lowerValue = value.toLowerCase().trim();
      return lowerValue === 'true' || lowerValue === '1';
    }

    if (typeof value === 'number') {
      return value !== 0;
    }

    return Boolean(value);
  };

  // Apply proper boolean conversion to all boolean fields
  const booleanFields = [
    'thickCurtain',
    'thinCurtain',
    'pullsCurtain',
    'poleCurtain',
    'bracketsCurtain',
    'shatterVertical',
    'pricePerMeter',
    'isActive',
  ];

  booleanFields.forEach((field) => {
    if (productData[field] !== undefined) {
      productData[field] = toBoolean(productData[field]);
    }
  });

  // Set defaults for optional boolean fields if not provided
  if (productData.pricePerMeter === undefined) {
    productData.pricePerMeter = true; // Default from schema
  }
  if (productData.isActive === undefined) {
    productData.isActive = true; // Default from schema
  }
  if (productData.thickCurtain === undefined) {
    productData.thickCurtain = false; // Default from schema
  }
  if (productData.thinCurtain === undefined) {
    productData.thinCurtain = false; // Default from schema
  }
  if (productData.pullsCurtain === undefined) {
    productData.pullsCurtain = false; // Default from schema
  }
  if (productData.poleCurtain === undefined) {
    productData.poleCurtain = false; // Default from schema
  }
  if (productData.bracketsCurtain === undefined) {
    productData.bracketsCurtain = false; // Default from schema
  }
  if (productData.shatterVertical === undefined) {
    productData.shatterVertical = false; // Default from schema
  }

  if (
    productData.sellPrice !== undefined &&
    productData.sellPrice !== null &&
    productData.sellPrice !== ''
  ) {
    const sellPriceNum = parseFloat(productData.sellPrice);
    productData.sellPrice = Number.isNaN(sellPriceNum) ? null : sellPriceNum;
  } else {
    productData.sellPrice = null;
  }

  // Convert warningQuantity to integer
  if (
    productData.warningQuantity !== undefined &&
    productData.warningQuantity !== null &&
    productData.warningQuantity !== ''
  ) {
    const warningQuantityInt = parseInt(productData.warningQuantity, 10);
    productData.warningQuantity = Number.isNaN(warningQuantityInt)
      ? 0
      : warningQuantityInt;
  } else {
    productData.warningQuantity = 0; // Default from schema
  }

  // Handle image URL - use uploaded image or provided URL
  let finalImageUrl = imageUrl || productData.imageUrl || '';

  // If it's a full URL, extract just the path part
  if (finalImageUrl && finalImageUrl.startsWith('http')) {
    try {
      const urlObj = new URL(finalImageUrl);
      finalImageUrl = urlObj.pathname.replace('/uploads/', 'uploads/');
    } catch (err) {
      console.log('Invalid URL, using as-is:', finalImageUrl);
    }
  }
  try {
    const product = await prisma.product.create({
      data: {
        ...productData,
        imageUrl: finalImageUrl,
        AdditionalPrice:
          additionalPrices && additionalPrices.length > 0
            ? {
                create: additionalPrices.map((price) => ({
                  label: price.label,
                  price: parseFloat(price.price) || 0,
                  shopId: price.shopId || null,
                })),
              }
            : undefined,
      },
      include: {
        unitOfMeasure: true,
        colour: true,
        category: true,
        curtainType: true,
        AdditionalPrice: true,
      },
    });

    // Log the creation action
    await prisma.log.create({
      data: {
        action: `Created product: ${product.name} (${product.productCode})`,
        userId: productBody.userId || null,
      },
    });

    return product;
  } catch (error) {
    if (error.code === 'P2002') {
      console.error('ERROR: Unique constraint violation');
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Product with this code or name already exists',
      );
    }

    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to create product: ${error.message}`,
    );
  }
};
const updateProduct = async (id, updateBody, files) => {
  const existingProduct = await getProductById(id);

  if (!existingProduct) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  }

  // Check if product code is being updated to an existing product code
  if (
    updateBody.productCode &&
    updateBody.productCode !== existingProduct.productCode
  ) {
    const productWithSameCode = await getProductByCode(updateBody.productCode);
    if (productWithSameCode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Product code already taken');
    }
  }

  // Check if product name is being updated to an existing name (excluding current product)
  if (updateBody.name && updateBody.name !== existingProduct.name) {
    const existingProductWithSameName = await prisma.product.findFirst({
      where: {
        name: updateBody.name,
        id: { not: id },
      },
    });
    if (existingProductWithSameName) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Product name already exists');
    }
  }

  const parsedData = parseFormData(updateBody);

  let { imageUrl } = existingProduct;

  // Process the product image if provided
  const imageFile = Array.isArray(files?.image) ? files.image[0] : files?.image;

  if (imageFile) {
    try {
      imageUrl = await uploadImage(imageFile, 'product_images');
    } catch (err) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Product image processing failed',
      );
    }
  }

  const { additionalPrices, ...productData } = parsedData;
  if (productData.colourId === '') {
    productData.colourId = null;
  }
  if (productData.curtainTypeId === '') {
    productData.curtainTypeId = null;
  }

  // If colourId is provided, verify it exists
  if (productData.colourId && productData.colourId !== null) {
    const colourExists = await prisma.colour.findUnique({
      where: { id: productData.colourId },
    });

    if (!colourExists) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid colour ID');
    }
  }

  // If curtainTypeId is provided, verify it exists
  if (productData.curtainTypeId && productData.curtainTypeId !== null) {
    const curtainTypeExists = await prisma.curtainType.findUnique({
      where: { id: productData.curtainTypeId },
    });

    if (!curtainTypeExists) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid curtain type ID');
    }
  }

  // Helper function to properly convert to boolean
  const toBoolean = (value) => {
    if (value === undefined || value === null) return false;

    if (typeof value === 'boolean') return value;

    if (typeof value === 'string') {
      // Handle string values - "true" or "1" become true, "false" or "0" become false
      const lowerValue = value.toLowerCase().trim();
      return lowerValue === 'true' || lowerValue === '1';
    }

    if (typeof value === 'number') {
      return value !== 0;
    }

    return Boolean(value);
  };

  // Apply proper boolean conversion to all boolean fields
  const booleanFields = [
    'thickCurtain',
    'thinCurtain',
    'pullsCurtain',
    'poleCurtain',
    'bracketsCurtain',
    'shatterVertical',
    'pricePerMeter',
    'isActive',
  ];

  booleanFields.forEach((field) => {
    if (productData[field] !== undefined) {
      productData[field] = toBoolean(productData[field]);
    }
  });
  if (productData.sellPrice !== undefined && productData.sellPrice !== null) {
    const sellPriceNum = parseFloat(productData.sellPrice);
    productData.sellPrice = Number.isNaN(sellPriceNum) ? null : sellPriceNum;
  }

  if (
    productData.warningQuantity !== undefined &&
    productData.warningQuantity !== null
  ) {
    const warningQuantityInt = parseInt(productData.warningQuantity, 10);
    productData.warningQuantity = Number.isNaN(warningQuantityInt)
      ? 0
      : warningQuantityInt;
  }

  // Handle image URL format - extract path if it's a full URL
  let finalImageUrl = imageUrl;
  if (productData.imageUrl && productData.imageUrl.startsWith('http')) {
    // Extract just the path part from the full URL
    const urlObj = new URL(productData.imageUrl);
    finalImageUrl = urlObj.pathname.replace('/uploads/', 'uploads/');
  } else if (productData.imageUrl) {
    finalImageUrl = productData.imageUrl;
  }

  // Prepare the update data
  const updateData = {
    ...productData,
    imageUrl: finalImageUrl,
  };

  // Remove the imageUrl from productData if we already used it
  delete updateData.imageUrlFromData;

  if (additionalPrices !== undefined) {
    // First, delete existing additional prices for this product
    await prisma.additionalPrice.deleteMany({
      where: { productId: id },
    });

    // Then create new ones if provided
    if (additionalPrices && additionalPrices.length > 0) {
      updateData.AdditionalPrice = {
        create: additionalPrices.map((price) => ({
          label: price.label,
          price: parseFloat(price.price),
          shopId: price.shopId || null,
        })),
      };
    } else {
      console.log('Additional prices array is empty or null');
    }
  } else {
    console.log('Additional prices not provided, skipping update');
  }

  // Use transaction to ensure all updates are atomic
  try {
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: updateData,
        include: {
          category: true,
          colour: true,
          curtainType: true,
          unitOfMeasure: true,
          AdditionalPrice: {
            include: {
              shop: true,
            },
          },
        },
      });

      // Log the update action
      await tx.log.create({
        data: {
          action: `Updated product: ${product.name} (${product.productCode})`,
          userId: updateBody.userId || null,
        },
      });

      return product;
    });

    console.log('=== UPDATE PRODUCT SUCCESS ===');
    return result;
  } catch (error) {
    console.error('Transaction error:', error);
    

    // Re-throw the error with more context
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Update failed: ${error.message}`,
    );
  }
};
const generateUniqueReferenceNumber = async (prefix) => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `${prefix}-${timestamp}${random}`;
};

const createProductStock = async (productId, stocksData, userId) => {
  try {
    // stocksData can be an array or single object
    const stocks = Array.isArray(stocksData) ? stocksData : [stocksData];

    // Validate all stocks first
    const validationErrors = [];

    stocks.forEach((stockData, index) => {
      const { quantity, storeId, height, width } = stockData;

      if (!productId) {
        validationErrors.push(`Stock ${index + 1}: Product ID is required`);
      }

      if (!storeId) {
        validationErrors.push(`Stock ${index + 1}: Store ID is required`);
      }

      // Validate based on whether it's dimension-based or quantity-based
      if (height !== undefined || width !== undefined) {
        // Dimension-based validation
        if (!height || height <= 0) {
          validationErrors.push(
            `Stock ${
              index + 1
            }: Positive height is required for dimension-based stock`,
          );
        }
        if (!width || width <= 0) {
          validationErrors.push(
            `Stock ${
              index + 1
            }: Positive width is required for dimension-based stock`,
          );
        }
        // For dimension-based items, quantity represents number of pieces with these dimensions
        if (!quantity || quantity <= 0) {
          validationErrors.push(
            `Stock ${
              index + 1
            }: Positive quantity is required for dimension-based stock (number of pieces)`,
          );
        }
      } else {
        // Quantity-based validation
        if (!quantity || quantity <= 0) {
          validationErrors.push(
            `Stock ${
              index + 1
            }: Positive quantity is required for piece-based stock`,
          );
        }
      }
    });

    if (validationErrors.length > 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, validationErrors.join('; '));
    }

    // Get all unique store IDs for batch fetching
    const storeIds = [...new Set(stocks.map((stock) => stock.storeId))];

    // Fetch product and related data once
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        unitOfMeasure: true,
        category: true,
        colour: true,
      },
    });

    if (!product) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
    }

    // Verify the product's unit of measure exists
    const { unitOfMeasureId } = product;

    if (!unitOfMeasureId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Product does not have a valid unit of measure',
      );
    }

    const unitOfMeasure = await prisma.unitOfMeasure.findUnique({
      where: { id: unitOfMeasureId },
    });

    if (!unitOfMeasure) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid unit of measure for this product',
      );
    }

    // Fetch all stores in one query
    const stores = await prisma.store.findMany({
      where: { id: { in: storeIds } },
      include: { branch: true },
    });

    // Create a map for quick store lookup
    const storeMap = Object.fromEntries(
      stores.map((store) => [store.id, store]),
    );

    // Check if all stores exist
    const missingStoreIds = storeIds.filter((id) => !storeMap[id]);

    if (missingStoreIds.length > 0) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        `Stores not found: ${missingStoreIds.join(', ')}`,
      );
    }

    // Prepare results array
    const results = await Promise.all(
      stocks.map(async (stockData, index) => {
        const { quantity, storeId, notes, height, width } = stockData;
        const store = storeMap[storeId];

        try {
          // Generate reference number for each stock
          const reference = await generateUniqueReferenceNumber('STK-INIT');

          // Use transaction for each stock entry
          const result = await prisma.$transaction(async (tx) => {
            // Handle dimension-based stock (has height and width)
            if (height !== undefined && width !== undefined) {
              // First, find or create the main store stock record
              // Due to unique constraint on [storeId, productId], there's only one main record per store/product
              const mainStoreStock = await tx.storeStock.upsert({
                where: {
                  storeId_productId: {
                    storeId,
                    productId,
                  },
                },
                create: {
                  storeId,
                  productId,
                  quantity: 0, // Start with 0, will be updated through variants
                  unitOfMeasureId,
                  status: 'Available',
                },
                update: {}, // Don't update anything on conflict
              });

              // Now handle the variant
              // Check if variant with these dimensions already exists
              const existingVariant = await tx.storeProductVariant.findFirst({
                where: {
                  storeStockId: mainStoreStock.id,
                  height,
                  width,
                },
              });

              let variantRecord;

              if (existingVariant) {
                // Update existing variant - increment quantity
                variantRecord = await tx.storeProductVariant.update({
                  where: { id: existingVariant.id },
                  data: {
                    quantity: {
                      increment: quantity,
                    },
                  },
                });
              } else {
                // Create new variant
                variantRecord = await tx.storeProductVariant.create({
                  data: {
                    storeStockId: mainStoreStock.id,
                    height,
                    width,
                    quantity,
                  },
                });
              }

              // Update the total quantity in the main store stock
              // Recalculate total quantity from all variants
              const allVariants = await tx.storeProductVariant.findMany({
                where: {
                  storeStockId: mainStoreStock.id,
                },
              });

              const totalQuantity = allVariants.reduce(
                (sum, variant) => sum + variant.quantity,
                0,
              );

              await tx.storeStock.update({
                where: { id: mainStoreStock.id },
                data: {
                  quantity: totalQuantity,
                  updatedAt: new Date(),
                },
              });

              // Get the updated store stock with variants
              const stockRecord = await tx.storeStock.findUnique({
                where: { id: mainStoreStock.id },
                include: {
                  product: {
                    include: {
                      unitOfMeasure: true,
                      category: true,
                      colour: true,
                    },
                  },
                  store: {
                    include: {
                      branch: true,
                    },
                  },
                  unitOfMeasure: true,
                  variants: true,
                },
              });

              // Create stock ledger entry for dimension-based item
              const stockLedger = await tx.stockLedger.create({
                data: {
                  productId,
                  movementType: 'IN',
                  height,
                  width,
                  quantity, // Number of pieces added
                  unitOfMeasureId,
                  reference,
                  userId,
                  notes:
                    notes ||
                    `Initial stock insertion: Added ${quantity} piece(s) (${height}x${width}) for product ${product.productCode}`,
                  movementDate: new Date(),
                  storeId,
                },
                include: {
                  product: {
                    include: {
                      unitOfMeasure: true,
                    },
                  },
                  store: {
                    include: {
                      branch: true,
                    },
                  },
                  unitOfMeasure: true,
                  user: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                    },
                  },
                },
              });

              // Create log entry
              await tx.log.create({
                data: {
                  action: `Initial stock insertion: Added ${quantity} piece(s) (${height}x${width}) of ${product.name} (${product.productCode}) to store ${store.name}`,
                  userId,
                },
              });

              return {
                stockRecord,
                stockLedger,
                product,
                store,
                reference,
                dimensions: { height, width },
                variant: variantRecord,
              };
            }

            // Quantity-based stock (no height/width - regular inventory)
            // Set default quantity to 0 if not provided
            const stockQuantity = quantity || 0;

            // For quantity-based items, we don't create variants
            const stockRecord = await tx.storeStock.upsert({
              where: {
                storeId_productId: {
                  storeId,
                  productId,
                },
              },
              create: {
                storeId,
                productId,
                quantity: stockQuantity,
                unitOfMeasureId,
                status: 'Available',
              },
              update: {
                quantity: {
                  increment: stockQuantity,
                },
                updatedAt: new Date(),
              },
              include: {
                product: {
                  include: {
                    unitOfMeasure: true,
                    category: true,
                    colour: true,
                  },
                },
                store: {
                  include: {
                    branch: true,
                  },
                },
                unitOfMeasure: true,
              },
            });

            // Create stock ledger entry for quantity-based item
            const stockLedger = await tx.stockLedger.create({
              data: {
                productId,
                movementType: 'IN',
                quantity: stockQuantity,
                unitOfMeasureId,
                reference,
                userId,
                notes:
                  notes ||
                  `Initial stock insertion for product ${product.productCode}`,
                movementDate: new Date(),
                storeId,
              },
              include: {
                product: {
                  include: {
                    unitOfMeasure: true,
                  },
                },
                store: {
                  include: {
                    branch: true,
                  },
                },
                unitOfMeasure: true,
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            });

            // Create log entry - handle zero quantity case
            const actionMessage =
              stockQuantity > 0
                ? `Initial stock insertion: Added ${stockQuantity} ${
                    unitOfMeasure.name || unitOfMeasure.symbol || 'units'
                  } of ${product.name} (${product.productCode}) to store ${
                    store.name
                  }`
                : `Initial stock record created with 0 quantity for ${product.name} (${product.productCode}) at store ${store.name}`;

            await tx.log.create({
              data: {
                action: actionMessage,
                userId,
              },
            });

            return {
              stockRecord,
              stockLedger,
              product,
              store,
              reference,
            };
          });

          const quantityMsg =
            height && width
              ? `${quantity} piece(s) (${height}x${width})`
              : `${quantity || 0} units`;

          return {
            message: `Successfully added initial stock of ${quantityMsg} for ${product.name} to store ${store.name}`,
            reference: result.reference,
            stockRecord: result.stockRecord,
            stockLedger: result.stockLedger,
            product: result.product,
            store: result.store,
            ...(result.variant && { variant: result.variant }),
          };
        } catch (error) {
          console.error(`Error processing stock ${index + 1}:`, error);
          throw error;
        }
      }),
    );

    return results;
  } catch (error) {
    console.error('Error stack:', error.stack);
    throw error;
  }
};

const deleteProduct = async (id) => {
  const existingProduct = await getProductById(id);
  if (!existingProduct) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  }

  // First delete related records
  await prisma.additionalPrice.deleteMany({
    where: { productId: id },
  });

  await prisma.productBatch.deleteMany({
    where: { productId: id },
  });

  // Then delete the product
  await prisma.product.delete({
    where: { id },
  });

  return { message: 'Product deleted successfully' };
};
const getProductBatchByBatchNumber = async (batchNumber) => {
  const batch = await prisma.productBatch.findFirst({
    where: {
      batchNumber,
    },
  });
  return !!batch;
};
const createProductBatchsingle = async (productBatchBody) => {
  // Check if product batch with same batch number already exists
  if (await getProductBatchByBatchNumber(productBatchBody.batchNumber)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Batch number already exists');
  }

  // Optional: Validate that the product exists
  const product = await prisma.product.findUnique({
    where: {
      id: productBatchBody.productId,
    },
  });

  if (!product) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Product does not exist');
  }

  // Format the expiryDate if provided
  const formattedData = {
    ...productBatchBody,
    expiryDate: productBatchBody.expiryDate
      ? new Date(productBatchBody.expiryDate).toISOString()
      : undefined,
  };

  const productBatch = await prisma.productBatch.create({
    data: formattedData,
  });

  return productBatch;
};
const getProductDetails = async (productId, userId) => {
  try {
    // Get the user's accessible shops and stores
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        shops: { select: { id: true } },
        stores: { select: { id: true } },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const accessibleShopIds = user.shops.map((shop) => shop.id);
    const accessibleStoreIds = user.stores.map((store) => store.id);

    // If user has no shops or stores, return empty arrays
    if (accessibleShopIds.length === 0 && accessibleStoreIds.length === 0) {
      throw new Error('User has no shop or store access');
    }

    // Get the product with related data including variants
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        colour: {
          select: {
            id: true,
            name: true,
          },
        },
        unitOfMeasure: true,
        AdditionalPrice: {
          where: {
            OR: [
              { shopId: null }, // Global additional prices
              { shopId: { in: accessibleShopIds } }, // Shop-specific prices
            ],
          },
          include: {
            shop: {
              include: {
                branch: true,
              },
            },
          },
        },
        // Include shop stocks with their variants
        shopStocks: {
          where: {
            status: 'Available',
            shopId: { in: accessibleShopIds },
          },
          include: {
            shop: {
              include: {
                branch: true,
              },
            },
            unitOfMeasure: true,
            variants: true, // Include variants for shop stocks
          },
        },
        // Include store stocks with their variants
        storeStocks: {
          where: {
            status: 'Available',
            storeId: { in: accessibleStoreIds },
          },
          include: {
            store: {
              include: {
                branch: true,
              },
            },
            unitOfMeasure: true,
            variants: true, // Include variants for store stocks
          },
        },
      },
    });

    if (!product) {
      throw new Error('Product not found');
    }

    // Get additional prices
    const additionalPrices = await prisma.additionalPrice.findMany({
      where: {
        productId,
        OR: [
          { shopId: null }, // Global additional prices
          { shopId: { in: accessibleShopIds } }, // Shop-specific prices
        ],
      },
      include: {
        shop: {
          include: {
            branch: true,
          },
        },
      },
    });

    // Get stock ledger entries for this product (filtered by accessible shops/stores)
    const stockLedgers = await prisma.stockLedger.findMany({
      where: {
        productId,
        OR: [
          { storeId: { in: accessibleStoreIds } },
          { shopId: { in: accessibleShopIds } },
        ],
      },
      include: {
        unitOfMeasure: true,
        store: {
          include: {
            branch: true,
          },
        },
        shop: {
          include: {
            branch: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        movementDate: 'desc',
      },
    });

    // Process shop stocks with variants
    const processedShopStocks = product.shopStocks.map((stock) => ({
      id: stock.id,
      shopId: stock.shopId,
      shopName: stock.shop?.name,
      branchId: stock.shop?.branch?.id,
      branchName: stock.shop?.branch?.name,
      quantity: stock.quantity || 0,
      totalQuantity:
        stock.variants.reduce((sum, v) => sum + v.quantity, 0) ||
        stock.quantity ||
        0,
      status: stock.status,
      unitOfMeasure: stock.unitOfMeasure,
      variants: stock.variants.map((variant) => ({
        id: variant.id,
        height: variant.height,
        width: variant.width,
        quantity: variant.quantity,
        dimensions: `${variant.height}x${variant.width}`,
      })),
      // Group variants by dimensions for easy lookup
      variantsByDimensions: stock.variants.reduce((acc, variant) => {
        const key = `${variant.height}x${variant.width}`;
        acc[key] = {
          id: variant.id,
          height: variant.height,
          width: variant.width,
          quantity: variant.quantity,
        };
        return acc;
      }, {}),
    }));

    // Process store stocks with variants
    const processedStoreStocks = product.storeStocks.map((stock) => ({
      id: stock.id,
      storeId: stock.storeId,
      storeName: stock.store?.name,
      branchId: stock.store?.branch?.id,
      branchName: stock.store?.branch?.name,
      quantity: stock.quantity || 0,
      totalQuantity:
        stock.variants.reduce((sum, v) => sum + v.quantity, 0) ||
        stock.quantity ||
        0,
      status: stock.status,
      unitOfMeasure: stock.unitOfMeasure,
      variants: stock.variants.map((variant) => ({
        id: variant.id,
        height: variant.height,
        width: variant.width,
        quantity: variant.quantity,
        dimensions: `${variant.height}x${variant.width}`,
      })),
      // Group variants by dimensions for easy lookup
      variantsByDimensions: stock.variants.reduce((acc, variant) => {
        const key = `${variant.height}x${variant.width}`;
        acc[key] = {
          id: variant.id,
          height: variant.height,
          width: variant.width,
          quantity: variant.quantity,
        };
        return acc;
      }, {}),
    }));

    // Calculate total quantities with variant support
    const storeStockDetails = [];
    const shopStockDetails = [];

    // Process store stocks for location details
    for (const storeId of accessibleStoreIds) {
      const storeStocks = product.storeStocks.filter(
        (s) => s.storeId === storeId,
      );

      if (storeStocks.length > 0) {
        const { store } = storeStocks[0];

        // Calculate total quantity including variants
        let totalQuantity = 0;
        const variantsByDimensions = {};

        storeStocks.forEach((stock) => {
          totalQuantity += stock.quantity || 0;

          // Aggregate variants
          stock.variants.forEach((variant) => {
            const key = `${variant.height}x${variant.width}`;
            if (!variantsByDimensions[key]) {
              variantsByDimensions[key] = {
                height: variant.height,
                width: variant.width,
                quantity: 0,
              };
            }
            variantsByDimensions[key].quantity += variant.quantity;
          });
        });

        storeStockDetails.push({
          storeId,
          storeName: store?.name || 'Unknown Store',
          branchId: store?.branch?.id,
          branchName: store?.branch?.name,
          quantity: totalQuantity,
          variants: Object.values(variantsByDimensions),
          type: 'store',
          additionalPrice: null,
        });
      }
    }

    // Process shop stocks for location details
    for (const shopId of accessibleShopIds) {
      const shopStocks = product.shopStocks.filter((s) => s.shopId === shopId);

      if (shopStocks.length > 0) {
        const { shop } = shopStocks[0];

        // Calculate total quantity including variants
        let totalQuantity = 0;
        const variantsByDimensions = {};

        shopStocks.forEach((stock) => {
          totalQuantity += stock.quantity || 0;

          // Aggregate variants
          stock.variants.forEach((variant) => {
            const key = `${variant.height}x${variant.width}`;
            if (!variantsByDimensions[key]) {
              variantsByDimensions[key] = {
                height: variant.height,
                width: variant.width,
                quantity: 0,
              };
            }
            variantsByDimensions[key].quantity += variant.quantity;
          });
        });

        // Find additional price for this shop
        const additionalPrice = additionalPrices.find(
          (price) => price.shopId === shopId,
        );
        // Find global additional price (shopId = null)
        const globalAdditionalPrice = additionalPrices.find(
          (price) => price.shopId === null,
        );

        shopStockDetails.push({
          shopId,
          shopName: shop?.name || 'Unknown Shop',
          branchId: shop?.branch?.id,
          branchName: shop?.branch?.name,
          quantity: totalQuantity,
          variants: Object.values(variantsByDimensions),
          type: 'shop',
          additionalPrice: additionalPrice || globalAdditionalPrice,
        });
      }
    }

    // Process additional prices (filtered by accessible shops)
    const processedAdditionalPrices = product.AdditionalPrice.filter(
      (price) => !price.shopId || accessibleShopIds.includes(price.shopId),
    ).map((price) => ({
      id: price.id,
      label: price.label,
      price: price.price,
      shopId: price.shopId,
      shopName: price.shop?.name,
      branchId: price.shop?.branch?.id,
      branchName: price.shop?.branch?.name,
    }));

    // Process stock ledger entries with dimension support
    const processedStockLedgers = stockLedgers.map((ledger) => ({
      id: ledger.id,
      invoiceNo: ledger.invoiceNo,
      movementType: ledger.movementType,
      quantity: ledger.quantity,
      height: ledger.height,
      width: ledger.width,
      dimensions:
        ledger.height && ledger.width
          ? `${ledger.height}x${ledger.width}`
          : null,
      unitOfMeasure: ledger.unitOfMeasure,
      reference: ledger.reference,
      userId: ledger.userId,
      user: ledger.user,
      store:
        ledger.store && accessibleStoreIds.includes(ledger.store.id)
          ? {
              id: ledger.store.id,
              name: ledger.store.name,
              branch: ledger.store.branch,
            }
          : null,
      shop:
        ledger.shop && accessibleShopIds.includes(ledger.shop.id)
          ? {
              id: ledger.shop.id,
              name: ledger.shop.name,
              branch: ledger.shop.branch,
            }
          : null,
      notes: ledger.notes,
      movementDate: ledger.movementDate,
      createdAt: ledger.createdAt,
      updatedAt: ledger.updatedAt,
    }));

    // Calculate total quantities (only from accessible locations)
    const totalStoreQuantity = storeStockDetails.reduce(
      (total, store) => total + store.quantity,
      0,
    );
    const totalShopQuantity = shopStockDetails.reduce(
      (total, shop) => total + shop.quantity,
      0,
    );
    const overallTotalQuantity = totalStoreQuantity + totalShopQuantity;

    // Get unique dimensions across all stocks
    const allDimensions = new Set();
    [...processedStoreStocks, ...processedShopStocks].forEach((stock) => {
      stock.variants.forEach((variant) => {
        allDimensions.add(variant.dimensions);
      });
    });
    const uniqueDimensions = Array.from(allDimensions).sort();

    return {
      product: {
        id: product.id,
        productCode: product.productCode,
        name: product.name,
        generic: product.generic,
        description: product.description,
        sellPrice: product.sellPrice,
        warningQuantity: product.warningQuantity,
        imageUrl: product.imageUrl,
        category: product.category,
        colour: product.colour,
        unitOfMeasure: product.unitOfMeasure,
        isActive: product.isActive,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      },
      stocks: {
        shopStocks: processedShopStocks,
        storeStocks: processedStoreStocks,
      },
      additionalPrices: processedAdditionalPrices,
      stockLedgers: processedStockLedgers,
      locationStocks: [...storeStockDetails, ...shopStockDetails],
      dimensions: {
        uniqueDimensions,
        totalDimensionCount: uniqueDimensions.length,
      },
      summary: {
        totalStoreQuantity,
        totalShopQuantity,
        overallTotalQuantity,
        storeCount: storeStockDetails.length,
        shopCount: shopStockDetails.length,
        ledgerCount: processedStockLedgers.length,
        additionalPriceCount: processedAdditionalPrices.length,
        variantCount: uniqueDimensions.length,
      },
    };
  } catch (error) {
    console.error('Error in getProductDetails:', error);
    throw error;
  }
};
const getProductBatchesByShops = async (productId) => {
  // Get all available shop stocks for the product
  const shopStocks = await prisma.shopStock.findMany({
    where: {
      batch: {
        productId,
      },
      status: 'Available',
      quantity: {
        gt: 0,
      },
    },
    include: {
      shop: {
        include: {
          branch: true,
        },
      },
      batch: {
        include: {
          product: {
            include: {
              AdditionalPrice: {
                where: {
                  OR: [
                    { shopId: null }, // Global additional prices
                    { shopId: { not: null } }, // Shop-specific additional prices
                  ],
                },
              },
            },
          },
        },
      },
    },
  });

  if (!shopStocks || shopStocks.length === 0) {
    throw new Error('No available stock found for this product in any shop');
  }

  // Get all pending/approved sells that affect stock availability
  const pendingSells = await prisma.sell.findMany({
    where: {
      items: {
        some: {
          productId,
        },
      },
      saleStatus: {
        in: ['APPROVED', 'PARTIALLY_DELIVERED'], // Only consider approved and partially delivered sells
      },
    },
    include: {
      items: {
        where: {
          productId,
          itemSaleStatus: 'PENDING', // Only consider pending items (not yet delivered)
        },
        include: {
          shop: true,
        },
      },
    },
  });

  // Calculate reserved quantities by shop
  const reservedQuantitiesByShop = new Map();

  pendingSells.forEach((sell) => {
    sell.items.forEach((item) => {
      if (item.productId === productId && item.itemSaleStatus === 'PENDING') {
        const currentReserved = reservedQuantitiesByShop.get(item.shopId) || 0;
        reservedQuantitiesByShop.set(
          item.shopId,
          currentReserved + item.quantity,
        );
      }
    });
  });

  // Aggregate quantities by shop and collect additional prices
  const shopsMap = new Map();
  let totalAvailableQuantity = 0;

  shopStocks.forEach((stock) => {
    const reservedQuantity = reservedQuantitiesByShop.get(stock.shopId) || 0;
    const netAvailableQuantity = Math.max(0, stock.quantity - reservedQuantity);

    totalAvailableQuantity += netAvailableQuantity;

    if (shopsMap.has(stock.shop.id)) {
      const existingShop = shopsMap.get(stock.shop.id);
      existingShop.quantity += netAvailableQuantity;
    } else {
      // Get base product price
      const basePrice = stock.batch.product.sellPrice;

      // Filter additional prices for this specific shop
      const shopAdditionalPrices = stock.batch.product.AdditionalPrice.filter(
        (ap) => ap.shopId === null || ap.shopId === stock.shop.id,
      );

      // Calculate total price (base + sum of additional prices)
      let totalPrice = null;
      if (basePrice) {
        const base = parseFloat(basePrice.toString());
        const additionalTotal = shopAdditionalPrices.reduce(
          (sum, ap) => sum + ap.price,
          0,
        );
        totalPrice = base + additionalTotal;
      }

      shopsMap.set(stock.shop.id, {
        shopId: stock.shop.id,
        shopName: stock.shop.name,
        branchName: stock.shop.branch?.name,
        quantity: netAvailableQuantity, // Only net available quantity
        basePrice,
        additionalPrices: shopAdditionalPrices.map((ap) => ({
          id: ap.id,
          label: ap.label,
          price: ap.price,
          isGlobal: ap.shopId === null,
        })),
        totalPrice,
      });
    }
  });

  return {
    totalAvailableQuantity,
    shops: Array.from(shopsMap.values()),
    hasStock: totalAvailableQuantity > 0,
  };
};

const getRandomProductsWithShopStocks = async (userId = null) => {
  // Get user's accessible shops if userId is provided
  let userAccessibleShopIds = [];

  if (userId) {
    const userWithShops = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        shops: {
          select: { id: true },
        },
      },
    });
    userAccessibleShopIds = userWithShops?.shops.map((shop) => shop.id) || [];
  }

  // Build the shop filter condition
  const shopFilterCondition = userId
    ? {
        shopId:
          userAccessibleShopIds.length > 0
            ? { in: userAccessibleShopIds }
            : { in: [] }, // Empty array returns no results
      }
    : {}; // No user ID = show all shops

  // Get random products that have batches in shops with available stock
  const productsWithShopStocks = await prisma.product.findMany({
    where: {
      isActive: true,
      batches: {
        some: {
          ShopStock: {
            some: {
              quantity: { gt: 0 },
              ...shopFilterCondition,
            },
          },
        },
      },
    },
    include: {
      category: true,
      unitOfMeasure: true,
      AdditionalPrice: {
        include: {
          shop: {
            include: {
              branch: true,
            },
          },
        },
      },
      batches: {
        where: {
          ShopStock: {
            some: {
              quantity: { gt: 0 },
              ...shopFilterCondition,
            },
          },
        },
        select: {
          ShopStock: {
            where: {
              quantity: { gt: 0 },
              ...shopFilterCondition,
            },
            select: {
              quantity: true,
              shop: {
                include: {
                  branch: true,
                },
              },
              unitOfMeasure: true,
            },
          },
        },
      },
    },
    take: 20,
  });

  // Format the response...
  const formattedProducts = productsWithShopStocks.map((product) => {
    // Calculate total available quantity across all batches and shops
    // Filter additional prices based on user shop access
    const additionalPrices = product.AdditionalPrice.filter(
      (price) =>
        !userId || // No user = show all
        (userAccessibleShopIds.length > 0 &&
          userAccessibleShopIds.includes(price.shopId)), // User with shops = only assigned shops
      // If userAccessibleShopIds is empty, no additional prices will be shown
    ).map((price) => ({
      id: price.id,
      label: price.label,
      price: price.price,
      shopId: price.shopId,
      shop: price.shop
        ? {
            id: price.shop.id,
            name: price.shop.name,
            branch: price.shop.branch
              ? {
                  id: price.shop.branch.id,
                  name: price.shop.branch.name,
                }
              : null,
          }
        : null,
      createdAt: price.createdAt,
      updatedAt: price.updatedAt,
    }));

    // Create the final product object
    const finalProduct = {
      id: product.id,
      productCode: product.productCode,
      name: product.name,
      generic: product.generic,
      description: product.description,
      sellPrice: product.sellPrice,
      imageUrl: product.imageUrl,
      category: product.category,
      unitOfMeasure: product.unitOfMeasure,
      isActive: product.isActive,
      additionalPrices,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };

    return {
      product: finalProduct,
    };
  });

  return {
    products: formattedProducts,
    count: formattedProducts.length,
    note: 'Random products with available shop stock (no top-selling products found)',
  };
};
function processProductResults(products) {
  const productResults = products.map((product) => {
    // Filter out batches that have no shop stocks after the query

    // Process additional prices
    const additionalPrices = product.AdditionalPrice.map((price) => ({
      id: price.id,
      label: price.label,
      price: price.price,
      shopId: price.shopId,
      shop: price.shop
        ? {
            id: price.shop.id,
            name: price.shop.name,
            branch: price.shop.branch
              ? {
                  id: price.shop.branch.id,
                  name: price.shop.branch.name,
                }
              : null,
          }
        : null,
      createdAt: price.createdAt,
      updatedAt: price.updatedAt,
    }));

    return {
      product: {
        id: product.id,
        productCode: product.productCode,
        name: product.name,
        generic: product.generic,
        description: product.description,
        category: product.category,
        unitOfMeasure: product.unitOfMeasure,
        sellPrice: product.sellPrice,
        imageUrl: product.imageUrl,
        isActive: product.isActive,
        additionalPrices,
      },
      // Removed batches array from here
    };
  });

  return {
    products: productResults,
    count: productResults.length,
  };
}

// Helper function to check if string is a valid UUID
function isValidUUID(str) {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

const searchProducts = async (searchTerm, categoryId = null) => {
  // Add debug logging to see what's being searched
  // First, get all products and filter manually for case-insensitive search
  const allProducts = await prisma.product.findMany({
    where: {
      isActive: true,
      // Apply category filter if provided (only if it's a valid UUID)
      ...(categoryId && isValidUUID(categoryId) && { categoryId }),
    },
    include: {
      category: true,
      unitOfMeasure: true,
      AdditionalPrice: {
        include: {
          shop: {
            include: {
              branch: true,
            },
          },
        },
      },
      batches: {
        where: {
          ShopStock: {
            some: {
              quantity: { gt: 0 },
            },
          },
        },
        include: {
          ShopStock: {
            where: {
              quantity: { gt: 0 },
            },
            include: {
              shop: {
                include: {
                  branch: true,
                },
              },
              unitOfMeasure: true,
            },
          },
        },
      },
    },
  });

  // If no search term, return all filtered products
  if (!searchTerm) {
    return processProductResults(allProducts);
  }

  // Manual case-insensitive filtering with multiple field support
  const searchTermLower = searchTerm.toLowerCase().trim();

  const filteredProducts = allProducts.filter((product) => {
    // Check product name
    const nameMatch = product.name.toLowerCase().includes(searchTermLower);

    // Check generic name - handle comma-separated values
    let genericMatch = false;
    if (product.generic) {
      // Split by commas and check each generic term
      const genericTerms = product.generic
        .toLowerCase()
        .split(',')
        .map((term) => term.trim());
      genericMatch = genericTerms.some((term) =>
        term.includes(searchTermLower),
      );
    }

    // Check product code
    const codeMatch = product.productCode
      .toLowerCase()
      .includes(searchTermLower);

    // Check category name (case-insensitive)
    const categoryMatch = product.category?.name
      .toLowerCase()
      .includes(searchTermLower);

    const matches = nameMatch || genericMatch || codeMatch || categoryMatch;
    return matches;
  });

  return processProductResults(filteredProducts);
};

const getTopSellingProducts = async (
  userId = null,
  searchTerm = null,
  categoryId = null,
) => {
  // If search term is provided, use search functionality
  // If search term is provided, use search functionality
  if (searchTerm) {
    // FIXED: Remove userId from searchProducts call since it's not used there
    return searchProducts(searchTerm, categoryId);
  }

  // Get user's accessible shops if userId is provided
  let userAccessibleShopIds = [];
  if (userId) {
    const userWithShops = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        shops: {
          select: { id: true },
        },
      },
    });
    userAccessibleShopIds = userWithShops?.shops.map((shop) => shop.id) || [];
  }

  // Build the shop filter condition
  const shopFilterCondition = userId
    ? {
        shopId:
          userAccessibleShopIds.length > 0
            ? { in: userAccessibleShopIds }
            : { in: [] },
      }
    : {};

  // Get top selling products by aggregating sell items
  const topSellingProducts = await prisma.sellItem.groupBy({
    by: ['productId'],
    where: {
      // Only include completed/delivered sales
      OR: [
        { itemSaleStatus: 'DELIVERED' },
        {
          sell: {
            saleStatus: {
              in: ['DELIVERED', 'APPROVED', 'PARTIALLY_DELIVERED'],
            },
          },
        },
      ],
    },
    _sum: {
      quantity: true,
      totalPrice: true,
    },
    _count: {
      id: true,
    },
    orderBy: {
      _sum: {
        quantity: 'desc',
      },
    },
    take: 20,
  });

  // If no top selling products found, get random 20 products with shop stocks
  if (topSellingProducts.length === 0) {
    return getRandomProductsWithShopStocks(userId);
  }

  // Get product IDs from top selling products
  const productIds = topSellingProducts.map((item) => item.productId);

  // Build where clause for products with optional category/subcategory filters
  const productWhereClause = {
    id: { in: productIds },
    isActive: true,
  };

  // Add category filter if provided
  if (categoryId) {
    productWhereClause.categoryId = categoryId;
  }

  // Get products with their additional prices and shop availability
  const productsWithDetails = await prisma.product.findMany({
    where: productWhereClause,
    include: {
      category: true,
      unitOfMeasure: true,
      AdditionalPrice: {
        include: {
          shop: {
            include: {
              branch: true,
            },
          },
        },
      },
      batches: {
        where: {
          ShopStock: {
            some: {
              quantity: { gt: 0 },
              ...shopFilterCondition,
            },
          },
        },
        select: {
          ShopStock: {
            where: {
              quantity: { gt: 0 },
              ...shopFilterCondition,
            },
            select: {
              quantity: true,
              shop: {
                include: {
                  branch: true,
                },
              },
              unitOfMeasure: true,
            },
          },
        },
      },
    },
  });

  // Format the response... (EXACT SAME STRUCTURE AS getRandomProductsWithShopStocks)
  const formattedProducts = productsWithDetails.map((product) => {
    // Filter additional prices based on user shop access
    const additionalPrices = product.AdditionalPrice.filter(
      (price) =>
        !userId || // No user = show all
        (userAccessibleShopIds.length > 0 &&
          userAccessibleShopIds.includes(price.shopId)), // User with shops = only assigned shops
      // If userAccessibleShopIds is empty, no additional prices will be shown
    ).map((price) => ({
      id: price.id,
      label: price.label,
      price: price.price,
      shopId: price.shopId,
      shop: price.shop
        ? {
            id: price.shop.id,
            name: price.shop.name,
            branch: price.shop.branch
              ? {
                  id: price.shop.branch.id,
                  name: price.shop.branch.name,
                }
              : null,
          }
        : null,
      createdAt: price.createdAt,
      updatedAt: price.updatedAt,
    }));

    // Create the final product object
    const finalProduct = {
      id: product.id,
      productCode: product.productCode,
      name: product.name,
      generic: product.generic,
      description: product.description,
      sellPrice: product.sellPrice,
      imageUrl: product.imageUrl,
      category: product.category,
      unitOfMeasure: product.unitOfMeasure,
      isActive: product.isActive,
      additionalPrices,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };

    return {
      product: finalProduct,
    };
  });

  // Sort by sales quantity and take top 20
  const topProducts = formattedProducts
    .sort(
      (a, b) =>
        (b.salesData?.totalQuantitySold || 0) -
        (a.salesData?.totalQuantitySold || 0),
    )
    .slice(0, 20);

  return {
    products: topProducts,
    count: topProducts.length,
    note: 'Top selling products with available shop stock',
  };
};
const getProductBatchesByShopsUser = async (productId, userId = null) => {
  // If userId is provided, get user's accessible shops first
  let userShopIds = [];
  if (userId) {
    const userWithShops = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        shops: {
          select: { id: true },
        },
      },
    });

    if (!userWithShops) {
      throw new Error('User not found');
    }

    userShopIds = userWithShops.shops.map((shop) => shop.id);

    // If user has no shop access, return empty result
    if (userShopIds.length === 0) {
      return {
        totalAvailableQuantity: 0,
        shops: [],
        hasStock: false,
        _metadata: {
          totalShops: 0,
          accessibleShops: 0,
          hasRestrictedAccess: false,
          message: 'User has no shop access',
        },
      };
    }
  }

  // Build where clause for shop stocks
  const shopStockWhere = {
    batch: {
      productId,
    },
    status: 'Available',
    quantity: {
      gt: 0,
    },
  };

  // If userId is provided, filter by user's accessible shops
  if (userId && userShopIds.length > 0) {
    shopStockWhere.shopId = {
      in: userShopIds,
    };
  }

  // Get all available shop stocks for the product
  const shopStocks = await prisma.shopStock.findMany({
    where: shopStockWhere,
    include: {
      shop: {
        include: {
          branch: true,
        },
      },
      batch: {
        include: {
          product: {
            include: {
              AdditionalPrice: {
                where: {
                  OR: [
                    { shopId: null }, // Global additional prices
                    { shopId: { not: null } }, // Shop-specific additional prices
                  ],
                },
              },
            },
          },
        },
      },
    },
  });

  if (!shopStocks || shopStocks.length === 0) {
    return {
      totalAvailableQuantity: 0,
      shops: [],
      hasStock: false,
      _metadata: {
        totalShops: 0,
        accessibleShops: 0,
        hasRestrictedAccess: false,
        message:
          'No available stock found for this product in accessible shops',
      },
    };
  }

  // Get shop IDs from the fetched stocks for reservation calculation
  const stockShopIds = [...new Set(shopStocks.map((stock) => stock.shopId))];

  // Get all pending/approved sells that affect stock availability in accessible shops
  const pendingSells = await prisma.sell.findMany({
    where: {
      items: {
        some: {
          productId,
          shopId: {
            in: stockShopIds,
          },
        },
      },
      saleStatus: {
        in: ['APPROVED', 'PARTIALLY_DELIVERED'], // Only consider approved and partially delivered sells
      },
    },
    include: {
      items: {
        where: {
          productId,
          shopId: {
            in: stockShopIds,
          },
          itemSaleStatus: 'PENDING', // Only consider pending items (not yet delivered)
        },
        include: {
          shop: true,
        },
      },
    },
  });

  // Calculate reserved quantities by shop (only for accessible shops)
  const reservedQuantitiesByShop = new Map();

  pendingSells.forEach((sell) => {
    sell.items.forEach((item) => {
      if (
        item.productId === productId &&
        item.itemSaleStatus === 'PENDING' &&
        stockShopIds.includes(item.shopId)
      ) {
        const currentReserved = reservedQuantitiesByShop.get(item.shopId) || 0;
        reservedQuantitiesByShop.set(
          item.shopId,
          currentReserved + item.quantity,
        );
      }
    });
  });

  // Aggregate quantities by shop and collect additional prices
  const shopsMap = new Map();
  let totalAvailableQuantity = 0;

  shopStocks.forEach((stock) => {
    const reservedQuantity = reservedQuantitiesByShop.get(stock.shopId) || 0;
    const netAvailableQuantity = Math.max(0, stock.quantity - reservedQuantity);

    totalAvailableQuantity += netAvailableQuantity;

    if (shopsMap.has(stock.shop.id)) {
      const existingShop = shopsMap.get(stock.shop.id);
      existingShop.quantity += netAvailableQuantity;
    } else {
      // Get base product price
      const basePrice = stock.batch.product.sellPrice;

      // Filter additional prices for this specific shop
      const shopAdditionalPrices = stock.batch.product.AdditionalPrice.filter(
        (ap) => ap.shopId === null || ap.shopId === stock.shop.id,
      );

      // Calculate total price (base + sum of additional prices)
      let totalPrice = null;
      if (basePrice) {
        const base = parseFloat(basePrice.toString());
        const additionalTotal = shopAdditionalPrices.reduce(
          (sum, ap) => sum + ap.price,
          0,
        );
        totalPrice = base + additionalTotal;
      }

      shopsMap.set(stock.shop.id, {
        shopId: stock.shop.id,
        shopName: stock.shop.name,
        branchName: stock.shop.branch?.name,
        quantity: netAvailableQuantity, // Only net available quantity
        basePrice,
        additionalPrices: shopAdditionalPrices.map((ap) => ({
          id: ap.id,
          label: ap.label,
          price: ap.price,
          isGlobal: ap.shopId === null,
        })),
        totalPrice,
      });
    }
  });

  const shopsArray = Array.from(shopsMap.values());

  // Calculate metadata
  let totalShopsInSystem = 0;
  if (userId) {
    // Count total shops that have this product in stock (regardless of user access)
    const allShopsWithStock = await prisma.shopStock.findMany({
      where: {
        batch: {
          productId,
        },
        status: 'Available',
        quantity: {
          gt: 0,
        },
      },
      select: {
        shopId: true,
      },
      distinct: ['shopId'],
    });
    totalShopsInSystem = allShopsWithStock.length;
  }

  return {
    totalAvailableQuantity,
    shops: shopsArray,
    hasStock: totalAvailableQuantity > 0,
    _metadata: {
      totalShops: userId ? totalShopsInSystem : shopsArray.length,
      accessibleShops: shopsArray.length,
      hasRestrictedAccess: userId
        ? shopsArray.length < totalShopsInSystem
        : false,
      userHasAccess: userId ? userShopIds.length > 0 : null,
      message: userId
        ? `Showing ${shopsArray.length} of ${totalShopsInSystem} shops with available stock`
        : 'Showing all shops with available stock',
    },
  };
};

// Alternative function that explicitly requires userId
const getProductBatchesByShopsForUser = async (productId, userId) => {
  if (!userId) {
    throw new Error('User ID is required for this function');
  }

  return getProductBatchesByShopsUser(productId, userId);
};

module.exports = {
  createProductStock,
  getProductById,
  getProductByCode,
  getAllProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getBatchesByProduct,
  getActiveAllProducts,
  createProductBatchsingle,
  getProductDetails,
  getProductBatchesByShops,
  getTopSellingProducts,
  getRandomProductsWithShopStocks,
  getProductBatchesByShopsForUser,
};
