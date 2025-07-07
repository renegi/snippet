const axios = require('axios');
const logger = require('../utils/logger');

class ApplePodcastsService {
  constructor() {
    this.baseURL = 'https://itunes.apple.com/search';
  }

  // Calculate string similarity using Levenshtein distance
  calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    
    // Exact match
    if (s1 === s2) return 1.0;
    
    // Check for partial matches (truncated titles)
    const longerString = s1.length > s2.length ? s1 : s2;
    const shorterString = s1.length > s2.length ? s2 : s1;
    
    // If shorter string is at least 15 characters and starts the longer string
    if (shorterString.length >= 15 && longerString.startsWith(shorterString)) {
      // High confidence for partial matches that start from beginning
      const ratio = shorterString.length / longerString.length;
      // Give 0.8+ confidence if we have at least 30% of the title
      return Math.max(0.8, 0.6 + (ratio * 0.4));
    }
    
    // If shorter string is at least 10 characters and starts the longer string
    if (shorterString.length >= 10 && longerString.startsWith(shorterString)) {
      const ratio = shorterString.length / longerString.length;
      // Give 0.7+ confidence for shorter partial matches
      return Math.max(0.7, 0.5 + (ratio * 0.4));
    }
    
    // Check if shorter string is contained within longer string (not just at start)
    if (shorterString.length >= 15 && longerString.includes(shorterString)) {
      const ratio = shorterString.length / longerString.length;
      // Lower confidence for non-prefix matches
      return Math.max(0.6, 0.4 + (ratio * 0.3));
    }
    
    // NEW: Check for partial matches anywhere in the string (for UI scrolling scenarios)
    if (shorterString.length >= 10) {
      // Split both strings into significant words (3+ characters)
      const shorterWords = shorterString.split(/\s+/).filter(w => w.length >= 3);
      const longerWords = longerString.split(/\s+/).filter(w => w.length >= 3);
      
      if (shorterWords.length >= 2) {
        // Check if all shorter words appear consecutively in the longer string
        const shorterPhrase = shorterWords.join(' ');
        if (longerString.includes(shorterPhrase)) {
          const ratio = shorterString.length / longerString.length;
          // Give high confidence for exact phrase matches within longer strings
          return Math.max(0.75, 0.5 + (ratio * 0.4));
        }
        
        // Check for partial consecutive word matches
        for (let i = 0; i <= longerWords.length - shorterWords.length; i++) {
          const consecutiveLongerWords = longerWords.slice(i, i + shorterWords.length);
          let matchingWords = 0;
          
          for (let j = 0; j < shorterWords.length; j++) {
            if (consecutiveLongerWords[j] && 
                this.calculateSimilarity(shorterWords[j], consecutiveLongerWords[j]) >= 0.8) {
              matchingWords++;
            }
          }
          
          if (matchingWords >= shorterWords.length * 0.8) { // 80% of words match
            const ratio = shorterString.length / longerString.length;
            return Math.max(0.7, 0.4 + (ratio * 0.4));
          }
        }
      }
    }
    
    // Jaccard similarity for word-level matching
    const words1 = s1.split(/\s+/);
    const words2 = s2.split(/\s+/);
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    const jaccardSimilarity = intersection.size / union.size;
    
    // Levenshtein distance for character-level similarity
    const levenshteinSimilarity = 1 - (this.levenshteinDistance(s1, s2) / Math.max(s1.length, s2.length));
    
    // Combine similarities with weights
    const combinedSimilarity = (jaccardSimilarity * 0.6) + (levenshteinSimilarity * 0.4);
    
