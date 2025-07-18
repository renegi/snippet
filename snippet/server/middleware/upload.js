const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  console.log('📱 Mobile Debug: File filter check', {
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    userAgent: req.headers['user-agent'],
    isMobile: /iPhone|iPad|iPod|Android/i.test(req.headers['user-agent'] || '')
  });
  
  if (file.mimetype.startsWith('image/')) {
    console.log('📱 Mobile Debug: File accepted');
    cb(null, true);
  } else {
    console.log('📱 Mobile Debug: File rejected - not an image');
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // Increased to 10MB for mobile images
    files: 5 // Maximum 5 files
  }
});

module.exports = upload; 