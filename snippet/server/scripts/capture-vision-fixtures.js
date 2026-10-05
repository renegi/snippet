// Records Google Vision OCR responses for the test screenshots so tests can run
// offline without credentials or API costs.
//
// Usage (from snippet/server, with Google credentials in .env):
//   npm run capture-fixtures            # capture screenshots that have no recording yet
//   npm run capture-fixtures -- --force # re-capture everything
//
// For each image in test/fixtures/screenshots/ it writes <name>.vision.json next to it.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const vision = require('@google-cloud/vision');
const sharp = require('sharp');
const { getGoogleClientConfig } = require('../utils/googleCredentials');

const FIXTURES_DIR = path.join(__dirname, '../test/fixtures/screenshots');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

async function main() {
  const force = process.argv.includes('--force');
  const client = new vision.ImageAnnotatorClient(getGoogleClientConfig());

  const images = fs.readdirSync(FIXTURES_DIR)
    .filter(file => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort();

  if (images.length === 0) {
    console.log(`No images found in ${FIXTURES_DIR}`);
    return;
  }

  let captured = 0;
  for (const image of images) {
    const imagePath = path.join(FIXTURES_DIR, image);
    const outputPath = path.join(FIXTURES_DIR, `${path.parse(image).name}.vision.json`);

    if (fs.existsSync(outputPath) && !force) {
      console.log(`skip     ${image} (already captured; use --force to redo)`);
      continue;
    }

    const { width, height } = await sharp(imagePath).metadata();
    const [result] = await client.textDetection(imagePath);
    const textAnnotations = result.textAnnotations || [];

    fs.writeFileSync(outputPath, JSON.stringify({
      image,
      imageDimensions: { width, height },
      capturedAt: new Date().toISOString(),
      textAnnotations
    }, null, 2) + '\n');

    captured++;
    const firstLine = (textAnnotations[0]?.description || '').split('\n')[0];
    console.log(`captured ${image} (${width}x${height}, ${textAnnotations.length} annotations, starts "${firstLine}")`);
  }

  console.log(`\nDone: ${captured} captured, ${images.length - captured} skipped.`);
  if (captured > 0) {
    console.log('Commit the new .vision.json files in test/fixtures/screenshots/.');
  }
}

main().catch(error => {
  console.error('Capture failed:', error.message);
  process.exit(1);
});
