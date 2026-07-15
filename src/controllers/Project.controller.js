/* eslint-disable no-underscore-dangle */
const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { projectService } = require('../services');
const { prisma } = require('../services/prisma'); // Adjust the path if your prisma client is elsewhere
const ApiError = require('../utils/ApiError');
const {
  rescheduleStageAndDownstream,
} = require('../services/scheduling/reschedule');

// Create Project
const createProject = async (req, res) => {
  try {
    const projectData = req.body;
    const userId = req.user.id; // Assuming user ID is available in req.user

    // Use the imported function
    const project = await projectService.createProject(projectData, userId);

    res.status(201).json({
      success: true,
      data: project,
    });
  } catch (error) {
    // Handle Prisma unique constraint violation for invoiceId
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        error: `Project already exists with invoice ID: ${req.body.invoiceId}`,
      });
    }

    // Handle foreign key constraint violations
    if (error.code === 'P2003') {
      return res.status(400).json({
        success: false,
        error: 'Invalid customer or invoice reference',
      });
    }

    // Handle your custom ApiError
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    // Generic error
    res.status(500).json({
      success: false,
      error: 'Failed to create project',
      details: error.message,
    });
  }
};

// Get Project by ID
const getProject = catchAsync(async (req, res) => {
  const project = await projectService.getProjectById(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    project,
  });
});

// Get all Projects with filtering
const getProjects = catchAsync(async (req, res) => {
  const filters = {
    page: req.query.page,
    limit: req.query.limit,
    sortBy: req.query.sortBy,
    sortOrder: req.query.sortOrder,
    search: req.query.search,
    status: req.query.status,
    difficulty: req.query.difficulty,
    customerId: req.query.customerId,
    createdById: req.query.createdById,
    startDate: req.query.startDate,
    endDate: req.query.endDate,
  };

  const result = await projectService.getAllProjects(filters);
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Get Projects by Customer ID
const getCustomerProjects = catchAsync(async (req, res) => {
  const { customerId } = req.params;
  const filters = {
    page: req.query.page,
    limit: req.query.limit,
    status: req.query.status,
  };

  const result = await projectService.getProjectsByCustomerId(
    customerId,
    filters,
  );
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Search Projects by customer or invoice
const searchProjects = catchAsync(async (req, res) => {
  const { query } = req.query;
  const limit = parseInt(req.query.limit, 10) || 10;

  if (!query) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Search query parameter "query" is required',
    });
  }

  // Use the getAllProjects service with search filter
  const result = await projectService.getAllProjects({
    search: query,
    limit,
    page: 1,
  });

  res.status(httpStatus.OK).send({
    success: true,
    projects: result.projects,
    count: result.pagination.total,
  });
});

// Update Project
const updateProject = catchAsync(async (req, res) => {
  const userId = req.user.id; // Assuming user ID is available in req.user
  const project = await projectService.updateProject(
    req.params.id,
    req.body,
    userId,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Project updated successfully',
    project,
  });
});

// Update Project Status
const updateProjectStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const userId = req.user.id;

  if (!status) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Status is required',
    });
  }

  const project = await projectService.updateProjectStatus(id, status, userId);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Project status updated successfully',
    project,
  });
});

const updateProjectDesignStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { designStatus } = req.body;
  const userId = req.user.id;

  if (!designStatus) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Design status is required',
    });
  }

  const project = await projectService.updateProjectDesignStatus(
    id,
    designStatus,
    userId,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Project design status updated successfully',
    project,
  });
});
// Calculate Project Delivery
const calculateDelivery = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { totalDays } = req.body;
  const userId = req.user.id;

  if (!totalDays || totalDays <= 0) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'Total days must be a positive number',
    });
  }

  const project = await projectService.calculateProjectDelivery(
    id,
    totalDays,
    userId,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Project delivery calculated successfully',
    project,
  });
});

// Delete Project
const deleteProject = catchAsync(async (req, res) => {
  await projectService.deleteProject(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Project deleted successfully',
  });
});

