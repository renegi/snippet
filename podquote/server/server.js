require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { errorHandler } = require('./middleware/errorHandler');
const extractRouter = require('./api/extractRouter');
const transcriptRouter = require('./api/transcriptRouter');
const logger = require('./utils/logger');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/extract', extractRouter);
app.use('/api/transcript', transcriptRouter);

// Error handling
app.use(errorHandler);

// Start server
app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
}); 