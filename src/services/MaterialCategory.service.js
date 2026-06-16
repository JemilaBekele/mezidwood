/* eslint-disable no-restricted-syntax */
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Create Material Category
const createMaterialCategory = async (data) => {
  const { name } = data;

  // Validate required fields
  if (!name) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Category name is required');
  }

  // Validate category name is not empty
  if (name.trim().length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Category name cannot be empty');
  }

  // Check if category already exists with same name
  const existingCategory = await prisma.materialCategory.findFirst({
    where: { name: name.trim() },
  });

  if (existingCategory) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Material category already exists: ${name}`,
    );
  }

  // Create material category
  const materialCategory = await prisma.materialCategory.create({
    data: {
      name: name.trim(),
    },
  });

  return materialCategory;
};

// Update Material Category
const updateMaterialCategory = async (id, updateBody) => {
  // Check if category exists
  const existingCategory = await prisma.materialCategory.findUnique({
    where: { id },
  });

  if (!existingCategory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Material category not found');
  }

  // Clean the updateBody to remove any undefined or null values
  const cleanedUpdateBody = {};
  for (const [key, value] of Object.entries(updateBody)) {
    if (value !== undefined && value !== null) {
      const cleanKey = key.replace(/[^a-zA-Z0-9]/g, '');
      cleanedUpdateBody[cleanKey] =
        typeof value === 'string' ? value.trim() : value;
    }
  }

  // Validate category name if provided
  if (cleanedUpdateBody.name !== undefined) {
    if (cleanedUpdateBody.name.length === 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Category name cannot be empty',
      );
    }

    // Check if name already exists for another category
    const existingWithName = await prisma.materialCategory.findFirst({
      where: {
        name: cleanedUpdateBody.name,
        id: { not: id },
      },
    });

    if (existingWithName) {
      throw new ApiError(
        httpStatus.CONFLICT,
        `Material category already exists: ${cleanedUpdateBody.name}`,
      );
    }
  }

  // Update material category
  const updatedCategory = await prisma.materialCategory.update({
    where: { id },
    data: cleanedUpdateBody,
  });

  return updatedCategory;
};

// Delete Material Category
const deleteMaterialCategory = async (id) => {
  // Check if category exists
  const existingCategory = await prisma.materialCategory.findUnique({
    where: { id },
    include: {
      materials: {
        select: { id: true },
      },
    },
  });

  if (!existingCategory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Material category not found');
  }

  // Check if category has associated materials
  if (existingCategory.materials && existingCategory.materials.length > 0) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'Cannot delete category because it has associated materials. Remove or reassign materials first.',
    );
  }

  // Delete material category
  await prisma.materialCategory.delete({
    where: { id },
  });

  return { message: 'Material category deleted successfully' };
};

// Get all Material Categories
const getAllMaterialCategories = async () => {
  const materialCategories = await prisma.materialCategory.findMany({});
  return {
    materialCategories,
    count: materialCategories.length,
  };
};

// Get Material Category by ID
const getMaterialCategoryById = async (id) => {
  const materialCategory = await prisma.materialCategory.findUnique({
    where: { id },
    include: {
      materials: {
        select: {
          id: true,
          name: true,
          // Add other material fields you want to include
        },
      },
    },
  });

  if (!materialCategory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Material category not found');
  }

  return materialCategory;
};

// Get Material Category by Name
const getMaterialCategoryByName = async (name) => {
  const materialCategory = await prisma.materialCategory.findFirst({
    where: { name: name.trim() },
  });

  return materialCategory;
};

module.exports = {
  createMaterialCategory,
  updateMaterialCategory,
  deleteMaterialCategory,
  getAllMaterialCategories,
  getMaterialCategoryById,
  getMaterialCategoryByName,
};
