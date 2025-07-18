const logger = require('../utils/logger');

class ApplePodcastsService {
  constructor() {
    this.baseUrl = 'https://itunes.apple.com';
  }

  async validatePodcastInfo(podcastTitle, episodeTitle) {
    try {
      logger.info('Validating podcast info with Apple Podcasts API', {
        podcastTitle,
        episodeTitle
      });

      if (!podcastTitle && !episodeTitle) {
        return {
          validated: false,
          confidence: 0,
          error: 'No podcast or episode title provided'
        };
      }

      // Search for podcast first
      let podcastResult = null;
      if (podcastTitle) {
        podcastResult = await this.searchPodcast(podcastTitle);
      }

      // Search for episode if we have episode title
      let episodeResult = null;
      if (episodeTitle && podcastResult?.validatedPodcast) {
        episodeResult = await this.searchEpisode(episodeTitle, podcastResult.validatedPodcast.id);
      }

      // Calculate confidence based on results
      let confidence = 0;
      let validated = false;

      if (podcastResult?.validatedPodcast) {
        confidence += 0.6;
        validated = true;
      }

      if (episodeResult?.validatedEpisode) {
        confidence += 0.4;
      }

      return {
        validated,
        confidence,
        validatedPodcast: podcastResult?.validatedPodcast || null,
        validatedEpisode: episodeResult?.validatedEpisode || null,
        suggestions: podcastResult?.suggestions || []
      };

    } catch (error) {
      logger.error('Error validating podcast info:', error);
      return {
        validated: false,
        confidence: 0,
        error: error.message
      };
    }
  }

