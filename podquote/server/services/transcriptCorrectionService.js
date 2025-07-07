const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');

class TranscriptCorrectionService {
  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }

  /**
   * Corrects common transcription errors using AI
   * @param {string} originalText - The original transcript text
   * @param {Object} context - Context about the podcast and episode
   * @param {Array} words - Word-level timestamps and confidence scores
   * @returns {Object} Corrected transcript with improvements and explanations
   */
  async correctTranscript(originalText, context = {}, words = []) {
    try {
      logger.info('Starting transcript correction with basic corrections only (Claude disabled)');
      
      // Skip AI correction and go directly to basic corrections
      const basicCorrected = this.applyBasicCorrections(originalText);
      
      return {
        originalText,
        correctedText: basicCorrected.correctedText,
        corrections: basicCorrected.corrections || [],
        confidence: 0.8,
        improvements: {
          punctuation: this.calculatePunctuationFixes(originalText, basicCorrected.correctedText),
          spelling: this.calculateSpellingFixes(originalText, basicCorrected.correctedText),
          grammar: this.calculateGrammarFixes(originalText, basicCorrected.correctedText),
          terminology: this.calculateTerminologyFixes(originalText, basicCorrected.correctedText),
          sentence_flow: this.calculateSentenceFlowFixes(originalText, basicCorrected.correctedText)
        },
        correctionTypes: basicCorrected.correctionTypes || [],
        processingTime: Date.now(),
        aiCorrected: false,
        fallback: true,
        error: 'AI correction disabled - using basic corrections only'
      };

    } catch (error) {
      logger.error('Error in basic corrections:', error);
      
      // Even more basic fallback - just return original with minimal processing
      return {
        originalText,
        correctedText: originalText,
        corrections: [`Basic correction failed: ${error.message}`],
        confidence: 0.7,
        improvements: {
          punctuation: 0,
          spelling: 0,
          grammar: 0,
          terminology: 0,
          sentence_flow: 0
        },
        correctionTypes: [],
        aiCorrected: false,
        fallback: true,
        error: 'All corrections failed - using original text'
      };
    }
  }

  /**
   * Pre-process text to fix obvious period placement issues
   * @param {string} text - The text to preprocess
   * @returns {string} Text with obvious period issues fixed
   */
  fixObviousPeriodIssues(text) {
    let corrected = text;

    // Pattern 1: Period followed by capitalized word that should be lowercase
    // "over the. Just tremendous" → "over the just tremendous"
    corrected = corrected.replace(/\.\s+([A-Z][a-z]+)(?=\s+[a-z])/g, ' $1');

    // Pattern 2: Period followed by common continuation words
    const continuationWords = ['just', 'and', 'but', 'so', 'that', 'what', 'which', 'who', 'how', 'why', 'when', 'where'];
    continuationWords.forEach(word => {
      const pattern = new RegExp(`\\.\\s+${word.charAt(0).toUpperCase()}${word.slice(1)}`, 'g');
      corrected = corrected.replace(pattern, ` ${word}`);
    });

    // Pattern 3: Period before "the" when it should be connected
    corrected = corrected.replace(/\.\s+The\s+([a-z])/g, ' the $1');

    return corrected;
  }

  buildContextInfo(context) {
    const info = [];
    
    if (context.podcast?.title) {
      info.push(`Podcast: "${context.podcast.title}"`);
    }
    
    if (context.episode?.title) {
      info.push(`Episode: "${context.episode.title}"`);
    }

    // Add domain-specific context based on podcast title
    const podcastTitle = context.podcast?.title?.toLowerCase() || '';
    if (podcastTitle.includes('esther') || podcastTitle.includes('therapy') || podcastTitle.includes('relationship')) {
      info.push('Domain: Psychology/Therapy/Relationships');
      info.push('Note: Pay attention to therapeutic terminology and emotional language');
    } else if (podcastTitle.includes('business') || podcastTitle.includes('entrepreneur')) {
      info.push('Domain: Business/Entrepreneurship');
    } else if (podcastTitle.includes('tech') || podcastTitle.includes('coding')) {
      info.push('Domain: Technology/Programming');
    }

    return info.join('\n');
  }

  buildCorrectionPrompt(originalText, contextInfo, lowConfidenceWords) {
    let prompt = `You are a professional transcript editor. Please correct the following podcast transcript for:

1. **Grammar and punctuation**: Fix obvious grammatical errors and punctuation issues
2. **Period placement**: Look for periods that appear mid-sentence and should be commas or removed
3. **Capitalization**: Ensure proper capitalization after periods and for proper nouns
4. **Filler word cleanup**: Remove excessive "um", "uh", "like" when they interrupt flow
5. **Sentence flow**: Ensure sentences flow naturally and aren't broken by misplaced periods

Focus especially on fixing periods that appear in the middle of sentences where they should be commas or spaces.

Original transcript:
"${originalText}"

Please provide:
1. The corrected transcript
2. A brief summary of the main corrections made

Format your response as:
CORRECTED: [corrected text here]
SUMMARY: [brief summary of corrections]`;

    return prompt;
  }

  calculateCorrectionConfidence(original, corrected, words) {
    // Base confidence on the average word confidence and the amount of changes made
    const avgWordConfidence = words.length > 0 
      ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length 
      : 0.8;
    
    const changeRatio = this.calculateChangeRatio(original, corrected);
    
    // Higher confidence if fewer changes were made (assuming original was mostly correct)
    const correctionConfidence = Math.max(0.5, 1.0 - changeRatio * 0.3);
    
    return Math.min(0.95, (avgWordConfidence + correctionConfidence) / 2);
  }

  calculateChangeRatio(original, corrected) {
    const originalWords = original.split(/\s+/);
    const correctedWords = corrected.split(/\s+/);
    
    let changes = Math.abs(originalWords.length - correctedWords.length);
    const minLength = Math.min(originalWords.length, correctedWords.length);
    
    for (let i = 0; i < minLength; i++) {
      if (originalWords[i] !== correctedWords[i]) {
        changes++;
      }
    }
    
    return changes / Math.max(originalWords.length, correctedWords.length);
  }

  /**
   * Enhanced basic corrections for obvious errors without AI (fallback)
   * @param {string} text - The text to correct
   * @returns {string} Text with basic corrections applied
   */
  applyBasicCorrections(text) {
    let corrected = text;

    // First apply obvious period fixes
    corrected = this.fixObviousPeriodIssues(corrected);

    // Common speech-to-text corrections
    const corrections = [
      // Common homophones
      [/\btheir\b/g, 'there'],
      [/\btheres\b/g, "there's"],
      [/\byour\b/g, "you're"],
      [/\bits\b(?=\s+a\s)/g, "it's"],
      
      // Common mishearings
      [/\bof\s+course\b/g, 'of course'],
      [/\ba\s+lot\b/g, 'a lot'],
      [/\bfor\s+sure\b/g, 'for sure'],
      
      // Fix remaining punctuation issues
      [/([.!?])\s*([a-z])/g, (match, punct, letter) => punct + ' ' + letter.toUpperCase()],
      [/\s+([.!?])/g, '$1'],
      [/([.!?]){2,}/g, '$1'],
      
      // Fix common sentence starters after our period fixes
      [/\s+(just|and|but|so|that|what|which|who|how|why|when|where)\s+/gi, (match, word) => ' ' + word.toLowerCase() + ' ']
    ];

    corrections.forEach(([pattern, replacement]) => {
      corrected = corrected.replace(pattern, replacement);
    });

    return {
      correctedText: corrected,
      corrections: corrections.map(c => c[0].toString()),
      correctionTypes: this.analyzeCorrectionTypes(text, corrected),
      aiCorrected: false
    };
  }

  calculatePunctuationFixes(original, corrected) {
    const originalPunctuation = (original.match(/[.,;:!?]/g) || []).length;
    const correctedPunctuation = (corrected.match(/[.,;:!?]/g) || []).length;
    return Math.abs(correctedPunctuation - originalPunctuation);
  }

  calculateSpellingFixes(original, corrected) {
    const originalWords = original.toLowerCase().split(/\s+/);
    const correctedWords = corrected.toLowerCase().split(/\s+/);
    let fixes = 0;
    
    for (let i = 0; i < Math.min(originalWords.length, correctedWords.length); i++) {
      if (originalWords[i] !== correctedWords[i] && 
          this.isLikelySpellingCorrection(originalWords[i], correctedWords[i])) {
        fixes++;
      }
    }
    return fixes;
  }

  calculateGrammarFixes(original, corrected) {
    // Simple heuristic: count word order changes and verb form changes
    const originalWords = original.toLowerCase().split(/\s+/);
    const correctedWords = corrected.toLowerCase().split(/\s+/);
    return Math.abs(originalWords.length - correctedWords.length);
  }

  calculateTerminologyFixes(original, corrected) {
    // Count changes in professional/technical terms
    const terminologyPattern = /\b(therapy|psychology|relationship|counseling|emotion|mental|cognitive)\w*\b/gi;
    const originalTerms = (original.match(terminologyPattern) || []).length;
    const correctedTerms = (corrected.match(terminologyPattern) || []).length;
    return Math.abs(correctedTerms - originalTerms);
  }

  calculateSentenceFlowFixes(original, corrected) {
    // Count period changes that affect sentence flow
    const originalPeriods = (original.match(/\.\s+[a-z]/g) || []).length;
    const correctedPeriods = (corrected.match(/\.\s+[a-z]/g) || []).length;
    return Math.abs(correctedPeriods - originalPeriods);
  }

  analyzeCorrectionTypes(original, corrected) {
    const types = [];
    
    if (this.calculatePunctuationFixes(original, corrected) > 0) {
      types.push('punctuation');
    }
    if (this.calculateSpellingFixes(original, corrected) > 0) {
      types.push('spelling');
    }
    if (this.calculateSentenceFlowFixes(original, corrected) > 0) {
      types.push('sentence_flow');
    }
    
    return types;
  }

  isLikelySpellingCorrection(word1, word2) {
    // Simple heuristic: similar length and character overlap
    if (Math.abs(word1.length - word2.length) > 3) return false;
    
    let commonChars = 0;
    const minLength = Math.min(word1.length, word2.length);
    
    for (let i = 0; i < minLength; i++) {
      if (word1[i] === word2[i]) commonChars++;
    }
    
    return commonChars / minLength > 0.6;
  }
}

module.exports = new TranscriptCorrectionService(); 