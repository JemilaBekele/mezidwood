const bcrypt = require('bcryptjs');
const { Status } = require('@prisma/client');
const httpStatus = require('http-status');
const prisma = require('./prisma');
const ApiError = require('../utils/ApiError');

const isEmailTaken = async (email) => {
  const user = await prisma.user.findUnique({ where: { email } });
  return !!user;
};

const generateUserCode = async (prefix = 'U') => {
  const latestUser = await prisma.user.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { userCode: true },
  });

  let nextNumber = 1;
  if (latestUser?.userCode) {
    const matches = latestUser.userCode.match(/\d+$/);
    if (matches) {
      nextNumber = parseInt(matches[0], 10) + 1;
    }
  }
  return `${prefix}-${nextNumber.toString().padStart(4, '0')}`;
};

// Helper function to validate store and showroom assignments
// Helper function to validate store and showroom assignments
const validateStoreAndShowroom = async (storeId, showroomId) => {
  console.log('Validating store and showroom:', { storeId, showroomId });

  // If both are provided, check if showroom exists
  if (storeId && showroomId) {
    try {
      // Check if showroom exists
      const showroom = await prisma.showroom.findUnique({
        where: { id: showroomId },
        select: { id: true, name: true }, // Only select fields that exist
      });

      if (!showroom) {
        console.error('Showroom not found:', showroomId);
        throw new ApiError(httpStatus.BAD_REQUEST, 'Showroom not found');
      }
      console.log('Showroom found:', showroom);

      // Check if store exists
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { id: true, name: true },
      });

      if (!store) {
        console.error('Store not found:', storeId);
        throw new ApiError(httpStatus.BAD_REQUEST, 'Store not found');
      }
      console.log('Store found:', store);

      // Note: Since Showroom and Store have no direct relationship in the schema,
      // we just validate that both exist independently
    } catch (error) {
      console.error('Error validating store and showroom:', error);
      throw error;
    }
  }

  // If only showroom is provided, verify it exists
  if (showroomId && !storeId) {
    try {
      const showroom = await prisma.showroom.findUnique({
        where: { id: showroomId },
        select: { id: true, name: true },
      });

      if (!showroom) {
        console.error('Showroom not found:', showroomId);
        throw new ApiError(httpStatus.BAD_REQUEST, 'Showroom not found');
      }
      console.log('Showroom found:', showroom);
    } catch (error) {
      console.error('Error validating showroom:', error);
      throw error;
    }
  }

  // If only store is provided, verify it exists
  if (storeId && !showroomId) {
    try {
      const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { id: true, name: true },
      });

      if (!store) {
        console.error('Store not found:', storeId);
        throw new ApiError(httpStatus.BAD_REQUEST, 'Store not found');
      }
      console.log('Store found:', store);
    } catch (error) {
      console.error('Error validating store:', error);
      throw error;
    }
  }
};

