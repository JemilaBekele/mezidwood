/* eslint-disable no-nested-ternary */
/* eslint-disable no-restricted-syntax */
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');
const {
  computeStageQuantities,
  scheduleProject,
  dailyCapacityDate,
} = require('./scheduling/engine');
const { getCalendar } = require('./scheduling/calendar');
const { getSchedulingSettings } = require('./scheduling/settings');
const {
  CAPACITY_STAGES,
  SHIFT_TIMES,
  STAGE_SHIFT_PREFERENCE,
  VALID_DIFFICULTIES,
  WORKING_HOURS_PER_DAY,
  OVERCAPACITY_FACTOR,
} = require('./scheduling/config');
const reschedule = require('./scheduling/reschedule');

const round2 = (n) => Math.round(n * 100) / 100;
const dayWindow = (cal, date, workingHoursPerDay) => {
  const start = cal.createExactDateTime(date, SHIFT_TIMES.FULL_DAY.start);
  return {
    start,
    end: new Date(start.getTime() + workingHoursPerDay * 3600 * 1000),
  };
};

const normalizeWorkingStart = (cal, startInstant, workingHoursPerDay) => {
  let cur = new Date(startInstant);
  let guard = 0;
  while (guard < 10000) {
    guard += 1;
    if (!cal.isWorkingDay(cur)) {
      cur = dayWindow(cal, cal.nextWorkingDay(cur), workingHoursPerDay).start;
      continue;
    }
    const window = dayWindow(cal, cur, workingHoursPerDay);
    if (cur < window.start) return window.start;
    if (cur >= window.end) {
      cur = dayWindow(cal, cal.nextWorkingDay(cur), workingHoursPerDay).start;
      continue;
    }
    return cur;
  }
  throw new Error('Could not find a valid working start');
};

const splitWorkingMinutes = (
  cal,
  startInstant,
  minutes,
  workingHoursPerDay,
) => {
  const segments = [];
  let cur = normalizeWorkingStart(cal, startInstant, workingHoursPerDay);
  let remaining = Math.max(0, minutes);
  if (remaining === 0) return { start: cur, end: cur, segments };

  let guard = 0;
  while (remaining > 0 && guard < 10000) {
    guard += 1;
    if (!cal.isWorkingDay(cur)) {
      cur = dayWindow(cal, cal.nextWorkingDay(cur), workingHoursPerDay).start;
      continue;
    }
    const window = dayWindow(cal, cur, workingHoursPerDay);
    if (cur < window.start) cur = window.start;
    if (cur >= window.end) {
      cur = dayWindow(cal, cal.nextWorkingDay(cur), workingHoursPerDay).start;
      continue;
    }

    const available = Math.max(
      0,
      Math.floor((window.end.getTime() - cur.getTime()) / 60000),
    );
    const used = Math.min(remaining, available);
    const end = new Date(cur.getTime() + used * 60000);
    segments.push({ start: cur, end, minutes: used, dateKey: cal.dayKey(cur) });
    remaining -= used;
    cur = end;
  }

  if (remaining > 0)
    throw new Error('Could not allocate manual stage duration');
  return { start: segments[0]?.start || cur, end: cur, segments };
};

const allocateManualStageCapacity = async ({
  tx,
  cal,
  stageId,
  stageName,
  quantity,
  segments,
  workingHoursPerDay,
}) => {
  if (
    !CAPACITY_STAGES.includes(stageName) ||
    quantity <= 0 ||
    segments.length === 0
  ) {
    return;
  }

  const lot = await tx.capacityLot.findUnique({ where: { stage: stageName } });
  const capacity = lot?.capacity || 1;
  const slots = lot?.parallelSlots || 1;
  const maxCapacity = Math.max(1, Math.round(capacity * slots));
  const totalUnits = Math.max(0, Math.round(quantity));
  let remainingUnits = totalUnits;
  const totalMinutes = segments.reduce((sum, s) => sum + s.minutes, 0) || 1;

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const allocatedHours = round2(segment.minutes / 60);
    const allocatedUnits =
      i === segments.length - 1
        ? remainingUnits
        : Math.min(
            remainingUnits,
            Math.round(totalUnits * (segment.minutes / totalMinutes)),
          );
    remainingUnits -= allocatedUnits;

    const date = dailyCapacityDate(segment.dateKey);
    const existing = await tx.dailyStageCapacity.findUnique({
      where: { stage_date: { stage: stageName, date } },
    });
    const nextUsedCapacity = (existing?.usedCapacity || 0) + allocatedUnits;
    const nextUsedHours = (existing?.usedHours || 0) + allocatedHours;
    const daily = existing
      ? await tx.dailyStageCapacity.update({
          where: { id: existing.id },
          data: {
            usedCapacity: { increment: allocatedUnits },
            usedHours: { increment: allocatedHours },
            maxCapacity,
            workingHours: workingHoursPerDay,
            maxHours: workingHoursPerDay,
            shift: STAGE_SHIFT_PREFERENCE[stageName] || 'CUSTOM',
          },
        })
      : await tx.dailyStageCapacity.create({
          data: {
            stage: stageName,
            date,
            shift: STAGE_SHIFT_PREFERENCE[stageName] || 'CUSTOM',
            usedCapacity: allocatedUnits,
            maxCapacity,
            workingHours: workingHoursPerDay,
            usedHours: allocatedHours,
            maxHours: workingHoursPerDay,
          },
        });

    await tx.projectStageCapacityAllocation.create({
      data: {
        projectStageId: stageId,
        dailyStageCapacityId: daily.id,
        allocatedUnits,
        allocatedHours,
        shift: STAGE_SHIFT_PREFERENCE[stageName] || 'CUSTOM',
        startDateTime: segment.start,
        endDateTime: segment.end,
        customStartTime: segment.start,
        customEndTime: segment.end,
        allocationDate: date,
        isOverCapacity:
          nextUsedCapacity > maxCapacity || nextUsedHours > workingHoursPerDay,
      },
    });
  }
};

