/**
 * Request validation for the project + delivery-estimation scheduling endpoints.
 *
 * WT-5 / AR-3: these routes previously took `req.body` raw — there was no
 * validation module for anything but auth. Nothing rejected a requested
 * delivery date in the past, a start date on a Sunday, a non-numeric quantity
 * or an unknown sort column, so bad input surfaced either as a raw Prisma 500
 * or, worse, as a silently wrong schedule.
 *
 * Note on WORKING-TIME validation: we deliberately do NOT reject a start or
 * delivery date that falls outside working hours. The scheduler rolls such an
 * instant forward to the next working period and reports it back as a warning
 * (see Project.service.createProject) — refusing the request would block
 * legitimate after-hours data entry, which is when a lot of this work happens.
 * What we DO reject is input that can only be a mistake: dates in the past,
 * malformed dates, negative quantities.
 */
const Joi = require('joi');

const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'];

const CAPACITY_STAGES = [
  'DESIGN',
  'METAL_WORKS',
  'CNC',
  'CUTTING',
  'EDGE_BANDING',
  'ASSEMBLY',
  'PAINTING',
  'FINISHING',
  'DELIVERY',
];

/** A quantity: non-negative, finite, and not absurd (a typo guard). */
const quantity = Joi.number().min(0).max(1000000);

/** A date that must not be in the past (compared by calendar day, not instant). */
const futureDate = Joi.date().custom((value, helpers) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (value.getTime() < startOfToday.getTime()) {
    return helpers.error('date.past');
  }
  return value;
}, 'not in the past');

const stageQuantityKeys = CAPACITY_STAGES.reduce((acc, s) => {
  acc[s] = quantity;
  return acc;
}, {});

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */
const createProject = {
  body: Joi.object().keys({
    invoiceId: Joi.string().required(),
    customerId: Joi.string().allow(null, ''),
    deliveryEstimationcode: Joi.string().allow(null, ''),
    status: Joi.string(),
    difficulty: Joi.string()
      .valid(...DIFFICULTIES)
      .default('EASY'),
    // Rolled forward to the next working instant if out of hours; rejected only
    // if it is in the past or unparseable.
    requestedDelivery: futureDate.allow(null, '').messages({
      'date.past': 'Requested delivery date cannot be in the past',
      'date.base': 'Requested delivery date is not a valid date',
    }),
    manualStartDate: futureDate.allow(null, '').messages({
      'date.past': 'Start date cannot be in the past',
      'date.base': 'Start date is not a valid date',
    }),
  }),
};

const updateProjectStage = {
  body: Joi.object().keys({
    stageName: Joi.string(),
    newQuantity: quantity,
    timeTakenMinutes: Joi.number().min(0).max(60 * 24 * 365).allow(null),
    isNewStage: Joi.boolean(),
    manualOverride: Joi.boolean(),
    createManualWorkLog: Joi.boolean(),
    customDates: Joi.object()
      .keys({
        startDate: Joi.date().allow(null, ''),
        endDate: Joi.date().allow(null, ''),
      })
      .unknown(true),
  }).unknown(true),
};

const calculateDelivery = {
  body: Joi.object().keys({
    totalDays: Joi.number().integer().min(1).max(3650).required(),
  }),
};

/* ------------------------------------------------------------------ *
 * Delivery estimations
 * ------------------------------------------------------------------ */
const createDeliveryEstimation = {
  body: Joi.object()
    .keys({
      customerName: Joi.string().allow(null, '').max(255),
      phone: Joi.string()
        .allow(null, '')
        .pattern(/^[+]?[0-9\s\-()]{10,}$/)
        .messages({ 'string.pattern.base': 'Please provide a valid phone number' }),
      piId: Joi.string().allow(null, ''),
      difficulty: Joi.string()
        .valid(...DIFFICULTIES)
        .required(),
      status: Joi.string().valid('ESTIMATED', 'ON_HOLD'),
      holdUntil: futureDate.allow(null, '').messages({
        'date.past': 'Hold until date must be in the future',
      }),
      items: Joi.array().items(
        Joi.object().keys({
          itemId: Joi.string().required(),
          quantity: quantity.default(1),
        }).unknown(true),
      ),
      ...stageQuantityKeys,
    })
    // At least one capacity stage must carry work, or there is nothing to quote.
    .or(...CAPACITY_STAGES),
};

const calculateDeliveryEstimation = {
  body: Joi.object().keys({
    difficulty: Joi.string()
      .valid(...DIFFICULTIES)
      .required(),
    startDate: Joi.date().allow(null, ''),
    stageQuantities: Joi.object().keys(stageQuantityKeys).required(),
  }),
};

const deriveStageQuantities = {
  body: Joi.object()
    .keys({
      materials: Joi.object().keys({
        laminatedMDF: quantity,
        plainMDF: quantity,
        wood: quantity,
        metal: quantity,
        other: quantity,
      }),
      items: Joi.array().items(
        Joi.object().keys({
          itemId: Joi.string().required(),
          quantity: quantity.default(1),
        }).unknown(true),
      ),
    })
    .or('materials', 'items'),
};

const createProjectFromEstimation = {
  body: Joi.object().keys({
    deliveryEstimationCode: Joi.string().required(),
    proformaInvoiceId: Joi.string().required(),
  }).unknown(true),
};

/* ------------------------------------------------------------------ *
 * Scheduling settings
 * ------------------------------------------------------------------ */
const hourOfDay = Joi.number().min(0).max(24);

const updateSchedulingSettings = {
  body: Joi.object()
    .keys({
      contingencyDays: Joi.number().integer().min(0).max(365),
      easyPercent: Joi.number().min(0).max(5),
      mediumPercent: Joi.number().min(0).max(5),
      hardPercent: Joi.number().min(0).max(5),
      // Working time. workingHoursPerDay is DERIVED and rejected as input —
      // accepting it independently is what let the stored value contradict the
      // shift window and schedule work past closing time.
      workingDays: Joi.alternatives().try(
        Joi.string().pattern(/^[0-6](,[0-6])*$/),
        Joi.array().items(Joi.number().integer().min(0).max(6)),
      ),
      shiftStartHour: hourOfDay,
      shiftEndHour: hourOfDay,
      lunchStartHour: hourOfDay,
      lunchEndHour: hourOfDay,
      timezone: Joi.string().max(64),
    })
    .custom((value, helpers) => {
      const { shiftStartHour, shiftEndHour, lunchStartHour, lunchEndHour } = value;
      if (
        shiftStartHour !== undefined &&
        shiftEndHour !== undefined &&
        shiftEndHour <= shiftStartHour
      ) {
        return helpers.message('Shift end must be after shift start');
      }
      if (
        lunchStartHour !== undefined &&
        lunchEndHour !== undefined &&
        lunchEndHour < lunchStartHour
      ) {
        return helpers.message('Lunch end must not be before lunch start');
      }
      return value;
    }),
};

const createHoliday = {
  body: Joi.object().keys({
    date: Joi.date().required(),
    name: Joi.string().trim().min(1).max(255).required(),
    recurring: Joi.boolean().default(false),
  }),
};

module.exports = {
  createProject,
  updateProjectStage,
  calculateDelivery,
  createDeliveryEstimation,
  calculateDeliveryEstimation,
  deriveStageQuantities,
  createProjectFromEstimation,
  updateSchedulingSettings,
  createHoliday,
};
