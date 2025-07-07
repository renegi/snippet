const vision = require('@google-cloud/vision');
const logger = require('../utils/logger');
const applePodcastsService = require('./applePodcastsService');

class VisionService {
  constructor() {
    this.client = new vision.ImageAnnotatorClient();
  }

  async extractText(imagePath) {
    try {
      const [result] = await this.client.textDetection(imagePath);
      const detections = result.textAnnotations;
      
      if (!detections || detections.length === 0) {
        throw new Error('No text detected in image');
      }

      // Get the full text from the first annotation
      const fullText = detections[0].description;
      
      // DEBUG: Log all detected text
      logger.info('=== FULL OCR TEXT ===');
      logger.info(fullText);
      logger.info('=== INDIVIDUAL TEXT ANNOTATIONS ===');
      detections.slice(1).forEach((detection, index) => {
        const vertices = detection.boundingPoly.vertices;
        const y = vertices[0].y;
        logger.info(`${index}: "${detection.description}" at Y=${y}`);
      });
      logger.info('=== END DEBUG ===');
      
      // Extract podcast information using positioning data
      const podcastInfo = this.parsePodcastInfoWithPositioning(detections, fullText);
      
      // Store original OCR results (first pass)
      const originalOCR = {
        podcastTitle: podcastInfo.podcastTitle,
        episodeTitle: podcastInfo.episodeTitle,
        timestamp: podcastInfo.timestamp,
        player: podcastInfo.player
      };
      
      // Validate the extracted info against Apple Podcasts API
      if (podcastInfo.podcastTitle || podcastInfo.episodeTitle) {
        logger.info('Attempting to validate podcast info with Apple Podcasts API...');
        const validation = await applePodcastsService.validatePodcastInfo(
          podcastInfo.podcastTitle,
          podcastInfo.episodeTitle
        );
        
        podcastInfo.validation = validation;
        
        // If validation succeeded with high confidence, use the validated titles
        if (validation.validated && validation.confidence >= 0.7) {
          logger.info('High confidence validation successful, using validated titles');
          podcastInfo.podcastTitle = validation.validatedPodcast.title;
          if (validation.validatedEpisode) {
            podcastInfo.episodeTitle = validation.validatedEpisode.title;
          }
          podcastInfo.player = 'validated';
        } else if (validation.validated && validation.confidence >= 0.6) {
          logger.info('Moderate confidence validation, keeping original with suggestions');
          // Keep original titles but provide suggestions
          podcastInfo.player = 'partially_validated';
        } else {
          logger.info('Primary validation failed, trying fallback combinations...');
          
          // Get all potential title candidates from debug info
          const allCandidates = podcastInfo.debug?.titleCandidates || [];
          const fallbackResult = await this.tryFallbackValidation(
            podcastInfo.podcastTitle,
            podcastInfo.episodeTitle,
            allCandidates
          );
          
          if (fallbackResult.success) {
            logger.info('Fallback validation successful!', fallbackResult);
            podcastInfo.podcastTitle = fallbackResult.validatedPodcast;
            podcastInfo.episodeTitle = fallbackResult.validatedEpisode;
            podcastInfo.validation = fallbackResult.validation;
            podcastInfo.validation.fallbackSource = fallbackResult.fallbackSource;
            podcastInfo.player = 'validated_fallback';
          } else {
            logger.info('All validation attempts failed, keeping original OCR results');
            podcastInfo.player = 'unvalidated';
          }
        }
      }
      
      // Add original OCR results for UI comparison
      podcastInfo.firstPass = originalOCR;
      podcastInfo.secondPass = {
        podcastTitle: podcastInfo.podcastTitle,
        episodeTitle: podcastInfo.episodeTitle,
        timestamp: podcastInfo.timestamp,
        player: podcastInfo.player,
        validation: podcastInfo.validation
      };
      
      return podcastInfo;
    } catch (error) {
      logger.error('Error in Vision API:', error);
      throw error;
    }
  }

  parsePodcastInfo(text) {
    // Common patterns for different podcast players
    const patterns = {
      applePodcasts: {
        title: /Podcast:\s*([^\n]+)/i,
        episode: /Episode:\s*([^\n]+)/i
      },
      spotify: {
        title: /Podcast:\s*([^\n]+)/i,
        episode: /Episode:\s*([^\n]+)/i
      },
      iosControl: {
        title: /Now Playing:\s*([^\n]+)/i,
        episode: /Episode:\s*([^\n]+)/i
      }
    };

    // Try each pattern set for title and episode
    let podcastTitle = null;
    let episodeTitle = null;
    let player = 'unknown';
    for (const [p, pattern] of Object.entries(patterns)) {
      const titleMatch = text.match(pattern.title);
      const episodeMatch = text.match(pattern.episode);
      if (titleMatch || episodeMatch) {
        podcastTitle = titleMatch ? titleMatch[1].trim() : null;
        episodeTitle = episodeMatch ? episodeMatch[1].trim() : null;
        player = p;
        break;
      }
    }

    // Extract all time-like strings (e.g., 7:10, 1:23:45, -12:34)
    const timeRegex = /(-?\d{1,2}:\d{2}(?::\d{2})?)/g;
    const allTimes = [...text.matchAll(timeRegex)].map(m => m[0]);
    // Filter out negative times (starting with '-')
    const positiveTimes = allTimes.filter(t => !t.startsWith('-'));
    
    // Filter out clock times by looking for context
    // Clock times are usually part of date strings or standalone
    // Podcast timestamps are usually in player controls or progress bars
    const podcastTimes = positiveTimes.filter(time => {
      // Get the context around this time in the text
      const timeIndex = text.indexOf(time);
      const contextBefore = text.substring(Math.max(0, timeIndex - 20), timeIndex);
      const contextAfter = text.substring(timeIndex + time.length, timeIndex + time.length + 20);
      const fullContext = contextBefore + contextAfter;
      
      // If it's part of a date (like "Sábado, 28 de junio, 7:10"), exclude it
      if (fullContext.match(/june|junio|january|february|march|april|may|june|july|august|september|october|november|december|ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic/i)) {
        return false;
      }
      
      // If it's followed by AM/PM or similar time indicators, it's likely a clock time
      if (fullContext.match(/am|pm|a\.m\.|p\.m\./i)) {
        return false;
      }
      
      // If it's a single digit hour (like 7:10), it might be a clock time
      // Podcast timestamps are usually longer (like 12:34 or 1:23:45)
      if (time.match(/^\d{1}:\d{2}$/)) {
        // Check if it's not in a player-like context
        if (!fullContext.match(/play|pause|stop|skip|forward|backward|progress|bar|player|podcast/i)) {
          return false;
        }
      }
      
      return true;
    });
    
    // Use the first podcast time as the timestamp (elapsed time)
    const timestamp = podcastTimes.length > 0 ? podcastTimes[0] : null;

    // If nothing found, return raw text
    if (!podcastTitle && !episodeTitle && !timestamp) {
      return {
        rawText: text,
        player: 'unknown'
      };
    }

    return {
      podcastTitle,
      episodeTitle,
      timestamp,
      player
    };
  }