const createProject = async (projectData, userId) => {
  const {
    customerId,
    invoiceId,
    status = 'INVOICE',
    difficulty = 'EASY',
    requestedDelivery,
    manualStartDate,
  } = projectData;

  if (!invoiceId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invoice ID is required');
  }
  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Invalid difficulty: ${difficulty}`,
    );
  }

  // --- customer resolution (unchanged behaviour) ---
  const resolveCustomerId = async (cid) => {
    if (!cid) {
      const def = await prisma.customer.findFirst({
        where: { isdefault: true },
      });
      if (def) return def.id;
      return (
        await prisma.customer.create({
          data: { name: 'Default Customer', isdefault: true },
        })
      ).id;
    }
    return cid;
  };
  const validCustomerId = await resolveCustomerId(customerId);
  const customerRow = await prisma.customer.findUnique({
    where: { id: validCustomerId },
  });
  const isDefaultCustomer = customerRow?.isdefault || false;

  // --- invoice + materials ---
  const invoice = await prisma.proformaInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      project: true,
      items: {
        include: { proformaItemMaterials: { include: { material: true } } },
      },
    },
  });
  if (!invoice) throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found');
  if (invoice.project) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'Invoice already associated with another project',
    );
  }

  // Aggregate material quantities by type from the invoice items.
  const materials = {
    laminatedMDF: 0,
    plainMDF: 0,
    wood: 0,
    metal: 0,
    other: 0,
  };
  invoice.items.forEach((item) => {
    (item.proformaItemMaterials || []).forEach((pim) => {
      const qty = pim.quantity || 0;
      const m = pim.material;
      if (m?.laminatedMDF) materials.laminatedMDF += qty;
      else if (m?.plainMDF) materials.plainMDF += qty;
      else if (m?.wood) materials.wood += qty;
      else if (m?.metal) materials.metal += qty;
      else materials.other += qty;
    });
  });
  const totalQty =
    materials.laminatedMDF +
    materials.plainMDF +
    materials.wood +
    materials.metal +
    materials.other;

  // Material-driven stage quantities (single source: scheduling engine).
  const stageQuantities = computeStageQuantities(materials);
  if (isDefaultCustomer) {
    // Internal/default customer: no delivery or installation phase.
    stageQuantities.DELIVERY = 0;
    stageQuantities.INSTALLATION = 0;
  }

  // --- run the unified scheduler ---
  // Projects now pipeline by stage team: DESIGN for the next project may begin
  // as soon as DESIGN capacity is free, while the previous project continues
  // downstream. Honour a later manualStartDate; per-stage capacity usage decides
  // the actual start of each stage.
  const cal = await getCalendar();
  const baseStart = manualStartDate ? new Date(manualStartDate) : new Date();

  // Forward dry-run first to learn the offered (earliest) delivery date.
  const forwardPlan = await scheduleProject({
    stageQuantities,
    startDate: baseStart,
    difficulty,
    mode: 'dryRun',
  });

  // Back-scheduling: if the customer's requested delivery is LATER than what we
  // can offer, shift the whole project later so it finishes around the requested
  // date. Never earlier than baseStart; per-stage team capacity will still
  // move individual stages forward if that team is busy.
  let commitStart = baseStart;
  if (requestedDelivery && requestedDelivery !== '') {
    const requested = new Date(requestedDelivery);
    if (
      !Number.isNaN(requested.getTime()) &&
      requested.getTime() > forwardPlan.deliveryDate.getTime()
    ) {
      const backStart = cal.addWorkingDays(
        requested,
        -forwardPlan.estimatedDays,
      );
      if (backStart.getTime() > baseStart.getTime()) commitStart = backStart;
    }
  }

  // Commit (reserves daily capacity), create the project + stages, persist the
  // capacity allocations and write the audit row — ALL in one transaction so a
  // failure can never leave reserved capacity without a project (or vice versa).
  const project = await prisma.$transaction(
    async (tx) => {
      const plan = await scheduleProject({
        stageQuantities,
        startDate: commitStart,
        difficulty,
        mode: 'commit',
        tx,
      });

      // --- persist project + stages ---
      const created = await tx.project.create({
        data: {
          customerId: validCustomerId,
          invoiceId,
          status,
          difficulty,
          totalProjectQuantity: totalQty,
          requestedDelivery:
            requestedDelivery && requestedDelivery !== ''
              ? new Date(requestedDelivery)
              : null,
          calculatedDelivery: plan.deliveryDate,
          totalDays: plan.productionWorkingDays,
          createdById: userId,
          stages: {
            create: plan.stages.map((s) => ({
              stage: s.stage,
              workUnits: s.workUnits,
              timeTaken: s.timeTaken || 0,
              capacityDays: s.capacityDays,
              shift: s.shift || 'FULL_DAY',
              startDateTime: s.startDateTime,
              endDateTime: s.endDateTime,
              startDate: s.startDateTime,
              endDate: s.endDateTime,
              customStartTime: s.customStartTime,
              customEndTime: s.customEndTime,
              actualWorkUnits: 0,
              autoSchedule: true,
              status: 'ACTIVE',
            })),
          },
        },
        include: {
          customer: true,
          invoice: true,
          stages: true,
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });

      // --- persist capacity allocations, linked to the daily-capacity rows the
      //     engine created/updated during commit ---
      const stageIdByName = {};
      created.stages.forEach((st) => {
        stageIdByName[st.stage] = st.id;
      });

      for (const s of plan.stages) {
        if (!s.allocations || s.allocations.length === 0) continue;
        const projectStageId = stageIdByName[s.stage];
        if (!projectStageId) continue;
        for (const alloc of s.allocations) {
          const date = dailyCapacityDate(alloc.date);
          // eslint-disable-next-line no-await-in-loop
          const daily = await tx.dailyStageCapacity.findUnique({
            where: { stage_date: { stage: s.stage, date } },
          });
          if (!daily) continue;
          // eslint-disable-next-line no-await-in-loop
          await tx.projectStageCapacityAllocation.create({
            data: {
              projectStageId,
              dailyStageCapacityId: daily.id,
              allocatedUnits: Math.round(alloc.units),
              allocatedHours: alloc.hours,
              shift: alloc.shift || 'FULL_DAY',
              startDateTime: alloc.startDateTime,
              endDateTime: alloc.endDateTime,
              customStartTime: alloc.startDateTime,
              customEndTime: alloc.endDateTime,
              allocationDate: date,
              isOverCapacity: false,
            },
          });
        }
      }

      await reschedule.logScheduleEvent(tx, {
        projectId: created.id,
        event: 'CREATED',
        trigger: 'USER',
        newDelivery: plan.deliveryDate,
        byUserId: userId,
        reason: 'Project created',
      });

      return created;
    },
    { timeout: 30000, maxWait: 15000 },
  );

  return project;
};

// Optional debug function – add outside createProject if needed
// const getCapacitySummaryForDateRange = async (stage, startDate, endDate) => {
//   const results = [];
//   const currentDate = new Date(startDate);
//   const end = new Date(endDate);

//   while (currentDate <= end) {
//     if (isBusinessDay(currentDate)) {
//       for (const shift of ['MORNING', 'AFTERNOON', 'FULL_DAY']) {
//         const dailyCapacity = await prisma.dailyStageCapacity.findUnique({
//           where: {
//             stage_date_shift: {
//               stage,
//               date: currentDate,
//               shift,
//             },
//           },
//           include: {
//             projectStageCapacityAllocations: {
//               include: {
//                 projectStage: {
//                   include: {
//                     project: true,
//                   },
//                 },
//               },
//             },
//           },
//         });

//         if (dailyCapacity) {
//           const shiftHours = SHIFT_HOURS[shift];
//           const capacityInfo = capacityMap[stage];
//           const unitsPerHour = capacityInfo.capacity / shiftHours;
//           const maxUnitsInShift = shiftHours * unitsPerHour;

//           results.push({
//             date: currentDate.toLocaleDateString('en-CA'),
//             shift,
//             usedUnits: dailyCapacity.usedCapacity,
//             maxUnits: maxUnitsInShift,
//             utilization: ((dailyCapacity.usedCapacity / maxUnitsInShift) * 100).toFixed(1) + '%',
//             allocations: dailyCapacity.projectStageCapacityAllocations.map(a => ({
//               projectId: a.projectStage?.projectId,
//               units: a.allocatedUnits,
//               hours: a.allocatedHours,
//             })),
//           });
//         }
//       }
//     }
//     currentDate.setDate(currentDate.getDate() + 1);
//   }

//   return results;
// };

const updateProject = async (id, updateBody, userId) => {
  // Check if project exists
  const existingProject = await prisma.project.findUnique({
    where: { id },
    include: {
      customer: true,
      invoice: true,
      stages: true,
    },
  });

  if (!existingProject) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');
  }

  // Clean the updateBody to remove any undefined or null values
  const cleanedUpdateBody = {};
  for (const [key, value] of Object.entries(updateBody)) {
    if (value !== undefined && value !== null) {
      // Skip fields that shouldn't be updated directly
      if (['id', 'createdAt', 'updatedAt'].includes(key)) continue;

      // Handle special fields
      if (key === 'stages') continue; // Stages are updated separately

      cleanedUpdateBody[key] = typeof value === 'string' ? value.trim() : value;
    }
  }

  // Validate status if provided
  if (cleanedUpdateBody.status) {
    const validStatuses = [
      'PENDING',
      'IN_PROGRESS',
      'ON_HOLD',
      'COMPLETED',
      'CANCELLED',
      'DELIVERED',
    ];
    if (!validStatuses.includes(cleanedUpdateBody.status)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid project status');
    }
  }

  // Validate difficulty if provided
  if (cleanedUpdateBody.difficulty) {
    const validDifficulties = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'];
    if (!validDifficulties.includes(cleanedUpdateBody.difficulty)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid difficulty level');
    }
  }

  // Validate dates if provided
  if (
    cleanedUpdateBody.requestedDelivery &&
    isNaN(Date.parse(cleanedUpdateBody.requestedDelivery))
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Invalid requested delivery date',
    );
  }

  if (
    cleanedUpdateBody.calculatedDelivery &&
    isNaN(Date.parse(cleanedUpdateBody.calculatedDelivery))
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Invalid calculated delivery date',
    );
  }

  // Validate totalDays if provided
  if (cleanedUpdateBody.totalDays !== undefined) {
    if (
      cleanedUpdateBody.totalDays < 0 ||
      !Number.isInteger(cleanedUpdateBody.totalDays)
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Total days must be a non-negative integer',
      );
    }
  }

  // Check if customer exists if customerId is being updated
  if (cleanedUpdateBody.customerId) {
    const customerExists = await prisma.customer.findUnique({
      where: { id: cleanedUpdateBody.customerId },
    });

    if (!customerExists) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Customer not found');
    }
  }

  // Check if invoice exists and is available if invoiceId is being updated
  if (
    cleanedUpdateBody.invoiceId &&
    cleanedUpdateBody.invoiceId !== existingProject.invoiceId
  ) {
    const invoiceExists = await prisma.proformaInvoice.findUnique({
      where: { id: cleanedUpdateBody.invoiceId },
      include: { project: true },
    });

    if (!invoiceExists) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found');
    }

    if (invoiceExists.project && invoiceExists.project.id !== id) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Invoice is already associated with another project',
      );
    }
  }

  // Add updatedBy tracking
  cleanedUpdateBody.updatedById = userId;

  // Update project
  const updatedProject = await prisma.project.update({
    where: { id },
    data: cleanedUpdateBody,
    include: {
      customer: true,
      invoice: true,
      stages: {
        orderBy: {
          order: 'asc',
        },
      },
      createdBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      updatedBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
  });

  return updatedProject;
};

// Delete Project
const deleteProject = async (id) => {
  // Check if project exists
  const existingProject = await prisma.project.findUnique({
    where: { id },
  });

  if (!existingProject) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');
  }

  // Delete project with cascade (if cascade is enabled in schema)
  // If cascade is not enabled, we need to delete stages first
  try {
    // Single transaction to delete everything
    await prisma.$transaction(async (tx) => {
      // Return this project's reserved capacity to the daily pool FIRST, so the
      // DailyStageCapacity counters don't keep counting a project that no longer
      // exists (deleting the stages only cascades the allocation rows away — it
      // does not decrement the shared usedCapacity/usedHours totals).
      await reschedule.releaseProjectCapacity(id, tx);

      // Delete associated project stages (cascades remaining allocation rows)
      await tx.projectStage.deleteMany({
        where: { projectId: id },
      });

      // Delete the project itself (cascades ScheduleHistory + ProjectLog rows)
      await tx.project.delete({
        where: { id },
      });
    });

    return { message: 'Project deleted successfully' };
  } catch (error) {
    console.error('Error deleting project:', error);
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to delete project',
    );
  }
};

// Get all Projects with filtering, sorting, and pagination
const getAllProjects = async (filters = {}) => {
  const {
    page = 1,
    limit = 10,
    sortBy = 'createdAt',
    sortOrder = 'desc',
    search,
    status,
    difficulty,
    customerId,
    createdById,
    startDate,
    endDate,
  } = filters;

  const skip = (page - 1) * limit;
  const take = parseInt(limit, 10);

  // Build where clause
  const where = {};

  if (search) {
    where.OR = [
      {
        invoice: {
          piNumber: {
            // Changed from invoiceNumber to piNumber based on your model
            contains: search,
            mode: 'insensitive',
          },
        },
      },
      {
        customer: {
          name: {
            contains: search,
            mode: 'insensitive',
          },
        },
      },
    ];
  }

  if (status) {
    where.status = status;
  }

  if (difficulty) {
    where.difficulty = difficulty;
  }

  if (customerId) {
    where.customerId = customerId;
  }

  if (createdById) {
    where.createdById = createdById;
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      const start = new Date(startDate);
      where.createdAt.gte = start;
    }
    if (endDate) {
      const end = new Date(endDate);
      where.createdAt.lte = end;
    }
  }

  try {
    const projects = await prisma.project.findMany({
      where,
      skip,
      take,
      orderBy: {
        [sortBy]: sortOrder,
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        invoice: {
          select: {
            id: true,
            piNumber: true, // Changed from invoiceNumber to piNumber
            total: true, // Changed from totalAmount to total based on your model
            status: true, // Added status from PIStatus enum
          },
        },
        stages: {
          orderBy: {
            stage: 'asc',
          },
          include: {
            // Include work logs for each stage
            projectStageWorkLogs: {
              orderBy: {
                createdAt: 'desc', // Most recent first
              },
              include: {
                doneBy: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return {
      projects,
      count: projects.length,
      total: projects.length, // You might want to return the actual total count from the database
      page,
      limit,
      totalPages: Math.ceil((await prisma.project.count({ where })) / limit),
    };
  } catch (findError) {
    // Return empty result instead of throwing to prevent API from crashing
    return {
      projects: [],
      count: 0,
      total: 0,
      page,
      limit,
      totalPages: 0,
      error: findError.message,
    };
  }
};
const getAllProjectBystatus = async (filters = {}) => {
  const { status, sortBy = 'createdAt', sortOrder = 'desc' } = filters;

  // 🔥 ONLY STATUS FILTER
  const where = {};

  if (status) {
    where.status = status;
  }

  try {
    const projects = await prisma.project.findMany({
      where,
      orderBy: {
        [sortBy]: sortOrder,
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        invoice: {
          select: {
            id: true,
            piNumber: true,
            total: true,
            status: true,
          },
        },
        stages: {
          orderBy: {
            stage: 'asc',
          },
          select: {
            id: true,
            stage: true,
            capacityDays: true,
            startDate: true,
            endDate: true,
            autoSchedule: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    const total = await prisma.project.count({ where });

    return {
      projects,
      count: projects.length,
      total,
    };
  } catch (error) {
    return {
      projects: [],
      count: 0,
      total: 0,
      error: error.message,
    };
  }
};
// Helper function to calculate project progress based on stages
const getProjectById = async (id) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone1: true,
            address: true,
            companyName: true,
            phone2: true,
            tinNumber: true,
          },
        },
        invoice: {
          select: {
            id: true,
            piNumber: true,
            status: true,
            subtotal: true,
            vat: true,
            total: true,
            amountPaid: true,
            balance: true,
            amountDate: true,
            items: {
              include: {
                item: true, // Include item details (like name) if it's a relation to a product/item table
                images: true,
                proformaItemMaterials: {
                  include: {
                    material: true,
                  },
                },
              },
            },
            customer: {
              select: {
                id: true,
                name: true,
                phone1: true,
                companyName: true,
                address: true,
              },
            },
            attachments: true,
            preparedBy: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            approvedBy: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        stages: {
          orderBy: {
            stage: 'asc',
          },
          include: {
            // Include work logs for each stage
            projectStageWorkLogs: {
              orderBy: {
                createdAt: 'desc', // Most recent first
              },
              include: {
                doneBy: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        designBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        projectLogs: true,
      },
    });

    if (!project) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');
    }

    // Log specific nested data if needed
    if (project.invoice) {
      console.log('🧾 Invoice details:', {
        id: project.invoice.id,
        piNumber: project.invoice.piNumber,
        itemsCount: project.invoice.items?.length || 0,
        attachmentsCount: project.invoice.attachments?.length || 0,
      });
    }

    return project;
  } catch (error) {
    console.error('❌ Error in getProjectById:');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);

    // Log Prisma-specific errors
    if (error.code) {
      console.error('Prisma error code:', error.code);
    }
    if (error.meta) {
      console.error('Prisma error meta:', JSON.stringify(error.meta, null, 2));
    }

    // Re-throw the error if it's an ApiError, otherwise wrap it
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to fetch project',
      error.message,
    );
  }
};
// Get projects by customer ID
const getProjectsByCustomerId = async (customerId, filters = {}) => {
  const { page = 1, limit = 10, status } = filters;
  const skip = (page - 1) * limit;
  const take = parseInt(limit);

  // Build where clause
  const where = { customerId };

  if (status) {
    where.status = status;
  }

  // Get total count
  const total = await prisma.project.count({ where });

  // Get projects
  const projects = await prisma.project.findMany({
    where,
    skip,
    take,
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
        },
      },
      stages: {
        orderBy: {
          order: 'asc',
        },
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
    },
  });

  return {
    projects,
    pagination: {
      page: parseInt(page),
      limit: take,
      total,
      pages: Math.ceil(total / take),
    },
  };
};

// Update project status
const updateProjectStatus = async (id, status, userId) => {
  const validStatuses = [
    'INVOICE',
    'DESIGN',
    'PURCHASING',
    'CUTTING',
    'EDGE_BANDING',
    'PAINTING',
    'ASSEMBLY',
    'FINISHING',
    'DELIVERY',
    'INSTALLATION',
    'COMPLETED',
    'CANCELLED',
  ];

  // 1️⃣ Validate status
  if (!validStatuses.includes(status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Invalid project status: ${status}`,
    );
  }

  // 2️⃣ Fetch project
  let project;
  try {
    project = await prisma.project.findUnique({
      where: { id },
    });
  } catch (err) {
    console.error('❌ Prisma findUnique error:', err);
    throw err;
  }

  if (!project) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');
  }

  // 3️⃣ Validate status transition (optional - you can customize this logic)
  // This ensures logical workflow progression
  const statusFlow = [
    'INVOICE',
    'DESIGN',
    'PURCHASING',
    'CUTTING',
    'EDGE_BANDING',
    'PAINTING',
    'ASSEMBLY',
    'FINISHING',
    'DELIVERY',
    'INSTALLATION',
    'COMPLETED',
  ];

  const currentIndex = statusFlow.indexOf(project.status);
  const newIndex = statusFlow.indexOf(status);

  // Allow CANCELLED from any status
  if (status !== 'CANCELLED') {
    // If current status is in the flow, validate transition
    if (currentIndex !== -1 && newIndex !== -1) {
      // Allow moving forward in workflow, but restrict moving backward
      // (Remove or modify this restriction if you want more flexibility)
      if (newIndex < currentIndex) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Cannot move from ${project.status} to ${status}. Workflow must progress forward.`,
        );
      }
    }
  }

  // 4️⃣ Update project
  try {
    const updateData = {
      status,
      updatedById: userId,
    };

    // Optional: Add timestamps for specific status changes
    if (status === 'COMPLETED') {
      updateData.completedAt = new Date();
    } else if (status === 'CANCELLED') {
      updateData.cancelledAt = new Date();
    }

    const updatedProject = await prisma.project.update({
      where: { id },
      data: updateData,
      include: {
        customer: true,
        invoice: true,
        // Include other relations as needed
      },
    });

    // Optional: Trigger additional actions based on status change
    switch (status) {
      case 'COMPLETED':
        break;

      case 'CANCELLED':
        // Free ALL reserved capacity, cancel every stage, and audit it — one tx.
        // (Previously this was a no-op, so a cancelled project's reserved daily
        // capacity stayed counted forever.)
        await prisma.$transaction(
          async (tx) => {
            await reschedule.releaseProjectCapacity(id, tx);
            await tx.projectStage.updateMany({
              where: { projectId: id },
              data: { status: 'CANCELLED', autoSchedule: false },
            });
            await reschedule.logScheduleEvent(tx, {
              projectId: id,
              event: 'PROJECT_CANCELLED',
              trigger: 'CANCELLATION',
              byUserId: userId,
              oldDelivery: updatedProject.calculatedDelivery,
              reason: 'Project cancelled; all reserved capacity released',
            });
          },
          { timeout: 30000, maxWait: 15000 },
        );
        break;

      case 'DELIVERY':
        break;

      default:
        // No extra action needed for other statuses
        break;
    }

    return updatedProject;
  } catch (err) {
    console.error('❌ Prisma update error:', err);
    throw err;
  }
};

const updateProjectDesignStatus = async (id, designStatus, userId) => {
  // 1️⃣ Validate design status

  const validDesignStatuses = [
    'INITIATED',
    'MODELING',
    'DRAFTING',
    'CUTLIST',
    'BOQ',
    'FINISHED',
    'DESIGN_FINISHED',
  ];

  if (!validDesignStatuses.includes(designStatus)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Invalid design status: ${designStatus}. Valid statuses: ${validDesignStatuses.join(
        ', ',
      )}`,
    );
  }

  // 2️⃣ Fetch project with stages
  let project;
  try {
    project = await prisma.project.findUnique({
      where: { id },
      include: {
        stages: {
          include: {
            projectStageCapacityAllocations: {
              include: {
                dailyStageCapacity: true,
              },
            },
          },
        },
      },
    });
  } catch (err) {
    console.error('❌ Prisma findUnique error:', err);
    throw err;
  }

  if (!project) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');
  }

  // Store old status for logging
  const oldDesignStatus = project.designStatus;
  const oldProjectStatus = project.status;

  // 3️⃣ Prepare update data
  const updateData = {
    designStatus,
    designById: userId,
  };

  // 4️⃣ Handle FINISHED status logic
  const isNowFinished = designStatus === 'FINISHED';
  let designStageUpdate = null;
  let capacityFreedData = null;
  updateData.status = 'DESIGN';

  if (isNowFinished) {
    // Set designFinished timestamp
    updateData.designFinished = new Date();

    // Find the DESIGN stage for this project
    const designStage = project.stages.find(
      (stage) => stage.stage === 'DESIGN',
    );

    if (designStage) {
      // Get the current values
      const currentWorkUnits = designStage.workUnits || 0;
      const currentActualWorkUnits = designStage.actualWorkUnits || 0;

      // ALWAYS set actualWorkUnits to match workUnits when finishing
      // This ensures the actual work done equals the planned work
      const syncedActualWorkUnits = currentWorkUnits;
      const workUnitsChanged = currentWorkUnits !== currentActualWorkUnits;

      if (workUnitsChanged) {
        console.log(
          `✅ Syncing: Actual Work Units ${currentActualWorkUnits} → ${syncedActualWorkUnits} (matches Planned Work Units)`,
        );
      } else {
        console.log('✅ Actual work units already match planned work units');
      }

      // ===== STEP 2: GET ALL CAPACITY ALLOCATIONS FOR DESIGN STAGE =====
      const stageAllocations =
        designStage.projectStageCapacityAllocations || [];

      let totalFreedUnits = 0;
      let totalFreedHours = 0;
      const allocationDetails = [];

      // ===== STEP 3: SUBTRACT ALLOCATED CAPACITY FROM DAILY CAPACITIES =====
      for (const allocation of stageAllocations) {
        const dateStr = allocation.allocationDate.toISOString().split('T')[0];

        allocationDetails.push({
          date: dateStr,
          allocatedUnits: allocation.allocatedUnits,
          allocatedHours: allocation.allocatedHours,
          shift: allocation.shift,
        });

        totalFreedUnits += allocation.allocatedUnits;
        totalFreedHours += allocation.allocatedHours;
      }

      // Store capacity freed data for logging
      capacityFreedData = {
        totalFreedUnits,
        totalFreedHours,
        allocationsCount: stageAllocations.length,
        allocationDetails,
        workUnits: currentWorkUnits,
        actualWorkUnitsBefore: currentActualWorkUnits,
        actualWorkUnitsAfter: syncedActualWorkUnits,
        workUnitsChanged,
      };

      // Prepare design stage update with capacity operations
      const capacityUpdateOperations = [];

      // Create update operations for each daily capacity
      for (const allocation of stageAllocations) {
        capacityUpdateOperations.push(
          prisma.dailyStageCapacity.update({
            where: { id: allocation.dailyStageCapacityId },
            data: {
              usedCapacity: {
                decrement: allocation.allocatedUnits,
              },
              usedHours: {
                decrement: allocation.allocatedHours,
              },
            },
          }),
        );
      }

      // Create delete operation for allocations
      const deleteAllocationsOperation =
        prisma.projectStageCapacityAllocation.deleteMany({
          where: { projectStageId: designStage.id },
        });

      // Store operations to be executed in transaction
      designStageUpdate = {
        update: prisma.projectStage.update({
          where: { id: designStage.id },
          data: {
            finished: true,
            // CRITICAL: Always set actualWorkUnits to match workUnits
            workUnits: currentWorkUnits, // ← workUnits stays the same
            actualWorkUnits: syncedActualWorkUnits, // ← actualWorkUnits becomes workUnits
            endDate: new Date(),
            status: 'COMPLETED',
          },
        }),
        capacityUpdates: capacityUpdateOperations,
        deleteAllocations: deleteAllocationsOperation,
        workUnitsChanged,
        workUnits: currentWorkUnits,
        actualWorkUnitsBefore: currentActualWorkUnits,
        actualWorkUnitsAfter: syncedActualWorkUnits,
      };

      // Update project status to next stage after DESIGN
      updateData.status = 'PURCHASING';
    }
  }

  // 5️⃣ Prepare log messages
  const logs = [];

  // Log for design status change
  if (oldDesignStatus !== designStatus) {
    const designStatusMessage = oldDesignStatus
      ? `Design status changed from ${oldDesignStatus} to ${designStatus}`
      : `Design status set to ${designStatus}`;

    logs.push(
      prisma.projectLog.create({
        data: {
          projectId: id,
          note: designStatusMessage,
          createdById: userId,
        },
      }),
    );
  }

  // Log for project status change (if applicable)
  if (isNowFinished && oldProjectStatus !== 'PURCHASING') {
    logs.push(
      prisma.projectLog.create({
        data: {
          projectId: id,
          note: `Project status changed from ${
            oldProjectStatus || 'N/A'
          } to PURCHASING because design was finished`,
          createdById: userId,
        },
      }),
    );
  }

  // Log for design completion with capacity information
  if (isNowFinished && capacityFreedData) {
    const capacityLogMessage =
      `Design phase completed. ` +
      `Freed ${capacityFreedData.totalFreedUnits.toFixed(
        2,
      )} capacity units and ${capacityFreedData.totalFreedHours.toFixed(
        2,
      )} hours from ${capacityFreedData.allocationsCount} calendar day(s). ` +
      `Actual work units synced: ${capacityFreedData.actualWorkUnitsBefore} → ${capacityFreedData.actualWorkUnitsAfter} ` +
      `(matches planned: ${capacityFreedData.workUnits})`;

    logs.push(
      prisma.projectLog.create({
        data: {
          projectId: id,
          note: capacityLogMessage,
          createdById: userId,
        },
      }),
    );

    // Create detailed log entries for each allocation if not too many
    if (
      capacityFreedData.allocationsCount > 0 &&
      capacityFreedData.allocationsCount <= 10
    ) {
      for (const detail of capacityFreedData.allocationDetails) {
        logs.push(
          prisma.projectLog.create({
            data: {
              projectId: id,
              note: `  - Freed ${detail.allocatedUnits.toFixed(
                2,
              )} units (${detail.allocatedHours.toFixed(2)} hours) from ${
                detail.date
              } (${detail.shift} shift)`,
              createdById: userId,
            },
          }),
        );
      }
    }
  }

  // Log for design completion timestamp
  if (isNowFinished) {
    logs.push(
      prisma.projectLog.create({
        data: {
          projectId: id,
          note: `Design phase completed at ${new Date().toISOString()}`,
          createdById: userId,
        },
      }),
    );
  }

  // 6️⃣ Execute all updates in a transaction
  try {
    const operations = [
      // Update project
      prisma.project.update({
        where: { id },
        data: updateData,
        include: {
          customer: true,
          invoice: true,
          stages: true,
        },
      }),
      // Add all logs
      ...logs,
    ];

    // Add design stage update and capacity operations if they exist
    if (designStageUpdate) {
      // Add the stage update
      operations.push(designStageUpdate.update);

      // Add all daily capacity updates
      if (
        designStageUpdate.capacityUpdates &&
        designStageUpdate.capacityUpdates.length > 0
      ) {
        operations.push(...designStageUpdate.capacityUpdates);
      }

      // Add delete allocations operation
      if (designStageUpdate.deleteAllocations) {
        operations.push(designStageUpdate.deleteAllocations);
      }
    }

    // Execute transaction
    const results = await prisma.$transaction(operations);

    // The first result is the updated project
    const updatedProject = results[0];

    return updatedProject;
  } catch (err) {
    console.error('❌ Prisma transaction error:', err);
    throw err;
  }
};
// Calculate project delivery dates
const calculateProjectDelivery = async (id, totalDays, userId) => {
  if (!totalDays || totalDays <= 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Total days must be a positive number',
    );
  }

  const project = await prisma.project.findUnique({
    where: { id },
  });

  if (!project) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');
  }

  const calculatedDelivery = new Date();
  calculatedDelivery.setDate(calculatedDelivery.getDate() + totalDays);

  const updatedProject = await prisma.project.update({
    where: { id },
    data: {
      totalDays,
      calculatedDelivery,
      updatedById: userId,
    },
    include: {
      customer: true,
      invoice: true,
    },
  });

  return updatedProject;
};

