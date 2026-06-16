const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { materialCategoryService } = require('../services');

// Create Material Category
const createMaterialCategory = async (req, res) => {
  try {
    console.log('=== CREATE MATERIAL CATEGORY CONTROLLER ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Request headers:', req.headers);
    console.log('Category data received:', req.body);
    
    const categoryData = req.body;
    
    // Log the data being sent to service
    console.log('Calling materialCategoryService.createMaterialCategory with:', categoryData);
    
    // Use the imported function
    const category = await materialCategoryService.createMaterialCategory(
      categoryData,
    );
    
    console.log('Service response - category created:', JSON.stringify(category, null, 2));
    console.log('=== CREATE SUCCESSFUL ===');

    res.status(201).json({
      success: true,
      data: category,
    });
  } catch (error) {
    console.log('=== ERROR IN CREATE MATERIAL CATEGORY ===');
    console.log('Error name:', error.name);
    console.log('Error message:', error.message);
    console.log('Error stack:', error.stack);
    console.log('Error code:', error.code);
    console.log('Error statusCode:', error.statusCode);
    console.log('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    
    // Log the request body again for context
    console.log('Request body at time of error:', JSON.stringify(req.body, null, 2));
    
    // Handle Prisma unique constraint violation for name
    if (error.code === 'P2002') {
      console.log('Prisma unique constraint violation detected');
      return res.status(400).json({
        success: false,
        error: `Material category already exists: ${req.body.name}`,
      });
    }

    // Handle your custom ApiError
    if (error.statusCode) {
      console.log('Custom ApiError detected with statusCode:', error.statusCode);
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    // Log any other type of error
    console.log('Unhandled error type, sending generic 500 response');
    
    // Generic error
    res.status(500).json({
      success: false,
      error: 'Failed to create material category',
    });
  }
};

// Get Material Category by ID
const getMaterialCategory = catchAsync(async (req, res) => {
  const category = await materialCategoryService.getMaterialCategoryById(
    req.params.id,
  );
  res.status(httpStatus.OK).send({
    success: true,
    category,
  });
});

// Get all Material Categories
const getMaterialCategories = catchAsync(async (req, res) => {
  const result = await materialCategoryService.getAllMaterialCategories();
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Get Material Category by Name
const getMaterialCategoryByName = catchAsync(async (req, res) => {
  const { name } = req.params;

  if (!name) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Category name parameter is required',
    });
  }

  const category = await materialCategoryService.getMaterialCategoryByName(
    name,
  );

  if (!category) {
    return res.status(httpStatus.NOT_FOUND).send({
      success: false,
      error: 'Material category not found',
    });
  }

  res.status(httpStatus.OK).send({
    success: true,
    category,
  });
});

// Update Material Category
const updateMaterialCategory = catchAsync(async (req, res) => {
  const category = await materialCategoryService.updateMaterialCategory(
    req.params.id,
    req.body,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Material category updated successfully',
    category,
  });
});

// Delete Material Category
const deleteMaterialCategory = catchAsync(async (req, res) => {
  await materialCategoryService.deleteMaterialCategory(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Material category deleted successfully',
  });
});

module.exports = {
  createMaterialCategory,
  getMaterialCategory,
  getMaterialCategories,
  getMaterialCategoryByName,
  updateMaterialCategory,
  deleteMaterialCategory,
};
