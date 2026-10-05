// Replays recorded real Apple Podcasts responses (test/fixtures/screenshots/*.apple.json,
// made with `npm run capture-apple`) through identification, and checks the final podcast and
// episode against expected.json (or its `replay` outcome, for episodes that have since left
// the catalog). Screenshots without a recording are skipped.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const visionService = require('../services/visionService');
const { normalize } = require('../services/matching/text');

const FIXTURES_DIR = path.join(__dirname, 'fixtures/screenshots');
const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'expected.json'), 'utf8'));
const realFetch = global.fetch;
test.afterEach(() => { global.fetch = realFetch; });

const replayFetch = recording => async url => {
  const recorded = recording[url];
  if (!recorded) {
    throw new Error(`No recorded response for ${url}; matching now makes different requests, so re-run npm run capture-apple -- --force`);
  }
  return {
    ok: recorded.status >= 200 && recorded.status < 300,
    status: recorded.status,
    json: async () => JSON.parse(recorded.body),
    text: async () => recorded.body
  };
};

for (const [image, want] of Object.entries(expected)) {
  if (image.startsWith('_')) continue;
  const name = path.parse(image).name;
  const recordingPath = path.join(FIXTURES_DIR, `${name}.apple.json`);
  if (!fs.existsSync(recordingPath)) {
    test(`${image}: identifies against real Apple data`, { skip: 'no recorded Apple responses (run npm run capture-apple)' }, () => {});
    continue;
  }

  test(`${image}: identifies against real Apple data`, async () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, `${name}.vision.json`), 'utf8'));
    global.fetch = replayFetch(JSON.parse(fs.readFileSync(recordingPath, 'utf8')));
    const { candidates, playback } = visionService.analyzeAnnotations(fixture.textAnnotations, fixture.imageDimensions);
    const result = await visionService.validateCandidates(candidates, playback);

    // Episodes that are no longer in the catalog must not be replaced by a look-alike
    if (want.replay?.result === 'not_found') {
      assert.strictEqual(result.validation.validated, false, `got "${result.podcastTitle}" / "${result.episodeTitle}"`);
      return;
    }
    assert.ok(normalize(result.podcastTitle).includes(normalize(want.podcast)),
      `podcast: got "${result.podcastTitle}", want "${want.podcast}"`);
    if (want.artist) { // several shows share this name
      assert.strictEqual(result.validation.validatedPodcast.artist, want.artist);
    }
    if (want.replay?.result === 'podcast_only') {
      assert.strictEqual(result.episodeTitle, 'Unknown Episode');
      return;
    }
    assert.ok(normalize(result.episodeTitle).includes(normalize(want.ocr.episodeText)),
      `episode: got "${result.episodeTitle}", want one containing "${want.ocr.episodeText}"`);
  });
}