const autoScheduleProjectStages = async (projectId, userId = null) => {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');

  // A LOCKED project (e.g. a customer-confirmed date) refuses automatic
  // re-planning until it is unlocked.
  if (project.scheduleMode === 'LOCKED') {
    throw new ApiError(
      httpStatus.CONFLICT,
      'Project schedule is LOCKED — unlock it before auto-scheduling.',
    );
  }

  // Re-run the unified engine (DAG + capacity-aware) for the whole project from
  // now, atomically, replacing the legacy in-file day-by-day scheduler.
  const result = await reschedule.rescheduleWholeProject(projectId, new Date());
  await reschedule.logScheduleEvent(prisma, {
    projectId,
    event: 'RESCHEDULED',
    trigger: 'USER',
    byUserId: userId,
    newDelivery: result ? result.deliveryDate : undefined,
    reason: 'Auto-scheduled (whole-project re-plan)',
  });

  return prisma.project.findUnique({
    where: { id: projectId },
    include: {
      stages: { orderBy: { startDate: 'asc' } },
      customer: true,
      invoice: true,
    },
  });
};

const manualScheduleProjectStage = async (
  projectId,
  manualDelivery,
  userId = null,
) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { stages: true },
  });
  if (!project) throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');

  const manual = new Date(manualDelivery);
  if (Number.isNaN(manual.getTime())) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid manual delivery date');
  }

  // Estimate the span via a dry-run, then back-schedule so the project ends on/
  // around the manual delivery date (start = manualDelivery - estimatedDays).
  const stageQuantities = {};
  project.stages
    .filter((s) => s.status !== 'CANCELLED')
    .forEach((s) => {
      stageQuantities[s.stage] = s.workUnits || 0;
    });
  const dry = await scheduleProject({
    stageQuantities,
    startDate: new Date(),
    difficulty: project.difficulty,
    mode: 'dryRun',
  });
  const cal = await getCalendar();
  const start = cal.addWorkingDays(manual, -dry.estimatedDays);

  await reschedule.rescheduleWholeProject(projectId, start);
  // A manual delivery is an explicit override — pin the date AND switch the
  // project to MANUAL mode so automatic jobs stop moving it.
  await prisma.project.update({
    where: { id: projectId },
    data: {
      manualDelivery: manual,
      finalDelivery: manual,
      scheduleMode: 'MANUAL',
    },
  });
  await reschedule.logScheduleEvent(prisma, {
    projectId,
    event: 'MANUAL_OVERRIDE',
    trigger: 'USER',
    byUserId: userId,
    oldDelivery: project.calculatedDelivery,
    newDelivery: manual,
    reason: 'Manual delivery date set (back-scheduled); mode set to MANUAL',
  });

  const finalProject = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      stages: { orderBy: { startDate: 'asc' } },
      customer: true,
      invoice: true,
    },
  });
  return {
    success: true,
    project: finalProject,
    message: 'All stages scheduled backward from the manual delivery date',
  };
};
// Helper function to schedule all stages backward from manual delivery date
const scheduleAllStagesBackwardFromManualDelivery = async (
  projectId,
  manualDeliveryDate,
  allStages,
) => {
  console.log(
    'Scheduling all stages backward from manual delivery:',
    manualDeliveryDate,
  );

  try {
    // Define stage order for proper sequencing
    const stageOrderMap = {
      INVOICE: 0,
      DESIGN: 1,
      PURCHASING: 2,
      METAL_WORKS: 3,
      CNC: 4,
      CUTTING: 5,
      EDGE_BANDING: 6,
      ASSEMBLY: 7,
      PAINTING: 8,
      FINISHING: 9,
      DELIVERY: 10,
      INSTALLATION: 11,
      COMPLETED: 12,
      CANCELLED: 13,
    };

    // Sort stages by order
    const sortedStages = [...allStages].sort((a, b) => {
      const orderA = stageOrderMap[a.stage] || 999;
      const orderB = stageOrderMap[b.stage] || 999;
      return orderA - orderB;
    });

    console.log(
      'Sorted stages:',
      sortedStages.map((s) => s.stage),
    );

    // Separate stages before delivery and delivery stage itself
    const deliveryStage = sortedStages.find((s) => s.stage === 'DELIVERY');
    const stagesBeforeDelivery = sortedStages.filter(
      (s) => stageOrderMap[s.stage] < stageOrderMap.DELIVERY,
    );

    console.log(`Found ${stagesBeforeDelivery.length} stages before DELIVERY`);

    if (!deliveryStage) {
      throw new Error('DELIVERY stage not found in sorted stages');
    }

    // Start scheduling backward from manual delivery date
    const currentDate = new Date(manualDeliveryDate);

    // 1. Schedule DELIVERY stage to end on manual delivery date
    const deliveryStartDate = new Date(currentDate);
    deliveryStartDate.setDate(
      deliveryStartDate.getDate() - deliveryStage.capacityDays + 1,
    );

    console.log(
      `Scheduling DELIVERY: ${deliveryStartDate.toISOString()} to ${currentDate.toISOString()}`,
    );

    // Check capacity for delivery stage
    await checkAndScheduleStage(
      deliveryStage.id,
      deliveryStartDate,
      currentDate,
      true,
    );

    // 2. Move to the day before DELIVERY starts.
    // NOTE: derive from deliveryStartDate itself (not currentDate) — using
    // deliveryStartDate.getDate() against currentDate broke across month
    // boundaries (e.g. delivery Mar 2, start Feb 28 -> wrongly became Mar 27).
    currentDate.setTime(deliveryStartDate.getTime());
    currentDate.setDate(currentDate.getDate() - 1);

    // 3. Schedule stages before DELIVERY in reverse order
    for (let i = stagesBeforeDelivery.length - 1; i >= 0; i--) {
      const stage = stagesBeforeDelivery[i];
      const stageDuration = stage.capacityDays;

      if (stageDuration <= 0) {
        console.warn(
          `Stage ${stage.stage} has zero or negative duration: ${stageDuration}`,
        );
        continue;
      }

      // Calculate end date (day before next stage starts)
      const stageEndDate = new Date(currentDate);
      const stageStartDate = new Date(stageEndDate);
      stageStartDate.setDate(stageStartDate.getDate() - stageDuration + 1);

      console.log(
        `Scheduling ${
          stage.stage
        }: ${stageStartDate.toISOString()} to ${stageEndDate.toISOString()}`,
      );

      // Check capacity and schedule
      await checkAndScheduleStage(stage.id, stageStartDate, stageEndDate, true);

      // Move to the day before this stage starts for next iteration.
      // Derive from stageStartDate itself to stay correct across month boundaries.
      currentDate.setTime(stageStartDate.getTime());
      currentDate.setDate(currentDate.getDate() - 1);
    }

    console.log('All stages scheduled backward from manual delivery date');

    // Update project start date (earliest stage start date)
    const earliestStage = await prisma.projectStage.findFirst({
      where: { projectId },
      orderBy: { startDate: 'asc' },
      select: { startDate: true },
    });

    if (earliestStage && earliestStage.startDate) {
      console.log(
        `Project start date: ${earliestStage.startDate.toISOString()}`,
      );
    }
  } catch (error) {
    console.error(
      'Error in scheduleAllStagesBackwardFromManualDelivery:',
      error,
    );
    throw error;
  }
};

