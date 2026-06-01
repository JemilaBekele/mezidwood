const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');
const sellService = require('./Sell.service');

// Get Cart by ID
const getCartById = async (id) => {
  const cart = await prisma.addToCart.findUnique({
    where: {
      id,
      isWaitlist: false, // Only show non-waitlisted items
    },
    include: {
      user: true,
      branch: true,
      customer: true,
      createdBy: true,
      updatedBy: true,
      items: {
        where: {
          isWaitlist: false, // Only show non-waitlisted items
        },
        include: {
          shop: true,
          product: {
            include: {
              unitOfMeasure: true,
              category: true,
            },
          },
          unitOfMeasure: true,
        },
      },
      waitlists: {
        include: {
          user: true,
          customer: true,
          branch: true,
          cartItem: {
            include: {
              product: true,
              unitOfMeasure: true,
            },
          },
          product: true,
          createdBy: true,
          updatedBy: true,
        },
      },
    },
  });
  return cart;
};

// Get Cart by User ID
const getCartByUserId = async (userId) => {
  const cart = await prisma.addToCart.findFirst({
    where: {
      userId,
      isCheckedOut: false,
      isWaitlist: false,
    },
    include: {
      user: true,
      branch: true,
      customer: true,
      createdBy: true,
      updatedBy: true,
      items: {
        include: {
          shop: true,
          product: {
            include: {
              unitOfMeasure: true,
              category: true,
            },
          },
          unitOfMeasure: true,
        },
      },
      waitlists: {
        include: {
          user: true,
          customer: true,
          branch: true,
          cartItem: {
            include: {
              product: true,
              unitOfMeasure: true,
            },
          },
          product: true,
          createdBy: true,
          updatedBy: true,
        },
      },
    },
  });
  return cart;
};

// Get Cart by ID with user-based filtering
const getCartByIdByUser = async (id, userId = null) => {
  // Get the cart with all items first
  const cart = await prisma.addToCart.findUnique({
    where: {
      id,
      isWaitlist: false, // Only show non-waitlisted items
    },
    include: {
      user: true,
      branch: true,
      customer: true,
      createdBy: true,
      updatedBy: true,
      items: {
        include: {
          shop: true,
          product: {
            include: {
              unitOfMeasure: true,
              category: true,
            },
          },
          unitOfMeasure: true,
        },
      },
      waitlists: {
        include: {
          user: true,
          customer: true,
          branch: true,
          cartItem: {
            include: {
              product: true,
              unitOfMeasure: true,
            },
          },
          product: true,
          createdBy: true,
          updatedBy: true,
        },
      },
    },
  });

  if (!cart) return null;

  // If userId is provided, filter items and return both versions
  if (userId) {
    const userWithShops = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        shops: {
          select: { id: true },
        },
      },
    });

    const userShopIds = userWithShops?.shops?.map((shop) => shop.id) || [];

    const filteredItems = cart.items.filter((item) =>
      userShopIds.includes(item.shopId),
    );

    return {
      ...cart,
      items: filteredItems,
      // Include metadata about the filtering
      _metadata: {
        totalItems: cart.items.length,
        accessibleItems: filteredItems.length,
        hasRestrictedAccess: filteredItems.length < cart.items.length,
      },
    };
  }

  return cart;
};

// Get all Carts
const getAllCarts = async ({ startDate, endDate, isCheckedOut } = {}) => {
  const whereClause = {};

  // Add checkout status filter
  if (isCheckedOut !== undefined) {
    whereClause.isCheckedOut = isCheckedOut;
  }

  // Convert string dates to Date objects if they exist
  const startDateObj = startDate ? new Date(startDate) : undefined;
  const endDateObj = endDate ? new Date(endDate) : undefined;

  // Build the date filter
  if (startDateObj && endDateObj) {
    whereClause.createdAt = {
      gte: startDateObj,
      lte: endDateObj,
    };
  } else if (startDateObj) {
    whereClause.createdAt = {
      gte: startDateObj,
      lte: new Date(),
    };
  } else if (endDateObj) {
    whereClause.createdAt = {
      lte: endDateObj,
    };
  }

  const carts = await prisma.addToCart.findMany({
    where: whereClause,
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      user: true,
      branch: true,
      customer: true,
      items: {
        include: {
          shop: true,
          product: true,
          unitOfMeasure: true,
        },
      },
      waitlists: {
        include: {
          user: true,
          customer: true,
          product: true,
        },
      },
      _count: {
        select: {
          items: true,
          waitlists: true,
        },
      },
    },
  });

  return {
    carts,
    count: carts.length,
  };
};

