import { ImageAnnotatorClient } from '@google-cloud/vision';

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
    console.log('✅ Vision client initialized successfully');
  } else {
    visionClient = new ImageAnnotatorClient();
    console.log('⚠️ Using default Vision client credentials');
  }
} catch (error) {
  console.error('❌ Error initializing Vision client:', error);
}

export default async function handler(req, res) {
  console.log(`🔥 API Called: ${req.method} /api/extract`);
  
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    console.log('✅ Handling OPTIONS preflight request');
    res.status(200).end();
    return;
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    console.log(`❌ Method ${req.method} not allowed`);
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({
      success: false,
      error: 'Method Not Allowed',
      allowedMethods: ['POST']
    });
  }

  try {
    console.log('📝 Request body keys:', Object.keys(req.body || {}));
    
    // Extract image data from request body
    const { image, images } = req.body;
    
    // Handle both single image and images array for flexibility
    let imagesToProcess = [];
    if (images && Array.isArray(images)) {
      imagesToProcess = images;
      console.log(`📸 Processing ${images.length} images`);
    } else if (image) {
      imagesToProcess = [image];
      console.log('📸 Processing single image');
    } else {
      console.log('❌ No image data provided');
      return res.status(400).json({
        success: false,
        error: 'Image data is required',
        expectedFormat: 'Provide either "image" (string) or "images" (array) in request body'
      });
    }

    if (!visionClient) {
      console.log('❌ Vision service not configured');
      return res.status(500).json({
        success: false,
        error: 'Vision service not properly configured',
        debug: 'Check GOOGLE_APPLICATION_CREDENTIALS environment variable'
      });
    }

    const results = [];
    
    for (let i = 0; i < imagesToProcess.length; i++) {
      const imageData = imagesToProcess[i];
      console.log(`🔍 Processing image ${i + 1}/${imagesToProcess.length}`);
      
      // Convert base64 to buffer
      let imageBuffer;
      try {
        if (typeof imageData === 'string' && imageData.startsWith('data:')) {
          // Handle data URL (data:image/jpeg;base64,...)
          const base64Data = imageData.split(',')[1];
          imageBuffer = Buffer.from(base64Data, 'base64');
          console.log(`✅ Converted data URL to buffer (${imageBuffer.length} bytes)`);
        } else if (typeof imageData === 'string') {
          // Handle plain base64
          imageBuffer = Buffer.from(imageData, 'base64');
          console.log(`✅ Converted base64 to buffer (${imageBuffer.length} bytes)`);
        } else {
          imageBuffer = Buffer.from(imageData);
          console.log(`✅ Converted data to buffer (${imageBuffer.length} bytes)`);
        }
      } catch (conversionError) {
        console.log(`❌ Error converting image ${i + 1}:`, conversionError);
        throw new Error(`Failed to convert image ${i + 1} to buffer`);
      }

      // Perform text detection
      console.log(`🔍 Calling Vision API for image ${i + 1}`);
      const [result] = await visionClient.textDetection({
        image: { content: imageBuffer }
      });

      const detections = result.textAnnotations;
      console.log(`📝 Found ${detections?.length || 0} text annotations`);
      
      if (!detections || detections.length === 0) {
        console.log(`⚠️ No text detected in image ${i + 1}`);
        results.push({
          podcast: null,
          episode: null,
          timestamp: null,
          text: '',
          confidence: 0
        });
        continue;
      }

      const fullText = detections[0].description;
      console.log(`📄 Extracted text preview: "${fullText?.substring(0, 100)}..."`);
      
      // Extract podcast information using regex patterns
      const podcastInfo = extractPodcastInfo(fullText);
      console.log(`🎧 Extracted podcast info:`, podcastInfo);

      results.push({
        ...podcastInfo,
        text: fullText,
        confidence: detections[0].boundingPoly ? 0.9 : 0.5 // Simple confidence based on bounding box
      });
    }

    console.log(`✅ Successfully processed ${results.length} images`);
    res.json({
      success: true,
      data: results.length === 1 ? results[0] : results,
      metadata: {
        processedImages: results.length,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error processing images:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to process images',
      details: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
      debug: process.env.NODE_ENV !== 'production' ? {
        stack: error.stack,
        visionClientConfigured: !!visionClient
      } : undefined
    });
  }
}

function extractPodcastInfo(text) {
  console.log('🔍 Extracting podcast info from text...');
  
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
        console.log(`🎧 Found podcast name (${platform}):`, result.podcast);
      }
    }

    if (!result.episode) {
      const episodeMatch = text.match(platformPatterns.episode);
      if (episodeMatch) {
        result.episode = episodeMatch[1].trim();
        console.log(`📺 Found episode name (${platform}):`, result.episode);
      }
    }

    if (!result.timestamp) {
      const timestampMatch = text.match(platformPatterns.timestamp);
      if (timestampMatch) {
        result.timestamp = timestampMatch[1];
        console.log(`⏰ Found timestamp (${platform}):`, result.timestamp);
      }
    }
  }

  // Fallback: use first line as podcast name if nothing found
  if (!result.podcast) {
    const lines = text.split(/\n|\r/).filter(line => line.trim());
    if (lines.length > 0) {
      result.podcast = lines[0].trim();
      console.log(`🎧 Using first line as podcast name:`, result.podcast);
    }
  }

  return result;
} 