// Helper function to check capacity and schedule a stage
const checkAndScheduleStage = async (
  stageId,
  startDate,
  endDate,
  isManualSchedule = false,
) => {
  try {
    // Get the stage details
    const stage = await prisma.projectStage.findUnique({
      where: { id: stageId },
      include: {
        project: {
          select: { id: true },
        },
      },
    });

    if (!stage) {
      throw new Error(`Stage ${stageId} not found`);
    }

    // Get capacity for this stage
    const capacityLot = await prisma.capacityLot.findUnique({
      where: { stage: stage.stage },
    });

    // Check for capacity conflicts
    if (capacityLot && capacityLot.capacity > 0) {
      const dailyCapacity = capacityLot.capacity;
      const currentDate = new Date(startDate);
      const end = new Date(endDate);
      const conflicts = [];

      while (currentDate <= end) {
        // Count existing projects scheduled on this day for this stage
        const existingWorkload = await prisma.projectStage.count({
          where: {
            stage: stage.stage,
            startDate: { lte: currentDate },
            endDate: { gte: currentDate },
            id: { not: stageId }, // Exclude current stage
          },
        });

        if (existingWorkload >= dailyCapacity) {
          conflicts.push({
            date: new Date(currentDate),
            currentWorkload: existingWorkload,
            capacity: dailyCapacity,
          });
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }

      if (conflicts.length > 0) {
        console.warn(`Capacity conflicts found for stage ${stage.stage}:`, {
          conflictsCount: conflicts.length,
          stageId,
          projectId: stage.projectId,
        });
        // Continue scheduling despite conflicts (as per original logic)
      }
    }

    // Update the stage with schedule
    await prisma.projectStage.update({
      where: { id: stageId },
      data: {
        startDate,
        endDate,
        autoSchedule: !isManualSchedule, // false if manual, true if auto
      },
    });
  } catch (error) {
    console.error(
      `Error in checkAndScheduleStage for stage ${stageId}:`,
      error,
    );
    throw error;
  }
};

const recalculateProjectTimeline = async (
  projectId,
  capacityMap,
  difficultyPercentages,
) => {
  console.log(
    `\n=== RECALCULATING PROJECT TIMELINE for project ${projectId} ===`,
  );

  // Get project with all data
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      invoice: {
        include: {
          items: {
            include: {
              proformaItemMaterials: {
                include: {
                  material: true,
                },
              },
            },
          },
        },
      },
      stages: true,
    },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  // Calculate material quantities
  let totalLaminatedMDFQuantity = 0;
  let totalPlainMDFQuantity = 0;
  let totalWoodQuantity = 0;
  let totalMetalQuantity = 0;

  project.invoice.items.forEach((item) => {
    item.proformaItemMaterials.forEach((pim) => {
      const { quantity } = pim;
      const { material } = pim;

      if (material?.laminatedMDF) {
        totalLaminatedMDFQuantity += quantity;
      } else if (material?.plainMDF) {
        totalPlainMDFQuantity += quantity;
      } else if (material?.wood) {
        totalWoodQuantity += quantity;
      } else if (material?.metal) {
        totalMetalQuantity += quantity;
      }
    });
  });

  const totalProjectQuantity =
    totalLaminatedMDFQuantity +
    totalPlainMDFQuantity +
    totalWoodQuantity +
    totalMetalQuantity;

  // Helper function to calculate stage days
  const calculateStageDays = (stage, quantity) => {
    const capacityInfo = capacityMap[stage];
    if (!capacityInfo) return 0;
    if (quantity === 0) return 0;

    const calculatedDays = Math.ceil(quantity / capacityInfo.capacity);
    return Math.max(calculatedDays, capacityInfo.days);
  };

  // Determine if metal exists (for path selection)
  const hasMetal = totalMetalQuantity > 0;

  // Calculate stage days based on materials and path
  const stageDays = {};

  // ALWAYS included
  stageDays.DESIGN = calculateStageDays(
    'DESIGN',
    Math.max(totalProjectQuantity, 1),
  );
  stageDays.ASSEMBLY = calculateStageDays(
    'ASSEMBLY',
    Math.max(totalProjectQuantity, 1),
  );
  stageDays.FINISHING = calculateStageDays(
    'FINISHING',
    Math.max(totalProjectQuantity, 1),
  );
  stageDays.DELIVERY = 1;

  if (hasMetal) {
    // METAL PATH
    stageDays.METAL_WORKS = calculateStageDays(
      'METAL_WORKS',
      totalMetalQuantity,
    );
    stageDays.CNC = calculateStageDays('CNC', totalMetalQuantity);
    stageDays.CUTTING = 0;
    stageDays.EDGE_BANDING = 0;

    const paintingQuantity =
      totalPlainMDFQuantity + totalWoodQuantity + totalMetalQuantity;
    stageDays.PAINTING =
      paintingQuantity > 0
        ? calculateStageDays('PAINTING', paintingQuantity)
        : 0;
  } else {
    // WOOD/MDF PATH
    stageDays.METAL_WORKS = 0;
    stageDays.CNC =
      totalWoodQuantity > 0 || totalPlainMDFQuantity > 0
        ? calculateStageDays('CNC', totalWoodQuantity + totalPlainMDFQuantity)
        : 0;
    stageDays.CUTTING = calculateStageDays(
      'CUTTING',
      Math.max(totalProjectQuantity, 1),
    );
    stageDays.EDGE_BANDING =
      totalLaminatedMDFQuantity > 0
        ? calculateStageDays('EDGE_BANDING', totalLaminatedMDFQuantity)
        : 0;

    const paintingQuantity = totalPlainMDFQuantity + totalWoodQuantity;
    stageDays.PAINTING =
      paintingQuantity > 0
        ? calculateStageDays('PAINTING', paintingQuantity)
        : 0;
  }

  // Calculate total days with difficulty and contingency
  const capacityTime = Object.values(stageDays).reduce(
    (sum, days) => sum + days,
    0,
  );
  const difficultyPercentage = difficultyPercentages[project.difficulty] || 0;
  const difficultyTime = capacityTime * difficultyPercentage;
  const totalBeforeContingency = capacityTime + difficultyTime;
  const contingency = totalBeforeContingency * 0.3;
  const totalProjectDays = Math.ceil(
    capacityTime + difficultyTime + contingency,
  );

  // Get project start date from first stage
  const sortedStages = project.stages.sort((a, b) => a.startDate - b.startDate);
  const projectStartDate = sortedStages[0]?.startDate || new Date();

  // Calculate new delivery date
  const calculatedDelivery = addBusinessDays(
    projectStartDate,
    totalProjectDays,
  );

  // Update project with new totals
  const updatedProject = await prisma.project.update({
    where: { id: projectId },
    data: {
      totalProjectQuantity,
      calculatedDelivery,
      totalDays: totalProjectDays,
    },
    include: {
      customer: true,
      invoice: {
        include: {
          items: {
            include: {
              proformaItemMaterials: {
                include: {
                  material: true,
                },
              },
            },
          },
        },
      },
      stages: {
        orderBy: {
          startDate: 'asc',
        },
      },
    },
  });

  return updatedProject;
};
// Helper function - Define at the top level
const isBusinessDay = (date) => {
  const day = date.getDay();
  return day !== 0 && day !== 6; // Sunday = 0, Saturday = 6
};

