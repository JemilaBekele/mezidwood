require('dotenv').config();
const { envValidation } = require('../validations');

// Add DATABASE_URL to your Joi validation schema
const { value: envVars, error } = envValidation.validate(process.env);
const logger = require('./logger');

if (error) {
  logger.error(`Environment validation failed: ${error.message}`);
  // Booting with a missing JWT_SECRET or DATABASE_URL produces confusing
  // runtime failures much later. Fail fast everywhere except local dev.
  if (envVars.NODE_ENV !== 'development') {
    throw new Error(`Environment validation failed: ${error.message}`);
  }
}

const parseBoolean = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  return String(value).toLowerCase() === 'true';
};

const corsAllowedOrigins = String(envVars.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const defaultLocalOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const resolvedCorsOrigins =
  corsAllowedOrigins.length > 0 ? corsAllowedOrigins : defaultLocalOrigins;

module.exports = {
  port: envVars.PORT,
  db: {
    url: envVars.DATABASE_URL, // Changed from DB_CONNECTION to DATABASE_URL
  },
  env: envVars.NODE_ENV,
  email: envVars.EMAIL,
  emailPassword: envVars.EMAIL_PASSWORD,
  jwt: {
    secret: envVars.JWT_SECRET,
    accessExpirationMinutes: envVars.JWT_ACCESS_EXPIRATION_MINUTES,
    refreshExpirationDays: envVars.JWT_REFRESH_EXPIRATION_DAYS,
  },
  rateLimiter: {
    maxAttemptsPerDay: envVars.MAX_ATTEMPTS_PER_DAY,
    maxAttemptsByIpUsername: envVars.MAX_ATTEMPTS_BY_IP_USERNAME,
    maxAttemptsPerEmail: envVars.MAX_ATTEMPTS_PER_EMAIL,
  },
  cors: {
    allowedOrigins: resolvedCorsOrigins,
  },
  trustProxy: parseBoolean(envVars.TRUST_PROXY),
  cspOptions: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'fonts.gstatic.com'],
    },
  },
};
