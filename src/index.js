const http = require('http');
const express = require('express');
const config = require('./config/config');
const loader = require('./loaders');
const logger = require('./config/logger');
const SystemInitializer = require('./middlewares/initialSetup');
const exitHandler = require('./config/exitHandler');
// Add this import
// const startInvoiceCron = require('./lib/corn'); // ✅ Adjust path
const socket = require('./socket/s'); // Import the socket module
// Example: handle unexpected errors

// const unExpectedErrorHandler = (server) => {
//   return function (error) {
//     logger.error(error);
//     exitHandler(server);
//   };
// };

const startServer = async () => {
  try {
    const app = express();

    // Initialize Express app with all middleware and routes
    await loader(app);

    // Initialize system (roles, \, admin user)
    await SystemInitializer.initialize();
    logger.info('System initialization completed successfully');

    const httpServer = http.createServer(app);
    socket.init(httpServer);
    logger.info('Socket.IO initialized successfully');

    const server = httpServer.listen(config.port, () => {
      logger.info(`Server listening on port ${config.port}`);
      logger.info(`Environment: ${config.env}`);
    });
    // startInvoiceCron(); // ✅ Start the cron after system is ready
    // An uncaught exception leaves the process in an undefined state — exit.
    process.on('uncaughtException', (err) => exitHandler(server, err));

    // An unhandled rejection does not. Several code paths intentionally
    // fire-and-forget (e.g. post-commit reschedule cascades); tearing the
    // server down over one would take the whole app offline.
    process.on('unhandledRejection', (err) => {
      logger.error('Unhandled promise rejection (server kept running):', err);
    });
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received');
      if (server) {
        server.close(() => logger.info('Server closed due to SIGTERM'));
      }
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
