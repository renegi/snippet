const express = require('express');
const router = express.Router();
const assemblyService = require('../services/assemblyService');
const podcastService = require('../services/podcastService');
const transcriptCorrectionService = require('../services/transcriptCorrectionService');
const logger = require('../utils/logger');

router.post('/', async (req, res, next) => {
  try {
    const { podcastInfo, timestamp, timeRange } = req.body;

    if (!podcastInfo || !timeRange) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Missing required parameters: podcastInfo and timeRange are required'
        }
      });
    }

    // Validate required podcastInfo fields
    const { validatedPodcast, validatedEpisode } = podcastInfo;
    if (!validatedPodcast?.id || !validatedEpisode?.title || !timestamp) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid podcastInfo: missing validated podcast ID, episode title, or timestamp'
        }
      });
    }

    logger.info('Processing transcript request:', {
      podcastId: validatedPodcast.id,
      podcastTitle: validatedPodcast.title,
      episodeTitle: validatedEpisode.title,
      episodeId: validatedEpisode.id,
      timestamp,
      timeRange
    });

    // Get the audio URL for the episode
    const episodeAudio = await podcastService.getEpisodeAudioUrl(
      validatedPodcast.id,
      validatedEpisode.title
    );

    logger.info('Retrieved episode audio info:', {
      audioUrl: episodeAudio.audioUrl.substring(0, 100) + '...',
      duration: episodeAudio.duration,
      pubDate: episodeAudio.pubDate
    });

    // Get transcript using AssemblyAI
    const transcript = await assemblyService.getTranscript(
      episodeAudio.audioUrl,
      timestamp,
      timeRange
    );

    logger.info('AssemblyAI transcript completed:', {
      textLength: transcript.text?.length,
      confidence: transcript.confidence,
      wordCount: transcript.words?.length
    });

    // Apply AI-powered transcript correction
    let correctedTranscript = null;
    try {
      const context = {
        podcast: {
          title: validatedPodcast.title,
          id: validatedPodcast.id
        },
        episode: {
          title: episodeAudio.episodeTitle,
          duration: episodeAudio.duration
        }
      };

      correctedTranscript = await transcriptCorrectionService.correctTranscript(
        transcript.text,
        context,
        transcript.words || []
      );

      logger.info('Transcript correction completed:', {
        corrections: correctedTranscript.corrections?.length || 0,
        confidence: correctedTranscript.confidence,
        improvements: correctedTranscript.improvements
      });

    } catch (correctionError) {
      logger.warn('Transcript correction failed, using original:', correctionError.message);
      // Fall back to basic corrections if AI correction fails
      const basicCorrected = transcriptCorrectionService.applyBasicCorrections(transcript.text);
      correctedTranscript = {
        originalText: transcript.text,
        correctedText: basicCorrected.correctedText,
        corrections: basicCorrected.corrections || [],
        confidence: 0.8,
        improvements: { punctuation: 0, spelling: 0, grammar: 0, terminology: 0, sentence_flow: 0 },
        correctionTypes: basicCorrected.correctionTypes || [],
        fallback: true,
        error: 'AI correction failed, basic corrections applied: ' + correctionError.message,
        aiCorrected: false
      };
    }

    // Combine results
    const result = {
      // Original transcript data
      text: transcript.text,
      confidence: transcript.confidence,
      words: transcript.words,
      utterances: transcript.utterances,
      timeRange: transcript.timeRange,
      audioUrl: transcript.audioUrl,
      
      // Corrected transcript data
      correctedTranscript: correctedTranscript,
      
      // Episode and podcast metadata
      episode: {
        title: episodeAudio.episodeTitle,
        duration: episodeAudio.duration,
        pubDate: episodeAudio.pubDate,
        id: validatedEpisode.id
      },
      podcast: {
        title: validatedPodcast.title,
        id: validatedPodcast.id
      }
    };

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error getting transcript:', error);
    
    // Return more specific error messages
    let errorMessage = 'Failed to get transcript';
    if (error.message.includes('RSS feed')) {
      errorMessage = 'Could not access podcast RSS feed';
    } else if (error.message.includes('No audio URL found')) {
      errorMessage = 'Could not find audio file for this episode';
    } else if (error.message.includes('Transcription failed')) {
      errorMessage = 'Audio transcription failed';
    }

    res.status(500).json({
      success: false,
      error: {
        message: errorMessage,
        details: error.message
      }
    });
  }
});

module.exports = router; 