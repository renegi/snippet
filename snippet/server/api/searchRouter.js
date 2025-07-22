const express = require('express');
const applePodcastsService = require('../services/applePodcastsService');
const logger = require('../utils/logger');

const router = express.Router();

// Search podcasts
router.post('/search-podcasts', async (req, res) => {
  try {
    const { searchTerm } = req.body;
    
    if (!searchTerm || searchTerm.length < 2) {
      return res.json({ podcasts: [] });
    }

    logger.info(`Searching podcasts for term: "${searchTerm}"`);
    
    const searchResult = await applePodcastsService.searchMultiplePodcasts(searchTerm);
    
    res.json({ podcasts: searchResult.podcasts || [] });
  } catch (error) {
    logger.error('Error searching podcasts:', error);
    res.status(500).json({ error: 'Failed to search podcasts' });
  }
});

// Search episodes for a specific podcast
router.post('/search-episodes', async (req, res) => {
  try {
    const { podcastId, searchTerm } = req.body;
    
    if (!podcastId || !searchTerm || searchTerm.length < 2) {
      return res.json({ episodes: [] });
    }

    logger.info(`Searching episodes for podcast ${podcastId} with term: "${searchTerm}"`);
    
    // Use the new searchMultipleEpisodes method
    const searchResult = await applePodcastsService.searchMultipleEpisodes(podcastId, searchTerm);
    
    res.json({ episodes: searchResult.episodes || [] });
  } catch (error) {
    logger.error('Error searching episodes:', error);
    res.status(500).json({ error: 'Failed to search episodes' });
  }
});

module.exports = router; 