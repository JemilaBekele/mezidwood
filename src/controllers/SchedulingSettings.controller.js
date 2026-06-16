const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
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
const updateSettings = catchAsync(async (req, res) => {
  const allowedFields = [
    'contingencyDays',
    'easyPercent',
    'mediumPercent',
    'hardPercent',
    'workingHoursPerDay',
  ];
  const data = {};
  for (const k of allowedFields) {
    const v = req.body[k];
    if (v === undefined || v === null || v === '') continue;
    const num = Number(v);
    if (
      Number.isNaN(num) ||
      num < 0 ||
      (k === 'contingencyDays' && !Number.isInteger(num)) ||
      (k === 'workingHoursPerDay' && num <= 0)
    ) {
      return res.status(httpStatus.BAD_REQUEST).send({
        success: false,
        error:
          'Invalid scheduling settings: contingencyDays must be a non-negative integer, difficulty percentages must be non-negative numbers, and workingHoursPerDay must be greater than 0',
      });
    }
    data[k] = num;
  }
  if (Object.keys(data).length === 0) {
    return res.status(httpStatus.BAD_REQUEST).send({
      success: false,
      error:
        'Provide at least one of: contingencyDays, easyPercent, mediumPercent, hardPercent, workingHoursPerDay',
    });
  }
  const settings = await updateSchedulingSettings(data);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Scheduling settings updated',
    settings,
  });
});

module.exports = { getSettings, updateSettings };
