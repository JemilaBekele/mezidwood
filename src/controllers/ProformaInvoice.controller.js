const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { proformaInvoiceService } = require('../services');
const ApiError = require('../utils/ApiError');
const money = require('../utils/money');

// Create Proforma Invoice
// Create Proforma Invoice
const createProformaInvoice = catchAsync(async (req, res) => {
  // Structure files by field name with detailed logging
  const structuredFiles = {};

  if (Array.isArray(req.files)) {
    req.files.forEach((file, index) => {
      if (!structuredFiles[file.fieldname]) {
        structuredFiles[file.fieldname] = [];
      }
      structuredFiles[file.fieldname].push(file);
    });
  } else if (req.files) {
    for (const [fieldname, files] of Object.entries(req.files)) {
      structuredFiles[fieldname] = Array.isArray(files) ? files : [files];
    }
  }

  // Parse items if it's a string (from form-data)
  if (req.body.items) {
    if (typeof req.body.items === 'string') {
      try {
        req.body.items = JSON.parse(req.body.items);
      } catch (error) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Invalid items format: ${error.message}`,
        );
      }
    }
  }

  // Add item index for file matching and initialize images array
  if (Array.isArray(req.body.items)) {
    req.body.items = req.body.items.map((item, index) => ({
      ...item,
      itemIndex: index,
      // Initialize images array if not present
      images: item.images && Array.isArray(item.images) ? item.images : [],
    }));
  }

  // Process and map image files to their respective items
  if (
    Array.isArray(req.body.items) &&
    Object.keys(structuredFiles).length > 0
  ) {
    req.body.items.forEach((item, index) => {
      // Check for multiple images using the pattern "items[0].images"
      const itemImageField = `items[${item.itemIndex}].images`;
      const itemFiles = structuredFiles[itemImageField];

      if (itemFiles && Array.isArray(itemFiles) && itemFiles.length > 0) {
        // Store the files in the item for processing by the service
        item.uploadedImages = itemFiles;
      } else {
        // Also check for legacy single image field pattern
        const legacyImageField = `items[${item.itemIndex}].image`;
        const legacyFiles = structuredFiles[legacyImageField];

        if (
          legacyFiles &&
          Array.isArray(legacyFiles) &&
          legacyFiles.length > 0
        ) {
          item.uploadedImages = legacyFiles;
        }
      }
    });
  }

  try {
    const proformaInvoice = await proformaInvoiceService.createProformaInvoice(
      req.body,
      req.user.id,
      structuredFiles,
    );

    res.status(httpStatus.CREATED).send({
      success: true,
      message: 'Proforma invoice created successfully',
      proformaInvoice,
    });
  } catch (error) {
    // Check if it's already an ApiError
    if (error instanceof ApiError) {
      throw error;
    }

    // Convert to ApiError if not
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to create proforma invoice: ${error.message}`,
    );
  }
});

