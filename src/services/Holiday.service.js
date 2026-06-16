const httpStatus = require('http-status');
const prisma = require('./prisma');
const ApiError = require('../utils/ApiError');
const { invalidateHolidayCache } = require('./scheduling/calendar');

// Holidays are stored as UTC-midnight day markers (same convention the engine
// uses for DailyStageCapacity.date) so the business-tz day label is stable
// regardless of the server timezone.
const dayMarker = (dateStr) => new Date(`${String(dateStr).slice(0, 10)}T00:00:00.000Z`);

const listHolidays = async () => {
  const holidays = await prisma.holiday.findMany({ orderBy: { date: 'asc' } });
  return { holidays, count: holidays.length };
};

const createHoliday = async ({ date, name, recurring }) => {
  if (!date) throw new ApiError(httpStatus.BAD_REQUEST, 'Date is required');
  if (!name || !String(name).trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Name is required');
  }
  const d = dayMarker(date);
  if (Number.isNaN(d.getTime())) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid date');
  }
  const existing = await prisma.holiday.findUnique({ where: { date: d } });
  if (existing) {
    throw new ApiError(httpStatus.CONFLICT, 'A holiday already exists on that date');
  }
  const holiday = await prisma.holiday.create({
    data: { date: d, name: String(name).trim(), recurring: !!recurring },
  });
  // Drop the calendar's cached holiday sets so the scheduler honours it at once.
  invalidateHolidayCache();
  return holiday;
};

const updateHoliday = async (id, body) => {
  const existing = await prisma.holiday.findUnique({ where: { id } });
  if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'Holiday not found');
  const data = {};
  if (body.name != null) data.name = String(body.name).trim();
  if (body.recurring != null) data.recurring = !!body.recurring;
  if (body.date) {
    const d = dayMarker(body.date);
    if (Number.isNaN(d.getTime())) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid date');
    data.date = d;
  }
  const holiday = await prisma.holiday.update({ where: { id }, data });
  invalidateHolidayCache();
  return holiday;
};

const deleteHoliday = async (id) => {
  const existing = await prisma.holiday.findUnique({ where: { id } });
  if (!existing) throw new ApiError(httpStatus.NOT_FOUND, 'Holiday not found');
  await prisma.holiday.delete({ where: { id } });
  invalidateHolidayCache();
  return { message: 'Holiday deleted' };
};

module.exports = { listHolidays, createHoliday, updateHoliday, deleteHoliday };