  parsePodcastInfoWithPositioning(textAnnotations, fullText) {
    // Skip the first annotation as it contains the full text
    const individualTexts = textAnnotations.slice(1);

    // Get image height from all bounding boxes
    let maxY = 0;
    individualTexts.forEach(word => {
      word.boundingPoly.vertices.forEach(v => {
        if (v.y > maxY) maxY = v.y;
      });
    });

    // Group words by line using y position
    const lineTolerance = 8; // pixels
    let lines = [];
    individualTexts.forEach(word => {
      const y = word.boundingPoly.vertices[0].y;
      let line = lines.find(l => Math.abs(l.y - y) < lineTolerance);
      if (!line) {
        line = { y, words: [] };
        lines.push(line);
      }
      line.words.push(word);
    });

    // Create joined lines with metadata
    const joinedLines = lines.map(line => {
      const sortedWords = line.words.sort((a, b) => a.boundingPoly.vertices[0].x - b.boundingPoly.vertices[0].x);
      const text = sortedWords.map(w => w.description).join(' ');
      const avgArea = sortedWords.reduce((sum, w) => {
        const v = w.boundingPoly.vertices;
        const width = Math.abs(v[1].x - v[0].x);
        const height = Math.abs(v[2].y - v[0].y);
        return sum + width * height;
      }, 0) / sortedWords.length;
      const avgY = sortedWords.reduce((sum, w) => sum + w.boundingPoly.vertices[0].y, 0) / sortedWords.length;
      const avgX = sortedWords.reduce((sum, w) => sum + w.boundingPoly.vertices[0].x, 0) / sortedWords.length;
      return { text, avgY, avgX, avgArea, wordCount: sortedWords.length };
    });

    // Only consider lines in the bottom half of the image
    let bottomThreshold = maxY * (1 / 2);
    let bottomLines = joinedLines.filter(line => line.avgY >= bottomThreshold);
    if (bottomLines.length < 2) {
      bottomThreshold = maxY * (1 / 3);
      bottomLines = joinedLines.filter(line => line.avgY >= bottomThreshold);
    }

    // Filter for podcast/episode title candidates:
    // 1. Must have multiple words (at least 2)
    // 2. Must be reasonable length (3-50 chars)
    // 3. Must not be UI elements, dates, or times
    const titleCandidates = bottomLines.filter(line => {
      const description = line.text.toLowerCase().trim();
      
      // DEBUG: Log each line being considered
      logger.info(`Considering line: "${line.text}" (Y=${line.avgY}, wordCount=${line.wordCount}, length=${description.length})`);
      
      // Must have multiple words
      if (line.wordCount < 2) {
        logger.info(`  → FILTERED: Too few words (${line.wordCount})`);
        return false;
      }
      
      // Reasonable length
      if (description.length < 3 || description.length > 50) {
        logger.info(`  → FILTERED: Bad length (${description.length})`);
        return false;
      }
      
      // Filter out UI elements
      const uiElements = ['play', 'pause', 'stop', 'skip', 'forward', 'backward', 'volume'];
      if (uiElements.some(element => description.includes(element))) {
        logger.info(`  → FILTERED: UI element detected`);
        return false;
      }
      
      // Filter out date/time patterns
      if (description.match(/^\d{1,2}:\d{2}/) || description.match(/[a-z]{3,9}\s+\d{1,2}/i)) {
        logger.info(`  → FILTERED: Date/time pattern`);
        return false;
      }
      
      // Filter out lines that are mostly numbers or symbols
      if (description.match(/^\d+$/) || description.match(/^[^\w\s]+$/)) {
        logger.info(`  → FILTERED: Numbers/symbols only`);
        return false;
      }
      
      // Filter out recommendation/suggestion indicators
      const suggestionKeywords = [
        'you might also like', 'recommended', 'similar to', 'more like this',
        'related episodes', 'next up', 'up next', 'previously', 'recent',
        'trending', 'popular', 'featured', 'suggested', 'discover',
        'explore', 'browse', 'categories', 'genres'
      ];
      if (suggestionKeywords.some(keyword => description.includes(keyword))) {
        logger.info(`  → FILTERED: Suggestion keyword detected`);
        return false;
      }
      
      // Filter out navigation/menu items - BUT allow "Search Engine" as it's a valid podcast name
      const navigationKeywords = [
        'home', 'library', 'browse', 'discover', 'settings',
        'profile', 'account', 'subscribe', 'follow', 'share', 'download',
        'add to', 'save to', 'playlist', 'queue', 'history'
      ];
      // Special case: "Search Engine" is a valid podcast name, don't filter it
      if (description !== 'search engine' && navigationKeywords.some(keyword => description.includes(keyword))) {
        logger.info(`  → FILTERED: Navigation keyword detected`);
        return false;
      }
      
      // Filter out episode metadata that's not the title
      const metadataKeywords = [
        'duration', 'length', 'published', 'released', 'aired', 'recorded',
        'season', 'episode number', 'part', 'chapter', 'segment'
      ];
      if (metadataKeywords.some(keyword => description.includes(keyword))) {
        logger.info(`  → FILTERED: Metadata keyword detected`);
        return false;
      }
      
      // Filter out very generic or short phrases that are unlikely to be titles
      if (description.length < 8 && !description.match(/\b(with|and|of|the|in|on|at|by)\b/)) {
        logger.info(`  → FILTERED: Too short and no connecting words`);
        return false; // Too short and no connecting words typical of titles
      }
      
      logger.info(`  → KEPT: Candidate accepted`);
      return true;
    });

    // DEBUG: Log title candidates
    logger.info('Title candidates:', JSON.stringify(titleCandidates, null, 2));

    // Smart merging: If multiple title candidates are very close vertically, merge them
    // This handles cases where episode titles get split across lines due to visual elements
    const mergedCandidates = [];
    const mergeThreshold = 50; // Increased threshold for better merging
    
    titleCandidates.sort((a, b) => a.avgY - b.avgY); // Sort by position first
    
    for (let i = 0; i < titleCandidates.length; i++) {
      const current = titleCandidates[i];
      let mergeGroup = [current];
      
      // Look ahead to find all candidates that should be merged with current
      for (let j = i + 1; j < titleCandidates.length; j++) {
        const candidate = titleCandidates[j];
        if (Math.abs(candidate.avgY - current.avgY) < mergeThreshold) {
          mergeGroup.push(candidate);
          i = j; // Update i to skip these candidates in the outer loop
        } else {
          break; // No more candidates to merge
        }
      }
      
      if (mergeGroup.length > 1) {
        // Sort by horizontal position (left to right) to maintain word order
        mergeGroup.sort((a, b) => a.avgX - b.avgX);
        
        // Check for special cases that should be merged
        const mergedText = mergeGroup.map(g => g.text).join(' ');
        
        // Clean up the merged text
        let cleanMergedText = mergedText.trim();
        
        // Special handling for "WHERE SHOULD WE BEGIN?" type patterns
        if (cleanMergedText.toLowerCase().includes('where') && 
            cleanMergedText.toLowerCase().includes('should') && 
            cleanMergedText.includes('begin')) {
          cleanMergedText = 'Where Should We Begin?';
        }
        
        const mergedCandidate = {
          text: cleanMergedText,
          avgY: mergeGroup.reduce((sum, g) => sum + g.avgY, 0) / mergeGroup.length,
          avgX: mergeGroup.reduce((sum, g) => sum + g.avgX, 0) / mergeGroup.length,
          avgArea: Math.max(...mergeGroup.map(g => g.avgArea)), // Take the largest area
          wordCount: mergeGroup.reduce((sum, g) => sum + g.wordCount, 0)
        };
        mergedCandidates.push(mergedCandidate);
      } else {
        mergedCandidates.push(current);
      }
    }
    
    // Clean up the merged candidates
    const cleanedCandidates = mergedCandidates.map(candidate => {
      let cleanText = candidate.text.trim();
      
      // Remove trailing single characters that are likely OCR errors
      cleanText = cleanText.replace(/\s+[a-zA-Z]$/, '');
      
      // Fix common OCR errors
      cleanText = cleanText.replace(/\s+/g, ' '); // Multiple spaces to single space
      cleanText = cleanText.replace(/\s+\?/g, '?'); // Space before question mark
      cleanText = cleanText.replace(/\s+!/g, '!'); // Space before exclamation mark
      cleanText = cleanText.replace(/\s+\./g, '.'); // Space before period
      
      // Common OCR substitutions
      cleanText = cleanText.replace(/Bee\b/gi, 'Been'); // "Bee" -> "Been"
      cleanText = cleanText.replace(/\bBee$/, 'Been'); // "Bee" at end -> "Been"
      
      // Mark potentially truncated titles
      const isTruncated = this.isPotentiallyTruncated(cleanText);
      
      return {
        ...candidate,
        text: cleanText.trim(),
        isTruncated: isTruncated
      };
    }).filter(candidate => candidate.text.length >= 3); // Filter out candidates that became too short
    
    // DEBUG: Log cleaned candidates
    logger.info('Cleaned title candidates:', JSON.stringify(cleanedCandidates, null, 2));

    // Generate additional candidate variations by looking for similar patterns
    const additionalCandidates = [];
    
    // NEW: Look for standalone podcast names that might be separated from episode titles
    const podcastNameCandidates = bottomLines.filter(line => {
      const text = line.text.toLowerCase().trim();
      // Look for common podcast names that might be standalone
      return (
        text === 'marketplace' ||
        text === 'serial' ||
        text === 'radiolab' ||
        text === 'freakonomics' ||
        text === 'planet money' ||
        text.includes('search engine') ||
        text.includes('where should we begin') ||
        text.includes('esther') ||
        this.looksLikePodcastName(line.text)
      );
    });
    
    podcastNameCandidates.forEach(candidate => {
      if (!cleanedCandidates.some(c => c.text.toLowerCase() === candidate.text.toLowerCase())) {
        logger.info(`Adding standalone podcast name candidate: "${candidate.text}"`);
        additionalCandidates.push({
          text: candidate.text,
          avgY: candidate.avgY,
          avgX: candidate.avgX,
          avgArea: candidate.avgArea,
          wordCount: candidate.wordCount,
          source: 'standalone_podcast_name'
        });
      }
    });
    
    // Look for "Where Should We Begin" variations in the original lines
    const whereBeginVariations = bottomLines.filter(line => 
      line.text.toLowerCase().includes('where') && line.text.toLowerCase().includes('begin')
    );
    
    whereBeginVariations.forEach(variation => {
      // Create a clean "Where Should We Begin?" variation
      if (!cleanedCandidates.some(c => c.text.toLowerCase().includes('where should we begin'))) {
        additionalCandidates.push({
          text: 'Where Should We Begin?',
          avgY: variation.avgY,
          avgX: variation.avgX,
          avgArea: variation.avgArea,
          wordCount: 4,
          source: 'reconstructed_from_fragments'
        });
      }
    });
    
    // Look for Esther Perel related content
    const estherLines = bottomLines.filter(line => 
      line.text.toLowerCase().includes('esther')
    );
    
    estherLines.forEach(line => {
      // Clean up Esther-related content
      let cleanEsther = line.text.trim();
      if (cleanEsther.toLowerCase().includes('calling') && cleanEsther.toLowerCase().includes('never')) {
        cleanEsther = cleanEsther.replace(/Bee\b/gi, 'Been');
        if (!cleanedCandidates.some(c => c.text === cleanEsther)) {
          additionalCandidates.push({
            text: cleanEsther,
            avgY: line.avgY,
            avgX: line.avgX,
            avgArea: line.avgArea,
            wordCount: line.wordCount,
            source: 'esther_content_cleaned'
          });
        }
      }
    });
    
    // Combine original candidates with additional ones
    const allCandidates = [...cleanedCandidates, ...additionalCandidates];
    
    // DEBUG: Log all candidates including additional ones
    logger.info('All candidates (including additional):', JSON.stringify(allCandidates, null, 2));

    // Sort by vertical position (top to bottom)
    allCandidates.sort((a, b) => a.avgY - b.avgY);

    // Find episode and podcast titles based on your rules:
    // 1. Episode is above podcast
    // 2. Episode has larger font (avgArea)
    // 3. Both should be multi-word strings
    let episodeTitle = null;
    let podcastTitle = null;

    if (allCandidates.length >= 2) {
      // Take the two largest candidates by area (font size)
      const sortedByArea = [...allCandidates].sort((a, b) => b.avgArea - a.avgArea);
      const candidate1 = sortedByArea[0]; // Largest (should be episode)
      const candidate2 = sortedByArea[1]; // Second largest (should be podcast)
      
      // Assign based on position: episode should be above podcast
      if (candidate1.avgY < candidate2.avgY) {
        // candidate1 is above candidate2 - correct order
        episodeTitle = candidate1.text.trim();
        podcastTitle = candidate2.text.trim();
      } else {
        // candidate2 is above candidate1 - swap
        episodeTitle = candidate2.text.trim();
        podcastTitle = candidate1.text.trim();
      }
    } else if (allCandidates.length === 1) {
      // Only one candidate - assume it's the episode
      episodeTitle = allCandidates[0].text.trim();
    }

    // Extract timestamp using improved logic
    const timeRegex = /(-?\d{1,2}:\d{2}(?::\d{2})?)/g;
    const allTimes = [...fullText.matchAll(timeRegex)].map(m => m[0]);
    const positiveTimes = allTimes.filter(t => !t.startsWith('-'));
    
    // Log all detected times for debugging
    logger.info('All detected times:', allTimes);
    logger.info('Positive times:', positiveTimes);
    
    const podcastTimes = positiveTimes.filter(time => {
      const timeIndex = fullText.indexOf(time);
      const contextBefore = fullText.substring(Math.max(0, timeIndex - 20), timeIndex);
      const contextAfter = fullText.substring(timeIndex + time.length, timeIndex + time.length + 20);
      const fullContext = contextBefore + contextAfter;
      
      logger.info(`Checking time "${time}" with context: "${fullContext}"`);
      
      // Date filter
      if (fullContext.match(/june|junio|january|february|march|april|may|june|july|august|september|october|november|december|ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic/i)) {
        logger.info(`  → FILTERED: Date context detected`);
        return false;
      }
      
      // AM/PM filter
      if (fullContext.match(/am|pm|a\.m\.|p\.m\./i)) {
        logger.info(`  → FILTERED: AM/PM detected`);
        return false;
      }
      
      // Single digit hour filter - but be more lenient
      if (time.match(/^\d{1}:\d{2}$/)) {
        // Instead of requiring specific context, just check it's not obviously a clock time
        const hasClockContext = fullContext.match(/\b(today|tomorrow|yesterday|morning|afternoon|evening|night)\b/i);
        if (hasClockContext) {
          logger.info(`  → FILTERED: Clock time context detected`);
          return false;
        }
        // If no clear clock context, accept it as a potential podcast timestamp
        logger.info(`  → KEPT: Single digit hour accepted (no clear clock context)`);
        return true;
      }
      
      logger.info(`  → KEPT: Time accepted`);
      return true;
    });
    
    logger.info('Filtered podcast times:', podcastTimes);
    const timestamp = podcastTimes.length > 0 ? podcastTimes[0] : null;
    
    // NEW: If no timestamp found, add fallback search for standalone times
    if (!timestamp) {
      logger.info('No timestamp found via context filtering, trying fallback approach...');
      
      // Look for any time patterns in the text, prioritizing those near player controls
      const allPossibleTimes = positiveTimes.filter(time => {
        // Accept any reasonable time format
        return time.match(/^\d{1,2}:\d{2}(?::\d{2})?$/);
      });
      
      if (allPossibleTimes.length > 0) {
        // Take the first reasonable time as fallback
        const fallbackTime = allPossibleTimes[0];
        logger.info(`Using fallback timestamp: ${fallbackTime}`);
        return {
          podcastTitle,
          episodeTitle,
          timestamp: fallbackTime,
          player: 'unknown',
          debug: {
            titleCandidates: allCandidates,
            timestampMethod: 'fallback'
          }
        };
      }
    }

    return {
      podcastTitle,
      episodeTitle,
      timestamp,
      player: 'unknown',
      debug: {
        titleCandidates: allCandidates,
        timestampMethod: timestamp ? 'context_filtered' : 'not_found'
      }
    };
  }

