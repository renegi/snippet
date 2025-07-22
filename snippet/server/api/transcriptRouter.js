const express = require('express');
const assemblyService = require('../services/assemblyService');

const router = express.Router();

// Generate transcript from podcast info and time range
router.post('/', async (req, res) => {
  try {
    const { podcastInfo, timestamp, timeRange } = req.body;

    if (!podcastInfo?.validatedPodcast?.id) {
      return res.status(400).json({ error: 'Valid podcast ID is required' });
    }

    console.log('Transcript request:', {
      podcastId: podcastInfo.validatedPodcast.id,
      episodeTitle: podcastInfo.validatedEpisode?.title,
      timestamp,
      timeRange
    });

    // Try to get episode audio URL from Apple Podcasts
    // For now, return a mock transcript since we need RSS feeds or direct audio URLs
    const mockTranscript = {
      text: `This is where the transcript would appear for "${podcastInfo.validatedEpisode?.title || 'Unknown Episode'}" from "${podcastInfo.validatedPodcast.title}" at timestamp ${timestamp}. The transcript would cover ${timeRange.before} seconds before to ${timeRange.after} seconds after the selected time.`,
      confidence: 0.95,
      words: [],
      episode: {
        title: podcastInfo.validatedEpisode?.title,
        artworkUrl: podcastInfo.validatedEpisode?.artworkUrl || podcastInfo.validatedPodcast?.artworkUrl
      },
      timeRange: {
        start: timestamp ? `${timestamp} - ${timeRange.before}s` : '0:00',
        end: timestamp ? `${timestamp} + ${timeRange.after}s` : '0:45'
      }
    };

    res.json({ 
      success: true,
      transcript: mockTranscript.text,
      confidence: mockTranscript.confidence,
      episode: mockTranscript.episode,
      timeRange: mockTranscript.timeRange,
      podcastId: podcastInfo.validatedPodcast.id,
      episodeTitle: podcastInfo.validatedEpisode?.title,
      timestamp,
      requestedTimeRange: timeRange
    });
  } catch (error) {
    console.error('Transcript generation error:', error);
    res.status(500).json({ error: 'Failed to generate transcript' });
  }
});

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