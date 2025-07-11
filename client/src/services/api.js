// Check if we're in development or production
const isDevelopment = process.env.NODE_ENV === 'development';
const API_BASE_URL = process.env.REACT_APP_API_URL || (isDevelopment ? 'http://localhost:3001/api' : '/api');

export const processScreenshots = async (formData) => {
  const response = await fetch(`${API_BASE_URL}/extract`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
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
      timestamp: podcastInfo.secondPass?.timestamp,
      timeRange: timeRange
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}; 