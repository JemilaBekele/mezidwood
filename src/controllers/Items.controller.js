const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { itemService } = require('../services');

// Create Item
const createItem = catchAsync(async (req, res) => {

  // Structure files by field name
  const structuredFiles = {};

  // Handle both formats (object from .fields() or array from .any())
  if (req.files) {
    if (Array.isArray(req.files)) {
      // If using .any(), files come as array
      req.files.forEach((file) => {
        if (!structuredFiles[file.fieldname]) {
          structuredFiles[file.fieldname] = [];
        }
        structuredFiles[file.fieldname].push(file);
      });
    } else {
      // If using .fields(), files come as object
      Object.keys(req.files).forEach((fieldname) => {
        const files = req.files[fieldname];
        if (files && files.length > 0) {
          structuredFiles[fieldname] = files;
        }
      });
    }
  }

  // Ensure image fields exist
  structuredFiles.image = structuredFiles.image || undefined;
  structuredFiles.images = structuredFiles.images || undefined;


  // Parse request body
  const itemData = { ...req.body };

  // Parse materials if it's a JSON string
  if (itemData.materials && typeof itemData.materials === 'string') {
    try {
      itemData.materials = JSON.parse(itemData.materials);
    } catch (error) {
      return res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        error: 'Invalid materials format. Expected valid JSON string.',
      });
    }
  }

  // Parse price to number if it's a string
  if (itemData.price && typeof itemData.price === 'string') {
    itemData.price = parseFloat(itemData.price);
  }



  const item = await itemService.createItem(itemData, structuredFiles);

  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'Item created successfully',
    data: item,
  });
});

// Update Item
// Update Item
// Update Item
const updateItem = catchAsync(async (req, res) => {

  // Structure files by field name
  const structuredFiles = {};

  // When using .fields(), req.files is an object with field names as keys
  if (req.files) {
    // Handle both formats (object from .fields() or array from .any())
    if (Array.isArray(req.files)) {
      // If using .any(), files come as array
      req.files.forEach((file) => {
        if (!structuredFiles[file.fieldname]) {
          structuredFiles[file.fieldname] = [];
        }
        structuredFiles[file.fieldname].push(file);
      });
    } else {
      // If using .fields(), files come as object
      Object.keys(req.files).forEach((fieldname) => {
        const files = req.files[fieldname];
        if (files && files.length > 0) {
          structuredFiles[fieldname] = files;
        }
      });
    }
  }

  // Ensure image fields exist
  structuredFiles.image = structuredFiles.image || undefined;
  structuredFiles.images = structuredFiles.images || undefined;


  // Parse update body
  const updateBody = { ...req.body };

  // Parse materials if it's a JSON string
  if (updateBody.materials && typeof updateBody.materials === 'string') {
    try {
      updateBody.materials = JSON.parse(updateBody.materials);
    } catch (error) {
      return res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        error: 'Invalid materials format. Expected valid JSON string.',
      });
    }
  }

  // Parse imagesToDelete if it's a string
  if (updateBody.imagesToDelete && typeof updateBody.imagesToDelete === 'string') {
    try {
      updateBody.imagesToDelete = JSON.parse(updateBody.imagesToDelete);
    } catch (error) {
      return res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        error: 'Invalid imagesToDelete format. Expected valid JSON string array.',
      });
    }
  }

  // Parse price to number if it's a string
  if (updateBody.price && typeof updateBody.price === 'string') {
    updateBody.price = parseFloat(updateBody.price);
  }

  // Handle image removal
  if (updateBody.imageUrl === 'null' || updateBody.imageUrl === '') {
    updateBody.imageUrl = null;
  }


  const item = await itemService.updateItem(
    req.params.id,
    updateBody,
    structuredFiles,
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Item updated successfully',
    data: item,
  });
});

// Get Item by ID
const getItem = catchAsync(async (req, res) => {
  const item = await itemService.getItemById(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    item,
  });
});

// Get All Items
const getAllItems = catchAsync(async (req, res) => {
  const result = await itemService.getAllItems();
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getAllItemslist = catchAsync(async (req, res) => {
  const result = await itemService.getAllItemslist();
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
// Get All Items
const getAllItemsimple = catchAsync(async (req, res) => {
  const result = await itemService.getAllItemsimple();
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Delete Item
const deleteItem = catchAsync(async (req, res) => {
  await itemService.deleteItem(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Item deleted successfully',
  });
});
// Get All Proforma Invoices and Sales
const getAllProformaInvoicesAndSales = catchAsync(async (req, res) => {
  const {
    startDate,
    endDate,
    status,
    paymentStatus,
    createdById,
    customerId,
    storeId,
    searchTerm,
    type,
    page,
    limit,
  } = req.query;

  const filters = {
    startDate,
    endDate,
    status,
    paymentStatus,
    createdById,
    customerId,
    storeId,
    searchTerm,
    type,
    page: page ? Number(page) : 1,
    limit: limit ? Number(limit) : 50,
  };

  const result = await itemService.getAllProformaInvoicesAndSales(filters);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getItemDetail = catchAsync(async (req, res) => {
  const item = await itemService.getItemByIddetail(req.params.id);

  res.status(httpStatus.OK).send({
    success: true,
    item,
  });
});
const acceptInitialItemStock = catchAsync(async (req, res) => {
  console.log('Accepting initial item stock with data:', req.body);

  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Items array is required');
  }

  const result = await itemService.acceptInitialItemStockBulk(
    items,
    req.user.id,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Initial stock processed successfully',
    data: result,
  });
});
module.exports = {
  acceptInitialItemStock,
  getItemDetail,
  getAllItemslist,
  getAllProformaInvoicesAndSales,
  createItem,
  getItem,
  getAllItems,
  getAllItemsimple,
  updateItem,
  deleteItem,
};
