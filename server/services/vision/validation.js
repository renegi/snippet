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

const episodeInfo = (episode, confidence) => ({
  id: episode.id,
  title: episode.title,
  description: episode.description,
  duration: episode.durationSeconds ? episode.durationSeconds * 1000 : undefined,
  releaseDate: episode.releaseDate,
  artworkUrl: episode.artworkUrl,
  confidence: round(confidence)
});

const MAX_SUGGESTIONS = 5;

// The likeliest episodes, for the client's "which episode is this?" picker. Each entry has
// the podcast and episode in the same shape as validatedPodcast / validatedEpisode, so the
// client can use the one the user picks as the result.
function suggestEpisodes(matches, preferredPodcastId) {
  const seen = new Set();
  return matches
    // Something has to point at the episode: some of the title, or a closely matching length
    .filter(m => m.title >= 0.15 || m.duration >= 0.8)
    .filter(m => preferredPodcastId == null || m.podcast.collectionId === preferredPodcastId)
    .filter(m => {
      const key = `${m.podcast.collectionId}:${m.episode.title}`;
      return seen.has(key) ? false : seen.add(key);
    })
    .slice(0, MAX_SUGGESTIONS)
    .map(m => ({
      podcast: podcastInfo(m.podcast, m.name),
      episode: episodeInfo(m.episode, m.title),
      score: round(m.total)
    }));
}

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
          validatedEpisode: episodeInfo(match.episode, match.title),
          // A guess between near-equal episodes: the client asks the user to pick
          needsConfirmation: ambiguous,
          suggestions: ambiguous ? suggestEpisodes(result.matches) : [],
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
      const suggestions = suggestEpisodes(result.matches, podcast.collectionId);
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
          needsConfirmation: suggestions.length > 0,
          suggestions,
          ...diagnostics
        }
      };
    }

    // Nothing certain, but the best-fitting podcast's closest episodes may include the right one
    const likeliest = result.hypotheses[0];
    const suggestions = likeliest ? suggestEpisodes(result.matches, likeliest.podcast.collectionId) : [];
    return {
      podcastTitle: 'Episode not found',
      episodeTitle: 'Episode not found',
      confidence: 0,
      player: 'unvalidated',
      validation: {
        validated: false,
        method: result.method,
        needsConfirmation: suggestions.length > 0,
        suggestions,
        ...diagnostics
      }
    };
  }
};
