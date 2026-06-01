const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { userService, tokenService, authService } = require('../services');
const ApiError = require('../utils/ApiError');

const getClientIpAddress = (req) => {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
};

const createUser = catchAsync(async (req, res) => {
  const user = await userService.createUser(req.body);
  res.status(httpStatus.CREATED).send({ user });
});

const getUsers = catchAsync(async (req, res) => {
  const result = await userService.getUsers();
  res.status(httpStatus.OK).send(result);
});

const getUser = catchAsync(async (req, res) => {
  const user = await userService.getUserById(req.params.userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  res.status(httpStatus.OK).send({ user });
});

const getUsermy = catchAsync(async (req, res) => {
  const user = await userService.getUserByIdWithPermissions(req.user.id);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

  const permissions = Array.isArray(user.role?.permissions)
    ? user.role.permissions.map(
        (rolePermission) => rolePermission.permission.name,
      )
    : [];

  const sanitizedRole = user.role
    ? {
        ...user.role,
        permissions: undefined,
      }
    : null;

  res.status(httpStatus.OK).send({
    user: {
      ...user,
      role: sanitizedRole,
      permissions,
    },
  });
});

const updateUser = catchAsync(async (req, res) => {
  const updatedUser = await userService.updateUserById(
    req.params.userId,
    req.body,
  );
  res.status(httpStatus.OK).send({ user: updatedUser });
});

const deleteUser = catchAsync(async (req, res) => {
  await userService.deleteUserById(req.params.userId);
  res.status(httpStatus.NO_CONTENT).send();
});

const changeUserStatus = catchAsync(async (req, res) => {
  const { status } = req.body;
  const updatedUser = await userService.changeUserStatus(
    req.params.userId,
    status,
  );
  res.status(httpStatus.OK).send({ user: updatedUser });
});

const getUserByEmail = catchAsync(async (req, res) => {
  const { email } = req.query;
  if (!email) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email is required');
  }
  const user = await userService.getUserByEmail(email);
  res.status(httpStatus.OK).send({ user });
});
const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;
  console.log('Login attempt:', req.body);
  const user = await authService.login(
    email,
    password,
    getClientIpAddress(req),
  );
  // generate token ,Saleslogin,
  const tokens = await tokenService.generateAuthTokens(user.id);
  res.status(httpStatus.OK).send({ user, tokens });
});
const Storelogin = catchAsync(async (req, res) => {
  const { email, password } = req.body;
  const user = await authService.Storelogin(
    email,
    password,
    getClientIpAddress(req),
  );
  // generate token Storelogin,,
  const tokens = await tokenService.generateAuthTokens(user.id);
  res.status(httpStatus.OK).send({ user, tokens });
});
const Saleslogin = catchAsync(async (req, res) => {
  const { email, password } = req.body;
  const user = await authService.Saleslogin(
    email,
    password,
    getClientIpAddress(req),
  );
  // generate token Storelogin,Saleslogin,
  const tokens = await tokenService.generateAuthTokens(user.id);
  res.status(httpStatus.OK).send({ user, tokens });
});
const changeUserPassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id; // From authentication middleware

    const updatedUser = await userService.changePassword(
      userId,
      currentPassword,
      newPassword,
    );

    res.status(httpStatus.OK).json({
      success: true,
      message: 'Password changed successfully',
      user: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { userId } = req.params; // From authentication middleware
    const resetBody = req.body;

    const user = await userService.resetPassword(userId, resetBody);

    res.status(httpStatus.OK).json({
      status: 'success',
      message: 'Password reset successfully',
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

const refreshTokens = catchAsync(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'refreshToken is required');
  }
  const tokens = await authService.refreshAuthToken(refreshToken);
  res.status(httpStatus.OK).send({ tokens });
});
module.exports = {
  createUser,
  getUsers,
  getUser,
  updateUser,
  deleteUser,
  changeUserStatus,
  getUserByEmail,
  login,
  changeUserPassword,
  getUsermy,
  resetPassword,
  Storelogin,
  Saleslogin,
  refreshTokens,
};
