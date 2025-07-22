// Check if we're in development or production
const isDevelopment = process.env.NODE_ENV === 'development';
const API_BASE_URL = process.env.REACT_APP_API_URL || (isDevelopment ? 'http://localhost:3001/api' : '/api');

export const processScreenshots = async (formData) => {
  console.log('📱 Mobile Debug: API call starting', {
    url: `${API_BASE_URL}/extract`,
    isDevelopment,
    API_BASE_URL
  });

  try {
    // Add timeout to prevent infinite loading
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

    const response = await fetch(`${API_BASE_URL}/extract`, {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log('📱 Mobile Debug: API response received', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('📱 Mobile Debug: API error response', {
        status: response.status,
        statusText: response.statusText,
        errorText
      });
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }

    const result = await response.json();
    console.log('📱 Mobile Debug: API result parsed', {
      success: result.success,
      dataLength: result.data?.length || 0,
      hasError: !!result.error
    });

    return result;
  } catch (error) {
    console.error('📱 Mobile Debug: API call failed', {
      error: error.message,
      name: error.name,
      stack: error.stack
    });

    if (error.name === 'AbortError') {
      throw new Error('Request timed out - server took too long to respond');
    }

    throw error;
  }
};

export const getTranscript = async (podcastInfo, timeRange) => {
  const response = await fetch(`${API_BASE_URL}/transcript`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      podcastInfo: {
        validatedPodcast: podcastInfo.validation?.validatedPodcast,
        validatedEpisode: podcastInfo.validation?.validatedEpisode
      },
      timestamp: podcastInfo.timestamp || podcastInfo.secondPass?.timestamp || podcastInfo.firstPass?.timestamp,
      timeRange: timeRange
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}; 