const getDateKey = (date) => {
  return date.toISOString().split('T')[0];
};

const addBusinessDays = (startDate, daysToAdd) => {
  const result = new Date(startDate);
  let addedDays = 0;

  while (addedDays < daysToAdd) {
    result.setDate(result.getDate() + 1);
    if (isBusinessDay(result)) {
      addedDays++;
    }
  }
  return result;
};

// NEW SERVICE: Check capacity availability
const checkStageCapacityAvailability = async (
  stage,
  requiredQuantity,
  startDate,
  endDate,
) => {
  const capacityInfo = await prisma.capacityLot.findUnique({
    where: { stage },
  });

  if (!capacityInfo) {
    return {
      available: true,
      warnings: [],
      overCapacityNeeded: false,
      suggestedDates: [],
    };
  }

  const dailyCapacity = capacityInfo.capacity || 1;
  const workingHoursPerDay = 7.5;
  const requiredHours = (requiredQuantity / dailyCapacity) * workingHoursPerDay;
  const requiredDays = Math.ceil(requiredHours / workingHoursPerDay);

  // Check each day in range
  const warnings = [];
  let totalOverCapacityNeeded = 0;
  const currentDate = new Date(startDate);
  currentDate.setHours(0, 0, 0, 0);
  const endDateTime = new Date(endDate);
  endDateTime.setHours(0, 0, 0, 0);

  const dailyRecords = await prisma.dailyStageCapacity.findMany({
    where: {
      stage,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
  });

  const recordMap = new Map();
  dailyRecords.forEach((record) => {
    recordMap.set(record.date.toISOString().split('T')[0], record);
  });

  let dayCount = 0;
  while (currentDate <= endDateTime && dayCount < 365) {
    // Use the globally defined isBusinessDay function
    if (isBusinessDay(currentDate)) {
      const dateKey = currentDate.toISOString().split('T')[0];
      const existingRecord = recordMap.get(dateKey);
      const usedCapacity = existingRecord?.usedCapacity || 0;
      const overCapacityUsed = existingRecord?.overCapacityUsed || 0;
      const totalUsed = usedCapacity + overCapacityUsed;
      const availableCapacity = dailyCapacity - totalUsed;
      const usedHours = existingRecord?.usedHours || 0;
      const overHoursUsed = existingRecord?.overHoursCapacityUsed || 0;
      const totalHoursUsed = usedHours + overHoursUsed;
      const availableHours = workingHoursPerDay - totalHoursUsed;

      if (availableCapacity < 0) {
        warnings.push({
          date: new Date(currentDate),
          message: `⚠️ ${
            currentDate.toISOString().split('T')[0]
          }: Already OVER capacity by ${Math.abs(
            availableCapacity,
          )} units (${Math.abs(availableHours).toFixed(1)} hours over)`,
          severity: 'error',
          availableCapacity,
          availableHours,
          overCapacityNeeded: Math.abs(availableCapacity),
        });
        totalOverCapacityNeeded += Math.abs(availableCapacity);
      } else if (availableCapacity < requiredQuantity / requiredDays) {
        warnings.push({
          date: new Date(currentDate),
          message: `⚠️ ${
            currentDate.toISOString().split('T')[0]
          }: Limited capacity available (${availableCapacity} units, ${availableHours.toFixed(
            1,
          )} hours)`,
          severity: 'warning',
          availableCapacity,
          availableHours,
          recommendedQuantity: availableCapacity,
        });
      }
    }
    currentDate.setDate(currentDate.getDate() + 1);
    dayCount++;
  }

  const canAccommodate =
    warnings.filter((w) => w.severity === 'error').length === 0;

  return {
    available: canAccommodate,
    warnings,
    overCapacityNeeded: totalOverCapacityNeeded > 0,
    totalOverCapacityNeeded,
    requiredDays,
    dailyCapacity,
    workingHoursPerDay,
    requiredHours,
    analysis: {
      totalDays: requiredDays,
      dailyLoad: requiredQuantity / requiredDays,
      hoursPerDay: requiredHours / requiredDays,
    },
  };
};

// Helper: Get capacity status for a specific date
const getDateCapacityStatus = async (stage, date) => {
  const normalizedDate = new Date(date);
  normalizedDate.setHours(0, 0, 0, 0);

  const capacityLot = await prisma.capacityLot.findUnique({
    where: { stage },
  });

  if (!capacityLot) {
    return null;
  }

  const dailyRecord = await prisma.dailyStageCapacity.findUnique({
    where: {
      stage_date: {
        stage,
        date: normalizedDate,
      },
    },
  });

  const maxCapacity = capacityLot.capacity || 1;
  const maxHours = 7.5;
  const usedCapacity = dailyRecord?.usedCapacity || 0;
  const overCapacityUsed = dailyRecord?.overCapacityUsed || 0;
  const usedHours = dailyRecord?.usedHours || 0;
  const overHoursUsed = dailyRecord?.overHoursCapacityUsed || 0;

  return {
    date: normalizedDate,
    stage,
    maxCapacity,
    usedCapacity,
    overCapacityUsed,
    totalUsedCapacity: usedCapacity + overCapacityUsed,
    availableCapacity: maxCapacity - (usedCapacity + overCapacityUsed),
    maxHours,
    usedHours,
    overHoursUsed,
    totalUsedHours: usedHours + overHoursUsed,
    availableHours: maxHours - (usedHours + overHoursUsed),
    isOverCapacity: usedCapacity + overCapacityUsed > maxCapacity,
    overCapacityAmount: usedCapacity + overCapacityUsed - maxCapacity,
  };
};

// Helper: Add to over-capacity (for urgent tasks)
const addOverCapacityAllocation = async (
  stage,
  date,
  requiredUnits,
  requiredHours,
) => {
  const normalizedDate = new Date(date);
  normalizedDate.setHours(0, 0, 0, 0);

  const capacityLot = await prisma.capacityLot.findUnique({
    where: { stage },
  });

  if (!capacityLot) {
    throw new Error(`Capacity lot not found for stage: ${stage}`);
  }

  const maxCapacity = capacityLot.capacity || 1;
  const maxHours = 7.5;

  const result = await prisma.$transaction(async (tx) => {
    const existingRecord = await tx.dailyStageCapacity.findUnique({
      where: {
        stage_date: {
          stage,
          date: normalizedDate,
        },
      },
    });

    const currentOverCapacity = existingRecord?.overCapacityUsed || 0;
    const currentOverHours = existingRecord?.overHoursCapacityUsed || 0;
    const newOverCapacity = currentOverCapacity + requiredUnits;
    const newOverHours = currentOverHours + requiredHours;

    const overCapacityPercentage = (newOverCapacity / maxCapacity) * 100;
    if (overCapacityPercentage > 150) {
      console.warn(
        `⚠️ WARNING: Over-capacity for ${stage} on ${
          normalizedDate.toISOString().split('T')[0]
        } is ${overCapacityPercentage.toFixed(
          1,
        )}% (${newOverCapacity}/${maxCapacity} units)`,
      );
    }

    const updatedRecord = await tx.dailyStageCapacity.upsert({
      where: {
        stage_date: {
          stage,
          date: normalizedDate,
        },
      },
      update: {
        overCapacityUsed: newOverCapacity,
        overHoursCapacityUsed: newOverHours,
      },
      create: {
        stage,
        date: normalizedDate,
        usedCapacity: 0,
        overCapacityUsed: requiredUnits,
        maxCapacity,
        workingHours: maxHours,
        usedHours: 0,
        overHoursCapacityUsed: requiredHours,
        maxHours,
      },
    });

    return updatedRecord;
  });

  return result;
};

// NEW SERVICE: Get capacity analysis for date range
const getCapacityAnalysisForDateRange = async (
  stage,
  startDate,
  endDate,
  requiredQuantity,
) => {
  try {
    const analysis = await checkStageCapacityAvailability(
      stage,
      requiredQuantity,
      startDate,
      endDate,
    );

    // Get detailed daily breakdown
    const dailyBreakdown = [];
    const currentDate = new Date(startDate);
    currentDate.setHours(0, 0, 0, 0);
    const endDateTime = new Date(endDate);
    endDateTime.setHours(0, 0, 0, 0);

    while (currentDate <= endDateTime) {
      if (isBusinessDay(currentDate)) {
        const status = await getDateCapacityStatus(stage, currentDate);
        if (status) {
          dailyBreakdown.push(status);
        }
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return {
      ...analysis,
      dailyBreakdown,
      recommendation: analysis.available
        ? '✅ Capacity is available for this date range'
        : '⚠️ Capacity constraints detected. Consider using over-capacity allocation or adjusting dates.',
      requiresOverCapacity: !analysis.available,
      overCapacityWarning: !analysis.available
        ? `⚠️ This schedule would require ${analysis.totalOverCapacityNeeded} units of over-capacity allocation across ${analysis.warnings.length} day(s)`
        : null,
    };
  } catch (error) {
    console.error('Capacity analysis error:', error);
    throw error; // Throw error to be caught by the controller
  }
};

// Update the updateProjectStage function to remove duplicate helper functions
const updateProjectTotalQuantity = async (projectId) => {
  console.log('\n=== START updateProjectTotalQuantity ===');
  console.log('projectId:', projectId);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      invoice: {
        include: {
          items: {
            include: {
              proformaItemMaterials: {
                include: {
                  material: true,
                },
              },
            },
          },
        },
      },
    },
  });

  console.log('Project found:', project ? 'Yes' : 'No');
  if (!project) {
    console.log('❌ Project not found, exiting');
    return;
  }

  console.log(`Project ID: ${project.id}`);
  console.log(`Invoice exists: ${project.invoice ? 'Yes' : 'No'}`);
  console.log(
    `Number of invoice items: ${project.invoice?.items?.length || 0}`,
  );

  let totalLaminatedMDFQuantity = 0;
  let totalPlainMDFQuantity = 0;
  let totalWoodQuantity = 0;
  let totalMetalQuantity = 0;
  let totalOtherQuantity = 0;
  let totalItemsProcessed = 0;
  let totalMaterialsProcessed = 0;

  if (project.invoice && project.invoice.items) {
    project.invoice.items.forEach((item, itemIndex) => {
      console.log(`\n📦 Processing Item ${itemIndex + 1}:`, item.id);
      console.log(
        `   Materials count: ${item.proformaItemMaterials?.length || 0}`,
      );

      if (item.proformaItemMaterials) {
        item.proformaItemMaterials.forEach((pim, pimIndex) => {
          totalMaterialsProcessed++;
          const { quantity } = pim;
          const { material } = pim;

          console.log(`   📄 Material ${pimIndex + 1}:`);
          console.log(`      Quantity: ${quantity}`);
          console.log(`      Material type:`, {
            laminatedMDF: material?.laminatedMDF || false,
            plainMDF: material?.plainMDF || false,
            wood: material?.wood || false,
            metal: material?.metal || false,
          });

          if (material?.laminatedMDF) {
            totalLaminatedMDFQuantity += quantity;
            console.log(
              `      ➕ Added to Laminated MDF: +${quantity} (Total: ${totalLaminatedMDFQuantity})`,
            );
          } else if (material?.plainMDF) {
            totalPlainMDFQuantity += quantity;
            console.log(
              `      ➕ Added to Plain MDF: +${quantity} (Total: ${totalPlainMDFQuantity})`,
            );
          } else if (material?.wood) {
            totalWoodQuantity += quantity;
            console.log(
              `      ➕ Added to Wood: +${quantity} (Total: ${totalWoodQuantity})`,
            );
          } else if (material?.metal) {
            totalMetalQuantity += quantity;
            console.log(
              `      ➕ Added to Metal: +${quantity} (Total: ${totalMetalQuantity})`,
            );
          } else {
            totalOtherQuantity += quantity;
            console.log(
              `      ➕ Added to Other: +${quantity} (Total: ${totalOtherQuantity})`,
            );
          }
          totalItemsProcessed++;
        });
      }
    });
  }

  const totalProjectQuantity =
    totalLaminatedMDFQuantity +
    totalPlainMDFQuantity +
    totalWoodQuantity +
    totalMetalQuantity +
    totalOtherQuantity;

  console.log('\n📊 QUANTITY SUMMARY:');
  console.log(`   Laminated MDF: ${totalLaminatedMDFQuantity}`);
  console.log(`   Plain MDF: ${totalPlainMDFQuantity}`);
  console.log(`   Wood: ${totalWoodQuantity}`);
  console.log(`   Metal: ${totalMetalQuantity}`);
  console.log(`   Other: ${totalOtherQuantity}`);
  console.log(`   ─────────────────────`);
  console.log(`   TOTAL PROJECT QUANTITY: ${totalProjectQuantity}`);
  console.log(`\n📈 Processing Stats:`);
  console.log(`   Total items processed: ${totalItemsProcessed}`);
  console.log(`   Total materials processed: ${totalMaterialsProcessed}`);

  const updatedProject = await prisma.project.update({
    where: { id: projectId },
    data: { totalProjectQuantity },
  });

  console.log(`\n✅ Database updated successfully`);
  console.log(`   Project ID: ${updatedProject.id}`);
  console.log(
    `   New totalProjectQuantity: ${updatedProject.totalProjectQuantity}`,
  );
  console.log('=== END updateProjectTotalQuantity ===\n');

  return updatedProject;
};

