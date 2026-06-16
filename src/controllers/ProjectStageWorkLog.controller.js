const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { projectStageWorkLogService } = require('../services');

// Create Project Stage Work Log
const createProjectStageWorkLog = async (req, res) => {
  try {
    const doneById = req.user.id;
    const workLog = req.body;
    const workLogData = { workLog, doneById };
    const result = await projectStageWorkLogService.createProjectStageWorkLog(
      workLogData,
    );

    res.status(httpStatus.CREATED).json({
      success: true,
      message: result.message,
      data: {
        workLog: result.workLog,
        stageCompleted: result.stageCompleted,
      },
    });
  } catch (error) {
    // Prisma errors
    if (error.code === 'P2003') {
      return res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        error: 'Invalid project stage or user reference',
      });
    }

    // Custom ApiError
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    // Generic error
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: 'Failed to create project stage work log',
    });
  }
};

// Delete Project Stage Work Log
const deleteProjectStageWorkLog = catchAsync(async (req, res) => {
  const result = await projectStageWorkLogService.deleteProjectStageWorkLog(
    req.params.id,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: result.message,
    deletedWorkLog: result.deletedWorkLog,
  });
});

module.exports = {
  createProjectStageWorkLog,
  deleteProjectStageWorkLog,
};
