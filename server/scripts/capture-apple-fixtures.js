// Records real Apple Podcasts (and RSS) responses for the test screenshots, so identification
// can be tested offline against the real catalog (test/replay.test.js).
//
// Usage (from server; needs internet access but no credentials):
//   npm run capture-apple            # screenshots that have no recording yet
//   npm run capture-apple -- --force # re-record everything
//
// For each <name>.vision.json in test/fixtures/screenshots/ it runs identification and writes
// every response it used to <name>.apple.json, then prints what was identified.
const fs = require('fs');
const path = require('path');
const visionService = require('../services/visionService');

const FIXTURES_DIR = path.join(__dirname, '../test/fixtures/screenshots');

// Wraps fetch to keep every response body, keyed by URL
function recordingFetch(realFetch, recording) {
  return async url => {
    const response = await realFetch(url);
    const text = await response.text();
    recording[url] = { status: response.status, body: text };
    return {
      ok: response.ok,
      status: response.status,
      json: async () => JSON.parse(text),
      text: async () => text
    };
  };
}

async function main() {
  const force = process.argv.includes('--force');
  const realFetch = global.fetch;
  const fixtures = fs.readdirSync(FIXTURES_DIR).filter(file => file.endsWith('.vision.json')).sort();

  for (const file of fixtures) {
    const name = file.replace(/\.vision\.json$/, '');
    const outputPath = path.join(FIXTURES_DIR, `${name}.apple.json`);
    if (fs.existsSync(outputPath) && !force) {
      console.log(`skip     ${name} (already recorded; use --force to redo)`);
      continue;
    }

    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8'));
    const recording = {};
    global.fetch = recordingFetch(realFetch, recording);
    const { candidates, playback } = visionService.analyzeAnnotations(fixture.textAnnotations, fixture.imageDimensions);
    const result = await visionService.validateCandidates(candidates, playback);
    global.fetch = realFetch;

    if (result.validation.rateLimited) {
      console.log(`limited  ${name}: Apple rate limit hit; not saved. Wait a minute and run again.`);
      continue;
    }
    fs.writeFileSync(outputPath, JSON.stringify(recording, null, 1) + '\n');
    console.log(`recorded ${name}: "${result.podcastTitle}" / "${result.episodeTitle}" ` +
      `(${result.validation.method}, ${Object.keys(recording).length} responses)`);

    // Stay well under Apple's ~20 requests a minute
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  console.log('\nCheck the results above against the screenshots, then commit the .apple.json files.');
}

main().catch(error => {
  console.error('Capture failed:', error.message);
  process.exit(1);
});