const updateProjectStage = async (
  projectId,
  stageName,
  newQuantity,
  userId,
  allowOverCapacity = false,
  customDates = null,
  manualOverride = false,
  isNewStage = false,
  timeTakenMinutes = null,
  createManualWorkLog = false,
) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { stages: true },
  });
  if (!project) throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');

  const existingStage = project.stages.find((s) => s.stage === stageName);
  if (!existingStage && !isNewStage) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      `Stage ${stageName} not found on this project`,
    );
  }
  const cal = await getCalendar();
  const settings = await getSchedulingSettings();
  const workingHoursPerDay =
    settings.workingHoursPerDay || WORKING_HOURS_PER_DAY;
  const hasManualDuration =
    timeTakenMinutes !== null && timeTakenMinutes !== undefined;

  // An explicit user edit (Gantt drag / quantity change / manual CNC add) is
  // allowed in ANY scheduleMode — the lock only stops AUTOMATIC movement. The
  // whole edit (stage write + capacity re-allocation + downstream cascade +
  // delivery recompute + audit) runs in ONE transaction.
  await prisma.$transaction(
    async (tx) => {
      let stage = existingStage;

      // Create the stage if it does not exist yet (e.g. manual CNC add).
      if (!stage) {
        let startDt;
        if (manualOverride && customDates && customDates.startDate) {
          startDt = new Date(customDates.startDate);
        } else {
          startDt = reschedule.getStagePhaseStart(
            project.stages,
            stageName,
            new Date(),
          );
        }
        stage = await tx.projectStage.create({
          data: {
            projectId,
            stage: stageName,
            workUnits: newQuantity,
            capacityDays: 1,
            startDate: startDt,
            endDate: startDt,
            startDateTime: startDt,
            endDateTime: startDt,
            shift: 'FULL_DAY',
            autoSchedule: !manualOverride,
            status: 'ACTIVE',
          },
        });
      }

      // Release this stage's currently reserved capacity before re-allocating.
      await reschedule.releaseStageCapacity(stage.id, null, tx);

      // Where does this stage start? A manual drag pins the start; otherwise
      // keep its current position.
      const chosenStart =
        manualOverride && customDates && customDates.startDate
          ? new Date(customDates.startDate)
          : new Date(stage.startDateTime || stage.startDate || Date.now());
      const manualTimeline = hasManualDuration
        ? splitWorkingMinutes(
            cal,
            chosenStart,
            timeTakenMinutes,
            workingHoursPerDay,
          )
        : null;

      let updatedStage;
      if (newQuantity > 0) {
        const plan = manualTimeline
          ? null
          : await scheduleProject({
              stageQuantities: { [stageName]: newQuantity },
              startDate: chosenStart,
              preserveStartTime: true,
              difficulty: project.difficulty,
              mode: 'commit',
              tx,
            });
        const sp = plan ? plan.stages.find((s) => s.stage === stageName) : null;
        const startDateTime = manualTimeline
          ? manualTimeline.start
          : sp
          ? sp.startDateTime
          : chosenStart;
        const endDateTime = manualTimeline
          ? manualTimeline.end
          : manualOverride && customDates && customDates.endDate
          ? new Date(customDates.endDate)
          : sp
          ? sp.endDateTime
          : chosenStart;
        const capacityDays = manualTimeline
          ? cal.workingDaysBetween(startDateTime, endDateTime)
          : sp
          ? sp.capacityDays
          : 1;
        const timeTaken = manualTimeline
          ? timeTakenMinutes
          : sp
          ? sp.timeTaken
          : 0;
        updatedStage = await tx.projectStage.update({
          where: { id: stage.id },
          data: {
            workUnits: newQuantity,
            startDateTime,
            startDate: startDateTime,
            endDateTime,
            endDate: endDateTime,
            capacityDays,
            shift: sp
              ? sp.shift
              : STAGE_SHIFT_PREFERENCE[stageName] || 'CUSTOM',
            timeTaken,
            autoSchedule: !manualOverride,
            status: 'ACTIVE',
          },
        });
        if (manualTimeline) {
          await allocateManualStageCapacity({
            tx,
            cal,
            stageId: stage.id,
            stageName,
            quantity: newQuantity,
            segments: manualTimeline.segments,
            workingHoursPerDay,
          });
          if (createManualWorkLog) {
            await tx.projectStageWorkLog.create({
              data: {
                projectStageId: stage.id,
                doneUnits: 0,
                hours: round2(timeTakenMinutes / 60),
                doneById: userId || null,
                note: 'Manual timeline time adjustment',
              },
            });
          }
        } else if (sp) {
          await reschedule.persistStageAllocations(
            stage.id,
            stageName,
            sp.allocations,
            tx,
          );
        }
      } else {
        // Zero quantity: keep the row but clear its work.
        updatedStage = await tx.projectStage.update({
          where: { id: stage.id },
          data: { workUnits: 0, autoSchedule: !manualOverride },
        });
      }

      // Cascade to downstream stages and refresh the delivery date — all on the
      // one unified calendar/engine (replaces the old in-file capacity loops).
      // A user-initiated manual edit packs downstream up to 125% overcapacity,
      // exactly like the calendar drag; automatic flows stay at 100%.
      await reschedule.rescheduleDownstream(
        projectId,
        stageName,
        updatedStage.endDateTime || chosenStart,
        tx,
        manualOverride ? OVERCAPACITY_FACTOR : 1.0,
      );
      const recomputed = await reschedule.recomputeProjectDelivery(
        projectId,
        tx,
      );

      await reschedule.logScheduleEvent(tx, {
        projectId,
        event: manualOverride ? 'MANUAL_OVERRIDE' : 'RESCHEDULED',
        trigger: 'USER',
        stage: stageName,
        byUserId: userId,
        oldDelivery: recomputed
          ? recomputed.oldDelivery
          : project.calculatedDelivery,
        newDelivery: recomputed ? recomputed.newDelivery : undefined,
        reason: manualOverride
          ? `Stage ${stageName} manually adjusted; downstream rescheduled`
          : `Stage ${stageName} quantity/position changed; downstream rescheduled`,
      });
    },
    { timeout: 30000, maxWait: 15000 },
  );

  return prisma.project.findUnique({
    where: { id: projectId },
    include: {
      stages: { orderBy: { startDate: 'asc' } },
      customer: true,
      invoice: true,
    },
  });
};
const deleteProjectStage = async (
  projectId,
  stageName,
  userId,
  deleteDownstream = false, // If true, deletes all downstream stages too
) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      stages: {
        orderBy: { startDate: 'asc' },
      },
    },
  });

  if (!project) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');
  }

  const stageToDelete = project.stages.find((s) => s.stage === stageName);
  if (!stageToDelete) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      `Stage ${stageName} not found on this project`,
    );
  }

  // Get the index of the stage to delete
  const stageIndex = project.stages.findIndex((s) => s.id === stageToDelete.id);

  // Determine which stages will be affected
  let downstreamStages = [];
  if (deleteDownstream) {
    // Delete all stages after the target stage
    downstreamStages = project.stages.slice(stageIndex + 1);
  } else {
    // Only delete the specific stage, keep downstream stages
    // They will need to be rescheduled
    downstreamStages = [];
  }

  await prisma.$transaction(
    async (tx) => {
      // 1. Release all capacity allocations for the stage(s) being deleted

      // Release capacity for the target stage
      await reschedule.releaseStageCapacity(stageToDelete.id, null, tx);

      // Release capacity for downstream stages if they're being deleted too
      for (const downstreamStage of downstreamStages) {
        await reschedule.releaseStageCapacity(downstreamStage.id, null, tx);
      }

      // 2. Delete the stage(s) and their associated records

      // Delete the target stage (cascade will handle allocations and work logs)
      await tx.projectStage.delete({
        where: { id: stageToDelete.id },
      });

      // Delete downstream stages if requested
      if (deleteDownstream) {
        for (const downstreamStage of downstreamStages) {
          await tx.projectStage.delete({
            where: { id: downstreamStage.id },
          });
        }
      }

      // 3. Handle remaining downstream stages (if not deleting them)
      if (!deleteDownstream) {
        const remainingStages = project.stages.filter(
          (s) =>
            s.id !== stageToDelete.id &&
            !downstreamStages.some((ds) => ds.id === s.id),
        );

        // Find the stage before the deleted one (or use project start date)
        const previousStage =
          stageIndex > 0 ? project.stages[stageIndex - 1] : null;
        const startDate = previousStage
          ? new Date(previousStage.endDateTime || previousStage.endDate)
          : new Date(project.createdAt || Date.now());

        // Reschedule remaining downstream stages after the deletion
        if (remainingStages.length > 0) {
          // The first remaining downstream stage becomes the "next" stage
          const firstRemainingStage = remainingStages[0];

          // Reschedule from this stage onwards
          await reschedule.rescheduleDownstream(
            projectId,
            firstRemainingStage.stage,
            startDate,
            tx,
            1.0, // Normal capacity factor (not manual override)
          );
        }
      }

      // 4. Recompute project delivery date
      const recomputed = await reschedule.recomputeProjectDelivery(
        projectId,
        tx,
      );

      // 5. Log the deletion event
      await reschedule.logScheduleEvent(tx, {
        projectId,
        event: 'STAGE_DELETED',
        trigger: 'USER',
        stage: stageName,
        byUserId: userId,
        oldDelivery: recomputed?.oldDelivery || project.calculatedDelivery,
        newDelivery: recomputed?.newDelivery || undefined,
        reason: deleteDownstream
          ? `Stage ${stageName} and downstream stages deleted`
          : `Stage ${stageName} deleted; downstream stages rescheduled`,
        metadata: {
          deletedStageId: stageToDelete.id,
          deletedDownstreamCount: downstreamStages.length,
          downstreamDeleted: deleteDownstream,
        },
      });
    },
    { timeout: 30000, maxWait: 15000 },
  );

  // Return the updated project
  return prisma.project.findUnique({
    where: { id: projectId },
    include: {
      stages: { orderBy: { startDate: 'asc' } },
      customer: true,
      invoice: true,
    },
  });
};