const createUser = async (userData) => {
  const {
    email,
    password,
    name,
    phone,
    roleId,
    storeId,
    showroomId,
    status = Status.Active,
    ...rest
  } = userData;

  // Email check
  if (await isEmailTaken(email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }

  // Validate store and showroom relationships
  await validateStoreAndShowroom(storeId, showroomId);

  // Generate user code
  const userCode = await generateUserCode();

  // Password hashing
  const hashedPassword = await bcrypt.hash(password, 8);

  // Prepare user data
  const userCreateData = {
    email,
    password: hashedPassword,
    name,
    phone,
    status,
    userCode,
    ...rest,
    role: { connect: { id: roleId } },
  };

  // Add store and showroom relations if provided
  if (storeId) {
    userCreateData.store = { connect: { id: storeId } };
  }

  if (showroomId) {
    userCreateData.showroom = { connect: { id: showroomId } };
  }

  // Create user
  const user = await prisma.user.create({
    data: userCreateData,
    include: {
      role: true,
      store: true,
      showroom: true,
    },
  });

  return user;
};

const getUsers = async ({ startDate, endDate, storeId, showroomId } = {}) => {
  const whereClause = {};

  // Convert string dates to Date objects if they exist
  const startDateObj = startDate ? new Date(startDate) : undefined;
  const endDateObj = endDate ? new Date(endDate) : undefined;

  // Build the date filter
  if (startDateObj && endDateObj) {
    whereClause.createdAt = {
      gte: startDateObj,
      lte: endDateObj,
    };
  } else if (startDateObj) {
    whereClause.createdAt = {
      gte: startDateObj,
    };
  } else if (endDateObj) {
    whereClause.createdAt = {
      lte: endDateObj,
    };
  }

  // Add store filter if provided
  if (storeId) {
    whereClause.storeId = storeId;
  }

  // Add showroom filter if provided
  if (showroomId) {
    whereClause.showroomId = showroomId;
  }

  // Get total count (with filters applied)
  const totalUsers = await prisma.user.count({
    where: whereClause,
  });

  // Get users (with filters applied)
  const users = await prisma.user.findMany({
    where: whereClause,
    include: {
      role: true,
      store: true,
      showroom: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return {
    success: true,
    time: new Date().toISOString(),
    message: 'Users retrieved successfully',
    count: totalUsers,
    users,
  };
};

const getUserById = async (id) => {
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      role: true,
      store: true,
      showroom: true,
    },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

  return user;
};

const getUserByIdWithPermissions = async (id) => {
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      role: {
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      },
      store: true,
      showroom: true,
    },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

  return user;
};

const getUserByEmail = async (email) => {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      role: true,
      store: true,
      showroom: true,
    },
  });

  // Return null instead of throwing error when not found
  return user;
};
const updateUserById = async (userId, updateBody) => {
  try {
    console.log('Updating user with ID:', userId);
    console.log('Update data received:', JSON.stringify(updateBody, null, 2));

    const user = await getUserById(userId);
    console.log('Current user data:', {
      id: user.id,
      email: user.email,
      storeId: user.storeId,
      showroomId: user.showroomId,
      roleId: user.roleId,
    });

    // Check if email is being updated and if it's already taken
    if (updateBody.email && user.email !== updateBody.email) {
      console.log('Checking if email is taken:', updateBody.email);
      if (await isEmailTaken(updateBody.email)) {
        console.error('Email already taken:', updateBody.email);
        throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
      }
      console.log('Email is available');
    }

    // Remove password field from update (silently ignore)
    const { roleId, storeId, showroomId, password, ...rest } = updateBody;

    // Log warning but continue (optional)
    if (password) {
      console.warn('⚠️ Password update attempt ignored for user:', userId);
      console.warn('Password field was provided but will not be updated');
    }

    // Validate store and showroom relationships if being updated
    if (storeId !== undefined || showroomId !== undefined) {
      const newStoreId = storeId !== undefined ? storeId : user.storeId;
      const newShowroomId =
        showroomId !== undefined ? showroomId : user.showroomId;

      console.log('Validating store and showroom relationship:', {
        storeId: newStoreId,
        showroomId: newShowroomId,
      });

      await validateStoreAndShowroom(newStoreId, newShowroomId);
      console.log('Store and showroom validation passed');
    }

    const updateData = { ...rest };
    console.log(
      'Base update data (without relations):',
      JSON.stringify(updateData, null, 2),
    );

    // Handle role update if provided
    if (roleId) {
      console.log('Updating role to:', roleId);
      updateData.role = { connect: { id: roleId } };
    }

    // Handle store update
    if (storeId !== undefined) {
      if (storeId) {
        console.log('Connecting store:', storeId);
        updateData.store = { connect: { id: storeId } };
      } else {
        console.log('Disconnecting store');
        updateData.store = { disconnect: true };
      }
    }

    // Handle showroom update
    if (showroomId !== undefined) {
      if (showroomId) {
        console.log('Connecting showroom:', showroomId);
        updateData.showroom = { connect: { id: showroomId } };
      } else {
        console.log('Disconnecting showroom');
        updateData.showroom = { disconnect: true };
      }
    }

    console.log('Final update data:', JSON.stringify(updateData, null, 2));

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        role: true,
        store: true,
        showroom: true,
      },
    });

    console.log('User updated successfully:', {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      storeId: updatedUser.storeId,
      showroomId: updatedUser.showroomId,
      roleId: updatedUser.roleId,
    });

    return updatedUser;
  } catch (error) {
    console.error('❌ Error updating user:');
    console.error('Error details:', {
      userId,
      updateBody: JSON.stringify(updateBody, null, 2),
      errorMessage: error.message,
      errorStack: error.stack,
      errorName: error.name,
      errorCode: error.code,
    });

    // Log the full error object for debugging
    console.error(
      'Full error object:',
      JSON.stringify(error, Object.getOwnPropertyNames(error), 2),
    );

    throw error;
  }
};

const deleteUserById = async (userId) => {
  const user = await getUserById(userId);

  await prisma.user.delete({ where: { id: userId } });

  return user;
};

const changeUserStatus = async (userId, status) => {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { status },
    include: {
      role: true,
    },
  });

  return user;
};

const isPasswordMatch = async (user, password) => {
  // Assuming user object has a 'password' field which is the hashed password
  // And you are using bcrypt for password hashing
  if (!user || !user.password) {
    return false; // Cannot match if user or password hash is missing
  }
  return bcrypt.compare(password, user.password);
};
// In your controller

const changePassword = async (userId, currentPassword, newPassword) => {
  const user = await getUserById(userId);

  const isCurrentPasswordValid = await isPasswordMatch(user, currentPassword);
  if (!isCurrentPasswordValid) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Current password is incorrect');
  }

  const isSamePassword = await isPasswordMatch(user, newPassword);
  if (isSamePassword) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'New password must be different from current password',
    );
  }

  const hashedNewPassword = await bcrypt.hash(newPassword, 8);

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { password: hashedNewPassword },
    include: {
      role: true,
    },
  });

  return updatedUser;
};
const resetPassword = async (userId, resetBody) => {
  const { newPassword } = resetBody;

  // Get user
  const user = await getUserById(userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

  // Check if new password is same as current password (optional security check)
  const isSameAsCurrent = await bcrypt.compare(newPassword, user.password);
  if (isSameAsCurrent) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'New password cannot be the same as current password',
    );
  }

  // Hash new password

  const hashedNewPassword = await bcrypt.hash(newPassword, 8);

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { password: hashedNewPassword },
    include: {
      role: true,
    },
  });

  // Create log entry
  await prisma.log.create({
    data: {
      action: `Password reset for user ${user.email}`,
      userId,
    },
  });

  return updatedUser;
};
module.exports = {
  createUser,
  getUsers,
  getUserById,
  getUserByIdWithPermissions,
  getUserByEmail,
  updateUserById,
  deleteUserById,
  changeUserStatus,
  isPasswordMatch,
  changePassword,
  resetPassword,
};
