const vision = require('@google-cloud/vision');
const logger = require('../utils/logger');
const applePodcastsService = require('./applePodcastsService');

class VisionService {
  constructor() {
    // Handle different authentication methods for different environments
    let clientConfig = {};
    
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
      // For Render: decode base64 credentials
      try {
        const credentials = JSON.parse(
          Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString()
        );
        clientConfig = {
          credentials: credentials,
          projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || credentials.project_id
        };
      } catch (error) {
        console.error('Error parsing base64 credentials:', error);
        throw error;
      }
    } else if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      // Alternative: individual credential fields
      clientConfig = {
        credentials: {
          client_email: process.env.GOOGLE_CLIENT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          type: 'service_account'
        },
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
      };
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      // For local development: use file path
      clientConfig = {
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
      };
    } else {
      throw new Error('No valid Google Cloud credentials found. Please set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY, or GOOGLE_APPLICATION_CREDENTIALS_BASE64');
    }
    
    this.client = new vision.ImageAnnotatorClient(clientConfig);
    
    // Configuration thresholds
    this.config = {
      minCandidateLength: 6,
      maxCandidateLength: 80,
      minWordCount: 2,
      lineTolerance: 10,
      validationConfidenceThreshold: 0.7,
      fallbackConfidenceThreshold: 0.6,
      maxCandidatesForValidation: 8
    };
  }

  async extractText(imagePath) {
    try {
      logger.info('📱 Mobile Debug: Starting Vision API text detection', {
        imagePath,
        fileExists: require('fs').existsSync(imagePath)
      });
      
      // Add timeout for large mobile images
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Vision API timeout - image too large or processing taking too long')), 30000)
      );
      
      const visionCall = this.client.textDetection(imagePath);
      const [result] = await Promise.race([visionCall, timeout]);
      
      logger.info('📱 Mobile Debug: Vision API call completed successfully');
      const detections = result.textAnnotations;
      
      if (!detections || detections.length === 0) {
        throw new Error('No text detected in image');
      }

      const fullText = detections[0].description;
      logger.info('OCR Full Text:', fullText);
      
      // Extract structured information
      const candidates = this.extractTextCandidates(detections);
      const timestamp = this.extractTimestamp(detections);
      logger.info(`📱 Mobile Debug: extractText - Timestamp extracted: ${timestamp}`);
      
      logger.info(`Found ${candidates.length} text candidates`);
      
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
      logger.error('📱 Mobile Debug: Error in Vision API:', {
        error: error.message,
        code: error.code,
        stack: error.stack,
        imagePath
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

  extractTextCandidates(textAnnotations) {
    const individualTexts = textAnnotations.slice(1);
    
    // Group words into lines
    const lines = this.groupWordsIntoLines(individualTexts);
    
    logger.info(`📱 Mobile Debug: All lines before position filtering:`, lines.map(line => 
      `"${line.text}" (Y: ${line.avgY}, X: ${line.words ? line.words[0].boundingPoly.vertices[0].x : 0}, Area: ${line.avgArea})`
    ));
    
    // Use position-based filtering to focus on podcast content area
    const filteredLines = this.filterByPosition(lines);
    
    // Filter and score candidates
    const candidates = filteredLines
      .filter(line => this.isValidCandidate(line))
      .map(line => this.scoreCandidate(line))
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.maxCandidatesForValidation);
    
    logger.info('Text candidates:', candidates.map(c => `"${c.text}" (score: ${c.score.toFixed(2)})`));
    
    return candidates;
  }

  filterByPosition(lines) {
    if (lines.length === 0) return lines;
    
    logger.info(`📱 Mobile Debug: Position filtering ${lines.length} input lines`);
    
    // Calculate image dimensions
    const maxY = Math.max(...lines.map(line => line.avgY));
    const minY = Math.min(...lines.map(line => line.avgY));
    const imageHeight = maxY - minY;
    const imageWidth = Math.max(...lines.map(line => 
      line.words ? Math.max(...line.words.map(w => w.boundingPoly.vertices[1].x)) : 0
    ));
    
    logger.info(`📱 Mobile Debug: Image dimensions: ${imageWidth}x${imageHeight}`);
    logger.info(`📱 Mobile Debug: minY: ${minY}, maxY: ${maxY}, imageHeight: ${imageHeight}`);
    
    // PRIMARY STRATEGY: Focus on the podcast content area (50%-87.5% of screen height)
    const primaryStartY = minY + (imageHeight * 0.50);  // 50% from top
    const primaryEndY = minY + (imageHeight * 0.875);   // 87.5% from top
    
    logger.info(`📱 Mobile Debug: Primary range: ${primaryStartY}-${primaryEndY} (50%-87.5%)`);
    
    const primaryFiltered = lines.filter(line => {
      // Must be in the primary content area
      if (line.avgY < primaryStartY || line.avgY > primaryEndY) {
        logger.info(`📱 Mobile Debug: Excluding "${line.text}" - Y: ${line.avgY}, range: ${primaryStartY}-${primaryEndY}`);
        return false;
      }
      
      // Exclude very large text (likely system UI or clock displays)
      if (line.avgArea > 50000) {
        logger.info(`📱 Mobile Debug: Excluding very large text: "${line.text}" (area: ${line.avgArea})`);
        return false;
      }
      
      logger.debug(`📱 Including line "${line.text}" - Y: ${line.avgY}, range: ${primaryStartY}-${primaryEndY}`);
      return true;
    });
    
    logger.info(`📱 Mobile Debug: Primary area (50%-87.5%) filtered to ${primaryFiltered.length} lines`);
    if (primaryFiltered.length > 0) {
      logger.info(`📱 Mobile Debug: Included lines:`, primaryFiltered.map(line => 
        `"${line.text}" (Y: ${line.avgY})`
      ));
    }
    
    // If primary strategy found good candidates, use them
    if (primaryFiltered.length >= 2) {
      return primaryFiltered;
    }
    
    // If primary area has some candidates but not enough, try to include upper content
    if (primaryFiltered.length === 1) {
      logger.info('📱 Mobile Debug: Primary area has 1 candidate, trying to include upper content');
      const upperStartY = minY + (imageHeight * 0.20);  // 20% from top
      const upperEndY = minY + (imageHeight * 0.50);    // 50% from top
      
      const upperFiltered = lines.filter(line => {
        if (line.avgY < upperStartY || line.avgY > upperEndY) {
          return false;
        }
        
        // Exclude very large text (likely system UI)
        if (line.avgArea > 5000) {
          return false;
        }
        
        return true;
      });
      
      logger.info(`📱 Mobile Debug: Upper area (20%-50%) filtered to ${upperFiltered.length} lines`);
      
      // Combine primary and upper candidates
      const combinedCandidates = [...primaryFiltered, ...upperFiltered];
      if (combinedCandidates.length >= 2) {
        logger.info(`📱 Mobile Debug: Combined candidates: ${combinedCandidates.length} total`);
        return combinedCandidates;
      }
    }
    
    // FALLBACK STRATEGY: Search in 10%-20% area (upper content area)
    logger.info('📱 Mobile Debug: Primary area insufficient, trying fallback area (10%-20%)');
    const fallbackStartY = minY + (imageHeight * 0.10);  // 10% from top
    const fallbackEndY = minY + (imageHeight * 0.20);    // 20% from top
    
    const fallbackFiltered = lines.filter(line => {
      // Must be in the fallback content area
      if (line.avgY < fallbackStartY || line.avgY > fallbackEndY) {
        return false;
      }
      
      // Exclude very large text (likely system UI)
      if (line.avgArea > 5000) {
        return false;
      }
      
      return true;
    });
    
    logger.info(`📱 Mobile Debug: Fallback area (10%-20%) filtered to ${fallbackFiltered.length} lines`);
    
    // If fallback found candidates, use them
    if (fallbackFiltered.length >= 2) {
      return fallbackFiltered;
    }
    
    // LAST RESORT: Very lenient filtering
    logger.info('📱 Mobile Debug: Both areas insufficient, using very lenient fallback');
    const excludeTopThreshold = minY + (imageHeight * 0.15);
    const excludeBottomThreshold = maxY - (imageHeight * 0.05);
    
    const lastResortFiltered = lines.filter(line => {
      // Basic position filtering
      if (line.avgY < excludeTopThreshold || line.avgY > excludeBottomThreshold) {
        return false;
      }
      
      // Only exclude very obvious system text
      if (line.avgY < excludeTopThreshold * 1.2 && line.avgArea > 10000) {
        return false;
      }
      
      return true;
    });
    
    logger.info(`📱 Mobile Debug: Last resort filtered to ${lastResortFiltered.length} lines`);
    return lastResortFiltered;
  }

  groupWordsIntoLines(individualTexts) {
    const lines = [];
    
    individualTexts.forEach(word => {
      const y = word.boundingPoly.vertices[0].y;
      const x = word.boundingPoly.vertices[0].x;
      let line = lines.find(l => Math.abs(l.avgY - y) < this.config.lineTolerance);
      
      if (!line) {
        line = { avgY: y, words: [] };
        lines.push(line);
      }
      line.words.push(word);
    });

    // Convert to text lines with metadata including horizontal position
    return lines.map(line => {
      const sortedWords = line.words.sort((a, b) => 
        a.boundingPoly.vertices[0].x - b.boundingPoly.vertices[0].x
      );
      
      const text = sortedWords.map(w => w.description).join(' ').trim();
      const avgArea = this.calculateAverageArea(sortedWords);
      const avgY = line.avgY;
      const avgX = sortedWords.reduce((sum, w) => sum + w.boundingPoly.vertices[0].x, 0) / sortedWords.length;
      
      return {
        text,
        avgY,
        avgX,  // Add horizontal position for album art filtering
        avgArea,
        wordCount: sortedWords.length,
        words: sortedWords  // Keep reference for position calculations
      };
    });
  }

  calculateAverageArea(words) {
    const totalArea = words.reduce((sum, word) => {
      const v = word.boundingPoly.vertices;
      const width = Math.abs(v[1].x - v[0].x);
      const height = Math.abs(v[2].y - v[0].y);
      return sum + (width * height);
    }, 0);
    
    return totalArea / words.length;
  }

  isValidCandidate(line) {
    const text = line.text.toLowerCase().trim();
    const originalText = line.text.trim();
    
    logger.info(`📱 Mobile Debug: isValidCandidate checking: "${originalText}" (area: ${line.avgArea}, wordCount: ${line.wordCount}, length: ${text.length}, config range: ${this.config.minCandidateLength}-${this.config.maxCandidateLength})`);
    
    // Basic length and word count filters - be more lenient for single words
    if (text.length < this.config.minCandidateLength || 
        text.length > this.config.maxCandidateLength) {
        logger.info(`📱 Mobile Debug: Rejecting "${originalText}" - length ${text.length} outside range ${this.config.minCandidateLength}-${this.config.maxCandidateLength}`);
        return false;
      }
      
    // For word count: allow single words if they're substantial (like podcast names)
    if (line.wordCount < 1) {
        logger.info(`📱 Mobile Debug: Rejecting "${originalText}" - word count ${line.wordCount} < 1`);
        return false;
      }
      
    // Exclude system UI text patterns
    const systemUITexts = [
      'recarga optimizada',
      'el final de la recarga está programado',
      'para las',
      'sueño',
      'wi-fi',
      'miércoles',
      'julio'
    ];
    
    if (systemUITexts.some(systemText => text.includes(systemText))) {
      logger.info(`📱 Mobile Debug: Rejecting "${originalText}" - system UI text`);
      return false;
    }
    
    // Exclude very small text (likely thumbnail overlays or UI elements)
    if (line.avgArea < 2500) {
      logger.info(`📱 Mobile Debug: Rejecting "${originalText}" - area ${line.avgArea} < 2500`);
      return false;
    }
    
    logger.info(`📱 Mobile Debug: "${originalText}" passed area check (area: ${line.avgArea})`);
      
    // If it's a single word, it should be substantial (not just a short word)
    if (line.wordCount === 1 && text.length < 6) {
        logger.info(`📱 Mobile Debug: Rejecting "${originalText}" - single word too short (length: ${text.length})`);
        return false;
      }
      
    // Language-agnostic pattern-based filtering
    
    // 1. Time patterns (any language)
    if (this.isTimePattern(text)) {
        return false;
      }
      
    // 2. Date patterns (any language)
    if (this.isDatePattern(text)) {
        return false;
      }
      
    // 3. Percentage patterns
    if (/\b\d+%/.test(text)) {
        return false;
      }
      
    // 4. Pure numbers or symbols
    if (/^[\d\s\-:]+$/.test(text) || /^[^\w\s]+$/.test(text)) {
        return false;
      }
      
    // 5. Single character or very short words
    if (/^.{1,2}$/.test(text.replace(/\s/g, ''))) {
        return false;
      }
      
    // 6. All caps - BUT only if short and likely UI elements
    // Allow longer all caps text that could be podcast names
    if (originalText === originalText.toUpperCase() && 
        originalText.length > 3 && 
        originalText.length < 15 && 
        line.wordCount <= 2) {
      logger.info(`📱 Mobile Debug: Rejecting "${originalText}" - all caps and short (length: ${originalText.length}, words: ${line.wordCount})`);
      return false;
    }
    
    // 7. Starts with lowercase - ALLOW ALL (removed filter)
    // This allows truncated episode titles and other content that starts with lowercase
    
    // 8. Contains ellipsis (truncated) - BUT don't filter out completely
    if (/\.{3,}|…/.test(text)) {
      // Allow if it's substantial content
      if (text.length < 15) {
        return false;
      }
    }
    
    // 9. Structural indicators of system text
    if (this.hasSystemTextStructure(text, line)) {
      return false;
    }
    
    logger.info(`📱 Mobile Debug: "${originalText}" PASSED all filters!`);
    return true;
  }

  isTimePattern(text) {
    // Time formats: 12:34, 1:23:45, 12:34 AM, etc.
    const timePatterns = [
      /^\d{1,2}:\d{2}(:\d{2})?(\s*(am|pm|a\.m\.|p\.m\.))?$/i,
      /^\d{1,2}:\d{2}$/, // Simple time
    ];
    
    return timePatterns.some(pattern => pattern.test(text));
  }

  isDatePattern(text) {
    // Universal date indicators (language-agnostic)
    
    // Contains numbers with date-like separators
    if (/\d+[\/\-\.]\d+([\/\-\.]\d+)?/.test(text)) {
      return true;
    }
    
    // Day-month patterns (any language)
    if (/\d{1,2}\s+\w+/.test(text) && text.length < 25) {
      return true;
    }
    
    // Month-day patterns 
    if (/\w+\s+\d{1,2}/.test(text) && text.length < 25) {
      return true;
    }
    
    // Contains "de" pattern common in Romance languages for dates
    if (/\d+\s+de\s+\w+/.test(text)) {
      return true;
    }
    
    // Weekday patterns (usually start with capital and are single words or short phrases)
    if (/^[A-Z]\w+,/.test(text) && text.length < 20) {
      return true;
    }
    
    return false;
  }

  hasSystemTextStructure(text, line) {
    // Structural indicators that suggest system text regardless of language
    
    // 1. Very small font BUT preserve potential timestamps
    if (line.avgArea < 300 && !this.couldBeTimestamp(text)) {
      return true;
    }
    
    // 2. Contains numbers and short words (common in system text)
    const words = text.split(/\s+/);
    const hasNumbers = /\d/.test(text);
    const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
    
    if (hasNumbers && avgWordLength < 4 && words.length <= 4 && !this.couldBeTimestamp(text)) {
      return true;
    }
    
    // 3. Contains colon followed by numbers (often time or status) - but check if it's a clock
    if (/:\s*\d/.test(text) && this.isClockTime(text, line)) {
      return true;
    }
    
    // 4. Starts with numbers (often metadata) - but not timestamps
    if (/^\d/.test(text) && text.length < 15 && !this.couldBeTimestamp(text)) {
      return true;
    }
    
    // 5. Contains special characters suggesting UI elements
    if (/[→←↑↓▶◀⏸⏯⏭⏮🔄🔀]/.test(text)) {
      return true;
    }
    
    return false;
  }

  couldBeTimestamp(text) {
    // Check if text could be a podcast timestamp
    // Podcast timestamps: "15:14", "1:23:45", "0:45", etc.
    return /^\d{1,2}:\d{2}(:\d{2})?$/.test(text.trim());
  }

  isClockTime(text, line) {
    // Distinguish between clock times (like "11:03") and podcast timestamps
    
    // 1. Very large text is likely a clock display
    if (line.avgArea > 5000) {
      return true;
    }
    
    // 2. Check position - clocks are usually in upper portion of screen
    // This will be refined by our position filtering, but add extra check
    if (line.avgY < 500 && line.avgArea > 2000) { // Top area + large font
      return true;
    }
    
    // 3. Single time without context (no progress bar nearby) suggests clock
    // This is harder to detect structurally, but very large isolated times are usually clocks
    if (line.avgArea > 3000 && /^\d{1,2}:\d{2}$/.test(text.trim())) {
      return true;
    }
    
          return false;
  }

  scoreCandidate(line) {
    let score = 0;
    const text = line.text.toLowerCase();
    const originalText = line.text.trim();
    
    // Font size indicator (larger text is more likely to be titles)
    score += Math.min(line.avgArea / 1000, 5);
    
    // Length preference (moderate length is good for titles)
    const lengthScore = text.length >= 15 && text.length <= 50 ? 2 : 
                       text.length >= 10 && text.length <= 60 ? 1 : 0;
    score += lengthScore;
    
    // Word count preference
    if (line.wordCount >= 3 && line.wordCount <= 8) score += 2;
    else if (line.wordCount >= 2) score += 1;
    
    // Content indicators that suggest podcast/episode titles
    const positiveIndicators = [
      /\b(episode|ep|part|pt|chapter)\b/i,
      /\b(with|featuring|interview|conversation|discussion)\b/i,
      /\?\s*$/,  // Questions often make good episode titles
      /\b(how|what|why|where|when|who)\b/i,
      /\b(the|a|an)\b/i  // Articles often in titles
    ];
    
    positiveIndicators.forEach(pattern => {
      if (pattern.test(text)) score += 1;
    });
    
    // Boost for proper nouns (likely podcast/episode names)
    if (/^[A-Z]/.test(originalText) && /[A-Z][a-z]/.test(originalText)) {
      score += 1.5;
    }
    
    // Boost for all caps if it's likely a podcast name (longer text)
    if (originalText === originalText.toUpperCase() && 
        originalText.length >= 15 && 
        line.wordCount >= 2) {
      score += 1; // Could be a podcast name like "BIG PICTURE SCIENCE"
    }
    
    // Boost for question format
    if (originalText.includes('?')) {
      score += 1;
    }
    
    // Handle truncated text - look for reconstruction opportunities
    if (this.isPotentiallyTruncated(originalText)) {
      // Penalize truncated text but don't eliminate completely
      score *= 0.7;
      // Mark for potential reconstruction
      line.isTruncated = true;
    }
    
    // Penalize if it looks like metadata (language-agnostic patterns only)
    const negativeIndicators = [
      /\b\d+\s*(min|mins|minutes|hour|hours|hr|hrs)\b/i,  // Duration patterns
      /\b(ago|yesterday|today|tomorrow)\b/i,              // Time references (English only for now)
      /^\d+$/,  // Just numbers
    ];
    
    negativeIndicators.forEach(pattern => {
      if (pattern.test(text)) score -= 2;
    });
    
    return {
      text: originalText,
      avgY: line.avgY,
      avgArea: line.avgArea,
      wordCount: line.wordCount,
      score: Math.max(0, score),
      isTruncated: line.isTruncated || false
    };
  }

  isPotentiallyTruncated(text) {
    // Check for ellipsis or truncation indicators
    if (text.includes('...') || text.includes('…')) {
      return true;
    }
    
    // Check for incomplete words at the end
    if (text.match(/\b\w{1,2}$/) && text.length > 10) {
      return true;
    }
    
    // Starting with lowercase (mid-sentence)
    if (text.match(/^[a-z]/)) {
      return true;
    }
    
    // Ending with incomplete word patterns
    if (text.match(/\w+\s+[a-z]{1,3}$/)) {
      return true;
    }
    
    return false;
  }

  async validateCandidates(candidates) {
    logger.info('Starting spatial pair validation process...');
    
    // Strategy 1: Find spatially close pairs and validate them
    const spatialPairs = this.findSpatialPairs(candidates);
    
    // Validate spatial pairs and collect results, with early exit for high confidence
    const spatialResults = [];
    for (const pair of spatialPairs) {
      logger.info(`Testing spatial pair: top="${pair.top.text}" bottom="${pair.bottom.text}" (distance: ${pair.distance}px)`);
      
      // Test assumption: bottom = podcast, top = episode
      const result1 = await this.validateSpatialPair(pair.bottom, pair.top, 'podcast-episode');
      if (result1.success) {
        logger.info('Spatial pair validation successful (bottom=podcast, top=episode)');
        spatialResults.push({
          ...result1,
          pair,
          method: 'spatial_bottom_podcast_top_episode'
        });
        
        // If this result has high confidence, we can stop testing more pairs
        if (result1.confidence >= 0.5) {
          logger.info(`High-confidence result found (${result1.confidence}), stopping spatial pair validation`);
          break;
        }
      }
      
      // Fallback: top = podcast, bottom = episode
      const result2 = await this.validateSpatialPair(pair.top, pair.bottom, 'episode-podcast');
      if (result2.success) {
        logger.info('Spatial pair validation successful (top=podcast, bottom=episode)');
        spatialResults.push({
          ...result2,
          pair,
          method: 'spatial_top_podcast_bottom_episode'
        });
        
        // If this result has high confidence, we can stop testing more pairs
        if (result2.confidence >= 0.5) {
          logger.info(`High-confidence result found (${result2.confidence}), stopping spatial pair validation`);
          break;
        }
      }
    }
    
    // If we found spatial pair results, check if we need to test all pairs
    if (spatialResults.length > 0) {
      // Sort by confidence (highest first)
      spatialResults.sort((a, b) => b.confidence - a.confidence);
      const bestResult = spatialResults[0];
      
      // If the best result has high confidence (>= 0.5), return it immediately
      if (bestResult.confidence >= 0.5) {
        logger.info(`Returning high-confidence spatial pair result: ${bestResult.podcastTitle} - ${bestResult.episodeTitle} (confidence: ${bestResult.confidence})`);
        return bestResult;
      }
      
      // If confidence is low (< 0.5), we already tested all pairs, so return the best one
      logger.info(`Returning best spatial pair result (low confidence): ${bestResult.podcastTitle} - ${bestResult.episodeTitle} (confidence: ${bestResult.confidence})`);
      return bestResult;
    }
    
    // Strategy 2: If no spatial pairs work, try individual candidates as podcasts
    logger.info('No spatial pairs validated, trying individual candidates...');
    
    // Try each candidate as a podcast with episode validation
    for (const candidate of candidates) {
      logger.info(`Trying individual candidate as podcast: "${candidate.text}"`);
      
      // Find the closest candidate directly above or below (Y-axis only)
      const otherCandidates = candidates.filter(c => c.text !== candidate.text);
      const episodeCandidate = this.findClosestVerticalCandidate(candidate, otherCandidates);
      
      if (episodeCandidate) {
        logger.info(`Found closest vertical candidate: "${episodeCandidate.text}" (${Math.abs(episodeCandidate.avgY - candidate.avgY)}px away)`);
        
        // Use the new improved validation flow
        const result = await this.validatePodcastWithEpisodeValidation(candidate.text, episodeCandidate.text);
        
        if (result.success) {
          logger.info(`Individual candidate validation successful: "${result.podcastTitle}" - "${result.episodeTitle}"`);
          return {
            ...result,
            validation: {
              ...result.validation,
              method: 'individual_candidate_with_episode',
              candidate: candidate.text,
              episodeCandidate: episodeCandidate.text
            }
          };
        }
      }
      
      // If no episode candidate found, try broad episode search
      logger.info(`Trying broad episode search for candidate: "${candidate.text}"`);
      try {
        const episodeResults = await applePodcastsService.searchEpisodes(null, candidate.text);
        
        if (episodeResults && episodeResults.length > 0) {
          const bestMatch = episodeResults[0];
          logger.info(`Episode search match found: ${bestMatch.trackName} from ${bestMatch.collectionName}`);
          
          return {
            podcastTitle: bestMatch.collectionName,
            episodeTitle: bestMatch.trackName,
            confidence: 0.8,
            validation: {
              validated: true,
              method: 'episode_search',
              originalCandidate: candidate.text
            },
            player: 'validated'
          };
        }
      } catch (error) {
        logger.debug(`Episode search error for ${candidate.text}:`, error.message);
      }
    }
    
    // Fallback: No validation successful, return "Episode not found"
    logger.info('No validation successful, returning "Episode not found"');
    
    return {
      podcastTitle: 'Episode not found',
      episodeTitle: 'Episode not found',
      confidence: 0.0,
      validation: { validated: false, method: 'no_validation_successful' },
      player: 'unvalidated'
    };
  }

  findSpatialPairs(candidates) {
    const pairs = [];
    const maxVerticalDistance = 100; // Maximum vertical distance for pairing
    const maxHorizontalOverlap = 0.7; // Allow some horizontal overlap but ensure they're distinct
    
    // Sort candidates by Y position (top to bottom)
    const sortedCandidates = [...candidates].sort((a, b) => a.avgY - b.avgY);
    
    for (let i = 0; i < sortedCandidates.length; i++) {
      for (let j = i + 1; j < sortedCandidates.length; j++) {
        const candidate1 = sortedCandidates[i]; // Higher on screen (lower Y)
        const candidate2 = sortedCandidates[j]; // Lower on screen (higher Y)
        
        // Calculate vertical distance (Y-axis only)
        const verticalDistance = candidate2.avgY - candidate1.avgY;
        
        // Skip if vertical distance is too large
        if (verticalDistance > maxVerticalDistance) {
          // Since we're sorted by Y, all subsequent pairs with candidate1 will be too far
          break;
        }
        
        // Prevent same or very similar text from being paired together
        const similarity = this.calculateTextSimilarity(candidate1.text, candidate2.text);
        if (similarity > 0.8) {
          logger.debug(`Skipping similar text pair: "${candidate1.text}" vs "${candidate2.text}" (similarity: ${similarity.toFixed(3)})`);
          continue;
        }
        
        // Calculate horizontal overlap to ensure they're not the same text block
        const x1Start = candidate1.words?.[0]?.boundingPoly?.vertices?.[0]?.x || 0;
        const x1End = candidate1.words?.[candidate1.words.length - 1]?.boundingPoly?.vertices?.[1]?.x || 0;
        const x2Start = candidate2.words?.[0]?.boundingPoly?.vertices?.[0]?.x || 0;
        const x2End = candidate2.words?.[candidate2.words.length - 1]?.boundingPoly?.vertices?.[1]?.x || 0;
        
        const overlap = Math.max(0, Math.min(x1End, x2End) - Math.max(x1Start, x2Start));
        const minWidth = Math.min(x1End - x1Start, x2End - x2Start);
        const overlapRatio = minWidth > 0 ? overlap / minWidth : 0;
        
        // Skip if too much horizontal overlap (likely same text block)
        if (overlapRatio > maxHorizontalOverlap) {
          logger.debug(`Skipping overlapping text: "${candidate1.text}" vs "${candidate2.text}" (overlap: ${(overlapRatio * 100).toFixed(1)}%)`);
          continue;
        }
        
        pairs.push({
          top: candidate1,
          bottom: candidate2,
          distance: verticalDistance,
          similarity: similarity,
          horizontalOverlap: overlapRatio
        });
      }
    }
    
    // Sort pairs by candidate scores (higher scores first), then by Y position, then by distance
    pairs.sort((a, b) => {
      // First priority: Higher scoring candidates (better quality text)
      const aScore = Math.max(a.top.score || 0, a.bottom.score || 0);
      const bScore = Math.max(b.top.score || 0, b.bottom.score || 0);
      
      if (Math.abs(aScore - bScore) > 1) {
        // If scores are significantly different, prioritize higher scores
        return bScore - aScore;
      }
      
      // Second priority: Higher pairs (lower Y values) are preferred
      const aAvgY = (a.top.avgY + a.bottom.avgY) / 2;
      const bAvgY = (b.top.avgY + b.bottom.avgY) / 2;
      
      if (Math.abs(aAvgY - bAvgY) > 50) {
        return aAvgY - bAvgY;
      }
      
      // Third priority: Closer pairs (smaller distance)
      if (Math.abs(a.distance - b.distance) > 10) {
        return a.distance - b.distance;
      }
      
      // Fourth priority: Lower similarity (more distinct text)
      return a.similarity - b.similarity;
    });
    
    logger.info(`Found ${pairs.length} spatial pairs:`, pairs.map(p => {
      const avgY = (p.top.avgY + p.bottom.avgY) / 2;
      return `"${p.top.text}" + "${p.bottom.text}" (avgY: ${avgY.toFixed(0)}, ${p.distance}px apart, similarity: ${(p.similarity * 100).toFixed(1)}%)`;
    }));
    
    return pairs;
  }

  // Helper function to calculate text similarity
  calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    
    const normalize = (text) => text.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const norm1 = normalize(text1);
    const norm2 = normalize(text2);
    
    if (norm1 === norm2) return 1.0;
    
    // Use Levenshtein distance for similarity
    const maxLen = Math.max(norm1.length, norm2.length);
    if (maxLen === 0) return 1.0;
    
    const distance = this.levenshteinDistance(norm1, norm2);
    return 1 - (distance / maxLen);
  }

  // Levenshtein distance implementation
  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  // Find the closest candidate directly above or below (Y-axis only)
  findClosestVerticalCandidate(targetCandidate, otherCandidates) {
    if (!otherCandidates || otherCandidates.length === 0) return null;
    
    const targetY = targetCandidate.avgY;
    const maxVerticalDistance = 100; // Same as spatial pairing
    
    // Find candidates within vertical distance
    const nearbyVerticalCandidates = otherCandidates.filter(candidate => {
      const distance = Math.abs(candidate.avgY - targetY);
      return distance <= maxVerticalDistance && distance > 0; // Exclude same position
    });
    
    if (nearbyVerticalCandidates.length === 0) return null;
    
    // Sort by vertical distance (closest first)
    nearbyVerticalCandidates.sort((a, b) => {
      const distanceA = Math.abs(a.avgY - targetY);
      const distanceB = Math.abs(b.avgY - targetY);
      return distanceA - distanceB;
    });
    
    logger.debug(`Found ${nearbyVerticalCandidates.length} vertical candidates for "${targetCandidate.text}"`);
    
    return nearbyVerticalCandidates[0]; // Return the closest one
  }

  async validateSpatialPair(podcastCandidate, episodeCandidate, pairType) {
    try {
      logger.info(`Validating spatial pair (${pairType}): podcast="${podcastCandidate.text}" episode="${episodeCandidate.text}"`);
      
      // Use the new improved validation flow
      const result = await this.validatePodcastWithEpisodeValidation(podcastCandidate.text, episodeCandidate.text);
      
      if (result.success) {
        // Add spatial pair context to the validation
        result.validation.podcastCandidate = podcastCandidate.text;
        result.validation.episodeCandidate = episodeCandidate.text;
        result.validation.pairType = pairType;
        return result;
      }
      
      // If the first direction fails, try the reverse direction
      logger.info(`Trying reverse direction for spatial pair (${pairType}): podcast="${episodeCandidate.text}" episode="${podcastCandidate.text}"`);
      const reverseResult = await this.validatePodcastWithEpisodeValidation(episodeCandidate.text, podcastCandidate.text);
      
      if (reverseResult.success) {
        // Add spatial pair context to the validation
        reverseResult.validation.podcastCandidate = episodeCandidate.text;
        reverseResult.validation.episodeCandidate = podcastCandidate.text;
        reverseResult.validation.pairType = `${pairType}_reversed`;
        return reverseResult;
      }
      
      logger.info(`No validation successful for spatial pair (${pairType}): podcast="${podcastCandidate.text}" episode="${episodeCandidate.text}"`);
      return { success: false };
      
    } catch (error) {
      logger.error(`Error validating spatial pair:`, error);
      return { success: false };
    }
  }

  async fuzzySearchEpisode(validatedPodcast, episodeText) {
    try {
      // Get all episodes for this podcast
      const episodesResult = await applePodcastsService.searchEpisodes(validatedPodcast.id, null);
      const allEpisodes = episodesResult.episodes || [];
      
      if (!allEpisodes || allEpisodes.length === 0) {
        return { success: false };
      }
      
      // Extract keywords from the episode candidate text
      const keywords = this.extractKeywords(episodeText);
      
      if (keywords.length === 0) {
        logger.info(`No keywords extracted from "${episodeText}"`);
        return { success: false };
      }
      
      logger.info(`Fuzzy searching with keywords: [${keywords.join(', ')}] among ${allEpisodes.length} episodes`);
      
      // Find episodes that match multiple keywords with improved fuzzy matching
      const matchingEpisodes = allEpisodes.map(episode => {
        const episodeTitle = episode.trackName.toLowerCase();
        
        // Check for exact keyword matches
        const exactMatches = keywords.filter(keyword => episodeTitle.includes(keyword));
        
        // Check for partial word matches (for truncated text)
        const partialMatches = keywords.filter(keyword => {
          const words = episodeTitle.split(/\s+/);
          return words.some(word => word.startsWith(keyword) || keyword.startsWith(word));
        });
        
        // Combine exact and partial matches, giving partial matches half weight
        const totalMatches = exactMatches.length + (partialMatches.length * 0.5);
        const matchScore = totalMatches / keywords.length;
        
        return {
          episode,
          matchedKeywords: [...exactMatches, ...partialMatches.filter(k => !exactMatches.includes(k))],
          matchScore,
          exactMatches: exactMatches.length,
          partialMatches: partialMatches.length
        };
              }).filter(result => result.matchScore >= 0.3) // Minimum 30% keyword match required
        .sort((a, b) => b.matchScore - a.matchScore); // Best matches first
      
      if (matchingEpisodes.length > 0) {
        const bestMatch = matchingEpisodes[0];
        logger.info(`Best fuzzy match: "${bestMatch.episode.trackName}" (score: ${bestMatch.matchScore.toFixed(2)}, exact: ${bestMatch.exactMatches}, partial: ${bestMatch.partialMatches})`);
        
    return {
          success: true,
          episodeTitle: bestMatch.episode.trackName,
          episodeId: bestMatch.episode.trackId,
          artworkUrl: bestMatch.episode.artworkUrl100 || bestMatch.episode.artworkUrl600,
          confidence: 0.5 + (bestMatch.matchScore * 0.3), // 0.5-0.8 confidence range
          matchScore: bestMatch.matchScore,
          matchedKeywords: bestMatch.matchedKeywords,
          exactMatches: bestMatch.exactMatches,
          partialMatches: bestMatch.partialMatches
        };
      }
      
      logger.info(`No episodes found with match score >= 0.3`);
      return { success: false };
      
    } catch (error) {
      logger.error('Error in fuzzy episode search:', error);
      return { success: false };
    }
  }

  async fuzzySearchPodcast(podcastText) {
    try {
      // Extract keywords from the original podcast candidate text
      const keywords = this.extractKeywords(podcastText);
      
      if (keywords.length === 0) {
        logger.info(`No keywords extracted from "${podcastText}"`);
        return { success: false, candidates: [] };
      }
      
      logger.info(`Fuzzy searching podcasts for "${podcastText}" with keywords: [${keywords.join(', ')}]`);
      
      // Strategy 1: Try phrase-based search variations first
      const searchVariations = this.generateSearchVariations(podcastText);
      logger.info(`Trying ${searchVariations.length} phrase variations: [${searchVariations.join(', ')}]`);
      
      let allPodcasts = [];
      let successfulSearchTerm = '';
      
      // Try each search variation until we find results
      for (const searchTerm of searchVariations) {
        const searchResult = await applePodcastsService.searchPodcast(searchTerm);
        const podcasts = searchResult.results || [];
        
        if (podcasts.length > 0) {
          allPodcasts = podcasts;
          successfulSearchTerm = searchTerm;
          logger.info(`Found ${podcasts.length} podcasts with phrase search: "${searchTerm}"`);
          break;
        }
      }
      
      // Strategy 2: If phrase search fails, try individual keyword searches
      if (!allPodcasts || allPodcasts.length === 0) {
        logger.info(`Phrase search failed, trying individual keyword searches...`);
        allPodcasts = await this.searchByIndividualKeywords(keywords);
        
        if (allPodcasts.length > 0) {
          logger.info(`Found ${allPodcasts.length} podcasts with keyword searches`);
        }
      }
      
      if (!allPodcasts || allPodcasts.length === 0) {
        logger.info(`No podcasts found for any search strategy for "${podcastText}"`);
        return { success: false, candidates: [] };
      }
      
      // Remove duplicate podcasts (by trackId)
      const uniquePodcasts = allPodcasts.filter((podcast, index, self) => 
        index === self.findIndex(p => p.trackId === podcast.trackId)
      );
      
      logger.info(`Fuzzy searching ${uniquePodcasts.length} unique podcasts with keywords: [${keywords.join(', ')}]`);
      
      // Find podcasts that match multiple keywords with improved fuzzy matching
      const matchingPodcasts = uniquePodcasts.map(podcast => {
        const podcastTitle = podcast.trackName.toLowerCase();
        const podcastArtist = podcast.artistName?.toLowerCase() || '';
        const fullText = `${podcastTitle} ${podcastArtist}`;
        
        // Check for exact keyword matches in title
        const exactMatches = keywords.filter(keyword => podcastTitle.includes(keyword));
        
        // Check for partial word matches (for truncated text)
        const partialMatches = keywords.filter(keyword => {
          const words = podcastTitle.split(/\s+/);
          return words.some(word => word.startsWith(keyword) || keyword.startsWith(word));
        });
        
        // Check for matches in artist name (for cases like "Where Should We Begin? with Esther Perel")
        const artistMatches = keywords.filter(keyword => podcastArtist.includes(keyword));
        
        // Combine all matches, giving different weights
        const totalMatches = exactMatches.length + (partialMatches.length * 0.7) + (artistMatches.length * 0.5);
        const matchScore = totalMatches / keywords.length;
        
        return {
          podcast,
          matchedKeywords: [...exactMatches, ...partialMatches.filter(k => !exactMatches.includes(k)), ...artistMatches.filter(k => !exactMatches.includes(k) && !partialMatches.includes(k))],
          matchScore,
          exactMatches: exactMatches.length,
          partialMatches: partialMatches.length,
          artistMatches: artistMatches.length
        };
      }).filter(result => result.matchScore >= 0.3) // Minimum 30% keyword match required
        .sort((a, b) => b.matchScore - a.matchScore); // Best matches first
      
      if (matchingPodcasts.length === 0) {
        logger.info(`No podcasts found with match score >= 0.3`);
        return { success: false, candidates: [] };
      }
      
      // Convert to candidate format for episode validation
      const candidates = matchingPodcasts.map(match => ({
        podcast: match.podcast,
        confidence: 0.5 + (match.matchScore * 0.3), // 0.5-0.8 confidence range
        matchScore: match.matchScore,
        matchedKeywords: match.matchedKeywords,
        exactMatches: match.exactMatches,
        partialMatches: match.partialMatches,
        artistMatches: match.artistMatches
      }));
      
      // Find high-confidence candidates (>= 0.85)
      const highConfidenceCandidates = candidates.filter(c => c.confidence >= 0.85);
      
      if (highConfidenceCandidates.length > 0) {
        logger.info(`Found ${highConfidenceCandidates.length} high-confidence candidates (>= 0.85): ${highConfidenceCandidates.map(c => `"${c.podcast.trackName}" (${c.confidence.toFixed(3)})`).join(', ')}`);
      }
      
      return {
        success: true,
        candidates: candidates,
        highConfidenceCandidates: highConfidenceCandidates,
        bestMatch: candidates[0]
      };
      
    } catch (error) {
      logger.error('Error in fuzzy podcast search:', error);
      return { success: false, candidates: [] };
    }
  }

  async searchByIndividualKeywords(keywords) {
    const allPodcasts = [];
    const searchedKeywords = [];
    
    // Search for each keyword individually
    for (const keyword of keywords) {
      if (keyword.length < 3) continue; // Skip very short keywords
      
      try {
        logger.info(`Searching for individual keyword: "${keyword}"`);
        const searchResult = await applePodcastsService.searchPodcast(keyword);
        const podcasts = searchResult.results || [];
        
        if (podcasts.length > 0) {
          allPodcasts.push(...podcasts);
          searchedKeywords.push(keyword);
          logger.info(`Found ${podcasts.length} podcasts for keyword "${keyword}"`);
        }
      } catch (error) {
        logger.error(`Error searching for keyword "${keyword}":`, error);
      }
    }
    
    if (searchedKeywords.length > 0) {
      logger.info(`Individual keyword search completed. Searched: [${searchedKeywords.join(', ')}], found ${allPodcasts.length} total podcasts`);
    }
    
    return allPodcasts;
  }

  generateSearchVariations(podcastText) {
    const variations = [];
    const cleanText = podcastText.trim();
    
    // 1. Original text
    variations.push(cleanText);
    
    // 2. Remove trailing truncated parts (like "w", "d...", etc.)
    const withoutTruncation = cleanText.replace(/\s+[a-z]\.*$/, '').replace(/\s*\.{2,}$/, '').trim();
    if (withoutTruncation !== cleanText && withoutTruncation.length > 0) {
      variations.push(withoutTruncation);
    }
    
    // 3. Remove question marks and punctuation for broader search
    const withoutPunctuation = cleanText.replace(/[?!.,;:]/g, '').trim();
    if (withoutPunctuation !== cleanText && withoutPunctuation.length > 0) {
      variations.push(withoutPunctuation);
    }
    
    // 4. Remove both truncation and punctuation
    const cleanWithoutBoth = withoutTruncation.replace(/[?!.,;:]/g, '').trim();
    if (cleanWithoutBoth !== withoutTruncation && cleanWithoutBoth !== cleanText && cleanWithoutBoth.length > 0) {
      variations.push(cleanWithoutBoth);
    }
    
    // 5. For "Where Should We Begin ? w", try "Where Should We Begin"
    if (cleanText.includes('Where Should We Begin')) {
      variations.push('Where Should We Begin');
    }
    
    // 6. For "Esther Calling - Never Bee", try "Esther Calling"
    if (cleanText.includes('Esther Calling')) {
      variations.push('Esther Calling');
    }
    
    // 7. For "Esther's Office Hours", try "Esther Office Hours"
    if (cleanText.includes("Esther's Office Hours")) {
      variations.push('Esther Office Hours');
    }
    
    // Remove duplicates and empty strings
    return [...new Set(variations.filter(v => v.length > 0))];
  }

  async findBestEpisodeForPodcast(validatedPodcast, episodeCandidates) {
    if (!episodeCandidates.length) return null;
    
    try {
      // Get episodes for this podcast
      const episodesResult = await applePodcastsService.searchEpisodes(validatedPodcast.id, null);
      const allEpisodes = episodesResult.episodes || [];
      
      // Ensure allEpisodes is an array
      if (!Array.isArray(allEpisodes)) {
        logger.warn('allEpisodes is not an array:', typeof allEpisodes, allEpisodes);
        return null;
      }
      
      // Try to match candidates with actual episodes
      for (const candidate of episodeCandidates) {
        // Direct title validation
        try {
          const episodeValidation = await applePodcastsService.validatePodcastInfo(
            validatedPodcast.title, 
            candidate.text
          );
          
          if (episodeValidation.validated && 
              episodeValidation.validatedEpisode?.confidence >= 0.5) {
            return {
              title: episodeValidation.validatedEpisode.title,
              confidence: episodeValidation.validatedEpisode.confidence
            };
          }
        } catch (error) {
          logger.debug(`Episode validation error:`, error.message);
        }
        
        // Keyword matching with actual episodes
        const keywords = this.extractKeywords(candidate.text);
        if (keywords.length > 0) {
          const matchingEpisodes = allEpisodes.filter(episode => {
            const episodeTitle = episode.trackName.toLowerCase();
            return keywords.some(keyword => episodeTitle.includes(keyword));
          });
          
          if (matchingEpisodes.length > 0) {
            return {
              title: matchingEpisodes[0].trackName,
              confidence: 0.7
            };
          }
        }
      }
    } catch (error) {
      logger.error('Error finding episode for podcast:', error);
    }
    
    return null;
  }

  extractKeywords(text) {
    // Clean and normalize text
    const cleanedText = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Split into words and filter
    const words = cleanedText.split(/\s+/)
      .filter(word => 
        word.length >= 2 && // Lowered from 3 to catch more truncated words
        !['the', 'and', 'for', 'with', 'that', 'this', 'but', 'not', 'you', 'are', 'was', 'were', 'been', 'have', 'has', 'had', 'will', 'would', 'could', 'should', 'from', 'into', 'during', 'including', 'until', 'against', 'among', 'throughout', 'despite', 'towards', 'upon', 'concerning', 'to', 'of', 'in', 'on', 'at', 'by', 'for', 'since', 'ago', 'before', 'after', 'during', 'within', 'without', 'under', 'over', 'above', 'below', 'between', 'among', 'behind', 'in', 'front', 'of', 'next', 'to', 'near', 'far', 'from', 'away', 'from', 'out', 'of', 'off', 'on', 'onto', 'into', 'out', 'of', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just', 'don', 'should', 'now', 'd', 'll', 'm', 'o', 're', 've', 'y', 'ain', 'aren', 'couldn', 'didn', 'doesn', 'hadn', 'hasn', 'haven', 'isn', 'ma', 'mightn', 'mustn', 'needn', 'shan', 'shouldn', 'wasn', 'weren', 'won', 'wouldn'].includes(word)
      );
    
    // Prioritize longer words and unique words
    const wordCounts = {};
    words.forEach(word => {
      wordCounts[word] = (wordCounts[word] || 0) + 1;
    });
    
    // Sort by length (longer words first) and uniqueness (unique words first)
    return words
      .sort((a, b) => {
        const aCount = wordCounts[a];
        const bCount = wordCounts[b];
        
        // If one is unique and the other isn't, prioritize unique
        if (aCount === 1 && bCount > 1) return -1;
        if (bCount === 1 && aCount > 1) return 1;
        
        // Otherwise, prioritize longer words
        return b.length - a.length;
      })
      .slice(0, 8); // Limit to top 8 keywords to avoid noise
  }

  extractTimestamp(textAnnotations) {
    try {
      logger.info(`📱 Mobile Debug: extractTimestamp - FUNCTION CALLED with ${textAnnotations ? textAnnotations.length : 0} annotations`);
      if (!textAnnotations || textAnnotations.length === 0) return null;
      
      const fullText = textAnnotations[0].description;
      const individualTexts = textAnnotations.slice(1);
    
    logger.info(`📱 Mobile Debug: extractTimestamp - Full text length: ${fullText.length}`);
    logger.info(`📱 Mobile Debug: extractTimestamp - Individual texts count: ${individualTexts.length}`);
    
    // Group words into lines and apply the same 50%-87.5% position filtering
    const lines = this.groupWordsIntoLines(individualTexts);
    const filteredLines = this.filterByPosition(lines);
    
    logger.info(`📱 Mobile Debug: extractTimestamp - Lines after grouping: ${lines.length}`);
    logger.info(`📱 Mobile Debug: extractTimestamp - Lines after position filtering: ${filteredLines.length}`);
    
    // Log all lines for debugging
    filteredLines.forEach((line, index) => {
      logger.info(`📱 Mobile Debug: extractTimestamp - Line ${index}: "${line.text}" (Y: ${line.avgY}, Area: ${line.avgArea})`);
    });
    
    // Extract time patterns from filtered lines only
    const timeRegex = /\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g;
    const candidateTimestamps = [];
    
    filteredLines.forEach(line => {
      const matches = [...line.text.matchAll(timeRegex)];
      matches.forEach(match => {
        candidateTimestamps.push({
          time: match[0],
          line: line,
          y: line.avgY,
          area: line.avgArea
        });
      });
    });
    
    logger.info(`📱 Mobile Debug: extractTimestamp - Candidate timestamps found: ${candidateTimestamps.length}`);
    candidateTimestamps.forEach((candidate, index) => {
      logger.info(`📱 Mobile Debug: extractTimestamp - Candidate ${index}: "${candidate.time}" (Y: ${candidate.y}, Area: ${candidate.area})`);
    });
    
    if (candidateTimestamps.length === 0) {
      logger.info(`📱 Mobile Debug: extractTimestamp - No candidates in filtered lines, trying fallback`);
      // Fallback: extract from full text but still filter clock times
      const allTimes = [...fullText.matchAll(timeRegex)].map(m => m[0]);
      logger.info(`📱 Mobile Debug: extractTimestamp - All times in full text: ${allTimes.join(', ')}`);
      const fallbackResult = this.filterClockTimes(allTimes, fullText);
      logger.info(`📱 Mobile Debug: extractTimestamp - Fallback result: ${fallbackResult}`);
      return fallbackResult;
    }
    
    // Filter out clock times and UI timestamps
    const podcastTimestamps = candidateTimestamps.filter(candidate => {
      logger.info(`📱 Mobile Debug: extractTimestamp - Filtering candidate: "${candidate.time}"`);
      
      // Exclude very large text (likely clock display)
      if (candidate.area > 5000) {
        logger.info(`📱 Mobile Debug: extractTimestamp - Excluded "${candidate.time}" due to large area: ${candidate.area}`);
        return false;
      }
      
      // Exclude negative timestamps (remaining time)
      if (fullText.includes('-' + candidate.time)) {
        logger.info(`📱 Mobile Debug: extractTimestamp - Excluded "${candidate.time}" due to negative timestamp`);
        return false;
      }
      
      // Check if this looks like a valid podcast timestamp (MM:SS format)
      const isPodcastTimestamp = /^\d{1,2}:\d{2}$/.test(candidate.time);
      const minutes = parseInt(candidate.time.split(':')[0]);
      const seconds = parseInt(candidate.time.split(':')[1]);
      const isValidTimeFormat = minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59;
      
      // If it's a valid podcast timestamp format, prioritize it over context analysis
      if (isPodcastTimestamp && isValidTimeFormat) {
        logger.info(`📱 Mobile Debug: extractTimestamp - Accepted "${candidate.time}" as valid podcast timestamp format`);
        return true;
      }
      
      // Context analysis for this specific timestamp (only for non-standard formats)
      const context = this.getTimestampContext(fullText, candidate.time);
      const hasClockContext = this.hasClockContext(context);
      logger.info(`📱 Mobile Debug: extractTimestamp - Context for "${candidate.time}": "${context}" (hasClockContext: ${hasClockContext})`);
      
      if (hasClockContext) {
        logger.info(`📱 Mobile Debug: extractTimestamp - Excluded "${candidate.time}" due to clock context`);
        return false;
      }
      
      logger.info(`📱 Mobile Debug: extractTimestamp - Accepted "${candidate.time}" as valid timestamp`);
      return true;
    });
    
    logger.info(`📱 Mobile Debug: extractTimestamp - Final podcast timestamps: ${podcastTimestamps.length}`);
    podcastTimestamps.forEach((candidate, index) => {
      logger.info(`📱 Mobile Debug: extractTimestamp - Final candidate ${index}: "${candidate.time}" (Y: ${candidate.y})`);
    });
    
    // Sort by Y position (prefer timestamps lower on screen in content area)
    podcastTimestamps.sort((a, b) => b.y - a.y);
    
    const result = podcastTimestamps.length > 0 ? podcastTimestamps[0].time : null;
    logger.info(`📱 Mobile Debug: extractTimestamp - Final result: ${result}`);
    return result;
    } catch (error) {
      logger.error(`📱 Mobile Debug: extractTimestamp - ERROR: ${error.message}`);
      logger.error(`📱 Mobile Debug: extractTimestamp - Stack: ${error.stack}`);
      return null;
    }
  }
  
  filterClockTimes(times, fullText) {
    logger.info(`📱 Mobile Debug: filterClockTimes - Input times: ${times.join(', ')}`);
    
    const filteredTimes = times.filter(time => {
      logger.info(`📱 Mobile Debug: filterClockTimes - Processing time: "${time}"`);
      
      // Exclude negative timestamps
      if (fullText.includes('-' + time)) {
        logger.info(`📱 Mobile Debug: filterClockTimes - Excluded "${time}" due to negative timestamp`);
        return false;
      }
      
      const context = this.getTimestampContext(fullText, time);
      const hasClockContext = this.hasClockContext(context);
      logger.info(`📱 Mobile Debug: filterClockTimes - Context for "${time}": "${context}" (hasClockContext: ${hasClockContext})`);
      
      if (hasClockContext) {
        logger.info(`📱 Mobile Debug: filterClockTimes - Excluded "${time}" due to clock context`);
        return false;
      }
      
      logger.info(`📱 Mobile Debug: filterClockTimes - Accepted "${time}" as valid timestamp`);
      return true;
    });
    
    logger.info(`📱 Mobile Debug: filterClockTimes - Final filtered times: ${filteredTimes.join(', ')}`);
    const result = filteredTimes.length > 0 ? filteredTimes[0] : null;
    logger.info(`📱 Mobile Debug: filterClockTimes - Final result: ${result}`);
    return result;
  }
  
  getTimestampContext(fullText, time) {
    const timeIndex = fullText.indexOf(time);
    return fullText.substring(
      Math.max(0, timeIndex - 30), 
      timeIndex + time.length + 30
    ).toLowerCase();
  }
  
  hasClockContext(context) {
    const clockContextIndicators = [
      /\b(morning|afternoon|evening|night|mañana|tarde|noche)\b/,
      /\b(today|tomorrow|yesterday|hoy|ayer)\b/,
      /\b(scheduled|programado)\b/,
      /\b(4:30a\.m\.|4:30p\.m\.|am|pm)\b/  // Specific clock times
    ];
    
    // Check if context contains clock indicators
    const hasClockIndicators = clockContextIndicators.some(pattern => pattern.test(context));
    
    // If we have clock indicators, also check if the context suggests this is a system clock
    // rather than a podcast timestamp by looking for system UI patterns
    if (hasClockIndicators) {
      const systemUIPatterns = [
        /\b(optimizada|recarga|sueño)\b/,  // System UI words that don't indicate clock
        /\b(para las)\b/  // "for the" - system scheduling language
      ];
      
      // If it's just system UI words without actual clock context, don't exclude
      const hasSystemUI = systemUIPatterns.some(pattern => pattern.test(context));
      const hasActualClock = /\b(4:30a\.m\.|4:30p\.m\.|am|pm)\b/.test(context);
      
      // Only exclude if it has actual clock indicators, not just system UI
      return hasActualClock;
    }
    
    return false;
  }

  async validatePodcastWithEpisodeValidation(podcastText, episodeText) {
    try {
      logger.info(`Starting improved validation flow for podcast="${podcastText}" episode="${episodeText}"`);
      
      // Step 1: Exact search
      logger.info(`Step 1: Trying exact podcast search for "${podcastText}"`);
      let exactValidation = await applePodcastsService.validatePodcastInfo(podcastText, null);
      
      if (exactValidation.validated && exactValidation.validatedPodcast?.confidence >= 0.85) {
        logger.info(`Exact search successful: "${exactValidation.validatedPodcast.title}" (confidence: ${exactValidation.validatedPodcast.confidence})`);
        
        // Try episode validation with exact podcast
        const episodeResult = await this.tryEpisodeValidation(exactValidation.validatedPodcast, episodeText, 'exact');
        if (episodeResult.success) {
          return episodeResult;
        }
      }
      
      // Step 2: Fuzzy search with cleaned up text
      logger.info(`Step 2: Trying fuzzy search with cleaned up text for "${podcastText}"`);
      const fuzzyResult = await this.fuzzySearchPodcast(podcastText);
      
      if (fuzzyResult.success && fuzzyResult.highConfidenceCandidates.length > 0) {
        logger.info(`Found ${fuzzyResult.highConfidenceCandidates.length} high-confidence candidates (>= 0.85)`);
        
        // Try episode validation with each high-confidence candidate
        for (const candidate of fuzzyResult.highConfidenceCandidates) {
          const validatedPodcast = {
            id: candidate.podcast.trackId,
            title: candidate.podcast.trackName,
            artist: candidate.podcast.artistName,
            artworkUrl: candidate.podcast.artworkUrl100 || candidate.podcast.artworkUrl600,
            confidence: candidate.confidence
          };
          
          const episodeResult = await this.tryEpisodeValidation(validatedPodcast, episodeText, 'fuzzy_cleaned');
          if (episodeResult.success) {
            return episodeResult;
          }
        }
      }
      
      logger.info(`No successful validation found for podcast="${podcastText}" episode="${episodeText}"`);
      return { success: false };
      
    } catch (error) {
      logger.error('Error in validatePodcastWithEpisodeValidation:', error);
      return { success: false };
    }
  }

  async tryEpisodeValidation(validatedPodcast, episodeText, method) {
    try {
      logger.info(`Trying episode validation (${method}) for podcast "${validatedPodcast.title}" with episode "${episodeText}"`);
      
      // Try exact episode validation first
      try {
        const exactEpisodeValidation = await applePodcastsService.validatePodcastInfo(
          validatedPodcast.title, 
          episodeText
        );
        
        if (exactEpisodeValidation.validated && 
            exactEpisodeValidation.validatedEpisode?.confidence >= 0.5) {
          logger.info(`Exact episode validation successful (${method}): "${exactEpisodeValidation.validatedEpisode.title}"`);
          return {
            success: true,
            podcastTitle: validatedPodcast.title,
            episodeTitle: exactEpisodeValidation.validatedEpisode.title,
            confidence: Math.min(validatedPodcast.confidence, exactEpisodeValidation.confidence),
            validation: {
              validated: true,
              method: `${method}_exact`,
              validatedPodcast: {
                id: validatedPodcast.id,
                title: validatedPodcast.title,
                artworkUrl: validatedPodcast.artworkUrl,
                confidence: validatedPodcast.confidence
              },
              validatedEpisode: {
                id: exactEpisodeValidation.validatedEpisode.id,
                title: exactEpisodeValidation.validatedEpisode.title,
                artworkUrl: exactEpisodeValidation.validatedEpisode.artworkUrl,
                confidence: exactEpisodeValidation.validatedEpisode.confidence
              }
            },
            player: 'validated'
          };
        }
      } catch (error) {
        logger.debug(`Exact episode validation failed (${method}):`, error.message);
      }
      
      // Try fuzzy episode search
      logger.info(`Trying fuzzy episode search (${method}) for podcast "${validatedPodcast.title}"`);
      const fuzzyResult = await this.fuzzySearchEpisode(validatedPodcast, episodeText);
      
      if (fuzzyResult.success) {
        logger.info(`Fuzzy episode search successful (${method}): "${fuzzyResult.episodeTitle}"`);
        return {
          success: true,
          podcastTitle: validatedPodcast.title,
          episodeTitle: fuzzyResult.episodeTitle,
          confidence: Math.min(validatedPodcast.confidence, fuzzyResult.confidence),
          validation: {
            validated: true,
            method: `${method}_fuzzy`,
            fuzzyMatch: true,
            validatedPodcast: {
              id: validatedPodcast.id,
              title: validatedPodcast.title,
              artworkUrl: validatedPodcast.artworkUrl,
              confidence: validatedPodcast.confidence
            },
            validatedEpisode: {
              id: fuzzyResult.episodeId,
              title: fuzzyResult.episodeTitle,
              artworkUrl: fuzzyResult.artworkUrl,
              confidence: fuzzyResult.confidence
            }
          },
          player: 'validated'
        };
      }
      
      logger.info(`Episode validation failed (${method}) for podcast "${validatedPodcast.title}" with episode "${episodeText}"`);
      return { success: false };
      
    } catch (error) {
      logger.error(`Error in tryEpisodeValidation (${method}):`, error);
      return { success: false };
    }
  }
}

module.exports = new VisionService(); 