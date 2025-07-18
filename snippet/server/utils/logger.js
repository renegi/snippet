const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Simple logger implementation
const logger = {
  info: (message, data = {}) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
      level: 'INFO',
      timestamp,
      message,
      ...data
    };
    console.log(`[INFO] ${timestamp}: ${message}`, data);
  },

  error: (message, data = {}) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
      level: 'ERROR',
      timestamp,
      message,
      ...data
    };
    console.error(`[ERROR] ${timestamp}: ${message}`, data);
  },

  warn: (message, data = {}) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
      level: 'WARN',
      timestamp,
      message,
      ...data
    };
    console.warn(`[WARN] ${timestamp}: ${message}`, data);
  },

  debug: (message, data = {}) => {
    if (process.env.NODE_ENV === 'development') {
      const timestamp = new Date().toISOString();
      const logEntry = {
        level: 'DEBUG',
        timestamp,
        message,
        ...data
      };
      console.log(`[DEBUG] ${timestamp}: ${message}`, data);
    }
  }
};

module.exports = logger; 