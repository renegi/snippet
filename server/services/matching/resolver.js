// Identifies the podcast and episode from the text lines found on a screenshot.
//
// Rather than guessing up front which line is the podcast and which the episode, it tries each
// line as the podcast name, scores every episode of each podcast found against all the other
// lines, and keeps the best-scoring (podcast, episode) combination. Three signals are combined:
//   - name:     how well a screen line matches the podcast's name
//   - title:    how well another screen line matches the episode title (allowing truncation)
//   - duration: elapsed + remaining time on the player vs. the episode's length
// Sources, cheapest first: Apple's 200 most recent episodes, then the podcast's RSS feed (back
// catalog), then Apple's episode search (finds the podcast from the episode title).
const logger = require('../../utils/logger');
const { AppleCatalog } = require('./appleCatalog');
const { nameScore, titleScore, searchTerms, normalize } = require('./text');

const config = {
  maxPodcastSearches: 4,  // lines tried as podcast names
  maxPodcastsChecked: 3,  // podcasts whose episode lists are fetched from Apple
  minNameScore: 0.6,      // a podcast this similar to a screen line is worth checking
  strongNameScore: 0.85,  // enough to trust the podcast on its own (RSS fallback, podcast-only result)
  minTitleScore: 0.6,     // accept an episode on its title alone
  strongTitleScore: 0.8,  // stop searching once found (unless the duration disagrees)
  minDurationTitleScore: 0.4, // accept a weaker title when the duration also matches
  minInformativeLength: 6,    // shorter episode text matches too many titles to be evidence
  nearbyDistance: 120     // px (at reference width): episode line next to the podcast line
};

// 0-1 agreement between the player's duration and the episode's length. Dynamic ad insertion
// makes the played file a little longer or shorter than the catalog length, so small
// differences still score well. null when either length is unknown.
function durationScore(screenSeconds, episodeSeconds) {
  if (!screenSeconds || !episodeSeconds) return null;
  const difference = Math.abs(screenSeconds - episodeSeconds);
  if (difference <= 20) return 1;
  if (difference <= 90) return 1 - 0.2 * (difference - 20) / 70;
  if (difference <= 300) return 0.8 - 0.5 * (difference - 90) / 210;
  if (difference <= 600) return 0.3 - 0.3 * (difference - 300) / 300;
  return 0;
}

function combine({ name, title, duration }) {
  const episode = duration == null ? title : 0.75 * title + 0.25 * duration;
  return 0.3 * name + 0.7 * episode;
}

function isAcceptable(match) {
  if (!match) return false;
  if (match.title >= config.minTitleScore && match.duration !== 0) return true;
  return match.title >= config.minDurationTitleScore && match.duration >= 0.8;
}

const isStrong = match =>
  isAcceptable(match) && match.title >= config.strongTitleScore && (match.duration == null || match.duration >= 0.5);

// Scores a podcast's episodes against the screen lines that could be the episode title
function scoreEpisodes({ podcast, podcastLine, name, episodes, lines, screenDuration }) {
  const episodeLines = lines.filter(line =>
    line !== podcastLine &&
    normalize(line.text).replace(/ /g, '').length >= config.minInformativeLength &&
    // A line that is the podcast's name (e.g. artwork text) isn't the episode title
    nameScore(line.text, podcast.collectionName) < 0.8
  );
  if (episodeLines.length === 0) return [];

  return episodes.map(episode => {
    let best = { title: 0, line: null };
    for (const line of episodeLines) {
      // Players show the episode title right above or below the podcast name
      const nearby = !podcastLine || Math.abs(line.avgY - podcastLine.avgY) <= config.nearbyDistance;
      const title = titleScore(line.text, episode.title) * (nearby ? 1 : 0.9);
      if (title > best.title) best = { title, line };
    }
    const signals = { name, title: best.title, duration: durationScore(screenDuration, episode.durationSeconds) };
    return {
      podcast,
      episode,
      podcastLine: podcastLine?.text,
      episodeLine: best.line?.text,
      ...signals,
      total: combine(signals)
    };
  });
}

const byTotal = (a, b) => b.total - a.total;

async function resolve(candidates, { durationSeconds } = {}, catalog = new AppleCatalog()) {
  const lines = candidates.filter(line => line.text);
  const matches = [];
  const hypotheses = new Map(); // collectionId → { podcast, line, name }

  const finish = (method, extra = {}) => ({
    method,
    matches: matches.sort(byTotal),
    hypotheses: [...hypotheses.values()].sort((a, b) => b.name - a.name),
    requests: catalog.requestCount,
    rateLimited: catalog.rateLimited,
    ...extra
  });
  const best = () => matches.filter(isAcceptable).sort(byTotal)[0];

  // 1. Each line as a podcast name, then that podcast's recent episodes against the other lines
  let podcastsChecked = 0;
  for (const line of lines.slice(0, config.maxPodcastSearches)) {
    const results = await catalog.searchPodcasts(searchTerms(line.text));
    const found = results
      .map(podcast => ({ podcast, line, name: nameScore(line.text, podcast.collectionName) }))
      .filter(h => h.name >= config.minNameScore && !hypotheses.has(h.podcast.collectionId))
      .sort((a, b) => b.name - a.name);

    for (const hypothesis of found) {
      hypotheses.set(hypothesis.podcast.collectionId, hypothesis);
      if (podcastsChecked >= config.maxPodcastsChecked) continue;
      podcastsChecked++;

      const episodes = await catalog.recentEpisodes(hypothesis.podcast.collectionId);
      matches.push(...scoreEpisodes({
        ...hypothesis, podcastLine: line, episodes, lines, screenDuration: durationSeconds
      }));
      if (isStrong(best())) return finish('recent_episodes', { match: best() });
    }
    if (catalog.rateLimited) break;
  }
  if (best()) return finish('recent_episodes', { match: best() });

  // 2. The most likely podcast's full back catalog, from its RSS feed
  const topPodcast = [...hypotheses.values()].sort((a, b) => b.name - a.name)[0];
  if (topPodcast && topPodcast.name >= config.strongNameScore && topPodcast.podcast.feedUrl) {
    const episodes = await catalog.feedEpisodes(topPodcast.podcast.feedUrl);
    matches.push(...scoreEpisodes({
      ...topPodcast, podcastLine: topPodcast.line, episodes, lines, screenDuration: durationSeconds
    }));
    if (best()) return finish('rss_feed', { match: best() });
  }

  // 3. Search episodes by title, with the podcast name confirmed by another screen line
  if (!catalog.rateLimited) {
    const titleLines = lines
      .filter(line => ![...hypotheses.values()].some(h => h.line === line && h.name >= config.strongNameScore))
      .slice(0, 2);
    for (const line of titleLines) {
      const results = await catalog.searchEpisodes(searchTerms(line.text));
      for (const { podcast, episode } of results) {
        const name = Math.max(0, ...lines.filter(l => l !== line).map(l => nameScore(l.text, podcast.collectionName)));
        if (name < config.minNameScore) continue;
        const podcastLine = lines.find(l => l !== line && nameScore(l.text, podcast.collectionName) === name);
        matches.push(...scoreEpisodes({
          podcast, podcastLine, name, episodes: [episode], lines, screenDuration: durationSeconds
        }));
      }
      if (best()) return finish('episode_search', { match: best() });
    }
  }

  // 4. Only the podcast
  if (topPodcast && topPodcast.name >= config.strongNameScore) {
    return finish('podcast_only', { podcast: topPodcast });
  }
  return finish('not_found');
}

module.exports = { resolve, durationScore, config };
