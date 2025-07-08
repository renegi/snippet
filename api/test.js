export default async function handler(req, res) {
  console.log(`🧪 Test API Called: ${req.method} /api/test`);
  
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    console.log('✅ Test API handling OPTIONS preflight request');
    res.status(200).end();
    return;
  }

  // Return success for any method
  res.status(200).json({ 
    success: true,
    message: '🎉 API is working!', 
    method: req.method,
    timestamp: new Date().toISOString(),
    environment: {
      nodeEnv: process.env.NODE_ENV,
      hasGoogleCredentials: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
      hasAssemblyKey: !!process.env.ASSEMBLY_API_KEY,
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY
    }
  });
} 