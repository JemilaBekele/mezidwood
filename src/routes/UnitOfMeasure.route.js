const express = require('express');

const router = express.Router();
const { unitOfMeasureController } = require('../controllers');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission.middleware');

// Create a UnitOfMeasure
router.post(
  '/api/units-of-measure',
  //   auth,
  // checkPermission('CREATE_UNIT_OF_MEASURE'),
  unitOfMeasureController.createUnitOfMeasure,
);

// Get a UnitOfMeasure by ID
router.get(
  '/api/units-of-measure/:id',
  // checkPermission('VIEW_UNIT_OF_MEASURE'),
  unitOfMeasureController.getUnitOfMeasure,
);

// Get all UnitsOfMeasure
router.get(
  '/api/units-of-measure',
  // checkPermission('VIEW_UNIT_OF_MEASURE'),
  unitOfMeasureController.getUnitsOfMeasure,
);

// Update a UnitOfMeasure
router.put(
  '/api/units-of-measure/:id',
  auth,
  checkPermission('UPDATE_UNIT_OF_MEASURE'),
  unitOfMeasureController.updateUnitOfMeasure,
);

// Delete a UnitOfMeasure
router.delete(
  '/api/units-of-measure/:id',
  auth,
  checkPermission('DELETE_UNIT_OF_MEASURE'),
  unitOfMeasureController.deleteUnitOfMeasure,
);
module.exports = router;
