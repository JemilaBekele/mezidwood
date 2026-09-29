const express = require('express');
const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');
const { getOverviewInsights } = require('../services/overviewInsights.service');

const router = express.Router();

// Overview dashboard insights (delivery health, pipeline, collections)
router.get(
  '/api/reports/overview-insights',
  auth,
  checkPermission('VIEW_DASHBOARD_COUNTS'),
  catchAsync(async (req, res) => {
    const data = await getOverviewInsights();
    res.status(httpStatus.OK).json({
      success: true,
      message: 'Overview insights fetched successfully',
      data,
    });
  }),
);

module.exports = router;
