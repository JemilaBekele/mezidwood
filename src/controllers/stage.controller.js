const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { stages } = require('../services');
const ApiError = require('../utils/ApiError');

const getMetalWorkProjects = catchAsync(async (req, res) => {
  let { status = 'all' } = req.query;

  const allowedStatus = ['finished', 'not-finished', 'all'];

  if (!allowedStatus.includes(status)) {
    status = 'all';
  }

  const result = await stages.getMetalWorkProjects(status);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getCNCProjects = catchAsync(async (req, res) => {
  let { status = 'all' } = req.query;

  const allowedStatus = ['finished', 'not-finished', 'all'];

  if (!allowedStatus.includes(status)) {
    status = 'all';
  }

  const result = await stages.getCNCProjects(status);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getCuttingProjects = catchAsync(async (req, res) => {
  let { status = 'all' } = req.query;

  const allowedStatus = ['finished', 'not-finished', 'all'];

  if (!allowedStatus.includes(status)) {
    status = 'all';
  }

  const result = await stages.getCuttingProjects(status);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getEdgeBandingProjects = catchAsync(async (req, res) => {
  let { status = 'all' } = req.query;

  const allowedStatus = ['finished', 'not-finished', 'all'];

  if (!allowedStatus.includes(status)) {
    status = 'all';
  }

  const result = await stages.getEdgeBandingProjects(status);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getAssemblyProjects = catchAsync(async (req, res) => {
  let { status = 'all' } = req.query;

  const allowedStatus = ['finished', 'not-finished', 'all'];

  if (!allowedStatus.includes(status)) {
    status = 'all';
  }

  const result = await stages.getAssemblyProjects(status);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getPaintingProjects = catchAsync(async (req, res) => {
  let { status = 'all' } = req.query;

  const allowedStatus = ['finished', 'not-finished', 'all'];

  if (!allowedStatus.includes(status)) {
    status = 'all';
  }

  const result = await stages.getPaintingProjects(status);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
//
const getFinishingProjects = catchAsync(async (req, res) => {
  let { status = 'all' } = req.query;

  const allowedStatus = ['finished', 'not-finished', 'all'];

  if (!allowedStatus.includes(status)) {
    status = 'all';
  }
  const result = await stages.getFinishingProjects(status);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getDeliveryProjects = catchAsync(async (req, res) => {
  let { status = 'all' } = req.query;

  // Expanded allowed statuses to include all new filter options
  const allowedStatus = [
    'all',
    'finished',
    'not-finished',
    'pending',
    'partially-delivered',
    'approved',
    'in-progress',
  ];

  // Validate and sanitize status parameter
  if (!allowedStatus.includes(status)) {
    status = 'all';
  }

  const result = await stages.getDeliveryProjects(status);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getInstallationProjects = catchAsync(async (req, res) => {
  let { status = 'all' } = req.query;

  const allowedStatus = ['finished', 'not-finished', 'all'];

  if (!allowedStatus.includes(status)) {
    status = 'all';
  }

  const result = await stages.getInstallationProjects(status);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getMaterialUsageReport = catchAsync(async (req, res) => {
  const result = await stages.getMaterialUsageReport();

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getPurchasingProjects = catchAsync(async (req, res) => {
  let { status = 'all' } = req.query;

  const allowedStatus = ['finished', 'not-finished', 'all'];

  if (!allowedStatus.includes(status)) {
    status = 'all';
  }

  const result = await stages.getPurchasingProjects(status);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

const getDesignProjects = catchAsync(async (req, res) => {
  let { status = 'all' } = req.query;

  const allowedStatus = ['finished', 'not-finished', 'all'];

  if (!allowedStatus.includes(status)) {
    status = 'all';
  }

  const result = await stages.getDesignProjects(status);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getbyDesignProject = catchAsync(async (req, res) => {
  let { status = 'all' } = req.query;

  const allowedStatus = ['finished', 'not-finished', 'all'];

  if (!allowedStatus.includes(status)) {
    status = 'all';
  }

  const result = await stages.getbyDesignProject(status, req.user.id);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getUnassignedDesignProjects = catchAsync(async (req, res) => {
  let { status = 'all' } = req.query;

  const allowedStatus = ['finished', 'not-finished', 'all'];

  if (!allowedStatus.includes(status)) {
    status = 'all';
  }

  const result = await stages.getUnassignedDesignProjects(status);

  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});
const getStageLeftWork = catchAsync(async (req, res) => {
  const result = await stages.getStageLeftWork();
  
  res.status(httpStatus.OK).send({
    success: true,
    data: result,
    count: result.length,
  });
});
module.exports = {
  getUnassignedDesignProjects,
  getbyDesignProject,
  getDesignProjects,
  getPurchasingProjects,
  getMaterialUsageReport,
  getMetalWorkProjects,
  getCNCProjects,
  getCuttingProjects,
  getEdgeBandingProjects,
  getAssemblyProjects,
  getPaintingProjects,
  getFinishingProjects,
  getInstallationProjects,
  getDeliveryProjects,
  getStageLeftWork,
};
