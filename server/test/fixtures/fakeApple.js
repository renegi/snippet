// A small fake Apple Podcasts catalog for offline identification tests, answering requests in
// the shape the real iTunes Search API uses:
//   - a lookup returns the podcast's own row first, then episode rows
//   - episode rows carry the podcast name (collectionName) as well as the episode (trackName)
//   - search matches on any search word, so unrelated podcasts come back too
// Titles and lengths are made up around the fixture screenshots, with decoys: similar
// titles with the wrong length, similarly named podcasts, and an episode only in the RSS feed.
// Real responses can be recorded with `npm run capture-apple` (see test/replay.test.js).

const minutes = (m, s = 0) => (m * 60 + s) * 1000;

const podcasts = [
  {
    id: 1, name: 'Big Picture Science', feedUrl: 'https://feeds.example/bps.xml',
    episodes: [
      ['What Moves Us', minutes(54, 30)],
      ['What Moves Us (Encore)', minutes(49, 0)],
      ['Skeptic Check: Moon Landing', minutes(54, 0)]
    ]
  },
  {
    id: 2, name: 'Football Weekly', feedUrl: 'https://feeds.example/fw.xml',
    episodes: [
      ['Football Weekly Extra: Arsenal and more', minutes(59, 0)],
      ['Chelsea win the Club World Cup, U21 glory and Arsenal’s new signing', minutes(60, 25)],
      ['Club World Cup preview', minutes(58, 0)]
    ]
  },
  {
    id: 3, name: 'Where Should We Begin? with Esther Perel', feedUrl: 'https://feeds.example/wswb.xml',
    episodes: [
      ['Esther’s Office Hours: Begin Again', minutes(30, 0)],
      ['Esther Calling - Never Been Kissed', minutes(41, 0)],
      ['Esther Calling - Never Been Loved', minutes(50, 40)]
    ]
  },
  {
    id: 4, name: 'Search Engine', feedUrl: 'https://feeds.example/se.xml',
    episodes: [['Search Engine presents: Bonus', minutes(30, 0)], ['Why is the internet weird?', minutes(55, 0)]],
    // Older than Apple's 200 most recent: only in the RSS feed
    feedOnly: [['The Psychic Question', '59:20'], ['The Psychic Answer', '41:00']]
  },
  {
    id: 5, name: 'Marketplace', feedUrl: 'https://feeds.example/mp.xml',
    episodes: [
      ['Reading the labor market tea leaves', minutes(30, 10)],
      ['Marketplace Morning Report extra', minutes(8, 0)]
    ]
  },
  { id: 6, name: 'Marketplace Morning Report', feedUrl: 'https://feeds.example/mmr.xml', episodes: [['Stocks fall', minutes(8, 0)]] },
  { id: 7, name: 'Science Weekly', feedUrl: 'https://feeds.example/sw.xml', episodes: [['What moves the moon', minutes(20, 0)]] },
  { id: 8, name: 'The Psychic Hour', feedUrl: 'https://feeds.example/ph.xml', episodes: [['The Psychic Question', minutes(60, 0)]] }
];

const words = text => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2);
const overlap = (terms, text) => words(terms).filter(w => words(text).includes(w)).length;

const podcastRow = p => ({
  wrapperType: 'track', kind: 'podcast', collectionId: p.id, trackId: p.id,
  collectionName: p.name, trackName: p.name, artistName: `${p.name} Studio`,
  feedUrl: p.feedUrl, artworkUrl100: `https://art.example/${p.id}.jpg`
});

const episodeRow = (p, [title, millis], i) => ({
  wrapperType: 'podcastEpisode', kind: 'podcast-episode',
  collectionId: p.id, collectionName: p.name, feedUrl: p.feedUrl,
  trackId: p.id * 1000 + i, trackName: title, trackTimeMillis: millis,
  releaseDate: new Date(Date.UTC(2026, 5, 30 - i)).toISOString(),
  episodeUrl: `https://audio.example/${p.id}/${i}.mp3`
});

const feed = p => `<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>${
  [...p.episodes.map(([title, millis]) => [title, String(millis / 1000)]), ...(p.feedOnly || [])]
    .map(([title, duration], i) => `<item><title>${title}</title><itunes:duration>${duration}</itunes:duration>` +
      `<enclosure url="https://audio.example/rss/${p.id}/${i}.mp3" type="audio/mpeg"/></item>`).join('')
}</channel></rss>`;

function respond(url) {
  const { pathname, searchParams } = new URL(url);
  const limit = Number(searchParams.get('limit')) || 50;

  if (url.startsWith('https://feeds.example/')) {
    const p = podcasts.find(p => p.feedUrl === url);
    return p ? feed(p) : null;
  }
  if (pathname === '/lookup') {
    const p = podcasts.find(p => p.id === Number(searchParams.get('id')));
    return { results: p ? [podcastRow(p), ...p.episodes.map((e, i) => episodeRow(p, e, i))] : [] };
  }
  if (pathname === '/search') {
    const terms = searchParams.get('term');
    if (searchParams.get('entity') === 'podcastEpisode') {
      const rows = podcasts.flatMap(p => p.episodes.map((e, i) => episodeRow(p, e, i)));
      return { results: rows.filter(r => overlap(terms, r.trackName) > 0)
        .sort((a, b) => overlap(terms, b.trackName) - overlap(terms, a.trackName)).slice(0, limit) };
    }
    return { results: podcasts.filter(p => overlap(terms, p.name) > 0)
      .sort((a, b) => overlap(terms, b.name) - overlap(terms, a.name)).slice(0, limit).map(podcastRow) };
  }
  return null;
}

// Replaces global.fetch with the fake catalog; returns the list of requested URLs.
// `status` makes every Apple request fail with that HTTP status (e.g. 403 for rate limiting).
function installFakeApple({ status } = {}) {
  const requested = [];
  global.fetch = async url => {
    requested.push(url);
    const body = status ? null : respond(url);
    const ok = !status && body != null;
    return {
      ok,
      status: status || (ok ? 200 : 404),
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
    };
  };
  return requested;
}

module.exports = { installFakeApple };
