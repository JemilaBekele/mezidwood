const winston = require('winston');

const { format, createLogger, transports } = winston;
const { printf, combine, timestamp, colorize, uncolorize } = format;

const env = process.env.NODE_ENV || 'development';

// Custom log format
const winstonFormat = printf(({ level, message, timestamp: ts, stack }) => {
  return `${ts}: ${level}: ${stack || message}`;
});

// Create logger
const logger = createLogger({
  level: env === 'development' ? 'debug' : 'info',
  format: combine(
    timestamp(),
    winstonFormat,
    env === 'development' ? colorize() : uncolorize(),
  ),
  transports: [new transports.Console()],
});

module.exports = logger;
