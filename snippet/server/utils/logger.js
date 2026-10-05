// Simple logger implementation
const logger = {
  info: (message, data = {}) => {
    const timestamp = new Date().toISOString();
    console.log(`[INFO] ${timestamp}: ${message}`, data);
  },

  error: (message, data = {}) => {
    const timestamp = new Date().toISOString();
    console.error(`[ERROR] ${timestamp}: ${message}`, data);
  },

  warn: (message, data = {}) => {
    const timestamp = new Date().toISOString();
    console.warn(`[WARN] ${timestamp}: ${message}`, data);
  },

  debug: (message, data = {}) => {
    if (process.env.NODE_ENV === 'development') {
      const timestamp = new Date().toISOString();
      console.log(`[DEBUG] ${timestamp}: ${message}`, data);
    }
  }
};

module.exports = logger; 