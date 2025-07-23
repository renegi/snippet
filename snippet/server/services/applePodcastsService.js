const logger = require('../utils/logger');
const xml2js = require('xml2js');

class ApplePodcastsService {
  constructor() {
    this.baseUrl = 'https://itunes.apple.com';
    this.episodeCache = new Map(); // Cache for episode lists per podcast ID
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
        // Try exact search first
        podcastResult = await this.searchPodcast(podcastTitle);
        
        // If exact search fails and we have an episode title, try fuzzy search
        if (!podcastResult?.validatedPodcast && episodeTitle) {
          logger.info(`Exact podcast search failed for "${podcastTitle}", trying fuzzy search`);
          podcastResult = await this.fuzzySearchPodcast(podcastTitle, episodeTitle);
        }
      }
      
      // Clear episode cache after all searches are complete
      this.clearEpisodeCache();

      // Search for episode if we have episode title
      let episodeResult = null;
      if (episodeTitle && podcastResult?.validatedPodcast) {
        // If fuzzy search already found an episode, use it
        if (podcastResult.validatedEpisode) {
          episodeResult = { validatedEpisode: podcastResult.validatedEpisode };
        } else {
          episodeResult = await this.searchEpisode(episodeTitle, podcastResult.validatedPodcast.id);
        }
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

  async searchMultiplePodcasts(searchTerm) {
    try {
      const encodedTerm = encodeURIComponent(searchTerm);
      const url = `${this.baseUrl}/search?term=${encodedTerm}&entity=podcast&limit=10`;

      logger.info(`Searching multiple podcasts for term: "${searchTerm}"`);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];

      logger.info(`Apple Podcasts search returned ${results.length} results for "${searchTerm}"`);

      // Return all results as podcast objects
      const podcasts = results.map(result => ({
        id: result.collectionId,
        title: result.collectionName,
        artistName: result.artistName,
        feedUrl: result.feedUrl,
        artworkUrl: result.artworkUrl100 || result.artworkUrl600,
        confidence: this.calculateSimilarity(searchTerm, result.collectionName)
      }));
      
      // Log the top candidates for debugging
      const topCandidates = podcasts.slice(0, 3);
      logger.info(`Top podcast candidates for "${searchTerm}":`, topCandidates.map(p => 
        `"${p.title}" (confidence: ${p.confidence.toFixed(3)})`
      ));

      return { podcasts };

    } catch (error) {
      logger.error('Error searching multiple podcasts:', error);
      return { podcasts: [], error: error.message };
    }
  }

  async fuzzySearchPodcast(podcastTitle, episodeTitle) {
    try {
      logger.info(`Starting fuzzy podcast search for "${podcastTitle}" with episode "${episodeTitle}"`);
      
      // Cache for podcast search results to avoid duplicate API calls
      const searchCache = new Map();
      
      // Phase 1: Fuzzy podcast search of cleaned up text
      const phase1Result = await this.fuzzySearchPodcastPhase1(podcastTitle, episodeTitle, searchCache);
      if (phase1Result?.validatedPodcast) {
        logger.info(`Phase 1 fuzzy search successful: "${podcastTitle}" → "${phase1Result.validatedPodcast.title}"`);
        return phase1Result;
      }
      
      // Phase 2: Fuzzy podcast search with middle words (only if Phase 1 failed)
      const phase2Result = await this.fuzzySearchPodcastPhase2(podcastTitle, episodeTitle, searchCache);
      if (phase2Result?.validatedPodcast) {
        logger.info(`Phase 2 fuzzy search successful: "${podcastTitle}" → "${phase2Result.validatedPodcast.title}"`);
        return phase2Result;
      }
      
      logger.info(`Fuzzy podcast search failed for "${podcastTitle}"`);
      return { validatedPodcast: null };
      
    } catch (error) {
      logger.error('Error in fuzzy podcast search:', error);
      return { validatedPodcast: null, error: error.message };
    }
  }

