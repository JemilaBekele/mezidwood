/* eslint-disable no-nested-ternary */
/* eslint-disable no-restricted-syntax */
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const prisma = require('./prisma');
const {
  computeStageQuantities,
  withTimeBasedStages,
  scheduleProject,
  dailyCapacityDate,
  effectiveDailyMax,
} = require('./scheduling/engine');
const { getCalendar } = require('./scheduling/calendar');
const {
  CAPACITY_STAGES,
  DEFAULT_STAGE_SHIFT,
  VALID_DIFFICULTIES,
  VALID_PROJECT_STATUSES,
  OVERCAPACITY_FACTOR,
} = require('./scheduling/config');
const reschedule = require('./scheduling/reschedule');

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Normalize an instant to the next moment the factory is open.
 *
 * This used to be a local re-implementation (dayWindow/normalizeWorkingStart)
 * that modelled a day as one contiguous `shiftStart + workingHours` block — it
 * did not know about the lunch break, so it closed the day at 16:00 and happily
 * placed work at 12:45. It now delegates to the calendar, which is the single
 * definition of working time shared by the engine, the estimator and here.
 */
const normalizeWorkingStart = (cal, startInstant) =>
  cal.nextWorkingStart(startInstant);

/**
 * Split `minutes` of WORKING time into per-day segments from `startInstant`,
 * skipping lunch, nights, weekends and holidays.
 */
