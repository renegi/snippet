// Apple Podcasts (iTunes Search API) and RSS access for one identification request.
// Responses are cached for the request, so the same URL is never fetched twice, and requests
// are counted. Apple's search API is rate-limited (roughly 20 requests a minute); a 403/429
// sets `rateLimited` so a throttled lookup isn't mistaken for "not found".
const xml2js = require('xml2js');
const logger = require('../../utils/logger');

const BASE_URL = 'https://itunes.apple.com';

// "1:02:03", "62:03" or "3723" → seconds
function parseDuration(value) {
  if (value == null || value === '') return null;
  const parts = String(value).trim().split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

// Episode rows from Apple's lookup, in the shape the resolver scores
function fromAppleEpisode(row) {
  return {
    id: row.trackId,
    title: row.trackName,
    durationSeconds: row.trackTimeMillis ? row.trackTimeMillis / 1000 : null,
    releaseDate: row.releaseDate,
    description: row.description,
    artworkUrl: row.artworkUrl160 || row.artworkUrl600 || row.artworkUrl60,
    audioUrl: row.episodeUrl,
    source: 'apple'
  };
}

class AppleCatalog {
  constructor() {
    this.cache = new Map(); // URL → pending response
    this.requestCount = 0;
    this.rateLimited = false;
  }

  async getJson(url) {
    if (!this.cache.has(url)) {
      this.cache.set(url, this.fetchJson(url));
    }
    return this.cache.get(url);
  }

  async fetchJson(url) {
    this.requestCount++;
    try {
      const response = await fetch(url);
      if (response.status === 403 || response.status === 429) {
        this.rateLimited = true;
        logger.warn(`Apple Podcasts rate limit hit (HTTP ${response.status})`);
        return null;
      }
      if (!response.ok) {
        logger.warn(`Apple Podcasts request failed (HTTP ${response.status})`);
        return null;
      }
      return await response.json();
    } catch (error) {
      logger.warn('Apple Podcasts request failed:', { error: error.message });
      return null;
    }
  }

  // Podcasts whose names match the search terms. Apple ranks by popularity as much as by name,
  // so the limit is generous: an exact name can sit far below better-known near-matches.
  async searchPodcasts(terms) {
    if (!terms) return [];
    const data = await this.getJson(`${BASE_URL}/search?term=${encodeURIComponent(terms)}&media=podcast&entity=podcast&limit=50`);
    return (data?.results || []).filter(row => row.collectionId && row.collectionName);
  }

  // The podcast's most recent episodes (Apple returns at most 200). The lookup's first row is
  // the podcast itself, so only episode rows are kept.
  async recentEpisodes(podcastId) {
    const data = await this.getJson(`${BASE_URL}/lookup?id=${podcastId}&entity=podcastEpisode&limit=200`);
    return (data?.results || [])
      .filter(row => row.wrapperType === 'podcastEpisode' && row.trackName)
      .map(fromAppleEpisode);
  }

  // Episodes from any podcast whose titles match the search terms. Rows include the podcast
  // (collectionId, collectionName), so this can identify the podcast from the episode side.
  async searchEpisodes(terms) {
    if (!terms) return [];
    const data = await this.getJson(`${BASE_URL}/search?term=${encodeURIComponent(terms)}&media=podcast&entity=podcastEpisode&limit=50`);
    return (data?.results || [])
      .filter(row => row.trackName && row.collectionId)
      .map(row => ({
        podcast: {
          collectionId: row.collectionId,
          collectionName: row.collectionName,
          artistName: row.artistName,
          feedUrl: row.feedUrl,
          artworkUrl100: row.artworkUrl160 || row.artworkUrl60
        },
        episode: fromAppleEpisode(row)
      }));
  }

  // Every episode in the podcast's RSS feed, for episodes older than Apple's 200. Feeds are
  // fetched from the publisher, so they don't count against Apple's rate limit.
  async feedEpisodes(feedUrl) {
    if (!feedUrl) return [];
    const key = `rss:${feedUrl}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, this.fetchFeed(feedUrl));
    }
    return this.cache.get(key);
  }

  async fetchFeed(feedUrl) {
    try {
      const response = await fetch(feedUrl);
      if (!response.ok) {
        logger.warn(`RSS feed request failed (HTTP ${response.status})`);
        return [];
      }
      const parsed = await new xml2js.Parser().parseStringPromise(await response.text());
      const items = parsed?.rss?.channel?.[0]?.item || [];
      const text = value => (typeof value === 'object' ? value?._ : value);
      return items
        .map(item => ({
          id: null, // RSS items have no Apple ID; audio is found by title later
          title: text(item.title?.[0]),
          durationSeconds: parseDuration(text(item['itunes:duration']?.[0])),
          releaseDate: item.pubDate?.[0],
          audioUrl: item.enclosure?.[0]?.$?.url,
          source: 'rss'
        }))
        .filter(episode => episode.title);
    } catch (error) {
      logger.warn('RSS feed could not be read:', { error: error.message });
      return [];
    }
  }
}

module.exports = { AppleCatalog, parseDuration };
