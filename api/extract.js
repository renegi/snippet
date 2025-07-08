const { ImageAnnotatorClient } = require('@google-cloud/vision');

// Initialize Google Vision client
let visionClient;
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Parse the JSON credentials from environment variable
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    visionClient = new ImageAnnotatorClient({
      credentials: credentials,
      projectId: credentials.project_id
    });
  } else {
    visionClient = new ImageAnnotatorClient();
  }
} catch (error) {
  console.error('Error initializing Vision client:', error);
}

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: { message: 'Method not allowed' }
    });
  }

  try {
    // Get the image data from the request body
    const { image } = req.body;
    
    if (!image) {
      return res.status(400).json({
        success: false,
        error: { message: 'No image data provided' }
      });
    }

    if (!visionClient) {
      return res.status(500).json({
        success: false,
        error: { message: 'Vision service not properly configured' }
      });
    }

    // Convert base64 to buffer if needed
    let imageBuffer;
    if (typeof image === 'string' && image.startsWith('data:')) {
      // Handle data URL
      const base64Data = image.split(',')[1];
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else if (typeof image === 'string') {
      // Handle plain base64
      imageBuffer = Buffer.from(image, 'base64');
    } else {
      imageBuffer = Buffer.from(image);
    }

    // Perform text detection
    const [result] = await visionClient.textDetection({
      image: { content: imageBuffer }
    });

    const detections = result.textAnnotations;
    
    if (!detections || detections.length === 0) {
      return res.json({
        success: true,
        data: {
          podcast: null,
          episode: null,
          timestamp: null,
          text: ''
        }
      });
    }

    const text = detections[0].description;
    
    // Extract podcast information using regex patterns
    const podcastInfo = extractPodcastInfo(text);

    res.json({
      success: true,
      data: {
        ...podcastInfo,
        text: text
      }
    });

  } catch (error) {
    console.error('Error processing image:', error);
    
    res.status(500).json({
      success: false,
      error: {
        message: process.env.NODE_ENV === 'production' 
          ? 'Internal server error' 
          : error.message
      }
    });
  }
};

function extractPodcastInfo(text) {
  // Initialize result object
  const result = {
    podcast: null,
    episode: null,
    timestamp: null
  };

  // Common podcast app patterns
  const patterns = {
    // Spotify patterns
    spotify: {
      podcast: /^([^•]+)(?:•.*)?$/m,
      episode: /•\s*(.+?)(?:\s*•|\s*$)/,
      timestamp: /(\d{1,2}:\d{2}(?::\d{2})?)/
    },
    // Apple Podcasts patterns
    apple: {
      podcast: /^(.+?)\s*(?:\n|\r|$)/,
      episode: /(?:Episode|Ep\.?)\s*:?\s*(.+?)(?:\n|\r|$)/i,
      timestamp: /(\d{1,2}:\d{2}(?::\d{2})?)/
    },
    // Generic patterns
    generic: {
      podcast: /^(.+?)(?:\s*[-–—]\s*(.+?))?$/m,
      episode: /(?:Episode|Ep\.?|Part)\s*:?\s*(.+?)(?:\n|\r|$)/i,
      timestamp: /(\d{1,2}:\d{2}(?::\d{2})?)/
    }
  };

  // Try different patterns
  for (const [platform, platformPatterns] of Object.entries(patterns)) {
    if (!result.podcast) {
      const podcastMatch = text.match(platformPatterns.podcast);
      if (podcastMatch) {
        result.podcast = podcastMatch[1].trim();
      }
    }

    if (!result.episode) {
      const episodeMatch = text.match(platformPatterns.episode);
      if (episodeMatch) {
        result.episode = episodeMatch[1].trim();
      }
    }

    if (!result.timestamp) {
      const timestampMatch = text.match(platformPatterns.timestamp);
      if (timestampMatch) {
        result.timestamp = timestampMatch[1];
      }
    }
  }

  // Fallback: use first line as podcast name if nothing found
  if (!result.podcast) {
    const lines = text.split(/\n|\r/).filter(line => line.trim());
    if (lines.length > 0) {
      result.podcast = lines[0].trim();
    }
  }

  return result;
} 