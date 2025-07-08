// Import your existing services
const AssemblyService = require('../podquote/server/services/assemblyService');
const ApplePodcastsService = require('../podquote/server/services/applePodcastsService');
const logger = require('../podquote/server/utils/logger');

const assemblyService = new AssemblyService();
const applePodcastsService = new ApplePodcastsService();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: { message: 'Method not allowed' }
    });
  }

  try {
    const { podcastInfo, timestamp, timeRange } = req.body;

    if (!podcastInfo || !timestamp) {
      return res.status(400).json({
        success: false,
        error: { message: 'Missing required fields: podcastInfo and timestamp' }
      });
    }

    logger.info('Transcript request:', { podcastInfo, timestamp, timeRange });

    // Get the podcast and episode information
    const podcast = podcastInfo.validatedPodcast;
    const episode = podcastInfo.validatedEpisode;

    if (!podcast || !episode) {
      return res.status(400).json({
        success: false,
        error: { message: 'Podcast or episode information not found' }
      });
    }

    // Get the episode audio URL
    const audioUrl = await applePodcastsService.getEpisodeAudioUrl(episode.guid || episode.id);
    
    if (!audioUrl) {
      return res.status(404).json({
        success: false,
        error: { message: 'Audio URL not found for this episode' }
      });
    }

    // Get transcript from AssemblyAI
    const transcriptResult = await assemblyService.getTranscript(audioUrl, timestamp, timeRange);

    res.json({
      success: true,
      data: transcriptResult
    });

  } catch (error) {
    logger.error('Error getting transcript:', error);
    
    res.status(500).json({
      success: false,
      error: {
        message: process.env.NODE_ENV === 'production' 
          ? 'Internal server error' 
          : error.message
      }
    });
  }
} 