  async searchPodcast(podcastTitle) {
    try {
      const searchTerm = encodeURIComponent(podcastTitle);
      const url = `${this.baseUrl}/search?term=${searchTerm}&entity=podcast&limit=5`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];

      if (results.length === 0) {
        return {
          validatedPodcast: null,
          suggestions: []
        };
      }

      // Find the best match
      const bestMatch = this.findBestMatch(podcastTitle, results);
      
      if (bestMatch && bestMatch.similarity > 0.7) {
        return {
          validatedPodcast: {
            id: bestMatch.result.collectionId,
            title: bestMatch.result.collectionName,
            artist: bestMatch.result.artistName,
            feedUrl: bestMatch.result.feedUrl
          },
          suggestions: results.slice(0, 3).map(r => ({
            title: r.collectionName,
            artist: r.artistName,
            similarity: this.calculateSimilarity(podcastTitle, r.collectionName)
          }))
        };
      }

      return {
        validatedPodcast: null,
        suggestions: results.slice(0, 3).map(r => ({
          title: r.collectionName,
          artist: r.artistName,
          similarity: this.calculateSimilarity(podcastTitle, r.collectionName)
        }))
      };

    } catch (error) {
      logger.error('Error searching podcast:', error);
      return {
        validatedPodcast: null,
        suggestions: [],
        error: error.message
      };
    }
  }

  async searchEpisode(episodeTitle, podcastId) {
    try {
      if (!podcastId) {
        return { validatedEpisode: null };
      }

      const searchTerm = encodeURIComponent(episodeTitle);
      const url = `${this.baseUrl}/lookup?id=${podcastId}&entity=podcastEpisode&limit=50`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];

      if (results.length === 0) {
        return { validatedEpisode: null };
      }

      // Find the best match
      const bestMatch = this.findBestMatch(episodeTitle, results);
      
      if (bestMatch && bestMatch.similarity > 0.6) {
        return {
          validatedEpisode: {
            id: bestMatch.result.trackId,
            title: bestMatch.result.trackName,
            description: bestMatch.result.description,
            duration: bestMatch.result.trackTimeMillis
          }
        };
      }

      return { validatedEpisode: null };

    } catch (error) {
      logger.error('Error searching episode:', error);
      return {
        validatedEpisode: null,
        error: error.message
      };
    }
  }

  async searchEpisodes(podcastId, searchTerm = null) {
    try {
      if (!podcastId) {
        return [];
      }

      const url = `${this.baseUrl}/lookup?id=${podcastId}&entity=podcastEpisode&limit=50`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const results = data.results || [];

      if (searchTerm) {
        // Filter results by search term
        const searchLower = searchTerm.toLowerCase();
        return results.filter(episode => 
          episode.trackName.toLowerCase().includes(searchLower)
        );
      }

      return results;

    } catch (error) {
      logger.error('Error searching episodes:', error);
      return [];
    }
  }

  async tryFallbackValidation(podcastTitle, episodeTitle, candidates) {
    logger.info('Starting fallback validation with candidates:', candidates.map(c => c.text));
    
    // Enhanced system text detection
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
    
    // Enhanced Priority 1: When primary looks like system text, test ALL candidates as podcast names first
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
          const podcastOnlyValidation = await this.validatePodcastInfo(candidate.text, null);
          
          // Lower confidence threshold when system text is detected
          const confidenceThreshold = primaryLooksLikeSystem ? 0.6 : 0.7;
          
          if (podcastOnlyValidation.validated && podcastOnlyValidation.confidence >= confidenceThreshold) {
            logger.info(`HIGH CONFIDENCE podcast match found: "${candidate.text}" (confidence: ${podcastOnlyValidation.confidence})`);
            
            // Now try to find a matching episode from other candidates
            const otherCandidates = candidates.filter(c => 
              c.text !== candidate.text && !isSystemText(c.text)
            );
            
            // Enhanced episode matching with multiple strategies
            for (const episodeCandidate of otherCandidates) {
              try {
                logger.info(`Testing high-confidence podcast + episode candidate: "${candidate.text}" + "${episodeCandidate.text}"`);
                const fullValidation = await this.validatePodcastInfo(candidate.text, episodeCandidate.text);
                
                // Lower episode confidence threshold when system text was detected
                const episodeThreshold = primaryLooksLikeSystem ? 0.25 : 0.3;
                
                if (fullValidation.validated && fullValidation.confidence >= episodeThreshold) {
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
              const allEpisodes = await this.searchEpisodes(podcastOnlyValidation.validatedPodcast.id, null);
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
          }
        } catch (error) {
          logger.error(`Error testing enhanced priority candidate:`, error);
        }
      }
    }
    
    // Enhanced Priority 2: Try different combinations of candidates
    logger.info('ENHANCED PRIORITY 2: Trying different combinations of candidates...');
    
    // Generate all possible combinations of candidates
    const combinations = [];
    for (let i = 0; i < candidates.length; i++) {
      for (let j = 0; j < candidates.length; j++) {
        if (i !== j) {
          combinations.push({
            podcast: candidates[i].text,
            episode: candidates[j].text,
            source: `combination_${i}_${j}`
          });
        }
      }
    }
    
    // Sort combinations by priority (podcast-like names first, non-system text first)
    combinations.sort((a, b) => {
      const aPodcastLike = this.looksLikePodcastName(a.podcast);
      const bPodcastLike = this.looksLikePodcastName(b.podcast);
      const aSystemLike = isSystemText(a.podcast);
      const bSystemLike = isSystemText(b.podcast);
      
      if (aPodcastLike && !bPodcastLike) return -1;
      if (!aPodcastLike && bPodcastLike) return 1;
      if (!aSystemLike && bSystemLike) return -1;
      if (aSystemLike && !bSystemLike) return 1;
      
      return 0;
    });
    
    // Test each combination
    for (const combo of combinations) {
      try {
        logger.info(`Testing combination: "${combo.podcast}" + "${combo.episode}" (${combo.source})`);
        const validation = await this.validatePodcastInfo(combo.podcast, combo.episode);
        
        if (validation.validated && validation.confidence >= 0.5) {
          logger.info(`Successful fallback validation with confidence ${validation.confidence}: ${combo.source}`);
          return {
            success: true,
            validatedPodcast: validation.validatedPodcast.title,
            validatedEpisode: validation.validatedEpisode?.title || 'Unknown Episode',
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

  findBestMatch(searchTerm, results) {
    let bestMatch = null;
    let bestSimilarity = 0;

    for (const result of results) {
      const title = result.collectionName || result.trackName || '';
      const similarity = this.calculateSimilarity(searchTerm, title);
      
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = { result, similarity };
      }
    }

    return bestMatch;
  }

  calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const normalize = (str) => str.toLowerCase().trim();
    const s1 = normalize(str1);
    const s2 = normalize(str2);
    
    if (s1 === s2) return 1;
    if (s1.includes(s2) || s2.includes(s1)) return 0.9;
    
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

module.exports = new ApplePodcastsService(); 