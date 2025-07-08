// Import your existing services
const AssemblyService = require('../podquote/server/services/assemblyService');
const ApplePodcastsService = require('../podquote/server/services/applePodcastsService');
const logger = require('../podquote/server/utils/logger');

const assemblyService = new AssemblyService();
const applePodcastsService = new ApplePodcastsService();

export default async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url, title } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Import the service
    const { TranscriptService } = await import('../podquote/server/services/transcriptService.js');
    
    const result = await TranscriptService.getTranscript(url, title);
    
    res.status(200).json(result);
  } catch (error) {
    console.error('Transcript API error:', error);
    res.status(500).json({ 
      error: 'Failed to get transcript',
      details: error.message 
    });
  }
} 