// Update Proforma Invoice updateProformaInvoiceseco
const updateProformaInvoice = catchAsync(async (req, res) => {
  // Structure files by field name with detailed logging
  const structuredFiles = {};

  if (Array.isArray(req.files)) {
    req.files.forEach((file, index) => {
      if (!structuredFiles[file.fieldname]) {
        structuredFiles[file.fieldname] = [];
      }
      structuredFiles[file.fieldname].push(file);
    });
  } else if (req.files) {
    for (const [fieldname, files] of Object.entries(req.files)) {
      structuredFiles[fieldname] = Array.isArray(files) ? files : [files];
    }
  }

  // Parse items if it's a string (from form-data)
  if (req.body.items) {
    if (typeof req.body.items === 'string') {
      try {
        req.body.items = JSON.parse(req.body.items);
      } catch (error) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Invalid items format: ${error.message}`,
        );
      }
    }
  }

  // Add item index for file matching and preserve existing images
  if (Array.isArray(req.body.items)) {
    req.body.items = req.body.items.map((item, index) => ({
      ...item,
      itemIndex: index,
      // Preserve existing images if they're provided in the update
      images: item.images && Array.isArray(item.images) ? item.images : [],
      // Track which images to delete (if specified)
      deleteImageIds:
        item.deleteImageIds && Array.isArray(item.deleteImageIds)
          ? item.deleteImageIds
          : [],
    }));
  }

  // Process and map image files to their respective items for update
  if (
    Array.isArray(req.body.items) &&
    Object.keys(structuredFiles).length > 0
  ) {
    req.body.items.forEach((item, index) => {
      // Check for multiple images using the pattern "items[0].images"
      const itemImageField = `items[${item.itemIndex}].images`;
      const itemFiles = structuredFiles[itemImageField];

      if (itemFiles && Array.isArray(itemFiles) && itemFiles.length > 0) {
        // Store the files in the item for processing by the service
        item.newImages = itemFiles;
      } else {
        // Also check for legacy single image field pattern
        const legacyImageField = `items[${item.itemIndex}].image`;
        const legacyFiles = structuredFiles[legacyImageField];

        if (
          legacyFiles &&
          Array.isArray(legacyFiles) &&
          legacyFiles.length > 0
        ) {
          item.newImages = legacyFiles;
        }
      }
    });
  }

  try {
    const invoice = await proformaInvoiceService.updateProformaInvoice(
      req.params.id,
      req.body,
      structuredFiles,
    );

    res.status(httpStatus.OK).send({
      success: true,
      message: 'Proforma invoice updated successfully',
      invoice,
    });
  } catch (error) {
    // Check if it's already an ApiError
    if (error instanceof ApiError) {
      throw error;
    }

    // Convert to ApiError if not
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to update proforma invoice: ${error.message}`,
    );
  }
});
const updateProformaInvoiceseco = catchAsync(async (req, res) => {
  // Structure files by field name with detailed logging
  const structuredFiles = {};

  if (Array.isArray(req.files)) {
    req.files.forEach((file, index) => {
      if (!structuredFiles[file.fieldname]) {
        structuredFiles[file.fieldname] = [];
      }
      structuredFiles[file.fieldname].push(file);
    });
  } else if (req.files) {
    for (const [fieldname, files] of Object.entries(req.files)) {
      structuredFiles[fieldname] = Array.isArray(files) ? files : [files];
    }
  }

  // Parse items if it's a string (from form-data)
  if (req.body.items) {
    if (typeof req.body.items === 'string') {
      try {
        req.body.items = JSON.parse(req.body.items);
      } catch (error) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Invalid items format: ${error.message}`,
        );
      }
    }
  }

  // Add item index for file matching and preserve existing images
  if (Array.isArray(req.body.items)) {
    req.body.items = req.body.items.map((item, index) => ({
      ...item,
      itemIndex: index,
      // Preserve existing images if they're provided in the update
      images: item.images && Array.isArray(item.images) ? item.images : [],
      // Track which images to delete (if specified)
      deleteImageIds:
        item.deleteImageIds && Array.isArray(item.deleteImageIds)
          ? item.deleteImageIds
          : [],
    }));
  }

  // Process and map image files to their respective items for update
  if (
    Array.isArray(req.body.items) &&
    Object.keys(structuredFiles).length > 0
  ) {
    req.body.items.forEach((item, index) => {
      // Check for multiple images using the pattern "items[0].images"
      const itemImageField = `items[${item.itemIndex}].images`;
      const itemFiles = structuredFiles[itemImageField];

      if (itemFiles && Array.isArray(itemFiles) && itemFiles.length > 0) {
        // Store the files in the item for processing by the service
        item.newImages = itemFiles;
      } else {
        // Also check for legacy single image field pattern
        const legacyImageField = `items[${item.itemIndex}].image`;
        const legacyFiles = structuredFiles[legacyImageField];

        if (
          legacyFiles &&
          Array.isArray(legacyFiles) &&
          legacyFiles.length > 0
        ) {
          item.newImages = legacyFiles;
        }
      }
    });
  }

  try {
    const invoice = await proformaInvoiceService.updateProformaInvoiceseco(
      req.params.id,
      req.body,
      structuredFiles,
    );

    res.status(httpStatus.OK).send({
      success: true,
      message: 'Proforma invoice updated successfully',
      invoice,
    });
  } catch (error) {
    // Check if it's already an ApiError
    if (error instanceof ApiError) {
      throw error;
    }

    // Convert to ApiError if not
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to update proforma invoice: ${error.message}`,
    );
  }
});
// Get Proforma Invoice by ID
const getProformaInvoice = catchAsync(async (req, res) => {
  const invoice = await proformaInvoiceService.getProformaInvoiceById(
    req.params.id,
  );
  res.status(httpStatus.OK).send({
    success: true,
    invoice,
  });
});