// Create or Update Cart
const createOrUpdateCart = async (cartBody, userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { branch: true },
  });
  // console.log(cartBody);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

  // Parse items if it's a string
  const { items: itemsString, ...restCartBody } = cartBody;
  const items =
    typeof itemsString === 'string' ? JSON.parse(itemsString) : itemsString;

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cart must have at least one item',
    );
  }

  // Check if user already has an active cart
  const existingCart = await prisma.addToCart.findFirst({
    where: {
      userId,
      isCheckedOut: false,
      isWaitlist: false,
    },
    include: {
      items: true,
      waitlists: true,
    },
  });

  // Validate items and calculate totals
  const products = await prisma.product.findMany({
    where: { id: { in: items.map((item) => item.productId) } },
    include: { unitOfMeasure: true },
  });

  let totalItems = 0;
  let totalAmount = 0;

  const enhancedItems = items.map((item, index) => {
    if (!item.productId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} is missing productId`,
      );
    }

    const product = products.find((p) => p.id === item.productId);
    if (!product) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid productId`,
      );
    }

    if (item.quantity <= 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid quantity`,
      );
    }

    // Determine unit price
    let unitPrice = Number(item.unitPrice) || 0;
    if (unitPrice === 0) {
      unitPrice = product.sellPrice ? Number(product.sellPrice) : 0;
    }

    if (
      typeof unitPrice !== 'number' ||
      Number.isNaN(unitPrice) ||
      unitPrice < 0
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} has invalid unit price`,
      );
    }

    // Validate shopId
    const { shopId } = item;
    if (!shopId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Item ${index + 1} is missing shopId`,
      );
    }

    const quantity = Number(item.quantity);
    const itemTotalPrice = unitPrice * quantity;

    totalItems += quantity;
    totalAmount += itemTotalPrice;

    return {
      ...item,
      shopId,
      unitPrice,
      quantity,
      totalPrice: itemTotalPrice,
      unitOfMeasureId: item.unitOfMeasureId || product.unitOfMeasureId,
    };
  });

  if (existingCart) {
    // Update existing cart
    return prisma.$transaction(async (tx) => {
      // Delete all existing items
      await tx.cartItem.deleteMany({
        where: { cartId: existingCart.id },
      });

      // Update cart with new items
      const updatedCart = await tx.addToCart.update({
        where: { id: existingCart.id },
        data: {
          totalItems,
          totalAmount,
          branchId: restCartBody.branchId || user.branchId,
          customerId: restCartBody.customerId,
          updatedById: userId,
          items: {
            create: enhancedItems.map((item) => ({
              shopId: item.shopId,
              productId: item.productId,
              unitOfMeasureId: item.unitOfMeasureId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              notes: item.notes,
            })),
          },
        },
        include: {
          user: true,
          branch: true,
          customer: true,
          createdBy: true,
          updatedBy: true,
          items: {
            include: {
              shop: true,
              product: {
                include: {
                  unitOfMeasure: true,
                  category: true,
                },
              },
              unitOfMeasure: true,
            },
          },
          waitlists: true,
        },
      });

      return updatedCart;
    });
  }

  // Create new cart
  const newCart = await prisma.addToCart.create({
    data: {
      userId,
      branchId: restCartBody.branchId || user.branchId,
      customerId: restCartBody.customerId,
      totalItems,
      totalAmount,
      isCheckedOut: false,
      createdById: userId,
      updatedById: userId,
      items: {
        create: enhancedItems.map((item) => ({
          shopId: item.shopId,
          productId: item.productId,
          unitOfMeasureId: item.unitOfMeasureId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          notes: item.notes,
        })),
      },
    },
    include: {
      user: true,
      branch: true,
      customer: true,
      createdBy: true,
      updatedBy: true,
      items: {
        include: {
          shop: true,
          product: {
            include: {
              unitOfMeasure: true,
              category: true,
            },
          },
          unitOfMeasure: true,
        },
      },
      waitlists: true,
    },
  });

  return newCart;
};

// Helper function to update cart totals
const updateCartTotals = async (cartId) => {
  const cartItems = await prisma.cartItem.findMany({
    where: {
      cartId,
      isWaitlist: false, // Only count non-waitlisted items
    },
  });

  const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);

  await prisma.addToCart.update({
    where: { id: cartId },
    data: {
      totalItems,
      totalAmount,
    },
  });
};

// Add item to cart - creates new cart if cartId not provided or not found
const addItemToCart = async (cartId, itemData, userId) => {
  let cart;

  // If cartId is provided, try to find the cart
  if (cartId) {
    cart = await getCartById(cartId);
  }

  // If cart doesn't exist or cartId not provided, create a new cart
  if (!cart) {
    // Validate that userId is provided for creating new cart
    if (!userId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'User ID is required to create a new cart',
      );
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid user ID');
    }

    // Create new cart
    cart = await prisma.addToCart.create({
      data: {
        userId,
        isCheckedOut: false,
        totalItems: 0,
        totalAmount: 0,
        createdById: userId,
        updatedById: userId,
      },
      include: {
        items: true,
        waitlists: true,
      },
    });
  }

  // Check if cart is checked out
  if (cart.isCheckedOut) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot add items to checked out cart',
    );
  }

  // Validate item data
  const { productId, shopId, quantity, unitPrice, unitOfMeasureId, notes } =
    itemData;

  if (!productId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Product ID is required');
  }

  if (!shopId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Shop ID is required');
  }

  if (quantity <= 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Quantity must be greater than 0',
    );
  }

  // Fetch product for validation
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { unitOfMeasure: true },
  });

  if (!product) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid product ID');
  }

  // Verify shop exists
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
  });

  if (!shop) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid shop ID');
  }

  // Determine final unit price
  let finalUnitPrice = Number(unitPrice) || 0;
  if (finalUnitPrice === 0) {
    finalUnitPrice = product.sellPrice ? Number(product.sellPrice) : 0;
  }

  const finalUnitOfMeasureId = unitOfMeasureId || product.unitOfMeasureId;

  const totalPrice = finalUnitPrice * quantity;

  // Check if item already exists in cart (same product, shop, and unit of measure)
  const existingCartItem = await prisma.cartItem.findFirst({
    where: {
      cartId: cart.id,
      productId,
      shopId,
      unitOfMeasureId: finalUnitOfMeasureId,
    },
  });

  let cartItem;

  if (existingCartItem) {
    // Update existing item quantity and price
    cartItem = await prisma.cartItem.update({
      where: { id: existingCartItem.id },
      data: {
        quantity: existingCartItem.quantity + quantity,
        unitPrice: finalUnitPrice,
        totalPrice: existingCartItem.totalPrice + totalPrice,
        notes: notes || existingCartItem.notes,
      },
      include: {
        shop: true,
        product: {
          include: {
            unitOfMeasure: true,
            category: true,
          },
        },
        unitOfMeasure: true,
      },
    });
  } else {
    // Create new cart item
    cartItem = await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        shopId,
        productId,
        unitOfMeasureId: finalUnitOfMeasureId,
        quantity,
        unitPrice: finalUnitPrice,
        totalPrice,
        notes,
      },
      include: {
        shop: true,
        product: {
          include: {
            unitOfMeasure: true,
            category: true,
          },
        },
        unitOfMeasure: true,
      },
    });
  }

  // Update cart totals
  await updateCartTotals(cart.id);

  return {
    cart: {
      id: cart.id,
      userId: cart.userId,
      isCheckedOut: cart.isCheckedOut,
      totalItems: cart.totalItems,
      totalAmount: cart.totalAmount,
    },
    cartItem,
  };
};

// Update cart item
const updateCartItem = async (cartItemId, updateData) => {
  const cartItem = await prisma.cartItem.findUnique({
    where: { id: cartItemId },
    include: {
      cart: true,
    },
  });

  if (!cartItem) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Cart item not found');
  }

  if (cartItem.cart.isCheckedOut) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot update items in checked out cart',
    );
  }

  const { quantity, unitPrice, notes } = updateData;

  if (quantity !== undefined && quantity <= 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Quantity must be greater than 0',
    );
  }

  const finalQuantity = quantity !== undefined ? quantity : cartItem.quantity;
  const finalUnitPrice =
    unitPrice !== undefined ? Number(unitPrice) : cartItem.unitPrice;
  const totalPrice = finalQuantity * finalUnitPrice;

  const updatedCartItem = await prisma.cartItem.update({
    where: { id: cartItemId },
    data: {
      quantity: finalQuantity,
      unitPrice: finalUnitPrice,
      totalPrice,
      notes: notes !== undefined ? notes : cartItem.notes,
    },
    include: {
      shop: true,
      product: {
        include: {
          unitOfMeasure: true,
          category: true,
        },
      },
      unitOfMeasure: true,
    },
  });

  // Update cart totals
  await updateCartTotals(cartItem.cartId);

  return updatedCartItem;
};

// Remove item from cart
const removeItemFromCart = async (cartItemId) => {
  const cartItem = await prisma.cartItem.findUnique({
    where: { id: cartItemId },
    include: {
      cart: true,
    },
  });

  if (!cartItem) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Cart item not found');
  }

  if (cartItem.cart.isCheckedOut) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot remove items from checked out cart',
    );
  }

  await prisma.cartItem.delete({
    where: { id: cartItemId },
  });

  // Update cart totals
  await updateCartTotals(cartItem.cartId);

  return { message: 'Item removed from cart successfully' };
};
const assignCustomerToCart = async (cartId, customerId, discount, notes) => {
  try {
    // DEBUGGING: Log all input parameters

    // Validate inputs
    if (!cartId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cart ID and Customer ID are required',
      );
    }

    // Validate customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true }, // Only select what you need
    });

    if (!customer) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Customer not found');
    }

    // Fetch cart with current values to check conditions
    const cart = await prisma.addToCart.findUnique({
      where: { id: cartId },
    });

    if (!cart) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Cart not found');
    }

    if (cart.isCheckedOut) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cannot assign customer to checked out cart',
      );
    }

    // Normalize inputs for comparison
    const normalizedDiscount =
      discount !== undefined && discount !== null && discount !== ''
        ? parseFloat(discount)
        : undefined;

    const normalizedNotes =
      notes !== undefined && notes !== null && notes !== ''
        ? notes.trim()
        : undefined;

    // Check if update is needed
    const discountSame =
      normalizedDiscount === undefined || cart.discount === normalizedDiscount;

    const notesSame =
      normalizedNotes === undefined || cart.notes === normalizedNotes;

    if (cart.customerId === customerId && discountSame && notesSame) {
      // No changes needed, return current cart
      return cart;
    }

    // Build the update data
    const updateData = {
      customer: {
        connect: { id: customerId },
      },
    };

    // Add discount if provided
    if (normalizedDiscount !== undefined) {
      // DEBUGGING: More detailed logging

      if (isNaN(normalizedDiscount)) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Discount must be a valid number',
        );
      }

      if (normalizedDiscount < 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Discount cannot be negative',
        );
      }

      // IMPORTANT: If discount is absolute value, validate it doesn't exceed total amount
      // (unless you want to allow negative final amounts)
      if (normalizedDiscount > cart.totalAmount) {
        // Business decision: Either reject or cap at total amount

        // Option 1: Reject (safer)
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Discount (${normalizedDiscount}) cannot exceed cart total amount (${cart.totalAmount})`,
        );

        // Option 2: Cap at total amount
        // normalizedDiscount = cart.totalAmount;
        // console.log('Capped discount at total amount:', cart.totalAmount);
      }

      updateData.discount = normalizedDiscount;
    }

    // Add notes if provided
    if (normalizedNotes !== undefined) {
      updateData.notes = normalizedNotes;
    }

    // DEBUGGING: Log the update data before sending to Prisma

    // Update cart
    const updatedCart = await prisma.addToCart.update({
      where: { id: cartId },
      data: updateData,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            // Add other customer fields you need
          },
        },
      },
    });

    // Calculate final amount for logging

    return updatedCart;
  } catch (error) {
    // ADDED CONSOLE.LOG HERE TO SEE THE ERROR

    if (error instanceof ApiError) {
      throw error;
    }

    // Handle Prisma specific errors
    if (error.code === 'P2025') {
      throw new ApiError(httpStatus.NOT_FOUND, 'Record not found');
    }

    if (error.code === 'P2003') {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Foreign key constraint failed',
      );
    }

    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Internal server error while assigning customer to cart',
    );
  }
};
// Clear cart (remove all items)
const clearCart = async (cartId, userId) => {
  const cart = await getCartById(cartId);
  if (!cart) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Cart not found');
  }

  if (cart.isCheckedOut) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot clear checked out cart');
  }

  await prisma.$transaction(async (tx) => {
    // Delete all cart items
    await tx.cartItem.deleteMany({
      where: { cartId },
    });

    // Reset cart totals AND clear customer data
    await tx.addToCart.update({
      where: { id: cartId },
      data: {
        totalItems: 0,
        totalAmount: 0,
        // CLEAR CUSTOMER DATA
        customerId: null, // This disconnects the customer
        discount: 0, // Reset discount
        notes: null, // Clear notes
        updatedById: userId,
      },
    });
  });

  return { message: 'Cart cleared successfully' };
};
// Checkout cart (convert to sell)
const checkoutCart = async (cartId, checkoutData, userId) => {
  // Get user with branch information
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { branch: true },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

  // Fetch cart with customer information
  const cart = await prisma.addToCart.findUnique({
    where: { id: cartId },
    include: {
      customer: true,
      items: {
        include: {
          shop: true,
          product: {
            include: {
              category: true,
              unitOfMeasure: true,
            },
          },
          unitOfMeasure: true,
        },
      },
    },
  });

  if (!cart) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Cart not found');
  }

  // Validation checks

  if (cart.isCheckedOut) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cart is already checked out');
  }

  if (cart.items.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot checkout empty cart');
  }

  if (!cart.customerId) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cart must be associated with a customer to checkout',
    );
  }

  if (!cart.customer) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Associated customer not found');
  }

  // NEW: Check if cart has discount and validate it
  if (cart.discount !== undefined && cart.discount !== null) {
    // Validate discount is a valid number
    const discountValue = parseFloat(cart.discount);
    if (isNaN(discountValue)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cart discount must be a valid number',
      );
    }

    // Check if discount is negative
    if (discountValue < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cart discount cannot be negative',
      );
    }

    // NEW: Check if discount is too high (optional business rule)
    // Calculate cart total
    const cartTotal = cart.items.reduce((total, item) => {
      return total + item.quantity * item.unitPrice;
    }, 0);

    if (discountValue > cartTotal) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Discount (${discountValue}) cannot exceed cart total (${cartTotal})`,
      );
    }

    // NEW: If discount exists, sell cannot be automatically approved
    // This is a business rule - you might want to adjust this
    if (discountValue > 0 && checkoutData.saleStatus === 'APPROVED') {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Sales with discount cannot be automatically approved. Requires manager approval.',
      );
    }
  }

  // Prepare sell body with discount from cart
  const sellBody = {
    ...checkoutData,
    branchId: user.branchId,
    customerId: cart.customerId,
    customer: cart.customer,
    notes: checkoutData.notes || cart.notes || '',
    discount: cart.discount || 0,
    items: cart.items.map((item, index) => {
      const itemData = {
        productId: item.productId,
        shopId: item.shopId,
        unitOfMeasureId: item.unitOfMeasureId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      };
      return {
        ...itemData,
        product: item.product,
        shop: item.shop,
      };
    }),
  };

  // NEW: If cart has discount, ensure sell status is NOT_APPROVED
  if (cart.discount && cart.discount > 0) {
    sellBody.saleStatus = 'NOT_APPROVED';
  }

  const sell = await sellService.createSell(sellBody, userId);

  // Mark cart as checked out
  await prisma.addToCart.update({
    where: { id: cartId },
    data: {
      isCheckedOut: true,
      updatedById: userId,
    },
  });

  // Return updated cart with customer info
  const updatedCart = await getCartById(cartId);

  return {
    cart: updatedCart,
    sell,
    message:
      cart.discount && cart.discount > 0
        ? 'Cart checked out successfully. Sale requires approval due to discount.'
        : 'Cart checked out successfully and converted to sale',
  };
};
const convertOrderToCart = async (sellId, userId) => {
  try {
    // Get user with branch information
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { branch: true },
    });

    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
    }

    // Fetch sell with all necessary relations
    const sell = await prisma.sell.findUnique({
      where: { id: sellId },
      include: {
        customer: true,
        items: {
          include: {
            shop: true,
            product: {
              include: {
                category: true,
                unitOfMeasure: true,
              },
            },
            unitOfMeasure: true,
            batches: true,
          },
        },
      },
    });

    if (!sell) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
    }

    // Validation checks
    if (sell.locked) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cannot convert locked order to cart',
      );
    }

    // Check if sell status is allowed for conversion
    const allowedStatuses = ['PENDING', 'APPROVED', 'NOT_APPROVED'];

    if (!allowedStatuses.includes(sell.saleStatus)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Order with status ${sell.saleStatus} cannot be converted to cart. Only pending or approved orders can be converted.`,
      );
    }

    // Check for existing active cart
    const existingCart = await prisma.addToCart.findFirst({
      where: {
        customerId: sell.customerId,
        isCheckedOut: false,
        isWaitlist: false,
      },
    });

    if (existingCart) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Customer already has an active cart. Please check out or delete the existing cart first.',
      );
    }

    // Check for batch transactions
    const hasBatches = sell.items.some(
      (item) => item.batches && item.batches.length > 0,
    );
    if (hasBatches) {
      sell.items.forEach((item, index) => {
        if (item.batches && item.batches.length > 0) {
          console.log(
            `📦 [convertOrderToCart] Item ${index + 1} has ${
              item.batches.length
            } batches`,
          );
        }
      });
    }

    // Start a transaction to ensure data consistency
    return prisma.$transaction(async (prisma) => {
      try {
        // Create cart data
        const cartData = {
          userId,
          branchId: user.branchId,
          // customerId: sell.customerId,
          totalItems: sell.totalProducts,
          totalAmount: sell.grandTotal,
          isCheckedOut: false,
          isWaitlist: false,
          // These are optional fields in the schema, only include if userId exists
          ...(userId && { createdById: userId }),
          ...(userId && { updatedById: userId }),
          items: {
            create: sell.items.map((item, index) => {
              // For the first item, include the conversion note
              const itemNotes =
                index === 0
                  ? `Converted from order: ${sell.invoiceNo} (Status: ${
                      sell.saleStatus
                    }). ${
                      item.itemSaleStatus
                        ? `Previous item status: ${item.itemSaleStatus}`
                        : ''
                    }`
                  : item.itemSaleStatus
                  ? `Previous item status: ${item.itemSaleStatus}`
                  : null;

              return {
                shopId: item.shopId,
                productId: item.productId,
                unitOfMeasureId: item.unitOfMeasureId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice,
                notes: itemNotes,
                isWaitlist: false,
              };
            }),
          },
        };

        const newCart = await prisma.addToCart.create({
          data: cartData,
          include: {
            customer: true,
            items: {
              include: {
                shop: true,
                product: {
                  include: {
                    category: true,
                    unitOfMeasure: true,
                  },
                },
                unitOfMeasure: true,
              },
            },
          },
        });

        // Get all sell item IDs
        const sellItemIds = sell.items.map((item) => item.id);

        if (sellItemIds.length > 0) {
          try {
            // Check if SellItemBatch model exists in your schema
            // Delete batches for all sell items

            await prisma.sellItemBatch.deleteMany({
              where: {
                sellItemId: {
                  in: sellItemIds,
                },
              },
            });
          } catch (batchError) {
            console.warn(
              '⚠️ [convertOrderToCart] Error deleting SellItemBatch records:',
              batchError.message,
            );
            // Model might not exist or have different name, continue
          }
        }

        // STEP 2: Delete SellItem records

        await prisma.sellItem.deleteMany({
          where: {
            sellId,
          },
        });

        // STEP 3: Now delete the main Sell record
        await prisma.sell.delete({
          where: { id: sellId },
        });
        console.log('✅ [convertOrderToCart] Sell record deleted successfully');

        const result = {
          cart: newCart,
          originalOrder: {
            invoiceNo: sell.invoiceNo,
            saleStatus: sell.saleStatus,
            grandTotal: sell.grandTotal,
            totalProducts: sell.totalProducts,
          },
          message:
            'Order successfully converted to cart and original order deleted',
        };

        console.log(
          '🎉 [convertOrderToCart] Conversion completed successfully',
        );
        console.log('📊 [convertOrderToCart] Result:', {
          cartId: newCart.id,
          originalInvoice: sell.invoiceNo,
          message: result.message,
        });

        return result;
      } catch (transactionError) {
        console.error('❌ [convertOrderToCart] Transaction error:', {
          error: transactionError.message,
          stack: transactionError.stack,
        });
        throw transactionError;
      }
    });
  } catch (error) {
    console.error('❌ [convertOrderToCart] Function error:', {
      errorName: error.name,
      errorMessage: error.message,
      errorCode: error.code,
      errorStack: error.stack,
      sellId,
      userId,
    });

    // Check if it's an ApiError
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      error.message || 'Failed to convert order to cart',
    );
  }
};

