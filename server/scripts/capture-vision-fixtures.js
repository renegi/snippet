// Records Google Vision OCR responses for the test screenshots so tests can run
// offline without credentials or API costs.
//
// Usage (from server, with Google credentials in .env):
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

// Describes the credential setup without printing any secret values.
function describeCredentials() {
  const env = process.env;
  const method = env.GOOGLE_APPLICATION_CREDENTIALS_BASE64 ? 'GOOGLE_APPLICATION_CREDENTIALS_BASE64'
    : (env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY) ? 'GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY'
    : env.GOOGLE_APPLICATION_CREDENTIALS ? 'GOOGLE_APPLICATION_CREDENTIALS (file)'
    : 'none';
  console.error(`\nCredential method in use: ${method}`);

  let key;
  try {
    const config = getGoogleClientConfig();
    if (config.keyFilename) {
      const exists = fs.existsSync(config.keyFilename);
      console.error(`  Credentials file exists: ${exists}`);
      if (!exists) return;
      key = JSON.parse(fs.readFileSync(config.keyFilename, 'utf8')).private_key;
    } else {
      key = config.credentials.private_key;
    }
  } catch (error) {
    console.error(`  Could not load credentials: ${error.message}`);
    return;
  }

  key = key || '';
  const trimmed = key.trim();
  console.error(`  Private key length: ${key.length} characters (a real key is ~1700)`);
  console.error(`  Starts with "-----BEGIN PRIVATE KEY-----": ${trimmed.startsWith('-----BEGIN PRIVATE KEY-----')}`);
  console.error(`  Ends with "-----END PRIVATE KEY-----": ${trimmed.endsWith('-----END PRIVATE KEY-----')}`);
  console.error(`  Contains real line breaks: ${key.includes('\n')}`);
  console.error(`  Contains literal "\\n" text: ${key.includes('\\n')}`);
  const otherVars = ['GOOGLE_APPLICATION_CREDENTIALS_BASE64', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_APPLICATION_CREDENTIALS']
    .filter(name => env[name]);
  if (otherVars.length > 1) {
    console.error(`  Note: several credential variables are set (${otherVars.join(', ')}); the first one listed above wins.`);
  }
}

main().catch(error => {
  console.error('Capture failed:', error.message);
  describeCredentials();
  process.exit(1);
});
