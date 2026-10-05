// Same-origin in production; in development Vite proxies /api to the local server (vite.config.js)
export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Vercel rejects request bodies over 4.5MB; stay safely below it
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
// Formats Google Vision reads directly; anything else (e.g. HEIC) gets converted
const VISION_FRIENDLY_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// Returns a file that is safe to upload. Most screenshots pass through unchanged;
// oversized or unsupported images are re-encoded as JPEG at their original
// dimensions (the OCR filtering relies on pixel positions, so we never resize).
export const prepareImageForUpload = async (file) => {
  if (VISION_FRIENDLY_TYPES.includes(file.type) && file.size <= MAX_UPLOAD_BYTES) {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    if (bitmap.close) bitmap.close();

    for (const quality of [0.92, 0.8, 0.65]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= MAX_UPLOAD_BYTES) {
        const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
        return new File([blob], name, { type: 'image/jpeg' });
      }
    }
  } catch (error) {
    console.warn('Could not convert image, uploading original:', error);
  }

  return file;
};

// Sends one screenshot per request so each upload stays under the size limit
export const processScreenshot = async (file) => {
  const uploadFile = await prepareImageForUpload(file);
  const formData = new FormData();
  formData.append('screenshots', uploadFile);

  // Add timeout to prevent infinite loading
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

  try {
    const response = await fetch(`${API_BASE_URL}/extract`, {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(await getErrorMessage(response));
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timed out - server took too long to respond');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
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
      timestamp: podcastInfo.timestamp,
      timeRange: timeRange
    }),
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return response.json();
};

// Pulls a readable message out of an error response (JSON or plain text)
const getErrorMessage = async (response) => {
  const text = await response.text();
  try {
    const body = JSON.parse(text);
    const message = typeof body.error === 'string' ? body.error : body.error?.message || body.message;
    if (message) return message;
  } catch (e) {
    // Not JSON
  }
  if (response.status === 413) return 'Screenshot is too large to upload';
  return `Server error (${response.status})`;
};
