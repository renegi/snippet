const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Import your existing services
const VisionService = require('../podquote/server/services/visionService');
const logger = require('../podquote/server/utils/logger');

// Configure multer for temporary file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(os.tmpdir(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

const visionService = new VisionService();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: { message: 'Method not allowed' }
    });
  }

  try {
    // Handle file upload
    await new Promise((resolve, reject) => {
      upload.array('screenshots', 5)(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'No files uploaded' }
      });
    }

    const results = [];
    for (const file of req.files) {
      try {
        const podcastInfo = await visionService.extractText(file.path);
        results.push(podcastInfo);
        
        // Clean up temporary file
        fs.unlinkSync(file.path);
      } catch (error) {
        logger.error('Error processing file:', error);
        // Clean up temporary file even on error
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        throw error;
      }
    }

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    logger.error('Error processing screenshots:', error);
    
    // Clean up any remaining files
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }

    res.status(500).json({
      success: false,
      error: {
        message: process.env.NODE_ENV === 'production' 
          ? 'Internal server error' 
          : error.message
      }
    });
  }
} 