const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  logger.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    userAgent: req.get('User-Agent'),
    body: req.body
  });

  // Google Vision API specific errors
  if (err.message.includes('GOOGLE_APPLICATION_CREDENTIALS')) {
    return res.status(500).json({
      success: false,
      error: {
        message: 'Google Vision API credentials not configured',
        type: 'CREDENTIALS_ERROR'
      }
    });
  }

  // File upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: {
        message: 'File size too large. Maximum size is 5MB.',
        type: 'FILE_SIZE_ERROR'
      }
    });
  }

  // Multer errors
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).json({
      success: false,
      error: {
        message: 'Too many files. Maximum is 5 files.',
        type: 'FILE_COUNT_ERROR'
      }
    });
  }

  // Default error
  res.status(500).json({
    success: false,
    error: {
      message: process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : err.message,
      type: 'SERVER_ERROR'
    }
  });
};

module.exports = { errorHandler }; 