    return Math.max(combinedSimilarity, 0);
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];
    const len1 = str1.length;
    const len2 = str2.length;

    // Initialize matrix
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,     // deletion
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return matrix[len1][len2];
  }

  // Normalize text for better matching
  normalizeText(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
      .replace(/\s+/g, ' ')     // Collapse multiple spaces
      .trim();
  }

  // Check if strings contain similar words
  containsSimilarWords(str1, str2, threshold = 0.7) {
    const words1 = this.normalizeText(str1).split(' ').filter(w => w.length > 2);
    const words2 = this.normalizeText(str2).split(' ').filter(w => w.length > 2);
    
    let matchCount = 0;
    for (const word1 of words1) {
      for (const word2 of words2) {
        if (this.calculateSimilarity(word1, word2) >= threshold) {
          matchCount++;
          break;
        }
      }
    }
    
    return words1.length > 0 ? matchCount / words1.length : 0;
  }

  async searchPodcast(podcastTitle) {
    try {
      const response = await axios.get(this.baseURL, {
        params: {
          term: podcastTitle,
          media: 'podcast',
          entity: 'podcast',
          limit: 10
        }
      });

      const podcasts = response.data.results || [];
      logger.info(`Found ${podcasts.length} podcast results for: "${podcastTitle}"`);
      
      // Log all podcast matches with more details for debugging
      if (podcasts.length > 0) {
        logger.info('All podcast matches:');
        podcasts.forEach((podcast, index) => {
          logger.info(`  ${index + 1}. "${podcast.collectionName}" (ID: ${podcast.collectionId}, Episodes: ${podcast.trackCount || 'unknown'})`);
        });
      }

      // Score each podcast based on title similarity
      const scoredPodcasts = podcasts.map(podcast => {
        const titleSimilarity = this.calculateSimilarity(podcastTitle, podcast.collectionName);
        const wordsSimilarity = this.containsSimilarWords(podcastTitle, podcast.collectionName);
        const combinedScore = (titleSimilarity * 0.7) + (wordsSimilarity * 0.3);
        
        return {
          ...podcast,
          titleSimilarity,
          wordsSimilarity,
          combinedScore
        };
      });

      // Sort by combined score
      scoredPodcasts.sort((a, b) => b.combinedScore - a.combinedScore);
      
      // SPECIAL CASE: For "Where Should We Begin?", try alternative searches if we don't find a good match
      if (podcastTitle.toLowerCase().includes('where should we begin') && 
          (scoredPodcasts.length === 0 || scoredPodcasts[0].combinedScore < 0.9)) {
        
        logger.info('Trying alternative searches for "Where Should We Begin?"...');
        
        const alternativeSearches = [
          'Where Should We Begin with Esther Perel',
          'Where Should We Begin Esther Perel',
          'Esther Perel Where Should We Begin',
          'Where Should We Begin podcast'
        ];
        
        for (const altTerm of alternativeSearches) {
          try {
            logger.info(`Trying alternative search: "${altTerm}"`);
            const altResponse = await axios.get(this.baseURL, {
              params: {
                term: altTerm,
                media: 'podcast',
                entity: 'podcast',
                limit: 10
              }
            });
            
            const altPodcasts = altResponse.data.results || [];
            logger.info(`Alternative search found ${altPodcasts.length} results`);
            
            if (altPodcasts.length > 0) {
              // Log details about alternative matches
              altPodcasts.forEach((podcast, index) => {
                logger.info(`  Alt ${index + 1}. "${podcast.collectionName}" (ID: ${podcast.collectionId}, Episodes: ${podcast.trackCount || 'unknown'})`);
              });
              
              // Score alternative results
              const altScored = altPodcasts.map(podcast => {
                const titleSimilarity = this.calculateSimilarity(podcastTitle, podcast.collectionName);
                const wordsSimilarity = this.containsSimilarWords(podcastTitle, podcast.collectionName);
                const combinedScore = (titleSimilarity * 0.7) + (wordsSimilarity * 0.3);
                
                return {
                  ...podcast,
                  titleSimilarity,
                  wordsSimilarity,
                  combinedScore,
                  alternativeSearch: altTerm
                };
              });
              
              // If we found better matches, merge them
              const bestAlt = altScored.find(p => p.combinedScore > 0.8);
              if (bestAlt && (!scoredPodcasts[0] || bestAlt.combinedScore > scoredPodcasts[0].combinedScore)) {
                logger.info(`Better match found via alternative search: "${bestAlt.collectionName}" (score: ${bestAlt.combinedScore})`);
                // Add to beginning of results
                scoredPodcasts.unshift(bestAlt);
                break;
              }
            }
          } catch (altError) {
            logger.error(`Alternative search failed for "${altTerm}":`, altError.message);
          }
        }
      }
      
      return scoredPodcasts;
    } catch (error) {
      logger.error('Error searching Apple Podcasts:', error);
      return [];
    }
  }

  async searchEpisodes(podcastId, episodeTitle) {
    try {
      logger.info(`Searching episodes for podcast ID: ${podcastId || 'ALL'}, episode title: ${episodeTitle || 'none'}`);
      
      // If no podcastId provided, do a broad search across all podcasts
      if (!podcastId && episodeTitle) {
        logger.info('Performing broad episode search across all podcasts...');
        const broadResponse = await axios.get(this.baseURL, {
          params: {
            term: episodeTitle,
            media: 'podcast',
            entity: 'podcastEpisode',
            limit: 50
          }
        });
        
        const broadEpisodes = broadResponse.data.results || [];
        logger.info(`Broad search found ${broadEpisodes.length} episodes`);
        
        if (broadEpisodes.length > 0) {
          logger.info('Sample broad search results:', broadEpisodes.slice(0, 3).map(e => ({
            title: e.trackName,
            podcast: e.collectionName
          })));
        }
        
        return broadEpisodes;
      }
      
      // Try with increased limit first
      const response = await axios.get('https://itunes.apple.com/lookup', {
        params: {
          id: podcastId,
          media: 'podcast',
          entity: 'podcastEpisode',
          limit: 200 // Increased from 100 to 200
        }
      });

      const allResults = response.data.results || [];
      const episodes = allResults.slice(1); // Skip first result (podcast info)
      logger.info(`Found ${episodes.length} episodes for podcast ID: ${podcastId} (total results: ${allResults.length})`);
      
      // Log some sample episode titles for debugging
      if (episodes.length > 0) {
        logger.info('Sample episode titles:', episodes.slice(0, 5).map(e => e.trackName));
      }

      if (!episodeTitle || episodes.length === 0) {
        return episodes.slice(0, 20); // Return first 20 if no episode title to match
      }

      // Score episodes based on title similarity
      const scoredEpisodes = episodes.map(episode => {
        const titleSimilarity = this.calculateSimilarity(episodeTitle, episode.trackName);
        const wordsSimilarity = this.containsSimilarWords(episodeTitle, episode.trackName);
        const combinedScore = (titleSimilarity * 0.7) + (wordsSimilarity * 0.3);
        
        return {
          ...episode,
          titleSimilarity,
          wordsSimilarity,
          combinedScore
        };
      });

      // Sort by combined score
      scoredEpisodes.sort((a, b) => b.combinedScore - a.combinedScore);
      
      // Log top matches for debugging
      if (episodeTitle && scoredEpisodes.length > 0) {
        logger.info('Top episode matches:', scoredEpisodes.slice(0, 3).map(e => ({
          title: e.trackName,
          score: e.combinedScore,
          titleSim: e.titleSimilarity,
          wordsSim: e.wordsSimilarity
        })));
      }
      
      return scoredEpisodes;
    } catch (error) {
      logger.error('Error searching episodes:', error);
      
      // Fallback: Try a different approach with general podcast search
      try {
        logger.info('Trying fallback episode search...');
        const fallbackResponse = await axios.get(this.baseURL, {
          params: {
            term: episodeTitle || 'podcast episode',
            media: 'podcast',
            entity: 'podcastEpisode',
            limit: 50
          }
        });
        
        const fallbackEpisodes = fallbackResponse.data.results || [];
        logger.info(`Fallback search found ${fallbackEpisodes.length} episodes`);
        return fallbackEpisodes;
      } catch (fallbackError) {
        logger.error('Fallback episode search also failed:', fallbackError);
        return [];
      }
    }
  }

  async validatePodcastInfo(extractedPodcast, extractedEpisode) {
    try {
      logger.info('Validating podcast info:', { extractedPodcast, extractedEpisode });

      // Step 1: Search for podcast
      const podcastResults = await this.searchPodcast(extractedPodcast);
      
      if (podcastResults.length === 0) {
        return {
          validated: false,
          confidence: 0,
          reason: 'No matching podcasts found'
        };
      }

      // Step 2: Take the best podcast match
      const bestPodcast = podcastResults[0];
      const podcastConfidence = bestPodcast.combinedScore;

      logger.info('Best podcast match:', {
        title: bestPodcast.collectionName,
        confidence: podcastConfidence,
        extracted: extractedPodcast
      });

      // If podcast confidence is too low, don't proceed
      if (podcastConfidence < 0.5) {
        return {
          validated: false,
          confidence: podcastConfidence,
          reason: 'Podcast match confidence too low',
          suggestedPodcast: bestPodcast.collectionName
        };
      }

      // Step 3: Search episodes if we have an episode title
      let episodeConfidence = 0;
      let bestEpisode = null;
      let episodeResults = [];

      if (extractedEpisode) {
        episodeResults = await this.searchEpisodes(bestPodcast.collectionId, extractedEpisode);
        
        if (episodeResults.length > 0) {
          bestEpisode = episodeResults[0];
          episodeConfidence = bestEpisode.combinedScore;

          logger.info('Best episode match:', {
            title: bestEpisode.trackName,
            confidence: episodeConfidence,
            extracted: extractedEpisode
          });
        }
      }

      // Step 4: Calculate overall confidence
      const overallConfidence = extractedEpisode 
        ? (podcastConfidence * 0.6 + episodeConfidence * 0.4)
        : podcastConfidence;

      // Step 5: Determine validation result
      const validated = overallConfidence >= 0.6;

      return {
        validated,
        confidence: overallConfidence,
        validatedPodcast: {
          title: bestPodcast.collectionName,
          id: bestPodcast.collectionId,
          confidence: podcastConfidence,
          extracted: extractedPodcast,
          // Add artwork URLs from iTunes API
          artworkUrl30: bestPodcast.artworkUrl30,
          artworkUrl60: bestPodcast.artworkUrl60,
          artworkUrl100: bestPodcast.artworkUrl100,
          artworkUrl600: bestPodcast.artworkUrl600,
          // Use the highest quality available, fallback to lower quality
          artworkUrl: bestPodcast.artworkUrl600 || bestPodcast.artworkUrl100 || bestPodcast.artworkUrl60 || bestPodcast.artworkUrl30
        },
        validatedEpisode: bestEpisode ? {
          title: bestEpisode.trackName,
          id: bestEpisode.trackId,
          confidence: episodeConfidence,
          extracted: extractedEpisode,
          releaseDate: bestEpisode.releaseDate,
          // Add episode artwork URLs
          artworkUrl30: bestEpisode.artworkUrl30,
          artworkUrl60: bestEpisode.artworkUrl60,
          artworkUrl100: bestEpisode.artworkUrl100,
          artworkUrl600: bestEpisode.artworkUrl600,
          artworkUrl: bestEpisode.artworkUrl600 || bestEpisode.artworkUrl100 || bestEpisode.artworkUrl60 || bestEpisode.artworkUrl30
        } : null,
        suggestions: {
          alternativePodcasts: podcastResults.slice(1, 4).map(p => ({
            title: p.collectionName,
            confidence: p.combinedScore,
            // Add artwork URLs for alternatives too
            artworkUrl: p.artworkUrl600 || p.artworkUrl100 || p.artworkUrl60 || p.artworkUrl30
          })),
          alternativeEpisodes: bestEpisode ? episodeResults.slice(1, 4).map(e => ({
            title: e.trackName,
            confidence: e.combinedScore,
            artworkUrl: e.artworkUrl600 || e.artworkUrl100 || e.artworkUrl60 || e.artworkUrl30
          })) : []
        }
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
}

module.exports = new ApplePodcastsService(); 