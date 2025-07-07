const axios = require('axios');
const xml2js = require('xml2js');
const logger = require('../utils/logger');

class PodcastService {
  constructor() {
    this.parser = new xml2js.Parser();
  }

  async getPodcastRssFeed(podcastId) {
    try {
      // First get podcast info from iTunes API to get the RSS feed URL
      const response = await axios.get('https://itunes.apple.com/lookup', {
        params: {
          id: podcastId,
          media: 'podcast',
          entity: 'podcast'
        }
      });

      const podcast = response.data.results?.[0];
      if (!podcast || !podcast.feedUrl) {
        throw new Error('Podcast RSS feed URL not found');
      }

      logger.info(`Found RSS feed URL for podcast ${podcastId}: ${podcast.feedUrl}`);
      return podcast.feedUrl;
    } catch (error) {
      logger.error('Error getting podcast RSS feed URL:', error);
      throw error;
    }
  }

  async getEpisodeAudioUrl(podcastId, episodeTitle) {
    try {
      // Get RSS feed URL
      const rssFeedUrl = await this.getPodcastRssFeed(podcastId);
      
      // Fetch RSS feed
      logger.info(`Fetching RSS feed: ${rssFeedUrl}`);
      const rssResponse = await axios.get(rssFeedUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'PodQuote/1.0'
        }
      });

      // Parse RSS XML
      const feedData = await this.parser.parseStringPromise(rssResponse.data);
      const items = feedData?.rss?.channel?.[0]?.item || [];
      
      logger.info(`Found ${items.length} episodes in RSS feed`);

      // Find matching episode
      for (const item of items) {
        const title = item.title?.[0] || '';
        const enclosure = item.enclosure?.[0];
        
        // Check if this episode matches the title
        if (this.isEpisodeMatch(episodeTitle, title) && enclosure?.$.url) {
          logger.info(`Found matching episode: "${title}"`);
          logger.info(`Audio URL: ${enclosure.$.url}`);
          
          return {
            audioUrl: enclosure.$.url,
            episodeTitle: title,
            duration: item['itunes:duration']?.[0] || null,
            pubDate: item.pubDate?.[0] || null
          };
        }
      }

      // If no exact match, try fuzzy matching
      const fuzzyMatches = items
        .map(item => ({
          title: item.title?.[0] || '',
          audioUrl: item.enclosure?.[0]?.$.url,
          duration: item['itunes:duration']?.[0] || null,
          pubDate: item.pubDate?.[0] || null,
          similarity: this.calculateSimilarity(episodeTitle, item.title?.[0] || '')
        }))
        .filter(item => item.audioUrl && item.similarity > 0.6)
        .sort((a, b) => b.similarity - a.similarity);

      if (fuzzyMatches.length > 0) {
        const bestMatch = fuzzyMatches[0];
        logger.info(`Found fuzzy match: "${bestMatch.title}" (similarity: ${bestMatch.similarity})`);
        return {
          audioUrl: bestMatch.audioUrl,
          episodeTitle: bestMatch.title,
          duration: bestMatch.duration,
          pubDate: bestMatch.pubDate
        };
      }

      throw new Error(`No audio URL found for episode: ${episodeTitle}`);
    } catch (error) {
      logger.error('Error getting episode audio URL:', error);
      throw error;
    }
  }

  isEpisodeMatch(searchTitle, feedTitle) {
    if (!searchTitle || !feedTitle) return false;
    
    const normalize = (str) => str.toLowerCase().trim().replace(/[^\w\s]/g, '');
    const normalizedSearch = normalize(searchTitle);
    const normalizedFeed = normalize(feedTitle);
    
    // Exact match
    if (normalizedSearch === normalizedFeed) return true;
    
    // Check if search title is contained in feed title
    if (normalizedFeed.includes(normalizedSearch)) return true;
    
    // Check if feed title is contained in search title
    if (normalizedSearch.includes(normalizedFeed)) return true;
    
    return false;
  }

  calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    
    // Exact match
    if (s1 === s2) return 1.0;
    
    // Levenshtein distance
    const distance = this.levenshteinDistance(s1, s2);
    const maxLength = Math.max(s1.length, s2.length);
    return 1 - (distance / maxLength);
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    // Initialize matrix
    for (let i = 0; i <= str1.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= str2.length; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= str1.length; i++) {
      for (let j = 1; j <= str2.length; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,     // deletion
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return matrix[str1.length][str2.length];
  }
}

module.exports = new PodcastService(); 