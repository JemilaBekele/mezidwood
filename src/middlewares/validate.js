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
  // Two faults lived here, and together they made EVERY request validation in
  // the app inert:
  //   1. `next(err)` was not returned, so the unconditional `return next()`
  //      below ran straight after it — the request continued into the
  //      controller with the invalid body it had just been rejected for.
  //   2. Only `error` was destructured, so Joi's coerced value (and every
  //      `.default()` a schema declares) was thrown away.
  const { value, error } = joi
    .compile(schema)
    .prefs({ errors: { label: 'key' }, abortEarly: false })
    .validate(object);

  if (error) {
    const errors = error.details.map((detail) => detail.message).join(', ');
    return next(new ApiError(400, errors));
  }

  // Write the validated/coerced value back so services see defaults and real
  // types (numbers, booleans, dates) rather than raw query strings.
  Object.assign(req, value);
  return next();
};

module.exports = validate;
