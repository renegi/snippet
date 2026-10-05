// Builds the Google Cloud client config from whichever credential env vars are set.
function getGoogleClientConfig() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
    // Hosted environments: base64-encoded service account JSON
    const credentials = JSON.parse(
      Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString()
    );
    return {
      credentials,
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || credentials.project_id
    };
  }

  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    // Alternative: individual credential fields
    return {
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        type: 'service_account'
      },
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
    };
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Local development: path to a credentials file
    return {
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
    };
  }

  throw new Error('No valid Google Cloud credentials found. Please set GOOGLE_APPLICATION_CREDENTIALS_BASE64, GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY, or GOOGLE_APPLICATION_CREDENTIALS');
}

module.exports = { getGoogleClientConfig };
