const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const visionService = require('../services/visionService');
const logger = require('../utils/logger');

router.post('/', upload.array('screenshots', 5), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'No files uploaded'
        }
      });
    }

    const results = [];
    for (const file of req.files) {
      const podcastInfo = await visionService.extractText(file.path);
      results.push(podcastInfo);
    }

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    logger.error('Error processing screenshots:', error);
    next(error);
  }
});

module.exports = router; 