// Update the service function signature
const addToWaitlist = async (data, userId) => {
  const { cartItemIds, note } = data;

  // Validate input
  if (!cartItemIds || !Array.isArray(cartItemIds) || cartItemIds.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Valid array of cartItemIds is required',
    );
  }

  if (cartItemIds.some((id) => typeof id !== 'string')) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'All cartItemIds must be strings',
    );
  }

  // Fetch all cart items WITH their cart and customer info
  const cartItems = await prisma.cartItem.findMany({
    where: {
      id: { in: cartItemIds },
    },
    include: {
      product: {
        include: {
          unitOfMeasure: true,
          category: true,
        },
      },
      shop: true,
      unitOfMeasure: true,
      cart: {
        include: {
          customer: true,
        },
      },
    },
  });

  if (cartItems.length === 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'No cart items found with the provided IDs',
    );
  }

  // Check if all cart items belong to the same cart
  const cartIds = [...new Set(cartItems.map((item) => item.cartId))];
  if (cartIds.length > 1) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'All cart items must belong to the same cart',
    );
  }

  const cartId = cartIds[0];

  // Get the customerId from the cart
  const { customerId } = cartItems[0].cart;

  // Validate that the cart has a customer assigned
  if (!customerId) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cart must have a customer assigned before adding items to waitlist',
    );
  }

  // Verify customer exists (optional check)
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Customer not found');
  }

  // Check for existing waitlist items
  const existingWaitlistItems = await prisma.waitlist.findMany({
    where: {
      cartId,
      cartItemId: { in: cartItemIds },
    },
  });

  // Process all cart items using Promise.allSettled
  const processingResults = await Promise.allSettled(
    cartItems.map(async (cartItem) => {
      // Check if this specific cart item already has a waitlist entry
      const existingItem = existingWaitlistItems.find(
        (item) => item.cartItemId === cartItem.id,
      );

      let waitlist;

      if (existingItem) {
        // Update existing waitlist
        waitlist = await prisma.waitlist.update({
          where: { id: existingItem.id },
          data: {
            note: note || `Updated waitlist - ${cartItem.product.name}`,
            updatedById: userId,
          },
          include: {
            user: true,
            customer: true,
            branch: true,
            cart: true,
            cartItem: {
              include: {
                product: true,
                unitOfMeasure: true,
                shop: true,
              },
            },
            createdBy: true,
            updatedBy: true,
          },
        });
      } else {
        // Create new waitlist using customerId from cart
        waitlist = await prisma.waitlist.create({
          data: {
            userId,
            customerId,
            branchId: cartItem.cart.branchId || undefined,
            cartId,
            cartItemId: cartItem.id,
            note: note || `Item moved to waitlist - ${cartItem.product.name}`,
            createdById: userId,
            updatedById: userId,
          },
          include: {
            user: true,
            customer: true,
            branch: true,
            cart: true,
            cartItem: {
              include: {
                product: true,
                unitOfMeasure: true,
                shop: true,
              },
            },
            createdBy: true,
            updatedBy: true,
          },
        });
      }

      return waitlist;
    }),
  );

  // Process results
  const waitlistResults = [];
  const errors = [];

  processingResults.forEach((result, index) => {
    const cartItem = cartItems[index];

    if (result.status === 'fulfilled') {
      waitlistResults.push(result.value);
    } else {
      errors.push({
        cartItemId: cartItem.id,
        productName: cartItem.product.name,
        error: result.reason.message,
      });
    }
  });

  // If all items failed, throw an error
  if (waitlistResults.length === 0 && errors.length > 0) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to add any items to waitlist',
      { errors },
    );
  }

  // IMPORTANT: Update the cart to mark as waitlist
  await prisma.addToCart.update({
    where: { id: cartId },
    data: {
      isWaitlist: true, // Mark cart as waitlist
    },
  });

  // Also mark the specific cart items as waitlist
  await prisma.cartItem.updateMany({
    where: {
      id: { in: cartItemIds },
    },
    data: {
      isWaitlist: true, // Mark cart items as waitlist
    },
  });

  return {
    success: true,
    message: `Successfully added ${waitlistResults.length} item(s) to waitlist`,
    totalItems: cartItems.length,
    successfulItems: waitlistResults.length,
    failedItems: errors.length,
    waitlistItems: waitlistResults,
    cartUpdated: {
      id: cartId,
      isWaitlist: true,
    },
    errors: errors.length > 0 ? errors : undefined,
  };
};
// Remove item from waitlist
const removeItemFromWaitlist = async (waitlistItemId) => {
  const waitlistItem = await prisma.waitlist.findUnique({
    where: { id: waitlistItemId },
    include: {
      cart: true,
      customer: true,
    },
  });

  if (!waitlistItem) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Waitlist item not found');
  }

  await prisma.waitlist.delete({
    where: { id: waitlistItemId },
  });

  return { message: 'Item removed from waitlist successfully' };
};

