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
        // NEW: Only validate podcast if it actually contains the episode
        if (episodeTitle) {
          if (episodeResult?.validatedEpisode) {
            // Both podcast and episode found - high confidence
            confidence += 0.6;
            validated = true;
            logger.info(`Podcast validation SUCCESS: "${podcastTitle}" → "${podcastResult.validatedPodcast.title}" (episode found: "${episodeTitle}" → "${episodeResult.validatedEpisode.title}")`);
          } else {
            // Podcast found but episode not found - this might be a platform name
            logger.info(`Podcast validation FAILED: "${podcastTitle}" → "${podcastResult.validatedPodcast.title}" but episode "${episodeTitle}" not found in this podcast`);
            // Don't validate the podcast if we can't find the episode
            podcastResult.validatedPodcast = null;
          }
        } else {
          // No episode title provided, just validate the podcast
          confidence += 0.6;
          validated = true;
          logger.info(`Podcast validation SUCCESS: "${podcastTitle}" → "${podcastResult.validatedPodcast.title}" (no episode title provided)`);
        }
      } else {
        logger.info(`Podcast validation FAILED: "${podcastTitle}" not found in Apple Podcasts`);
      }

      if (episodeResult?.validatedEpisode) {
        confidence += 0.4;
        logger.info(`Episode validation SUCCESS: "${episodeTitle}" → "${episodeResult.validatedEpisode.title}" (confidence: ${episodeResult.validatedEpisode.confidence})`);
      } else if (episodeTitle && podcastResult?.validatedPodcast) {
        logger.info(`Episode validation FAILED: "${episodeTitle}" not found in podcast "${podcastResult.validatedPodcast.title}"`);
      }

      logger.info(`Final validation result: validated=${validated}, confidence=${confidence.toFixed(3)}`);

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

      logger.info(`Searching for podcast: "${podcastTitle}" with URL: ${url}`);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];

      logger.info(`Apple Podcasts search returned ${results.length} results for "${podcastTitle}":`);
      results.forEach((result, index) => {
        logger.info(`  ${index + 1}. "${result.collectionName}" by ${result.artistName} (similarity: ${this.calculateSimilarity(podcastTitle, result.collectionName).toFixed(3)})`);
      });

      if (results.length === 0) {
        logger.info(`No results found for "${podcastTitle}"`);
        return {
          validatedPodcast: null,
          suggestions: []
        };
      }

      // Find the best match
      const bestMatch = this.findBestMatch(podcastTitle, results);
      
      logger.info(`Best match for "${podcastTitle}": "${bestMatch?.result.collectionName}" (similarity: ${bestMatch?.similarity.toFixed(3)})`);
      
      if (bestMatch && bestMatch.similarity > 0.7) {
        logger.info(`Validating podcast "${podcastTitle}" as "${bestMatch.result.collectionName}" (similarity: ${bestMatch.similarity.toFixed(3)} >= 0.7)`);
        return {
          validatedPodcast: {
            id: bestMatch.result.collectionId,
            title: bestMatch.result.collectionName,
            artist: bestMatch.result.artistName,
            feedUrl: bestMatch.result.feedUrl,
            confidence: bestMatch.similarity
          },
          suggestions: results.slice(0, 3).map(r => ({
            title: r.collectionName,
            artist: r.artistName,
            similarity: this.calculateSimilarity(podcastTitle, r.collectionName)
          }))
        };
      }

      logger.info(`Podcast "${podcastTitle}" validation failed (similarity: ${bestMatch?.similarity.toFixed(3)} < 0.7)`);
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

      // Find the best match with improved logic for truncated titles
      const bestMatch = this.findBestMatch(episodeTitle, results);
      
      // NEW: Lower threshold for episode validation to handle truncated titles
      // Also check for substring matches which are common with truncated episode titles
      const threshold = 0.4; // Lowered from 0.6
      
      if (bestMatch && bestMatch.similarity > threshold) {
        return {
          validatedEpisode: {
            id: bestMatch.result.trackId,
            title: bestMatch.result.trackName,
            description: bestMatch.result.description,
            duration: bestMatch.result.trackTimeMillis,
            confidence: bestMatch.similarity
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
    
    // NEW: Prioritize substring matches (common with truncated episode titles)
    if (s1.includes(s2) || s2.includes(s1)) {
      // Calculate how much of the longer string is covered
      const longer = s1.length > s2.length ? s1 : s2;
      const shorter = s1.length > s2.length ? s2 : s1;
      const coverage = shorter.length / longer.length;
      
      // Higher score for better coverage
      return 0.8 + (coverage * 0.2); // 0.8 to 1.0 range
    }
    
    // NEW: Check for partial word matches (handles truncated words)
    const words1 = s1.split(/\s+/);
    const words2 = s2.split(/\s+/);
    
    let partialWordMatches = 0;
    let exactWordMatches = 0;
    
    for (const word1 of words1) {
      for (const word2 of words2) {
        if (word1 === word2) {
          exactWordMatches++;
        } else if (word1.length >= 3 && word2.length >= 3) {
          // Check for partial word matches (e.g., "Hidden" matches "Hidden Brain")
          if (word1.startsWith(word2) || word2.startsWith(word1)) {
            partialWordMatches += 0.5; // Partial match gets half credit
          }
        }
      }
    }
    
    // Calculate similarity with partial word support
    const totalMatches = exactWordMatches + partialWordMatches;
    const totalWords = Math.max(words1.length, words2.length);
    
    if (totalWords === 0) return 0;
    
    const wordSimilarity = totalMatches / totalWords;
    
    // NEW: Boost score for partial matches when we have some exact matches
    if (exactWordMatches > 0 && partialWordMatches > 0) {
      return Math.min(1, wordSimilarity + 0.1); // Small boost for mixed matches
    }
    
    return wordSimilarity;
  }
}

module.exports = new ApplePodcastsService(); 