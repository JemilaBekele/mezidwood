/* eslint-disable no-nested-ternary */
/* eslint-disable no-restricted-syntax */
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

/* ──────────────── CURTAIN TYPE ──────────────── */

// Get CurtainType by ID
const getCurtainTypeById = async (id) => {
  const curtainType = await prisma.curtainType.findUnique({ where: { id } });
  return curtainType;
};

// Get CurtainType by Name
const getCurtainTypeByName = async (name) => {
  const curtainType = await prisma.curtainType.findUnique({ where: { name } });
  return curtainType;
};

// Create CurtainType
const createCurtainType = async (curtainTypeData) => {
  const { name } = curtainTypeData;

  const existing = await getCurtainTypeByName(name);
  if (existing) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Curtain type with this name already exists',
    );
  }

  return await prisma.curtainType.create({ data: { name } });
};

// Get all CurtainTypes
const getAllCurtainTypes = async (options = {}) => {
  const { page = 1, limit = 10, search, includeProducts = false } = options;
  const skip = (page - 1) * limit;

  const where = {};
  if (search) {
    where.name = { contains: search, mode: 'insensitive' };
  }

  const [curtainTypes, totalCount] = await Promise.all([
    prisma.curtainType.findMany({
      where,
      include: includeProducts
        ? { products: { select: { id: true, name: true, code: true } } }
        : undefined,
      orderBy: { name: 'asc' },
      skip,
      take: limit,
    }),
    prisma.curtainType.count({ where }),
  ]);

  return {
    curtainTypes,
    count: curtainTypes.length,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: page,
  };
};

// Update CurtainType
const updateCurtainType = async (id, updateBody) => {
  const existing = await getCurtainTypeById(id);
  if (!existing)
    throw new ApiError(httpStatus.NOT_FOUND, 'Curtain type not found');

  const cleanedUpdateBody = {};
  for (const [key, value] of Object.entries(updateBody)) {
    const cleanKey = key.replace(/[^a-zA-Z0-9]/g, '');
    cleanedUpdateBody[cleanKey] = value;
  }

  if (cleanedUpdateBody.name && cleanedUpdateBody.name !== existing.name) {
    const duplicate = await getCurtainTypeByName(cleanedUpdateBody.name);
    if (duplicate)
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Curtain type with this name already exists',
      );
  }

  return prisma.curtainType.update({ where: { id }, data: cleanedUpdateBody });
};

// Delete CurtainType
const deleteCurtainType = async (id) => {
  const existing = await getCurtainTypeById(id);
  if (!existing)
    throw new ApiError(httpStatus.NOT_FOUND, 'Curtain type not found');

  const productsCount = await prisma.product.count({
    where: { curtainTypeId: id },
  });
  if (productsCount > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot delete curtain type. It is associated with ${productsCount} product(s).`,
    );
  }

  await prisma.curtainType.delete({ where: { id } });
  return { message: 'Curtain type deleted successfully' };
};

/* ──────────────── MOVEMENT TYPE ──────────────── */

// Get MovementType by ID
const getMovementTypeById = async (id) => {
  const movementType = await prisma.movementType.findUnique({ where: { id } });
  return movementType;
};

// Get MovementType by Name
const getMovementTypeByName = async (name) => {
  const movementType = await prisma.movementType.findUnique({
    where: { name },
  });
  return movementType;
};

// Create MovementType
const createMovementType = async (movementTypeData) => {
  const { name } = movementTypeData;

  const existing = await getMovementTypeByName(name);
  if (existing) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Movement type with this name already exists',
    );
  }

  return prisma.movementType.create({ data: { name } });
};

// Get all MovementTypes
const getAllMovementTypes = async (options = {}) => {
  const { page = 1, limit = 10, search } = options;
  const skip = (page - 1) * limit;

  const where = {};
  if (search) {
    where.name = { contains: search, mode: 'insensitive' };
  }

  const [movementTypes, totalCount] = await Promise.all([
    prisma.movementType.findMany({
      where,
      orderBy: { name: 'asc' },
      skip,
      take: limit,
    }),
    prisma.movementType.count({ where }),
  ]);

  return {
    movementTypes,
    count: movementTypes.length,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    currentPage: page,
  };
};

// Update MovementType
const updateMovementType = async (id, updateBody) => {
  const existing = await getMovementTypeById(id);
  if (!existing)
    throw new ApiError(httpStatus.NOT_FOUND, 'Movement type not found');

  const cleanedUpdateBody = {};
  for (const [key, value] of Object.entries(updateBody)) {
    const cleanKey = key.replace(/[^a-zA-Z0-9]/g, '');
    cleanedUpdateBody[cleanKey] = value;
  }

  if (cleanedUpdateBody.name && cleanedUpdateBody.name !== existing.name) {
    const duplicate = await getMovementTypeByName(cleanedUpdateBody.name);
    if (duplicate)
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Movement type with this name already exists',
      );
  }

  return prisma.movementType.update({ where: { id }, data: cleanedUpdateBody });
};

// Delete MovementType
const deleteMovementType = async (id) => {
  const existing = await getMovementTypeById(id);
  if (!existing)
    throw new ApiError(httpStatus.NOT_FOUND, 'Movement type not found');

  await prisma.movementType.delete({ where: { id } });
  return { message: 'Movement type deleted successfully' };
};

/* ──────────────── EXPORTS ──────────────── */
module.exports = {
  // CurtainType
  getCurtainTypeById,
  getCurtainTypeByName,
  createCurtainType,
  getAllCurtainTypes,
  updateCurtainType,
  deleteCurtainType,

  // MovementType
  getMovementTypeById,
  getMovementTypeByName,
  createMovementType,
  getAllMovementTypes,
  updateMovementType,
  deleteMovementType,
};
