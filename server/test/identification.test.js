// Offline tests for identifying the podcast and episode: the recorded Vision responses are run
// through the full pipeline against a fake Apple catalog (test/fixtures/fakeApple.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const visionService = require('../services/visionService');
const { titleScore, nameScore, normalize } = require('../services/matching/text');
const { durationScore } = require('../services/matching/resolver');
const { parseDuration } = require('../services/matching/appleCatalog');
const { installFakeApple } = require('./fixtures/fakeApple');

const FIXTURES_DIR = path.join(__dirname, 'fixtures/screenshots');
const realFetch = global.fetch;
test.afterEach(() => { global.fetch = realFetch; });

const identify = fixtureName => {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, `${fixtureName}.vision.json`), 'utf8'));
  const { candidates, playback } = visionService.analyzeAnnotations(fixture.textAnnotations, fixture.imageDimensions);
  return visionService.validateCandidates(candidates, playback);
};

// What each screenshot should resolve to in the fake catalog, and why it's a useful case
const cases = {
  'big-picture-science': {
    podcast: 'Big Picture Science', episode: 'What Moves Us', // not "What Moves Us (Encore)", a different length
    method: 'recent_episodes'
  },
  'football-weekly-lockscreen': {
    podcast: 'Football Weekly', episode: 'Chelsea win the Club World Cup, U21 glory and Arsenal’s new signing', // marquee window
    method: 'recent_episodes'
  },
  'where-should-we-begin-promo-card': {
    podcast: 'Where Should We Begin? with Esther Perel', episode: 'Esther Calling - Never Been Loved', // "Never Bee…": length decides
    method: 'recent_episodes'
  },
  'search-engine-lockscreen': {
    podcast: 'Search Engine', episode: 'The Psychic Question', // older than Apple's 200: found in the RSS feed
    method: 'rss_feed'
  },
  'marketplace-lockscreen': {
    podcast: 'Marketplace', episode: 'Reading the labor market tea leaves', // not "Marketplace Morning Report"
    method: 'recent_episodes'
  }
};

for (const [name, want] of Object.entries(cases)) {
  test(`${name}: identifies the podcast and episode`, async () => {
    const requested = installFakeApple();
    const result = await identify(name);

    assert.strictEqual(result.podcastTitle, want.podcast);
    assert.strictEqual(result.episodeTitle, want.episode);
    assert.strictEqual(result.validation.validated, true);
    assert.strictEqual(result.validation.method, want.method);
    assert.ok(result.validation.validatedPodcast.id, 'podcast ID is set');
    if (want.method !== 'rss_feed') {
      assert.ok(result.validation.validatedEpisode.id, 'episode ID is set for Apple episodes');
    }
    const appleRequests = requested.filter(url => url.startsWith('https://itunes.apple.com'));
    assert.ok(appleRequests.length <= 6, `${appleRequests.length} Apple requests: ${appleRequests.join(', ')}`);
    assert.strictEqual(new Set(requested).size, requested.length, 'no URL is requested twice');
  });
}

// Hand-written screen lines, for cases without a recorded screenshot
const identifyLines = (texts, durationSeconds) => visionService.validateCandidates(
  texts.map((text, i) => ({ text, avgY: 1500 + 60 * i })), { durationSeconds });

test('a host line picks the right show among several with the same name', async () => {
  const requested = installFakeApple();
  const result = await identifyLines(
    ['Another Podcast', 'Looking for AI strategies', 'Benedict Evans & Toni Cowan-Brown'], 27 * 60 + 46);
  assert.strictEqual(result.validation.validatedPodcast.artist, 'Benedict Evans, Toni Cowan-Brown');
  assert.strictEqual(result.episodeTitle, 'Looking for AI strategies');
  assert.strictEqual(result.validation.method, 'recent_episodes');
  assert.ok(requested.length <= 4, `${requested.length} requests`);
});

test('without a host line, the episode decides between shows with the same name', async () => {
  installFakeApple();
  const result = await identifyLines(['Another Podcast', 'Looking for AI strategies'], 27 * 60 + 46);
  assert.strictEqual(result.validation.validatedPodcast.id, 13);
  assert.strictEqual(result.episodeTitle, 'Looking for AI strategies');
});

