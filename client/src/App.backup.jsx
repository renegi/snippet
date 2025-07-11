import React, { useRef, useState } from 'react';
import PodcastScreenshotProcessor from './components/PodcastScreenshotProcessor';
import HomeScreen from './components/HomeScreen';

function App() {
  const [showProcessor, setShowProcessor] = useState(false);
  const fileInputRef = useRef();

  const handleSelectScreenshots = () => {
    setShowProcessor(true);
    setTimeout(() => {
      if (fileInputRef.current) {
        fileInputRef.current.click();
      }
    }, 100);
  };

  return (
    <div className="min-h-screen bg-[#f6f3ee]">
      {!showProcessor ? (
        <HomeScreen onSelectScreenshots={handleSelectScreenshots} />
      ) : (
        <PodcastScreenshotProcessor fileInputRef={fileInputRef} />
      )}
    </div>
  );
}

export default App; 