// Offline tests for the Vision API timeout in extractText: the 30s timer must
// never outlive the call, or its rejection crashes the process. No credentials needed.
const test = require('node:test');
const assert = require('node:assert');
const visionService = require('../services/visionService');

const CREDENTIAL_VARS = [
  'GOOGLE_APPLICATION_CREDENTIALS_BASE64',
  'GOOGLE_CLIENT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS'
];

const pendingTimers = () => process.getActiveResourcesInfo().filter(type => type === 'Timeout').length;

test('extractText rejects cleanly and leaves no timer when credentials are missing', async (t) => {
  const savedEnv = Object.fromEntries(CREDENTIAL_VARS.map(name => [name, process.env[name]]));
  const savedClient = visionService._client;
  for (const name of CREDENTIAL_VARS) delete process.env[name];
  visionService._client = null;
  t.after(() => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value !== undefined) process.env[name] = value;
    }
    visionService._client = savedClient;
  });

  // Dimensions are irrelevant here, and skipping sharp keeps its handles out of the timer count
  t.mock.method(visionService, 'getImageDimensions', async () => null);

  const timersBefore = pendingTimers();

  await assert.rejects(
    visionService.extractText(Buffer.from('not an image')),
    /Vision API error: No valid Google Cloud credentials found/
  );

  assert.strictEqual(pendingTimers(), timersBefore, 'the Vision API timeout timer was left pending');
});

test('extractText clears the timer when the Vision call itself fails', async (t) => {
  const savedClient = visionService._client;
  visionService._client = { textDetection: async () => { throw new Error('INVALID_IMAGE'); } };
  t.after(() => { visionService._client = savedClient; });
  t.mock.method(visionService, 'getImageDimensions', async () => null);

  const timersBefore = pendingTimers();

  await assert.rejects(visionService.extractText(Buffer.from('not an image')), /Invalid image format/);

  assert.strictEqual(pendingTimers(), timersBefore, 'the Vision API timeout timer was left pending');
});
