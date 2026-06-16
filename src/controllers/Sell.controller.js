const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { sellService } = require('../services');
const ApiError = require('../utils/ApiError');

// ==================== CREATE SELL ====================
const createSell = catchAsync(async (req, res) => {
  const userId = req.user.id;

  const sell = await sellService.createSell(req.body, userId);
  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Sale created successfully',
    sell,
  });
});

// ==================== GET SELL BY ID ====================
const getSell = catchAsync(async (req, res) => {
  const sell = await sellService.getSellById(req.params.id);
  if (!sell) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    sell,
  });
});

// ==================== GET SELL BY INVOICE NUMBER ====================
const getSellByInvoiceNo = catchAsync(async (req, res) => {
  const sell = await sellService.getSellByInvoiceNo(req.params.invoiceNo);
  if (!sell) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    sell,
  });
});

// ==================== GET ALL SELLS ====================
const getSells = catchAsync(async (req, res) => {
  const { startDate, endDate, saleStatus, customerId } = req.query;

  const result = await sellService.getAllSells({
    startDate,
    endDate,
    saleStatus,
    customerId,
  });

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getAllSellsnotApproved = catchAsync(async (req, res) => {
  const { startDate, endDate, saleStatus, customerId } = req.query;

  const result = await sellService.getAllSellsnotApproved({
    startDate,
    endDate,
    saleStatus,
    customerId,
  });

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getSellbyuser = catchAsync(async (req, res) => {
  const { startDate, endDate, saleStatus } = req.query;
  const createdById = req.user.id;

  const result = await sellService.getAllSells({
    startDate,
    endDate,
    saleStatus,
    createdById,
  });

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// ==================== UPDATE SELL ====================
const updateSell = catchAsync(async (req, res) => {
  const userId = req.user.id;

  const sell = await sellService.updateSell(req.params.id, req.body, userId);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Sale updated successfully',
    sell,
  });
});

// ==================== DELETE SELL ====================
const deleteSell = catchAsync(async (req, res) => {
  const userId = req.user.id;
  await sellService.deleteSell(req.params.id, userId);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Sale deleted successfully',
  });
});

// ==================== ADD SELL PAYMENT ====================
const addSellPayment = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { id: sellId } = req.params;

  if (!sellId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Sell ID is required');
  }

  const result = await sellService.addSellPayment(sellId, req.body, userId);

  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Payment added successfully',
    data: result,
  });
});

// ==================== GET SELL PAYMENT HISTORY ====================
const getSellPaymentHistory = catchAsync(async (req, res) => {
  const { sellId } = req.params;

  if (!sellId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Sell ID is required');
  }

  const result = await sellService.getSellPaymentHistory(sellId);

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Payment history fetched successfully',
    data: result,
  });
});

// ==================== UPDATE SALE STATUS ====================
const updateSaleStatus = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { newStatus } = req.body;

  if (!newStatus) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'New status is required');
  }

  const sale = await sellService.updateSaleStatus(id, newStatus, userId);
  res.status(httpStatus.OK).send({
    success: true,
    message: `Sale status updated to ${newStatus}`,
    sale,
  });
});

// ==================== CANCEL SALE ====================
const cancelSale = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  const sale = await sellService.cancelSale(id, userId);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Sale cancelled successfully',
    sale,
  });
});

// ==================== UNLOCK SELL ====================
const unlockSell = catchAsync(async (req, res) => {
  const sell = await sellService.unlockSell(req.params.id);
  if (!sell) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sale not found');
  }
  res.status(httpStatus.OK).send({
    success: true,
    sell,
  });
});

// ==================== GET SELL STATISTICS ====================
const getSellStatistics = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  const statistics = await sellService.getSellStatistics({
    startDate,
    endDate,
  });

  res.status(httpStatus.OK).send({
    success: true,
    statistics,
  });
});
const deliverSaleItems = catchAsync(async (req, res) => {
  const { saleId } = req.params;
  const { deliveryItems } = req.body;

  // assuming user is attached from auth middleware
  const userId = req.user?.id;

  if (!deliveryItems || !Array.isArray(deliveryItems)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'deliveryItems must be a valid array',
    );
  }

  const result = await sellService.deliverSaleItems(
    saleId,
    deliveryItems,
    userId,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Sale items delivered successfully',
    data: result,
  });
});
const addSellFiles = catchAsync(async (req, res) => {
  // Log body fields

  // Structure files by field name with detailed logging
  const structuredFiles = {};

  if (req.files) {
    for (const [fieldname, files] of Object.entries(req.files)) {
      structuredFiles[fieldname] = files;

      files.forEach((file, index) => {
        console.log(`     [${index}] File details:`, {
          fieldname: file.fieldname,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          path: file.path,
          destination: file.destination,
          filename: file.filename,
        });
      });
    }
  } else {
    console.log('   - No files found in request');
  }

  // Validate sell ID
  const sellId = req.params.id;
  if (!sellId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Sell ID is required');
  }

  // Validate user is authenticated
  if (!req.user || !req.user.id) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'User not authenticated');
  }

  // Validate at least one file is provided
  if (Object.keys(structuredFiles).length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'At least one file (image or document) is required',
    );
  }

  try {
    const result = await sellService.addSellFiles(
      sellId,
      req.user.id,
      structuredFiles,
    );

    res.status(httpStatus.OK).send({
      success: true,
      message: result.message,
      data: {
        id: result.data.id,
        invoiceNo: result.data.invoiceNo,
        imageUrl: result.data.imageUrl,
        documentUrl: result.data.documentUrl,
      },
    });
  } catch (error) {
    // Check if it's already an ApiError
    if (error instanceof ApiError) {
      throw error;
    }

    // Convert to ApiError if not
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to add files to sell: ${error.message}`,
    );
  }
});
// ==================== EXPORTS ====================
module.exports = {
  deliverSaleItems,
  getAllSellsnotApproved,
  createSell,
  getSell,
  getSellByInvoiceNo,
  getSells,
  updateSell,
  deleteSell,
  addSellPayment,
  getSellPaymentHistory,
  updateSaleStatus,
  cancelSale,
  unlockSell,
  getSellStatistics,
  getSellbyuser,
  addSellFiles,
};