// Get Project Statistics
const getProjectStatistics = catchAsync(async (req, res) => {
  // Get counts by status
  const statusCounts = await prisma.project.groupBy({
    by: ['status'],
    _count: {
      status: true,
    },
  });

  // Get counts by difficulty
  const difficultyCounts = await prisma.project.groupBy({
    by: ['difficulty'],
    _count: {
      difficulty: true,
    },
  });

  // Get total projects count
  const totalProjects = await prisma.project.count();

  // Get projects completed this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const projectsThisMonth = await prisma.project.count({
    where: {
      createdAt: {
        gte: startOfMonth,
      },
    },
  });

  res.status(httpStatus.OK).send({
    success: true,
    statistics: {
      totalProjects,
      projectsThisMonth,
      statusCounts: statusCounts.reduce((acc, item) => {
        acc[item.status] = item._count.status;
        return acc;
      }, {}),
      difficultyCounts: difficultyCounts.reduce((acc, item) => {
        acc[item.difficulty] = item._count.difficulty;
        return acc;
      }, {}),
    },
  });
});
// Auto-schedule project stages
const autoScheduleProjectStages = catchAsync(async (req, res) => {
  const { projectId } = req.params;

  try {
    // Call the scheduling service function
    const result = await projectService.autoScheduleProjectStages(
      projectId,
      req.user?.id,
    );

    res.status(httpStatus.OK).send({
      success: true,
      message: 'Project stages auto-scheduled successfully',
      data: {
        project: result.project,
        schedulingReport: result.schedulingReport,
      },
    });
  } catch (error) {
    // Handle specific errors
    if (error.code === 'P2025') {
      return res.status(httpStatus.NOT_FOUND).send({
        success: false,
        message: 'Project not found',
        error: error.meta?.cause || 'Record not found',
      });
    }

    if (error.statusCode) {
      return res.status(error.statusCode).send({
        success: false,
        message: error.message,
        error: error.data || error,
      });
    }

    // Generic error
    res.status(httpStatus.INTERNAL_SERVER_ERROR).send({
      success: false,
      message: 'Failed to auto-schedule project stages',
      error: error.message,
    });
  }
});
// Schedule project with manual delivery date
const manualScheduleProjectStage = catchAsync(async (req, res) => {
  const { projectId } = req.params;
  const { manualDelivery } = req.body;

  // Validate required fields
  if (!manualDelivery) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      message: 'Manual delivery date is required',
    });
  }

  try {
    // Call the manual scheduling service function
    const result = await projectService.manualScheduleProjectStage(
      projectId,
      manualDelivery,
      req.user?.id,
    );

    res.status(httpStatus.OK).send({
      success: true,
      message: 'Project scheduled successfully with manual delivery date',
      data: {
        project: result.project,
        message: result.message,
      },
    });
  } catch (error) {
    // Handle specific errors
    if (error.code === 'P2025') {
      return res.status(httpStatus.NOT_FOUND).send({
        success: false,
        message: 'Project not found',
        error: error.meta?.cause || 'Record not found',
      });
    }

    if (error.statusCode) {
      return res.status(error.statusCode).send({
        success: false,
        message: error.message,
        error: error.data || error,
      });
    }

    // Validate date format error
    if (error.message.includes('Invalid date')) {
      return res.status(httpStatus.BAD_REQUEST).send({
        success: false,
        message: 'Invalid date format. Please use ISO date format (YYYY-MM-DD)',
      });
    }

    // Generic error
    res.status(httpStatus.INTERNAL_SERVER_ERROR).send({
      success: false,
      message: 'Failed to schedule project with manual delivery date',
      error: error.message,
    });
  }
});
const getAllProjectBystatus = catchAsync(async (req, res) => {
  const result = await projectService.getAllProjectBystatus();
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

const updateProjectStage = catchAsync(async (req, res) => {
  const {
    projectId,
    stageName,
    newQuantity,
    allowOverCapacity = false,
    customDates = null,
    manualOverride = false,
    isNewStage = false,
    timeTakenMinutes = null,
    createManualWorkLog = false,
  } = req.body;

  const userId = req.user?.id;

  // ===============================
  // VALIDATION
  // ===============================
  if (!projectId || !stageName || newQuantity === undefined) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'projectId, stageName, and newQuantity are required',
    );
  }

  if (typeof newQuantity !== 'number' || newQuantity < 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'newQuantity must be a positive number',
    );
  }

  if (
    timeTakenMinutes !== null &&
    timeTakenMinutes !== undefined &&
    (!Number.isInteger(timeTakenMinutes) || timeTakenMinutes < 0)
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'timeTakenMinutes must be a non-negative integer',
    );
  }

  // Validate custom dates
  if (customDates) {
    const { startDate, endDate } = customDates;

    if (startDate && isNaN(new Date(startDate).getTime())) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid startDate format');
    }

    if (endDate && isNaN(new Date(endDate).getTime())) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid endDate format');
    }

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (start > end) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'startDate must be before endDate',
        );
      }
    }
  }

  // ===============================
  // SERVICE CALL
  // ===============================
  const result = await projectService.updateProjectStage(
    projectId,
    stageName,
    newQuantity,
    userId,
    allowOverCapacity,
    customDates,
    manualOverride,
    isNewStage,
    timeTakenMinutes,
    createManualWorkLog,
  );

  // ===============================
  // RESPONSE
  // ===============================
  res.status(httpStatus.OK).send({
    success: true,
    message: isNewStage
      ? `Stage ${stageName} added successfully`
      : `Stage ${stageName} updated successfully`,
    data: result,
  });
});