// Clear entire waitlist
const clearWaitlist = async (cartId) => {
  const cart = await getCartById(cartId);
  if (!cart) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Cart not found');
  }

  await prisma.$transaction(async (tx) => {
    // Delete all waitlist items for this cart
    await tx.waitlist.deleteMany({
      where: { cartId },
    });
  });

  return { message: 'Waitlist cleared successfully' };
};

// Get waitlists by user
const getWaitlistsByUser = async (userId, filters = {}) => {
  const { startDate, endDate, includeNoCustomer = false } = filters;

  const whereClause = {
    userId,
    ...(includeNoCustomer ? {} : { customerId: { not: null } }),
  };

  // Add date filters
  if (startDate || endDate) {
    whereClause.createdAt = {};
    if (startDate) whereClause.createdAt.gte = new Date(startDate);
    if (endDate) whereClause.createdAt.lte = new Date(endDate);
  }
  try {
    // First, let's see what's in the database without includes
    await prisma.waitlist.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        cartItemId: true,
        quantity: true,
        note: true,
        customerId: true,
        cartId: true,
      },
    });

    // Now get full data with includes
    const waitlists = await prisma.waitlist.findMany({
      where: whereClause,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        user: true,
        customer: true,
        branch: true,
        cart: true,
        cartItem: {
          include: {
            product: true,
            unitOfMeasure: true,
            shop: true,
          },
        },
        createdBy: true,
        updatedBy: true,
      },
    });

    // Transform the data structure
    const transformedWaitlists = waitlists.map((waitlist) => {
      // Create a properly structured cartItem if it exists
      const cartItem = waitlist.cartItem
        ? {
            id: waitlist.cartItem.id,
            cartId: waitlist.cartItem.cartId,
            shopId: waitlist.cartItem.shopId,
            productId: waitlist.cartItem.productId,
            unitOfMeasureId: waitlist.cartItem.unitOfMeasureId,
            quantity: waitlist.cartItem.quantity, // FIXED: Use cartItem quantity, not waitlist quantity
            unitPrice: waitlist.cartItem.unitPrice,
            totalPrice: waitlist.cartItem.totalPrice,
            notes: waitlist.cartItem.notes,
            createdAt: waitlist.cartItem.createdAt,
            updatedAt: waitlist.cartItem.updatedAt,
            shop: waitlist.cartItem.shop,
            product: waitlist.cartItem.product,
            unitOfMeasure: waitlist.cartItem.unitOfMeasure,
          }
        : null;

      return {
        id: waitlist.id,
        userId: waitlist.userId,
        customerId: waitlist.customerId,
        branchId: waitlist.branchId,
        cartId: waitlist.cartId,
        cartItemId: waitlist.cartItemId,
        note: waitlist.note,
        quantity: waitlist.quantity, // This is the waitlist quantity (usually 1)
        createdById: waitlist.createdById,
        updatedById: waitlist.updatedById,
        createdAt: waitlist.createdAt,
        updatedAt: waitlist.updatedAt,

        // Relations
        user: waitlist.user,
        customer: waitlist.customer,
        branch: waitlist.branch,
        cart: waitlist.cart,
        cartItem, // This now has the correct cart item quantity
        createdBy: waitlist.createdBy,
        updatedBy: waitlist.updatedBy,
      };
    });
    console.log('First waitlist customer name:', transformedWaitlists[0]?.customer?.name);

    return transformedWaitlists;
  } catch (error) {
    console.error('❌ Error in getWaitlistsByUser:', error);
    throw error;
  }
};

