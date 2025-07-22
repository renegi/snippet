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

      logger.info(`Apple Podcasts search returned ${results.length} results for "${podcastTitle}"`);

      if (results.length === 0) {
        logger.info(`No results found for "${podcastTitle}"`);
        return {
          validatedPodcast: null,
          suggestions: []
        };
      }

      // Find the best match
      const bestMatch = this.findBestMatch(podcastTitle, results);
      
      logger.info(`Best match for "${podcastTitle}": "${bestMatch?.result?.collectionName || 'none'}" (similarity: ${bestMatch?.similarity?.toFixed(3) || 'undefined'})`);
      
      if (bestMatch && bestMatch.similarity > 0.7) {
        logger.info(`Validating podcast "${podcastTitle}" as "${bestMatch.result.collectionName}" (similarity: ${bestMatch.similarity.toFixed(3)} >= 0.7)`);
        return {
          validatedPodcast: {
            id: bestMatch.result.collectionId,
            title: bestMatch.result.collectionName,
            artist: bestMatch.result.artistName,
            feedUrl: bestMatch.result.feedUrl,
            artworkUrl: bestMatch.result.artworkUrl100 || bestMatch.result.artworkUrl600,
            confidence: bestMatch.similarity
          },
          suggestions: results.slice(0, 3).map(r => ({
            title: r.collectionName,
            artist: r.artistName,
            similarity: this.calculateSimilarity(podcastTitle, r.collectionName)
          }))
        };
      }

      logger.info(`Podcast "${podcastTitle}" validation failed (similarity: ${bestMatch?.similarity?.toFixed(3) || 'undefined'} < 0.7)`);
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
      const url = `${this.baseUrl}/lookup?id=${podcastId}&entity=podcastEpisode&limit=200`;

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
      
      // NEW: Much lower threshold for episode validation to handle truncated titles
      // Also check for substring matches which are common with truncated episode titles
      const threshold = 0.2; // Lowered from 0.4 to handle more truncated titles
      
      if (bestMatch && bestMatch.similarity > threshold) {
        return {
          validatedEpisode: {
            id: bestMatch.result.trackId,
            title: bestMatch.result.trackName,
            description: bestMatch.result.description,
            duration: bestMatch.result.trackTimeMillis,
            artworkUrl: bestMatch.result.artworkUrl100 || bestMatch.result.artworkUrl600,
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

  // NEW: Add the missing searchEpisodes function
  async searchEpisodes(podcastId, episodeTitle) {
    try {
      logger.info(`Searching episodes for podcastId: ${podcastId}, episodeTitle: ${episodeTitle}`);
      
      if (!podcastId) {
        logger.info('No podcastId provided, returning empty episodes array');
        return { episodes: [] };
      }

      const url = `${this.baseUrl}/lookup?id=${podcastId}&entity=podcastEpisode&limit=200`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];

      logger.info(`Found ${results.length} episodes for podcast ${podcastId}`);

      // If episodeTitle is provided, filter and rank by similarity
      if (episodeTitle) {
        const rankedEpisodes = results
          .map(episode => ({
            ...episode,
            similarity: this.calculateSimilarity(episodeTitle, episode.trackName || '')
          }))
          .filter(episode => episode.similarity > 0.3) // Filter out very low matches
          .sort((a, b) => b.similarity - a.similarity);

        logger.info(`Filtered to ${rankedEpisodes.length} episodes matching "${episodeTitle}"`);
        return { episodes: rankedEpisodes };
      }

      // If no episodeTitle, return all episodes
      return { episodes: results };

    } catch (error) {
      logger.error('Error searching episodes:', error);
      return {
        episodes: [],
        error: error.message
      };
    }
  }

  findBestMatch(searchTerm, results) {
    let bestMatch = null;
    let bestSimilarity = 0;

    logger.info(`Finding best match for "${searchTerm}" among ${results.length} results`);

    for (const result of results) {
      const title = result.collectionName || result.trackName || '';
      const similarity = this.calculateSimilarity(searchTerm, title);
      
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = { result, similarity };
        // Only log when we find a new best match, and only if similarity is significant
        if (similarity > 0.1) {
          logger.info(`  → New best match: "${title}" (similarity: ${similarity.toFixed(3)})`);
        }
      }
    }

    // FIXED: Always return the best match, even if similarity is 0
    if (results.length > 0 && !bestMatch) {
      // If no match was found but we have results, use the first one with 0 similarity
      const firstResult = results[0];
      const title = firstResult.collectionName || firstResult.trackName || '';
      bestMatch = { result: firstResult, similarity: 0 };
      logger.info(`  → Using first result as fallback: "${title}" (similarity: 0.000)`);
    }

    if (bestMatch && bestMatch.similarity > 0.1) {
      logger.info(`Final best match: "${bestMatch.result.collectionName || bestMatch.result.trackName}" (similarity: ${bestMatch.similarity.toFixed(3)})`);
    }
    return bestMatch;
  }

  calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const normalize = (str) => str.toLowerCase().trim().replace(/[^\w\s]/g, '');
    const s1 = normalize(str1);
    const s2 = normalize(str2);
    
    if (s1 === s2) return 1;
    
    // PRIORITY 1: Exact substring matches (highest priority for truncated titles)
    if (s1.includes(s2) || s2.includes(s1)) {
      // Calculate how much of the longer string is covered
      const longer = s1.length > s2.length ? s1 : s2;
      const shorter = s1.length > s2.length ? s2 : s1;
      const coverage = shorter.length / longer.length;
      
      // Very high score for substring matches, especially when search term is shorter
      if (s1.length <= s2.length) {
        // Search term is shorter (likely truncated), give it very high priority
        // But check if this is a meaningful phrase match vs just word coincidence
        const searchWords = s1.split(/\s+/).filter(w => w.length > 0);
        const targetWords = s2.split(/\s+/).filter(w => w.length > 0);
        
        // If search term has multiple words, check if they appear as a phrase
        if (searchWords.length >= 2) {
          let hasPhraseMatch = false;
          for (let i = 0; i <= targetWords.length - searchWords.length; i++) {
            let phraseMatch = true;
            for (let j = 0; j < searchWords.length; j++) {
              if (searchWords[j] !== targetWords[i + j]) {
                phraseMatch = false;
                break;
              }
            }
            if (phraseMatch) {
              hasPhraseMatch = true;
              break;
            }
          }
          
          if (hasPhraseMatch) {
            // This is a meaningful phrase match, give it maximum priority
            let semanticBoost = 0;
            
            // Semantic boost for question marks (common in truncated titles)
            if (str1.includes('?') && str2.includes('?')) {
              semanticBoost += 0.002;
            }
            
            // Semantic boost for longer titles (more likely to be the full title)
            if (str2.length > str1.length * 2) {
              semanticBoost += 0.001;
            }
            
            // Semantic boost for titles that start with the search phrase
            const normalizedSearch = s1.trim();
            const normalizedTarget = s2.trim();
            if (normalizedTarget.startsWith(normalizedSearch) || 
                normalizedTarget.includes(' ' + normalizedSearch)) {
              semanticBoost += 0.001;
            }
            
            return Math.min(1, 0.995 + (coverage * 0.005) + semanticBoost);
          }
        }
        
        // Regular substring match
        return 0.98 + (coverage * 0.02); // 0.98 to 1.0 range
      } else {
        // Search term is longer, still good but not as high priority
        return 0.8 + (coverage * 0.2); // 0.8 to 1.0 range
      }
    }
    
    // PRIORITY 1.5: Check if search term appears as a phrase in the target
    // This handles cases like "WE BEGIN ?" matching "Where Should We Begin?"
    const searchWords = s1.split(/\s+/).filter(w => w.length > 0);
    const targetWords = s2.split(/\s+/).filter(w => w.length > 0);
    
    if (searchWords.length >= 2) {
      // Check if consecutive words from search term appear in target
      for (let i = 0; i <= targetWords.length - searchWords.length; i++) {
        let consecutiveMatch = true;
        for (let j = 0; j < searchWords.length; j++) {
          const searchWord = searchWords[j];
          const targetWord = targetWords[i + j];
          
          // Allow exact match or partial match for consecutive words
          if (!(searchWord === targetWord || 
                (searchWord.length >= 2 && targetWord.length >= 2 && 
                 (searchWord.startsWith(targetWord) || targetWord.startsWith(searchWord))))) {
            consecutiveMatch = false;
            break;
          }
        }
        
        if (consecutiveMatch) {
          // Found consecutive word match, give it very high priority
          // But give even higher priority if the search term is shorter (likely truncated)
          const coverage = searchWords.length / Math.max(searchWords.length, targetWords.length);
          if (s1.length <= s2.length) {
            // Search term is shorter, likely truncated - give maximum priority
            return 0.99 + (coverage * 0.01); // 0.99 to 1.0 range
          } else {
            return 0.96 + (coverage * 0.04); // 0.96 to 1.0 range
          }
        }
      }
    }
    
    // PRIORITY 2: Check for partial word matches (handles truncated words)
    const words1 = s1.split(/\s+/);
    const words2 = s2.split(/\s+/);
    
    let partialWordMatches = 0;
    let exactWordMatches = 0;
    
    for (const word1 of words1) {
      for (const word2 of words2) {
        if (word1 === word2) {
          exactWordMatches++;
        } else if (word1.length >= 2 && word2.length >= 2) {
          // Check for partial word matches (e.g., "Hidden" matches "Hidden Brain")
          if (word1.startsWith(word2) || word2.startsWith(word1)) {
            partialWordMatches += 0.6;
          }
        }
      }
    }
    
    // Calculate similarity with partial word support
    const totalMatches = exactWordMatches + partialWordMatches;
    const totalWords = Math.max(words1.length, words2.length);
    
    if (totalWords === 0) return 0;
    
    const wordSimilarity = totalMatches / totalWords;
    
    // Boost score for partial matches when we have some exact matches
    if (exactWordMatches > 0 && partialWordMatches > 0) {
      return Math.min(1, wordSimilarity + 0.15);
    }
    
    // Additional boost for cases where we have good partial matches even without exact matches
    if (partialWordMatches > 0 && partialWordMatches >= words1.length * 0.5) {
      return Math.min(1, wordSimilarity + 0.1);
    }
    
    return wordSimilarity;
  }
}

module.exports = new ApplePodcastsService(); 