// Get all Proforma Invoices
const getProformaInvoices = catchAsync(async (req, res) => {
  const filters = {
    search: req.query.search,
    status: req.query.status,
    customerId: req.query.customerId,
    startDate: req.query.startDate,
    endDate: req.query.endDate,
    page: parseInt(req.query.page, 10) || 1,
    limit: parseInt(req.query.limit, 10) || 10,
    sortBy: req.query.sortBy || 'createdAt',
    sortOrder: req.query.sortOrder || 'desc',
  };

  const result = await proformaInvoiceService.getAllProformaInvoices(filters);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getAllProformaInvoicesmy = catchAsync(async (req, res) => {
  const filters = {
    search: req.query.search,
    status: req.query.status,
    customerId: req.query.customerId,
    startDate: req.query.startDate,
    endDate: req.query.endDate,
    page: parseInt(req.query.page, 10) || 1,
    limit: parseInt(req.query.limit, 10) || 10,
    sortBy: req.query.sortBy || 'createdAt',
    sortOrder: req.query.sortOrder || 'desc',
  };

  const result = await proformaInvoiceService.getAllProformaInvoicesmy(
    filters,
    req.user.id,
  );

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Get Proforma Invoice by PI Number
const getProformaInvoiceByPInumber = catchAsync(async (req, res) => {
  const { piNumber } = req.params;

  if (!piNumber) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'PI number is required',
    });
  }

  const invoice = await proformaInvoiceService.getProformaInvoiceByPInumber(
    piNumber,
  );

  if (!invoice) {
    return res.status(httpStatus.NOT_FOUND).send({
      success: false,
      error: 'Proforma invoice not found',
    });
  }

  res.status(httpStatus.OK).send({
    success: true,
    invoice,
  });
});

// Delete Proforma Invoice
const deleteProformaInvoice = catchAsync(async (req, res) => {
  await proformaInvoiceService.deleteProformaInvoice(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Proforma invoice deleted successfully',
  });
});

// Update Proforma Invoice Status
const updateProformaInvoiceStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status, approvedById } = req.body;

  if (!status) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Status is required',
    });
  }

  const invoice = await proformaInvoiceService.updateProformaInvoiceStatus(
    id,
    status,
    approvedById,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: `Proforma invoice status updated to ${status}`,
    invoice,
  });
});

// Add Payment to Proforma Invoice
const addPaymentToInvoice = catchAsync(async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id;

  const { amountPaid, amountDate, bankId, paidBy } = req.body;
  // ✅ Validate amount
  if (!amountPaid || Number(amountPaid) <= 0) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Valid payment amount is required',
    });
  }

  const invoice = await proformaInvoiceService.addPayment(
    id,
    Number(amountPaid),
    amountDate,
    bankId,
    paidBy,
    userId,
    // ✅ NEW: pass bankId
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Payment added successfully',
    invoice,
  });
});

