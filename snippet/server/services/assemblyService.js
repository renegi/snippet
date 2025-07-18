const axios = require('axios');

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
const ASSEMBLYAI_BASE_URL = 'https://api.assemblyai.com/v2';

if (!ASSEMBLYAI_API_KEY) {
  console.warn('ASSEMBLYAI_API_KEY not found in environment variables');
}

async function generateTranscript(audioUrl, startTime = null, endTime = null) {
  if (!ASSEMBLYAI_API_KEY) {
    throw new Error('AssemblyAI API key not configured');
  }

  try {
    // Create transcript request
    const transcriptRequest = {
      audio_url: audioUrl,
      language_code: 'en',
      auto_highlights: true,
      auto_chapters: true,
      entity_detection: true,
      sentiment_analysis: true
    };

    // Add time constraints if provided
    if (startTime !== null && endTime !== null) {
      transcriptRequest.audio_start_from = startTime;
      transcriptRequest.audio_end_at = endTime;
    }

    const response = await axios.post(
      `${ASSEMBLYAI_BASE_URL}/transcript`,
      transcriptRequest,
      {
        headers: {
          'Authorization': ASSEMBLYAI_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('AssemblyAI API error:', error.response?.data || error.message);
    throw new Error('Failed to generate transcript');
  }
}

async function getTranscriptStatus(transcriptId) {
  if (!ASSEMBLYAI_API_KEY) {
    throw new Error('AssemblyAI API key not configured');
  }

  try {
    const response = await axios.get(
      `${ASSEMBLYAI_BASE_URL}/transcript/${transcriptId}`,
      {
        headers: {
          'Authorization': ASSEMBLYAI_API_KEY
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('AssemblyAI status check error:', error.response?.data || error.message);
    throw new Error('Failed to get transcript status');
  }
}

module.exports = {
  generateTranscript,
  getTranscriptStatus
}; 