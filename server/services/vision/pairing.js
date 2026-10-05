// Pairs title candidates that sit next to each other vertically (episode title above/below podcast name).
// These methods are mixed into VisionService (../visionService.js), so `this` is the service.
const logger = require('../../utils/logger');

module.exports = {
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
    
    logger.debug(`🎧 Found ${pairs.length} spatial pairs:`, pairs.map(p => {
      const avgY = (p.top.avgY + p.bottom.avgY) / 2;
      return `"${p.top.text}" + "${p.bottom.text}" (avgY: ${avgY.toFixed(0)}, ${p.distance}px apart, similarity: ${(p.similarity * 100).toFixed(1)}%)`;
    }));
    
    return pairs;
  },

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
  },

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
  },

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
};