  async fuzzySearchPodcastPhase1(podcastTitle, episodeTitle, searchCache = new Map()) {
    try {
      logger.info(`Phase 1: Fuzzy search with cleaned text for "${podcastTitle}"`);
      
      // Step 1: Remove punctuation and partial words
      const cleanedText = this.cleanPodcastText(podcastTitle);
      logger.info(`Cleaned text: "${cleanedText}"`);
      
      if (!cleanedText || cleanedText.length < 3) {
        logger.info(`Cleaned text too short: "${cleanedText}"`);
        return { validatedPodcast: null };
      }
      
      // Step 2: Do a fuzzy search (use cache if available)
      let searchResult;
      if (searchCache.has(cleanedText)) {
        searchResult = searchCache.get(cleanedText);
        logger.info(`Using cached search results for "${cleanedText}"`);
      } else {
        searchResult = await this.searchMultiplePodcasts(cleanedText);
        searchCache.set(cleanedText, searchResult);
        logger.info(`Cached search results for "${cleanedText}"`);
      }
      
      const candidates = searchResult.podcasts || [];
      logger.info(`Found ${candidates.length} podcast candidates for "${cleanedText}"`);
      
      // Step 3: Check if any candidates have .85 or greater similarity score
      const highConfidenceCandidates = candidates.filter(candidate => candidate.confidence >= 0.85);
      
      if (highConfidenceCandidates.length === 0) {
        logger.info(`No candidates with confidence >= 0.85 for "${cleanedText}"`);
        return { validatedPodcast: null };
      }
      
      logger.info(`Found ${highConfidenceCandidates.length} high-confidence candidates`);
      
      // Step 4: Do an episode search for each candidate with .85 or greater similarity score
      for (const candidate of highConfidenceCandidates) {
        logger.info(`Testing candidate: "${candidate.title}" (confidence: ${candidate.confidence.toFixed(3)})`);
        
        // Try episode search (combines exact and fuzzy search)
        logger.info(`Searching for episode "${episodeTitle}" in candidate "${candidate.title}"`);
        const episodeResult = await this.fuzzySearchEpisodeInPodcast(candidate, episodeTitle);
        if (episodeResult?.validatedEpisode) {
          logger.info(`Episode found in candidate "${candidate.title}": "${episodeResult.validatedEpisode.title}" (confidence: ${episodeResult.validatedEpisode.confidence.toFixed(3)})`);
          return {
            validatedPodcast: {
              id: candidate.id,
              title: candidate.title,
              artist: candidate.artist,
              feedUrl: candidate.feedUrl,
              artworkUrl: candidate.artworkUrl,
              confidence: candidate.confidence
            },
            validatedEpisode: episodeResult.validatedEpisode
          };
        }
        
        logger.info(`No episode found in candidate "${candidate.title}" for episode "${episodeTitle}"`);
      }
      
      logger.info(`No valid episodes found in any high-confidence candidates`);
      return { validatedPodcast: null };
      
    } catch (error) {
      logger.error('Error in Phase 1 fuzzy podcast search:', error);
      return { validatedPodcast: null, error: error.message };
    }
  }

