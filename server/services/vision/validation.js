// Checks candidate pairs against Apple Podcasts to identify the podcast and episode.
// These methods are mixed into VisionService (../visionService.js), so `this` is the service.
const logger = require('../../utils/logger');
const applePodcastsService = require('../applePodcastsService');

module.exports = {
  async validateCandidates(candidates) {
    logger.debug('🎧 Starting spatial pair validation process...');
    
    // Strategy 1: Find spatially close pairs and validate them
    let spatialPairs = this.findSpatialPairs(candidates);
    logger.debug(`🎧 Found ${spatialPairs.length} spatial pairs:`, spatialPairs.map(p => `"${p.top.text}" + "${p.bottom.text}"`));
    
    // If no spatial pairs found, log it (upper fallback is now handled in extractTextCandidates)
    if (spatialPairs.length === 0) {
      logger.debug('🎧 No spatial pairs found from current candidates');
    }
    
    // First pass: Collect all validated podcasts from spatial pairs
    const validatedPodcasts = [];
    
    for (const pair of spatialPairs) {
      logger.debug(`🎧 Testing spatial pair: top="${pair.top.text}" bottom="${pair.bottom.text}" (distance: ${pair.distance}px)`);
      
      // Test assumption: bottom = podcast, top = episode
      const result1 = await this.validateSpatialPair(pair.bottom, pair.top, 'podcast-episode');
      if (result1.success) {
        logger.debug('🎧 Spatial pair validation successful (bottom=podcast, top=episode)');
        return result1; // Return immediately if we get a complete success
      } else if (result1.podcastValidated) {
        // Podcast validated but episode didn't - save the validated podcast
                  logger.debug(`🎧 Podcast validated but episode failed, saving for cross-pair testing: ${result1.validatedPodcast.title}`);
        validatedPodcasts.push({
          validatedPodcast: result1.validatedPodcast,
          confidence: result1.podcastConfidence,
          sourcePair: pair,
          sourceCandidate: pair.bottom.text
        });
      }
      
      // Fallback: top = podcast, bottom = episode
      const result2 = await this.validateSpatialPair(pair.top, pair.bottom, 'episode-podcast');
      if (result2.success) {
        logger.debug('🎧 Spatial pair validation successful (top=podcast, bottom=episode)');
        return result2; // Return immediately if we get a complete success
      } else if (result2.podcastValidated) {
        // Podcast validated but episode didn't - save the validated podcast
                  logger.debug(`🎧 Podcast validated but episode failed, saving for cross-pair testing: ${result2.validatedPodcast.title}`);
        validatedPodcasts.push({
          validatedPodcast: result2.validatedPodcast,
          confidence: result2.podcastConfidence,
          sourcePair: pair,
          sourceCandidate: pair.top.text
        });
      }
    }
    
    // Strategy 2: Cross-pair testing - try validated podcasts with episode candidates from pairs containing that podcast
    if (validatedPodcasts.length > 0) {
      logger.debug(`🎧 Found ${validatedPodcasts.length} validated podcasts from spatial pairs, trying cross-pair episode matching...`);
      
      // Sort validated podcasts by confidence (highest first)
      validatedPodcasts.sort((a, b) => b.confidence - a.confidence);
      
      for (const { validatedPodcast, confidence: podcastConfidence, sourcePair, sourceCandidate } of validatedPodcasts) {
        logger.debug(`🎧 Testing validated podcast "${validatedPodcast.title}" with episode candidates from pairs containing "${sourceCandidate}"...`);
        
        // Find all pairs that contain the original podcast candidate text
        const relevantPairs = spatialPairs.filter(pair => 
          pair.top.text === sourceCandidate || pair.bottom.text === sourceCandidate
        );
        
        logger.debug(`🎧 Found ${relevantPairs.length} pairs containing "${sourceCandidate}":`, 
          relevantPairs.map(p => `"${p.top.text}" + "${p.bottom.text}"`));
        
        // Collect episode candidates from relevant pairs
        const relevantEpisodeCandidates = [];
        for (const pair of relevantPairs) {
          if (pair.top.text === sourceCandidate) {
            relevantEpisodeCandidates.push(pair.bottom.text);
          } else {
            relevantEpisodeCandidates.push(pair.top.text);
          }
        }
        
        logger.debug(`🎧 Episode candidates from relevant pairs:`, relevantEpisodeCandidates);
        
        // Try each relevant episode candidate with this validated podcast
        for (const episodeText of relevantEpisodeCandidates) {
          // Skip the episode candidate that was already tested with this podcast
          if (episodeText === sourceCandidate) {
            continue;
          }
          
          logger.debug(`🎧 Testing episode candidate "${episodeText}" with validated podcast "${validatedPodcast.title}"`);
          
          // Try exact episode validation first
          try {
            const exactEpisodeValidation = await applePodcastsService.validatePodcastInfo(
              validatedPodcast.title, 
              episodeText
            );
            
            if (exactEpisodeValidation.validated && 
                exactEpisodeValidation.validatedEpisode?.confidence >= 0.5) {
              logger.debug(`🎧 Cross-pair exact episode validation successful: "${exactEpisodeValidation.validatedEpisode.title}"`);
              return {
                success: true,
                podcastTitle: validatedPodcast.title,
                episodeTitle: exactEpisodeValidation.validatedEpisode.title,
                confidence: Math.min(podcastConfidence, exactEpisodeValidation.confidence),
                validation: {
                  validated: true,
                  method: 'cross_pair_exact',
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
            logger.debug('🎧 Cross-pair exact episode validation failed, trying fuzzy search:', error.message);
          }
          
          // Try fuzzy search for episode
          const fuzzyResult = await this.fuzzySearchEpisode(validatedPodcast, episodeText);
          
          if (fuzzyResult.success) {
            logger.debug(`🎧 Cross-pair fuzzy episode search successful: "${fuzzyResult.episodeTitle}"`);
            return {
              success: true,
              podcastTitle: validatedPodcast.title,
              episodeTitle: fuzzyResult.episodeTitle,
              confidence: Math.min(podcastConfidence, fuzzyResult.confidence),
              validation: {
                validated: true,
                method: 'cross_pair_fuzzy',
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
        }
      }
    }
    
    // Strategy 3: If no cross-pair matches, try individual candidates as podcasts
    logger.debug('🎧 No cross-pair matches found, trying individual candidates...');
    
    // Collect all validated podcasts from individual candidates
    const individualValidatedPodcasts = [];
    for (const candidate of candidates) {
      try {
        const validation = await applePodcastsService.validatePodcastInfo(candidate.text, null);
        
        if (validation.validated && 
            validation.validatedPodcast?.confidence >= this.config.validationConfidenceThreshold) {
          logger.debug(`🎧 Individual podcast validation successful: ${candidate.text}`);
          individualValidatedPodcasts.push({
            candidate,
            validation,
            confidence: validation.confidence
          });
        }
      } catch (error) {
        logger.debug(`🎧 Individual podcast validation error for ${candidate.text}:`, error.message);
      }
    }
    
    // Sort validated podcasts by confidence (highest first)
    individualValidatedPodcasts.sort((a, b) => b.confidence - a.confidence);
    
    // Try each validated podcast with episode search
    for (const { candidate, validation } of individualValidatedPodcasts) {
      logger.debug(`🎧 Trying episode search for validated podcast: ${validation.validatedPodcast.title}`);
      
      // Find the closest candidate directly above or below (Y-axis only)
      const otherCandidates = candidates.filter(c => c.text !== candidate.text);
      const episodeCandidate = this.findClosestVerticalCandidate(candidate, otherCandidates);
      
      if (episodeCandidate) {
        logger.debug(`🎧 Found closest vertical candidate: "${episodeCandidate.text}" (${Math.abs(episodeCandidate.avgY - candidate.avgY)}px away)`);
        
        // Try to validate this episode with the podcast
        const episodeValidation = await applePodcastsService.validatePodcastInfo(
          validation.validatedPodcast.title,
          episodeCandidate.text
        );
        
        if (episodeValidation.validated && episodeValidation.validatedEpisode) {
          // Exact episode match found
          return {
            podcastTitle: validation.validatedPodcast.title,
            episodeTitle: episodeValidation.validatedEpisode.title,
            confidence: Math.min(validation.confidence, episodeValidation.confidence),
            validation: {
              validated: true,
              method: 'individual_podcast_with_episode',
              validatedPodcast: validation.validatedPodcast,
              validatedEpisode: episodeValidation.validatedEpisode
            },
            player: 'validated'
          };
        } else {
          // Try fuzzy episode search
          const fuzzyResult = await this.fuzzySearchEpisode(
            validation.validatedPodcast,
            episodeCandidate.text
          );
          
          if (fuzzyResult.success) {
                  return {
            podcastTitle: validation.validatedPodcast.title,
              episodeTitle: fuzzyResult.episodeTitle,
              confidence: Math.min(validation.confidence, fuzzyResult.confidence),
              validation: {
                validated: true,
                method: 'individual_podcast_with_fuzzy_episode',
                validatedPodcast: validation.validatedPodcast,
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
        }
      }
      
      // Try broad episode search with this podcast
      logger.debug(`🎧 Trying broad episode search for podcast: ${validation.validatedPodcast.title}`);
      try {
        const episodeResults = await applePodcastsService.searchEpisodes(validation.validatedPodcast.id, null);
        
        if (episodeResults && episodeResults.length > 0) {
          const bestMatch = episodeResults[0];
          logger.debug(`🎧 Episode search match found: ${bestMatch.trackName} from ${validation.validatedPodcast.title}`);
          
          return {
            podcastTitle: validation.validatedPodcast.title,
            episodeTitle: bestMatch.trackName,
            confidence: Math.min(validation.confidence, 0.8),
            validation: {
              validated: true,
              method: 'podcast_with_episode_search',
              validatedPodcast: validation.validatedPodcast,
              validatedEpisode: {
                id: bestMatch.trackId,
                title: bestMatch.trackName,
                artworkUrl: bestMatch.artworkUrl100,
                confidence: 0.8
              }
            },
            player: 'validated'
                  };
                }
              } catch (error) {
        logger.debug(`🎧 Episode search error for ${validation.validatedPodcast.title}:`, error.message);
      }
    }
    
    // If we have validated podcasts but no episodes found, return the best one with "Unknown Episode"
    if (individualValidatedPodcasts.length > 0) {
      const bestPodcast = individualValidatedPodcasts[0];
      logger.debug(`🎧 Returning best validated podcast with unknown episode: ${bestPodcast.validation.validatedPodcast.title}`);
      
      return {
        podcastTitle: bestPodcast.validation.validatedPodcast.title,
        episodeTitle: 'Unknown Episode',
        confidence: bestPodcast.confidence,
        validation: bestPodcast.validation,
        player: 'validated'
      };
    }
    
    // Strategy 3: Broad episode search as final fallback
    logger.debug('🎧 Trying broad episode search as final fallback...');
    for (const candidate of candidates) {
      try {
        const episodeResults = await applePodcastsService.searchEpisodes(null, candidate.text);
        
        if (episodeResults && episodeResults.length > 0) {
          const bestMatch = episodeResults[0];
          logger.debug(`🎧 Episode search match found: ${bestMatch.trackName} from ${bestMatch.collectionName}`);
                    
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
        logger.debug(`🎧 Episode search error for ${candidate.text}:`, error.message);
      }
    }
    
    // Fallback: No validation successful, return "Episode not found"
    logger.debug('🎧 No validation successful, returning "Episode not found"');
    
            return {
      podcastTitle: 'Episode not found',
      episodeTitle: 'Episode not found',
      confidence: 0.0,
      validation: { validated: false, method: 'no_validation_successful' },
      player: 'unvalidated'
    };
  },

  async validateSpatialPair(podcastCandidate, episodeCandidate, pairType) {
    try {
      logger.debug(`🎧 Validating spatial pair (${pairType}): podcast="${podcastCandidate.text}" episode="${episodeCandidate.text}"`);
      
      // Step 1: Validate the podcast candidate (pass episode title for fuzzy search)
      const podcastValidation = await applePodcastsService.validatePodcastInfo(podcastCandidate.text, episodeCandidate.text);
      
      if (!podcastValidation.validatedPodcast || 
          podcastValidation.validatedPodcast?.confidence < this.config.validationConfidenceThreshold) {
        logger.debug(`🎧 Podcast validation failed for "${podcastCandidate.text}" (confidence: ${podcastValidation.validatedPodcast?.confidence || 0})`);
        return { 
          success: false,
          podcastValidated: false
        };
      }
      
      logger.debug(`🎧 Podcast validated: "${podcastValidation.validatedPodcast.title}" (confidence: ${podcastValidation.validatedPodcast.confidence})`);
      
      // Check if fuzzy podcast search already found an episode
      if (podcastValidation.validatedEpisode) {
        logger.debug(`🎧 Fuzzy podcast search already found episode: "${podcastValidation.validatedEpisode.title}"`);
        return {
          success: true,
          podcastTitle: podcastValidation.validatedPodcast.title,
          episodeTitle: podcastValidation.validatedEpisode.title,
          confidence: Math.min(podcastValidation.confidence, podcastValidation.validatedEpisode.confidence),
          validation: {
            validated: true,
            method: `spatial_pair_${pairType}_fuzzy_podcast`,
            podcastCandidate: podcastCandidate.text,
            episodeCandidate: episodeCandidate.text,
            fuzzyMatch: true,
            validatedPodcast: {
              id: podcastValidation.validatedPodcast.id,
              title: podcastValidation.validatedPodcast.title,
              artworkUrl: podcastValidation.validatedPodcast.artworkUrl,
              confidence: podcastValidation.validatedPodcast.confidence
            },
            validatedEpisode: {
              id: podcastValidation.validatedEpisode.id,
              title: podcastValidation.validatedEpisode.title,
              artworkUrl: podcastValidation.validatedEpisode.artworkUrl,
              confidence: podcastValidation.validatedEpisode.confidence
            }
          },
          player: 'validated'
        };
      }
      
      // Step 2: Try exact episode validation first
      try {
        const exactEpisodeValidation = await applePodcastsService.validatePodcastInfo(
          podcastValidation.validatedPodcast.title, 
          episodeCandidate.text
        );
        
        if (exactEpisodeValidation.validated && 
            exactEpisodeValidation.validatedEpisode?.confidence >= 0.5) {
          logger.debug(`🎧 Exact episode validation successful: "${exactEpisodeValidation.validatedEpisode.title}"`);
                      return {
                        success: true,
            podcastTitle: podcastValidation.validatedPodcast.title,
            episodeTitle: exactEpisodeValidation.validatedEpisode.title,
            confidence: Math.min(podcastValidation.confidence, exactEpisodeValidation.confidence),
            validation: {
              validated: true,
              method: `spatial_pair_${pairType}_exact`,
              podcastCandidate: podcastCandidate.text,
              episodeCandidate: episodeCandidate.text,
                          validatedPodcast: {
              id: podcastValidation.validatedPodcast.id,
              title: podcastValidation.validatedPodcast.title,
              artworkUrl: podcastValidation.validatedPodcast.artworkUrl,
              confidence: podcastValidation.validatedPodcast.confidence
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
        logger.debug('🎧 Exact episode validation failed, trying fuzzy search:', error.message);
      }
      
      // Step 3: Fuzzy search for episode using keywords
      logger.debug(`🎧 Trying fuzzy episode search for podcast "${podcastValidation.validatedPodcast.title}"`);
      const fuzzyResult = await this.fuzzySearchEpisode(
        podcastValidation.validatedPodcast, 
        episodeCandidate.text
      );
      
      if (fuzzyResult.success) {
        logger.debug(`🎧 Fuzzy episode search successful: "${fuzzyResult.episodeTitle}"`);
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
            fuzzyMatch: true,
            validatedPodcast: {
              id: podcastValidation.validatedPodcast.id,
              title: podcastValidation.validatedPodcast.title,
              artworkUrl: podcastValidation.validatedPodcast.artworkUrl,
              confidence: podcastValidation.validatedPodcast.confidence
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
      
      logger.debug(`🎧 No episode match found for "${episodeCandidate.text}" in podcast "${podcastValidation.validatedPodcast.title}"`);
      return { 
        success: false,
        podcastValidated: true,
        validatedPodcast: podcastValidation.validatedPodcast,
        podcastConfidence: podcastValidation.confidence
      };
      
    } catch (error) {
      logger.error(`🎧 Error validating spatial pair:`, error);
      return { 
        success: false,
        podcastValidated: false
      };
    }
  },

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
        logger.debug(`🎧 No keywords extracted from "${episodeText}"`);
        return { success: false };
      }
      
      logger.debug(`🎧 Fuzzy searching with keywords: [${keywords.join(', ')}] among ${allEpisodes.length} episodes`);
      
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
        logger.debug(`🎧 Best fuzzy match: "${bestMatch.episode.trackName}" (score: ${bestMatch.matchScore.toFixed(2)}, exact: ${bestMatch.exactMatches}, partial: ${bestMatch.partialMatches})`);
        
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
      
              logger.debug(`🎧 No episodes found with match score >= 0.3`);
      return { success: false };
      
    } catch (error) {
      logger.error('🎧 Error in fuzzy episode search:', error);
      return { success: false };
    }
  },

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
          logger.debug(`🎧 Episode validation error:`, error.message);
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
      logger.error('🎧 Error finding episode for podcast:', error);
    }
    
    return null;
  },

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
};
