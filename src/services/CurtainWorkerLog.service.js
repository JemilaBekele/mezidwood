const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Get CurtainWorkerLog by ID (helper function)
const getCurtainWorkerLogById = async (id) => {
  const curtainWorkerLog = await prisma.curtainWorkerLog.findUnique({
    where: { id },
    include: {
      curtainMeasurement: true,
      worker: true,
      workerlogcreatedBy: true,
      shopProductVariant: {
        include: {
          shopStock: {
            include: {
              shop: true,
              product: true,
            },
          },
        },
      },
    },
  });
  return curtainWorkerLog;
};
// 1. Create CurtainWorkerLog
// 1. Create CurtainWorkerLog
const createCurtainWorkerLog = async (logBody) => {
  // Validate that curtain measurement exists
  const curtainMeasurement = await prisma.curtainMeasurement.findUnique({
    where: { id: logBody.curtainMeasurementId },
  });

  if (!curtainMeasurement) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Curtain measurement not found');
  }

  // Determine which worker to use based on workerType
  let workerId = null;

  if (logBody.workerType === 'THICK') {
    workerId = curtainMeasurement.thickWorkerId;
    if (!workerId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'No thick worker assigned to this curtain measurement',
      );
    }
  } else if (logBody.workerType === 'THIN') {
    workerId = curtainMeasurement.thinWorkerId;
    if (!workerId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'No thin worker assigned to this curtain measurement',
      );
    }
  } else {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid worker type');
  }

  // Validate that the worker exists
  const worker = await prisma.user.findUnique({
    where: { id: workerId },
  });

  if (!worker) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Worker not found');
  }

  // If shopProductVariantId is provided, validate it exists and has sufficient stock
  if (logBody.shopProductVariantId) {
    const shopProductVariant = await prisma.shopProductVariant.findUnique({
      where: { id: logBody.shopProductVariantId },
      include: {
        shopStock: {
          include: {
            shop: true,
          },
        },
      },
    });

    if (!shopProductVariant) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Shop product variant not found',
      );
    }

    // Validate that the variant has sufficient quantity
    const quantityToAssign = logBody.quantityAssigned || 1;
    if (shopProductVariant.quantity < quantityToAssign) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Insufficient variant stock. Available: ${shopProductVariant.quantity}, Requested: ${quantityToAssign}`,
      );
    }
  }

  // Validate extrawidth values if provided (for shatter vertical curtains)
  if (
    logBody.extrawidthAssigned !== undefined &&
    logBody.extrawidthAssigned < 0
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Extra width assigned cannot be negative',
    );
  }

  if (
    logBody.extrawidthCompleted !== undefined &&
    logBody.extrawidthCompleted < 0
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Extra width completed cannot be negative',
    );
  }

  // Validate that completed values don't exceed assigned values
  if (
    logBody.widthmeterCompleted !== undefined &&
    logBody.widthmeterAssigned !== undefined
  ) {
    if (logBody.widthmeterCompleted > logBody.widthmeterAssigned) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Completed width cannot exceed assigned width',
      );
    }
  }

  if (
    logBody.heightmeterCompleted !== undefined &&
    logBody.heightmeterAssigned !== undefined
  ) {
    if (logBody.heightmeterCompleted > logBody.heightmeterAssigned) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Completed height cannot exceed assigned height',
      );
    }
  }

  if (
    logBody.extrawidthCompleted !== undefined &&
    logBody.extrawidthAssigned !== undefined
  ) {
    if (logBody.extrawidthCompleted > logBody.extrawidthAssigned) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Completed extra width cannot exceed assigned extra width',
      );
    }
  }

  if (
    logBody.quantityCompleted !== undefined &&
    logBody.quantityAssigned !== undefined
  ) {
    if (logBody.quantityCompleted > logBody.quantityAssigned) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Completed quantity cannot exceed assigned quantity',
      );
    }
  }

  // Remove workerId from logBody if present and use the one from measurement
  const { workerId: removedWorkerId, ...cleanLogBody } = logBody;

  const curtainWorkerLog = await prisma.curtainWorkerLog.create({
    data: {
      ...cleanLogBody,
      workerId, // Use worker ID from measurement
    },
    include: {
      curtainMeasurement: true,
      worker: true,
      workerlogcreatedBy: true,
      shopProductVariant: true, // Include the variant in the response
    },
  });

  return curtainWorkerLog;
};

// 2. Update CurtainWorkerLog
const updateCurtainWorkerLog = async (id, updateBody) => {
  const existingLog = await getCurtainWorkerLogById(id);

  if (!existingLog) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Curtain worker log not found');
  }

  // Define fields that cannot be updated once log is approved
  const cannotUpdateWhenApproved = [
    'curtainMeasurementId',
    'workerType',
    'shopProductVariantId',
    'workerId',
    'widthmeterAssigned',
    'heightmeterAssigned',
    'extrawidthAssigned',
    'quantityAssigned',
  ];

  // If log is approved, prevent updates to assigned fields
  if (existingLog.status === 'APPROVED') {
    for (const field of cannotUpdateWhenApproved) {
      if (
        updateBody[field] !== undefined &&
        updateBody[field] !== existingLog[field]
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Cannot update '${field}' on an approved worker log. Only completion fields (widthmeterCompleted, heightmeterCompleted, extrawidthCompleted, quantityCompleted, note) can be updated.`,
        );
      }
    }
  }

  // Allow updates to completed fields even when approved
  // Only these fields can be updated
  const allowedFields = [
    'widthmeterCompleted',
    'heightmeterCompleted',
    'extrawidthCompleted',
    'quantityCompleted',
    'note',
  ];

  // If log is not approved, also allow updates to assigned fields? No - assigned fields should not change after creation
  // For non-approved logs, still only allow updates to completed fields
  for (const field of Object.keys(updateBody)) {
    if (!allowedFields.includes(field) && field !== 'status') {
      // Check if the field is trying to change from existing value
      if (
        updateBody[field] !== undefined &&
        updateBody[field] !== existingLog[field]
      ) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Cannot update '${field}'. Only completion fields (widthmeterCompleted, heightmeterCompleted, extrawidthCompleted, quantityCompleted, note) can be updated.`,
        );
      }
    }
  }

  // Get current values for validation (existing or updated)
  const currentWidthCompleted =
    updateBody.widthmeterCompleted !== undefined
      ? updateBody.widthmeterCompleted
      : existingLog.widthmeterCompleted;
  const currentHeightCompleted =
    updateBody.heightmeterCompleted !== undefined
      ? updateBody.heightmeterCompleted
      : existingLog.heightmeterCompleted;
  const currentExtraWidthCompleted =
    updateBody.extrawidthCompleted !== undefined
      ? updateBody.extrawidthCompleted
      : existingLog.extrawidthCompleted;
  const currentQuantityCompleted =
    updateBody.quantityCompleted !== undefined
      ? updateBody.quantityCompleted
      : existingLog.quantityCompleted;

  // Validate that completed values don't exceed assigned values
  if (
    currentWidthCompleted !== undefined &&
    existingLog.widthmeterAssigned !== undefined
  ) {
    if (currentWidthCompleted > existingLog.widthmeterAssigned) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Completed width (${currentWidthCompleted}m) cannot exceed assigned width (${existingLog.widthmeterAssigned}m)`,
      );
    }
  }

  if (
    currentHeightCompleted !== undefined &&
    existingLog.heightmeterAssigned !== undefined
  ) {
    if (currentHeightCompleted > existingLog.heightmeterAssigned) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Completed height (${currentHeightCompleted}m) cannot exceed assigned height (${existingLog.heightmeterAssigned}m)`,
      );
    }
  }

  if (
    currentExtraWidthCompleted !== undefined &&
    existingLog.extrawidthAssigned !== undefined
  ) {
    if (currentExtraWidthCompleted > existingLog.extrawidthAssigned) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Completed extra width (${currentExtraWidthCompleted}m) cannot exceed assigned extra width (${existingLog.extrawidthAssigned}m)`,
      );
    }
  }

  if (
    currentQuantityCompleted !== undefined &&
    existingLog.quantityAssigned !== undefined
  ) {
    if (currentQuantityCompleted > existingLog.quantityAssigned) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Completed quantity (${currentQuantityCompleted}) cannot exceed assigned quantity (${existingLog.quantityAssigned})`,
      );
    }
  }

  // Check if all assigned work is now completed
  const isFullyCompleted =
    (existingLog.widthmeterAssigned === undefined ||
      (currentWidthCompleted !== undefined &&
        currentWidthCompleted >= existingLog.widthmeterAssigned)) &&
    (existingLog.heightmeterAssigned === undefined ||
      (currentHeightCompleted !== undefined &&
        currentHeightCompleted >= existingLog.heightmeterAssigned)) &&
    (existingLog.extrawidthAssigned === undefined ||
      (currentExtraWidthCompleted !== undefined &&
        currentExtraWidthCompleted >= existingLog.extrawidthAssigned)) &&
    (existingLog.quantityAssigned === undefined ||
      (currentQuantityCompleted !== undefined &&
        currentQuantityCompleted >= existingLog.quantityAssigned));

  // Prepare update data - only include allowed fields
  const updateData = {};
  if (updateBody.widthmeterCompleted !== undefined)
    updateData.widthmeterCompleted = updateBody.widthmeterCompleted;
  if (updateBody.heightmeterCompleted !== undefined)
    updateData.heightmeterCompleted = updateBody.heightmeterCompleted;
  if (updateBody.extrawidthCompleted !== undefined)
    updateData.extrawidthCompleted = updateBody.extrawidthCompleted;
  if (updateBody.quantityCompleted !== undefined)
    updateData.quantityCompleted = updateBody.quantityCompleted;
  if (updateBody.note !== undefined) updateData.note = updateBody.note;

  // Only auto-set status to COMPLETED if not already approved and all work is completed
  if (existingLog.status !== 'APPROVED' && isFullyCompleted) {
    updateData.status = 'COMPLETED';
  }

  // If no valid fields to update, return existing log
  if (Object.keys(updateData).length === 0) {
    return existingLog;
  }

  const updatedLog = await prisma.curtainWorkerLog.update({
    where: { id },
    data: updateData,
    include: {
      curtainMeasurement: true,
      worker: true,
      workerlogcreatedBy: true,
      shopProductVariant: true,
    },
  });

  return updatedLog;
};
// 3. View CurtainWorkerLogs by Employee ID
const getCurtainWorkerLogsByEmployee = async (workerId) => {
  // Validate that worker exists
  const worker = await prisma.user.findUnique({
    where: { id: workerId },
  });

  if (!worker) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Worker not found');
  }

  const curtainWorkerLogs = await prisma.curtainWorkerLog.findMany({
    where: { workerId },
    include: {
      curtainMeasurement: true,
      workerlogcreatedBy: true,
      shopProductVariant: {
        include: {
          shopStock: {
            include: {
              shop: true,
              product: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return {
    curtainWorkerLogs,
    count: curtainWorkerLogs.length,
    worker: {
      id: worker.id,
      name: worker.name,
      email: worker.email,
    },
  };
};

// 4. View CurtainWorkerLogs by Curtain Measurement ID
const getCurtainWorkerLogsByMeasurement = async (curtainMeasurementId) => {
  // Validate that curtain measurement exists
  const curtainMeasurement = await prisma.curtainMeasurement.findUnique({
    where: { id: curtainMeasurementId },
  });

  if (!curtainMeasurement) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Curtain measurement not found');
  }

  const curtainWorkerLogs = await prisma.curtainWorkerLog.findMany({
    where: { curtainMeasurementId },
    include: {
      worker: true,
      workerlogcreatedBy: true,
      shopProductVariant: {
        include: {
          shopStock: {
            include: {
              shop: true,
              product: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  // Calculate summary statistics with the updated field names
  const summary = {
    totalWidthAssigned: curtainWorkerLogs.reduce(
      (sum, log) => sum + (log.widthmeterAssigned || 0),
      0,
    ),
    totalWidthCompleted: curtainWorkerLogs.reduce(
      (sum, log) => sum + (log.widthmeterCompleted || 0),
      0,
    ),
    totalHeightAssigned: curtainWorkerLogs.reduce(
      (sum, log) => sum + (log.heightmeterAssigned || 0),
      0,
    ),
    totalHeightCompleted: curtainWorkerLogs.reduce(
      (sum, log) => sum + (log.heightmeterCompleted || 0),
      0,
    ),
    totalQuantityAssigned: curtainWorkerLogs.reduce(
      (sum, log) => sum + (log.quantityAssigned || 0),
      0,
    ),
    totalQuantityCompleted: curtainWorkerLogs.reduce(
      (sum, log) => sum + (log.quantityCompleted || 0),
      0,
    ),
    thickWorkersCount: curtainWorkerLogs.filter(
      (log) => log.workerType === 'THICK',
    ).length,
    thinWorkersCount: curtainWorkerLogs.filter(
      (log) => log.workerType === 'THIN',
    ).length,
  };

  return {
    curtainMeasurement: {
      id: curtainMeasurement.id,
      // Add other relevant curtain measurement fields as needed
    },
    curtainWorkerLogs,
    summary,
    count: curtainWorkerLogs.length,
  };
};
// Approve curtain worker log (with stock withdrawal from shop product variant)
const approveCurtainWorkerLog = async (logId, userId) => {
  console.log('🚀 Starting approveCurtainWorkerLog function');
  console.log('📝 Input params:', { logId, userId });

  try {
    const log = await prisma.curtainWorkerLog.findUnique({
      where: { id: logId },
      include: {
        curtainMeasurement: {
          include: {
            thickProduct: true,
            thinProduct: true,
            order: {
              include: {
                Shop: true,
              },
            },
          },
        },
        worker: true,
        shopProductVariant: {
          include: {
            shopStock: {
              include: {
                shop: true,
              },
            },
          },
        },
      },
    });

    if (!log) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Curtain worker log not found');
    }

    if (log.status !== 'PENDING') {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Log is already ${log.status.toLowerCase()}`,
      );
    }

    // Calculate width to cut per piece
    const widthPerPiece =
      (log.widthmeterAssigned || 0) + (log.extrawidthAssigned || 0);
    const quantityToWithdraw = log.quantityAssigned || 1;
    const { height } = log.shopProductVariant;

    console.log('📐 Cutting calculation:', {
      widthPerPiece,
      quantityToWithdraw,
      totalWidthToCut: widthPerPiece * quantityToWithdraw,
      height,
      explanation: 'Cutting from ONE physical piece only',
    });

    if (widthPerPiece <= 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Width per piece must be greater than 0. Current: ${widthPerPiece}m`,
      );
    }

    // Validate: Need at least 1 piece in stock
    if (log.shopProductVariant.quantity < 1) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Insufficient stock. Need at least 1 piece, but only have ${log.shopProductVariant.quantity}`,
      );
    }

    // Validate: Total width to cut cannot exceed original width
    const totalWidthToCut = widthPerPiece * quantityToWithdraw;
    const originalWidth = log.shopProductVariant.width;

    if (totalWidthToCut > originalWidth) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Cannot cut ${totalWidthToCut}m total width. Original piece width is only ${originalWidth}m. Each cut: ${widthPerPiece}m × ${quantityToWithdraw} pieces = ${totalWidthToCut}m required.`,
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const originalVariant = log.shopProductVariant;
      const remainingWidth = originalVariant.width - totalWidthToCut;

      console.log('📊 Stock transformation (cutting ONE piece):', {
        originalVariant: `${originalVariant.width}×${originalVariant.height}, qty ${originalVariant.quantity}`,
        action: `Take 1 piece of ${originalVariant.width}×${originalVariant.height}`,
        cuts: `${quantityToWithdraw} cuts of ${widthPerPiece}m each = ${totalWidthToCut}m removed`,
        remainingWidth: `${remainingWidth}m remaining on that piece`,
      });

      // STEP 1: Decrease original variant quantity by 1 (taking ONE piece)
      console.log(
        `✏️ Step 1: Taking 1 piece from stock (${originalVariant.quantity} → ${
          originalVariant.quantity - 1
        })`,
      );
      await tx.shopProductVariant.update({
        where: { id: originalVariant.id },
        data: {
          quantity: { decrement: 1 },
        },
      });

      // STEP 2: Create/update the cut-down remaining variant (only if width remains)
      let cutDownVariant = null;
      let isNewCutDownVariant = false;

      if (remainingWidth > 0) {
        console.log(
          `🔍 Step 2: Adding back the remaining piece (${remainingWidth}×${height}) to stock`,
        );

        // Check if variant with remaining width already exists
        const existingVariant = await tx.shopProductVariant.findFirst({
          where: {
            shopStockId: originalVariant.shopStockId,
            width: remainingWidth,
            height,
          },
        });

        if (existingVariant) {
          console.log(
            `✅ Existing variant found (${remainingWidth}×${height}), incrementing quantity by 1 (${
              existingVariant.quantity
            } → ${existingVariant.quantity + 1})`,
          );
          cutDownVariant = await tx.shopProductVariant.update({
            where: { id: existingVariant.id },
            data: {
              quantity: { increment: 1 },
            },
          });
          isNewCutDownVariant = false;
        } else {
          console.log(
            `✅ Creating new cut-down variant (${remainingWidth}×${height}) with quantity 1`,
          );
          cutDownVariant = await tx.shopProductVariant.create({
            data: {
              shopStockId: originalVariant.shopStockId,
              width: remainingWidth,
              height,
              quantity: 1,
            },
          });
          isNewCutDownVariant = true;
        }
      } else {
        console.log(
          `ℹ️ No remaining width, entire piece was fully consumed (${totalWidthToCut}m = ${originalWidth}m)`,
        );
      }

      // STEP 3: Update shop stock total quantity
      const netChange = remainingWidth > 0 ? 0 : -1;
      console.log(
        `✏️ Step 3: Updating shop stock total quantity (net change: ${netChange})`,
      );

      const shopStock = await tx.shopStock.findUnique({
        where: { id: originalVariant.shopStockId },
      });

      if (shopStock) {
        await tx.shopStock.update({
          where: { id: shopStock.id },
          data: {
            quantity: { increment: netChange },
          },
        });
        console.log(`✅ Shop stock total quantity updated (net: ${netChange})`);
      }

      // STEP 4: Create stock ledger entries
      const invoiceNo = `WITHDRAW-${log.workerType}-${Date.now()}`;
      console.log(`🧾 Invoice number: ${invoiceNo}`);

      // Entry for cut sections (consumed/used) - OUT movement
      console.log(
        `📝 Creating ledger entry for ${quantityToWithdraw} cut section(s) of ${widthPerPiece}×${height} (OUT - CONSUMED)`,
      );
      await tx.stockLedger.create({
        data: {
          productId:
            log.workerType === 'THICK'
              ? log.curtainMeasurement.thickProductId
              : log.curtainMeasurement.thinProductId,
          shopId: shopStock.shopId,
          invoiceNo,
          movementType: 'OUT',
          quantity: quantityToWithdraw,
          height,
          width: widthPerPiece,
          unitOfMeasureId: shopStock?.unitOfMeasureId,
          reference: `CUT-SECTIONS-${log.workerType}`,
          userId,
          notes: `CONSUMED: ${quantityToWithdraw} cut section(s) of ${widthPerPiece}m × ${height}m from a single ${originalVariant.width}×${height} piece. Each section: ${widthPerPiece}m width. Total width cut: ${totalWidthToCut}m.`,
          movementDate: new Date(),
        },
      });

      // Entry for the remaining piece - IN movement (not TRANSFORM)
      if (remainingWidth > 0 && isNewCutDownVariant) {
        console.log(
          `📝 Creating ledger entry for remaining piece (${remainingWidth}×${height}) - IN`,
        );
        await tx.stockLedger.create({
          data: {
            productId:
              log.workerType === 'THICK'
                ? log.curtainMeasurement.thickProductId
                : log.curtainMeasurement.thinProductId,
            shopId: shopStock.shopId,
            invoiceNo: `${invoiceNo}-REMAINING`,
            movementType: 'IN', // Changed from 'TRANSFORM' to 'IN'
            quantity: 1,
            height,
            width: remainingWidth,
            unitOfMeasureId: shopStock?.unitOfMeasureId,
            reference: `REMAINING-PIECE-${log.workerType}`,
            userId,
            notes: `Remaining piece after cutting ${totalWidthToCut}m from original ${originalVariant.width}×${height} piece. New dimensions: ${remainingWidth}×${height}.`,
            movementDate: new Date(),
          },
        });
      }

      // STEP 5: Update curtain worker log
      console.log(`✏️ Step 5: Updating curtain worker log status to APPROVED`);
      const updatedLog = await tx.curtainWorkerLog.update({
        where: { id: logId },
        data: {
          status: 'APPROVED',
          widthmeterCompleted: log.widthmeterAssigned,
          heightmeterCompleted: log.heightmeterAssigned,
          extrawidthCompleted: log.extrawidthAssigned,
          quantityCompleted: log.quantityAssigned,
        },
        include: {
          curtainMeasurement: true,
          worker: true,
          shopProductVariant: true,
        },
      });

      // STEP 6: Create system log
      console.log(`📝 Creating system log entry`);
      await tx.log.create({
        data: {
          action:
            `Approved curtain cutting for ${log.workerType} worker ${
              log.worker?.name || ''
            }. ` +
            `Took 1 piece of ${
              originalVariant.width
            }×${height} from stock (qty ${originalVariant.quantity} → ${
              originalVariant.quantity - 1
            }). ` +
            `Cut ${quantityToWithdraw} section(s) of ${widthPerPiece}×${height} (total ${totalWidthToCut}m). ` +
            `${
              remainingWidth > 0
                ? `Remaining piece (${remainingWidth}×${height}) returned to stock (+1 quantity).`
                : 'Entire piece fully consumed.'
            } ` +
            `Final stock: ${originalVariant.width}×${height} (qty ${
              originalVariant.quantity - 1
            }), ${
              remainingWidth > 0
                ? `${remainingWidth}×${height} (qty ${cutDownVariant.quantity})`
                : ''
            }`,
          userId,
        },
      });

      console.log(`🎉 Transaction completed successfully`);

      return {
        ...updatedLog,
        withdrawalDetails: {
          originalVariant: {
            id: originalVariant.id,
            width: originalVariant.width,
            height: originalVariant.height,
            oldQuantity: originalVariant.quantity,
            newQuantity: originalVariant.quantity - 1,
          },
          cuttingDetails: {
            piecesCut: quantityToWithdraw,
            widthPerCut: widthPerPiece,
            totalWidthCut: totalWidthToCut,
            height,
          },
          remainingPiece: cutDownVariant
            ? {
                width: remainingWidth,
                height,
                quantity: cutDownVariant.quantity,
                variantId: cutDownVariant.id,
              }
            : null,
        },
      };
    });

    console.log('✅ Function completed successfully');
    return result;
  } catch (error) {
    console.error('❌ Error in approveCurtainWorkerLog:', error);
    throw error;
  }
};
// Bulk approve multiple logs at once
const bulkApproveCurtainWorkerLogs = async (logIds, userId) => {
  if (!logIds || logIds.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No log IDs provided');
  }

  // Use Promise.allSettled to handle all approvals in parallel
  const results = await Promise.allSettled(
    logIds.map(async (logId) => {
      try {
        const result = await approveCurtainWorkerLog(logId, userId);
        return { logId, success: true, result };
      } catch (error) {
        return {
          logId,
          success: false,
          error: error.message,
        };
      }
    }),
  );

  // Separate successful and failed approvals
  const successful = results
    .filter((result) => result.status === 'fulfilled' && result.value.success)
    .map((result) => result.value.result);

  const failed = results
    .filter((result) => result.status === 'fulfilled' && !result.value.success)
    .map((result) => ({
      logId: result.value.logId,
      error: result.value.error,
    }));

  // Handle any unexpected promise rejections
  const rejected = results
    .filter((result) => result.status === 'rejected')
    .map((result) => ({
      logId: 'unknown',
      error: result.reason?.message || 'Unknown error',
    }));

  const allErrors = [...failed, ...rejected];

  return {
    approved: successful.length,
    failed: allErrors.length,
    results: successful,
    errors: allErrors.length > 0 ? allErrors : undefined,
  };
};

// Reject curtain worker log (without stock withdrawal)
const rejectCurtainWorkerLog = async (logId, userId, rejectionReason) => {
  const log = await prisma.curtainWorkerLog.findUnique({
    where: { id: logId },
  });

  if (!log) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Curtain worker log not found');
  }

  if (log.status !== 'PENDING') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Log is already ${log.status.toLowerCase()}`,
    );
  }

  const updatedLog = await prisma.$transaction(async (tx) => {
    const rejectedLog = await tx.curtainWorkerLog.update({
      where: { id: logId },
      data: {
        status: 'REJECTED',
        note: rejectionReason ? `REJECTED: ${rejectionReason}` : log.note,
      },
      include: {
        curtainMeasurement: true,
        worker: true,
        workerlogcreatedBy: true,
      },
    });

    // Create a log entry for the rejection
    await tx.log.create({
      data: {
        action: `Rejected curtain worker log for ${log.workerType} worker${
          log.worker?.name ? ` - ${log.worker.name}` : ''
        }${rejectionReason ? `: ${rejectionReason}` : ''}`,
        userId,
      },
    });

    return rejectedLog;
  });

  return updatedLog;
};
module.exports = {
  createCurtainWorkerLog,
  updateCurtainWorkerLog,
  getCurtainWorkerLogsByEmployee,
  getCurtainWorkerLogsByMeasurement,
  rejectCurtainWorkerLog,
  bulkApproveCurtainWorkerLogs,
};
