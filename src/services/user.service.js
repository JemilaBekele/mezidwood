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

const createUser = async (userData) => {
  const {
    email,
    password,
    name,
    phone,
    roleId,
    storeIds = [],
    showroomIds = [],
    status = Status.Active,
    ...rest
  } = userData;

  // Email check
  if (await isEmailTaken(email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }

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
  if (storeIds && storeIds.length > 0) {
    userCreateData.stores = {
      connect: storeIds.map((id) => ({ id })),
    };
  }

  if (showroomIds && showroomIds.length > 0) {
    userCreateData.showrooms = {
      connect: showroomIds.map((id) => ({ id })),
    };
  }

  // Create user
  const user = await prisma.user.create({
    data: userCreateData,
    include: {
      role: true,
      stores: true,
      showrooms: true,
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

  // Add store filter if provided (many-to-many)
  if (storeId) {
    whereClause.stores = {
      some: {
        id: storeId,
      },
    };
  }

  // Add showroom filter if provided (many-to-many)
  if (showroomId) {
    whereClause.showrooms = {
      some: {
        id: showroomId,
      },
    };
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
      stores: true,
      showrooms: true,
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
      stores: true,
      showrooms: true,
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
      stores: true,
      showrooms: true,
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
      stores: true,
      showrooms: true,
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
      storeIds: user.stores.map((s) => s.id),
      showroomIds: user.showrooms.map((s) => s.id),
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
    const { roleId, storeIds, showroomIds, password, ...rest } = updateBody;

    // Log warning but continue (optional)
    if (password) {
      console.warn('⚠️ Password update attempt ignored for user:', userId);
      console.warn('Password field was provided but will not be updated');
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

    // Handle store updates (many-to-many)
    if (storeIds !== undefined) {
      if (storeIds.length > 0) {
        console.log('Connecting stores:', storeIds);
        updateData.stores = {
          set: storeIds.map((id) => ({ id })),
        };
      } else {
        console.log('Disconnecting all stores');
        updateData.stores = {
          set: [],
        };
      }
    }

    // Handle showroom updates (many-to-many)
    if (showroomIds !== undefined) {
      if (showroomIds.length > 0) {
        console.log('Connecting showrooms:', showroomIds);
        updateData.showrooms = {
          set: showroomIds.map((id) => ({ id })),
        };
      } else {
        console.log('Disconnecting all showrooms');
        updateData.showrooms = {
          set: [],
        };
      }
    }

    console.log('Final update data:', JSON.stringify(updateData, null, 2));

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        role: true,
        stores: true,
        showrooms: true,
      },
    });

    console.log('User updated successfully:', {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      storeIds: updatedUser.stores.map((s) => s.id),
      showroomIds: updatedUser.showrooms.map((s) => s.id),
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
      stores: true,
      showrooms: true,
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
      stores: true,
      showrooms: true,
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
      stores: true,
      showrooms: true,
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
