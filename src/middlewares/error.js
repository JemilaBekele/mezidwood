const httpStatus = require('http-status');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

/**
 * Prisma surfaces its failures as codes, not HTTP statuses. Without this map
 * every constraint violation became an opaque 500 — a duplicate email and a
 * genuine crash were indistinguishable to the client.
 */
const prismaStatus = (error) => {
  switch (error.code) {
    case 'P2002': // unique constraint failed
    case 'P2003': // foreign key constraint failed
      return httpStatus.CONFLICT;
    case 'P2025': // record required but not found
      return httpStatus.NOT_FOUND;
    case 'P2011': // null constraint violation
    case 'P2000': // value too long for column
      return httpStatus.BAD_REQUEST;
    default:
      return null;
  }
};

const errorConverter = (err, req, res, next) => {
  let error = err;

  if (!(error instanceof ApiError)) {
    // The original read `error.statusCode || error instanceof mongoose.Error ? A : B`.
    // `||` binds tighter than `?:`, so the whole left side collapsed to a
    // boolean and ANY error carrying a statusCode — 404, 409, 500 alike —
    // was rewritten to 400. The mongoose branch was dead weight besides: this
    // project is Prisma-only.
    const statusCode =
      error.statusCode ||
      prismaStatus(error) ||
      (error.name === 'PrismaClientValidationError'
        ? httpStatus.BAD_REQUEST
        : httpStatus.INTERNAL_SERVER_ERROR);
    const message = error.message || httpStatus[statusCode];
    error = new ApiError(statusCode, message, false, error.stack);
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
    // Controllers hand-roll `{success:false, error:'…'}` while this handler
    // emitted `{error:true, …}` — `error` was a string in one shape and a
    // boolean in the other, so no single field told a client the request
    // failed. Emitting both keeps existing call sites working and gives
    // `success` as the one reliable signal.
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
