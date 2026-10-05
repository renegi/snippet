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

  test(`${image}: pairs the podcast and episode titles`, () => {
    const { candidates } = visionService.analyzeAnnotations(fixture.textAnnotations, fixture.imageDimensions);
    const pairs = visionService.findSpatialPairs(candidates);
    const { podcastText, episodeText } = want.ocr;

    const found = pairs.some(({ top, bottom }) =>
      (contains(top.text, episodeText) && contains(bottom.text, podcastText)) ||
      (contains(top.text, podcastText) && contains(bottom.text, episodeText))
    );
    assert.ok(found, `no pair matching "${episodeText}" + "${podcastText}"; pairs were: ${
      JSON.stringify(pairs.map(p => [p.top.text, p.bottom.text]))}`);
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