// Convert waitlist to cart item
const convertCustomerWaitlistToCart = async (customerId, userId) => {
  // Get all waitlist items for this customer that belong to the user
  const waitlists = await prisma.waitlist.findMany({
    where: {
      customerId,
      OR: [{ userId }, { createdById: userId }],
    },
    include: {
      user: true,
      customer: true,
      cart: {
        include: {
          items: {
            where: {
              isWaitlist: true,
            },
          },
        },
      },
      cartItem: {
        include: {
          product: true,
          shop: true,
          unitOfMeasure: true,
        },
      },
      shop: true,
    },
  });

  if (!waitlists || waitlists.length === 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'No waitlist items found for this customer',
    );
  }

  // Check if the user already has an active cart with items
  const existingUserCart = await prisma.addToCart.findFirst({
    where: {
      userId,
      isCheckedOut: false,
      isWaitlist: false,
    },
    include: {
      items: {
        include: {
          product: true,
        },
      },
      customer: true,
    },
  });

  // Check if there are any existing non-waitlist items in the cart
  if (
    existingUserCart &&
    existingUserCart.items &&
    existingUserCart.items.length > 0
  ) {
    // Count non-waitlist items
    const nonWaitlistItems = existingUserCart.items.filter(
      (item) => !item.isWaitlist,
    );

    if (nonWaitlistItems.length > 0) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Your cart contains items. Please clear your cart before converting waitlist items.',
      );
    }
  }

  // Find or create cart for user with the waitlist customer association
  let cart = await prisma.addToCart.findFirst({
    where: {
      userId,
      customerId,
      isCheckedOut: false,
      isWaitlist: false,
    },
    include: {
      items: true,
    },
  });

  if (!cart) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    // Use the branchId from the first waitlist item
    const firstWaitlist = waitlists[0];

    cart = await prisma.addToCart.create({
      data: {
        userId,
        // customerId,
        branchId: user.branchId || firstWaitlist.branchId,
        isCheckedOut: false,
        isWaitlist: false,
        totalItems: 0,
        totalAmount: 0,
        createdById: userId,
        updatedById: userId,
      },
    });
  }

  const allConvertedItems = [];
  const processedCartIds = new Set();
  const processedCartItemIds = new Set();
  const waitlistIdsToDelete = [];

  // Process each waitlist item using array iteration instead of for loop
  const processingResults = await Promise.allSettled(
    waitlists.map(async (waitlist) => {
      let convertedItem = null;

      // If this waitlist is linked to a specific cart item
      if (
        waitlist.cartItemId &&
        !processedCartItemIds.has(waitlist.cartItemId)
      ) {
        processedCartItemIds.add(waitlist.cartItemId);

        const originalCartItem = await prisma.cartItem.findUnique({
          where: { id: waitlist.cartItemId },
        });

        if (originalCartItem && originalCartItem.isWaitlist) {
          // Convert single cart item from waitlist
          convertedItem = await prisma.cartItem.update({
            where: { id: originalCartItem.id },
            data: {
              cartId: cart.id,
              isWaitlist: false,
              notes: `Bulk converted from customer waitlist: ${
                waitlist.note || 'No note'
              }`,
            },
            include: {
              shop: true,
              product: {
                include: {
                  unitOfMeasure: true,
                  category: true,
                },
              },
              unitOfMeasure: true,
            },
          });

          allConvertedItems.push(convertedItem);
        }
      }
      // If this waitlist is linked to a cart with multiple waitlisted items
      else if (waitlist.cartId && !processedCartIds.has(waitlist.cartId)) {
        processedCartIds.add(waitlist.cartId);

        // Get all waitlisted items from this cart
        const waitlistedCartItems = await prisma.cartItem.findMany({
          where: {
            cartId: waitlist.cartId,
            isWaitlist: true,
          },
          include: {
            product: true,
            shop: true,
            unitOfMeasure: true,
          },
        });

        // Move each waitlisted item to the new cart
        const updatedItems = await Promise.all(
          waitlistedCartItems.map((item) =>
            prisma.cartItem.update({
              where: { id: item.id },
              data: {
                cartId: cart.id,
                isWaitlist: false,
                notes: `Bulk converted from customer waitlist cart`,
              },
              include: {
                shop: true,
                product: true,
                unitOfMeasure: true,
              },
            }),
          ),
        );

        allConvertedItems.push(...updatedItems);

        // Mark the original cart as not waitlisted if all items are moved
        const remainingWaitlistedItems = await prisma.cartItem.count({
          where: {
            cartId: waitlist.cartId,
            isWaitlist: true,
          },
        });

        if (remainingWaitlistedItems === 0) {
          await prisma.addToCart.update({
            where: { id: waitlist.cartId },
            data: {
              isWaitlist: false,
            },
          });
        }
      }

      // Mark waitlist for deletion
      waitlistIdsToDelete.push(waitlist.id);

      return convertedItem;
    }),
  );

  // Check for failures and log them appropriately
  processingResults.filter((result) => result.status === 'rejected');

  // Delete all processed waitlist entries
  if (waitlistIdsToDelete.length > 0) {
    await prisma.waitlist.deleteMany({
      where: {
        id: { in: waitlistIdsToDelete },
      },
    });
  }

  // Update cart totals
  await updateCartTotals(cart.id);

  // Update totals for any original carts we moved items from
  const updateCartTotalsPromises = Array.from(processedCartIds)
    .filter((cartId) => cartId !== cart.id)
    .map((cartId) => updateCartTotals(cartId));

  await Promise.allSettled(updateCartTotalsPromises);

  return {
    cartItems: allConvertedItems,
    totalItemsConverted: allConvertedItems.length,
    cart: await getCartById(cart.id),
    customer: waitlists[0]?.customer,
    requiresUserSelection: false, // Indicates if frontend needs user selection
    message: `${allConvertedItems.length} waitlist items for customer "${waitlists[0]?.customer?.name}" successfully added to cart`,
  };
};