  async fuzzySearchPodcastPhase2(podcastTitle, episodeTitle, searchCache = new Map()) {
    try {
      logger.info(`Phase 2: Fuzzy search with middle words for "${podcastTitle}"`);
      
      // Step 1: Using the cleaned up text, remove the first and last word
      const cleanedText = this.cleanPodcastText(podcastTitle);
      const words = cleanedText.split(/\s+/).filter(word => word.length > 0);
      
      if (words.length < 3) {
        logger.info(`Not enough words for Phase 2: "${cleanedText}" (${words.length} words)`);
        return { validatedPodcast: null };
      }
      
      // Remove first and last word
      const middleWords = words.slice(1, -1).join(' ');
      logger.info(`Middle words: "${middleWords}"`);
      
      if (!middleWords || middleWords.length < 3) {
        logger.info(`Middle words too short: "${middleWords}"`);
        return { validatedPodcast: null };
      }
      
      // Step 2: Do a fuzzy search of the remaining words (use cache if available)
      let searchResult;
      if (searchCache.has(middleWords)) {
        searchResult = searchCache.get(middleWords);
        logger.info(`Using cached search results for middle words "${middleWords}"`);
      } else {
        searchResult = await this.searchMultiplePodcasts(middleWords);
        searchCache.set(middleWords, searchResult);
        logger.info(`Cached search results for middle words "${middleWords}"`);
      }
      
      const candidates = searchResult.podcasts || [];
      logger.info(`Found ${candidates.length} podcast candidates for middle words "${middleWords}"`);
      
      // Step 3: Check if any candidates have .85 or greater similarity score
      const highConfidenceCandidates = candidates.filter(candidate => candidate.confidence >= 0.85);
      
      if (highConfidenceCandidates.length === 0) {
        logger.info(`No candidates with confidence >= 0.85 for middle words "${middleWords}"`);
        return { validatedPodcast: null };
      }
      
      logger.info(`Found ${highConfidenceCandidates.length} high-confidence candidates for middle words`);
      
      // Step 4: Do an episode search for each candidate with .85 or greater similarity score
      for (const candidate of highConfidenceCandidates) {
        logger.info(`Testing candidate: "${candidate.title}" (confidence: ${candidate.confidence.toFixed(3)})`);
        
        // Try episode search (combines exact and fuzzy search)
        logger.info(`Searching for episode "${episodeTitle}" in candidate "${candidate.title}"`);
        const episodeResult = await this.fuzzySearchEpisodeInPodcast(candidate, episodeTitle);
        if (episodeResult?.validatedEpisode) {
          logger.info(`Episode found in candidate "${candidate.title}": "${episodeResult.validatedEpisode.title}" (confidence: ${episodeResult.validatedEpisode.confidence.toFixed(3)})`);
          return {
            validatedPodcast: {
              id: candidate.id,
              title: candidate.title,
              artist: candidate.artist,
              feedUrl: candidate.feedUrl,
              artworkUrl: candidate.artworkUrl,
              confidence: candidate.confidence
            },
            validatedEpisode: episodeResult.validatedEpisode
          };
        }
        
        logger.info(`No episode found in candidate "${candidate.title}" for episode "${episodeTitle}"`);
      }
      
      logger.info(`No valid episodes found in any high-confidence candidates for middle words`);
      return { validatedPodcast: null };
      
    } catch (error) {
      logger.error('Error in Phase 2 fuzzy podcast search:', error);
      return { validatedPodcast: null, error: error.message };
    }
  }

  cleanPodcastText(text) {
    if (!text) return '';
    
    logger.info(`Cleaning podcast text: "${text}"`);
    
    // Remove punctuation and normalize
    let cleaned = text.toLowerCase().trim();
    
    // Remove common punctuation
    cleaned = cleaned.replace(/[^\w\s]/g, ' ');
    
    // Remove partial words (words that end with common truncation patterns)
    const words = cleaned.split(/\s+/).filter(word => {
      // Keep words that are complete or don't end with common truncation patterns
      return word.length > 0 && !word.endsWith('w') && !word.endsWith('...') && !word.endsWith('…');
    });
    
    // Join back together
    cleaned = words.join(' ');
    
    logger.info(`Cleaned podcast text: "${text}" → "${cleaned}"`);
    
    return cleaned;
  }

