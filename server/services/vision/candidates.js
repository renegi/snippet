// Turns OCR words into lines and keeps the ones likely to be podcast/episode titles (position, size and text filters, scoring).
// These methods are mixed into VisionService (../visionService.js), so `this` is the service.
const logger = require('../../utils/logger');

module.exports = {
  extractTextCandidates(textAnnotations, imageDimensions) {
    const individualTexts = textAnnotations.slice(1);
    
    // Group words into lines
    const lines = this.groupWordsIntoLines(individualTexts);
    
    logger.debug(`All lines before position filtering:`, lines.map(line => 
      `"${line.text}" (Y: ${line.avgY}, X: ${line.words ? line.words[0].boundingPoly.vertices[0].x : 0}, Area: ${line.avgArea})`
    ));
    
    // Use position-based filtering to focus on podcast content area
    let filteredLines = this.filterByPosition(lines, imageDimensions);
    
    // Filter and score candidates
    let candidates = filteredLines
      .filter(line => this.isValidCandidate(line))
      .map(line => this.scoreCandidate(line))
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.maxCandidatesForValidation);
    
    logger.debug('Text candidates:', candidates.map(c => `"${c.text}" (score: ${c.score.toFixed(2)})`));
    
    // If we have fewer than 1 candidate, try upper fallback to get more candidates
    if (candidates.length < 1 && imageDimensions && imageDimensions.height) {
      logger.debug('🎧 No candidates found in primary area, trying upper fallback to get more candidates...');
      
      const upperFallbackLines = this.filterByPositionUpperFallback(lines, imageDimensions);
      const upperFallbackCandidates = upperFallbackLines
        .filter(line => this.isValidCandidate(line))
        .map(line => this.scoreCandidate(line))
        .sort((a, b) => b.score - a.score)
        .slice(0, this.config.maxCandidatesForValidation);
      
      logger.debug('Upper fallback candidates:', upperFallbackCandidates.map(c => `"${c.text}" (score: ${c.score.toFixed(2)})`));
      
      // Combine candidates, avoiding duplicates
      const combinedCandidates = [...candidates];
      for (const upperCandidate of upperFallbackCandidates) {
        if (!combinedCandidates.some(c => c.text === upperCandidate.text)) {
          combinedCandidates.push(upperCandidate);
        }
      }
      
      // Sort by score and limit
      candidates = combinedCandidates
        .sort((a, b) => b.score - a.score)
        .slice(0, this.config.maxCandidatesForValidation);
      
      logger.debug('Combined candidates:', candidates.map(c => `"${c.text}" (score: ${c.score.toFixed(2)})`));
    }
    
    return candidates;
  },

  filterByPosition(lines, imageDimensions) {
    if (lines.length === 0) return lines;
    
    logger.debug(`Position filtering ${lines.length} input lines`);
    
    // Use image-relative calculations if dimensions available, otherwise fall back to content-relative
    if (imageDimensions && imageDimensions.height) {
      return this.filterByPositionImageRelative(lines, imageDimensions);
    } else {
      return this.filterByPositionContentRelative(lines);
    }
  },

  filterByPositionImageRelative(lines, imageDimensions) {
    const { height: imageHeight, width: imageWidth } = imageDimensions;
    
    logger.debug(`Using image-relative filtering (${imageWidth}x${imageHeight})`);
    
    // PRIMARY STRATEGY: Focus on the podcast content area (45%-87.5% of image height)
    const primaryStartY = imageHeight * 0.45;  // 45% from top of image
    const primaryEndY = imageHeight * 0.875;   // 87.5% from top of image
    
    logger.debug(`Primary range: ${primaryStartY}-${primaryEndY} (50%-87.5% of image height)`);
    
    const primaryFiltered = lines.filter(line => {
      // Must be in the primary content area
      if (line.avgY < primaryStartY || line.avgY > primaryEndY) {
        logger.debug(`Excluding "${line.text}" - Y: ${line.avgY}, range: ${primaryStartY}-${primaryEndY}`);
        return false;
      }
      
      // Exclude very large text (likely system UI or clock displays)
      if (line.avgArea > 50000) {
        logger.debug(`Excluding very large text: "${line.text}" (area: ${line.avgArea})`);
        return false;
      }
      
      return true;
    });
    
    logger.debug(`Primary area (50%-87.5%) filtered to ${primaryFiltered.length} lines`);
    if (primaryFiltered.length > 0) {
      logger.debug(`Included lines:`, primaryFiltered.map(line => 
        `"${line.text}" (Y: ${line.avgY})`
      ));
    }
    
    // If primary strategy found good candidates, use them
    if (primaryFiltered.length >= 2) {
      return primaryFiltered;
    }
    
    // If primary area has some candidates but not enough, try upper fallback
    if (primaryFiltered.length === 1) {
      logger.debug('Primary area has 1 candidate, trying upper fallback');
      const upperFallbackStartY = imageHeight * 0.08;  // 8% from top of image
      const upperFallbackEndY = imageHeight * 0.20;    // 20% from top of image
      
      const upperFallbackFiltered = lines.filter(line => {
        if (line.avgY < upperFallbackStartY || line.avgY > upperFallbackEndY) {
          return false;
        }
        
        // Exclude very large text (likely system UI)
        if (line.avgArea > 5000) {
          return false;
        }
        
        return true;
      });
      
      logger.debug(`Upper fallback area (8%-20%) filtered to ${upperFallbackFiltered.length} lines`);
      
      // Combine primary and upper fallback candidates
      const combinedCandidates = [...primaryFiltered, ...upperFallbackFiltered];
      if (combinedCandidates.length >= 2) {
        logger.debug(`Combined candidates: ${combinedCandidates.length} total`);
        return combinedCandidates;
      }
    }
    
    // UPPER FALLBACK STRATEGY: Search in 8%-20% area (upper content area)
    logger.debug('Primary area insufficient, trying upper fallback area (8%-20%)');
    const upperFallbackStartY = imageHeight * 0.08;  // 8% from top of image
    const upperFallbackEndY = imageHeight * 0.20;    // 20% from top of image
    
    const upperFallbackFiltered = lines.filter(line => {
      // Must be in the upper fallback content area
      if (line.avgY < upperFallbackStartY || line.avgY > upperFallbackEndY) {
        return false;
      }
      
      // Exclude very large text (likely system UI)
      if (line.avgArea > 5000) {
        return false;
      }
      
      return true;
    });
    
    logger.debug(`Upper fallback area (8%-20%) filtered to ${upperFallbackFiltered.length} lines`);
    
    // If upper fallback found candidates, use them
    if (upperFallbackFiltered.length >= 2) {
      return upperFallbackFiltered;
    }
    
    // FULL FALLBACK: Very lenient filtering using 5%-100% of image height
    logger.debug('Both areas insufficient, using full fallback (5%-100%)');
    const fullFallbackStartY = imageHeight * 0.05;  // 5% from top of image
    const fullFallbackEndY = imageHeight * 1.00;    // 100% from top of image (bottom of image)
    
    const fullFallbackFiltered = lines.filter(line => {
      // Basic position filtering
      if (line.avgY < fullFallbackStartY || line.avgY > fullFallbackEndY) {
        return false;
      }
      
      // Exclude very large text (likely system UI)
      if (line.avgArea > 10000) {
        return false;
      }
      
      return true;
    });
    
    logger.debug(`Full fallback filtered to ${fullFallbackFiltered.length} lines`);
    return fullFallbackFiltered;
  },

  filterByPositionUpperFallback(lines, imageDimensions) {
    const { height: imageHeight, width: imageWidth } = imageDimensions;
    
    logger.debug(`🎧 Using upper fallback filtering (${imageWidth}x${imageHeight})`);
    
    // UPPER FALLBACK STRATEGY: Search in 8%-20% area (upper content area)
    const upperFallbackStartY = imageHeight * 0.08;  // 8% from top of image
    const upperFallbackEndY = imageHeight * 0.20;    // 20% from top of image
    
    logger.debug(`🎧 Upper fallback range: ${upperFallbackStartY}-${upperFallbackEndY} (8%-20% of image height)`);
    
    const upperFallbackFiltered = lines.filter(line => {
      // Must be in the upper fallback content area
      if (line.avgY < upperFallbackStartY || line.avgY > upperFallbackEndY) {
        logger.debug(`🎧 Excluding "${line.text}" - Y: ${line.avgY}, range: ${upperFallbackStartY}-${upperFallbackEndY}`);
        return false;
      }
      
      // Exclude very large text (likely system UI)
      if (line.avgArea > 5000) {
        logger.debug(`🎧 Excluding very large text: "${line.text}" (area: ${line.avgArea})`);
        return false;
      }
      
      return true;
    });
    
    logger.debug(`🎧 Upper fallback area (8%-20%) filtered to ${upperFallbackFiltered.length} lines`);
    if (upperFallbackFiltered.length > 0) {
      logger.debug(`🎧 Included lines:`, upperFallbackFiltered.map(line => 
        `"${line.text}" (Y: ${line.avgY})`
      ));
    }
    
    return upperFallbackFiltered;
  },

  filterByPositionContentRelative(lines) {
    logger.debug('Using content-relative filtering (fallback)');
    
    // Calculate image dimensions from content
    const maxY = Math.max(...lines.map(line => line.avgY));
    const minY = Math.min(...lines.map(line => line.avgY));
    const imageHeight = maxY - minY;
    const imageWidth = Math.max(...lines.map(line => 
      line.words ? Math.max(...line.words.map(w => w.boundingPoly.vertices[1].x)) : 0
    ));
    
    logger.debug(`Content-based dimensions: ${imageWidth}x${imageHeight}`);
    logger.debug(`minY: ${minY}, maxY: ${maxY}, imageHeight: ${imageHeight}`);
    
    // PRIMARY STRATEGY: Focus on the podcast content area (50%-100% of content height)
    const primaryStartY = minY + (imageHeight * 0.50);  // 50% from top
    const primaryEndY = minY + (imageHeight * 1.00);    // 100% from top (bottom of screen)
    
    logger.debug(`Primary range: ${primaryStartY}-${primaryEndY} (50%-100%)`);
    
    const primaryFiltered = lines.filter(line => {
      // Must be in the primary content area
      if (line.avgY < primaryStartY || line.avgY > primaryEndY) {
        logger.debug(`Excluding "${line.text}" - Y: ${line.avgY}, range: ${primaryStartY}-${primaryEndY}`);
        return false;
      }
      
      // Exclude very large text (likely system UI or clock displays)
      if (line.avgArea > 50000) {
        logger.debug(`Excluding very large text: "${line.text}" (area: ${line.avgArea})`);
        return false;
        }
      
      return true;
    });
    
    logger.debug(`Primary area (50%-100%) filtered to ${primaryFiltered.length} lines`);
    if (primaryFiltered.length > 0) {
      logger.debug(`Included lines:`, primaryFiltered.map(line => 
        `"${line.text}" (Y: ${line.avgY})`
      ));
    }
    
    // If primary strategy found good candidates, use them
    if (primaryFiltered.length >= 2) {
      return primaryFiltered;
    }
    
    // If primary area has some candidates but not enough, try to include upper content
    if (primaryFiltered.length === 1) {
      logger.debug('Primary area has 1 candidate, trying to include upper content');
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
    
      logger.debug(`Upper area (20%-50%) filtered to ${upperFiltered.length} lines`);
      
      // Combine primary and upper candidates
      const combinedCandidates = [...primaryFiltered, ...upperFiltered];
      if (combinedCandidates.length >= 2) {
        logger.debug(`Combined candidates: ${combinedCandidates.length} total`);
        return combinedCandidates;
      }
    }
    
    // FALLBACK STRATEGY: Search in 10%-20% area (upper content area)
    logger.debug('Primary area insufficient, trying fallback area (10%-20%)');
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
      
    logger.debug(`Fallback area (10%-20%) filtered to ${fallbackFiltered.length} lines`);
    
    // If fallback found candidates, use them
    if (fallbackFiltered.length >= 2) {
      return fallbackFiltered;
    }
    
    // LAST RESORT: Very lenient filtering
    logger.debug('Both areas insufficient, using very lenient fallback');
    const excludeTopThreshold = minY + (imageHeight * 0.15);
    const excludeBottomThreshold = maxY - (imageHeight * 0.05);
    
    const lastResortFiltered = lines.filter(line => {
      // Basic position filtering
      if (line.avgY < excludeTopThreshold || line.avgY > excludeBottomThreshold) {
        return false;
      }
      
      // Exclude very large text (likely system UI)
      if (line.avgArea > 10000) {
        return false;
      }
      
      return true;
    });
    
    logger.debug(`Last resort filtered to ${lastResortFiltered.length} lines`);
    return lastResortFiltered;
  },

  groupWordsIntoLines(individualTexts) {
    const lines = [];
    
    individualTexts.forEach(word => {
      const y = word.boundingPoly.vertices[0].y;
      const x = word.boundingPoly.vertices[0].x;
      
      // Calculate word height for height-based filtering
      const vertices = word.boundingPoly.vertices;
      const wordHeight = Math.abs(vertices[2].y - vertices[0].y);
      
      // Find existing line with similar Y position AND similar height
      let line = lines.find(l => {
        const yMatch = Math.abs(l.avgY - y) < this.config.lineTolerance;
        if (!yMatch) return false;
        
        // Special handling for punctuation marks - exempt them from height ratio check
        const isPunctuation = /^[^\w\s]+$/.test(word.description) || word.description === ':';
        if (isPunctuation) {
          return true; // Allow punctuation to join any line with matching Y position
        }
        
        // Check if heights are compatible (within 80% of each other)
        const lineAvgHeight = l.words.reduce((sum, w) => {
          const v = w.boundingPoly.vertices;
          return sum + Math.abs(v[2].y - v[0].y);
        }, 0) / l.words.length;
        
        const heightRatio = Math.min(wordHeight, lineAvgHeight) / Math.max(wordHeight, lineAvgHeight);
        return heightRatio >= 0.8; // 80% height similarity threshold
      });
      
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
  },

  calculateAverageArea(words) {
    const totalArea = words.reduce((sum, word) => {
      const v = word.boundingPoly.vertices;
      const width = Math.abs(v[1].x - v[0].x);
      const height = Math.abs(v[2].y - v[0].y);
      return sum + (width * height);
    }, 0);
    
    return totalArea / words.length;
  },

  isValidCandidate(line) {
    const text = line.text.toLowerCase().trim();
    const originalText = line.text.trim();
    
    logger.debug(`isValidCandidate checking: "${originalText}" (area: ${line.avgArea}, wordCount: ${line.wordCount}, length: ${text.length}, config range: ${this.config.minCandidateLength}-${this.config.maxCandidateLength})`);
    
    // Basic length and word count filters - be more lenient for single words
    if (text.length < this.config.minCandidateLength || 
        text.length > this.config.maxCandidateLength) {
        logger.debug(`Rejecting "${originalText}" - length ${text.length} outside range ${this.config.minCandidateLength}-${this.config.maxCandidateLength}`);
        return false;
      }
      
    // For word count: allow single words if they're substantial (like podcast names)
    if (line.wordCount < 1) {
        logger.debug(`Rejecting "${originalText}" - word count ${line.wordCount} < 1`);
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
      logger.debug(`Rejecting "${originalText}" - system UI text`);
      return false;
    }
    
    // Exclude very small text (likely thumbnail overlays or UI elements)
    if (line.avgArea < 2500) {
      logger.debug(`Rejecting "${originalText}" - area ${line.avgArea} < 2500`);
      return false;
    }
    
    logger.debug(`"${originalText}" passed area check (area: ${line.avgArea})`);
      
    // If it's a single word, it should be substantial (not just a short word)
    if (line.wordCount === 1 && text.length < 6) {
        logger.debug(`Rejecting "${originalText}" - single word too short (length: ${text.length})`);
        return false;
      }
      
    // Language-agnostic pattern-based filtering
    
    // 1. Time patterns (any language)
    if (this.isTimePattern(text)) {
        logger.debug(`Rejecting "${originalText}" - time pattern`);
        return false;
      }
      
    // 2. Date patterns (any language)
    if (this.isDatePattern(text)) {
        logger.debug(`Rejecting "${originalText}" - date pattern`);
        return false;
      }
      
    // 3. Percentage patterns
    if (/\b\d+%/.test(text)) {
        logger.debug(`Rejecting "${originalText}" - percentage pattern`);
        return false;
      }
      
    // 4. Pure numbers or symbols
    if (/^[\d\s\-:]+$/.test(text) || /^[^\w\s]+$/.test(text)) {
        logger.debug(`Rejecting "${originalText}" - pure numbers/symbols`);
        return false;
      }
      
    // 5. Single character or very short words
    if (/^.{1,2}$/.test(text.replace(/\s/g, ''))) {
        logger.debug(`Rejecting "${originalText}" - single character or very short words`);
        return false;
      }
      
    // 6. All caps filter - REMOVED to allow episode titles like "You 2.0 : The Passion Pill"
    // This was filtering out valid episode titles that contained numbers and colons
    
    // 7. Starts with lowercase - ALLOW ALL (removed filter)
    // This allows truncated episode titles and other content that starts with lowercase
    
    // 8. Ellipsis filter - Reject candidates with 4+ periods in a row (UI loading indicators)
    if (/\.{4,}/.test(text)) {
              logger.debug(`Rejecting "${originalText}" - contains 4+ periods in a row (UI loading indicator)`);
        return false;
    }
    
    // 9. System text structure filter - REMOVED to allow episode titles with numbers and colons
    // This was filtering out valid episode titles like "You 2.0 : The Passion Pill"
    
    logger.debug(`"${originalText}" PASSED all filters!`);
    return true;
  },

  isTimePattern(text) {
    // Time formats: 12:34, 1:23:45, 12:34 AM, etc.
    const timePatterns = [
      /^\d{1,2}:\d{2}(:\d{2})?(\s*(am|pm|a\.m\.|p\.m\.))?$/i,
      /^\d{1,2}:\d{2}$/, // Simple time
    ];
    
    return timePatterns.some(pattern => pattern.test(text));
  },

  isDatePattern(text) {
    // Universal date indicators (language-agnostic)
    
    // Contains numbers with date-like separators (but not version numbers like 2.0)
    if (/\d+[\/\-\.]\d+([\/\-\.]\d+)?/.test(text)) {
      // Exclude version numbers like "2.0", "1.5", etc.
      if (!/\d+\.\d+/.test(text) || text.length < 10) {
      return true;
      }
    }
    
    // Day-month patterns (any language) - but not version numbers
    if (/\d{1,2}\s+\w+/.test(text) && text.length < 25) {
      // Exclude patterns like "2.0" where the space might be interpreted as \s+
      if (!/\d+\.\d+/.test(text)) {
      return true;
      }
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
  },

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
  },

  couldBeTimestamp(text) {
    // Check if text could be a podcast timestamp
    // Podcast timestamps: "15:14", "1:23:45", "0:45", etc.
    return /^\d{1,2}:\d{2}(:\d{2})?$/.test(text.trim());
  },

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
  },

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
  },

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
};
