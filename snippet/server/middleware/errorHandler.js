const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  // Log the error
  logger.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  // Default error response
  const errorResponse = {
    error: true,
    message: isDevelopment ? err.message : 'Internal server error',
    ...(isDevelopment && { stack: err.stack })
  };

  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      ...errorResponse,
      message: 'Validation error',
      details: err.details
    });
  }

  if (err.name === 'MulterError') {
    return res.status(400).json({
      ...errorResponse,
      message: 'File upload error',
      details: err.message
    });
  }

  // Default 500 error
  res.status(500).json(errorResponse);
};

module.exports = { errorHandler }; 