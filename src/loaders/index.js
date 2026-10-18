const fs = require('fs');
// Reuse the app-wide client so the server keeps a single connection pool.
const prisma = require('../services/prisma');
const expressLoader = require('./express');
const logger = require('../config/logger');
const subscribers = require('../subscribers');
const EventEmitter = require('../utils/EventEmitter');

module.exports = async (app) => {
  // Initialize Prisma
  await prisma.$connect();
  logger.info('Prisma MySQL initiated.');

  // Make prisma available throughout the app
  app.set('prisma', prisma);

  await expressLoader(app);
  logger.info('Express app initiated.');

  Object.keys(subscribers).forEach((eventName) => {
    EventEmitter.on(eventName, subscribers[eventName]);
  });

  fs.access('uploads', fs.constants.F_OK, async (err) => {
    if (err) {
      await fs.promises.mkdir('uploads');
    }
  });
};
