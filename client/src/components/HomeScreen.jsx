import React, { useEffect, useState } from 'react';
import Button from './Button';
import { canReadClipboard, pasteScreenshots } from '../services/clipboard';

function HomeScreen({ onSelectScreenshots, onFilesSelected }) {
  const [pasteMessage, setPasteMessage] = useState('');

  // Scroll to top when component mounts
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handlePaste = async () => {
    setPasteMessage('');
    const { files, message } = await pasteScreenshots();
    setPasteMessage(message);
    if (files.length > 0) {
      onFilesSelected(files);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#f6f3ee] px-4">
      <div className="text-center w-full max-w-xl">
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-termina-extrabold mb-12 text-[#232323] leading-tight">
          Copy and paste<br />notes from any<br />podcast
        </h1>
        <Button size="l" onClick={onSelectScreenshots} className="w-full shadow-lg">
          Select screenshots
        </Button>
        {canReadClipboard() && (
          <Button
            variant="secondary"
            size="l"
            onClick={handlePaste}
            className="mt-4 w-full"
          >
            Paste screenshot
          </Button>
        )}
        <p role="status" className="mt-4 min-h-[1.5rem] text-base text-[#232323]">
          {pasteMessage}
        </p>
      </div>
    </div>
  );
}

export default HomeScreen;
