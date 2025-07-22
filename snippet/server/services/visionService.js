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
      minCandidateLength: 8,
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
      const timestamp = this.extractTimestamp(fullText);
      
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
    
    logger.info('📱 Mobile Debug: Position filtering - input lines:', lines.map(l => `"${l.text}" (Y:${l.avgY}, area:${l.avgArea})`));
    
    // Calculate image dimensions
    const maxY = Math.max(...lines.map(line => line.avgY));
    const minY = Math.min(...lines.map(line => line.avgY));
    const imageHeight = maxY - minY;
    const imageWidth = Math.max(...lines.map(line => 
      line.words ? Math.max(...line.words.map(w => w.boundingPoly.vertices[1].x)) : 0
    ));
    
    logger.info('📱 Mobile Debug: Image dimensions:', { minY, maxY, imageHeight, imageWidth });
    
    // Much more lenient filtering - only exclude obvious system text areas
    // Exclude top 15% (status bar, clock) and bottom 5% (home indicator)
    const excludeTopThreshold = minY + (imageHeight * 0.15);
    const excludeBottomThreshold = maxY - (imageHeight * 0.05);
    
    // Much smaller album art region
    const centerX = imageWidth / 2;
    const albumArtRegion = imageWidth * 0.15; // 15% around center (was 30%)
    
    const positionFiltered = lines.filter(line => {
      // Filter by vertical position - much more lenient
      if (line.avgY < excludeTopThreshold || line.avgY > excludeBottomThreshold) {
        logger.info(`📱 Mobile Debug: Filtered out "${line.text}" - vertical position (Y:${line.avgY})`);
        return false;
      }
      
      // Filter by horizontal position - much more lenient
      if (line.avgX && Math.abs(line.avgX - centerX) < albumArtRegion) {
        // Only exclude very large text in center (likely album art)
        if (line.avgArea > 5000) { // Much higher threshold (was 2000)
          logger.info(`📱 Mobile Debug: Filtered out "${line.text}" - center album art (area:${line.avgArea})`);
        return false;
        }
      }
      
      // Extra filtering for very large text in upper areas - much more lenient
      if (line.avgY < excludeTopThreshold * 1.5 && line.avgArea > 8000) { // Much higher threshold (was 2000)
        logger.info(`📱 Mobile Debug: Filtered out "${line.text}" - upper area large text (Y:${line.avgY}, area:${line.avgArea})`);
          return false;
      }
      
      return true;
    });
    
    logger.info('📱 Mobile Debug: Position filtered lines:', positionFiltered.map(l => `"${l.text}" (Y:${l.avgY}, area:${l.avgArea})`));
    
    // If we filtered out too much, be very lenient
    if (positionFiltered.length < 2) {
      logger.info('📱 Mobile Debug: Too few lines after position filtering, using very lenient fallback');
      const veryLenientExcludeTop = minY + (imageHeight * 0.1); // Only exclude top 10%
      const veryLenientFiltered = lines.filter(line => {
        // Only exclude very obvious system text
        if (line.avgY < veryLenientExcludeTop && line.avgArea > 10000) { // Very high threshold
          logger.info(`📱 Mobile Debug: Very lenient filtered out "${line.text}" - obvious system text`);
          return false;
        }
        return true;
      });
      
      logger.info('📱 Mobile Debug: Very lenient filtered lines:', veryLenientFiltered.map(l => `"${l.text}" (Y:${l.avgY}, area:${l.avgArea})`));
      return veryLenientFiltered;
    }
    
    return positionFiltered;
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
    
    logger.info(`📱 Mobile Debug: Testing candidate "${originalText}" (length:${text.length}, words:${line.wordCount}, area:${line.avgArea})`);
    
    // Basic length and word count filters - be more lenient for single words
    if (text.length < this.config.minCandidateLength || 
        text.length > this.config.maxCandidateLength) {
      logger.info(`📱 Mobile Debug: Filtered out "${originalText}" - length (${text.length}) outside range [${this.config.minCandidateLength}-${this.config.maxCandidateLength}]`);
        return false;
      }
      
    // For word count: allow single words if they're substantial (like podcast names)
    if (line.wordCount < 1) {
      logger.info(`📱 Mobile Debug: Filtered out "${originalText}" - no words`);
        return false;
      }
      
    // If it's a single word, it should be substantial (not just a short word)
    if (line.wordCount === 1 && text.length < 6) {
      logger.info(`📱 Mobile Debug: Filtered out "${originalText}" - single word too short (${text.length} chars)`);
        return false;
      }
      
    // Language-agnostic pattern-based filtering
    
    // 1. Time patterns (any language)
    if (this.isTimePattern(text)) {
      logger.info(`📱 Mobile Debug: Filtered out "${originalText}" - time pattern`);
        return false;
      }
      
    // 2. Date patterns (any language)
    if (this.isDatePattern(text)) {
      logger.info(`📱 Mobile Debug: Filtered out "${originalText}" - date pattern`);
        return false;
      }
      
    // 3. Percentage patterns
    if (/\b\d+%/.test(text)) {
      logger.info(`📱 Mobile Debug: Filtered out "${originalText}" - percentage pattern`);
        return false;
      }
      
    // 4. Pure numbers or symbols
    if (/^[\d\s\-:]+$/.test(text) || /^[^\w\s]+$/.test(text)) {
      logger.info(`📱 Mobile Debug: Filtered out "${originalText}" - pure numbers/symbols`);
        return false;
      }
      
    // 5. Single character or very short words
    if (/^.{1,2}$/.test(text.replace(/\s/g, ''))) {
      logger.info(`📱 Mobile Debug: Filtered out "${originalText}" - too short`);
        return false;
      }
      
    // 6. All caps - BUT only if short and likely UI elements
    // Allow longer all caps text that could be podcast names
    if (originalText === originalText.toUpperCase() && 
        originalText.length > 3 && 
        originalText.length < 15 && 
        line.wordCount <= 2) {
      logger.info(`📱 Mobile Debug: Filtered out "${originalText}" - short all caps UI element`);
      return false;
    }
    
    // 7. Starts with lowercase (likely mid-sentence/truncated) - BUT be more lenient
    // Allow if it's substantial content (like truncated episode titles)
    if (/^[a-z]/.test(originalText)) {
      // Allow if it's substantial content (longer than 10 chars or contains meaningful words)
      if (text.length < 10 && !text.includes('market') && !text.includes('podcast') && !text.includes('episode')) {
        logger.info(`📱 Mobile Debug: Filtered out "${originalText}" - starts with lowercase, too short`);
        return false;
      }
    }
    
    // 8. Contains ellipsis (truncated) - BUT don't filter out completely
    if (/\.{3,}|…/.test(text)) {
      // Allow if it's substantial content
      if (text.length < 15) {
        logger.info(`📱 Mobile Debug: Filtered out "${originalText}" - truncated, too short`);
        return false;
      }
    }
    
    // 9. Structural indicators of system text
    if (this.hasSystemTextStructure(text, line)) {
      logger.info(`📱 Mobile Debug: Filtered out "${originalText}" - system text structure`);
      return false;
    }
    
    logger.info(`📱 Mobile Debug: ACCEPTED candidate "${originalText}"`);
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
    
    for (const pair of spatialPairs) {
      logger.info(`Testing spatial pair: top="${pair.top.text}" bottom="${pair.bottom.text}" (distance: ${pair.distance}px)`);
      
      // Test assumption: bottom = podcast, top = episode
      const result1 = await this.validateSpatialPair(pair.bottom, pair.top, 'podcast-episode');
      if (result1.success) {
        logger.info('Spatial pair validation successful (bottom=podcast, top=episode)');
        return result1;
      }
      
      // Fallback: top = podcast, bottom = episode
      const result2 = await this.validateSpatialPair(pair.top, pair.bottom, 'episode-podcast');
      if (result2.success) {
        logger.info('Spatial pair validation successful (top=podcast, bottom=episode)');
        return result2;
      }
    }
    
    // Strategy 2: If no spatial pairs work, try individual candidates as podcasts
    logger.info('No spatial pairs validated, trying individual candidates...');
    for (const candidate of candidates) {
      try {
        const validation = await applePodcastsService.validatePodcastInfo(candidate.text, null);
        
        if (validation.validated && 
            validation.validatedPodcast?.confidence >= this.config.validationConfidenceThreshold) {
          logger.info(`Individual podcast validation successful: ${candidate.text}`);
          
          // Try to find episode from remaining candidates
          const episodeCandidate = await this.findBestEpisodeForPodcast(
            validation.validatedPodcast,
            candidates.filter(c => c.text !== candidate.text)
          );
          
                  return {
            podcastTitle: validation.validatedPodcast.title,
            episodeTitle: episodeCandidate?.title || 'Unknown Episode',
            confidence: validation.confidence,
            validation: validation,
            player: 'validated'
                  };
                }
              } catch (error) {
        logger.debug(`Individual podcast validation error for ${candidate.text}:`, error.message);
      }
    }
    
    // Strategy 3: Broad episode search as final fallback
    logger.info('Trying broad episode search as final fallback...');
    for (const candidate of candidates) {
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
    
    // Fallback: Return best candidates without validation
    logger.info('No validation successful, returning best candidates');
    const topCandidates = candidates.slice(0, 2);
    
            return {
      podcastTitle: topCandidates[1]?.text || 'Unknown Podcast',
      episodeTitle: topCandidates[0]?.text || 'Unknown Episode',
                  confidence: 0.3,
      validation: { validated: false, method: 'unvalidated_candidates' },
      player: 'unvalidated'
    };
  }

  findSpatialPairs(candidates) {
    const pairs = [];
    const maxDistance = 100; // Increased from 32 to 100px to capture more realistic UI spacing
    
    // Sort candidates by Y position (top to bottom)
    const sortedCandidates = [...candidates].sort((a, b) => a.avgY - b.avgY);
    
    for (let i = 0; i < sortedCandidates.length; i++) {
      for (let j = i + 1; j < sortedCandidates.length; j++) {
        const candidate1 = sortedCandidates[i]; // Higher on screen (lower Y)
        const candidate2 = sortedCandidates[j]; // Lower on screen (higher Y)
        
        const distance = candidate2.avgY - candidate1.avgY;
        
        // Only consider pairs that are reasonably close
        if (distance <= maxDistance) {
          pairs.push({
            top: candidate1,
            bottom: candidate2,
            distance: distance
          });
        } else {
          // Since we're sorted by Y, if this distance is too large, 
          // all subsequent pairs with candidate1 will also be too large
          break;
        }
      }
    }
    
    // Sort pairs by distance (closest pairs first)
    pairs.sort((a, b) => a.distance - b.distance);
    
    logger.info(`Found ${pairs.length} spatial pairs:`, pairs.map(p => 
      `"${p.top.text}" + "${p.bottom.text}" (${p.distance}px apart)`
    ));
    
    return pairs;
  }

  async validateSpatialPair(podcastCandidate, episodeCandidate, pairType) {
    try {
      logger.info(`Validating spatial pair (${pairType}): podcast="${podcastCandidate.text}" episode="${episodeCandidate.text}"`);
      
      // Step 1: Validate the podcast candidate
      const podcastValidation = await applePodcastsService.validatePodcastInfo(podcastCandidate.text, null);
      
      if (!podcastValidation.validated || 
          podcastValidation.validatedPodcast?.confidence < this.config.validationConfidenceThreshold) {
        logger.info(`Podcast validation failed for "${podcastCandidate.text}" (confidence: ${podcastValidation.validatedPodcast?.confidence || 0})`);
        return { success: false };
      }
      
      logger.info(`Podcast validated: "${podcastValidation.validatedPodcast.title}" (confidence: ${podcastValidation.validatedPodcast.confidence})`);
      
      // Step 2: Try exact episode validation first
      try {
        const exactEpisodeValidation = await applePodcastsService.validatePodcastInfo(
          podcastValidation.validatedPodcast.title, 
          episodeCandidate.text
        );
        
        if (exactEpisodeValidation.validated && 
            exactEpisodeValidation.validatedEpisode?.confidence >= 0.5) {
          logger.info(`Exact episode validation successful: "${exactEpisodeValidation.validatedEpisode.title}"`);
                      return {
                        success: true,
            podcastTitle: podcastValidation.validatedPodcast.title,
            episodeTitle: exactEpisodeValidation.validatedEpisode.title,
            confidence: Math.min(podcastValidation.confidence, exactEpisodeValidation.confidence),
            validation: {
              validated: true,
              method: `spatial_pair_${pairType}_exact`,
              podcastCandidate: podcastCandidate.text,
              episodeCandidate: episodeCandidate.text
            },
            player: 'validated'
                      };
                    }
                  } catch (error) {
        logger.debug('Exact episode validation failed, trying fuzzy search:', error.message);
      }
      
      // Step 3: Fuzzy search for episode using keywords
      logger.info(`Trying fuzzy episode search for podcast "${podcastValidation.validatedPodcast.title}"`);
      const fuzzyResult = await this.fuzzySearchEpisode(
        podcastValidation.validatedPodcast, 
        episodeCandidate.text
      );
      
      if (fuzzyResult.success) {
        logger.info(`Fuzzy episode search successful: "${fuzzyResult.episodeTitle}"`);
              return {
                success: true,
          podcastTitle: podcastValidation.validatedPodcast.title,
          episodeTitle: fuzzyResult.episodeTitle,
          confidence: Math.min(podcastValidation.confidence, fuzzyResult.confidence),
                validation: {
            validated: true,
            method: `spatial_pair_${pairType}_fuzzy`,
            podcastCandidate: podcastCandidate.text,
            episodeCandidate: episodeCandidate.text,
            fuzzyMatch: true
          },
          player: 'validated'
        };
      }
      
      logger.info(`No episode match found for "${episodeCandidate.text}" in podcast "${podcastValidation.validatedPodcast.title}"`);
      return { success: false };
      
    } catch (error) {
      logger.error(`Error validating spatial pair:`, error);
      return { success: false };
    }
  }

  async fuzzySearchEpisode(validatedPodcast, episodeText) {
    try {
      // Get all episodes for this podcast
      const allEpisodes = await applePodcastsService.searchEpisodes(validatedPodcast.id, null);
      
      if (!allEpisodes || allEpisodes.length === 0) {
        return { success: false };
      }
      
      // Extract keywords from the episode candidate text
      const keywords = this.extractKeywords(episodeText);
      
      if (keywords.length === 0) {
        return { success: false };
      }
      
      logger.info(`Fuzzy searching with keywords: [${keywords.join(', ')}]`);
      
      // Find episodes that match multiple keywords
      const matchingEpisodes = allEpisodes.map(episode => {
        const episodeTitle = episode.trackName.toLowerCase();
        const matchedKeywords = keywords.filter(keyword => episodeTitle.includes(keyword));
        const matchScore = matchedKeywords.length / keywords.length;
        
          return {
          episode,
          matchedKeywords,
          matchScore
        };
      }).filter(result => result.matchScore >= 0.4) // At least 40% of keywords must match
        .sort((a, b) => b.matchScore - a.matchScore); // Best matches first
      
      if (matchingEpisodes.length > 0) {
        const bestMatch = matchingEpisodes[0];
        logger.info(`Best fuzzy match: "${bestMatch.episode.trackName}" (score: ${bestMatch.matchScore}, keywords: [${bestMatch.matchedKeywords.join(', ')}])`);
        
    return {
          success: true,
          episodeTitle: bestMatch.episode.trackName,
          confidence: 0.6 + (bestMatch.matchScore * 0.2), // 0.6-0.8 confidence range
          matchScore: bestMatch.matchScore,
          matchedKeywords: bestMatch.matchedKeywords
        };
      }
      
      return { success: false };
      
    } catch (error) {
      logger.error('Error in fuzzy episode search:', error);
      return { success: false };
    }
  }

  async findBestEpisodeForPodcast(validatedPodcast, episodeCandidates) {
    if (!episodeCandidates.length) return null;
    
    try {
      // Get episodes for this podcast
      const allEpisodes = await applePodcastsService.searchEpisodes(validatedPodcast.id, null);
      
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
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => 
        word.length >= 3 && 
        !['the', 'and', 'for', 'with', 'that', 'this', 'but', 'not', 'you', 'are', 'was', 'were', 'been', 'have', 'has', 'had', 'will', 'would', 'could', 'should'].includes(word)
      );
  }

  extractTimestamp(fullText) {
    // Extract time patterns that look like podcast timestamps
    const timeRegex = /\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g;
    const allTimes = [...fullText.matchAll(timeRegex)].map(m => m[0]);
    
    // Filter out times that are likely clock times using multiple strategies
    const podcastTimes = allTimes.filter(time => {
      // Strategy 1: Context analysis
      const timeIndex = fullText.indexOf(time);
      const context = fullText.substring(
        Math.max(0, timeIndex - 30), 
        timeIndex + time.length + 30
      ).toLowerCase();
      
      // Exclude if context suggests it's a clock time
      const clockContextIndicators = [
        /\b(morning|afternoon|evening|night|mañana|tarde|noche)\b/,
        /\b(today|tomorrow|yesterday|hoy|mañana|ayer)\b/,
        /\b(scheduled|programado|optimizada|recarga)\b/
      ];
      
      const hasClockContext = clockContextIndicators.some(pattern => pattern.test(context));
      if (hasClockContext) {
      return false;
    }
    
      // IMPORTANT: Exclude if this time appears with a negative sign
      // We only want positive timestamps (current position), not remaining time
      if (fullText.includes('-' + time)) {
        return false;
      }
      
      return true;
    });
    
    // Additional filtering: prefer times that look like podcast progress
    const likelyPodcastTimes = podcastTimes.filter(time => {
      const timeIndex = fullText.indexOf(time);
      const nearbyText = fullText.substring(
        Math.max(0, timeIndex - 50),
        timeIndex + time.length + 50
      );
      
      // Check for progress-like context (multiple times, progress bars)
      const timeCount = (nearbyText.match(/\d{1,2}:\d{2}/g) || []).length;
      if (timeCount >= 2) { // Multiple times nearby suggests progress display
      return true;
    }
    
      // Single time in podcast player context is also good
      return true;
    });
    
    // Return the first valid positive podcast timestamp
    const finalTimes = likelyPodcastTimes.length > 0 ? likelyPodcastTimes : podcastTimes;
    return finalTimes.length > 0 ? finalTimes[0] : null;
  }
}

module.exports = new VisionService(); 