// src/services/auth.service.js

const httpStatus = require('http-status');
const { RateLimiterMemory } = require('rate-limiter-flexible'); // Keep if rate limiting is used
const userService = require('./user.service');
const tokenService = require('./token.service'); // Ensure this is the refactored stateless version
const ApiError = require('../utils/ApiError');
const { tokenTypes } = require('../config/tokens');
const config = require('../config/config');
const prisma = require('./prisma'); // Keep if rate limiting is used
// const prisma = require('./prisma'); // REMOVED - Prisma is not used directly for tokens here anymore

// Using RateLimiterMemory instead of RateLimiterMongo since Prisma handles DB access
// For production, consider Redis-based rate limiter
const rateLimiterOptions = {
  blockDuration: 60 * 60 * 24,
};

const emailIpBruteLimiter = new RateLimiterMemory({
  ...rateLimiterOptions,
  points: config.rateLimiter.maxAttemptsByIpUsername,
  duration: 60 * 10,
});

const slowerBruteLimiter = new RateLimiterMemory({
  ...rateLimiterOptions,
  points: config.rateLimiter.maxAttemptsPerDay,
  duration: 60 * 60 * 24,
});

const emailBruteLimiter = new RateLimiterMemory({
  ...rateLimiterOptions,
  points: config.rateLimiter.maxAttemptsPerEmail,
  duration: 60 * 60 * 24,
});

const normalizeIpAddress = (ipAddr) => String(ipAddr || 'unknown_ip');

