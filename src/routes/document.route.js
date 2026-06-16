const express = require('express');
const auth = require('../middlewares/auth');
// const validate = require('../middlewares/validate');
const { documentController } = require('../controllers');

const router = express.Router();

// router.route('/').post(auth(), upload, documentController.createDocument);

router.post(
  '/api/document',
  auth,
  (req, res, next) => {
    if (!req.files || !req.files.document) {
      return res.status(400).json({
        error: true,
        message: 'No file was uploaded',
      });
    }
    next();
  },
  documentController.createDocument,
);
router.post(
  '/api/document/lease',
  auth,
  (req, res, next) => {
    if (!req.files || !req.files.document) {
      return res.status(400).json({
        error: true,
        message: 'No file was uploaded',
      });
    }
    next();
  },
  documentController.createlease,
);
router.get('/api/document/user/:id', auth, documentController.getUserDocuments); // ✅ Get all users

// Get single document by ID
router.get('/api/document/:documentId', auth, documentController.getDocument);

// Update document (with optional file upload)
router.patch(
  '/api/document/:documentId',
  auth,

  documentController.updateDocument,
);

// Delete document
router.delete(
  '/api/document/:documentId',
  auth,
  documentController.deleteDocument,
);

module.exports = router;
