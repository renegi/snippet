// Info and warning logs are silenced in tests to keep test output readable
const quiet = process.env.NODE_ENV === 'test';
// Debug logs print in development, or anywhere with DEBUG_LOGS=true (e.g. on Vercel while investigating)
const debugEnabled = process.env.NODE_ENV === 'development' || process.env.DEBUG_LOGS === 'true';

// Simple logger implementation
const logger = {
  info: (message, data = {}) => {
    if (quiet) return;
    const timestamp = new Date().toISOString();
    console.log(`[INFO] ${timestamp}: ${message}`, data);
  },

  error: (message, data = {}) => {
    const timestamp = new Date().toISOString();
    console.error(`[ERROR] ${timestamp}: ${message}`, data);
  },

  warn: (message, data = {}) => {
    if (quiet) return;
    const timestamp = new Date().toISOString();
    console.warn(`[WARN] ${timestamp}: ${message}`, data);
  },

  debug: (message, data = {}) => {
    if (debugEnabled) {
      const timestamp = new Date().toISOString();
      console.log(`[DEBUG] ${timestamp}: ${message}`, data);
    }
  }
};

module.exports = logger; 