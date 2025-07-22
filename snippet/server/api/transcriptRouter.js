const express = require('express');
const assemblyService = require('../services/assemblyService');
const applePodcastsService = require('../services/applePodcastsService');
const logger = require('../utils/logger');

const router = express.Router();

// Generate transcript from podcast info and time range
router.post('/', async (req, res) => {
  try {
    const { podcastInfo, timestamp, timeRange } = req.body;

    if (!podcastInfo?.validatedPodcast?.id) {
      return res.status(400).json({ error: 'Valid podcast ID is required' });
    }

    logger.info('Transcript request:', {
      podcastId: podcastInfo.validatedPodcast.id,
      episodeTitle: podcastInfo.validatedEpisode?.title,
      timestamp,
      timeRange
    });

    // Step 1: Try to get the podcast RSS feed URL
    let audioUrl = null;
    
    try {
      // Get detailed podcast information including RSS feed
      const podcastDetails = await applePodcastsService.getPodcastDetails(podcastInfo.validatedPodcast.id);
      
      if (podcastDetails?.feedUrl) {
        logger.info(`Found RSS feed URL: ${podcastDetails.feedUrl}`);
        
        // Step 2: Parse RSS feed to find the specific episode audio URL
        const episodeAudioUrl = await applePodcastsService.getEpisodeAudioUrl(
          podcastDetails.feedUrl,
          podcastInfo.validatedEpisode?.title
        );
        
        if (episodeAudioUrl) {
          audioUrl = episodeAudioUrl;
          logger.info(`Found episode audio URL: ${audioUrl.substring(0, 100)}...`);
        }
      }
    } catch (error) {
      logger.warn('Failed to get audio URL from RSS feed:', error.message);
    }

    // Step 3: Generate transcript using AssemblyAI
    if (audioUrl && timestamp) {
      try {
        logger.info('Calling AssemblyAI for transcript generation...');
        const transcriptResult = await assemblyService.getTranscript(audioUrl, timestamp, timeRange);
        
        logger.info('AssemblyAI transcript generation successful');
        
        return res.json({
          success: true,
          transcript: transcriptResult.text,
          confidence: transcriptResult.confidence,
          words: transcriptResult.words || [],
          utterances: transcriptResult.utterances || [],
          episode: {
            title: podcastInfo.validatedEpisode?.title,
            artworkUrl: podcastInfo.validatedEpisode?.artworkUrl || podcastInfo.validatedPodcast?.artworkUrl
          },
          timeRange: transcriptResult.calculatedTimeRange || {
            start: timestamp ? `${timestamp} - ${timeRange.before}s` : '0:00',
            end: timestamp ? `${timestamp} + ${timeRange.after}s` : '0:45'
          },
          podcastId: podcastInfo.validatedPodcast.id,
          episodeTitle: podcastInfo.validatedEpisode?.title,
          timestamp,
          requestedTimeRange: timeRange,
          audioUrl: audioUrl.substring(0, 100) + '...', // Partial URL for debugging
          source: 'assemblyai'
        });
      } catch (error) {
        logger.error('AssemblyAI transcript generation failed:', error);
        // Fall through to mock response
      }
    }

    // Fallback: Return enhanced mock transcript with explanation
    logger.info('Returning mock transcript (audio URL not available or AssemblyAI failed)');
    
    const mockReason = !audioUrl ? 'Audio URL not available' : 'AssemblyAI generation failed';
    
    res.json({ 
      success: true,
      transcript: `[MOCK TRANSCRIPT - ${mockReason}]\n\nThis is where the transcript would appear for "${podcastInfo.validatedEpisode?.title || 'Unknown Episode'}" from "${podcastInfo.validatedPodcast.title}" at timestamp ${timestamp}.\n\nThe transcript would cover ${timeRange.before} seconds before to ${timeRange.after} seconds after the selected time.\n\nTo get real transcripts, the system needs:\n1. Access to the podcast's RSS feed\n2. Direct audio file URLs\n3. Working AssemblyAI integration`,
      confidence: 0.0,
      words: [],
      utterances: [],
      episode: {
        title: podcastInfo.validatedEpisode?.title,
        artworkUrl: podcastInfo.validatedEpisode?.artworkUrl || podcastInfo.validatedPodcast?.artworkUrl
      },
      timeRange: {
        start: timestamp ? `${timestamp} - ${timeRange.before}s` : '0:00',
        end: timestamp ? `${timestamp} + ${timeRange.after}s` : '0:45'
      },
      podcastId: podcastInfo.validatedPodcast.id,
      episodeTitle: podcastInfo.validatedEpisode?.title,
      timestamp,
      requestedTimeRange: timeRange,
      source: 'mock',
      mockReason
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