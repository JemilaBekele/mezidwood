const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { capacityService } = require('../services');

// Create Capacity Slot
const createCapacitySlot = async (req, res) => {
  try {
    const capacityData = req.body;

    // Use the imported function
    const capacitySlot = await capacityService.createCapacitySlot(capacityData);

    res.status(201).json({
      success: true,
      data: capacitySlot,
    });
  } catch (error) {
    // Handle Prisma unique constraint violation
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        error: `Capacity slot already exists for stage: ${req.body.stage}`,
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
      error: 'Failed to create capacity slot',
    });
  }
};
// Get Capacity Report
const getCapacityReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const report = await capacityService.getCapacityReport(
      startDate,
      endDate,
    );

    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error) {
    console.error('Get Capacity Report Error:', error);

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to generate capacity report',
    });
  }
};
// Get Capacity Slot by ID
const getCapacitySlot = catchAsync(async (req, res) => {
  const capacitySlot = await capacityService.getCapacitySlotById(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    capacitySlot,
  });
});

// Get all Capacity Slots
const getCapacitySlots = catchAsync(async (req, res) => {
  const result = await capacityService.getAllCapacitySlots();
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Get Capacity Slot by Stage
const getCapacitySlotByStage = catchAsync(async (req, res) => {
  const capacitySlot = await capacityService.getCapacitySlotByStage(
    req.params.stage,
  );
  res.status(httpStatus.OK).send({
    success: true,
    capacitySlot,
  });
});

// Update Capacity Slot
const updateCapacitySlot = catchAsync(async (req, res) => {
  const capacitySlot = await capacityService.updateCapacitySlot(
    req.params.id,
    req.body,
  );
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Capacity slot updated successfully',
    capacitySlot,
  });
});

// Delete Capacity Slot
const deleteCapacitySlot = catchAsync(async (req, res) => {
  await capacityService.deleteCapacitySlot(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Capacity slot deleted successfully',
  });
});

module.exports = {
  getCapacityReport,
  createCapacitySlot,
  getCapacitySlot,
  getCapacitySlots,
  getCapacitySlotByStage,
  updateCapacitySlot,
  deleteCapacitySlot,
};
