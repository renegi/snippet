const logger = require('../utils/logger');

class ApplePodcastsService {
  constructor() {
    this.baseUrl = 'https://itunes.apple.com';
  }

  async validatePodcastInfo(podcastTitle, episodeTitle) {
    try {
      logger.info('Validating podcast info with Apple Podcasts API', {
        podcastTitle,
        episodeTitle
      });

      if (!podcastTitle && !episodeTitle) {
        return {
          validated: false,
          confidence: 0,
          error: 'No podcast or episode title provided'
        };
      }

      // Search for podcast first
      let podcastResult = null;
      if (podcastTitle) {
        podcastResult = await this.searchPodcast(podcastTitle);
      }

      // Search for episode if we have episode title
      let episodeResult = null;
      if (episodeTitle && podcastResult?.validatedPodcast) {
        episodeResult = await this.searchEpisode(episodeTitle, podcastResult.validatedPodcast.id);
      }

      // Calculate confidence based on results
      let confidence = 0;
      let validated = false;

      if (podcastResult?.validatedPodcast) {
        confidence += 0.6;
        validated = true;
      }

      if (episodeResult?.validatedEpisode) {
        confidence += 0.4;
      }

      return {
        validated,
        confidence,
        validatedPodcast: podcastResult?.validatedPodcast || null,
        validatedEpisode: episodeResult?.validatedEpisode || null,
        suggestions: podcastResult?.suggestions || []
      };

    } catch (error) {
      logger.error('Error validating podcast info:', error);
      return {
        validated: false,
        confidence: 0,
        error: error.message
      };
    }
  }

  async searchPodcast(podcastTitle) {
    try {
      const searchTerm = encodeURIComponent(podcastTitle);
      const url = `${this.baseUrl}/search?term=${searchTerm}&entity=podcast&limit=5`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];

      if (results.length === 0) {
        return {
          validatedPodcast: null,
          suggestions: []
        };
      }

      // Find the best match
      const bestMatch = this.findBestMatch(podcastTitle, results);
      
      if (bestMatch && bestMatch.similarity > 0.7) {
        return {
          validatedPodcast: {
            id: bestMatch.result.collectionId,
            title: bestMatch.result.collectionName,
            artist: bestMatch.result.artistName,
            feedUrl: bestMatch.result.feedUrl
          },
          suggestions: results.slice(0, 3).map(r => ({
            title: r.collectionName,
            artist: r.artistName,
            similarity: this.calculateSimilarity(podcastTitle, r.collectionName)
          }))
        };
      }

      return {
        validatedPodcast: null,
        suggestions: results.slice(0, 3).map(r => ({
          title: r.collectionName,
          artist: r.artistName,
          similarity: this.calculateSimilarity(podcastTitle, r.collectionName)
        }))
      };

    } catch (error) {
      logger.error('Error searching podcast:', error);
      return {
        validatedPodcast: null,
        suggestions: [],
        error: error.message
      };
    }
  }

  async searchEpisode(episodeTitle, podcastId) {
    try {
      if (!podcastId) {
        return { validatedEpisode: null };
      }

      const searchTerm = encodeURIComponent(episodeTitle);
      const url = `${this.baseUrl}/lookup?id=${podcastId}&entity=podcastEpisode&limit=50`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];

      if (results.length === 0) {
        return { validatedEpisode: null };
      }

      // Find the best match
      const bestMatch = this.findBestMatch(episodeTitle, results);
      
      if (bestMatch && bestMatch.similarity > 0.6) {
        return {
          validatedEpisode: {
            id: bestMatch.result.trackId,
            title: bestMatch.result.trackName,
            description: bestMatch.result.description,
            duration: bestMatch.result.trackTimeMillis
          }
        };
      }

      return { validatedEpisode: null };

    } catch (error) {
      logger.error('Error searching episode:', error);
      return {
        validatedEpisode: null,
        error: error.message
      };
    }
  }

  findBestMatch(searchTerm, results) {
    let bestMatch = null;
    let bestSimilarity = 0;

    for (const result of results) {
      const title = result.collectionName || result.trackName || '';
      const similarity = this.calculateSimilarity(searchTerm, title);
      
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = { result, similarity };
      }
    }

    return bestMatch;
  }

  calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const normalize = (str) => str.toLowerCase().trim().replace(/[^\w\s]/g, '');
    const s1 = normalize(str1);
    const s2 = normalize(str2);
    
    if (s1 === s2) return 1;
    if (s1.includes(s2) || s2.includes(s1)) return 0.9;
    
    // Simple word-based similarity
    const words1 = s1.split(/\s+/);
    const words2 = s2.split(/\s+/);
    
    const commonWords = words1.filter(word => words2.includes(word));
    const totalWords = Math.max(words1.length, words2.length);
    
    return commonWords.length / totalWords;
  }
}

module.exports = new ApplePodcastsService(); 