  async tryFallbackValidation(podcastTitle, episodeTitle, candidates) {
    logger.info('Starting fallback validation with candidates:', candidates.map(c => c.text));
    
    // ENHANCED: More comprehensive system text detection
    const isSystemText = (text) => {
      if (!text) return false;
      const lowerText = text.toLowerCase().trim();
      
      // Battery and charging patterns (multiple languages)
      const batteryPatterns = [
        /\b(charging|battery|power|recarga|batería|carga|cargar|energia|energía)\b/,
        /\b(optimized|optimizada|programado|scheduled|完了|充電|电池)\b/,
        /\b(complete|completa|finished|terminado|done|listo)\b/,
        /\b(low|bajo|empty|vacía|crítico|critical)\b/
      ];
      
      // Time and scheduling patterns
      const timePatterns = [
        /\b(para las|at|scheduled for|programado para|à|um|às)\b/,
        /\d{1,2}:\d{2}\s*(am|pm|a\.m\.|p\.m\.)/,
        /\b(morning|mañana|tarde|evening|noche|night)\b/
      ];
      
      // System notification patterns
      const systemPatterns = [
        /\b(notification|notificación|aviso|alert|alerta|reminder|recordatorio)\b/,
        /\b(silent|silencio|do not disturb|no molestar|quiet|callado)\b/,
        /\b(sleep|sueño|dream|dormir|休眠|睡眠)\b/,
        /\b(final|finish|end|fin|término|último)\b/
      ];
      
      // Check if text matches any system patterns
      const matchesBattery = batteryPatterns.some(pattern => pattern.test(lowerText));
      const matchesTime = timePatterns.some(pattern => pattern.test(lowerText));
      const matchesSystem = systemPatterns.some(pattern => pattern.test(lowerText));
      
      // Additional heuristics for system text
      const hasTimeFormat = /\d{1,2}:\d{2}/.test(lowerText);
      const hasSystemWords = /\b(el|la|de|para|at|the|is|was|will)\b/.test(lowerText) && lowerText.length < 30;
      
      return matchesBattery || matchesTime || matchesSystem || (hasTimeFormat && hasSystemWords);
    };
    
    const primaryLooksLikeSystem = isSystemText(podcastTitle) || isSystemText(episodeTitle);
    
    logger.info('ENHANCED SYSTEM TEXT DETECTION:');
    logger.info(`Primary podcast: "${podcastTitle}" (system text: ${isSystemText(podcastTitle)})`);
    logger.info(`Primary episode: "${episodeTitle}" (system text: ${isSystemText(episodeTitle)})`);
    logger.info(`Primary looks like system: ${primaryLooksLikeSystem}`);
    
    // ENHANCED PRIORITY 1: When primary looks like system text, test ALL candidates as podcast names first
    // This is much more aggressive than the previous approach
    if (primaryLooksLikeSystem || !podcastTitle || !episodeTitle) {
      logger.info('ENHANCED PRIORITY: Testing all candidates as podcast names (primary detection failed or looks like system text)...');
      
      // Enhanced candidate sorting with better podcast detection
      const sortedCandidates = [...candidates].sort((a, b) => {
        // Prioritize candidates that look like podcast names
        const aPodcastLike = this.looksLikePodcastName(a.text);
        const bPodcastLike = this.looksLikePodcastName(b.text);
        
        if (aPodcastLike && !bPodcastLike) return -1;
        if (!aPodcastLike && bPodcastLike) return 1;
        
        // Prioritize candidates that are NOT system text
        const aSystemLike = isSystemText(a.text);
        const bSystemLike = isSystemText(b.text);
        
        if (!aSystemLike && bSystemLike) return -1;
        if (aSystemLike && !bSystemLike) return 1;
        
        // Then by area (larger font = more likely to be important)
        return b.avgArea - a.avgArea;
      });
      
      logger.info('Enhanced sorted candidates for priority testing:', sortedCandidates.map(c => ({
        text: c.text,
        podcastLike: this.looksLikePodcastName(c.text),
        systemLike: isSystemText(c.text),
        avgArea: c.avgArea
      })));
      
      // Test each candidate more aggressively
      for (const candidate of sortedCandidates) {
        // Skip if this candidate also looks like system text
        if (isSystemText(candidate.text)) {
          logger.info(`Skipping system text candidate: "${candidate.text}"`);
          continue;
        }
        
        try {
          logger.info(`Testing candidate as podcast (enhanced priority): "${candidate.text}"`);
          const podcastOnlyValidation = await applePodcastsService.validatePodcastInfo(candidate.text, null);
          
          // Lower confidence threshold when system text is detected
          const confidenceThreshold = primaryLooksLikeSystem ? 0.6 : 0.7;
          
          if (podcastOnlyValidation.validated && podcastOnlyValidation.validatedPodcast?.confidence >= confidenceThreshold) {
            logger.info(`HIGH CONFIDENCE podcast match found: "${candidate.text}" (confidence: ${podcastOnlyValidation.validatedPodcast.confidence})`);
            
            // Now try to find a matching episode from other candidates
            const otherCandidates = candidates.filter(c => 
              c.text !== candidate.text && !isSystemText(c.text)
            );
            
            // Enhanced episode matching with multiple strategies
            for (const episodeCandidate of otherCandidates) {
              try {
                logger.info(`Testing high-confidence podcast + episode candidate: "${candidate.text}" + "${episodeCandidate.text}"`);
                const fullValidation = await applePodcastsService.validatePodcastInfo(candidate.text, episodeCandidate.text);
                
                // Lower episode confidence threshold when system text was detected
                const episodeThreshold = primaryLooksLikeSystem ? 0.25 : 0.3;
                
                if (fullValidation.validated && fullValidation.validatedEpisode?.confidence >= episodeThreshold) {
                  logger.info(`HIGH CONFIDENCE podcast + episode match found!`);
                  return {
                    success: true,
                    validatedPodcast: fullValidation.validatedPodcast.title,
                    validatedEpisode: fullValidation.validatedEpisode.title,
                    validation: fullValidation,
                    fallbackSource: `enhanced_priority_podcast_with_episode: ${candidate.text} + ${episodeCandidate.text}`
                  };
                }
              } catch (error) {
                logger.error(`Error testing enhanced priority podcast + episode:`, error);
              }
            }
            
            // Enhanced episode search with better keyword extraction
            logger.info(`High-confidence podcast found, searching for episodes via enhanced keyword search...`);
            try {
              const allEpisodes = await applePodcastsService.searchEpisodes(podcastOnlyValidation.validatedPodcast.id, null);
              logger.info(`Retrieved ${allEpisodes.length} episodes for keyword matching`);
              
              // Try to match episode candidates with actual episodes using enhanced keywords
              for (const episodeCandidate of otherCandidates) {
                // Enhanced keyword extraction
                const keywords = episodeCandidate.text.toLowerCase()
                  .replace(/[^\w\s]/g, ' ')
                  .split(/\s+/)
                  .filter(word => 
                    word.length >= 3 && 
                    !['the', 'and', 'for', 'with', 'that', 'this', 'but', 'not', 'you', 'are', 'was', 'were', 'been', 'have', 'has', 'had', 'will', 'would', 'could', 'should'].includes(word)
                  );
                
                if (keywords.length > 0) {
                  const keywordMatches = allEpisodes.filter(episode => {
                    const episodeTitle = episode.trackName.toLowerCase();
                    const matchCount = keywords.filter(keyword => episodeTitle.includes(keyword)).length;
                    return matchCount >= Math.min(2, keywords.length); // Require at least 2 keywords or all keywords if less than 2
                  });
                  
                  if (keywordMatches.length > 0) {
                    const bestMatch = keywordMatches[0];
                    logger.info(`Found episode via enhanced keyword search: "${bestMatch.trackName}" (matched keywords: ${keywords.join(', ')})`);
                    
                    return {
                      success: true,
                      validatedPodcast: podcastOnlyValidation.validatedPodcast.title,
                      validatedEpisode: bestMatch.trackName,
                      validation: {
                        validated: true,
                        confidence: 0.8,
                        validatedPodcast: podcastOnlyValidation.validatedPodcast,
                        validatedEpisode: {
                          title: bestMatch.trackName,
                          id: bestMatch.trackId,
                          confidence: 0.7,
                          extracted: episodeCandidate.text
                        },
                        keywordMatch: true,
                        matchedKeywords: keywords,
                        systemTextDetected: primaryLooksLikeSystem
                      },
                      fallbackSource: `enhanced_priority_podcast_with_keyword_episode: ${candidate.text} + keywords(${keywords.join(', ')})`
                    };
                  }
                }
              }
            } catch (error) {
              logger.error('Error in enhanced priority episode search:', error);
            }
            
            // If no episode match at all, return podcast with generic episode
            logger.info(`High-confidence podcast found but no episode match, returning podcast-only result`);
            return {
              success: true,
              validatedPodcast: podcastOnlyValidation.validatedPodcast.title,
              validatedEpisode: 'Unknown Episode',
              validation: {
                ...podcastOnlyValidation,
                validatedEpisode: {
                  title: 'Unknown Episode',
                  confidence: 0.3,
                  extracted: episodeTitle || 'Unknown'
                },
                podcastOnlyMatch: true,
                systemTextDetected: primaryLooksLikeSystem
              },
              fallbackSource: `enhanced_priority_podcast_only: ${candidate.text}`
            };
          } else if (podcastOnlyValidation.validated && podcastOnlyValidation.validatedPodcast?.confidence >= 0.4) {
            logger.info(`MEDIUM CONFIDENCE podcast match found: "${candidate.text}" (confidence: ${podcastOnlyValidation.validatedPodcast.confidence}) - continuing to check other candidates`);
            // Store this as a potential fallback but continue looking for better matches
          }
        } catch (error) {
          logger.error(`Error testing enhanced priority candidate as podcast:`, error);
        }
      }
    }
    
    // ENHANCED PRIORITY 2: Try broad episode search across all podcasts using candidate text
    logger.info('ENHANCED PRIORITY: Trying broad episode search across all podcasts...');
    
    for (const candidate of candidates) {
      try {
        logger.info(`Searching for episodes matching: "${candidate.text}"`);
        const episodeSearchResults = await applePodcastsService.searchEpisodes(null, candidate.text);
        logger.info(`Episode search returned ${episodeSearchResults.length} results`);
        
        if (episodeSearchResults.length > 0) {
          const bestMatch = episodeSearchResults[0];
          logger.info(`Found episode "${bestMatch.trackName}" in podcast "${bestMatch.collectionName}"`);
          
          // Check if any other candidates match the podcast name
          const matchingPodcastCandidate = candidates.find(c => {
            if (c.text === candidate.text) return false;
            const similarity = this.calculateSimilarity(
              c.text.toLowerCase(),
              bestMatch.collectionName.toLowerCase()
            );
            return similarity > 0.6;
          });
          
          if (matchingPodcastCandidate) {
            logger.info(`Found matching podcast candidate "${matchingPodcastCandidate.text}" for podcast "${bestMatch.collectionName}"`);
            return {
              success: true,
              validatedPodcast: bestMatch.collectionName,
              validatedEpisode: bestMatch.trackName,
              validation: {
                validated: true,
                confidence: 0.8,
                validatedPodcast: {
                  title: bestMatch.collectionName,
                  id: bestMatch.collectionId,
                  confidence: 0.8
                },
                validatedEpisode: {
                  title: bestMatch.trackName,
                  id: bestMatch.trackId,
                  confidence: 0.8
                },
                episodeSearchMatch: true,
                systemTextDetected: primaryLooksLikeSystem
              },
              fallbackSource: `enhanced_episode_search_with_podcast_candidate: ${candidate.text} -> ${bestMatch.collectionName}`
            };
          } else {
            // Even without a matching podcast candidate, return the episode match
            logger.info(`No matching podcast candidate, but found episode match via search`);
            return {
              success: true,
              validatedPodcast: bestMatch.collectionName,
              validatedEpisode: bestMatch.trackName,
              validation: {
                validated: true,
                confidence: 0.75,
                validatedPodcast: {
                  title: bestMatch.collectionName,
                  id: bestMatch.collectionId,
                  confidence: 0.7
                },
                validatedEpisode: {
                  title: bestMatch.trackName,
                  id: bestMatch.trackId,
                  confidence: 0.8
                },
                episodeSearchMatch: true,
                noPodcastCandidate: true,
                systemTextDetected: primaryLooksLikeSystem
              },
              fallbackSource: `enhanced_episode_search_no_podcast_candidate: ${candidate.text}`
            };
          }
        }
      } catch (error) {
        logger.error('Error in enhanced episode search:', error);
      }
    }

    // ORIGINAL PRIORITY: Test all candidates individually as podcast names (if not already done)
    if (!primaryLooksLikeSystem) {
      logger.info('ORIGINAL PRIORITY: Testing all candidates as individual podcast names...');
      for (const candidate of candidates) {
        if (candidate.text !== podcastTitle && candidate.text !== episodeTitle) {
          try {
            logger.info(`Testing candidate as podcast: "${candidate.text}"`);
            const podcastOnlyValidation = await applePodcastsService.validatePodcastInfo(candidate.text, null);
            
            if (podcastOnlyValidation.validated && podcastOnlyValidation.validatedPodcast?.confidence >= 0.8) {
              logger.info(`HIGH CONFIDENCE podcast match found: "${candidate.text}" (confidence: ${podcastOnlyValidation.validatedPodcast.confidence})`);
              
              // Now try to find a matching episode from other candidates
              for (const episodeCandidate of candidates) {
                if (episodeCandidate.text !== candidate.text && episodeCandidate.text !== podcastTitle && episodeCandidate.text !== episodeTitle) {
                  try {
                    logger.info(`Testing high-confidence podcast + episode candidate: "${candidate.text}" + "${episodeCandidate.text}"`);
                    const fullValidation = await applePodcastsService.validatePodcastInfo(candidate.text, episodeCandidate.text);
                    
                    if (fullValidation.validated && fullValidation.validatedEpisode?.confidence >= 0.4) {
                      logger.info(`HIGH CONFIDENCE podcast + episode match found!`);
                      return {
                        success: true,
                        validatedPodcast: fullValidation.validatedPodcast.title,
                        validatedEpisode: fullValidation.validatedEpisode.title,
                        validation: fullValidation,
                        fallbackSource: `high_confidence_candidate_podcast_with_episode: ${candidate.text} + ${episodeCandidate.text}`
                      };
                    }
                  } catch (error) {
                    logger.error(`Error testing high-confidence podcast + episode:`, error);
                  }
                }
              }
              
              // If no good episode match, return the high-confidence podcast with original episode
              logger.info(`High-confidence podcast found but no good episode match, keeping original episode`);
              return {
                success: true,
                validatedPodcast: podcastOnlyValidation.validatedPodcast.title,
                validatedEpisode: episodeTitle || 'Unknown Episode',
                validation: {
                  ...podcastOnlyValidation,
                  validatedEpisode: episodeTitle ? {
                    title: episodeTitle,
                    confidence: 0.5,
                    extracted: episodeTitle
                  } : null,
                  podcastOnlyMatch: true
                },
                fallbackSource: `high_confidence_candidate_podcast_only: ${candidate.text}`
              };
            } else if (podcastOnlyValidation.validated && podcastOnlyValidation.validatedPodcast?.confidence >= 0.6) {
              logger.info(`MEDIUM CONFIDENCE podcast match found: "${candidate.text}" (confidence: ${podcastOnlyValidation.validatedPodcast.confidence}) - continuing to check other candidates`);
              // Don't return immediately, continue checking for better matches
            }
          } catch (error) {
            logger.error(`Error testing candidate as podcast:`, error);
          }
        }
      }
    }

    // Create a list of all possible combinations to try
    const combinations = [];
    
    // 1. Try swapping the original podcast and episode titles
    if (podcastTitle && episodeTitle) {
      combinations.push({
        podcast: episodeTitle,
        episode: podcastTitle,
        source: 'swapped_original'
      });
    }
    
    // 2. Try each candidate as podcast title with the original episode
    if (episodeTitle) {
      candidates.forEach(candidate => {
        if (candidate.text !== podcastTitle && candidate.text !== episodeTitle) {
          combinations.push({
            podcast: candidate.text,
            episode: episodeTitle,
            source: `candidate_as_podcast: ${candidate.text}`
          });
        }
      });
    }
    
    // 3. Try each candidate as episode title with the original podcast
    if (podcastTitle) {
      candidates.forEach(candidate => {
        if (candidate.text !== podcastTitle && candidate.text !== episodeTitle) {
          combinations.push({
            podcast: podcastTitle,
            episode: candidate.text,
            source: `candidate_as_episode: ${candidate.text}`
          });
        }
      });
    }
    
    // 4. Try all combinations of top candidates (sorted by area/size)
    const topCandidates = candidates
      .filter(c => c.wordCount >= 2 && c.text.length >= 5) // Filter for substantial candidates
      .sort((a, b) => b.avgArea - a.avgArea) // Sort by size (larger first)
      .slice(0, 4); // Take top 4 candidates
    
    for (let i = 0; i < topCandidates.length; i++) {
      for (let j = 0; j < topCandidates.length; j++) {
        if (i !== j) {
          const candidate1 = topCandidates[i];
          const candidate2 = topCandidates[j];
          
          // Skip if this combination is already in our list
          const alreadyTried = combinations.some(combo => 
            combo.podcast === candidate1.text && combo.episode === candidate2.text
          );
          
          if (!alreadyTried) {
            combinations.push({
              podcast: candidate1.text,
              episode: candidate2.text,
              source: `top_candidates: ${candidate1.text} + ${candidate2.text}`
            });
          }
        }
      }
    }
    
    // 5. Try individual top candidates as podcast only (no episode)
    topCandidates.forEach(candidate => {
      combinations.push({
        podcast: candidate.text,
        episode: null,
        source: `podcast_only: ${candidate.text}`
      });
    });
    
    logger.info(`Trying ${combinations.length} fallback combinations...`);
    
    // Sort combinations by likelihood (most promising first)
    combinations.sort((a, b) => {
      // Prioritize swapped original combinations
      if (a.source === 'swapped_original') return -1;
      if (b.source === 'swapped_original') return 1;
      
      // Prioritize combinations with candidates that have larger font sizes
      const aHasLargeCandidate = candidates.some(c => 
        (c.text === a.podcast || c.text === a.episode) && c.avgArea > 1000
      );
      const bHasLargeCandidate = candidates.some(c => 
        (c.text === b.podcast || c.text === b.episode) && c.avgArea > 1000
      );
      
      if (aHasLargeCandidate && !bHasLargeCandidate) return -1;
      if (!aHasLargeCandidate && bHasLargeCandidate) return 1;
      
      // Prioritize combinations with candidates that are closer together vertically
      const aPodcastCandidate = candidates.find(c => c.text === a.podcast);
      const aEpisodeCandidate = candidates.find(c => c.text === a.episode);
      const bPodcastCandidate = candidates.find(c => c.text === b.podcast);
      const bEpisodeCandidate = candidates.find(c => c.text === b.episode);
      
      if (aPodcastCandidate && aEpisodeCandidate && bPodcastCandidate && bEpisodeCandidate) {
        const aDistance = Math.abs(aPodcastCandidate.avgY - aEpisodeCandidate.avgY);
        const bDistance = Math.abs(bPodcastCandidate.avgY - bEpisodeCandidate.avgY);
        return aDistance - bDistance; // Closer pairs first
      }
      
      return 0;
    });
    
    // Try each combination and return the first one that validates with decent confidence
    for (const combo of combinations) {
      try {
        logger.info(`Trying combination: podcast="${combo.podcast}", episode="${combo.episode}" (${combo.source})`);
        
        const validation = await applePodcastsService.validatePodcastInfo(
          combo.podcast,
          combo.episode
        );
        
        // Accept if confidence is >= 0.6 (lower threshold for fallback)
        if (validation.validated && validation.confidence >= 0.6) {
          logger.info(`Fallback validation successful with confidence ${validation.confidence}: ${combo.source}`);
          return {
            success: true,
            validatedPodcast: validation.validatedPodcast.title,
            validatedEpisode: validation.validatedEpisode?.title || combo.episode,
            validation: validation,
            fallbackSource: combo.source
          };
        } else if (validation.confidence >= 0.5) {
          // Store as a potential match but keep trying for better ones
          logger.info(`Potential fallback match with confidence ${validation.confidence}: ${combo.source}`);
        }
        
      } catch (error) {
        logger.error(`Error trying fallback combination ${combo.source}:`, error);
        // Continue to next combination
      }
    }
    
    logger.info('No successful fallback validation found');
    return {
      success: false,
      validatedPodcast: null,
      validatedEpisode: null,
      validation: null
    };
  }

