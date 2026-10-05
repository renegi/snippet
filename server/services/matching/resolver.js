// Identifies the podcast and episode from the text lines found on a screenshot.
//
// Rather than guessing up front which line is the podcast and which the episode, it tries each
// line as the podcast name, scores every episode of each podcast found against all the other
// lines, and keeps the best-scoring (podcast, episode) combination. Three signals are combined:
//   - name:     how well a screen line matches the podcast's name
//   - title:    how well another screen line matches the episode title (allowing truncation)
//   - duration: elapsed + remaining time on the player vs. the episode's length
// Podcasts are checked in order of how well their name fits. Many shows share a name, so a
// host/publisher line on screen and being Apple's first (most popular) result break ties.
// Sources, cheapest first: Apple's 200 most recent episodes, then the podcast's RSS feed (back
// catalog), then Apple's episode search (finds the podcast from the episode title).
const logger = require('../../utils/logger');
const { AppleCatalog } = require('./appleCatalog');
const { nameScore, titleScore, containedIn, searchTerms, normalize } = require('./text');

const config = {
  maxPodcastSearches: 4,  // lines tried as podcast names
  maxPodcastsChecked: 3,  // podcasts whose episode lists are fetched from Apple
  minNameScore: 0.6,      // a podcast this similar to a screen line is a hypothesis
  maxRankGap: 0.2,        // ...and worth an episode lookup if it ranks this close to the best one
  strongNameScore: 0.85,  // enough to try the podcast's RSS feed
  exactNameScore: 0.95,   // enough to check the podcast before the other lines are searched, or to return it alone
  clearLead: 0.05,        // ...as long as no other podcast fits this nearly as well
  artistBonus: 0.1,       // ranking bonus when another screen line names the podcast's host or publisher
  firstResultBonus: 0.15, // ranking bonus for Apple's first search result, the most popular fit
  minArtistScore: 0.8,
  minTitleScore: 0.6,     // accept an episode when the duration roughly agrees too
  minTitleOnlyScore: 0.7, // accept an episode on its title alone, when the player shows no duration
  strongTitleScore: 0.8,  // stop searching once found (unless the duration disagrees)
  sureTitleScore: 0.85,   // accept even when the duration disagrees (e.g. the player shows time left at 1.5x speed)
  minDurationTitleScore: 0.55, // accept a weaker title when the duration matches closely
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
  // A wrong length still lowers the total, so a same-titled episode of the right length wins
  if (match.title >= config.sureTitleScore) return true;
  if (match.duration == null) return match.title >= config.minTitleOnlyScore;
  if (match.title >= config.minTitleScore && match.duration >= 0.5) return true;
  return match.title >= config.minDurationTitleScore && match.duration >= 0.8;
}

// Good enough to stop looking: a strong title with an agreeing length, or the exact title of
// the exact podcast
const isStrong = match =>
  isAcceptable(match) && match.title >= config.strongTitleScore &&
  (match.duration == null || match.duration >= 0.5 || (match.title >= 0.95 && match.name >= config.exactNameScore));

