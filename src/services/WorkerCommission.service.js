// services/WorkerCommission.service.js

const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');

/**
 * Calculate worker commission based on approved worker logs
 * @param {string} workerId - The worker ID
 * @param {string} workerType - 'THICK' or 'THIN'
 * @param {Date} startDate - Start date for filtering
 * @param {Date} endDate - End date for filtering
 * @returns {Promise<Object>} Commission calculation result
 */
const calculateWorkerCommission = async (
  workerId,
  workerType,
  startDate,
  endDate,
  workerPercent = 0, // Added workerPercent parameter
) => {
  try {
    // Get all approved worker logs for the specified worker
    const workerLogs = await prisma.curtainWorkerLog.findMany({
      where: {
        workerId,
        workerType,
        status: 'APPROVED',
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        curtainMeasurement: {
          include: {
            order: true,
          },
        },
        shopProductVariant: {
          include: {
            shopStock: {
              include: {
                product: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (workerLogs.length === 0) {
      return {
        workerId,
        workerType,
        totalCommission: 0,
        totalMeasurements: 0,
        logs: [],
        message: 'No approved logs found for this period',
      };
    }

    // Calculate commission for each log using the new formula
    let totalCommission = 0;
    const logsWithCommission = workerLogs.map((log) => {
      let commission = 0;

      // NEW LOGIC: Based on totalWorkerMeter from the measurement
      const totalLabor = log.curtainMeasurement.totalWorkerMeter || 0;

      if (totalLabor > 0) {
        // divide for thin & thick
        const workerBase = totalLabor / 2;
        // get percent from frontend
        const percent = workerPercent || 0;
        // calculate commission
        commission = (workerBase * percent) / 100;
      }

      totalCommission += commission;

      return {
        logId: log.id,
        measurementId: log.curtainMeasurementId,
        roomName: log.curtainMeasurement.roomName,
        orderId: log.curtainMeasurement.orderId,
        assignedWidth: log.widthmeterAssigned,
        assignedHeight: log.heightmeterAssigned,
        assignedQuantity: log.quantityAssigned,
        completedWidth: log.widthmeterCompleted,
        completedHeight: log.heightmeterCompleted,
        completedQuantity: log.quantityCompleted,
        totalWorkerMeter: log.curtainMeasurement.totalWorkerMeter,
        workerBase: totalLabor / 2,
        percentage: percent,
        commission,
        createdAt: log.createdAt,
        note: log.note,
      };
    });

    return {
      workerId,
      workerType,
      totalCommission,
      totalMeasurements: workerLogs.length,
      logs: logsWithCommission,
      dateRange: {
        startDate,
        endDate,
      },
      percentageUsed: workerPercent,
    };
  } catch (error) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to calculate worker commission',
    );
  }
};

/**
 * Get unpaid worker commissions report
 * @param {string} workerType - 'THICK' or 'THIN' (optional, get all if not specified)
 * @param {Date} startDate - Start date for filtering (optional)
 * @param {Date} endDate - End date for filtering (optional)
 * @param {number} workerPercent - Commission percentage set by owner (required)
 * @returns {Promise<Object>} Unpaid commissions report
 */
const getUnpaidWorkerCommissionsReport = async (
  workerType = null,
  startDate = null,
  endDate = null,
  workerPercent = 0, // Make sure this parameter is received
) => {
  try {
    // IMPORTANT: Validate workerPercent
    const percent = Number(workerPercent) || 0;

    // Build date filter
    const dateFilter = {};
    if (startDate && endDate) {
      // Create start date at beginning of day
      const startDateTime = new Date(startDate);
      startDateTime.setHours(0, 0, 0, 0);

      // Create end date at end of day (23:59:59.999)
      const endDateTime = new Date(endDate);
      endDateTime.setHours(23, 59, 59, 999);

      dateFilter.createdAt = {
        gte: startDateTime,
        lte: endDateTime,
      };

    
    }

    // Get all measurements with unpaid workers
    const whereCondition = {
      ...dateFilter,
    };

    if (workerType === 'THICK') {
      whereCondition.thickWorkerPaid = false;
      whereCondition.thickWorkerId = { not: null };
    } else if (workerType === 'THIN') {
      whereCondition.thinWorkerPaid = false;
      whereCondition.thinWorkerId = { not: null };
    } else {
      whereCondition.OR = [
        { thickWorkerPaid: false, thickWorkerId: { not: null } },
        { thinWorkerPaid: false, thinWorkerId: { not: null } },
      ];
    }

    const measurements = await prisma.curtainMeasurement.findMany({
      where: whereCondition,
      include: {
        order: {
          include: {
            customer: true,
            Shop: true,
          },
        },
        thickWorker: true,
        thinWorker: true,
        curtainWorkerLogs: {
          where: {
            status: 'APPROVED',
          },
          include: {
            worker: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Process measurements to extract worker data using NEW LOGIC
    const workerMap = measurements.reduce((map, measurement) => {
      // Calculate commission using the formula
      const totalLabor = measurement.totalWorkerMeter || 0;
      const workerBase = totalLabor / 2;
      // CRITICAL FIX: Use the percent parameter, not measurement.percentage
      const commissionAmount = (workerBase * percent) / 100;

   
      // Process thick worker
      if (
        measurement.thickWorker &&
        !measurement.thickWorkerPaid &&
        workerType !== 'THIN'
      ) {
        const workerId = measurement.thickWorker.id;

        if (!map.has(workerId)) {
          map.set(workerId, {
            workerId,
            workerName: measurement.thickWorker.name,
            workerType: 'THICK',
            totalUnpaidAmount: 0,
            totalMeasurementsCompleted: 0,
            totalCurtainOrders: new Set(),
            measurements: [],
          });
        }

        const workerData = map.get(workerId);
        workerData.totalUnpaidAmount += commissionAmount;
        workerData.totalMeasurementsCompleted += 1;
        workerData.totalCurtainOrders.add(measurement.orderId);

        const measurementDetails = {
          measurementId: measurement.id,
          roomName: measurement.roomName,
          orderId: measurement.orderId,
          orderNumber: measurement.order.invoiceNo || measurement.order.id,
          customerName: measurement.order.customer?.name,
          shopName: measurement.order.Shop?.name,
          commissionAmount, // Use calculated amount
          totalWorkerMeter: measurement.totalWorkerMeter,
          workerBase,
          percentage: percent, // Use the percent parameter
          completedAt: measurement.updatedAt,
          measurementDetails: measurement.curtainWorkerLogs
            .filter(
              (log) => log.workerId === workerId && log.workerType === 'THICK',
            )
            .map((log) => ({
              logId: log.id,
              assignedWidth: log.widthmeterAssigned,
              assignedHeight: log.heightmeterAssigned,
              assignedQuantity: log.quantityAssigned,
              completedWidth: log.widthmeterCompleted,
              completedHeight: log.heightmeterCompleted,
              completedQuantity: log.quantityCompleted,
              totalArea:
                log.widthmeterAssigned && log.heightmeterAssigned
                  ? log.widthmeterAssigned * log.heightmeterAssigned
                  : null,
              status: log.status,
              note: log.note,
              completedAt: log.createdAt,
            })),
          originalMeasurement: {
            width: measurement.width,
            height: measurement.height,
            quantity: measurement.quantity,
            curtainSize: measurement.curtainSize,
            totalArea: measurement.width * measurement.height,
          },
          logs: measurement.curtainWorkerLogs
            .filter(
              (log) => log.workerId === workerId && log.workerType === 'THICK',
            )
            .map((log) => ({
              logId: log.id,
              assignedWidth: log.widthmeterAssigned,
              assignedHeight: log.heightmeterAssigned,
              assignedQuantity: log.quantityAssigned,
              completedAt: log.createdAt,
            })),
        };

        workerData.measurements.push(measurementDetails);
      }

      // Process thin worker (same logic)
      if (
        measurement.thinWorker &&
        !measurement.thinWorkerPaid &&
        workerType !== 'THICK'
      ) {
        const workerId = measurement.thinWorker.id;

        if (!map.has(workerId)) {
          map.set(workerId, {
            workerId,
            workerName: measurement.thinWorker.name,
            workerType: 'THIN',
            totalUnpaidAmount: 0,
            totalMeasurementsCompleted: 0,
            totalCurtainOrders: new Set(),
            measurements: [],
          });
        }

        const workerData = map.get(workerId);
        workerData.totalUnpaidAmount += commissionAmount;
        workerData.totalMeasurementsCompleted += 1;
        workerData.totalCurtainOrders.add(measurement.orderId);

        const measurementDetails = {
          measurementId: measurement.id,
          roomName: measurement.roomName,
          orderId: measurement.orderId,
          orderNumber: measurement.order.invoiceNo || measurement.order.id,
          customerName: measurement.order.customer?.name,
          shopName: measurement.order.Shop?.name,
          commissionAmount, // Use calculated amount
          totalWorkerMeter: measurement.totalWorkerMeter,
          workerBase,
          percentage: percent, // Use the percent parameter
          completedAt: measurement.updatedAt,
          measurementDetails: measurement.curtainWorkerLogs
            .filter(
              (log) => log.workerId === workerId && log.workerType === 'THIN',
            )
            .map((log) => ({
              logId: log.id,
              assignedWidth: log.widthmeterAssigned,
              assignedHeight: log.heightmeterAssigned,
              assignedQuantity: log.quantityAssigned,
              completedWidth: log.widthmeterCompleted,
              completedHeight: log.heightmeterCompleted,
              completedQuantity: log.quantityCompleted,
              totalArea:
                log.widthmeterAssigned && log.heightmeterAssigned
                  ? log.widthmeterAssigned * log.heightmeterAssigned
                  : null,
              status: log.status,
              note: log.note,
              completedAt: log.createdAt,
            })),
          originalMeasurement: {
            width: measurement.width,
            height: measurement.height,
            quantity: measurement.quantity,
            curtainSize: measurement.curtainSize,
            totalArea: measurement.width * measurement.height,
          },
          logs: measurement.curtainWorkerLogs
            .filter(
              (log) => log.workerId === workerId && log.workerType === 'THIN',
            )
            .map((log) => ({
              logId: log.id,
              assignedWidth: log.widthmeterAssigned,
              assignedHeight: log.heightmeterAssigned,
              assignedQuantity: log.quantityAssigned,
              completedAt: log.createdAt,
            })),
        };

        workerData.measurements.push(measurementDetails);
      }

      return map;
    }, new Map());

    // Convert map to array and calculate totals
    const unpaidWorkers = Array.from(workerMap.values()).map((worker) => ({
      ...worker,
      totalCurtainOrders: worker.totalCurtainOrders.size,
      totalCurtainOrdersList: Array.from(worker.totalCurtainOrders),
    }));

    const totalUnpaidAmount = unpaidWorkers.reduce(
      (sum, worker) => sum + worker.totalUnpaidAmount,
      0,
    );

    const totalWorkers = unpaidWorkers.length;

    const totalMeasurements = unpaidWorkers.reduce(
      (sum, worker) => sum + worker.measurements.length,
      0,
    );

    const totalCurtainOrders = unpaidWorkers.reduce(
      (sum, worker) => sum + worker.totalCurtainOrders,
      0,
    );

    return {
      summary: {
        totalUnpaidAmount,
        totalWorkers,
        totalMeasurements,
        totalCurtainOrders,
        reportDate: new Date(),
        dateRange: startDate && endDate ? { startDate, endDate } : null,
        percentageUsed: percent,
      },
      workers: unpaidWorkers,
    };
  } catch (error) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to generate unpaid commissions report',
    );
  }
};

/**
 * Mark worker as paid
 * @param {string} measurementId - The curtain measurement ID
 * @param {string} workerType - 'THICK' or 'THIN'
 * @param {number} amount - The amount paid
 * @param {string} userId - The user ID marking as paid
 * @returns {Promise<Object>} Updated measurement
 */
const markWorkerAsPaid = async (measurementId, workerType, amount, userId) => {
  try {
    const updateData = {};

    if (workerType === 'THICK') {
      updateData.thickWorkerPaid = true;
      updateData.thickWorkerPaidDate = new Date();
      updateData.thickWorkerPaidAmount = amount;
    } else if (workerType === 'THIN') {
      updateData.thinWorkerPaid = true;
      updateData.thinWorkerPaidDate = new Date();
      updateData.thinWorkerPaidAmount = amount;
    } else {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid worker type');
    }

    const updatedMeasurement = await prisma.curtainMeasurement.update({
      where: { id: measurementId },
      data: updateData,
      include: {
        thickWorker: true,
        thinWorker: true,
        order: true,
      },
    });

    // Create log entry for payment
    await prisma.log.create({
      data: {
        action: `Marked ${workerType} worker ${
          workerType === 'THICK'
            ? updatedMeasurement.thickWorker?.name
            : updatedMeasurement.thinWorker?.name
        } as paid for measurement ${measurementId}. Amount: ${amount}`,
        userId,
      },
    });

    return updatedMeasurement;
  } catch (error) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to mark worker as paid',
    );
  }
};

/**
 * Generate detailed worker commission report
 * @param {string} workerId - The worker ID
 * @param {string} workerType - 'THICK' or 'THIN'
 * @param {Date} startDate - Start date for filtering
 * @param {Date} endDate - End date for filtering
 * @returns {Promise<Object>} Detailed worker report
 */
const getWorkerDetailedReport = async (
  workerId,
  workerType,
  startDate = null,
  endDate = null,
  workerPercent = 0,
) => {
  try {
    const percent = Number(workerPercent) || 0;

    // Get worker details
    const worker = await prisma.user.findUnique({
      where: { id: workerId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
      },
    });

    if (!worker) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Worker not found');
    }

    // Build date filter with proper end date handling
    const dateFilter = {};
    if (startDate && endDate) {
      // Create start date at beginning of day
      const startDateTime = new Date(startDate);
      startDateTime.setHours(0, 0, 0, 0);

      // Create end date at end of day (23:59:59.999)
      const endDateTime = new Date(endDate);
      endDateTime.setHours(23, 59, 59, 999);

      dateFilter.createdAt = {
        gte: startDateTime,
        lte: endDateTime,
      };

     
    }

    // Rest of your code remains the same...
    const whereCondition = {
      [workerType === 'THICK' ? 'thickWorkerId' : 'thinWorkerId']: workerId,
      ...dateFilter,
    };

    const measurements = await prisma.curtainMeasurement.findMany({
      where: whereCondition,
      include: {
        order: {
          include: {
            customer: true,
            Shop: true,
          },
        },
        curtainWorkerLogs: {
          where: {
            workerId,
            workerType,
            status: 'APPROVED',
          },
          include: {
            worker: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Calculate totals using the same commission formula
    let totalEarned = 0;
    let totalPaid = 0;
    let totalUnpaid = 0;

    const measurementDetails = measurements.map((measurement) => {
      // Calculate commission using the formula from unpaid commissions report
      const totalLabor = measurement.totalWorkerMeter || 0;
      const workerBase = totalLabor / 2;
      // CRITICAL FIX: Use the percent parameter, not measurement.percentage
      const earnedAmount = (workerBase * percent) / 100;

   
      const isPaid =
        workerType === 'THICK'
          ? measurement.thickWorkerPaid
          : measurement.thinWorkerPaid;
      const paidAmount =
        workerType === 'THICK'
          ? measurement.thickWorkerPaidAmount
          : measurement.thinWorkerPaidAmount;
      const paidDate =
        workerType === 'THICK'
          ? measurement.thickWorkerPaidDate
          : measurement.thinWorkerPaidDate;

      if (isPaid) {
        totalPaid += paidAmount || earnedAmount;
      } else {
        totalUnpaid += earnedAmount;
      }
      totalEarned += earnedAmount;

      return {
        measurementId: measurement.id,
        roomName: measurement.roomName,
        orderId: measurement.orderId,
        orderNumber: measurement.order.invoiceNo || measurement.order.id,
        customerName: measurement.order.customer?.name,
        shopName: measurement.order.Shop?.name,
        earnedAmount,
        workerBase,
        percentage: percent, // Use the percent parameter
        isPaid,
        paidAmount,
        paidDate,
        completedDate: measurement.updatedAt,
        totalWorkerMeter: measurement.totalWorkerMeter,
        measurementDetails: measurement.curtainWorkerLogs.map((log) => ({
          logId: log.id,
          assignedWidth: log.widthmeterAssigned,
          assignedHeight: log.heightmeterAssigned,
          assignedQuantity: log.quantityAssigned,
          completedWidth: log.widthmeterCompleted,
          completedHeight: log.heightmeterCompleted,
          completedQuantity: log.quantityCompleted,
          totalArea:
            log.widthmeterAssigned && log.heightmeterAssigned
              ? log.widthmeterAssigned * log.heightmeterAssigned
              : null,
          status: log.status,
          note: log.note,
          completedAt: log.createdAt,
        })),
        originalMeasurement: {
          width: measurement.width,
          height: measurement.height,
          quantity: measurement.quantity,
          curtainSize: measurement.curtainSize,
          totalArea: measurement.width * measurement.height,
        },
        logs: measurement.curtainWorkerLogs.map((log) => ({
          logId: log.id,
          assignedWidth: log.widthmeterAssigned,
          assignedHeight: log.heightmeterAssigned,
          assignedQuantity: log.quantityAssigned,
          completedAt: log.createdAt,
        })),
      };
    });

    return {
      worker: {
        id: worker.id,
        name: worker.name,
        email: worker.email,
        phone: worker.phone,
      },
      workerType,
      summary: {
        totalEarned,
        totalPaid,
        totalUnpaid,
        totalMeasurements: measurements.length,
        dateRange: startDate && endDate ? { startDate, endDate } : null,
        percentageUsed: percent, // Add percentage used
      },
      measurements: measurementDetails,
    };
  } catch (error) {
    console.error('Error generating worker detailed report:', error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to generate worker detailed report',
    );
  }
};

module.exports = {
  calculateWorkerCommission,
  getUnpaidWorkerCommissionsReport,
  markWorkerAsPaid,
  getWorkerDetailedReport,
};
