module.exports = function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Return test response
  res.json({
    success: true,
    message: 'API is working!',
    method: req.method,
    timestamp: new Date().toISOString(),
    body: req.body,
    headers: req.headers,
    env: {
      nodeVersion: process.version,
      platform: process.platform
    }
  });
}; 