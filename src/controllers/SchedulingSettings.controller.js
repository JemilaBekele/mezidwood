const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const {
  getSchedulingSettingsRow,
  updateSchedulingSettings,
} = require('../services/scheduling/settings');

// GET the singleton scheduling settings (creating it with defaults if absent).
const getSettings = catchAsync(async (req, res) => {
  const settings = await getSchedulingSettingsRow();
  res.status(httpStatus.OK).send({ success: true, settings });
});

// PUT — update the tunable delivery-formula knobs. Only known fields are taken;
// the in-memory cache is invalidated inside the service so changes apply at once.
// Numeric knobs, validated here. `workingHoursPerDay` is deliberately absent —
// it is DERIVED from the shift and lunch windows by the service, so accepting it
// would let a caller store a number that contradicts the window the scheduler
// actually works.
const NUMERIC_FIELDS = [
  'contingencyDays',
  'easyPercent',
  'mediumPercent',
  'hardPercent',
  'shiftStartHour',
  'shiftEndHour',
  'lunchStartHour',
  'lunchEndHour',
];

// Non-numeric working-time fields. The service validates the window as a whole
// (see scheduling/settings.js) once the patch is merged onto the stored row.
const PASSTHROUGH_FIELDS = ['workingDays', 'timezone'];

const updateSettings = catchAsync(async (req, res) => {
  // The allowlist used to contain only the four delivery-formula knobs plus the
  // one field the service refuses. Every working-time field the route's own Joi
  // schema accepts — working days, shift window, lunch, timezone — was silently
  // dropped here, so the endpoint answered 200 "updated" having changed nothing
  // and working time could not be configured at all.
  const data = {};

  for (const k of NUMERIC_FIELDS) {
    const v = req.body[k];
    if (v === undefined || v === null || v === '') continue;
    const num = Number(v);
    if (
      Number.isNaN(num) ||
      num < 0 ||
      (k === 'contingencyDays' && !Number.isInteger(num)) ||
      (k.endsWith('Hour') && num > 24)
    ) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Invalid value for ${k}: contingencyDays must be a non-negative integer, difficulty percentages must be non-negative numbers, and hour fields must be between 0 and 24`,
      );
    }
    data[k] = num;
  }

  for (const k of PASSTHROUGH_FIELDS) {
    const v = req.body[k];
    if (v === undefined || v === null || v === '') continue;
    data[k] = v;
  }

  if (Object.keys(data).length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Provide at least one of: ${[...NUMERIC_FIELDS, ...PASSTHROUGH_FIELDS].join(', ')}`,
    );
  }

  const settings = await updateSchedulingSettings(data);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Scheduling settings updated',
    settings,
  });
});

module.exports = { getSettings, updateSettings };
