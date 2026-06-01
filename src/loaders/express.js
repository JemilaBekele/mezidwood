const express = require('express');
const httpStatus = require('http-status');
const passport = require('passport');
const { xss } = require('express-xss-sanitizer');
const helmet = require('helmet');

const mongoSanitize = require('express-mongo-sanitize');
const cors = require('cors');
const path = require('path');
const authRouter = require('../routes/auth.route');
const companyRouter = require('../routes/company.route');
const rolesRouter = require('../routes/role.route');
const permissionRouter = require('../routes/permission.route');
const rolePermissionRouter = require('../routes/rolePermission.route');

const curtainRouter = require('../routes/CurtainOrder.route');
const curtaintypeRouter = require('../routes/CurtainType.route');
const CategoryRouter = require('../routes/Category.route');
const branchRouter = require('../routes/Branch.route');
const customerRouter = require('../routes/Customer.route');
const shopRouter = require('../routes/Shop.route');
const storeRouter = require('../routes/Store.route');
const curtainWorkerLogRouter = require('../routes/CurtainWorkerLog.route');
const GeneralDashboardRouter = require('../routes/GeneralDashboard.route');
const purchaseRouter = require('../routes/purchase.route');
const UnitOfMeasureRouter = require('../routes/UnitOfMeasure.route');
const ProductRouter = require('../routes/Product.route');
const productBatchRouter = require('../routes/ProductBatch.route');
const transferRourer = require('../routes/transfer.route');
const stockcorrectionRouter = require('../routes/StockCorrection.route');
const ExpenseRouter = require('../routes/expence.route');

const workercommissionsRouter = require('../routes/workerCommission.routes');
const { errorHandler, errorConverter } = require('../middlewares/error');
const ApiError = require('../utils/ApiError');
const morgan = require('../config/morgan');
const { jwtStrategy } = require('../config/passport');
const { cspOptions, env } = require('../config/config');

module.exports = async (app) => {
  app.use(morgan.successHandler);
  app.use(morgan.errorHandler);
  // jwt authentication
  app.use(passport.initialize());
  passport.use('jwt', jwtStrategy);
  app.use(express.json());
  app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

  // security
  app.use(xss());
  app.use(
    helmet({
      contentSecurityPolicy: cspOptions,
    }),
  );
  app.use(mongoSanitize());
  if (env === 'production') {
    app.use(
      cors({
        origin: ['https://curtain.smartdent.online', 'http://localhost:3000'],
        credentials: true,
      }),
    );
    app.options(
      '*',
      cors({
        origin: ['https://curtain.smartdent.online/', 'http://localhost:3000'],
        credentials: true,
      }),
    );
  } else {
    // enabling all cors
    app.use(cors());
    app.options('*', cors());
  }
  app.use(authRouter);
  app.use(rolesRouter);
  app.use(permissionRouter);
  app.use(rolePermissionRouter);
  app.use(companyRouter);
  app.use(GeneralDashboardRouter);
  app.use(curtaintypeRouter);
  app.use(curtainRouter);
  app.use(curtainWorkerLogRouter);
  app.use(CategoryRouter);
  app.use(branchRouter);
  app.use(customerRouter);
  app.use(shopRouter);
  app.use(storeRouter);
  app.use(productBatchRouter);
  app.use(ExpenseRouter);
  app.use(UnitOfMeasureRouter);
  app.use(ProductRouter);
  app.use(purchaseRouter);
  app.use(transferRourer);
  app.use(stockcorrectionRouter);
  app.use(workercommissionsRouter);
  // Error handling middleware
  // Then your 404 handler
  // 404 handler - MODIFY THIS
  app.use((req, res, next) => {
    const error = new ApiError(
      httpStatus.NOT_FOUND,
      `Not found - ${req.method} ${req.originalUrl}`,
    );
    next(error);
  });
  app.use(errorConverter);
  app.use(errorHandler);
  return app;
};
