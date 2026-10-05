// Local development server for the API (the React app runs separately via Vite).
// On Vercel, the same Express app runs as a serverless function (api/index.js).
require('dotenv').config();
const { app, errorHandler } = require('./app');
const logger = require('./utils/logger');

const port = process.env.PORT || 3001;

// Error handling (must be last)
app.use(errorHandler);

app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
});
