const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

// Helper function to convert file to base64
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
};

export const processScreenshots = async (formData) => {
  try {
    console.log('🚀 Starting screenshot processing...');
    
    // Extract files from FormData
    const files = formData.getAll('screenshots');
    const timeRange = JSON.parse(formData.get('timeRange') || '{}');
    
    console.log(`📸 Processing ${files.length} files`);
    
    // Convert files to base64
    const images = await Promise.all(files.map(async (file, index) => {
      console.log(`🔄 Converting file ${index + 1} to base64...`);
      return await fileToBase64(file);
    }));
    
    console.log('✅ All files converted to base64');
    
    // Send all images in a single request
    const response = await fetch(`${API_BASE_URL}/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        images: images, // Send as array
        timeRange: timeRange
      }),
    });

    console.log(`📡 API response status: ${response.status}`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('❌ API Error:', errorData);
      throw new Error(`HTTP error! status: ${response.status} - ${errorData.error || 'Unknown error'}`);
    }

    const result = await response.json();
    console.log('✅ Processing successful:', result);
    
    // Ensure data is always an array for consistency
    const data = Array.isArray(result.data) ? result.data : [result.data];
    
    return {
      success: true,
      data: data
    };
  } catch (error) {
    console.error('❌ Error processing screenshots:', error);
    throw error;
  }
};

export const getTranscript = async (url, title) => {
  try {
    console.log('🎵 Getting transcript for:', { url, title });
    
    const response = await fetch(`${API_BASE_URL}/transcript`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url,
        title: title
      }),
    });

    console.log(`📡 Transcript API response status: ${response.status}`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('❌ Transcript API Error:', errorData);
      throw new Error(`HTTP error! status: ${response.status} - ${errorData.error || 'Unknown error'}`);
    }

    const result = await response.json();
    console.log('✅ Transcript retrieved successfully');
    return result;
  } catch (error) {
    console.error('❌ Error getting transcript:', error);
    throw error;
  }
};

// Test API endpoint
export const testAPI = async () => {
  try {
    console.log('🧪 Testing API connection...');
    
    const response = await fetch(`${API_BASE_URL}/test`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ API test successful:', result);
    return result;
  } catch (error) {
    console.error('❌ API test failed:', error);
    throw error;
  }
}; 