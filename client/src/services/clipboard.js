export const canReadClipboard = () =>
  typeof navigator !== 'undefined' && !!navigator.clipboard?.read;

// True when the browser has clipboard reads switched off for this site (Chrome).
// Safari has no such permission to query, so this is false there.
const isClipboardBlocked = async () => {
  try {
    const status = await navigator.permissions.query({ name: 'clipboard-read' });
    return status.state === 'denied';
  } catch {
    return false;
  }
};

// Read any images on the clipboard as Files. Must be called directly from a tap or click:
// Safari only allows the read during a user gesture, and shows its own "Paste" bubble
// that the user confirms. Dismissing that bubble rejects with NotAllowedError.
const readClipboardImages = async () => {
  const items = await navigator.clipboard.read();
  const files = [];
  for (const item of items) {
    const type = item.types.find(t => t.startsWith('image/'));
    if (!type) continue;
    const blob = await item.getType(type);
    const extension = type.split('/')[1].split('+')[0];
    files.push(new File([blob], `pasted-screenshot-${Date.now()}-${files.length + 1}.${extension}`, { type }));
  }
  return files;
};

// Returns the pasted screenshots, plus a message to show when there are none.
// The message is empty when the user dismissed the browser's paste prompt.
export const pasteScreenshots = async () => {
  try {
    const files = await readClipboardImages();
    return { files, message: files.length > 0 ? '' : 'No screenshot in clipboard' };
  } catch (error) {
    if (error?.name !== 'NotAllowedError') {
      return { files: [], message: 'Couldn’t read clipboard' };
    }
    return { files: [], message: (await isClipboardBlocked()) ? 'Clipboard access is blocked for this site' : '' };
  }
};
