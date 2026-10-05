// Tests for finding an episode's audio URL, with fetch stubbed (no network needed).
const test = require('node:test');
const assert = require('node:assert');
const applePodcastsService = require('../services/applePodcastsService');

const realFetch = global.fetch;
test.afterEach(() => { global.fetch = realFetch; });

// Responds to every request with the given body (JSON object or text)
const stubFetch = (body, ok = true) => {
  global.fetch = async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => body
  });
};

const appleEpisodes = {
  results: [
    { wrapperType: 'track', kind: 'podcast' },
    { trackId: 101, trackName: 'Episode 12: What Moves Us (Part 2)', episodeUrl: 'https://audio.example/part2.mp3' },
    { trackId: 102, trackName: 'What  Moves Us', episodeUrl: 'https://audio.example/what-moves-us.mp3' }
  ]
};

test('Apple lookup matches by episode ID', async () => {
  stubFetch(appleEpisodes);
  const url = await applePodcastsService.getEpisodeAudioUrlFromApple(1, { id: '101', title: 'something else' });
  assert.strictEqual(url, 'https://audio.example/part2.mp3');
});

test('Apple lookup falls back to an exact title match (ignoring case and spacing)', async () => {
  stubFetch(appleEpisodes);
  const url = await applePodcastsService.getEpisodeAudioUrlFromApple(1, { title: 'what moves us' });
  assert.strictEqual(url, 'https://audio.example/what-moves-us.mp3');
});

test('Apple lookup returns null when the episode is not listed, or the request fails', async () => {
  stubFetch(appleEpisodes);
  assert.strictEqual(await applePodcastsService.getEpisodeAudioUrlFromApple(1, { title: 'Unknown Episode' }), null);
  stubFetch({}, false);
  assert.strictEqual(await applePodcastsService.getEpisodeAudioUrlFromApple(1, { title: 'What Moves Us' }), null);
});

const rssFeed = items => `<?xml version="1.0"?><rss><channel>${items.map(([title, url]) =>
  `<item><title>${title}</title><enclosure url="${url}" type="audio/mpeg" length="1"/></item>`).join('')}</channel></rss>`;

test('RSS fallback prefers an exact title over an earlier similar one', async () => {
  stubFetch(rssFeed([
    ['What Moves Us (Part 2)', 'https://audio.example/part2.mp3'],
    ['What Moves Us', 'https://audio.example/exact.mp3']
  ]));
  const url = await applePodcastsService.getEpisodeAudioUrl('https://feed.example/rss', 'What Moves Us');
  assert.strictEqual(url, 'https://audio.example/exact.mp3');
});

test('RSS fallback picks the most similar title, not the first one above the threshold', async () => {
  stubFetch(rssFeed([
    ['The Psychic Question: A Bonus Conversation', 'https://audio.example/bonus.mp3'],
    ['The Psychic Question!', 'https://audio.example/main.mp3']
  ]));
  const url = await applePodcastsService.getEpisodeAudioUrl('https://feed.example/rss', 'The Psychic Question');
  assert.strictEqual(url, 'https://audio.example/main.mp3');
});

test('RSS fallback returns null without an episode title', async () => {
  stubFetch(rssFeed([['', 'https://audio.example/untitled.mp3']]));
  assert.strictEqual(await applePodcastsService.getEpisodeAudioUrl('https://feed.example/rss', undefined), null);
});