// Get Proforma Invoice Summary (for dashboard)
const getInvoiceSummary = catchAsync(async (req, res) => {
  const { period = 'month' } = req.query; // day, week, month, year

  try {
    // Calculate date range based on period.
    // NOTE: Date setters MUTATE the receiver. Deriving `startDate` from `now`
    // via `now.setDate(...)` also moved `now` itself, so the window's end was
    // taken from an already-rewound clock. Each branch now works on its own copy.
    const endDate = new Date();
    const startDate = new Date(endDate);

    switch (period) {
      case 'day':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      case 'month':
      default:
        startDate.setMonth(startDate.getMonth() - 1);
        break;
    }

    // Get invoices for the period
    const invoices = await proformaInvoiceService.getAllProformaInvoices({
      startDate,
      endDate,
      limit: 1000, // Get all invoices for summary
    });

    // Calculate summary statistics.
    // money.sum() is required here: total/amountPaid/balance are Decimal
    // columns, and `+` on Decimal instances concatenates strings.
    const summary = {
      totalInvoices: invoices.invoices.length,
      totalAmount: money.sum(invoices.invoices.map((inv) => inv.total)),
      totalPaid: money.sum(invoices.invoices.map((inv) => inv.amountPaid)),
      totalBalance: money.sum(invoices.invoices.map((inv) => inv.balance)),
      statusCounts: {},
      period: {
        start: startDate,
        end: endDate,
        type: period,
      },
    };

    // Count by status
    invoices.invoices.forEach((invoice) => {
      summary.statusCounts[invoice.status] =
        (summary.statusCounts[invoice.status] || 0) + 1;
    });

    res.status(httpStatus.OK).send({
      success: true,
      summary,
    });
  } catch (error) {
    res.status(httpStatus.INTERNAL_SERVER_ERROR).send({
      success: false,
      error: 'Failed to get invoice summary',
    });
  }
});

// Generate Proforma Invoice Report
const generateInvoiceReport = catchAsync(async (req, res) => {
  const { startDate, endDate, customerId, status } = req.query;

  try {
    // Get invoices based on filters
    const filters = {
      startDate,
      endDate,
      customerId,
      status,
      limit: 1000, // Get all matching invoices for report
    };

    const result = await proformaInvoiceService.getAllProformaInvoices(filters);

    // Default JSON response
    res.status(httpStatus.OK).send({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(httpStatus.INTERNAL_SERVER_ERROR).send({
      success: false,
      error: 'Failed to generate invoice report',
    });
  }
});

// Validate PI Number (for form validation)
const validatePINumber = catchAsync(async (req, res) => {
  const { piNumber } = req.query;

  if (!piNumber) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'PI number is required',
    });
  }

  const invoice = await proformaInvoiceService.getProformaInvoiceByPInumber(
    piNumber,
  );

  res.status(httpStatus.OK).send({
    success: true,
    exists: !!invoice,
    message: invoice ? 'PI number already exists' : 'PI number is available',
  });
});
const updateProformaInvoiceAdditionalQuantity = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { materialUpdates } = req.body;

  if (materialUpdates === undefined || materialUpdates === null) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'materialUpdates is required',
    });
  }

  const invoice =
    await proformaInvoiceService.updateProformaInvoiceAdditionalQuantity(
      id,
      materialUpdates,
    );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Proforma invoice additional quantity updated successfully',
    invoice,
  });
});
const addAttachments = catchAsync(async (req, res) => {
  const { invoiceId } = req.params;

  // Get files from request
  let files = [];
  if (Array.isArray(req.files)) {
    files = req.files;
  } else if (req.files) {
    // If using fields, extract all files
    for (const [fieldname, fileList] of Object.entries(req.files)) {
      if (Array.isArray(fileList)) {
        files = files.concat(fileList);
      } else {
        files.push(fileList);
      }
    }
  }

  // Check if files exist
  if (!files || files.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'At least one file is required');
  }

  try {
    const result = await proformaInvoiceService.addProformaInvoiceAttachment(
      invoiceId,
      files,
    );

    res.status(httpStatus.OK).send({
      success: true,
      message: result.message,
      data: {
        attachments: result.attachments,
        invoiceId: result.invoiceId,
        totalAttachments: result.attachments.length,
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
      `Failed to add attachments: ${error.message}`,
    );
  }
});
module.exports = {
  addAttachments,
  createProformaInvoice,
  getProformaInvoice,
  getProformaInvoices,
  getProformaInvoiceByPInumber,
  updateProformaInvoice,
  updateProformaInvoiceseco,
  deleteProformaInvoice,
  updateProformaInvoiceStatus,
  addPaymentToInvoice,
  getInvoiceSummary,
  generateInvoiceReport,
  validatePINumber,
  updateProformaInvoiceAdditionalQuantity,
  getAllProformaInvoicesmy,
};
