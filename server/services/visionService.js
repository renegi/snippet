const vision = require('@google-cloud/vision');
const sharp = require('sharp');
const logger = require('../utils/logger');
const { getGoogleClientConfig } = require('../utils/googleCredentials');
const candidateMethods = require('./vision/candidates');
const timestampMethods = require('./vision/timestamp');
const pairingMethods = require('./vision/pairing');
const validationMethods = require('./vision/validation');

// Width (px) of the screenshots the pixel thresholds below were tuned on (iPhone 12-14)
const REFERENCE_WIDTH = 1170;

// Scales annotation coordinates and image dimensions so the image is REFERENCE_WIDTH wide.
// A no-op for images that already are; without dimensions, returns the input unchanged.
function normalizeToReferenceWidth(textAnnotations, imageDimensions) {
  if (!imageDimensions?.width || imageDimensions.width === REFERENCE_WIDTH) {
    return { textAnnotations, imageDimensions };
  }

  const scale = REFERENCE_WIDTH / imageDimensions.width;
  const scaleVertex = v => ({ ...v, x: (v.x || 0) * scale, y: (v.y || 0) * scale });

  return {
    textAnnotations: textAnnotations.map(annotation => ({
      ...annotation,
      boundingPoly: annotation.boundingPoly && {
        ...annotation.boundingPoly,
        vertices: (annotation.boundingPoly.vertices || []).map(scaleVertex)
      }
    })),
    imageDimensions: {
      width: REFERENCE_WIDTH,
      height: imageDimensions.height * scale
    }
  };
}

class VisionService {
  constructor() {
    this._client = null;
    
    // Configuration thresholds
    this.config = {
      minCandidateLength: 6,
      maxCandidateLength: 80,
      minWordCount: 2,
      lineTolerance: 18,
      validationConfidenceThreshold: 0.7,
      fallbackConfidenceThreshold: 0.6,
      maxCandidatesForValidation: 8
    };
  }

  // Created on first use so the OCR logic can be loaded (e.g. in tests) without credentials
  get client() {
    if (!this._client) {
      this._client = new vision.ImageAnnotatorClient(getGoogleClientConfig());
    }
    return this._client;
  }

  // Finds title candidates and the playback timestamp in Vision text annotations.
  // Geometry is first normalized to REFERENCE_WIDTH, because the filtering rules
  // use absolute pixel sizes tuned on screenshots of that width.
  analyzeAnnotations(textAnnotations, imageDimensions) {
    const normalized = normalizeToReferenceWidth(textAnnotations, imageDimensions);
    return {
      candidates: this.extractTextCandidates(normalized.textAnnotations, normalized.imageDimensions),
      timestamp: this.extractTimestamp(normalized.textAnnotations, normalized.imageDimensions)
    };
  }

  async getImageDimensions(image) {
    try {
      const metadata = await sharp(image).metadata();
      return {
        width: metadata.width,
        height: metadata.height
      };
    } catch (error) {
      logger.warn('Could not extract image dimensions, falling back to content-based calculations:', error.message);
      return null;
    }
  }

  // `image` is a Buffer (uploads are kept in memory) or a file path
  async extractText(image) {
    try {
      logger.debug('Starting Vision API text detection');
      
      // Extract image dimensions for image-relative filtering
      const imageDimensions = await this.getImageDimensions(image);
      logger.debug('Image dimensions:', imageDimensions);
      
      // Add timeout for large mobile images
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Vision API timeout - image too large or processing taking too long')), 30000);
      });
      
      const visionCall = this.client.textDetection(image);
      const [result] = await Promise.race([visionCall, timeout]).finally(() => clearTimeout(timeoutId));
      
      logger.debug('Vision API call completed successfully');
      const detections = result.textAnnotations;
      
      if (!detections || detections.length === 0) {
        throw new Error('No text detected in image');
      }

      const fullText = detections[0].description;
      logger.debug('OCR Full Text:', fullText);
      
      // Extract structured information with image dimensions
      const { candidates, timestamp } = this.analyzeAnnotations(detections, imageDimensions);
      logger.debug(`⏰ extractText - Timestamp extracted: ${timestamp}`);
      
      logger.debug(`Found ${candidates.length} text candidates`);
      
      // Validate candidates against podcast API
      const validationResult = await this.validateCandidates(candidates);
      
      return {
        podcastTitle: validationResult.podcastTitle,
        episodeTitle: validationResult.episodeTitle,
        timestamp: timestamp,
        player: validationResult.player || 'unknown',
        confidence: validationResult.confidence,
        validation: validationResult.validation,
        candidates: candidates.map(c => ({ text: c.text, score: c.score })), // For debugging
        rawText: fullText
      };
    } catch (error) {
      logger.error('Error in Vision API:', {
        error: error.message,
        code: error.code,
        stack: error.stack
      });
      
      // Provide more specific error messages
      if (error.message.includes('timeout')) {
        throw new Error('Image processing timed out - try a smaller image or crop the screenshot');
      } else if (error.message.includes('QUOTA_EXCEEDED')) {
        throw new Error('Google Vision API quota exceeded - please try again later');
      } else if (error.message.includes('INVALID_IMAGE')) {
        throw new Error('Invalid image format - please use PNG, JPG, or WebP');
        } else {
        throw new Error(`Vision API error: ${error.message}`);
      }
    }
  }

}

// The OCR pipeline's steps live in ./vision/ and are attached as methods
Object.assign(VisionService.prototype, candidateMethods, timestampMethods, pairingMethods, validationMethods);

module.exports = new VisionService();
module.exports.normalizeToReferenceWidth = normalizeToReferenceWidth; 