const splitWorkingMinutes = (cal, startInstant, minutes) => {
  const segments = [];
  let cur = cal.nextWorkingStart(startInstant);
  let remaining = Math.max(0, minutes);
  if (remaining === 0) return { start: cur, end: cur, segments };

  let guard = 0;
  while (remaining > 0 && guard < 10000) {
    guard += 1;
    const available = Math.round(cal.remainingHoursInDay(cur) * 60);
    if (available <= 0) {
      cur = cal.nextWorkingStart(cal.endOfWorkingDay(cur));
      continue;
    }
    const used = Math.min(remaining, available);
    const end = cal.addWorkingHours(cur, used / 60);
    segments.push({ start: cur, end, minutes: used, dateKey: cal.dayKey(cur) });
    remaining -= used;
    cur = remaining > 0 ? cal.nextWorkingStart(end) : end;
  }

  if (remaining > 0) throw new Error('Could not allocate manual stage duration');
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
  // FN-5: one definition of the daily ceiling, shared with the engine, so the
  // stored maxCapacity can never disagree with what the allocator measured
  // against.
  const maxCapacity = effectiveDailyMax({
    capacity: lot?.capacity || 1,
    parallelSlots: lot?.parallelSlots || 1,
  });
  // FN-6: units are a Float column carrying 2-decimal precision; rounding them
  // to Int here was what made the sum of allocations drift away from the day's
  // usedCapacity counter and produced false >125% violations.
  const totalUnits = Math.max(0, round2(quantity));
  let remainingUnits = totalUnits;
  const totalMinutes = segments.reduce((sum, s) => sum + s.minutes, 0) || 1;

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const allocatedHours = round2(segment.minutes / 60);
    const allocatedUnits =
      i === segments.length - 1
        ? round2(remainingUnits)
        : Math.min(
            remainingUnits,
            round2(totalUnits * (segment.minutes / totalMinutes)),
          );
    remainingUnits = round2(remainingUnits - allocatedUnits);

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
            shift: DEFAULT_STAGE_SHIFT,
          },
        })
      : await tx.dailyStageCapacity.create({
          data: {
            stage: stageName,
            date,
            shift: DEFAULT_STAGE_SHIFT,
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
        shift: DEFAULT_STAGE_SHIFT,
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
    deliveryEstimationcode,
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
    materials.metal;

  // Material-driven stage quantities (single source: scheduling engine).
  const invoiceStageQuantities = computeStageQuantities(materials);
  let stageQuantities = invoiceStageQuantities;
  let effectiveDifficulty = difficulty;
  let sourceEstimation = null;
  const warnings = [];

  // If created from a Delivery Estimation, inherit the quantities and difficulty
  // the customer was actually QUOTED, so the project reproduces the quote.
  if (deliveryEstimationcode) {
    sourceEstimation = await prisma.deliveryEstimation.findUnique({
      where: { code: deliveryEstimationcode },
    });
    if (!sourceEstimation) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        `Delivery estimation ${deliveryEstimationcode} not found`,
      );
    }
    if (sourceEstimation.status === 'PROJECT_CREATED') {
      throw new ApiError(
        httpStatus.CONFLICT,
        'This delivery estimation has already been converted to a project',
      );
    }
    if (sourceEstimation.difficulty) {
      effectiveDifficulty = sourceEstimation.difficulty;
    }
    stageQuantities = withTimeBasedStages({
      DESIGN: sourceEstimation.DESIGN ?? invoiceStageQuantities.DESIGN,
      METAL_WORKS:
        sourceEstimation.METAL_WORKS ?? invoiceStageQuantities.METAL_WORKS,
      CNC: sourceEstimation.CNC ?? invoiceStageQuantities.CNC,
      CUTTING: sourceEstimation.CUTTING ?? invoiceStageQuantities.CUTTING,
      EDGE_BANDING:
        sourceEstimation.EDGE_BANDING ?? invoiceStageQuantities.EDGE_BANDING,
      ASSEMBLY: sourceEstimation.ASSEMBLY ?? invoiceStageQuantities.ASSEMBLY,
      PAINTING: sourceEstimation.PAINTING ?? invoiceStageQuantities.PAINTING,
      FINISHING: sourceEstimation.FINISHING ?? invoiceStageQuantities.FINISHING,
      DELIVERY: sourceEstimation.DELIVERY ?? invoiceStageQuantities.DELIVERY,
      PURCHASING: sourceEstimation.PURCHASING,
      INSTALLATION: sourceEstimation.INSTALLATION,
    });

    // Surface (rather than silently absorb) a divergence between what was
    // quoted and what the invoice actually contains. The quote wins — that is
    // the number the customer holds — but the operator is told.
    const diverged = Object.keys(stageQuantities).filter(
      (s) =>
        Math.abs(
          (stageQuantities[s] || 0) - (invoiceStageQuantities[s] || 0),
        ) > 0.001,
    );
    if (diverged.length) {
      warnings.push({
        code: 'ESTIMATE_INVOICE_MISMATCH',
        message:
          `The estimate and the invoice materials disagree on: ${diverged.join(', ')}. `
          + 'The project was scheduled from the QUOTED quantities so the promised '
          + 'delivery date still holds.',
        stages: diverged.map((s) => ({
          stage: s,
          quoted: stageQuantities[s] || 0,
          invoice: invoiceStageQuantities[s] || 0,
        })),
      });
    }
  }

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
  const requestedStart = manualStartDate ? new Date(manualStartDate) : new Date();
  if (Number.isNaN(requestedStart.getTime())) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid start date');
  }

  // WT-1 — the working-time guard. A project created at 21:00, on a Sunday, on
  // a holiday or during the lunch break used to be scheduled from 08:30 THAT
  // MORNING, i.e. in the past, silently reserving capacity for hours that could
  // not be worked. The calendar rolls the start forward to the next instant the
  // factory is actually open, and we tell the caller when it did.
  const baseStart = cal.nextWorkingStart(requestedStart);
  if (baseStart.getTime() !== requestedStart.getTime()) {
    warnings.push({
      code: 'OUT_OF_WORKING_HOURS',
      message:
        'The requested start falls outside working hours; the project was '
        + 'scheduled from the next working period.',
      requestedStart,
      scheduledStart: baseStart,
    });
  }

  // Forward dry-run first to learn the offered (earliest) delivery date.
  const forwardPlan = await scheduleProject({
    stageQuantities,
    startDate: baseStart,
    difficulty: effectiveDifficulty,
    mode: 'dryRun',
  });

  // Back-scheduling: if the customer's requested delivery is LATER than what we
  // can offer, shift the whole project later so it finishes around the requested
  // date. Never earlier than baseStart; per-stage team capacity will still
  // move individual stages forward if that team is busy.
  let commitStart = baseStart;
  if (requestedDelivery && requestedDelivery !== '') {
    const requested = new Date(requestedDelivery);
    if (Number.isNaN(requested.getTime())) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid requested delivery date');
    }
    if (requested.getTime() > forwardPlan.deliveryDate.getTime()) {
      // Walk back the BUFFER only. The production span is re-derived by the
      // scheduler from the new start; subtracting the whole promise length
      // (production + buffer) pushed the start too far and overshot the date.
      const backStart = cal.nextWorkingStart(
        cal.addWorkingDays(requested, -forwardPlan.estimatedDays),
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
        // AL-3: the difficulty INHERITED from the estimate, not the request
        // default. This variable was computed and then never used, so a HARD
        // estimate became an EASY project — a 50%-of-span difference.
        difficulty: effectiveDifficulty,
        mode: 'commit',
        tx,
      });

      // --- persist project + stages ---
      const created = await tx.project.create({
        data: {
          customerId: validCustomerId,
          invoiceId,
          deliveryEstimationcode: deliveryEstimationcode || null,
          status,
          difficulty: effectiveDifficulty,
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

      // --- update parent Proforma Invoice status ---
      await tx.proformaInvoice.update({
        where: { id: invoiceId },
        data: { status: 'APPROVED_CREATE_PROJECT' },
      });

      // --- update parent Delivery Estimation status if linked ---
      // FN-8: this runs INSIDE the creation transaction. The conversion helper
      // used to create the project and then patch the estimate in two separate
      // unguarded writes, so a failure between them left an estimate that could
      // be converted a second time.
      if (deliveryEstimationcode) {
        await tx.deliveryEstimation.updateMany({
          where: { code: deliveryEstimationcode },
          data: {
            status: 'PROJECT_CREATED',
            projectId: created.id,
            updatedById: userId,
          },
        });
      }

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
              // FN-6: units are Float and carry 2-decimal precision. Rounding
              // to Int here made the sum of the allocation rows drift away from
              // the day's usedCapacity counter, producing phantom >125% days.
              allocatedUnits: round2(alloc.units),
              allocatedHours: alloc.hours,
              shift: alloc.shift || DEFAULT_STAGE_SHIFT,
              startDateTime: alloc.startDateTime,
              endDateTime: alloc.endDateTime,
              customStartTime: alloc.startDateTime,
              customEndTime: alloc.endDateTime,
              allocationDate: date,
              isOverCapacity:
                (daily.usedCapacity || 0) > (daily.maxCapacity || 0) + 0.001,
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

  // Warnings are advisory, not failures: the project was created. The UI shows
  // them so an out-of-hours creation or an estimate/invoice mismatch is visible
  // rather than silently absorbed.
  return warnings.length ? { ...project, warnings } : project;
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

  // Explicit allowlist. The previous version skipped only id/createdAt/updatedAt
  // and wrote everything else straight through, so a client could overwrite
  // scheduler-owned columns (calculatedDelivery, scheduleMode, finalDelivery)
  // and ownership columns (createdById) by naming them in the body.
  const UPDATABLE_FIELDS = [
    'status',
    'difficulty',
    'requestedDelivery',
    'manualDelivery',
    'designStatus',
    'customerId',
    'invoiceId',
    'totalDays',
    'totalProjectQuantity',
    'remark',
  ];

  const cleanedUpdateBody = {};
  for (const [key, value] of Object.entries(updateBody)) {
    if (value === undefined || value === null) continue;
    if (!UPDATABLE_FIELDS.includes(key)) continue;
    cleanedUpdateBody[key] = typeof value === 'string' ? value.trim() : value;
  }

  // Validate status against the Prisma enum. The hand-rolled list here allowed
  // PENDING/IN_PROGRESS/ON_HOLD/DELIVERED — none of which exist in
  // ProjectStatus — while rejecting every real stage value (DESIGN, CUTTING,
  // INSTALLATION, …), so a legitimate status change was always a 400.
  if (cleanedUpdateBody.status) {
    if (!VALID_PROJECT_STATUSES.includes(cleanedUpdateBody.status)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Invalid project status. Must be one of: ${VALID_PROJECT_STATUSES.join(', ')}`,
      );
    }
  }

  // Validate difficulty against the enum — the old list included EXPERT, which
  // DifficultyLevel does not define, so it would have failed at the DB layer.
  if (cleanedUpdateBody.difficulty) {
    if (!VALID_DIFFICULTIES.includes(cleanedUpdateBody.difficulty)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Invalid difficulty level. Must be one of: ${VALID_DIFFICULTIES.join(', ')}`,
      );
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

  // calculatedDelivery is owned by the scheduler and is no longer accepted from
  // the client, so there is nothing to validate for it here.

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

  // Update project. The include used to reference `stages.order` and
  // `User.firstName/lastName` — none of which exist on those models — so this
  // endpoint threw a Prisma validation error on every single call.
  const updatedProject = await prisma.project.update({
    where: { id },
    data: cleanedUpdateBody,
    include: {
      customer: true,
      invoice: true,
      stages: {
        orderBy: {
          startDate: 'asc',
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

  // The delivery promise is derived from difficulty and the requested date, so a
  // change to either must re-run the buffer rather than leave a stale date on
  // the record.
  if (
    cleanedUpdateBody.difficulty !== undefined ||
    cleanedUpdateBody.requestedDelivery !== undefined
  ) {
    await reschedule.recomputeProjectDelivery(id);
    return prisma.project.findUnique({
      where: { id },
      include: {
        customer: true,
        invoice: true,
        stages: { orderBy: { startDate: 'asc' } },
      },
    });
  }

  return updatedProject;
};

// Delete Project
const deleteProject = async (id) => {
  // Check if project exists with all related data
  const existingProject = await prisma.project.findUnique({
    where: { id },
    include: {
      invoice: true,
      stages: {
        include: {
          projectStageWorkLogs: true,
          projectStageCapacityAllocations: true,
        }
      },
    },
  });

  if (!existingProject) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');
  }

  try {
    // Single transaction to delete everything
    await prisma.$transaction(async (tx) => {
      // Return this project's reserved capacity to the daily pool FIRST
      await reschedule.releaseProjectCapacity(id, tx);

      // Get all stage IDs for this project
      const stageIds = existingProject.stages.map(stage => stage.id);

      if (stageIds.length > 0) {
        // 1. Delete ProjectStageWorkLogs for all stages
        await tx.projectStageWorkLog.deleteMany({
          where: {
            projectStageId: {
              in: stageIds,
            },
          },
        });

        // 2. Delete ProjectStageCapacityAllocations for all stages
        await tx.projectStageCapacityAllocation.deleteMany({
          where: {
            projectStageId: {
              in: stageIds,
            },
          },
        });

        // 3. Delete the project stages themselves
        await tx.projectStage.deleteMany({
          where: {
            projectId: id,
          },
        });
      }



      // Reverse the two status writes createProject makes (see the
      // 'APPROVED_CREATE_PROJECT' / 'PROJECT_CREATED' block in createProject).
      // Without this the estimate stayed PROJECT_CREATED pointing at a project
      // row that no longer exists, so the reconvert guard in createProject threw
      // CONFLICT forever — the quote could never become a project again — and
      // the invoice stayed flagged as already converted.
      if (existingProject.deliveryEstimationcode) {
        await tx.deliveryEstimation.updateMany({
          where: { code: existingProject.deliveryEstimationcode },
          data: { status: 'CONFIRMED', projectId: null },
        });
      }

      if (existingProject.invoiceId) {
        await tx.proformaInvoice.update({
          where: { id: existingProject.invoiceId },
          data: { status: 'APPROVED_CLIENT' },
        });
      }

      // Delete the project itself
      // This will automatically cascade delete projectLogs and scheduleHistories
      // because of the @relation with onDelete: Cascade in your schema
      await tx.project.delete({
        where: { id },
      });
    });

    return {
      message: 'Project deleted successfully',
      invoiceId: existingProject.invoiceId || null,
      invoiceStatusReset: existingProject.invoiceId ? 'APPROVED_CLIENT' : null,
      estimationReset: existingProject.deliveryEstimationcode
        ? 'CONFIRMED'
        : null,
      stagesDeleted: existingProject.stages.length,
    };
  } catch (error) {
    console.error('Error deleting project:', error);
    
    // Enhanced error logging
    console.error('Error details:', {
      code: error.code,
      meta: error.meta,
      message: error.message,
      stack: error.stack,
    });
    
    if (error.code === 'P2003') {
      throw new ApiError(
        httpStatus.CONFLICT,
        `Cannot delete project: ${error.meta?.field_name || 'Related records exist'}`,
      );
    }
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Failed to delete project',
    );
  }
};

/**
 * Columns a client may sort by.
 *
 * `sortBy` was previously spread straight into Prisma's `orderBy`. An unknown
 * column raised a validation error that the catch-all below turned into an
 * empty 200 — so a typo in a query string silently returned "no projects"
 * rather than an error.
 */
const PROJECT_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'status',
  'difficulty',
  'requestedDelivery',
  'calculatedDelivery',
  'finalDelivery',
  'totalDays',
];

const safeSort = (sortBy, sortOrder) => ({
  [PROJECT_SORT_FIELDS.includes(sortBy) ? sortBy : 'createdAt']:
    sortOrder === 'asc' ? 'asc' : 'desc',
});

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
      orderBy: safeSort(sortBy, sortOrder),
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

    // `total` used to report `projects.length`, which can never exceed `limit`,
    // while `totalPages` in the same object was computed from the real DB count
    // — the two contradicted each other and no client could paginate. Count once
    // and derive both from it.
    const total = await prisma.project.count({ where });

    return {
      projects,
      count: projects.length,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  } catch (findError) {
    // This used to swallow every failure into an empty 200 with an `error` field
    // no caller reads — so a bad `sortBy`, a dropped connection and "genuinely
    // no projects" were indistinguishable, all rendering as an empty table.
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to fetch projects: ${findError.message}`,
    );
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
      orderBy: safeSort(sortBy, sortOrder),
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
    // Same fault as getAllProjects: a swallowed failure rendered as an empty
    // list, so the caller could not tell "no projects" from "query failed".
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Failed to fetch projects by status: ${error.message}`,
    );
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
          piNumber: true,
          total: true,
        },
      },
      stages: {
        orderBy: {
          startDate: 'asc',
        },
        select: {
          id: true,
          stage: true,
          status: true,
          startDate: true,
          endDate: true,
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

  // 2️⃣ Fetch project with stages and invoice data
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

  // 3️⃣ Check if project has metal works
  const hasMetalWorks = checkIfProjectHasMetalWorks(project);

  // 4️⃣ Determine the next status based on metal works
  const getNextStatusAfterDesign = (hasMetal) => {
    if (hasMetal) {
      return 'METAL_WORKS'; // Go to METAL_WORKS if there's metal
    }
    return 'CUTTING'; // Skip to CUTTING if no metal
  };

  // 5️⃣ Prepare update data
  const updateData = {
    designStatus,
    designById: userId,
  };

  // 6️⃣ Handle FINISHED status logic
  const isNowFinished = designStatus === 'FINISHED';
  let designStageUpdate = null;
  let capacityFreedData = null;

  // Set default status to DESIGN
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
      const syncedActualWorkUnits = currentWorkUnits;
      const workUnitsChanged = currentWorkUnits !== currentActualWorkUnits;

      if (workUnitsChanged) {
        console.log(
          `✅ Syncing: Actual Work Units ${currentActualWorkUnits} → ${syncedActualWorkUnits} (matches Planned Work Units)`,
        );
      } else {
        console.log('✅ Actual work units already match planned work units');
      }

      // Get all capacity allocations for DESIGN stage
      const stageAllocations =
        designStage.projectStageCapacityAllocations || [];

      let totalFreedUnits = 0;
      let totalFreedHours = 0;
      const allocationDetails = [];

      // Subtract allocated capacity from daily capacities
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
            workUnits: currentWorkUnits,
            actualWorkUnits: syncedActualWorkUnits,
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

      // Update project status to the next appropriate stage based on metal works
      updateData.status = getNextStatusAfterDesign(hasMetalWorks);

      // Also update the project's status in the database
      // Note: We're not setting this explicitly here as it will be handled in the transaction
    }
  }

  // 7️⃣ Prepare log messages
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
  if (isNowFinished && oldProjectStatus !== updateData.status) {
    logs.push(
      prisma.projectLog.create({
        data: {
          projectId: id,
          note: `Project status changed from ${oldProjectStatus || 'N/A'} to ${
            updateData.status
          } because design was finished ${
            hasMetalWorks
              ? '(metal works detected)'
              : '(no metal works - skipping to cutting)'
          }`,
          createdById: userId,
        },
      }),
    );
  }

  // Log for design completion with capacity information
  if (isNowFinished && capacityFreedData) {
    const capacityLogMessage = `Design phase completed.`;

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

  // 8️⃣ Execute all updates in a transaction
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

// Helper function to check if project has metal works
const checkIfProjectHasMetalWorks = (project) => {
  // Check if any invoice items have metal materials
  if (project.invoice?.items) {
    for (const item of project.invoice.items) {
      if (item.proformaItemMaterials) {
        for (const material of item.proformaItemMaterials) {
          if (material.material?.metal === true) {
            return true;
          }
        }
      }
    }
  }

  // Also check if there are any existing METAL_WORKS stages
  if (project.stages) {
    for (const stage of project.stages) {
      if (stage.stage === 'METAL_WORKS' && stage.status !== 'CANCELLED') {
        return true;
      }
    }
  }

  return false;
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
    include: { stages: true },
  });

  if (!project) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');
  }

  // FN-2: WORKING days, from the project's actual production end, pinned to
  // close of business — the same rule the engine and the rescheduler use. This
  // used to be `new Date() + totalDays` calendar days, which ignored weekends,
  // holidays, the buffer model and the project's own schedule, and overwrote a
  // correctly computed delivery date with a number derived from nothing.
  const cal = await getCalendar();
  const liveStages = (project.stages || []).filter(
    (s) => s.status !== 'CANCELLED',
  );
  const anchor = liveStages.length
    ? new Date(
        Math.max(
          ...liveStages.map((s) =>
            new Date(s.endDateTime || s.endDate).getTime(),
          ),
        ),
      )
    : cal.nextWorkingStart(new Date());
  const calculatedDelivery = cal.endOfWorkingDay(
    cal.addWorkingDays(anchor, totalDays),
  );

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

  // The working calendar is the ONE definition of which days are worked. This
  // used to be a local `isBusinessDay` that hardcoded Mon-Fri — it disagreed
  // with the scheduler's six-day week and ignored holidays entirely, so a
  // capacity check reported every Saturday as non-working while the scheduler
  // was busy booking work into it.
  const cal = await getCalendar();
  const dailyCapacity = effectiveDailyMax({
    capacity: capacityInfo.capacity || 1,
    parallelSlots: capacityInfo.parallelSlots || 1,
  });
  const workingHoursPerDay = cal.workingHoursPerDay;
  const requiredHours = (requiredQuantity / dailyCapacity) * workingHoursPerDay;
  const requiredDays = Math.max(1, Math.ceil(requiredHours / workingHoursPerDay));

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
    recordMap.set(cal.dayKey(record.date), record);
  });

  let dayCount = 0;
  while (currentDate <= endDateTime && dayCount < 365) {
    if (cal.isWorkingDay(currentDate)) {
      const dateKey = cal.dayKey(currentDate);
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
    const cal = await getCalendar();
    const dailyBreakdown = [];
    const currentDate = new Date(startDate);
    currentDate.setHours(0, 0, 0, 0);
    const endDateTime = new Date(endDate);
    endDateTime.setHours(0, 0, 0, 0);

    while (currentDate <= endDateTime) {
      if (cal.isWorkingDay(currentDate)) {
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

  // newQuantity is optional on edits (e.g. a pure date/time move) — when the
  // caller omits it, preserve the stage's current workUnits instead of
  // treating the missing value as an explicit "clear this stage's work".
  const effectiveQuantity =
    newQuantity === undefined || newQuantity === null
      ? existingStage?.workUnits || 0
      : newQuantity;

  const cal = await getCalendar();
  // Working hours per day is DERIVED from the configured shift and lunch
  // windows and lives on the calendar — it is no longer an independent setting
  // that could contradict the window the scheduler actually works.
  const workingHoursPerDay = cal.workingHoursPerDay;
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
        // WT-1: a user-picked instant may land at night, in the lunch gap, on a
        // weekend or on a holiday. Roll it forward to the first instant work may
        // legally begin so a stage can never be born outside the working window.
        startDt = cal.nextWorkingStart(startDt);
        stage = await tx.projectStage.create({
          data: {
            projectId,
            stage: stageName,
            workUnits: effectiveQuantity,
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
      // keep its current position. Either way the instant is normalized onto the
      // working calendar (WT-1) so an out-of-hours pick from the UI can never be
      // persisted verbatim.
      const chosenStart = cal.nextWorkingStart(
        manualOverride && customDates && customDates.startDate
          ? new Date(customDates.startDate)
          : new Date(stage.startDateTime || stage.startDate || Date.now()),
      );
      const manualTimeline = hasManualDuration
        ? splitWorkingMinutes(cal, chosenStart, timeTakenMinutes)
        : null;

      let updatedStage;
      if (effectiveQuantity > 0) {
        const plan = manualTimeline
          ? null
          : await scheduleProject({
              stageQuantities: { [stageName]: effectiveQuantity },
              startDate: chosenStart,
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
            workUnits: effectiveQuantity,
            startDateTime,
            startDate: startDateTime,
            endDateTime,
            endDate: endDateTime,
            capacityDays,
            shift: sp
              ? sp.shift
              : DEFAULT_STAGE_SHIFT,
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
            quantity: effectiveQuantity,
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
        // Zero quantity: the row carries no capacity work, but it is still a
        // real stage on the timeline. This branch used to write only workUnits,
        // which silently threw away any date/time the user had just picked —
        // "changing the stage date does nothing" for stages like METAL_WORKS
        // that legitimately have no units. Honour the move here too: the
        // position comes from the (already calendar-normalized) chosenStart and
        // the span from the manual duration when one was supplied.
        const startDateTime = manualTimeline ? manualTimeline.start : chosenStart;
        const endDateTime = manualTimeline
          ? manualTimeline.end
          : manualOverride && customDates && customDates.endDate
          ? cal.nextWorkingStart(new Date(customDates.endDate))
          : startDateTime;
        updatedStage = await tx.projectStage.update({
          where: { id: stage.id },
          data: {
            workUnits: effectiveQuantity,
            startDateTime,
            startDate: startDateTime,
            endDateTime,
            endDate: endDateTime,
            capacityDays: Math.max(
              1,
              cal.workingDaysBetween(startDateTime, endDateTime),
            ),
            timeTaken: hasManualDuration ? timeTakenMinutes : stage.timeTaken,
            autoSchedule: !manualOverride,
          },
        });
        // A zero-unit stage reserves no capacity, so there is nothing to
        // allocate — but the time the user logged against it is still real.
        if (manualTimeline && createManualWorkLog && timeTakenMinutes > 0) {
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
const updateDeliveryWithBalance = async (projectId, value) => {
  // Validate projectId
  if (!projectId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Project ID is required');
  }

  // Validate value is boolean
  if (typeof value !== 'boolean') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Value must be a boolean (true or false)',
    );
  }

  // Check if project exists
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      allowToDeliverWithBalance: true,
    },
  });

  if (!project) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Project not found');
  }

  // Update only the allowToDeliverWithBalance field
  const updatedProject = await prisma.project.update({
    where: { id: projectId },
    data: {
      allowToDeliverWithBalance: value,
    },
    select: {
      id: true,
      allowToDeliverWithBalance: true,
    },
  });

  return updatedProject;
};

/**
 * Set allowToDeliverWithBalance to true
 * @param {string} projectId - The project ID
 * @returns {Promise<Object>} - Updated project
 */
const allowDeliveryWithBalance = async (projectId) => {
  return updateDeliveryWithBalance(projectId, true);
};

/**
 * Set allowToDeliverWithBalance to false
 * @param {string} projectId - The project ID
 * @returns {Promise<Object>} - Updated project
 */
const disallowDeliveryWithBalance = async (projectId) => {
  return updateDeliveryWithBalance(projectId, false);
};
module.exports = {
  allowDeliveryWithBalance,
  disallowDeliveryWithBalance,
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
