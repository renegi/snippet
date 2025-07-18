const express = require('express');
const assemblyService = require('../services/assemblyService');

const router = express.Router();

// Generate transcript from audio URL
router.post('/generate', async (req, res) => {
  try {
    const { audioUrl, startTime, endTime } = req.body;

    if (!audioUrl) {
      return res.status(400).json({ error: 'Audio URL is required' });
    }

    const transcript = await assemblyService.generateTranscript(audioUrl, startTime, endTime);
    
    res.json({ 
      transcript,
      startTime,
      endTime,
      audioUrl
    });
  } catch (error) {
    console.error('Transcript generation error:', error);
    res.status(500).json({ error: 'Failed to generate transcript' });
  }
});

// Get transcript status
router.get('/status/:transcriptId', async (req, res) => {
  try {
    const { transcriptId } = req.params;
    const status = await assemblyService.getTranscriptStatus(transcriptId);
    
    res.json({ status });
  } catch (error) {
    console.error('Transcript status error:', error);
    res.status(500).json({ error: 'Failed to get transcript status' });
  }
});

module.exports = router; 