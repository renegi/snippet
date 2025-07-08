import axios from 'axios';

export default async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  try {
    const { url, title } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }

    // Here you would integrate with your transcript service
    // For now, return a placeholder response
    res.json({
      success: true,
      data: {
        transcript: 'Transcript functionality will be implemented here',
        url: url,
        title: title || 'Unknown Episode'
      }
    });

  } catch (error) {
    console.error('Error processing transcript request:', error);
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
} 