const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// ==================== ProductCategory Services ====================

const getProductCategoryById = async (id) => {
  const category = await prisma.productCategory.findUnique({
    where: { id },
    include: {
      items: {
        select: {
          id: true,
          name: true,
        },
      },
      sizes: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
  return category;
};

const getProductCategoryByName = async (name) => {
  const category = await prisma.productCategory.findFirst({
    where: { name },
  });
  return category;
};

const getAllProductCategories = async (filter = {}) => {
  const categories = await prisma.productCategory.findMany({
    where: filter,
    orderBy: {
      name: 'asc',
    },
    include: {
      _count: {
        select: {
          items: true,
          sizes: true,
        },
      },
    },
  });

  return {
    categories,
    count: categories.length,
  };
};

const createProductCategory = async (categoryBody) => {
  // Check if category with same name already exists
  if (await getProductCategoryByName(categoryBody.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Category name already exists');
  }

  const category = await prisma.productCategory.create({
    data: categoryBody,
  });
  return category;
};

const updateProductCategory = async (id, updateBody) => {
  const existingCategory = await getProductCategoryById(id);
  if (!existingCategory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product category not found');
  }

  // Check if name is being updated to an existing name
  if (updateBody.name && updateBody.name !== existingCategory.name) {
    if (await getProductCategoryByName(updateBody.name)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Category name already exists',
      );
    }
  }

  const updatedCategory = await prisma.productCategory.update({
    where: { id },
    data: updateBody,
  });

  return updatedCategory;
};

const deleteProductCategory = async (id) => {
  const existingCategory = await getProductCategoryById(id);
  if (!existingCategory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product category not found');
  }

  // Check if category has associated items or sizes
  const categoryWithRelations = await prisma.productCategory.findUnique({
    where: { id },
    include: {
      items: {
        take: 1,
      },
      sizes: {
        take: 1,
      },
    },
  });

  if (categoryWithRelations.items.length > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot delete category with associated products. Please reassign products first.',
    );
  }

  if (categoryWithRelations.sizes.length > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot delete category with associated sizes. Please delete or reassign sizes first.',
    );
  }

  await prisma.productCategory.delete({
    where: { id },
  });

  return { message: 'Product category deleted successfully' };
};

// ==================== Size Services ====================

const getSizeById = async (id) => {
  const size = await prisma.size.findUnique({
    where: { id },
    include: {
      category: {
        select: {
          id: true,
          name: true,
        },
      },
      items: {
        select: {
          id: true,
          name: true,
        },
      },
      productTypes: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
  return size;
};

const getSizeByNameAndCategory = async (name, categoryId) => {
  const size = await prisma.size.findFirst({
    where: {
      name,
      categoryId,
    },
  });
  return size;
};

const getAllSizes = async (filter = {}) => {
  const sizes = await prisma.size.findMany({
    where: filter,
    orderBy: {
      name: 'asc',
    },
    include: {
      category: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          items: true,
          productTypes: true,
        },
      },
    },
  });

  return {
    sizes,
    count: sizes.length,
  };
};

const getSizesByCategory = async (categoryId) => {
  // Check if category exists
  const category = await getProductCategoryById(categoryId);
  if (!category) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product category not found');
  }

  const sizes = await prisma.size.findMany({
    where: { categoryId },
    orderBy: {
      name: 'asc',
    },
    include: {
      productTypes: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return sizes;
};

const createSize = async (sizeBody) => {
  // Check if category exists
  const category = await getProductCategoryById(sizeBody.categoryId);
  if (!category) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product category not found');
  }

  // Check if size with same name already exists in this category
  if (await getSizeByNameAndCategory(sizeBody.name, sizeBody.categoryId)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Size name already exists in this category',
    );
  }

  const size = await prisma.size.create({
    data: sizeBody,
  });
  return size;
};

const updateSize = async (id, updateBody) => {
  const existingSize = await getSizeById(id);
  if (!existingSize) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Size not found');
  }

  // If category is being updated, check if new category exists
  if (
    updateBody.categoryId &&
    updateBody.categoryId !== existingSize.category.id
  ) {
    const category = await getProductCategoryById(updateBody.categoryId);
    if (!category) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        'New product category not found',
      );
    }
  }

  // Check if name is being updated and check uniqueness within category
  const newCategoryId = updateBody.categoryId || existingSize.category.id;
  if (updateBody.name && updateBody.name !== existingSize.name) {
    if (await getSizeByNameAndCategory(updateBody.name, newCategoryId)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Size name already exists in this category',
      );
    }
  }

  const updatedSize = await prisma.size.update({
    where: { id },
    data: updateBody,
  });

  return updatedSize;
};