  async fuzzySearchEpisodeInPodcast(podcast, episodeTitle) {
    try {
      logger.info(`Fuzzy searching for episode "${episodeTitle}" in podcast "${podcast.title}"`);
      
      // Get all episodes for this podcast (cache per podcast ID to avoid refetching)
      let allEpisodes;
      const cacheKey = `podcast_${podcast.id}`;
      
      if (this.episodeCache.has(cacheKey)) {
        allEpisodes = this.episodeCache.get(cacheKey);
        logger.info(`Using cached episodes for podcast ${podcast.id} (${allEpisodes.length} episodes)`);
      } else {
        const episodesResult = await this.searchEpisodes(podcast.id, null);
        allEpisodes = episodesResult.episodes || [];
        this.episodeCache.set(cacheKey, allEpisodes);
        logger.info(`Cached episodes for podcast ${podcast.id} (${allEpisodes.length} episodes)`);
      }
      
      if (!allEpisodes || allEpisodes.length === 0) {
        logger.info(`No episodes found for podcast "${podcast.title}"`);
        return { validatedEpisode: null };
      }
      
      logger.info(`Found ${allEpisodes.length} episodes for fuzzy search`);
      
      // First, try exact match with the cached episodes
      const exactMatch = this.findExactEpisodeMatch(episodeTitle, allEpisodes);
      if (exactMatch) {
        logger.info(`Exact episode match found: "${exactMatch.title}"`);
        return {
          validatedEpisode: {
            id: exactMatch.id,
            title: exactMatch.title,
            description: exactMatch.description || '',
            duration: exactMatch.duration || 0,
            artworkUrl: exactMatch.artworkUrl || '',
            confidence: 0.9, // High confidence for exact match
            matchScore: 1.0,
            matchedKeywords: [episodeTitle.toLowerCase()],
            exactMatches: 1,
            partialMatches: 0
          }
        };
      }
      
      // Extract keywords from the episode candidate text
      const keywords = this.extractKeywords(episodeTitle);
      
      if (keywords.length === 0) {
        logger.info(`No keywords extracted from "${episodeTitle}"`);
        return { validatedEpisode: null };
      }
      
      logger.info(`Fuzzy searching with keywords: [${keywords.join(', ')}] among ${allEpisodes.length} episodes`);
      logger.info(`Keywords breakdown: ${keywords.length} keywords from "${episodeTitle}"`);
      
      // Log episode count for debugging
      logger.info(`Processing ${allEpisodes.length} episodes for fuzzy search`);
      
      const allEpisodeScores = allEpisodes.map(episode => {
        // Handle both 'title' and 'trackName' properties from Apple Podcasts API
        const episodeTitle = episode?.title || episode?.trackName;
        
        if (!episode || !episodeTitle) {
          logger.info(`Filtering out episode:`, { 
            hasEpisode: !!episode, 
            hasTitle: !!(episode && episode.title),
            hasTrackName: !!(episode && episode.trackName),
            episodeKeys: episode ? Object.keys(episode) : []
          });
          return null;
        }
        
        const episodeTitleLower = episodeTitle.toLowerCase();
        const exactMatches = keywords.filter(keyword => episodeTitleLower.includes(keyword));
        const partialMatches = keywords.filter(keyword => {
          const words = episodeTitleLower.split(/\s+/);
          return words.some(word => word.startsWith(keyword) || keyword.startsWith(word));
        });
        
        const totalMatches = exactMatches.length + (partialMatches.length * 0.5);
        const matchScore = totalMatches / keywords.length;
        
        return {
          title: episodeTitle,
          score: matchScore,
          exactMatches: exactMatches,
          partialMatches: partialMatches.filter(k => !exactMatches.includes(k))
        };
      }).filter(result => result !== null)
        .sort((a, b) => b.score - a.score);
      
      logger.info(`Top episode matches:`, allEpisodeScores.slice(0, 5).map(e => 
        `"${e.title}" (${e.score.toFixed(3)})`
      ));
      
      // Find episodes that match multiple keywords with improved fuzzy matching
      const matchingEpisodes = allEpisodes.map(episode => {
        // Handle both 'title' and 'trackName' properties from Apple Podcasts API
        const episodeTitle = episode?.title || episode?.trackName;
        
        if (!episode || !episodeTitle) {
          return null;
        }
        
        const episodeTitleLower = episodeTitle.toLowerCase();
        
        // Check for exact keyword matches
        const exactMatches = keywords.filter(keyword => episodeTitleLower.includes(keyword));
        
        // Check for partial word matches (for truncated text)
        const partialMatches = keywords.filter(keyword => {
          const words = episodeTitleLower.split(/\s+/);
          return words.some(word => word.startsWith(keyword) || keyword.startsWith(word));
        });
        
        // Combine exact and partial matches, giving partial matches half weight
        const totalMatches = exactMatches.length + (partialMatches.length * 0.5);
        const matchScore = totalMatches / keywords.length;
        
        // Only log episodes with significant matches (50% or higher) to reduce noise
        if (matchScore >= 0.5) {
          logger.info(`High match episode: "${episodeTitle}" - Score: ${matchScore.toFixed(2)}, Exact: [${exactMatches.join(', ')}], Partial: [${partialMatches.filter(k => !exactMatches.includes(k)).join(', ')}]`);
        }
        
        return {
          episode: {
            ...episode,
            title: episodeTitle // Ensure we use the correct title
          },
          matchedKeywords: [...exactMatches, ...partialMatches.filter(k => !exactMatches.includes(k))],
          matchScore,
          exactMatches: exactMatches.length,
          partialMatches: partialMatches.length
        };
      }).filter(result => result !== null && result.matchScore >= 0.00001) // Temporary very low threshold for debugging
        .sort((a, b) => {
          // Primary sort: by match score (highest first)
          if (b.matchScore !== a.matchScore) {
            return b.matchScore - a.matchScore;
          }
          
          // Tie-breaking: by release date (newer first)
          const dateA = a.episode.releaseDate ? new Date(a.episode.releaseDate) : new Date(0);
          const dateB = b.episode.releaseDate ? new Date(b.episode.releaseDate) : new Date(0);
          return dateB - dateA;
        });
      
      if (matchingEpisodes.length > 0) {
        const bestMatch = matchingEpisodes[0];
        
        // Log if there were multiple candidates with the same score
        if (matchingEpisodes.length > 1 && matchingEpisodes[1].matchScore === bestMatch.matchScore) {
          logger.info(`Tie detected! Multiple episodes with score ${bestMatch.matchScore.toFixed(2)}. Selected newest: "${bestMatch.episode.title}" (${bestMatch.episode.releaseDate || 'no date'})`);
          logger.info(`Other candidates with same score:`, matchingEpisodes.slice(1, 4).map(m => 
            `"${m.episode.title}" (${m.episode.releaseDate || 'no date'})`
          ));
        }
        
        logger.info(`Best fuzzy match: "${bestMatch.episode.title}" (score: ${bestMatch.matchScore.toFixed(2)}, exact: ${bestMatch.exactMatches}, partial: ${bestMatch.partialMatches})`);
        
        return {
          validatedEpisode: {
            id: bestMatch.episode.id,
            title: bestMatch.episode.title,
            description: bestMatch.episode.description || '',
            duration: bestMatch.episode.duration || 0,
            artworkUrl: bestMatch.episode.artworkUrl || '',
            confidence: 0.5 + (bestMatch.matchScore * 0.3), // 0.5-0.8 confidence range
            matchScore: bestMatch.matchScore,
            matchedKeywords: bestMatch.matchedKeywords,
            exactMatches: bestMatch.exactMatches,
            partialMatches: bestMatch.partialMatches
          }
        };
      }
      
      logger.info(`No episodes found with match score >= 0.00001`);
      return { validatedEpisode: null };
      
    } catch (error) {
      logger.error('Error in fuzzy episode search within podcast:', error);
      return { validatedEpisode: null, error: error.message };
    }
  }

