const express = require('express');

const router = express.Router();
const auth = require('../middlewares/auth');
const holidayController = require('../controllers/Holiday.controller');

// Working-calendar holidays / non-working dates (drive the scheduler's calendar).
router.get('/api/holidays', auth, holidayController.listHolidays);
router.post('/api/holidays', auth, holidayController.createHoliday);
router.put('/api/holidays/:id', auth, holidayController.updateHoliday);
router.delete('/api/holidays/:id', auth, holidayController.deleteHoliday);

module.exports = router;
