const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { materialService } = require('../services');

// Create Material
const createMaterial = catchAsync(async (req, res) => {
  // Structure files by field name
  const structuredFiles = {};

  if (Array.isArray(req.files)) {
    req.files.forEach((file) => {
      if (!structuredFiles[file.fieldname]) {
        structuredFiles[file.fieldname] = [];
      }
      structuredFiles[file.fieldname].push(file);
    });
  } else if (req.files) {
    Object.keys(req.files).forEach((fieldname) => {
      const files = req.files[fieldname];
      structuredFiles[fieldname] = Array.isArray(files) ? files : [files];
    });
  }

  // Ensure image field exists even if no file was uploaded
  structuredFiles.image = structuredFiles.image || undefined;

  const material = await materialService.createMaterial(
    req.body,
    structuredFiles,
  );

  res.status(httpStatus.CREATED).send({
    success: true,
    message: 'Material created successfully',
    material,
  });
});

const updateMaterial = catchAsync(async (req, res) => {
  // Structure files by field name
  const structuredFiles = {};

  if (Array.isArray(req.files)) {
    req.files.forEach((file) => {
      if (!structuredFiles[file.fieldname]) {
        structuredFiles[file.fieldname] = [];
      }
      structuredFiles[file.fieldname].push(file);
    });
  } else if (req.files) {
    Object.entries(req.files).forEach(([fieldname, files]) => {
      structuredFiles[fieldname] = Array.isArray(files) ? files : [files];
    });
  }

  // Ensure image field exists even if no file was uploaded
  structuredFiles.image = structuredFiles.image || undefined;

  const material = await materialService.updateMaterial(
    req.params.id,
    req.body,
    structuredFiles,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: 'Material updated successfully',
    material,
  });
});

// Get Material by ID
const getMaterial = catchAsync(async (req, res) => {
  const material = await materialService.getMaterialById(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    material,
  });
});
const getMaterialId = catchAsync(async (req, res) => {
  const material = await materialService.getMaterialId(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    material,
  });
});
const getMaterialStockById = catchAsync(async (req, res) => {
  const material = await materialService.getMaterialStockById(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    material,
  });
});

// Get all Materials
const getMaterials = catchAsync(async (req, res) => {
  const result = await materialService.getAllMaterials();
  res.status(httpStatus.OK).send({
    success: true,
    ...result,
  });
});

// Update Material

// Delete Material
const deleteMaterial = catchAsync(async (req, res) => {
    console.log("jemu")
  
  await materialService.deleteMaterial(req.params.id);
  res.status(httpStatus.OK).send({
    success: true,
    message: 'Material deleted successfully',
  });
});

const updateProformaMaterialStatus = catchAsync(async (req, res) => {
  const { status, givenToId, givenquantity, additionalQuantity } = req.body;

  // Validate required fields based on status
  // if ((status === 'ISSUED' || status === 'PARTIALLY') && !givenToId) {
  //   return res.status(httpStatus.BAD_REQUEST).send({
  //     success: false,
  //     message: 'givenToId is required when issuing material',
  //   });
  // }

  // // Validate quantity fields for ISSUED or PARTIALLY status
  // if (status === 'ISSUED' || status === 'PARTIALLY') {
  //   const totalQuantity = (givenquantity || 0) + (additionalQuantity || 0);

  //   if (totalQuantity <= 0) {
  //     return res.status(httpStatus.BAD_REQUEST).send({
  //       success: false,
  //       message: 'Total given quantity must be greater than 0',
  //     });
  //   }
  // }

  const material = await materialService.updateProformaMaterialStatus(
    req.params.id,
    status,
    req.user.id,
    givenToId,
    givenquantity,
    additionalQuantity,
  );

  // Customize success message based on status and quantities
  let successMessage = `Material ${status.toLowerCase()} successfully`;

  if (status === 'PARTIALLY') {
    const totalGiven = (givenquantity || 0) + (additionalQuantity || 0);
    successMessage = `Material partially issued successfully. Total given: ${totalGiven}`;
  } else if (status === 'ISSUED' && (givenquantity || additionalQuantity)) {
    const totalGiven = (givenquantity || 0) + (additionalQuantity || 0);
    successMessage = `Material issued successfully. Total given: ${totalGiven}`;
  }

  res.status(httpStatus.OK).send({
    success: true,
    message: successMessage,
    data: material,
  });
});
const acceptInitialStock = catchAsync(async (req, res) => {
  const { materialId, initialQuantity } = req.body;

  const result = await materialService.acceptInitialStock(
    materialId,
    Number(initialQuantity),
    req.user.id,
  );

  res.status(httpStatus.OK).send({
    success: true,
    message: result.message,
    data: result,
  });
});
module.exports = {
  acceptInitialStock,
  getMaterialId,
  createMaterial,
  getMaterial,
  getMaterials,
  updateMaterial,
  deleteMaterial,
  getMaterialStockById,
  updateProformaMaterialStatus,
};
