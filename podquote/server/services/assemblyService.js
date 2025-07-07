const axios = require('axios');
const logger = require('../utils/logger');

class AssemblyService {
  constructor() {
    this.apiKey = process.env.ASSEMBLY_API_KEY;
    this.baseUrl = 'https://api.assemblyai.com/v2';
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'authorization': this.apiKey,
        'content-type': 'application/json'
      }
    });
  }

  // Convert timestamp string (like "10:30" or "1:25:30") to seconds
  parseTimestamp(timestamp) {
    if (!timestamp) return 0;
    
    const parts = timestamp.split(':').map(Number);
    if (parts.length === 2) {
      // MM:SS format
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      // HH:MM:SS format
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    
    return 0;
  }

  async getTranscript(audioUrl, timestamp, timeRange) {
    try {
      logger.info('Starting transcription request:', {
        audioUrl: audioUrl.substring(0, 100) + '...',
        timestamp,
        timeRange
      });

      // Convert timestamp to seconds
      const timestampSeconds = this.parseTimestamp(timestamp);
      
      // Calculate start and end times in milliseconds (AssemblyAI expects milliseconds)
      const startTimeMs = Math.max(0, (timestampSeconds - timeRange.before) * 1000);
      const endTimeMs = (timestampSeconds + timeRange.after) * 1000;

      logger.info('Calculated time range:', {
        timestampSeconds,
        startTimeMs,
        endTimeMs,
        totalDurationMs: endTimeMs - startTimeMs
      });

      // Submit audio for transcription with time range
      const transcriptResponse = await this.client.post('/transcript', {
        audio_url: audioUrl,
        auto_chapters: false,
        auto_highlights: false,
        speaker_labels: true,
        // Use audio_start_from and audio_end_at for time-based segmentation
        audio_start_from: startTimeMs,
        audio_end_at: endTimeMs,
        // Enable word-level timestamps for better precision
        format_text: true,
        punctuate: true,
        dual_channel: false
      });

      const transcriptId = transcriptResponse.data.id;
      logger.info(`Transcription job submitted with ID: ${transcriptId}`);

      // Poll for transcript completion
      let transcript = await this.pollTranscript(transcriptId);

      // Process and return results
      const result = {
        text: transcript.text || '',
        words: transcript.words || [],
        utterances: transcript.utterances || [],
        confidence: transcript.confidence || 0,
        audioUrl,
        timestamp,
        timeRange,
        calculatedTimeRange: {
          startMs: startTimeMs,
          endMs: endTimeMs,
          durationMs: endTimeMs - startTimeMs
        },
        transcriptId
      };

      logger.info('Transcription completed:', {
        transcriptId,
        textLength: result.text.length,
        wordCount: result.words.length,
        utterancesCount: result.utterances.length,
        confidence: result.confidence
      });

      return result;
    } catch (error) {
      logger.error('Error in AssemblyAI API:', error);
      throw error;
    }
  }

  async pollTranscript(transcriptId) {
    const maxAttempts = 60; // Increased to 2 minutes
    const interval = 2000; // 2 seconds

    logger.info(`Polling for transcript ${transcriptId}...`);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this.client.get(`/transcript/${transcriptId}`);
        const transcript = response.data;

        logger.info(`Polling attempt ${attempt + 1}/${maxAttempts}, status: ${transcript.status}`);

        if (transcript.status === 'completed') {
          logger.info('Transcription completed successfully');
          return transcript;
        } else if (transcript.status === 'error') {
          logger.error('Transcription failed:', transcript.error);
          throw new Error(`Transcription failed: ${transcript.error}`);
        }

        // Still processing, wait before next attempt
        await new Promise(resolve => setTimeout(resolve, interval));
      } catch (error) {
        if (error.response?.status === 404) {
          logger.error(`Transcript ${transcriptId} not found`);
          throw new Error('Transcript not found');
        }
        
        logger.error(`Polling error on attempt ${attempt + 1}:`, error.message);
        if (attempt === maxAttempts - 1) {
          throw error;
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }

    throw new Error('Transcription timed out after 2 minutes');
  }
}

module.exports = new AssemblyService(); 