  findExactEpisodeMatch(episodeTitle, episodes) {
    if (!episodeTitle || !episodes || episodes.length === 0) {
      return null;
    }
    
    const normalizedSearchTitle = episodeTitle.toLowerCase().trim();
    
    // First try exact match
    const exactMatch = episodes.find(episode => 
      episode.title && episode.title.toLowerCase().trim() === normalizedSearchTitle
    );
    
    if (exactMatch) {
      return exactMatch;
    }
    
    // Then try contains match
    const containsMatch = episodes.find(episode => 
      episode.title && episode.title.toLowerCase().includes(normalizedSearchTitle)
    );
    
    if (containsMatch) {
      return containsMatch;
    }
    
    // Finally try reverse contains (search title contains episode title)
    const reverseMatch = episodes.find(episode => 
      episode.title && normalizedSearchTitle.includes(episode.title.toLowerCase())
    );
    
    return reverseMatch || null;
  }

  extractKeywords(text) {
    if (!text) return [];
    
    // Remove punctuation and normalize
    let cleaned = text.toLowerCase().trim();
    cleaned = cleaned.replace(/[^\w\s]/g, ' ');
    
    // Split into words and filter out common stop words
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those'];
    
    const words = cleaned.split(/\s+/).filter(word => {
      return word.length > 2 && !stopWords.includes(word);
    });
    
    return words;
  }

