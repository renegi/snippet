const logger = require('../utils/logger');
const xml2js = require('xml2js');
const { normalize } = require('./matching/text');

// Lowercases and collapses whitespace so titles can be compared exactly
const normalizeTitle = title => String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Apple Podcasts lookups for the manual search/edit screens and transcript audio.
// Identifying podcasts from screenshots lives in ./matching/.
class ApplePodcastsService {
  constructor() {
    this.baseUrl = 'https://itunes.apple.com';
  }

  async searchMultiplePodcasts(searchTerm) {
    try {
      const encodedTerm = encodeURIComponent(searchTerm);
      const url = `${this.baseUrl}/search?term=${encodedTerm}&entity=podcast&limit=10`;

      logger.debug(`Searching multiple podcasts for term: "${searchTerm}"`);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];

      logger.debug(`Apple Podcasts search returned ${results.length} results for "${searchTerm}"`);

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
      logger.debug(`Top podcast candidates for "${searchTerm}":`, topCandidates.map(p => 
        `"${p.title}" (confidence: ${p.confidence.toFixed(3)})`
      ));

      return { podcasts };

    } catch (error) {
      logger.error('Error searching multiple podcasts:', error);
      return { podcasts: [], error: error.message };
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

      logger.debug(`Apple Podcasts lookup returned ${results.length} episodes for podcast ${podcastId}`);

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

  // The podcast's most recent episodes (Apple returns at most 200), optionally ranked by title
  async searchEpisodes(podcastId, episodeTitle) {
    try {
      logger.debug(`Searching episodes for podcastId: ${podcastId}, episodeTitle: ${episodeTitle}`);
      
      if (!podcastId) {
        logger.debug('No podcastId provided, returning empty episodes array');
        return { episodes: [] };
      }

      const url = `${this.baseUrl}/lookup?id=${podcastId}&entity=podcastEpisode&limit=200`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];

      logger.debug(`Found ${results.length} episodes for podcast ${podcastId}`);

      // If episodeTitle is provided, filter and rank by similarity
      if (episodeTitle) {
        const rankedEpisodes = results
          .map(episode => ({
            ...episode,
            similarity: this.calculateSimilarity(episodeTitle, episode.trackName || '')
          }))
          .filter(episode => episode.similarity > 0.3) // Filter out very low matches
          .sort((a, b) => b.similarity - a.similarity);

        logger.debug(`Filtered to ${rankedEpisodes.length} episodes matching "${episodeTitle}"`);
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

  calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    // Accent-insensitive, so "Edición" and "Edicion" compare equal
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
      
      logger.debug(`Getting podcast details for ID: ${podcastId}`);
      
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

  // Finds the episode's audio URL in Apple's episode data (the 200 most recent
  // episodes), matching by Apple ID when known and otherwise by exact title.
  // Returns null when the episode isn't found, so callers can fall back to RSS.
  async getEpisodeAudioUrlFromApple(podcastId, episode) {
    try {
      if (!podcastId || !episode?.title) return null;

      const { episodes } = await this.searchEpisodes(podcastId, null);
      const title = normalizeTitle(episode.title);
      const match =
        (episode.id && episodes.find(e => String(e.trackId) === String(episode.id))) ||
        episodes.find(e => normalizeTitle(e.trackName) === title);

      if (!match?.episodeUrl) {
        logger.debug(`Episode "${episode.title}" not found in Apple episode data`);
        return null;
      }
      return match.episodeUrl;
    } catch (error) {
      logger.warn('Apple episode audio lookup failed:', { error: error.message });
      return null;
    }
  }

  // Parse RSS feed to find episode audio URL
  async getEpisodeAudioUrl(feedUrl, episodeTitle) {
    try {
      if (!feedUrl || !episodeTitle) return null;

      logger.debug(`Parsing RSS feed for episode: "${episodeTitle}"`);
      logger.debug(`RSS feed URL: ${feedUrl}`);
      
      // Fetch RSS feed
      const response = await fetch(feedUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const rssText = await response.text();
      logger.debug(`RSS feed fetched successfully, length: ${rssText.length} characters`);
      
      // Parse XML
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(rssText);
      
      if (!result.rss || !result.rss.channel || !result.rss.channel[0].item) {
        logger.warn('Invalid RSS feed structure');
        return null;
      }

      const episodes = result.rss.channel[0].item;
      logger.debug(`Found ${episodes.length} episodes in RSS feed`);
      
      // Find the episode matching the title: an exact match if there is one,
      // otherwise the most similar title above the 70% threshold
      const rssTitle = episode => (episode.title && episode.title[0]) || '';
      const wanted = normalizeTitle(episodeTitle);
      let targetEpisode = episodes.find(episode => normalizeTitle(rssTitle(episode)) === wanted);
      if (!targetEpisode) {
        let bestSimilarity = 0.7;
        for (const episode of episodes) {
          const title = rssTitle(episode);
          if (!title) continue;
          const similarity = this.calculateSimilarity(episodeTitle.toLowerCase(), title.toLowerCase());
          if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            targetEpisode = episode;
          }
        }
      }

      if (!targetEpisode) {
        logger.warn(`No episode found matching "${episodeTitle}" in RSS feed`);
        
        // Log first few episode titles for debugging
        const firstFew = episodes.slice(0, 5).map(ep => ep.title?.[0] || 'No title');
        logger.debug('First few episode titles:', firstFew);
        
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
      
      logger.debug(`Found audio URL: ${audioUrl.substring(0, 100)}...`);
      logger.debug(`Audio type: ${audioType}, length: ${audioLength} bytes`);
      
      return audioUrl;
    } catch (error) {
      logger.error('Error parsing RSS feed:', error);
      return null;
        }
  }
}

module.exports = new ApplePodcastsService();
