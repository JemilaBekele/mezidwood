// config/multer.config.js
const multer = require('multer');
const httpStatus = require('http-status');
const path = require('path'); // ← Add this line
const fs = require('fs');
const ApiError = require('./ApiError');
// Create a wrapped version of the multer middleware
const debugUploadProformaInvoice = function (req, res, next) {
  console.log('=== MULTER MIDDLEWARE ENTERING ===');
  console.log('1. Time:', new Date().toISOString());
  console.log('2. Content-Type:', req.headers['content-type']);
  console.log('3. Content-Length:', req.headers['content-length']);
  console.log('4. Request headers:', JSON.stringify(req.headers, null, 2));

  // Check if bodyParser might have already parsed the request
  console.log('5. Is request already parsed?');
  console.log('   - req.body exists:', !!req.body);
  console.log('   - req.body keys:', Object.keys(req.body || {}));

  // Count the number of times fileFilter is called
  let fileFilterCallCount = 0;

  // Configure different storage strategies for different file types
  const storage = multer.diskStorage({
    destination(req, file, cb) {
      console.log(`\n=== DESTINATION FUNCTION CALLED ===`);
      console.log('File fieldname:', file.fieldname);
      console.log('File originalname:', file.originalname);
      console.log('File mimetype:', file.mimetype);

      // Save attachments to proforma/attachments folder
      if (file.fieldname === 'attachments') {
        const destPath = path.join(
          __dirname,
          '../../uploads/proforma/attachments',
        );
        console.log('Destination path for attachment:', destPath);

        // Ensure directory exists
        fs.mkdir(destPath, { recursive: true }, (err) => {
          if (err) {
            console.error('Error creating directory:', err);
            return cb(err);
          }
          console.log('Directory ensured:', destPath);
          cb(null, destPath);
        });
      } else if (
        file.fieldname.startsWith('items[') &&
        file.fieldname.includes('].image')
      ) {
        // Save item images to proforma/images folder
        const destPath = path.join(__dirname, '../../uploads/proforma/images');
        console.log('Destination path for item image:', destPath);

        // Ensure directory exists
        fs.mkdir(destPath, { recursive: true }, (err) => {
          if (err) {
            console.error('Error creating directory:', err);
            return cb(err);
          }
          console.log('Directory ensured:', destPath);
          cb(null, destPath);
        });
      } else {
        // For any other files, use temporary location
        const tempPath = path.join(__dirname, '../../uploads/temp');
        console.log('Destination path for other files:', tempPath);

        fs.mkdir(tempPath, { recursive: true }, (err) => {
          if (err) {
            console.error('Error creating directory:', err);
            return cb(err);
          }
          cb(null, tempPath);
        });
      }
    },
    filename(req, file, cb) {
      console.log(`\n=== FILENAME FUNCTION CALLED ===`);
      console.log('Original filename:', file.originalname);

      // Generate unique filename
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = path.extname(file.originalname);
      const basename = path.basename(file.originalname, ext);

      // Clean filename (remove special characters)
      const cleanBasename = basename.replace(/[^a-zA-Z0-9-_]/g, '');
      const filename = `${cleanBasename}-${uniqueSuffix}${ext}`;

      console.log('Generated filename:', filename);
      console.log(
        'Full path will be:',
        file.fieldname === 'attachments'
          ? `/uploads/proforma/attachments/${filename}`
          : `/uploads/proforma/images/${filename}`,
      );

      cb(null, filename);
    },
  });

  // Create a new instance with enhanced logging
  const enhancedMulter = multer({
    storage, // Use diskStorage instead of memoryStorage
    fileFilter: (req, file, cb) => {
      fileFilterCallCount++;
      console.log(`\n=== FILE FILTER CALL #${fileFilterCallCount} ===`);
      console.log('File details:');
      console.log('  - fieldname:', file.fieldname);
      console.log('  - originalname:', file.originalname);
      console.log('  - mimetype:', file.mimetype);
      console.log('  - size:', file.size, 'bytes');
      console.log('  - encoding:', file.encoding);

      // Log all file properties
      console.log('  - All file properties:');
      Object.keys(file).forEach((key) => {
        console.log(`    ${key}:`, file[key]);
      });

      // Your existing file filter logic...
      if (
        file.fieldname.startsWith('items[') &&
        file.fieldname.includes('].image')
      ) {
        console.log('  - Processing as item image');
        if (!file.mimetype.startsWith('image/')) {
          console.log('  ❌ Rejected: not an image');
          return cb(
            new ApiError(
              httpStatus.BAD_REQUEST,
              'Item images must be image files',
            ),
            false,
          );
        }
        console.log('  ✅ Accepted as item image');
        return cb(null, true);
      }

      if (['attachments'].includes(file.fieldname)) {
        console.log('  - Processing as attachment');
        const allowedTypes = [
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ];

        console.log('  - Checking mimetype:', file.mimetype);
        console.log(
          '  - Allowed types include?',
          allowedTypes.includes(file.mimetype),
        );

        if (!allowedTypes.includes(file.mimetype)) {
          console.log('  ❌ Rejected: unsupported type');
          return cb(
            new ApiError(
              httpStatus.BAD_REQUEST,
              'Unsupported file type for attachments',
            ),
            false,
          );
        }
        console.log('  ✅ Accepted as attachment');
        return cb(null, true);
      }

      console.log('  ⚠️ Ignoring field:', file.fieldname);
      return cb(null, false);
    },
    limits: { fileSize: 40 * 1024 * 1024 },
  }).any();

  // Call the multer middleware
  enhancedMulter(req, res, (err) => {
    console.log('\n=== MULTER MIDDLEWARE COMPLETED ===');
    console.log('File filter was called', fileFilterCallCount, 'times');

    if (err) {
      console.error('❌ Multer error:', err);
      console.error('Error details:', {
        message: err.message,
        name: err.name,
        stack: err.stack,
      });
    } else {
      console.log('✅ Multer completed successfully');
      console.log('Request now has:');
      console.log(
        '  - req.files:',
        req.files ? `Array with ${req.files.length} items` : 'undefined',
      );
      console.log('  - req.body keys:', Object.keys(req.body || {}));

      if (req.files && req.files.length > 0) {
        console.log('  Files details:');
        req.files.forEach((file, index) => {
          console.log(
            `  [${index}] ${file.fieldname}: ${file.originalname} (${file.mimetype}, ${file.size} bytes)`,
          );
          console.log(`      Saved to: ${file.path}`);
          console.log(`      Destination: ${file.destination}`);
          console.log(`      Filename: ${file.filename}`);
        });
      }
    }

    next(err);
  });
};
const debugUploadSellFiles = function (req, res, next) {
  // Count the number of times fileFilter is called
  let fileFilterCallCount = 0;

  // Configure storage for sell files
  const storage = multer.diskStorage({
    destination(req, file, cb) {
      let destPath;

      // Save images to sell/images folder
      if (file.fieldname === 'image') {
        destPath = path.join(__dirname, '../../uploads/sell/images');
      }
      // Save documents to sell/documents folder
      else if (file.fieldname === 'document') {
        destPath = path.join(__dirname, '../../uploads/sell/documents');
      }
      // For any other files, use temporary location
      else {
        destPath = path.join(__dirname, '../../uploads/temp');
      }

      // Ensure directory exists
      fs.mkdir(destPath, { recursive: true }, (err) => {
        if (err) {
          console.error('Error creating directory:', err);
          return cb(err);
        }
        console.log('Directory ensured:', destPath);
        cb(null, destPath);
      });
    },
    filename(req, file, cb) {
      // Generate unique filename
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = path.extname(file.originalname);
      const basename = path.basename(file.originalname, ext);

      // Clean filename (remove special characters)
      const cleanBasename = basename.replace(/[^a-zA-Z0-9-_]/g, '');
      const filename = `${cleanBasename}-${uniqueSuffix}${ext}`;

      cb(null, filename);
    },
  });

  // Create a new instance with enhanced logging
  const enhancedMulter = multer({
    storage,
    fileFilter: (req, file, cb) => {
      fileFilterCallCount++;

      // IMPORTANT: Accept image files
      if (file.fieldname === 'image') {
        const allowedImageTypes = [
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'image/jpg',
        ];

        if (!allowedImageTypes.includes(file.mimetype)) {
          return cb(
            new ApiError(
              httpStatus.BAD_REQUEST,
              'Image must be a valid image file (jpeg, png, gif, webp)',
            ),
            false,
          );
        }
        return cb(null, true);
      }

      // IMPORTANT: Accept document files
      if (file.fieldname === 'document') {
        const allowedDocumentTypes = [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/plain',
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
        ];

        if (!allowedDocumentTypes.includes(file.mimetype)) {
          return cb(
            new ApiError(httpStatus.BAD_REQUEST, 'Unsupported document type'),
            false,
          );
        }
        return cb(null, true);
      }

      // Reject all other fields
      return cb(null, false);
    },
    limits: {
      fileSize: 20 * 1024 * 1024, // 20MB limit
    },
  });

  // Use .fields() to accept specific field names
  const uploadMiddleware = enhancedMulter.fields([
    { name: 'image', maxCount: 1 },
    { name: 'document', maxCount: 1 },
  ]);

  // Call the multer middleware
  uploadMiddleware(req, res, (err) => {
    if (err) {
      console.error('❌ Multer error:', err);
      console.error('Error details:', {
        message: err.message,
        name: err.name,
        stack: err.stack,
      });
      return next(err);
    }

    if (req.files) {
      Object.keys(req.files).forEach((fieldname) => {
        const files = req.files[fieldname];
        files.forEach((file, index) => {
          console.log(
            `    [${index}] ${file.originalname} (${file.mimetype}, ${file.size} bytes)`,
          );
          console.log(`        Saved to: ${file.path}`);
        });
      });
    }

    next();
  });
};
const uploadImage = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // Only process these specific fields as files
    if (['image'].includes(file.fieldname)) {
      if (!file.mimetype.startsWith('image/')) {
        return cb(
          new ApiError(httpStatus.BAD_REQUEST, 'Only images allowed'),
          false,
        );
      }
      return cb(null, true);
    }
    // Explicitly ignore all other fields
    return cb(null, false);
  },
  limits: { fileSize: 40 * 1024 * 1024 }, // 🔺 40MB limit
}).any();
const uploadImageitem = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // Accept image files only
    if (file.fieldname === 'image' || file.fieldname === 'images') {
      if (!file.mimetype.startsWith('image/')) {
        return cb(
          new ApiError(httpStatus.BAD_REQUEST, 'Only images allowed'),
          false,
        );
      }
      return cb(null, true);
    }
    // Ignore other fields
    return cb(null, false);
  },
  limits: { 
    fileSize: 40 * 1024 * 1024, // 40MB limit
    files: 11 // Max files
  },
}).any();
const uploadProformaInvoice = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    console.log('File filter called for field:', file.fieldname);
    console.log('MIME type:', file.mimetype);
    console.log('Original name:', file.originalname);

    // Allow images for item images
    if (
      file.fieldname.startsWith('items[') &&
      file.fieldname.includes('].image')
    ) {
      console.log('Processing item image field');
      if (!file.mimetype.startsWith('image/')) {
        console.log('❌ Item image rejected: not an image file');
        return cb(
          new ApiError(
            httpStatus.BAD_REQUEST,
            'Item images must be image files',
          ),
          false,
        );
      }
      console.log('✅ Item image accepted');
      return cb(null, true);
    }

    // Allow attachments (could be documents or images)
    if (['attachments'].includes(file.fieldname)) {
      console.log('Processing attachments field');
      // Allow common document and image types
      const allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ];

      console.log('Checking if type', file.mimetype, 'is in allowed types');

      if (!allowedTypes.includes(file.mimetype)) {
        console.log('❌ Attachment rejected: unsupported type');
        return cb(
          new ApiError(
            httpStatus.BAD_REQUEST,
            'Unsupported file type for attachments',
          ),
          false,
        );
      }
      console.log('✅ Attachment accepted');
      return cb(null, true);
    }

    // Explicitly ignore all other fields
    console.log('⚠️ Field ignored:', file.fieldname);
    return cb(null, false);
  },
  limits: { fileSize: 40 * 1024 * 1024 }, // 40MB limit
}).any();

console.log('✅ Multer middleware created successfully');

const uploadImacamp = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // Only process these specific fields as files
    if (['logo'].includes(file.fieldname)) {
      if (!file.mimetype.startsWith('image/')) {
        return cb(
          new ApiError(httpStatus.BAD_REQUEST, 'Only images allowed'),
          false,
        );
      }
      return cb(null, true);
    }
    // Explicitly ignore all other fields
    return cb(null, false);
  },
  limits: { fileSize: 40 * 1024 * 1024 }, // 🔺 40MB limit
}).any();
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // Only process these specific fields as files
    if (['photo', 'national'].includes(file.fieldname)) {
      if (!file.mimetype.startsWith('image/')) {
        return cb(
          new ApiError(httpStatus.BAD_REQUEST, 'Only images allowed'),
          false,
        );
      }
      return cb(null, true);
    }
    // Explicitly ignore all other fields
    return cb(null, false);
  },
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
}).any();

module.exports = {
  debugUploadProformaInvoice,
  upload,
  uploadImage,
  uploadImacamp,
  uploadProformaInvoice,
  debugUploadSellFiles,
  uploadImageitem,
};
