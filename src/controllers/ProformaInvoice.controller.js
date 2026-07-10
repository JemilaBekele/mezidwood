const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { proformaInvoiceService } = require('../services');

// Create Proforma Invoice
// Create Proforma Invoice
const createProformaInvoice = catchAsync(async (req, res) => {
  // Log body fields (excluding files)
  Object.keys(req.body).forEach((key) => {
    if (key !== 'items') {
      console.log(
        `   - ${key}:`,
        typeof req.body[key] === 'string' && req.body[key].length > 100
          ? `${req.body[key].substring(0, 100)}...`
          : req.body[key],
      );
    }
  });

  // Structure files by field name with detailed logging
  const structuredFiles = {};

  if (Array.isArray(req.files)) {
    console.log('   - Files found as array, count:', req.files.length);
    req.files.forEach((file, index) => {
      console.log(`   [${index}] File fieldname: "${file.fieldname}"`);
      console.log(`       Original name: "${file.originalname}"`);
      console.log(`       Mimetype: "${file.mimetype}"`);
      console.log(`       Size: ${file.size} bytes`);

      if (!structuredFiles[file.fieldname]) {
        structuredFiles[file.fieldname] = [];
      }
      structuredFiles[file.fieldname].push(file);
    });
  } else if (req.files) {
    console.log('   - Files found as object');
    for (const [fieldname, files] of Object.entries(req.files)) {
      console.log(`   - Field: "${fieldname}"`);
      console.log(
        `     Type: ${Array.isArray(files) ? 'Array' : typeof files}`,
      );
      console.log(`     Count: ${Array.isArray(files) ? files.length : 1}`);

      if (Array.isArray(files)) {
        files.forEach((file, index) => {
          console.log(
            `     [${index}] Name: "${file.originalname}", Type: "${file.mimetype}"`,
          );
        });
      }

      structuredFiles[fieldname] = Array.isArray(files) ? files : [files];
    }
  } else {
    console.log('   - No files found in request');
  }

  console.log('7. Structured files keys:', Object.keys(structuredFiles));
  console.log('   Detailed structure:');
  Object.keys(structuredFiles).forEach((key) => {
    console.log(`   - "${key}": ${structuredFiles[key].length} file(s)`);
    structuredFiles[key].forEach((file, index) => {
      console.log(
        `     [${index}] ${file.originalname} (${file.mimetype}, ${file.size} bytes)`,
      );
    });
  });

  // Parse items if it's a string (from form-data)
  if (req.body.items) {
    console.log('8. Items field found, type:', typeof req.body.items);
    console.log(
      '   Raw items value (first 200 chars):',
      req.body.items.substring
        ? req.body.items.substring(0, 200) +
            (req.body.items.length > 200 ? '...' : '')
        : req.body.items,
    );

    if (typeof req.body.items === 'string') {
      try {
        console.log('   - Parsing items JSON string');
        req.body.items = JSON.parse(req.body.items);
        console.log(
          '   - Items parsed successfully, count:',
          req.body.items.length,
        );
        console.log(
          '   - Sample item:',
          JSON.stringify(req.body.items[0], null, 2),
        );
      } catch (error) {
        console.error('   - Failed to parse items JSON:', error.message);
        console.error('   - Error stack:', error.stack);
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Invalid items format: ${error.message}`,
        );
      }
    }
  } else {
    console.log('8. No items field found in request');
  }

  // Add item index for file matching and initialize images array
  if (Array.isArray(req.body.items)) {
    console.log('9. Adding item indices and initializing images arrays');
    req.body.items = req.body.items.map((item, index) => ({
      ...item,
      itemIndex: index,
      // Initialize images array if not present
      images: item.images && Array.isArray(item.images) ? item.images : [],
    }));
    console.log(`   - Added indices to ${req.body.items.length} items`);

    // Log item details for debugging
    req.body.items.forEach((item, index) => {
      console.log(`   Item ${index}:`);
      console.log(`     - Description: ${item.description}`);
      console.log(`     - Quantity: ${item.quantity}`);
      console.log(`     - Unit Price: ${item.unitPrice}`);
      console.log(`     - Has existing images: ${item.images?.length || 0}`);
      console.log(`     - Item Index: ${item.itemIndex}`);
    });
  }

  // Process and map image files to their respective items
  if (
    Array.isArray(req.body.items) &&
    Object.keys(structuredFiles).length > 0
  ) {
    console.log('10. Processing image files for items...');

    req.body.items.forEach((item, index) => {
      // Check for multiple images using the pattern "items[0].images"
      const itemImageField = `items[${item.itemIndex}].images`;
      const itemFiles = structuredFiles[itemImageField];

      if (itemFiles && Array.isArray(itemFiles) && itemFiles.length > 0) {
        console.log(
          `   - Item ${item.itemIndex}: Found ${itemFiles.length} image(s) for field "${itemImageField}"`,
        );
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
          console.log(
            `   - Item ${item.itemIndex}: Found ${legacyFiles.length} legacy image(s) for field "${legacyImageField}"`,
          );
          item.uploadedImages = legacyFiles;
        } else {
          console.log(`   - Item ${item.itemIndex}: No images found`);
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

    // Log image counts per item
    if (proformaInvoice?.items) {
      proformaInvoice.items.forEach((item, idx) => {
        console.log(`   Item ${idx} - Images: ${item.images?.length || 0}`);
      });
    }

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

  console.log('=== CREATE PROFORMA INVOICE CONTROLLER END ===');
});

// Update Proforma Invoice
const updateProformaInvoice = catchAsync(async (req, res) => {
  Object.keys(req.body).forEach((key) => {
    if (key !== 'items') {
      console.log(
        `   - ${key}:`,
        typeof req.body[key] === 'string' && req.body[key].length > 100
          ? `${req.body[key].substring(0, 100)}...`
          : req.body[key],
      );
    }
  });

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
      console.log(`   - Field: "${fieldname}"`);
      console.log(
        `     Type: ${Array.isArray(files) ? 'Array' : typeof files}`,
      );

      if (Array.isArray(files)) {
        files.forEach((file, index) => {
          console.log(
            `     [${index}] Name: "${file.originalname}", Type: "${file.mimetype}"`,
          );
        });
      }

      structuredFiles[fieldname] = Array.isArray(files) ? files : [files];
    }
  } else {
    console.log('   - No files found in request');
  }

  Object.keys(structuredFiles).forEach((key) => {
    structuredFiles[key].forEach((file, index) => {
      console.log(
        `     [${index}] ${file.originalname} (${file.mimetype}, ${file.size} bytes)`,
      );
    });
  });

  // Parse items if it's a string (from form-data)
  if (req.body.items) {
    if (typeof req.body.items === 'string') {
      try {
        req.body.items = JSON.parse(req.body.items);

        if (req.body.items.length > 0) {
          console.log(
            '   - Sample item:',
            JSON.stringify(req.body.items[0], null, 2),
          );
        }
      } catch (error) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Invalid items format: ${error.message}`,
        );
      }
    }
  } else {
    console.log('9. No items field found in request');
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

    // Log item details for debugging
    req.body.items.forEach((item, index) => {});
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
        } else {
          console.log(`   - Item ${item.itemIndex}: No new images found`);
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

    // Log image counts per item
    if (invoice?.items) {
      invoice.items.forEach((item, idx) => {
        console.log(`   Item ${idx} - Images: ${item.images?.length || 0}`);
      });
    }

    res.status(httpStatus.OK).send({
      success: true,
      message: 'Proforma invoice updated successfully',
      invoice,
    });
  } catch (error) {
    console.error('ERROR in updateProformaInvoice controller:', error);

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
    // Calculate date range based on period
    const now = new Date();
    let startDate;

    switch (period) {
      case 'day':
        startDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        startDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case 'year':
        startDate = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      default:
        startDate = new Date(now.setMonth(now.getMonth() - 1));
    }

    // Get invoices for the period
    const invoices = await proformaInvoiceService.getAllProformaInvoices({
      startDate,
      endDate: new Date(),
      limit: 1000, // Get all invoices for summary
    });

    // Calculate summary statistics
    const summary = {
      totalInvoices: invoices.invoices.length,
      totalAmount: invoices.invoices.reduce((sum, inv) => sum + inv.total, 0),
      totalPaid: invoices.invoices.reduce(
        (sum, inv) => sum + inv.amountPaid,
        0,
      ),
      totalBalance: invoices.invoices.reduce(
        (sum, inv) => sum + inv.balance,
        0,
      ),
      statusCounts: {},
      period: {
        start: startDate,
        end: new Date(),
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
module.exports = {
  createProformaInvoice,
  getProformaInvoice,
  getProformaInvoices,
  getProformaInvoiceByPInumber,
  updateProformaInvoice,
  deleteProformaInvoice,
  updateProformaInvoiceStatus,
  addPaymentToInvoice,
  getInvoiceSummary,
  generateInvoiceReport,
  validatePINumber,
  updateProformaInvoiceAdditionalQuantity,
  getAllProformaInvoicesmy,
};
