const httpStatus = require('http-status');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

/**
 * Map a Prisma error to a meaningful HTTP status + message.
 * Returns null when `err` is not a Prisma error we recognise.
 */
const convertPrismaError = (err) => {
  const name = err && err.constructor ? err.constructor.name : '';

  if (name === 'PrismaClientValidationError') {
    return new ApiError(
      httpStatus.BAD_REQUEST,
      'Invalid data supplied for this operation',
      true,
      err.stack,
    );
  }

  if (name === 'PrismaClientKnownRequestError') {
    const target = (err.meta && (err.meta.target || err.meta.field_name)) || '';
    switch (err.code) {
      case 'P2002':
        return new ApiError(
          httpStatus.CONFLICT,
          `A record with this ${target || 'value'} already exists`,
          true,
          err.stack,
        );
      case 'P2003':
        return new ApiError(
          httpStatus.CONFLICT,
          `This record is still referenced by other records${
            target ? ` (${target})` : ''
          } and cannot be changed`,
          true,
          err.stack,
        );
      case 'P2011':
      case 'P2012':
        return new ApiError(
          httpStatus.BAD_REQUEST,
          `A required value is missing${target ? `: ${target}` : ''}`,
          true,
          err.stack,
        );
      case 'P2025':
        return new ApiError(
          httpStatus.NOT_FOUND,
          (err.meta && err.meta.cause) || 'Record not found',
          true,
          err.stack,
        );
      default:
        return null;
    }
  }

  return null;
};

const errorConverter = (err, req, res, next) => {
  let error = err;

  if (!(error instanceof ApiError)) {
    const prismaError = convertPrismaError(error);
    if (prismaError) {
      error = prismaError;
    } else {
      // NOTE: the parentheses matter. This previously read
      // `error.statusCode || error instanceof X ? 400 : 500`, which `||`
      // binds tighter than `?:` — so every error carrying a statusCode
      // (multer, http-errors, ...) was flattened to 400.
      const statusCode =
        error.statusCode || error.status || httpStatus.INTERNAL_SERVER_ERROR;
      const message = error.message || httpStatus[statusCode];
      error = new ApiError(statusCode, message, false, error.stack);
    }
  }

  next(error);
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let { statusCode, message } = err;

  if (config.env === 'production' && !err.isOperational) {
    statusCode = httpStatus.INTERNAL_SERVER_ERROR;
    message = httpStatus[statusCode];
  }

  const response = {
    // `success: false` is included so clients can test a single field
    // regardless of which convention a given handler used.
    success: false,
    error: true,
    code: statusCode,
    message,
    ...(config.env === 'development' && { stack: err.stack }),
  };

  res.locals.errorMessage = message;

  if (config.env === 'development') {
    if (err.isOperational) {
      logger.error(`${statusCode} - ${message}`);
    } else {
      logger.error(err);
    }
  } else if (!err.isOperational) {
    logger.error(err);
  }

  res.status(statusCode).send(response);
};

module.exports = {
  errorHandler,
  errorConverter,
};
