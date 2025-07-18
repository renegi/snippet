const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const visionService = require('../services/visionService');
const logger = require('../utils/logger');

router.post('/', upload.array('screenshots', 5), async (req, res, next) => {
  try {
    logger.info('📱 Mobile Debug: Extract request received', {
      filesCount: req.files?.length || 0,
      userAgent: req.headers['user-agent'],
      isMobile: /iPhone|iPad|iPod|Android/i.test(req.headers['user-agent'] || ''),
      contentLength: req.headers['content-length']
    });

    if (!req.files || req.files.length === 0) {
      logger.warn('📱 Mobile Debug: No files uploaded');
      return res.status(400).json({
        success: false,
        error: {
          message: 'No files uploaded'
        }
      });
    }

    logger.info('📱 Mobile Debug: Files received', req.files.map((file, index) => ({
      index,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      sizeInMB: (file.size / 1024 / 1024).toFixed(2) + 'MB',
      path: file.path
    })));

    const results = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      logger.info(`📱 Mobile Debug: Processing file ${i + 1}/${req.files.length}: ${file.originalname}`);
      
      const startTime = Date.now();
      try {
        // Check file size and add warning for large mobile images
        const fileSizeMB = file.size / 1024 / 1024;
        if (fileSizeMB > 5) {
          logger.warn(`📱 Mobile Debug: Large file detected (${fileSizeMB.toFixed(2)}MB) - ${file.originalname}`);
        }
        
      const podcastInfo = await visionService.extractText(file.path);
        const endTime = Date.now();
        
        logger.info(`📱 Mobile Debug: File ${i + 1} processed successfully`, {
          processingTime: `${endTime - startTime}ms`,
          podcastTitle: podcastInfo.firstPass?.podcastTitle || podcastInfo.secondPass?.podcastTitle,
          episodeTitle: podcastInfo.firstPass?.episodeTitle || podcastInfo.secondPass?.episodeTitle,
          timestamp: podcastInfo.firstPass?.timestamp || podcastInfo.secondPass?.timestamp,
          validated: podcastInfo.validation?.validated,
          player: podcastInfo.firstPass?.player || podcastInfo.secondPass?.player
        });
        
      results.push(podcastInfo);
      } catch (fileError) {
        const endTime = Date.now();
        logger.error(`📱 Mobile Debug: Error processing file ${i + 1}:`, {
          file: file.originalname,
          error: fileError.message,
          processingTime: `${endTime - startTime}ms`,
          stack: fileError.stack
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

    logger.info('📱 Mobile Debug: All files processed', {
      totalFiles: req.files.length,
      successfulFiles: results.filter(r => !r.error).length,
      failedFiles: results.filter(r => r.error).length
    });

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    logger.error('📱 Mobile Debug: Extract router error:', {
      error: error.message,
      stack: error.stack,
      userAgent: req.headers['user-agent']
    });
    next(error);
  }
});

module.exports = router; 