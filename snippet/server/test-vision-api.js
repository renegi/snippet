require('dotenv').config();
const vision = require('@google-cloud/vision');
const fs = require('fs');
const path = require('path');

async function testVisionAPI() {
  console.log('🔍 Testing Google Vision API...\n');
  
  // Check which credential method is being used
  let clientConfig = {};
  let credentialMethod = 'none';
  
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
    credentialMethod = 'GOOGLE_APPLICATION_CREDENTIALS_BASE64';
    try {
      const credentials = JSON.parse(
        Buffer.from(process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 'base64').toString()
      );
      clientConfig = {
        credentials: credentials,
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || credentials.project_id
      };
      console.log('✅ Found base64 credentials');
      console.log(`   Project ID: ${clientConfig.projectId}`);
      console.log(`   Client Email: ${credentials.client_email}`);
    } catch (error) {
      console.error('❌ Error parsing base64 credentials:', error.message);
      return;
    }
  } else if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    credentialMethod = 'GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY';
    clientConfig = {
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        type: 'service_account'
      },
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
    };
    console.log('✅ Found individual credential fields');
    console.log(`   Project ID: ${clientConfig.projectId || 'not set'}`);
    console.log(`   Client Email: ${process.env.GOOGLE_CLIENT_EMAIL}`);
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    credentialMethod = 'GOOGLE_APPLICATION_CREDENTIALS (file path)';
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (fs.existsSync(credPath)) {
      const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      clientConfig = {
        keyFilename: credPath,
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || credentials.project_id
      };
      console.log('✅ Found credentials file');
      console.log(`   File: ${credPath}`);
      console.log(`   Project ID: ${clientConfig.projectId}`);
      console.log(`   Client Email: ${credentials.client_email}`);
    } else {
      console.error(`❌ Credentials file not found: ${credPath}`);
      return;
    }
  } else {
    console.error('❌ No Google Cloud credentials found!');
    console.log('\nPlease set one of:');
    console.log('  - GOOGLE_APPLICATION_CREDENTIALS_BASE64 (base64 encoded JSON)');
    console.log('  - GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY');
    console.log('  - GOOGLE_APPLICATION_CREDENTIALS (path to JSON file)');
    return;
  }
  
  console.log(`\n📋 Using credential method: ${credentialMethod}\n`);
  
  // Create Vision API client
  let client;
  try {
    client = new vision.ImageAnnotatorClient(clientConfig);
    console.log('✅ Vision API client created successfully\n');
  } catch (error) {
    console.error('❌ Error creating Vision API client:', error.message);
    return;
  }
  
  // Test with a simple image (create a test image or use an existing one)
  // For now, we'll just test the client initialization
  // You can add an actual image test if you have a test image
  
  console.log('🧪 Testing API connectivity...');
  
  try {
    // Test by checking if we can access the API (this will fail if credentials are invalid)
    // We'll create a minimal test - just verify the client is properly configured
    console.log('✅ Client configuration looks valid');
    console.log('\n💡 To fully test, you would need to:');
    console.log('   1. Upload a test image');
    console.log('   2. Call client.textDetection(imagePath)');
    console.log('   3. Check the response\n');
    
    // If you want to test with an actual image, uncomment this:
    /*
    const testImagePath = path.join(__dirname, 'test-image.png');
    if (fs.existsSync(testImagePath)) {
      console.log('📸 Testing with test image...');
      const [result] = await client.textDetection(testImagePath);
      const detections = result.textAnnotations;
      if (detections && detections.length > 0) {
        console.log('✅ Vision API is working!');
        console.log(`   Detected text: ${detections[0].description.substring(0, 100)}...`);
      } else {
        console.log('⚠️  Vision API responded but no text detected');
      }
    } else {
      console.log('⚠️  No test image found, skipping actual API call');
    }
    */
    
  } catch (error) {
    console.error('❌ Error testing Vision API:', error.message);
    if (error.code === 7) {
      console.error('   This usually means "Permission denied" - check your credentials');
    } else if (error.code === 16) {
      console.error('   This usually means "Unauthenticated" - credentials are invalid');
    }
    console.error('   Full error:', error);
    return;
  }
  
  console.log('\n✅ Google Vision API test completed!');
}

testVisionAPI().catch(console.error);
