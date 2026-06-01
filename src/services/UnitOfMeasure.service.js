const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Get UnitOfMeasure by ID
const getUnitOfMeasureById = async (id) => {
  const unit = await prisma.unitOfMeasure.findUnique({
    where: { id },
  });
  return unit;
};

// Get UnitOfMeasure by Name
const getUnitOfMeasureByName = async (name) => {
  const unit = await prisma.unitOfMeasure.findFirst({
    where: { name },
  });
  return unit;
};

// Get all UnitsOfMeasure
const getAllUnitsOfMeasure = async () => {
  const units = await prisma.unitOfMeasure.findMany({
    orderBy: {
      name: 'asc',
    },
  });

  return {
    units,
    count: units.length,
  };
};
/**
 * Get all product units with their related data
 * @returns {Promise<Object>} Object containing product units array and count
 */

/**
 * Get all product units for a specific product
 * @param {string} productId - The ID of the product
 * @returns {Promise<Object>} Object containing product units array and count
 */

// Create UnitOfMeasure
// Create UnitOfMeasure
const STATIC_UNITS = [
  // Weight Units
  { name: 'Kilogram', symbol: 'kg', base: true },
  { name: 'Gram', symbol: 'g', base: false },
  { name: 'Milligram', symbol: 'mg', base: false },
  { name: 'Pound', symbol: 'lb', base: false },
  { name: 'Ounce', symbol: 'oz', base: false },

  // Volume Units
  { name: 'Liter', symbol: 'L', base: true },
  { name: 'Milliliter', symbol: 'ml', base: false },
  { name: 'Cubic Meter', symbol: 'm³', base: false },
  { name: 'Gallon', symbol: 'gal', base: false },
  { name: 'Quart', symbol: 'qt', base: false },
  { name: 'Pint', symbol: 'pt', base: false },

  // Count Units
  { name: 'Piece', symbol: 'pc', base: true },
  { name: 'Dozen', symbol: 'dz', base: false },
  { name: 'Pack', symbol: 'pack', base: false },
  { name: 'Box', symbol: 'box', base: false },
  { name: 'Case', symbol: 'case', base: false },
  { name: 'Pallet', symbol: 'pallet', base: false },

  // Length Units
  { name: 'Meter', symbol: 'm', base: true },
  { name: 'Centimeter', symbol: 'cm', base: false },
  { name: 'Millimeter', symbol: 'mm', base: false },
  { name: 'Kilometer', symbol: 'km', base: false },
  { name: 'Inch', symbol: 'in', base: false },
  { name: 'Foot', symbol: 'ft', base: false },
  { name: 'Yard', symbol: 'yd', base: false },
  { name: 'Mile', symbol: 'mi', base: false },

  // Area Units
  { name: 'Square Meter', symbol: 'm²', base: true },
  { name: 'Square Centimeter', symbol: 'cm²', base: false },
  { name: 'Square Foot', symbol: 'ft²', base: false },
  { name: 'Square Inch', symbol: 'in²', base: false },
  { name: 'Acre', symbol: 'acre', base: false },
  { name: 'Hectare', symbol: 'ha', base: false },
];

const createUnitOfMeasure = async (unitBody) => {
  // Check if the requested unit already exists
  const existing = await getUnitOfMeasureByName(unitBody.name);
  if (existing) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Unit of measure name already taken',
    );
  }

  // Create the requested unit
  const newUnit = await prisma.unitOfMeasure.create({
    data: unitBody,
  });

  // Check for existing static units in a single query
  const existingStaticUnits = await prisma.unitOfMeasure.findMany({
    where: {
      name: {
        in: STATIC_UNITS.map((staticUnit) => staticUnit.name),
      },
    },
  });

  // Determine which static units need to be created
  const existingStaticUnitNames = existingStaticUnits.map((u) => u.name);
  const unitsToCreate = STATIC_UNITS.filter(
    (staticUnit) => !existingStaticUnitNames.includes(staticUnit.name),
  );

  // Create missing static units in a single operation if needed
  if (unitsToCreate.length > 0) {
    await prisma.unitOfMeasure.createMany({
      data: unitsToCreate,
      skipDuplicates: true,
    });
  }

  return newUnit;
};

// Update UnitOfMeasure
const updateUnitOfMeasure = async (id, updateBody) => {
  const existingUnit = await getUnitOfMeasureById(id);
  if (!existingUnit) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Unit of measure not found');
  }

  // Check if name is being updated to an existing unit name
  if (updateBody.name && updateBody.name !== existingUnit.name) {
    if (await getUnitOfMeasureByName(updateBody.name)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Unit of measure name already taken',
      );
    }
  }

  const updatedUnit = await prisma.unitOfMeasure.update({
    where: { id },
    data: updateBody,
  });

  return updatedUnit;
};

// Delete UnitOfMeasure
const deleteUnitOfMeasure = async (id) => {
  const existingUnit = await getUnitOfMeasureById(id);
  if (!existingUnit) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Unit of measure not found');
  }

  await prisma.unitOfMeasure.delete({
    where: { id },
  });

  return { message: 'Unit of measure deleted successfully' };
};

module.exports = {
  getUnitOfMeasureById,
  getUnitOfMeasureByName,
  getAllUnitsOfMeasure,
  createUnitOfMeasure,
  updateUnitOfMeasure,
  deleteUnitOfMeasure,
};