  async searchEpisode(episodeTitle, podcastId) {
    try {
      logger.info(`Searching for episode: "${episodeTitle}" in podcast ${podcastId}`);
      
      if (!podcastId) {
        logger.info(`No podcast ID provided for episode search`);
        return { validatedEpisode: null };
      }

      const searchTerm = encodeURIComponent(episodeTitle);
      const url = `${this.baseUrl}/lookup?id=${podcastId}&entity=podcastEpisode&limit=200`;

      logger.info(`Episode search URL: ${url}`);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];

      logger.info(`Episode search returned ${results.length} episodes for podcast ${podcastId}`);

      if (results.length === 0) {
        logger.info(`No episodes found for podcast ${podcastId}`);
        return { validatedEpisode: null };
      }

      // Find the best match with improved logic for truncated titles
      const bestMatch = this.findBestMatch(episodeTitle, results);
      
      logger.info(`Best episode match for "${episodeTitle}": "${bestMatch?.result?.trackName || 'none'}" (similarity: ${bestMatch?.similarity?.toFixed(3) || 'undefined'})`);
      
      // NEW: Much lower threshold for episode validation to handle truncated titles
      // Also check for substring matches which are common with truncated episode titles
      const threshold = 0.2; // Lowered from 0.4 to handle more truncated titles
      
      if (bestMatch && bestMatch.similarity > threshold) {
        logger.info(`Episode validation SUCCESS: "${episodeTitle}" → "${bestMatch.result.trackName}" (similarity: ${bestMatch.similarity.toFixed(3)} >= ${threshold})`);
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

      logger.info(`Episode validation FAILED: "${episodeTitle}" (similarity: ${bestMatch?.similarity?.toFixed(3) || 'undefined'} < ${threshold})`);
      return { validatedEpisode: null };

    } catch (error) {
      logger.error('Error searching episode:', error);
      return {
        validatedEpisode: null,
        error: error.message
      };
    }
  }

  async searchMultipleEpisodes(podcastId, searchTerm) {
    try {
      if (!podcastId) {
        return { episodes: [] };
      }

      const url = `${this.baseUrl}/lookup?id=${podcastId}&entity=podcastEpisode&limit=200`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];

      logger.info(`Apple Podcasts lookup returned ${results.length} episodes for podcast ${podcastId}`);

      if (results.length === 0) {
        return { episodes: [] };
      }

      // Filter episodes that match the search term
      const matchingEpisodes = results
        .filter(episode => {
          const similarity = this.calculateSimilarity(searchTerm, episode.trackName);
          return similarity > 0.1; // Lower threshold for search results
        })
        .map(episode => ({
          id: episode.trackId,
          title: episode.trackName,
          description: episode.description,
          duration: episode.trackTimeMillis,
          artworkUrl: episode.artworkUrl100 || episode.artworkUrl600,
          releaseDate: episode.releaseDate,
          confidence: this.calculateSimilarity(searchTerm, episode.trackName)
        }))
        .sort((a, b) => b.confidence - a.confidence) // Sort by confidence
        .slice(0, 10); // Limit to top 10 results

      return { episodes: matchingEpisodes };

    } catch (error) {
      logger.error('Error searching multiple episodes:', error);
      return { episodes: [], error: error.message };
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
        } else if (word1.length >= 2 && word2.length >= 2) { // Lowered from 3 to catch more truncated words
          // Check for partial word matches (e.g., "Hidden" matches "Hidden Brain")
          if (word1.startsWith(word2) || word2.startsWith(word1)) {
            partialWordMatches += 0.6; // Increased from 0.5 for better partial matching
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
      return Math.min(1, wordSimilarity + 0.15); // Increased boost for mixed matches
    }
    
    // NEW: Additional boost for cases where we have good partial matches even without exact matches
    if (partialWordMatches > 0 && partialWordMatches >= words1.length * 0.5) {
      return Math.min(1, wordSimilarity + 0.1); // Boost for good partial match coverage
    }
    
    return wordSimilarity;
  }

