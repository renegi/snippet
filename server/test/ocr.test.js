// Offline tests for the OCR stage: recorded Google Vision responses in
// test/fixtures/screenshots/*.vision.json are run through the same analysis
// the server uses, and checked against expected.json. No credentials needed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const visionService = require('../services/visionService');

const FIXTURES_DIR = path.join(__dirname, 'fixtures/screenshots');
const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'expected.json'), 'utf8'));

const contains = (text, part) => text.toLowerCase().includes(part.toLowerCase());

for (const [image, want] of Object.entries(expected)) {
  if (image.startsWith('_')) continue;

  const fixturePath = path.join(FIXTURES_DIR, `${path.parse(image).name}.vision.json`);
  if (!fs.existsSync(fixturePath)) {
    test(image, { skip: 'no recorded Vision response (run npm run capture-fixtures)' }, () => {});
    continue;
  }
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  test(`${image}: reads the playback timestamp`, () => {
    const { timestamp } = visionService.analyzeAnnotations(fixture.textAnnotations, fixture.imageDimensions);
    assert.strictEqual(timestamp, want.timestamp);
  });

  test(`${image}: finds the podcast and episode titles`, () => {
    const { candidates } = visionService.analyzeAnnotations(fixture.textAnnotations, fixture.imageDimensions);
    const { podcastText, episodeText } = want.ocr;
    const texts = candidates.map(c => c.text);

    for (const part of [podcastText, episodeText]) {
      assert.ok(texts.some(text => contains(text, part)), `no candidate contains "${part}"; candidates were: ${JSON.stringify(texts)}`);
    }
  });

  test(`${image}: reads the episode length from the player`, () => {
    const { playback } = visionService.analyzeAnnotations(fixture.textAnnotations, fixture.imageDimensions);
    assert.strictEqual(playback.elapsed, want.timestamp);
    assert.ok(playback.remaining, 'remaining time found');
    assert.ok(playback.durationSeconds > 0);
  });
}

test('normalization leaves reference-width screenshots untouched', () => {
  const annotations = [{ description: 'x', boundingPoly: { vertices: [{ x: 10, y: 20 }] } }];
  const dimensions = { width: 1170, height: 2532 };
  const result = visionService.normalizeToReferenceWidth(annotations, dimensions);
  assert.strictEqual(result.textAnnotations, annotations);
  assert.strictEqual(result.imageDimensions, dimensions);
});

test('normalization scales other widths to the reference width', () => {
  const annotations = [{ description: 'x', boundingPoly: { vertices: [{ x: 100, y: 200 }, { y: 50 }] } }];
  const result = visionService.normalizeToReferenceWidth(annotations, { width: 585, height: 1266 });
  assert.deepStrictEqual(result.imageDimensions, { width: 1170, height: 2532 });
  assert.deepStrictEqual(result.textAnnotations[0].boundingPoly.vertices, [{ x: 200, y: 400 }, { x: 0, y: 100 }]);
});