const deleteProjectStage = catchAsync(async (req, res) => {
  const { projectId, stageName, deleteDownstream = false } = req.body;
  const userId = req.user?.id;
  console.log('Delete request received:', { projectId, stageName, deleteDownstream, userId });

  // ===============================
  // VALIDATION
  // ===============================
  if (!projectId || !stageName) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'projectId and stageName are required',
    );
  }

  // Validate projectId format (UUID)
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(projectId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid projectId format');
  }

  // Validate stageName is a valid enum value
  const validStages = [
    'INVOICE',
    'DESIGN',
    'PURCHASING',
    'METAL_WORKS',
    'CNC',
    'CUTTING',
    'EDGE_BANDING',
    'ASSEMBLY',
    'PAINTING',
    'FINISHING',
    'DELIVERY',
    'INSTALLATION',
    'COMPLETED',
    'CANCELLED',
  ];

  if (!validStages.includes(stageName)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Invalid stageName. Must be one of: ${validStages.join(', ')}`,
    );
  }

  // Validate deleteDownstream is boolean
  if (typeof deleteDownstream !== 'boolean') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'deleteDownstream must be a boolean value',
    );
  }

  // ===============================
  // SERVICE CALL
  // ===============================
  const result = await projectService.deleteProjectStage(
    projectId,
    stageName,
    userId,
    deleteDownstream,
  );

  // ===============================
  // RESPONSE
  // ===============================
  res.status(httpStatus.OK).send({
    success: true,
    message: deleteDownstream
      ? `Stage ${stageName} and downstream stages deleted successfully`
      : `Stage ${stageName} deleted successfully`,
    data: result,
  });
});
// ============================================
// NEW CONTROLLER: Capacity Analysis
// ============================================
const getCapacityAnalysis = catchAsync(async (req, res) => {
  const { stage, startDate, endDate, requiredQuantity } = req.body;

  if (!stage || !startDate || !endDate || !requiredQuantity) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'stage, startDate, endDate, and requiredQuantity are required',
    );
  }

  const analysis = await projectService.getCapacityAnalysisForDateRange(
    stage,
    new Date(startDate),
    new Date(endDate),
    Number(requiredQuantity),
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: analysis.recommendation,
    analysis,
  });
});

// ============================================
// NEW CONTROLLER: Get Daily Capacity Status
// ============================================
const getDailyCapacityStatus = catchAsync(async (req, res) => {
  const { stage, date } = req.query;

  if (!stage || !date) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'stage and date are required');
  }

  const status = await projectService.getDateCapacityStatus(
    stage,
    new Date(date),
  );

  if (!status) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      `No capacity configuration found for stage: ${stage}`,
    );
  }

  res.status(httpStatus.OK).send({
    success: true,
    status,
  });
});

// ============================================
// NEW CONTROLLER: Force Over-Capacity Allocation
// ============================================
const addOverCapacity = catchAsync(async (req, res) => {
  const { stage, date, requiredUnits, requiredHours } = req.body;

  if (!stage || !date || !requiredUnits || !requiredHours) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'stage, date, requiredUnits, and requiredHours are required',
    );
  }

  const allocation = await projectService.addOverCapacityAllocation(
    stage,
    new Date(date),
    Number(requiredUnits),
    Number(requiredHours),
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Over-capacity allocation added successfully',
    allocation,
  });
});

// Set schedule mode (lock / unlock / manual) for a project
const setScheduleMode = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { mode } = req.body;
  const userId = req.user?.id;

  if (!mode) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'mode is required (AUTO | MANUAL | LOCKED)',
    });
  }

  const project = await projectService.setProjectScheduleMode(id, mode, userId);
  res.status(httpStatus.OK).send({
    success: true,
    message: `Schedule mode set to ${mode}`,
    project,
  });
});

// Cancel a single stage (release its capacity, drop it from the DAG)
const cancelProjectStage = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { stageName } = req.body;
  const userId = req.user?.id;

  if (!stageName) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error: 'stageName is required',
    });
  }

  const project = await projectService.cancelProjectStage(
    id,
    stageName,
    userId,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: `Stage ${stageName} cancelled`,
    project,
  });
});

// Schedule/delivery audit trail for a project
const getScheduleHistory = catchAsync(async (req, res) => {
  const { id } = req.params;
  const history = await projectService.getProjectScheduleHistory(id);
  res.status(httpStatus.OK).send({
    success: true,
    count: history.length,
    history,
  });
});

// Reschedule a stage + downstream from capacity calendar drag
const rescheduleFromCalendar = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { stageName, newStartDate, fromDate, units, pastCellMove } = req.body;
  const userId = req.user?.id;

  if (!stageName || !newStartDate) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'stageName and newStartDate are required',
    );
  }

  const parsedDate = new Date(newStartDate);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid newStartDate format');
  }

  const parsedFromDate = fromDate ? new Date(fromDate) : null;
  if (parsedFromDate && Number.isNaN(parsedFromDate.getTime())) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid fromDate format');
  }

  // Optional partial move: how many of the source-day cell's units to relocate.
  let parsedUnits = null;
  if (units != null && units !== '') {
    parsedUnits = Number(units);
    if (Number.isNaN(parsedUnits) || parsedUnits <= 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'units must be a positive number',
      );
    }
  }

  const result = await rescheduleStageAndDownstream(id, stageName, parsedDate, {
    byUserId: userId,
    fromDate: parsedFromDate,
    units: parsedUnits,
    pastCellMove: pastCellMove === true,
  });

  if (!result) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      'Project or stage not found, or no active stages to reschedule',
    );
  }

  res.status(httpStatus.OK).send({
    success: true,
    message: `Stage ${stageName} and downstream rescheduled successfully`,
    data: result,
  });
});

// Export controllers
module.exports = {
  deleteProjectStage,
  updateProjectStage,
  getCapacityAnalysis,
  getDailyCapacityStatus,
  addOverCapacity,
  createProject,
  getProject,
  getProjects,
  getCustomerProjects,
  searchProjects,
  updateProject,
  updateProjectStatus,
  updateProjectDesignStatus,
  calculateDelivery,
  deleteProject,
  getProjectStatistics,
  manualScheduleProjectStage,
  autoScheduleProjectStages,
  getAllProjectBystatus,
  setScheduleMode,
  cancelProjectStage,
  getScheduleHistory,
  rescheduleFromCalendar,
};
