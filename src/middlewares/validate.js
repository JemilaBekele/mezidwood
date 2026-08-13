const joi = require('joi');
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');

/**
 * Build a request-validation middleware from a Joi schema keyed by request
 * property (`body`, `query`, `params`).
 *
 * Two things matter here and were previously wrong:
 *  1. A failed validation must `return` — otherwise `next()` runs twice, the
 *     handler executes with invalid input, and Express reports
 *     ERR_HTTP_HEADERS_SENT on top of the original error.
 *  2. The coerced value must be written back to `req`, otherwise Joi's
 *     `.default()`s and type coercion never reach the service layer.
 */
const validate = (schema) => (req, res, next) => {
  const keys = Object.keys(schema);
  const object = keys.reduce((obj, key) => {
    if (Object.prototype.hasOwnProperty.call(req, key)) {
      // eslint-disable-next-line no-param-reassign
      obj[key] = req[key];
    }
    return obj;
  }, {});

  const { value, error } = joi
    .compile(schema)
    .prefs({ errors: { label: 'key' }, abortEarly: false })
    .validate(object);

  if (error) {
    const message = error.details.map((detail) => detail.message).join(', ');
    return next(new ApiError(httpStatus.BAD_REQUEST, message));
  }

  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      // eslint-disable-next-line no-param-reassign
      req[key] = value[key];
    }
  });

  return next();
};

module.exports = validate;
