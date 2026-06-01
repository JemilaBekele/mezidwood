/* eslint-disable no-nested-ternary */
/* eslint-disable no-restricted-syntax */
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

/* ──────────────── CURTAIN MEASUREMENT ──────────────── */

const createCurtainMeasurement = async (
  curtainMeasurementData,
  createdById,
) => {
  const {
    orderId,
    roomName,
    width,
    height,
    curtainSize,
    quantity,

    // Thick curtain fields
    thickProductId,
    thickMeter,
    thickprice,

    // Thin curtain fields
    thinProductId,
    thinMeter,
    thinPrice,

    // Curtain pole fields
    curtainPoleId,
    curtainPoleQuantity,
    curtainPolePrice,

    // Curtain pulls fields
    curtainPullsId,
    curtainPullsQuantity,

    // Curtain brackets fields
    curtainBracketsId,
    curtainBracketsQuantity,
    curtainPullsBracketsPrice,

    // Worker fields
    thickWorkerId,
    thinWorkerId,
    workerPrice,
    totalworkerMeter,

    price,
    remark,
  } = curtainMeasurementData;

  // Validate required fields
  if (!orderId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Order ID is required');
  }
  if (!roomName) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Room name is required');
  }
  if (width === undefined || width === null) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Width is required');
  }
  if (height === undefined || height === null) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Height is required');
  }

  // Check if order exists
  const orderExists = await prisma.curtainOrder.findUnique({
    where: { id: orderId },
  });
  if (!orderExists) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Order not found');
  }

  // Check if thick product exists if provided
  if (thickProductId) {
    const thickProductExists = await prisma.product.findUnique({
      where: { id: thickProductId },
    });
    if (!thickProductExists) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Thick curtain product not found',
      );
    }
  }

  // Check if thin product exists if provided
  if (thinProductId) {
    const thinProductExists = await prisma.product.findUnique({
      where: { id: thinProductId },
    });
    if (!thinProductExists) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Thin curtain product not found',
      );
    }
  }

  // Check if curtain pole product exists if provided
  if (curtainPoleId) {
    const curtainPoleExists = await prisma.product.findUnique({
      where: { id: curtainPoleId },
    });
    if (!curtainPoleExists) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Curtain pole product not found',
      );
    }
  }

  // Check if curtain pulls product exists if provided
  if (curtainPullsId) {
    const curtainPullsExists = await prisma.product.findUnique({
      where: { id: curtainPullsId },
    });
    if (!curtainPullsExists) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Curtain pulls product not found',
      );
    }
  }

  // Check if curtain brackets product exists if provided
  if (curtainBracketsId) {
    const curtainBracketsExists = await prisma.product.findUnique({
      where: { id: curtainBracketsId },
    });
    if (!curtainBracketsExists) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Curtain brackets product not found',
      );
    }
  }

  // Check if thick worker exists if provided
  if (thickWorkerId) {
    const thickWorkerExists = await prisma.user.findUnique({
      where: { id: thickWorkerId },
    });
    if (!thickWorkerExists) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Thick curtain worker not found',
      );
    }
  }

  // Check if thin worker exists if provided
  if (thinWorkerId) {
    const thinWorkerExists = await prisma.user.findUnique({
      where: { id: thinWorkerId },
    });
    if (!thinWorkerExists) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Thin curtain worker not found',
      );
    }
  }

  // Validate numeric fields
  const numericWidth = parseFloat(width);
  const numericHeight = parseFloat(height);

  if (Number.isNaN(numericWidth) || numericWidth <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid width value');
  }
  if (Number.isNaN(numericHeight) || numericHeight <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid height value');
  }

  if (curtainSize !== undefined && curtainSize !== null) {
    const numericCurtainSize = parseFloat(curtainSize);
    if (Number.isNaN(numericCurtainSize) || numericCurtainSize <= 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid curtain size');
    }
  }

  if (quantity !== undefined && quantity !== null) {
    const numericQuantity = parseInt(quantity, 10);
    if (Number.isNaN(numericQuantity) || numericQuantity <= 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid quantity');
    }
  }

  // Validate thick curtain numeric fields
  if (thickMeter !== undefined && thickMeter !== null) {
    const numericThickMeter = parseInt(thickMeter, 10);
    if (Number.isNaN(numericThickMeter) || numericThickMeter < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid thick curtain meter value',
      );
    }
  }

  if (thickprice !== undefined && thickprice !== null) {
    const numericThickPrice = parseInt(thickprice, 10);
    if (Number.isNaN(numericThickPrice) || numericThickPrice < 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid thick curtain price');
    }
  }

  // Validate thin curtain numeric fields
  if (thinMeter !== undefined && thinMeter !== null) {
    const numericThinMeter = parseInt(thinMeter, 10);
    if (Number.isNaN(numericThinMeter) || numericThinMeter < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid thin curtain meter value',
      );
    }
  }

  if (thinPrice !== undefined && thinPrice !== null) {
    const numericThinPrice = parseInt(thinPrice, 10);
    if (Number.isNaN(numericThinPrice) || numericThinPrice < 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid thin curtain price');
    }
  }

  // Validate curtain pole numeric fields
  if (curtainPoleQuantity !== undefined && curtainPoleQuantity !== null) {
    const numericCurtainPoleQuantity = parseInt(curtainPoleQuantity, 10);
    if (
      Number.isNaN(numericCurtainPoleQuantity) ||
      numericCurtainPoleQuantity < 0
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid curtain pole quantity',
      );
    }
  }

  if (curtainPolePrice !== undefined && curtainPolePrice !== null) {
    const numericCurtainPolePrice = parseInt(curtainPolePrice, 10);
    if (Number.isNaN(numericCurtainPolePrice) || numericCurtainPolePrice < 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid curtain pole price');
    }
  }

  // Validate curtain pulls quantity
  if (curtainPullsQuantity !== undefined && curtainPullsQuantity !== null) {
    const numericCurtainPullsQuantity = parseInt(curtainPullsQuantity, 10);
    if (
      Number.isNaN(numericCurtainPullsQuantity) ||
      numericCurtainPullsQuantity < 0
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid curtain pulls quantity',
      );
    }
  }

  // Validate curtain brackets quantity
  if (
    curtainBracketsQuantity !== undefined &&
    curtainBracketsQuantity !== null
  ) {
    const numericCurtainBracketsQuantity = parseInt(
      curtainBracketsQuantity,
      10,
    );
    if (
      Number.isNaN(numericCurtainBracketsQuantity) ||
      numericCurtainBracketsQuantity < 0
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid curtain brackets quantity',
      );
    }
  }

  if (
    curtainPullsBracketsPrice !== undefined &&
    curtainPullsBracketsPrice !== null
  ) {
    const numericCurtainPullsBracketsPrice = parseInt(
      curtainPullsBracketsPrice,
      10,
    );
    if (
      Number.isNaN(numericCurtainPullsBracketsPrice) ||
      numericCurtainPullsBracketsPrice < 0
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Invalid curtain pulls/brackets price',
      );
    }
  }

  // Validate worker fields
  if (workerPrice !== undefined && workerPrice !== null) {
    const numericWorkerPrice = parseInt(workerPrice, 10);
    if (Number.isNaN(numericWorkerPrice) || numericWorkerPrice < 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid worker price');
    }
  }

  if (totalworkerMeter !== undefined && totalworkerMeter !== null) {
    const numericTotalWorkerMeter = parseInt(totalworkerMeter, 10);
    if (Number.isNaN(numericTotalWorkerMeter) || numericTotalWorkerMeter < 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid total worker meter');
    }
  }

  if (price !== undefined && price !== null) {
    const numericPrice = parseFloat(price);
    if (Number.isNaN(numericPrice) || numericPrice < 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid price');
    }
  }

  // Validate that at least one curtain type (thick or thin) has product selected
  if (!thickProductId && !thinProductId) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'At least one curtain product (thick or thin) must be selected',
    );
  }

  // Prepare data
  const data = {
    orderId,
    roomName,
    width: numericWidth,
    height: numericHeight,
    curtainSize: curtainSize !== undefined ? parseFloat(curtainSize) : null,
    quantity: quantity !== undefined ? parseInt(quantity, 10) : null,

    // Thick curtain fields
    thickProductId: thickProductId || null,
    thickMeter: thickMeter !== undefined ? parseInt(thickMeter, 10) : null,
    thickprice: thickprice !== undefined ? parseInt(thickprice, 10) : null,

    // Thin curtain fields
    thinProductId: thinProductId || null,
    thinMeter: thinMeter !== undefined ? parseInt(thinMeter, 10) : null,
    thinPrice: thinPrice !== undefined ? parseInt(thinPrice, 10) : null,

    // Curtain pole fields
    curtainPoleId: curtainPoleId || null,
    curtainPoleQuantity:
      curtainPoleQuantity !== undefined
        ? parseInt(curtainPoleQuantity, 10)
        : null,
    curtainPolePrice:
      curtainPolePrice !== undefined ? parseInt(curtainPolePrice, 10) : null,

    // Curtain pulls fields
    curtainPullsId: curtainPullsId || null,
    curtainPullsQuantity:
      curtainPullsQuantity !== undefined
        ? parseInt(curtainPullsQuantity, 10)
        : null,

    // Curtain brackets fields
    curtainBracketsId: curtainBracketsId || null,
    curtainBracketsQuantity:
      curtainBracketsQuantity !== undefined
        ? parseInt(curtainBracketsQuantity, 10)
        : null,
    curtainPullsBracketsPrice:
      curtainPullsBracketsPrice !== undefined
        ? parseInt(curtainPullsBracketsPrice, 10)
        : null,

    // Worker fields
    thickWorkerId: thickWorkerId || null,
    thinWorkerId: thinWorkerId || null,
    workerPrice: workerPrice !== undefined ? parseInt(workerPrice, 10) : null,
    totalworkerMeter:
      totalworkerMeter !== undefined ? parseInt(totalworkerMeter, 10) : null,

    price: price !== undefined ? parseFloat(price) : null,
    remark: remark || null,
    createdById: createdById || null,
  };

 const createdMeasurement = await prisma.curtainMeasurement.create({
    data,
    include: {
      order: { include: { customer: true } },
      thickProduct: true,
      thinProduct: true,
      curtainPole: true,
      curtainPulls: true,
      curtainBrackets: true,
      thickWorker: { select: { id: true, name: true, email: true, phone: true } },
      thinWorker: { select: { id: true, name: true, email: true, phone: true } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  // ================= 🔥 ADD PRICE TO ORDER TOTAL =================

  if (data.price) {
    const currentOrder = await prisma.curtainOrder.findUnique({
      where: { id: orderId },
      select: { totalAmount: true },
    });

    const currentTotal = currentOrder?.totalAmount
      ? Number(currentOrder.totalAmount)
      : 0;

    const newTotal = currentTotal + Number(data.price);

    await prisma.curtainOrder.update({
      where: { id: orderId },
      data: {
        totalAmount: newTotal,
      },
    });
  }

  return createdMeasurement;
};

// Update CurtainMeasurement
const updateCurtainMeasurement = async (id, updateBody) => {
  const existing = await prisma.curtainMeasurement.findUnique({
    where: { id },
    include: {
      thickProduct: true,
      thinProduct: true,
      curtainPole: true,
      curtainPulls: true,
      curtainBrackets: true,
      thickWorker: true,
      thinWorker: true,
      createdBy: true,
    },
  });

  if (!existing) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Curtain measurement not found');
  }

  const {
    roomName,
    width,
    height,
    curtainSize,
    quantity,

    // Thick curtain fields
    thickProductId,
    thickMeter,
    thickprice,

    // Thin curtain fields
    thinProductId,
    thinMeter,
    thinPrice,

    // Curtain pole fields
    curtainPoleId,
    curtainPoleQuantity,
    curtainPolePrice,

    // Curtain pulls fields
    curtainPullsId,
    curtainPullsQuantity,

    // Curtain brackets fields
    curtainBracketsId,
    curtainBracketsQuantity,
    curtainPullsBracketsPrice,

    // Worker fields
    thickWorkerId,
    thinWorkerId,
    workerPrice,
    totalworkerMeter,

    price,
    remark,
  } = updateBody;

  // Validate thick product if being updated
  if (
    thickProductId !== undefined &&
    thickProductId !== existing.thickProductId
  ) {
    if (thickProductId) {
      const thickProductExists = await prisma.product.findUnique({
        where: { id: thickProductId },
      });
      if (!thickProductExists) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Thick curtain product not found',
        );
      }
    }
  }

  // Validate thin product if being updated
  if (thinProductId !== undefined && thinProductId !== existing.thinProductId) {
    if (thinProductId) {
      const thinProductExists = await prisma.product.findUnique({
        where: { id: thinProductId },
      });
      if (!thinProductExists) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Thin curtain product not found',
        );
      }
    }
  }

  // Validate curtain pole product if being updated
  if (curtainPoleId !== undefined && curtainPoleId !== existing.curtainPoleId) {
    if (curtainPoleId) {
      const curtainPoleExists = await prisma.product.findUnique({
        where: { id: curtainPoleId },
      });
      if (!curtainPoleExists) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Curtain pole product not found',
        );
      }
    }
  }

  // Validate curtain pulls product if being updated
  if (
    curtainPullsId !== undefined &&
    curtainPullsId !== existing.curtainPullsId
  ) {
    if (curtainPullsId) {
      const curtainPullsExists = await prisma.product.findUnique({
        where: { id: curtainPullsId },
      });
      if (!curtainPullsExists) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Curtain pulls product not found',
        );
      }
    }
  }

  // Validate curtain brackets product if being updated
  if (
    curtainBracketsId !== undefined &&
    curtainBracketsId !== existing.curtainBracketsId
  ) {
    if (curtainBracketsId) {
      const curtainBracketsExists = await prisma.product.findUnique({
        where: { id: curtainBracketsId },
      });
      if (!curtainBracketsExists) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Curtain brackets product not found',
        );
      }
    }
  }

  // Validate thick worker if being updated
  if (thickWorkerId !== undefined && thickWorkerId !== existing.thickWorkerId) {
    if (thickWorkerId) {
      const thickWorkerExists = await prisma.user.findUnique({
        where: { id: thickWorkerId },
      });
      if (!thickWorkerExists) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Thick curtain worker not found',
        );
      }
    }
  }

  // Validate thin worker if being updated
  if (thinWorkerId !== undefined && thinWorkerId !== existing.thinWorkerId) {
    if (thinWorkerId) {
      const thinWorkerExists = await prisma.user.findUnique({
        where: { id: thinWorkerId },
      });
      if (!thinWorkerExists) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Thin curtain worker not found',
        );
      }
    }
  }

  // Validate numeric fields
  let numericWidth;
  if (width !== undefined) {
    numericWidth = parseFloat(width);
    if (Number.isNaN(numericWidth) || numericWidth <= 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid width value');
    }
  }

  let numericHeight;
  if (height !== undefined) {
    numericHeight = parseFloat(height);
    if (Number.isNaN(numericHeight) || numericHeight <= 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid height value');
    }
  }

  let numericCurtainSize;
  if (curtainSize !== undefined) {
    if (curtainSize === null) {
      numericCurtainSize = null;
    } else {
      numericCurtainSize = parseFloat(curtainSize);
      if (Number.isNaN(numericCurtainSize) || numericCurtainSize <= 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid curtain size');
      }
    }
  }

  let numericQuantity;
  if (quantity !== undefined) {
    if (quantity === null) {
      numericQuantity = null;
    } else {
      numericQuantity = parseInt(quantity, 10);
      if (Number.isNaN(numericQuantity) || numericQuantity <= 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid quantity');
      }
    }
  }

  // Validate thick curtain numeric fields
  let numericThickMeter;
  if (thickMeter !== undefined) {
    if (thickMeter === null) {
      numericThickMeter = null;
    } else {
      numericThickMeter = parseInt(thickMeter, 10);
      if (Number.isNaN(numericThickMeter) || numericThickMeter < 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Invalid thick curtain meter value',
        );
      }
    }
  }

  let numericThickPrice;
  if (thickprice !== undefined) {
    if (thickprice === null) {
      numericThickPrice = null;
    } else {
      numericThickPrice = parseInt(thickprice, 10);
      if (Number.isNaN(numericThickPrice) || numericThickPrice < 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Invalid thick curtain price',
        );
      }
    }
  }

  // Validate thin curtain numeric fields
  let numericThinMeter;
  if (thinMeter !== undefined) {
    if (thinMeter === null) {
      numericThinMeter = null;
    } else {
      numericThinMeter = parseInt(thinMeter, 10);
      if (Number.isNaN(numericThinMeter) || numericThinMeter < 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Invalid thin curtain meter value',
        );
      }
    }
  }

  let numericThinPrice;
  if (thinPrice !== undefined) {
    if (thinPrice === null) {
      numericThinPrice = null;
    } else {
      numericThinPrice = parseInt(thinPrice, 10);
      if (Number.isNaN(numericThinPrice) || numericThinPrice < 0) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Invalid thin curtain price',
        );
      }
    }
  }

  // Validate curtain pole numeric fields
  let numericCurtainPoleQuantity;
  if (curtainPoleQuantity !== undefined) {
    if (curtainPoleQuantity === null) {
      numericCurtainPoleQuantity = null;
    } else {
      numericCurtainPoleQuantity = parseInt(curtainPoleQuantity, 10);
      if (
        Number.isNaN(numericCurtainPoleQuantity) ||
        numericCurtainPoleQuantity < 0
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Invalid curtain pole quantity',
        );
      }
    }
  }

  let numericCurtainPolePrice;
  if (curtainPolePrice !== undefined) {
    if (curtainPolePrice === null) {
      numericCurtainPolePrice = null;
    } else {
      numericCurtainPolePrice = parseInt(curtainPolePrice, 10);
      if (
        Number.isNaN(numericCurtainPolePrice) ||
        numericCurtainPolePrice < 0
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Invalid curtain pole price',
        );
      }
    }
  }

  // Validate curtain pulls quantity
  let numericCurtainPullsQuantity;
  if (curtainPullsQuantity !== undefined) {
    if (curtainPullsQuantity === null) {
      numericCurtainPullsQuantity = null;
    } else {
      numericCurtainPullsQuantity = parseInt(curtainPullsQuantity, 10);
      if (
        Number.isNaN(numericCurtainPullsQuantity) ||
        numericCurtainPullsQuantity < 0
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Invalid curtain pulls quantity',
        );
      }
    }
  }

  // Validate curtain brackets quantity
  let numericCurtainBracketsQuantity;
  if (curtainBracketsQuantity !== undefined) {
    if (curtainBracketsQuantity === null) {
      numericCurtainBracketsQuantity = null;
    } else {
      numericCurtainBracketsQuantity = parseInt(curtainBracketsQuantity, 10);
      if (
        Number.isNaN(numericCurtainBracketsQuantity) ||
        numericCurtainBracketsQuantity < 0
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Invalid curtain brackets quantity',
        );
      }
    }
  }

  let numericCurtainPullsBracketsPrice;
  if (curtainPullsBracketsPrice !== undefined) {
    if (curtainPullsBracketsPrice === null) {
      numericCurtainPullsBracketsPrice = null;
    } else {
      numericCurtainPullsBracketsPrice = parseInt(
        curtainPullsBracketsPrice,
        10,
      );
      if (
        Number.isNaN(numericCurtainPullsBracketsPrice) ||
        numericCurtainPullsBracketsPrice < 0
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Invalid curtain pulls/brackets price',
        );
      }
    }
  }

  // Validate worker fields
  let numericWorkerPrice;
  if (workerPrice !== undefined) {
    if (workerPrice === null) {
      numericWorkerPrice = null;
    } else {
      numericWorkerPrice = parseInt(workerPrice, 10);
      if (Number.isNaN(numericWorkerPrice) || numericWorkerPrice < 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid worker price');
      }
    }
  }

  let numericTotalWorkerMeter;
  if (totalworkerMeter !== undefined) {
    if (totalworkerMeter === null) {
      numericTotalWorkerMeter = null;
    } else {
      numericTotalWorkerMeter = parseInt(totalworkerMeter, 10);
      if (
        Number.isNaN(numericTotalWorkerMeter) ||
        numericTotalWorkerMeter < 0
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'Invalid total worker meter',
        );
      }
    }
  }

  let numericPrice;
  if (price !== undefined) {
    if (price === null) {
      numericPrice = null;
    } else {
      numericPrice = parseFloat(price);
      if (Number.isNaN(numericPrice) || numericPrice < 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid price');
      }
    }
  }

  // Validate that at least one curtain type (thick or thin) has product selected if updating
  if (
    (thickProductId !== undefined || thinProductId !== undefined) &&
    !(
      thickProductId ||
      thinProductId ||
      (thickProductId === undefined ? existing.thickProductId : false) ||
      (thinProductId === undefined ? existing.thinProductId : false)
    )
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'At least one curtain product (thick or thin) must be selected',
    );
  }

  // Prepare update data
  const updateData = {};

  if (roomName !== undefined) updateData.roomName = roomName;
  if (width !== undefined) updateData.width = numericWidth;
  if (height !== undefined) updateData.height = numericHeight;
  if (curtainSize !== undefined) updateData.curtainSize = numericCurtainSize;
  if (quantity !== undefined) updateData.quantity = numericQuantity;

  // Thick curtain fields
  if (thickProductId !== undefined)
    updateData.thickProductId = thickProductId || null;
  if (thickMeter !== undefined) updateData.thickMeter = numericThickMeter;
  if (thickprice !== undefined) updateData.thickprice = numericThickPrice;

  // Thin curtain fields
  if (thinProductId !== undefined)
    updateData.thinProductId = thinProductId || null;
  if (thinMeter !== undefined) updateData.thinMeter = numericThinMeter;
  if (thinPrice !== undefined) updateData.thinPrice = numericThinPrice;

  // Curtain pole fields
  if (curtainPoleId !== undefined)
    updateData.curtainPoleId = curtainPoleId || null;
  if (curtainPoleQuantity !== undefined)
    updateData.curtainPoleQuantity = numericCurtainPoleQuantity;
  if (curtainPolePrice !== undefined)
    updateData.curtainPolePrice = numericCurtainPolePrice;

  // Curtain pulls fields
  if (curtainPullsId !== undefined)
    updateData.curtainPullsId = curtainPullsId || null;
  if (curtainPullsQuantity !== undefined)
    updateData.curtainPullsQuantity = numericCurtainPullsQuantity;

  // Curtain brackets fields
  if (curtainBracketsId !== undefined)
    updateData.curtainBracketsId = curtainBracketsId || null;
  if (curtainBracketsQuantity !== undefined)
    updateData.curtainBracketsQuantity = numericCurtainBracketsQuantity;
  if (curtainPullsBracketsPrice !== undefined)
    updateData.curtainPullsBracketsPrice = numericCurtainPullsBracketsPrice;

  // Worker fields
  if (thickWorkerId !== undefined)
    updateData.thickWorkerId = thickWorkerId || null;
  if (thinWorkerId !== undefined)
    updateData.thinWorkerId = thinWorkerId || null;
  if (workerPrice !== undefined) updateData.workerPrice = numericWorkerPrice;
  if (totalworkerMeter !== undefined)
    updateData.totalworkerMeter = numericTotalWorkerMeter;

  if (price !== undefined) updateData.price = numericPrice;
  if (remark !== undefined) updateData.remark = remark || null;

  return prisma.curtainMeasurement.update({
    where: { id },
    data: updateData,
    include: {
      order: {
        include: {
          customer: true,
        },
      },
      thickProduct: true,
      thinProduct: true,
      curtainPole: true,
      curtainPulls: true,
      curtainBrackets: true,
      thickWorker: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
      thinWorker: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });
};

/* ──────────────── EXPORTS ──────────────── */
module.exports = {
  // CurtainMeasurement
  createCurtainMeasurement,
  updateCurtainMeasurement,
};
