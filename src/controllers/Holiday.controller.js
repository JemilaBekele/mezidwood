const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const holidayService = require('../services/Holiday.service');

const listHolidays = catchAsync(async (req, res) => {
  const result = await holidayService.listHolidays();
  res.status(httpStatus.OK).send({ success: true, ...result });
});

const createHoliday = catchAsync(async (req, res) => {
  const holiday = await holidayService.createHoliday(req.body);
  res.status(httpStatus.CREATED).send({ success: true, message: 'Holiday added', holiday });
});

const updateHoliday = catchAsync(async (req, res) => {
  const holiday = await holidayService.updateHoliday(req.params.id, req.body);
  res.status(httpStatus.OK).send({ success: true, message: 'Holiday updated', holiday });
});

const deleteHoliday = catchAsync(async (req, res) => {
  await holidayService.deleteHoliday(req.params.id);
  res.status(httpStatus.OK).send({ success: true, message: 'Holiday deleted' });
});

module.exports = { listHolidays, createHoliday, updateHoliday, deleteHoliday };