// Scores a podcast's episodes against the screen lines that could be the episode title
function scoreEpisodes({ podcast, podcastLine, name, episodes, lines, screenDuration }) {
  const episodeLines = lines.filter(line =>
    line !== podcastLine &&
    normalize(line.text).replace(/ /g, '').length >= config.minInformativeLength &&
    // A line that is the podcast's name, or part of it (e.g. artwork text), isn't the episode title
    nameScore(line.text, podcast.collectionName) < 0.8 &&
    containedIn(line.text, podcast.collectionName) < 0.9
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
const byRank = (a, b) => b.rank - a.rank;

// The screen line that best fits the podcast's name, and whether a different line names its
// host or publisher (Apple's artistName), which tells apart shows that share a name.
function hypothesize(podcast, lines) {
  let best = { name: 0, line: null };
  for (const line of lines) {
    const name = nameScore(line.text, podcast.collectionName);
    if (name > best.name) best = { name, line };
  }
  const artist = !!podcast.artistName && lines.some(line =>
    line !== best.line &&
    containedIn(line.text, podcast.collectionName) < 0.5 &&
    nameScore(line.text, podcast.artistName) >= config.minArtistScore);
  return { podcast, ...best, artist };
}

async function resolve(candidates, { durationSeconds } = {}, catalog = new AppleCatalog()) {
  const lines = candidates.filter(line => line.text);
  const matches = [];
  const hypotheses = new Map(); // collectionId → { podcast, line, name, artist }
  const firstResults = new Set(); // collectionIds that came first in a podcast search
  const checked = new Set();    // collectionIds whose recent episodes have been scored

  const ranked = () => [...hypotheses.values()]
    .map(h => ({
      ...h,
      rank: h.name + (h.artist ? config.artistBonus : 0) +
        (firstResults.has(h.podcast.collectionId) ? config.firstResultBonus : 0)
    }))
    .sort(byRank);
  // The best-fitting podcast, if no other fits nearly as well (several shows can share a name)
  const clearTop = () => {
    const [top, second] = ranked();
    return top && (!second || top.rank - second.rank >= config.clearLead) ? top : null;
  };
  const finish = (method, extra = {}) => ({
    method,
    matches: matches.sort(byTotal),
    hypotheses: ranked(),
    requests: catalog.requestCount,
    rateLimited: catalog.rateLimited,
    ...extra
  });
  const best = () => matches.filter(isAcceptable).sort(byTotal)[0];
  const checkRecentEpisodes = async hypothesis => {
    checked.add(hypothesis.podcast.collectionId);
    const episodes = await catalog.recentEpisodes(hypothesis.podcast.collectionId);
    matches.push(...scoreEpisodes({
      ...hypothesis, podcastLine: hypothesis.line, episodes, lines, screenDuration: durationSeconds
    }));
  };

  // 1. Search each line as a podcast name. Every result is scored against all lines, since a
  //    search for the host's name or the episode title can return the podcast too.
  for (const line of lines.slice(0, config.maxPodcastSearches)) {
    const results = await catalog.searchPodcasts(searchTerms(line.text));
    if (results[0]) firstResults.add(results[0].collectionId);
    for (const podcast of results) {
      const hypothesis = hypothesize(podcast, lines);
      if (hypothesis.name >= config.minNameScore && !hypotheses.has(podcast.collectionId)) {
        hypotheses.set(podcast.collectionId, hypothesis);
      }
    }
    // An exact, unrivalled name is checked right away, which usually ends the search here
    const top = clearTop();
    if (top && top.name >= config.exactNameScore && !checked.has(top.podcast.collectionId) &&
        checked.size < config.maxPodcastsChecked) {
      await checkRecentEpisodes(top);
      if (isStrong(best())) return finish('recent_episodes', { match: best() });
    }
    if (catalog.rateLimited) break;
  }

  //    Then the recent episodes of the best-fitting podcasts, against the other lines
  const rankedPodcasts = ranked();
  for (const hypothesis of rankedPodcasts) {
    if (checked.size >= config.maxPodcastsChecked || catalog.rateLimited) break;
    if (rankedPodcasts[0].rank - hypothesis.rank > config.maxRankGap) break;
    if (checked.has(hypothesis.podcast.collectionId)) continue;
    await checkRecentEpisodes(hypothesis);
    if (isStrong(best())) return finish('recent_episodes', { match: best() });
  }
  if (best()) return finish('recent_episodes', { match: best() });

  // 2. The most likely podcast's full back catalog, from its RSS feed
  const topPodcast = ranked()[0];
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
        const hypothesis = hypothesize(podcast, lines.filter(l => l !== line));
        if (hypothesis.name < config.minNameScore) continue;
        matches.push(...scoreEpisodes({
          ...hypothesis, podcastLine: hypothesis.line, episodes: [episode], lines, screenDuration: durationSeconds
        }));
      }
      if (best()) return finish('episode_search', { match: best() });
    }
  }

  // 4. Only the podcast. A wrong podcast is worse than none and many shows share common
  //    names, so the name must be exact, and the show must be the only one with that name,
  //    Apple's first result for it, or confirmed by its host on screen.
  if (topPodcast && topPodcast.name >= config.exactNameScore) {
    const sameName = ranked().filter(h => h.name >= topPodcast.name - config.clearLead).length;
    if (sameName === 1 || topPodcast.artist || firstResults.has(topPodcast.podcast.collectionId)) {
      return finish('podcast_only', { podcast: topPodcast });
    }
  }
  return finish('not_found');
}

module.exports = { resolve, durationScore, config };
