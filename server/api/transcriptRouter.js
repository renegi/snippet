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

    // Step 1: Get the audio URL from Apple's episode data (fast, matches by ID or exact title)
    let audioUrl = await applePodcastsService.getEpisodeAudioUrlFromApple(
      podcastInfo.validatedPodcast.id,
      podcastInfo.validatedEpisode
    );

    // Step 2: Fall back to the podcast's RSS feed (covers episodes older than Apple's 200 most recent)
    if (!audioUrl) {
      try {
        const podcastDetails = await applePodcastsService.getPodcastDetails(podcastInfo.validatedPodcast.id);
        if (podcastDetails?.feedUrl) {
          audioUrl = await applePodcastsService.getEpisodeAudioUrl(
            podcastDetails.feedUrl,
            podcastInfo.validatedEpisode?.title
          );
        }
      } catch (error) {
        logger.warn('Failed to get audio URL from RSS feed:', error.message);
      }
    }

    if (audioUrl) {
      logger.info(`Found episode audio URL: ${audioUrl.substring(0, 100)}...`);
    }

    if (!audioUrl) {
      logger.warn('No audio URL found for episode', { episodeTitle: podcastInfo.validatedEpisode?.title });
      return res.status(422).json({
        success: false,
        error: `Couldn't find the audio file for "${podcastInfo.validatedEpisode?.title || 'this episode'}"`
      });
    }

    if (!timestamp) {
      return res.status(400).json({ success: false, error: 'Timestamp is required' });
    }

    // Step 3: Generate transcript using AssemblyAI
    let transcriptResult;
    try {
      logger.info('Calling AssemblyAI for transcript generation...');
      transcriptResult = await assemblyService.getTranscript(audioUrl, timestamp, timeRange);
      logger.info('AssemblyAI transcript generation successful');
    } catch (error) {
      logger.error('AssemblyAI transcript generation failed:', { error: error.message });
      return res.status(502).json({
        success: false,
        error: `Transcription failed for "${podcastInfo.validatedEpisode?.title || 'this episode'}": ${error.message}`
      });
    }

    res.json({
      success: true,
      transcript: transcriptResult.text,
      confidence: transcriptResult.confidence,
      words: transcriptResult.words || [],
      utterances: transcriptResult.utterances || [],
      episode: {
        title: podcastInfo.validatedEpisode?.title,
        artworkUrl: podcastInfo.validatedEpisode?.artworkUrl || podcastInfo.validatedPodcast?.artworkUrl
      },
      timeRange: transcriptResult.calculatedTimeRange,
      podcastId: podcastInfo.validatedPodcast.id,
      episodeTitle: podcastInfo.validatedEpisode?.title,
      timestamp,
      requestedTimeRange: timeRange,
      source: 'assemblyai'
    });
  } catch (error) {
    logger.error('Transcript generation error:', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to generate transcript' });
  }
});

module.exports = router; 