const VALID_SCHEDULE_MODES = ['AUTO', 'MANUAL', 'LOCKED'];

/**
 * Set a project's schedule mode (AUTO / MANUAL / LOCKED) — the lock/unlock
 * control. LOCKED keeps automatic jobs (cron, completion-cascade, auto-schedule)
 * away from a confirmed date; AUTO restores normal automatic behaviour.
 */
const setProjectScheduleMode = async (projectId, mode, userId = null) => {
  if (!VALID_SCHEDULE_MODES.includes(mode)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Invalid schedule mode: ${mode}`,
    );
  }
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: { scheduleMode: mode },
  });
  await reschedule.logScheduleEvent(prisma, {
    projectId,
    event: 'MODE_CHANGED',
    trigger: 'USER',
    byUserId: userId,
    reason: `Schedule mode changed ${project.scheduleMode} -> ${mode}`,
  });
  return updated;
};

/**
 * Cancel a single stage: releases its reserved capacity, marks it CANCELLED,
 * and (AUTO only) reschedules the remaining downstream stages. Delegates to the
 * transactional reschedule lifecycle.
 */
const cancelProjectStage = async (projectId, stageName, userId = null) => {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');

  await reschedule.onStageCancelled(projectId, stageName, userId);

  return prisma.project.findUnique({
    where: { id: projectId },
    include: {
      stages: { orderBy: { startDate: 'asc' } },
      customer: true,
      invoice: true,
    },
  });
};

/** The schedule/delivery audit trail for a project, newest first. */
const getProjectScheduleHistory = async (projectId) => {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');
  return prisma.scheduleHistory.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    include: { byUser: { select: { id: true, name: true, email: true } } },
  });
};

module.exports = {
  updateProjectStage,
  checkStageCapacityAvailability,
  getDateCapacityStatus,
  addOverCapacityAllocation,
  getCapacityAnalysisForDateRange,
  createProject,
  updateProject,
  deleteProject,
  getAllProjects,
  getProjectById,
  getProjectsByCustomerId,
  updateProjectStatus,
  calculateProjectDelivery,
  autoScheduleProjectStages,
  manualScheduleProjectStage,
  getAllProjectBystatus,
  updateProjectDesignStatus,
  setProjectScheduleMode,
  cancelProjectStage,
  deleteProjectStage,
  getProjectScheduleHistory,
  __private: {
    splitWorkingMinutes,
  },
};
