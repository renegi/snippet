// Finds the playback position (e.g. "15:14") and rejects clock times.
// These methods are mixed into VisionService (../visionService.js), so `this` is the service.
const logger = require('../../utils/logger');

// "1:02:03" or "15:14" → seconds
const toSeconds = time => time.split(':').map(Number).reduce((total, part) => total * 60 + part, 0);

module.exports = {
  // Elapsed and remaining time on the player ("15:14 … -15:36"), and the episode length they add up to.
  // Fields are null when the player doesn't show them.
  extractPlayback(textAnnotations, elapsed) {
    const fullText = textAnnotations?.[0]?.description || '';
    const remainingTimes = [...fullText.matchAll(/(?:^|\s)[-−–]\s?(\d{1,2}:\d{2}(?::\d{2})?)(?=\s|$)/g)].map(m => m[1]);
    // Vision lists text top to bottom; the player's remaining time is the lowest one
    const remaining = remainingTimes[remainingTimes.length - 1] || null;
    return {
      elapsed: elapsed || null,
      remaining,
      durationSeconds: elapsed && remaining ? toSeconds(elapsed) + toSeconds(remaining) : null
    };
  },

  extractTimestamp(textAnnotations, imageDimensions) {
    try {
      logger.debug(`⏰ extractTimestamp - FUNCTION CALLED with ${textAnnotations ? textAnnotations.length : 0} annotations`);
      if (!textAnnotations || textAnnotations.length === 0) return null;
      
      const fullText = textAnnotations[0].description;
      const individualTexts = textAnnotations.slice(1);
    
    logger.debug(`⏰ extractTimestamp - Full text length: ${fullText.length}`);
    logger.debug(`⏰ extractTimestamp - Individual texts count: ${individualTexts.length}`);
    
    // Group words into lines and apply the same position filtering with image dimensions
    const lines = this.groupWordsIntoLines(individualTexts);
    const filteredLines = this.filterByPosition(lines, imageDimensions);
    
    logger.debug(`⏰ extractTimestamp - Lines after grouping: ${lines.length}`);
    logger.debug(`⏰ extractTimestamp - Lines after position filtering: ${filteredLines.length}`);
    
    // Log all lines for debugging
    filteredLines.forEach((line, index) => {
      logger.debug(`⏰ extractTimestamp - Line ${index}: "${line.text}" (Y: ${line.avgY}, Area: ${line.avgArea})`);
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
    
    logger.debug(`⏰ extractTimestamp - Candidate timestamps found: ${candidateTimestamps.length}`);
    candidateTimestamps.forEach((candidate, index) => {
      logger.debug(`⏰ extractTimestamp - Candidate ${index}: "${candidate.time}" (Y: ${candidate.y}, Area: ${candidate.area})`);
    });
    
    if (candidateTimestamps.length === 0) {
      logger.debug(`⏰ extractTimestamp - No candidates in filtered lines, trying fallback`);
      // Fallback: extract from full text but still filter clock times
    const allTimes = [...fullText.matchAll(timeRegex)].map(m => m[0]);
      logger.debug(`⏰ extractTimestamp - All times in full text: ${allTimes.join(', ')}`);
      const fallbackResult = this.filterClockTimes(allTimes, fullText);
      logger.debug(`⏰ extractTimestamp - Fallback result: ${fallbackResult}`);
      return fallbackResult;
    }
    
    // Filter out clock times and UI timestamps
    const podcastTimestamps = candidateTimestamps.filter(candidate => {
      logger.debug(`⏰ extractTimestamp - Filtering candidate: "${candidate.time}"`);
      
              // Exclude very large text (likely clock display)
        if (candidate.area > 5000) {
          logger.debug(`⏰ extractTimestamp - Excluded "${candidate.time}" due to large area: ${candidate.area}`);
          return false;
        }
      
              // Exclude negative timestamps (remaining time)
        if (fullText.includes('-' + candidate.time)) {
          logger.debug(`⏰ extractTimestamp - Excluded "${candidate.time}" due to negative timestamp`);
      return false;
    }
    
      // Check if this looks like a valid podcast timestamp (MM:SS format)
      const isPodcastTimestamp = /^\d{1,2}:\d{2}$/.test(candidate.time);
      const minutes = parseInt(candidate.time.split(':')[0]);
      const seconds = parseInt(candidate.time.split(':')[1]);
      const isValidTimeFormat = minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59;
      
              // If it's a valid podcast timestamp format, prioritize it over context analysis
        if (isPodcastTimestamp && isValidTimeFormat) {
          logger.debug(`⏰ extractTimestamp - Accepted "${candidate.time}" as valid podcast timestamp format`);
          return true;
        }
      
              // Context analysis for this specific timestamp (only for non-standard formats)
        const context = this.getTimestampContext(fullText, candidate.time);
        const hasClockContext = this.hasClockContext(context);
        logger.debug(`⏰ extractTimestamp - Context for "${candidate.time}": "${context}" (hasClockContext: ${hasClockContext})`);
        
        if (hasClockContext) {
          logger.debug(`⏰ extractTimestamp - Excluded "${candidate.time}" due to clock context`);
        return false;
      }
      
        logger.debug(`⏰ extractTimestamp - Accepted "${candidate.time}" as valid timestamp`);
      return true;
    });
    
    logger.debug(`⏰ extractTimestamp - Final podcast timestamps: ${podcastTimestamps.length}`);
    podcastTimestamps.forEach((candidate, index) => {
      logger.debug(`⏰ extractTimestamp - Final candidate ${index}: "${candidate.time}" (Y: ${candidate.y})`);
    });
    
    // Players show elapsed time on the same row as the remaining time ("15:14 ... -15:36").
    // Prefer timestamps on such a row, so times elsewhere (e.g. "4:30" in a lower
    // notification) aren't picked just for being lower on screen.
    const remainingTimeYs = individualTexts
      .filter(t => /^[-−–]\d{1,2}(:\d{2}){0,2}$/.test(t.description))
      .map(t => t.boundingPoly.vertices[0].y);
    const onPlayerRow = podcastTimestamps.filter(candidate =>
      remainingTimeYs.some(y => Math.abs(y - candidate.y) < this.config.lineTolerance)
    );
    const preferredTimestamps = onPlayerRow.length > 0 ? onPlayerRow : podcastTimestamps;
    
    // Sort by Y position (prefer timestamps lower on screen in content area)
    preferredTimestamps.sort((a, b) => b.y - a.y);
    
    const result = preferredTimestamps.length > 0 ? preferredTimestamps[0].time : null;
    logger.debug(`⏰ extractTimestamp - Final result: ${result}`);
    return result;
    } catch (error) {
      logger.error(`⏰ extractTimestamp - ERROR: ${error.message}`);
      logger.error(`⏰ extractTimestamp - Stack: ${error.stack}`);
      return null;
    }
  },

  filterClockTimes(times, fullText) {
    logger.debug(`filterClockTimes - Input times: ${times.join(', ')}`);
    
    const filteredTimes = times.filter(time => {
      logger.debug(`filterClockTimes - Processing time: "${time}"`);
      
      // Exclude negative timestamps
      if (fullText.includes('-' + time)) {
        logger.debug(`⏰ filterClockTimes - Excluded "${time}" due to negative timestamp`);
        return false;
      }
      
      const context = this.getTimestampContext(fullText, time);
      const hasClockContext = this.hasClockContext(context);
              logger.debug(`filterClockTimes - Context for "${time}": "${context}" (hasClockContext: ${hasClockContext})`);
      
      if (hasClockContext) {
                  logger.debug(`filterClockTimes - Excluded "${time}" due to clock context`);
        return false;
      }
      
      logger.debug(`⏰ filterClockTimes - Accepted "${time}" as valid timestamp`);
      return true;
    });
    
    logger.debug(`filterClockTimes - Final filtered times: ${filteredTimes.join(', ')}`);
    const result = filteredTimes.length > 0 ? filteredTimes[0] : null;
    logger.debug(`filterClockTimes - Final result: ${result}`);
    return result;
  },

  getTimestampContext(fullText, time) {
    const timeIndex = fullText.indexOf(time);
    return fullText.substring(
      Math.max(0, timeIndex - 30), 
      timeIndex + time.length + 30
    ).toLowerCase();
  },

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
};