const login = async (email, password, ipAddr) => {
  try {
    console.log('Login attempt:', {
      email,
      ipAddr,
    });

    const normalizedIp = normalizeIpAddress(ipAddr);

    console.log('Normalized IP:', normalizedIp);

    const promises = [slowerBruteLimiter.consume(normalizedIp)];

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
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
        branch: true,
        shops: true,
        stores: true,
      },
    });

    console.log('User found:', user ? user.email : 'No user');

    // Check password
    const passwordMatch =
      user && (await userService.isPasswordMatch(user, password));

    console.log('Password match:', passwordMatch);

    if (!user || !passwordMatch) {
      console.log('Invalid credentials');

      if (user) {
        promises.push(
          emailIpBruteLimiter.consume(`${email}_${normalizedIp}`),
          emailBruteLimiter.consume(email),
        );
      }

      await Promise.all(promises);

      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Incorrect email or password',
      );
    }

    console.log('User status:', user.status);

    // Check status
    if (user.status !== 'Active') {
      console.log('Inactive account');

      throw new ApiError(
        httpStatus.FORBIDDEN,
        'Your account is not active. Please contact administrator.',
      );
    }

    const formattedUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      roleType: user.roleType,
      role: user.role?.name,
      lastLoginAt: user.lastLoginAt,
      status: user.status,
      phone: user.phone,
      branch: user?.branch,
      shops: user.shops,
      stores: user.stores,
      permissions:
        user.role?.permissions?.map((rp) => rp.permission.name) || [],
    };

    console.log('Formatted user:', formattedUser);

    // Update login time
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
      },
    });

    console.log('Last login updated');

    return formattedUser;
  } catch (error) {
    console.error('LOGIN ERROR:', error);

    throw error;
  }
};
const Storelogin = async (email, password, ipAddr) => {
  const normalizedIp = normalizeIpAddress(ipAddr);
  const promises = [slowerBruteLimiter.consume(normalizedIp)];

  // Find user with role, permissions, and branch
  const user = await prisma.user.findUnique({
    where: { email },
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
      branch: true,
      shops: true,
      stores: true,
    },
  });

  // Check if user exists and password matches
  if (!user || !(await userService.isPasswordMatch(user, password))) {
    if (user) {
      promises.push(
        emailIpBruteLimiter.consume(`${email}_${normalizedIp}`),
        emailBruteLimiter.consume(email),
      );
    }
    await Promise.all(promises);
    throw new ApiError(httpStatus.BAD_REQUEST, 'Incorrect email or password');
  }
  // NEW: Only allow admin or roles containing "store" (case-insensitive)
  const roleName = user.role?.name?.toLowerCase() || '';
  const isAdmin = user.admin === true || roleName.includes('admin');
  const hasStoreRole = roleName.includes('store');

  if (!isAdmin && !hasStoreRole) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'Access denied. Only administrators and store personnel can login through this portal.',
    );
  }

  // Format the user object with permission names only and branch info
  const formattedUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    admin: user.admin,
    roleType: user.roleType,
    role: user.role?.name,
    lastLoginAt: user.lastLoginAt,
    status: user.status,
    phone: user.phone,
    branch: user?.branch,
    shops: user.shops,
    stores: user.stores,
    permissions: user.role?.permissions?.map((rp) => rp.permission.name) || [],
  };

  // Update last login time
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return formattedUser;
};
const Saleslogin = async (email, password, ipAddr) => {
  const normalizedIp = normalizeIpAddress(ipAddr);
  const promises = [slowerBruteLimiter.consume(normalizedIp)];

  // Find user with role, permissions, and branch
  const user = await prisma.user.findUnique({
    where: { email },
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
      branch: true,
      shops: true,
      stores: true,
    },
  });

  // Check if user exists and password matches
  if (!user || !(await userService.isPasswordMatch(user, password))) {
    if (user) {
      promises.push(
        emailIpBruteLimiter.consume(`${email}_${normalizedIp}`),
        emailBruteLimiter.consume(email),
      );
    }
    await Promise.all(promises);
    throw new ApiError(httpStatus.BAD_REQUEST, 'Incorrect email or password');
  }
  // NEW: Only allow admin or roles containing "store" (case-insensitive)
  const roleName = user.role?.name?.toLowerCase() || '';
  const isAdmin = user.admin === true || roleName.includes('admin');
  const hasStoreRole = roleName.includes('sales');

  if (!isAdmin && !hasStoreRole) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'Access denied. Only administrators and sales personnel can login through this portal.',
    );
  }

  // Format the user object with permission names only and branch info
  const formattedUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    admin: user.admin,
    roleType: user.roleType,
    role: user.role?.name,
    lastLoginAt: user.lastLoginAt,
    status: user.status,
    phone: user.phone,
    branch: user?.branch,
    shops: user.shops,
    stores: user.stores,
    permissions: user.role?.permissions?.map((rp) => rp.permission.name) || [],
  };

  // Update last login time
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return formattedUser;
};
/**
 * Refresh auth tokens
 * Requires a valid refresh token. Generates a new access and refresh token pair.
 * The old refresh token is NOT invalidated server-side in this stateless approach.
 * @param {string} refreshToken
 * @returns {Promise<Object>} // Returns new access and refresh tokens
 */
const refreshAuthToken = async (refreshToken) => {
  try {
    // 1. Verify the refresh token using the stateless verify function
    // verifyToken now returns the payload if valid
    const refreshTokenPayload = await tokenService.verifyToken(
      refreshToken,
      tokenTypes.REFRESH,
    );

    // 2. Get the user from the payload
    const user = await userService.getUserById(refreshTokenPayload.sub); // payload.sub is the userId
    if (!user) {
      throw new Error('User not found for refresh token');
    }

    // 3. Reject refresh for inactive/suspended users
    if (user.status !== 'Active') {
      throw new Error('User account is not active');
    }

    // 4. Generate a new pair of tokens
    // The old refresh token remains valid until its expiry.
    const newTokens = await tokenService.generateAuthTokens(user.id);

    // REMOVED: Deleting the old refresh token from the database

    return newTokens;
  } catch (error) {
    // Catch any errors from jwt.verify, user lookup, or token generation
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Invalid or expired refresh token',
    );
  }
};
module.exports = {
  login,
  refreshAuthToken,
  Storelogin,
  Saleslogin,
  // ... add other exported functions like logout, sendEmailVerificationToken, etc.
};
