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
const documentRouter = require('../routes/document.route');
const rolesRouter = require('../routes/role.route');
const permissionRouter = require('../routes/permission.route');
const rolePermissionRouter = require('../routes/rolePermission.route');
const stageRouter = require('../routes/stage.route');
const sellRouter = require('../routes/Sell.route');
const StockCorrectionRouter = require('../routes/StockCorrection.route');
const CategoryRouter = require('../routes/Category.route');
const customerRouter = require('../routes/Customer.route');
const BankRouter = require('../routes/Bank.route');
const ProformaInvoiceRouter = require('../routes/ProformaInvoice.route');
const ItemRouter = require('../routes/Items.route');
const MaterialCategoryRouter = require('../routes/MaterialCategory.route');
const CapacitySlotRouter = require('../routes/CapacityLot.route');
const materialRouter = require('../routes/Material.route');
const ResetRouter = require('../routes/yearend.route');
const projectRouter = require('../routes/Project.route');
const DeliveryEstimationRouter = require('../routes/DeliveryEstimation.route');
const ProjectStageWorkLogRouter = require('../routes/ProjectStageWorkLog.route');
const purchaseRouter = require('../routes/purchase.route');
const UnitOfMeasureRouter = require('../routes/UnitOfMeasure.route');
const ProductRouter = require('../routes/Product.route');
const showroomRouter = require('../routes/Sowroom.route');
const transferRourer = require('../routes/transferitem.route');
const productcategoryRouter = require('../routes/producttype.route');
const StoreRouter = require('../routes/Store.route');
const reportsRouter = require('../routes/dashboard.route');
const SchedulingSettingsRouter = require('../routes/SchedulingSettings.route');
const HolidayRouter = require('../routes/Holiday.route');
const { errorHandler, errorConverter } = require('../middlewares/error');
const ApiError = require('../utils/ApiError');
const morgan = require('../config/morgan');
const { jwtStrategy } = require('../config/passport');
const {
  cspOptions,
  env,
  cors: corsConfig,
} = require('../config/config');

module.exports = async (app) => {
  app.use(morgan.successHandler);
  app.use(morgan.errorHandler);
  // jwt authentication
  app.use(passport.initialize());
  passport.use('jwt', jwtStrategy);
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

  // security
  app.use(xss());
  app.use(
    helmet({
      contentSecurityPolicy: cspOptions,
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // Add this line
    }),
  );
  app.use(mongoSanitize());
  if (env === 'production') {
    // NOTE: an Origin header never carries a trailing slash, so entries must be
    // normalised or every preflight fails. Driven by CORS_ALLOWED_ORIGINS.
    const allowedOrigins = corsConfig.allowedOrigins.map((origin) =>
      origin.replace(/\/+$/, ''),
    );
    const corsOptions = { origin: allowedOrigins, credentials: true };
    app.use(cors(corsOptions));
    app.options('*', cors(corsOptions));
  } else {
    // enabling all cors
    app.use(cors());
    app.options('*', cors());
  }

  app.use(ResetRouter);

  app.use(reportsRouter);
  app.use(transferRourer);
  app.use(authRouter);
  app.use(rolesRouter);
  app.use(sellRouter);
  app.use(ProjectStageWorkLogRouter);
  app.use(permissionRouter);
  app.use(rolePermissionRouter);
  app.use(companyRouter);
  app.use(materialRouter);
  app.use(documentRouter);
  app.use(CategoryRouter);
  app.use(MaterialCategoryRouter);
  app.use(customerRouter);
  app.use(ProformaInvoiceRouter);
  app.use(UnitOfMeasureRouter);
  app.use(ProductRouter);
  app.use(purchaseRouter);
  app.use(showroomRouter);
  app.use(StoreRouter);
  app.use(StockCorrectionRouter);
  app.use(projectRouter);
  app.use(CapacitySlotRouter);
  app.use(SchedulingSettingsRouter);
  app.use(HolidayRouter);
  app.use(BankRouter);
  app.use(ItemRouter);
  app.use(DeliveryEstimationRouter);
  app.use(stageRouter);
  app.use(productcategoryRouter);

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