// Delete cart
const deleteCart = async (cartId) => {
  const cart = await getCartById(cartId);
  if (!cart) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Cart not found');
  }

  await prisma.$transaction(async (tx) => {
    // Delete all cart items
    await tx.cartItem.deleteMany({
      where: { cartId },
    });

    // Delete all associated waitlists
    await tx.waitlist.deleteMany({
      where: { cartId },
    });

    // Delete the cart
    await tx.addToCart.delete({
      where: { id: cartId },
    });
  });

  return { message: 'Cart deleted successfully' };
};
// Get all waitlists (admin function)
const getAllWaitlists = async (filters = {}) => {
  const { userId, startDate, endDate } = filters;

  const whereClause = {};

  // Add user filter
  if (userId) {
    whereClause.userId = userId;
  }

  // Add date filters
  if (startDate || endDate) {
    whereClause.createdAt = {};
    if (startDate) whereClause.createdAt.gte = new Date(startDate);
    if (endDate) whereClause.createdAt.lte = new Date(endDate);
  }

  const waitlists = await prisma.waitlist.findMany({
    where: whereClause,
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      user: true,
      customer: true,
      branch: true,
      cart: true,
      cartItem: {
        include: {
          product: true,
          unitOfMeasure: true,
        },
      },
      product: true,
      createdBy: true,
      updatedBy: true,
    },
  });

  return waitlists;
};
module.exports = {
  getCartById,
  getCartByUserId,
  getCartByIdByUser,
  getAllCarts,
  createOrUpdateCart,
  addItemToCart,
  updateCartItem,
  removeItemFromCart,
  assignCustomerToCart,
  checkoutCart,
  clearCart,
  deleteCart,
  updateCartTotals,
  convertOrderToCart,
  // Waitlist functions
  addToWaitlist,
  clearWaitlist,
  removeItemFromWaitlist,
  getWaitlistsByUser,
  getAllWaitlists,
  convertCustomerWaitlistToCart,
};