const deleteSize = async (id) => {
  const existingSize = await getSizeById(id);
  if (!existingSize) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Size not found');
  }

  // Check if size has associated items or product types
  const sizeWithRelations = await prisma.size.findUnique({
    where: { id },
    include: {
      items: {
        take: 1,
      },
      productTypes: {
        take: 1,
      },
    },
  });

  if (sizeWithRelations.items.length > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot delete size with associated products. Please reassign products first.',
    );
  }

  if (sizeWithRelations.productTypes.length > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot delete size with associated product types. Please delete or reassign product types first.',
    );
  }

  await prisma.size.delete({
    where: { id },
  });

  return { message: 'Size deleted successfully' };
};

// ==================== ProductType Services ====================

const getProductTypeById = async (id) => {
  const productType = await prisma.productType.findUnique({
    where: { id },
    include: {
      size: {
        select: {
          id: true,
          name: true,
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      items: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
  return productType;
};

const getProductTypeByNameAndSize = async (name, sizeId) => {
  const productType = await prisma.productType.findFirst({
    where: {
      name,
      sizeId,
    },
  });
  return productType;
};

const getAllProductTypes = async (filter = {}) => {
  const productTypes = await prisma.productType.findMany({
    where: filter,
    orderBy: {
      name: 'asc',
    },
    include: {
      size: {
        select: {
          id: true,
          name: true,
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      _count: {
        select: { items: true },
      },
    },
  });

  return {
    productTypes,
    count: productTypes.length,
  };
};

const getProductTypesBySize = async (sizeId) => {
  // Check if size exists
  const size = await getSizeById(sizeId);
  if (!size) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Size not found');
  }

  const productTypes = await prisma.productType.findMany({
    where: { sizeId },
    orderBy: {
      name: 'asc',
    },
    include: {
      size: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return productTypes;
};

const createProductType = async (productTypeBody) => {
  // Check if size exists
  const size = await getSizeById(productTypeBody.sizeId);
  if (!size) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Size not found');
  }

  // Check if product type with same name already exists for this size
  if (
    await getProductTypeByNameAndSize(
      productTypeBody.name,
      productTypeBody.sizeId,
    )
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Product type name already exists for this size',
    );
  }

  const productType = await prisma.productType.create({
    data: productTypeBody,
  });
  return productType;
};

const updateProductType = async (id, updateBody) => {
  const existingProductType = await getProductTypeById(id);
  if (!existingProductType) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product type not found');
  }

  // If size is being updated, check if new size exists
  if (updateBody.sizeId && updateBody.sizeId !== existingProductType.size.id) {
    const size = await getSizeById(updateBody.sizeId);
    if (!size) {
      throw new ApiError(httpStatus.NOT_FOUND, 'New size not found');
    }
  }

  // Check if name is being updated and check uniqueness within size
  const newSizeId = updateBody.sizeId || existingProductType.size.id;
  if (updateBody.name && updateBody.name !== existingProductType.name) {
    if (await getProductTypeByNameAndSize(updateBody.name, newSizeId)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Product type name already exists for this size',
      );
    }
  }

  const updatedProductType = await prisma.productType.update({
    where: { id },
    data: updateBody,
  });

  return updatedProductType;
};

const deleteProductType = async (id) => {
  const existingProductType = await getProductTypeById(id);
  if (!existingProductType) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product type not found');
  }

  // Check if product type has associated items
  const productTypeWithItems = await prisma.productType.findUnique({
    where: { id },
    include: {
      items: {
        take: 1,
      },
    },
  });

  if (productTypeWithItems.items.length > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot delete product type with associated products. Please reassign products first.',
    );
  }

  await prisma.productType.delete({
    where: { id },
  });

  return { message: 'Product type deleted successfully' };
};

module.exports = {
  // ProductCategory exports
  getProductCategoryById,
  getProductCategoryByName,
  getAllProductCategories,
  createProductCategory,
  updateProductCategory,
  deleteProductCategory,
  getSizesByCategory,

  // Size exports
  getSizeById,
  getSizeByNameAndCategory,
  getAllSizes,
  createSize,
  updateSize,
  deleteSize,

  // ProductType exports
  getProductTypeById,
  getProductTypeByNameAndSize,
  getAllProductTypes,
  getProductTypesBySize,
  createProductType,
  updateProductType,
  deleteProductType,
};
