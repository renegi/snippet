require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { app, errorHandler } = require('./app');
const logger = require('./utils/logger');

const port = process.env.PORT || 3001;
const buildPath = path.join(__dirname, '../client/build');
const indexPath = path.join(buildPath, 'index.html');

// Serve the React build (on Vercel, static files are served by the platform instead)
app.use(express.static(buildPath));

app.get('*', (req, res) => {
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Client build not found. Run `npm run build` from the repo root.');
  }
});

// Error handling (must be last)
app.use(errorHandler);

app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
});
