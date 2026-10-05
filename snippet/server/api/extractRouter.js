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
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const startTime = Date.now();
      try {
        const podcastInfo = await visionService.extractText(file.buffer);

        logger.info(`Processed ${file.originalname} (${(file.size / 1024 / 1024).toFixed(2)}MB) in ${Date.now() - startTime}ms`, {
          podcastTitle: podcastInfo.podcastTitle,
          episodeTitle: podcastInfo.episodeTitle,
          timestamp: podcastInfo.timestamp,
          validated: podcastInfo.validation?.validated
        });

        results.push(podcastInfo);
      } catch (fileError) {
        logger.error(`Error processing ${file.originalname}:`, {
          error: fileError.message,
          processingTime: `${Date.now() - startTime}ms`
        });

        // Add error result instead of breaking the whole process
        results.push({
          error: true,
          message: `Failed to process ${file.originalname}: ${fileError.message}`,
          firstPass: { error: true },
          secondPass: { error: true }
        });
      }
    }

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
