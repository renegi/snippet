const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const visionService = require('../services/visionService');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'screenshots-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Extract text from uploaded screenshots
router.post('/text', upload.array('screenshots', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No screenshots uploaded' });
    }

    const results = [];
    
    for (const file of req.files) {
      try {
        const extractedData = await visionService.extractTextFromImage(file.path);
        results.push({
          filename: file.filename,
          timestamp: extractedData.timestamp,
          title: extractedData.title,
          episode: extractedData.episode
        });
      } catch (error) {
        console.error(`Error processing ${file.filename}:`, error);
        results.push({
          filename: file.filename,
          error: error.message
        });
      }
    }

    res.json({ results });
  } catch (error) {
    console.error('Extract text error:', error);
    res.status(500).json({ error: 'Failed to extract text from screenshots' });
  }
});

module.exports = router; 