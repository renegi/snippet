// Identifies the podcast and episode from the title candidates, via the scored resolver
// (../matching/resolver.js), and shapes the result for the API.
// These methods are mixed into VisionService (../visionService.js), so `this` is the service.
const logger = require('../../utils/logger');
const { resolve } = require('../matching/resolver');

// Two different episodes scoring within this of each other means the pick is a guess
const AMBIGUITY_MARGIN = 0.05;

const round = value => (value == null ? null : Math.round(value * 1000) / 1000);

const podcastInfo = (podcast, confidence) => ({
  id: podcast.collectionId,
  title: podcast.collectionName,
  artist: podcast.artistName,
  feedUrl: podcast.feedUrl,
  artworkUrl: podcast.artworkUrl100 || podcast.artworkUrl600,
  confidence: round(confidence)
});

module.exports = {
  async validateCandidates(candidates, playback = {}, catalog) {
    const result = await resolve(candidates, playback, catalog);
    const diagnostics = { appleRequests: result.requests, rateLimited: result.rateLimited };

    logger.debug('Identification result', {
      method: result.method,
      ...diagnostics,
      top: result.matches.slice(0, 5).map(m => ({
        podcast: m.podcast.collectionName,
        episode: m.episode.title,
        source: m.episode.source,
        name: round(m.name), title: round(m.title), duration: round(m.duration), total: round(m.total)
      }))
    });

    if (result.match) {
      const { match } = result;
      const runnerUp = result.matches.find(m =>
        m.podcast.collectionId !== match.podcast.collectionId || m.episode.title !== match.episode.title);
      const ambiguous = !!runnerUp && match.total - runnerUp.total < AMBIGUITY_MARGIN;
      const confidence = match.total * (ambiguous ? 0.8 : 1);

      return {
        podcastTitle: match.podcast.collectionName,
        episodeTitle: match.episode.title,
        confidence: round(confidence),
        player: 'validated',
        validation: {
          validated: true,
          method: result.method,
          ambiguous,
          signals: { name: round(match.name), title: round(match.title), duration: round(match.duration) },
          podcastCandidate: match.podcastLine,
          episodeCandidate: match.episodeLine,
          validatedPodcast: podcastInfo(match.podcast, match.name),
          validatedEpisode: {
            id: match.episode.id,
            title: match.episode.title,
            description: match.episode.description,
            duration: match.episode.durationSeconds ? match.episode.durationSeconds * 1000 : undefined,
            releaseDate: match.episode.releaseDate,
            artworkUrl: match.episode.artworkUrl,
            confidence: round(match.title)
          },
          // Other likely episodes, e.g. for letting the user pick when `ambiguous`
          alternatives: result.matches
            .filter(m => m !== match && m.total >= match.total - 0.2)
            .slice(0, 3)
            .map(m => ({
              podcastId: m.podcast.collectionId,
              podcastTitle: m.podcast.collectionName,
              episodeId: m.episode.id,
              episodeTitle: m.episode.title,
              score: round(m.total)
            })),
          ...diagnostics
        }
      };
    }

    if (result.podcast) {
      const { podcast, name } = result.podcast;
      return {
        podcastTitle: podcast.collectionName,
        episodeTitle: 'Unknown Episode',
        confidence: round(name * 0.6),
        player: 'validated',
        validation: {
          validated: true,
          method: result.method,
          podcastCandidate: result.podcast.line.text,
          validatedPodcast: podcastInfo(podcast, name),
          validatedEpisode: null,
          ...diagnostics
        }
      };
    }

    return {
      podcastTitle: 'Episode not found',
      episodeTitle: 'Episode not found',
      confidence: 0,
      player: 'unvalidated',
      validation: { validated: false, method: result.method, ...diagnostics }
    };
  }
};