test('no podcast is returned on its name alone when several shows share it', async () => {
  installFakeApple();
  const result = await identifyLines(['Another Podcast', 'An episode nobody has published'], 1800);
  assert.strictEqual(result.validation.validated, false);
  assert.strictEqual(result.validation.method, 'not_found');
});

test('a podcast shown with a subtitle matches its shorter catalog name', async () => {
  installFakeApple();
  const result = await identifyLines(
    ['Good One: A Podcast About Jokes', 'n on WTF\'s Final Episode and Co'], 112 * 60 + 17);
  assert.strictEqual(result.podcastTitle, 'Good One');
  assert.strictEqual(result.episodeTitle, 'Marc Maron on WTF’s Final Episode and Comedy Politics');
});

test('a clear title match survives a length mismatch (e.g. time left shown at 1.5x speed)', async () => {
  installFakeApple();
  const result = await identifyLines(['Marketplace', 'Reading the labor market tea leaves'], 20 * 60);
  assert.strictEqual(result.episodeTitle, 'Reading the labor market tea leaves');
  assert.strictEqual(result.validation.signals.duration, 0);
});

test('rate limiting is reported, not mistaken for "not found" silently', async () => {
  installFakeApple({ status: 403 });
  const result = await identify('marketplace-lockscreen');
  assert.strictEqual(result.validation.validated, false);
  assert.strictEqual(result.validation.rateLimited, true);
});

test('title score allows truncation at either end', () => {
  assert.ok(titleScore('ading the labor market tea |', 'Reading the labor market tea leaves') > 0.9);
  assert.ok(titleScore('Esther Calling - Never Bee', 'Esther Calling - Never Been Loved') > 0.9);
  assert.ok(titleScore('ading the labor market tea', 'Marketplace Morning Report') < 0.1);
  assert.ok(titleScore('What Moves Us', 'Skeptic Check: Moon Landing') < 0.1);
});

test('matching ignores accents and apostrophe styles', () => {
  assert.strictEqual(normalize('Edición especial'), 'edicion especial');
  assert.ok(titleScore('Esther\'s Office Hours', 'Esther’s Office Hours: Begin Again') > 0.9);
});

test('name score prefers the exact podcast over a longer one containing it', () => {
  assert.ok(nameScore('Marketplace', 'Marketplace') > nameScore('Marketplace', 'Marketplace Morning Report'));
  assert.ok(nameScore('WHERE SHOULD Where Should We Begin ? w', 'Where Should We Begin? with Esther Perel') >= 0.6);
  // Extra words in front of a catalog name mean a different show; a subtitle on screen doesn't
  assert.ok(nameScore('Another Podcast', 'Not Another Podcast') < 0.85);
  assert.ok(nameScore('Good One: A Podcast About Jokes', 'Good One') >= 0.8);
  assert.ok(nameScore('The Daily', 'The Daily') > nameScore('The Daily Show: Ears Edition', 'The Daily'));
});

test('duration score tolerates ad-insertion differences but not other episodes', () => {
  assert.strictEqual(durationScore(3003, 3010), 1);
  assert.ok(durationScore(3003, 3040) > 0.9);
  assert.ok(durationScore(3003, 2460) < 0.1); // 9 minutes off
  assert.strictEqual(durationScore(null, 3000), null);
});

test('RSS durations parse in all common formats', () => {
  assert.strictEqual(parseDuration('59:20'), 3560);
  assert.strictEqual(parseDuration('1:02:03'), 3723);
  assert.strictEqual(parseDuration('3600'), 3600);
  assert.strictEqual(parseDuration(''), null);
});

test('candidate filters keep titles that look a bit like dates', () => {
  const line = text => ({ text, avgArea: 4000, wordCount: text.split(' ').length });
  assert.ok(visionService.isValidCandidate(line('10 Percent Happier')));
  assert.ok(visionService.isValidCandidate(line('Hablemos para las mamás')));
  assert.ok(!visionService.isValidCandidate(line('Miércoles, 2 de julio')));
  assert.ok(!visionService.isValidCandidate(line('para las 4:30a.m.')));
});
