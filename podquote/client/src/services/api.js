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
    // Extract files from FormData
    const files = formData.getAll('screenshots');
    const timeRange = JSON.parse(formData.get('timeRange') || '{}');
    
    // Convert files to base64
    const images = await Promise.all(files.map(file => fileToBase64(file)));
    
    // Process each image separately since our API expects one image at a time
    const results = [];
    for (const image of images) {
      const response = await fetch(`${API_BASE_URL}/extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: image,
          timeRange: timeRange
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      results.push(result.data);
    }
    
    return {
      success: true,
      data: results
    };
  } catch (error) {
    console.error('Error processing screenshots:', error);
    throw error;
  }
};

export const getTranscript = async (url, title) => {
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

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}; 