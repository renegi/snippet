require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { errorHandler } = require('./middleware/errorHandler');
const extractRouter = require('./api/extractRouter');
const transcriptRouter = require('./api/transcriptRouter');
const logger = require('./utils/logger');

// Google Cloud credentials setup for Render deployment
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
  try {
    const credentialsPath = path.join(__dirname, 'google-credentials.json');
    const credentials = Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString('utf8');
    fs.writeFileSync(credentialsPath, credentials);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
    logger.info('Google Cloud credentials set up successfully');
  } catch (error) {
    logger.error('Error setting up Google Cloud credentials:', error);
  }
} else {
  logger.warn('GOOGLE_APPLICATION_CREDENTIALS_BASE64 not found, using default credentials');
}

const app = express();
const port = process.env.PORT || 3001;

// Debug: Log paths and check if build files exist
const buildPath = path.join(__dirname, '../client/build');
const indexPath = path.join(buildPath, 'index.html');

// Create uploads directory if it doesn't exist
const uploadsPath = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
  console.log('Created uploads directory:', uploadsPath);
}

console.log('=== DEBUG INFO ===');
console.log('Current working directory:', process.cwd());
console.log('__dirname:', __dirname);
console.log('Build path:', buildPath);
console.log('Index path:', indexPath);
console.log('Uploads path:', uploadsPath);
console.log('Build directory exists:', fs.existsSync(buildPath));
console.log('Index.html exists:', fs.existsSync(indexPath));
console.log('Uploads directory exists:', fs.existsSync(uploadsPath));

if (fs.existsSync(buildPath)) {
  console.log('Contents of build directory:', fs.readdirSync(buildPath));
} else {
  console.log('Build directory does not exist!');
  
  // Check parent directories
  console.log('Contents of server directory:', fs.readdirSync(__dirname));
  console.log('Contents of parent directory:', fs.readdirSync(path.join(__dirname, '..')));
}
console.log('==================');

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'PodQuote server is running',
    buildPath: buildPath,
    buildExists: fs.existsSync(buildPath),
    indexExists: fs.existsSync(indexPath),
    cwd: process.cwd()
  });
});

// Serve static files from React build
app.use(express.static(buildPath));

// API Routes
app.use('/api/extract', extractRouter);
app.use('/api/transcript', transcriptRouter);

// Serve React app for all other routes (React Router)
app.get('*', (req, res) => {
  console.log('Catch-all route hit for:', req.path);
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send(`
      <h1>Build files not found</h1>
      <p>Build path: ${buildPath}</p>
      <p>Index path: ${indexPath}</p>
      <p>Current working directory: ${process.cwd()}</p>
      <p>Server directory: ${__dirname}</p>
    `);
  }
});

// Error handling (must be last)
app.use(errorHandler);

// Start server
app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
});
