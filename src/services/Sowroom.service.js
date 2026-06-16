const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

// Get Showroom by ID
const getShowroomById = async (id) => {
  const showroom = await prisma.showroom.findUnique({
    where: { id },
    include: {
      inventoryStocks: true,
      itemStocks: true,
    },
  });
  return showroom;
};

// Get Showroom by Name
const getShowroomByName = async (name) => {
  const showroom = await prisma.showroom.findFirst({
    where: { name },
  });
  return showroom;
};

const getAllShowroom = async () => {
  try {
    const showrooms = await prisma.showroom.findMany();
    return {
      showrooms,
      count: showrooms.length,
    };
  } catch (error) {
    console.error('Error in getAllShowroom:', error);
    throw error;
  }
};
// Get all Showrooms
const getAllShowrooms = async (userId) => {
  // Get the user with their accessible showrooms
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      showrooms: { select: { id: true } },
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  // If user is admin, return all showrooms
  if (user.admin) {
    const showrooms = await prisma.showroom.findMany({
      orderBy: {
        name: 'asc',
      },
      include: {
        inventoryStocks: true,
        itemStocks: true,
      },
    });

    return {
      showrooms,
      count: showrooms.length,
    };
  }

  // Regular user: filter by accessible showrooms
  const accessibleShowroomIds = user.showrooms.map((showroom) => showroom.id);

  // If user has no showrooms, return empty array
  if (accessibleShowroomIds.length === 0) {
    return {
      showrooms: [],
      count: 0,
    };
  }

  const showrooms = await prisma.showroom.findMany({
    where: {
      id: { in: accessibleShowroomIds },
    },
    orderBy: {
      name: 'asc',
    },
    include: {
      inventoryStocks: true,
      itemStocks: true,
    },
  });

  return {
    showrooms,
    count: showrooms.length,
  };
};

const getAllShowroomsBasedUser = async (userId = null) => {
  // If no userId provided, return all showrooms (for admin/superuser scenarios)
  if (!userId) {
    const showrooms = await prisma.showroom.findMany({
      orderBy: {
        name: 'asc',
      },
      include: {
        inventoryStocks: true,
        itemStocks: true,
      },
    });

    return {
      showrooms,
      count: showrooms.length,
    };
  }

  // For specific user, return only their allowed showrooms
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    include: {
      branch: true,
      showrooms: {
        include: {
          inventoryStocks: true,
          itemStocks: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  return {
    showrooms: user.showrooms,
    count: user.showrooms.length,
  };
};

// Create Showroom
const createShowroom = async (showroomBody) => {
  // Check if showroom with same name already exists
  if (await getShowroomByName(showroomBody.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Showroom name already taken');
  }

  // If trying to create a main showroom, ensure no other main showroom exists
  if (showroomBody.isMain) {
    const existingMainShowroom = await prisma.showroom.findFirst({
      where: { isMain: true },
    });

    if (existingMainShowroom) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Only one main showroom is allowed',
      );
    }
  }

  const showroom = await prisma.showroom.create({
    data: showroomBody,
    include: {
      inventoryStocks: true,
      itemStocks: true,
    },
  });
  return showroom;
};

// Update Showroom
const updateShowroom = async (id, updateBody) => {
  const existingShowroom = await getShowroomById(id);
  if (!existingShowroom) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Showroom not found');
  }

  // Check if name is being updated to an existing showroom name
  if (updateBody.name && updateBody.name !== existingShowroom.name) {
    if (await getShowroomByName(updateBody.name)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Showroom name already taken');
    }
  }

  // If trying to set isMain to true, ensure no other main showroom exists
  if (updateBody.isMain === true && !existingShowroom.isMain) {
    const existingMainShowroom = await prisma.showroom.findFirst({
      where: {
        isMain: true,
        id: { not: id },
      },
    });

    if (existingMainShowroom) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Only one main showroom is allowed',
      );
    }
  }

  const updatedShowroom = await prisma.showroom.update({
    where: { id },
    data: updateBody,
    include: {
      inventoryStocks: true,
      itemStocks: true,
    },
  });

  return updatedShowroom;
};

// Delete Showroom
const deleteShowroom = async (id) => {
  const existingShowroom = await getShowroomById(id);
  if (!existingShowroom) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Showroom not found');
  }

  // Prevent deletion of main showroom if it's the only one or has dependencies
  if (existingShowroom.isMain) {
    const showroomCount = await prisma.showroom.count();
    if (showroomCount === 1) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Cannot delete the only main showroom',
      );
    }
  }

  await prisma.showroom.delete({
    where: { id },
  });

  return { message: 'Showroom deleted successfully' };
};

// Set a showroom as main (ensuring only one main exists)
const setMainShowroom = async (id) => {
  const existingShowroom = await getShowroomById(id);
  if (!existingShowroom) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Showroom not found');
  }

  // Use transaction to ensure atomic operation
  const result = await prisma.$transaction(async (tx) => {
    // Set all showrooms to isMain: false
    await tx.showroom.updateMany({
      where: { isMain: true },
      data: { isMain: false },
    });

    // Set the selected showroom as main
    const updatedShowroom = await tx.showroom.update({
      where: { id },
      data: { isMain: true },
      include: {
        inventoryStocks: true,
        itemStocks: true,
      },
    });

    return updatedShowroom;
  });

  return result;
};

// Get main showroom
const getMainShowroom = async () => {
  const mainShowroom = await prisma.showroom.findFirst({
    where: { isMain: true },
    include: {
      inventoryStocks: true,
      itemStocks: true,
    },
  });

  if (!mainShowroom) {
    throw new ApiError(httpStatus.NOT_FOUND, 'No main showroom found');
  }

  return mainShowroom;
};

module.exports = {
  getShowroomById,
  getAllShowroom,
  getShowroomByName,
  getAllShowrooms,
  createShowroom,
  updateShowroom,
  deleteShowroom,
  getAllShowroomsBasedUser,
  setMainShowroom,
  getMainShowroom,
};
