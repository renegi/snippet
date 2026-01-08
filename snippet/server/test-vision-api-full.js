require('dotenv').config();
const vision = require('@google-cloud/vision');
const visionService = require('./services/visionService');
const logger = require('./utils/logger');

async function testVisionAPIFull() {
  console.log('🔍 Testing Google Vision API with actual extraction...\n');
  
  // Check if we have a test image
  const fs = require('fs');
  const path = require('path');
  const testImagePath = process.argv[2]; // Get image path from command line
  
  if (!testImagePath) {
    console.log('⚠️  No test image provided');
    console.log('Usage: node test-vision-api-full.js <path-to-image>');
    console.log('\nOr check your server logs when processing a screenshot to see Vision API errors.\n');
    return;
  }
  
  if (!fs.existsSync(testImagePath)) {
    console.error(`❌ Image file not found: ${testImagePath}`);
    return;
  }
  
  console.log(`📸 Testing with image: ${testImagePath}\n`);
  
  try {
    // Test the actual extraction
    console.log('🔄 Calling visionService.extractText()...\n');
    const result = await visionService.extractText(testImagePath);
    
    console.log('✅ Extraction completed!\n');
    console.log('📊 Results:');
    console.log('   Podcast Title:', result.podcastTitle || 'Not found');
    console.log('   Episode Title:', result.episodeTitle || 'Not found');
    console.log('   Timestamp:', result.timestamp || 'Not found');
    console.log('   Validated:', result.validation?.validated || false);
    console.log('   Has Validated Podcast:', !!result.validation?.validatedPodcast);
    console.log('   Has Validated Episode:', !!result.validation?.validatedEpisode);
    
    if (result.firstPass) {
      console.log('\n   First Pass:');
      console.log('     Podcast:', result.firstPass.podcastTitle || 'Not found');
      console.log('     Episode:', result.firstPass.episodeTitle || 'Not found');
      console.log('     Timestamp:', result.firstPass.timestamp || 'Not found');
    }
    
    if (result.secondPass) {
      console.log('\n   Second Pass:');
      console.log('     Podcast:', result.secondPass.podcastTitle || 'Not found');
      console.log('     Episode:', result.secondPass.episodeTitle || 'Not found');
      console.log('     Timestamp:', result.secondPass.timestamp || 'Not found');
    }
    
    if (result.error) {
      console.log('\n   ⚠️  Error:', result.error);
    }
    
  } catch (error) {
    console.error('\n❌ Error during extraction:', error.message);
    console.error('   Stack:', error.stack);
    
    if (error.code === 7) {
      console.error('\n   This is a "Permission denied" error.');
      console.error('   Your credentials may not have the Vision API enabled.');
    } else if (error.code === 16) {
      console.error('\n   This is an "Unauthenticated" error.');
      console.error('   Your credentials are invalid or expired.');
    } else if (error.message.includes('quota')) {
      console.error('\n   This is a quota/billing error.');
      console.error('   Check your Google Cloud billing and quotas.');
    }
  }
}

testVisionAPIFull().catch(console.error);