  // Get detailed podcast information including RSS feed URL
  async getPodcastDetails(podcastId) {
    try {
      const url = `${this.baseUrl}/lookup?id=${podcastId}`;
      
      logger.info(`Getting podcast details for ID: ${podcastId}`);
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];
      
      if (results.length === 0) {
        logger.warn(`No podcast details found for ID: ${podcastId}`);
        return null;
      }

      const podcast = results[0];
      return {
        id: podcast.collectionId,
        title: podcast.collectionName,
        artist: podcast.artistName,
        feedUrl: podcast.feedUrl,
        artworkUrl: podcast.artworkUrl600 || podcast.artworkUrl100,
        description: podcast.description,
        genres: podcast.genres
      };
    } catch (error) {
      logger.error('Error getting podcast details:', error);
      return null;
    }
  }

  // Parse RSS feed to find episode audio URL
  async getEpisodeAudioUrl(feedUrl, episodeTitle) {
    try {
      logger.info(`Parsing RSS feed for episode: "${episodeTitle}"`);
      logger.info(`RSS feed URL: ${feedUrl}`);
      
      // Fetch RSS feed
      const response = await fetch(feedUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const rssText = await response.text();
      logger.info(`RSS feed fetched successfully, length: ${rssText.length} characters`);
      
      // Parse XML
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(rssText);
      
      if (!result.rss || !result.rss.channel || !result.rss.channel[0].item) {
        logger.warn('Invalid RSS feed structure');
        return null;
      }

      const episodes = result.rss.channel[0].item;
      logger.info(`Found ${episodes.length} episodes in RSS feed`);
      
      // Find episode matching the title
      const targetEpisode = episodes.find(episode => {
        const title = episode.title && episode.title[0];
        if (!title) return false;
        
        // Calculate similarity between episode titles
        const similarity = this.calculateSimilarity(episodeTitle.toLowerCase(), title.toLowerCase());
        logger.debug(`Episode similarity: "${title}" vs "${episodeTitle}" = ${similarity.toFixed(3)}`);
        
        return similarity > 0.7; // 70% similarity threshold
      });

      if (!targetEpisode) {
        logger.warn(`No episode found matching "${episodeTitle}" in RSS feed`);
        
        // Log first few episode titles for debugging
        const firstFew = episodes.slice(0, 5).map(ep => ep.title?.[0] || 'No title');
        logger.info('First few episode titles:', firstFew);
        
        return null;
      }

      // Extract audio URL from enclosure
      const enclosure = targetEpisode.enclosure && targetEpisode.enclosure[0];
      if (!enclosure || !enclosure.$ || !enclosure.$.url) {
        logger.warn('No audio enclosure found for episode');
        return null;
      }

      const audioUrl = enclosure.$.url;
      const audioType = enclosure.$.type || 'unknown';
      const audioLength = enclosure.$.length || 'unknown';
      
      logger.info(`Found audio URL: ${audioUrl.substring(0, 100)}...`);
      logger.info(`Audio type: ${audioType}, length: ${audioLength} bytes`);
      
      return audioUrl;
    } catch (error) {
      logger.error('Error parsing RSS feed:', error);
      return null;
        }
  }

  clearEpisodeCache() {
    this.episodeCache.clear();
    logger.info('Episode cache cleared after all searches complete.');
  }
}

module.exports = new ApplePodcastsService(); 