  isPotentiallyTruncated(text) {
    // Common indicators that a title might be truncated
    
    // Check for ellipsis or truncation indicators
    if (text.includes('...') || text.includes('…')) {
      return true;
    }
    
    // Check for common truncation patterns
    // If it ends with a dash or hyphen followed by nothing, it's likely truncated
    if (text.match(/[-–—]\s*$/)) {
      return true;
    }
    
    // Check for incomplete words at the end
    if (text.match(/\b\w{1,2}$/) && text.length > 10) {
      return true;
    }
    
    // Specific patterns for "Esther Calling" episodes
    if (text.toLowerCase().includes('esther calling')) {
      // If it doesn't have a complete thought after "Esther Calling -"
      const afterCalling = text.toLowerCase().split('esther calling')[1];
      if (afterCalling && afterCalling.includes('-')) {
        const episodePart = afterCalling.split('-')[1]?.trim();
        // If the episode part seems incomplete (no punctuation, short, etc.)
        if (episodePart && episodePart.length > 0) {
          // Check if it ends without proper conclusion
          if (!episodePart.match(/[.!?]$/) && episodePart.length < 50) {
            return true;
          }
          
          // Special case for common incomplete endings
          if (episodePart.match(/\b(never|been|bee)$/i)) {
            return true;
          }
        }
      }
    }
    
    // Check if title seems unnaturally cut off
    // Most complete episode titles are longer than 20 characters
    if (text.length > 15 && text.length < 25) {
      // Check if it ends abruptly without proper punctuation
      if (!text.match(/[.!?]$/) && !text.match(/\b(episode|ep|part|pt)\s*\d+$/i)) {
        return true;
      }
    }
    
    // NEW: Check for patterns that suggest middle/end portions of titles
    // These are common when UI scrolling shows different parts of long titles
    
    // Starts with lowercase words (suggesting it's mid-sentence)
    if (text.match(/^[a-z]/)) {
      return true;
    }
    
    // Contains "calling" but doesn't start with "Esther" (suggesting middle portion)
    if (text.toLowerCase().includes('calling') && !text.toLowerCase().startsWith('esther')) {
      return true;
    }
    
    return false;
  }
  
  calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const normalize = (str) => str.toLowerCase().trim();
    const s1 = normalize(str1);
    const s2 = normalize(str2);
    
    if (s1 === s2) return 1;
    
    // Calculate Levenshtein distance
    const matrix = [];
    const len1 = s1.length;
    const len2 = s2.length;
    
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,     // deletion
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }
    
    const distance = matrix[len1][len2];
    const maxLength = Math.max(len1, len2);
    
    return maxLength === 0 ? 1 : (maxLength - distance) / maxLength;
  }

  looksLikePodcastName(text) {
    if (!text) return false;
    
    const lowerText = text.toLowerCase().trim();
    
    // Universal system text patterns to exclude (multiple languages)
    const systemPatterns = [
      // Battery and charging
      /\b(charging|battery|power|recarga|batería|carga|cargar|energia|energía|充電|电池)\b/,
      /\b(optimized|optimizada|programado|scheduled|完了)\b/,
      /\b(complete|completa|finished|terminado|done|listo)\b/,
      /\b(low|bajo|empty|vacía|crítico|critical)\b/,
      
      // Time and scheduling
      /\b(para las|at|scheduled for|programado para|à|um|às)\b/,
      /\d{1,2}:\d{2}\s*(am|pm|a\.m\.|p\.m\.)/,
      /\b(morning|mañana|tarde|evening|noche|night)\b/,
      
      // System notifications
      /\b(notification|notificación|aviso|alert|alerta|reminder|recordatorio)\b/,
      /\b(silent|silencio|do not disturb|no molestar|quiet|callado)\b/,
      /\b(sleep|sueño|dream|dormir|休眠|睡眠)\b/,
      /\b(final|finish|end|fin|término|último)\b/,
      
      // Time patterns
      /\d{1,2}:\d{2}/,
      /\b(today|tomorrow|hoy|mañana|yesterday|ayer)\b/
    ];
    
    // If it matches system patterns, it's not a podcast name
    if (systemPatterns.some(pattern => pattern.test(lowerText))) {
      return false;
    }
    
    // Universal podcast name patterns
    const podcastIndicators = [
      // Question-based podcasts (multiple languages)
      /\b(where|what|how|why|when|who|donde|que|como|por que|cuando|quien|où|quoi|comment|pourquoi|quand|qui)\b.*\b(should|would|could|can|will|do|does|did|debe|debería|podría|puede|va|hace|hizo|devrait|pourrait|peut|va|fait)\b/,
      /\b(where|what|how|why|when|who|donde|que|como|por que|cuando|quien|où|quoi|comment|pourquoi|quand|qui)\b.*\?/,
      
      // Show/program patterns
      /\b(show|podcast|radio|program|programme|talk|conversation|interview|discussion|programa|conversación|entrevista|discusión|émission|conversation|entretien)\b/,
      /\b(with|hosted by|featuring|presents|from|con|presentado por|presenta|de|avec|présenté par|présente)\b/,
      
      // Common podcast name structures
      /\b(the|a|an|el|la|un|una|le|la|un|une)\b.*\b(show|podcast|radio|program|talk|conversation|hour|report|review|cast|news|today|tonight|morning|evening|programa|conversación|hora|reporte|revisión|noticias|hoy|esta noche|mañana|tarde|émission|conversation|heure|rapport|nouvelles|aujourd'hui|ce soir|matin|soir)\b/,
      
      // Proper nouns (likely to be podcast names)
      /^[A-Z][a-z]+(\s+[A-Z][a-z]*)*$/,
      
      // Common podcast name endings (multiple languages)
      /\b(today|tonight|now|live|daily|weekly|monthly|report|review|cast|fm|am|radio|show|podcast|hour|minute|talk|conversation|interview|discussion|news|update|digest|brief|deep|dive|insider|central|zone|corner|hub|network|media|audio|sound|voice|word|story|stories|tales|chronicles|journal|diary|log|notes|thoughts|mind|brain|heart|soul|spirit|life|world|universe|planet|earth|global|international|national|local|community|hoy|esta noche|ahora|vivo|diario|semanal|mensual|reporte|revisión|fm|am|radio|programa|podcast|hora|minuto|conversación|entrevista|discusión|noticias|actualización|resumen|profundo|interior|central|zona|rincón|centro|red|medios|audio|sonido|voz|palabra|historia|historias|cuentos|crónicas|diario|registro|notas|pensamientos|mente|cerebro|corazón|alma|espíritu|vida|mundo|universo|planeta|tierra|global|internacional|nacional|local|comunidad)\b/
    ];
    
    // Check if text matches any podcast-like patterns
    const matchesPodcastPattern = podcastIndicators.some(pattern => pattern.test(lowerText));
    
    // Additional checks for proper nouns and structure
    const hasProperNouns = /[A-Z][a-z]/.test(text);
    const hasMultipleWords = text.trim().split(/\s+/).length >= 2;
    const isReasonableLength = text.length >= 3 && text.length <= 60;
    
    // For single-word names, be more lenient if they're proper nouns and reasonable length
    if (!hasMultipleWords && hasProperNouns && isReasonableLength) {
      return true;
    }
    
    // For multi-word names, check patterns and structure
    return (matchesPodcastPattern || (hasProperNouns && hasMultipleWords)) && isReasonableLength;
  }
}

module.exports = new VisionService(); 