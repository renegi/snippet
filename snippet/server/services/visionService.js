const vision = require('@google-cloud/vision');

// Initialize Google Cloud Vision client
let visionClient;

try {
  // Try to use service account credentials from environment variable
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
    const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString());
    visionClient = new vision.ImageAnnotatorClient({ credentials });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    visionClient = new vision.ImageAnnotatorClient();
  } else {
    // Fallback to individual environment variables
    visionClient = new vision.ImageAnnotatorClient({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
    });
  }
} catch (error) {
  console.error('Error initializing Vision client:', error);
  visionClient = null;
}

async function extractTextFromImage(imagePath) {
  if (!visionClient) {
    throw new Error('Google Cloud Vision client not initialized');
  }

  try {
    const [result] = await visionClient.textDetection(imagePath);
    const detections = result.textAnnotations;

    if (!detections || detections.length === 0) {
      return { timestamp: null, title: null, episode: null };
    }

    const fullText = detections[0].description;
    const textBlocks = detections.slice(1); // Skip the first one as it contains all text

    // Extract timestamp (look for time patterns like 12:34 or 1:23:45)
    const timestamp = extractTimestamp(textBlocks);
    
    // Extract title and episode (look in bottom 50%-87.5% of screen)
    const { title, episode } = extractTitleAndEpisode(textBlocks);

    return { timestamp, title, episode };
  } catch (error) {
    console.error('Vision API error:', error);
    throw new Error('Failed to extract text from image');
  }
}

function extractTimestamp(textBlocks) {
  const timePattern = /(\d{1,2}):(\d{2})(?::(\d{2}))?/;
  
  // Sort by size (smaller text is more likely to be player timestamp)
  const sortedBlocks = textBlocks
    .filter(block => block.boundingPoly && block.boundingPoly.vertices)
    .sort((a, b) => {
      const aArea = getBoundingBoxArea(a.boundingPoly.vertices);
      const bArea = getBoundingBoxArea(b.boundingPoly.vertices);
      return aArea - bArea; // Sort by ascending size
    });

  for (const block of sortedBlocks) {
    const text = block.description;
    if (timePattern.test(text)) {
      return text;
    }
  }
  
  return null;
}

function extractTitleAndEpisode(textBlocks) {
  const imageHeight = 1000; // Assume standard height for calculations
  const primaryArea = { min: imageHeight * 0.5, max: imageHeight * 0.875 };
  const expandedArea = { min: imageHeight * 0.4, max: imageHeight * 0.9 };
  const fallbackArea = { min: imageHeight * 0.1, max: imageHeight * 0.9 };

  let title = null;
  let episode = null;

  // Try primary area first (50%-87.5%)
  const primaryBlocks = textBlocks.filter(block => {
    if (!block.boundingPoly || !block.boundingPoly.vertices) return false;
    const y = getAverageY(block.boundingPoly.vertices);
    return y >= primaryArea.min && y <= primaryArea.max;
  });

  if (primaryBlocks.length > 0) {
    const result = findTitleAndEpisode(primaryBlocks);
    if (result.title || result.episode) {
      return result;
    }
  }

  // Try expanded area (40%-90%)
  const expandedBlocks = textBlocks.filter(block => {
    if (!block.boundingPoly || !block.boundingPoly.vertices) return false;
    const y = getAverageY(block.boundingPoly.vertices);
    return y >= expandedArea.min && y <= expandedArea.max;
  });

  if (expandedBlocks.length > 0) {
    const result = findTitleAndEpisode(expandedBlocks, true);
    if (result.title || result.episode) {
      return result;
    }
  }

  // Fallback to bottom 90% with more lenient filtering
  const fallbackBlocks = textBlocks.filter(block => {
    if (!block.boundingPoly || !block.boundingPoly.vertices) return false;
    const y = getAverageY(block.boundingPoly.vertices);
    return y >= fallbackArea.min && y <= fallbackArea.max;
  });

  return findTitleAndEpisode(fallbackBlocks, true);
}

function findTitleAndEpisode(blocks, isFallback = false) {
  const adKeywords = ['ad', 'advertisement', 'sponsored', 'promotion'];
  
  // Sort by Y position (top to bottom)
  const sortedBlocks = blocks
    .filter(block => {
      const text = block.description.toLowerCase();
      // Filter out ad-related text
      return !adKeywords.some(keyword => text.includes(keyword));
    })
    .sort((a, b) => getAverageY(a.boundingPoly.vertices) - getAverageY(b.boundingPoly.vertices));

  let title = null;
  let episode = null;

  for (const block of sortedBlocks) {
    const text = block.description.trim();
    
    // Skip very short text or obvious non-title text
    if (text.length < 3 || text.length > 100) continue;
    
    // Look for episode patterns
    if (!episode && (text.includes('Episode') || text.includes('Ep.') || /\d+/.test(text))) {
      episode = text;
    }
    // Look for title (usually longer text without episode indicators)
    else if (!title && !text.includes('Episode') && !text.includes('Ep.')) {
      title = text;
    }
  }

  return { title, episode };
}

function getAverageY(vertices) {
  return vertices.reduce((sum, vertex) => sum + vertex.y, 0) / vertices.length;
}

function getBoundingBoxArea(vertices) {
  const width = Math.abs(vertices[1].x - vertices[0].x);
  const height = Math.abs(vertices[2].y - vertices[1].y);
  return width * height;
}

module.exports = {
  extractTextFromImage
}; 