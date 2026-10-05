import React, { useRef, useState } from 'react';
import PodcastScreenshotProcessor from './components/PodcastScreenshotProcessor';
import HomeScreen from './components/HomeScreen';

function App() {
  const [showProcessor, setShowProcessor] = useState(false);
  const [shouldTriggerFileDialog, setShouldTriggerFileDialog] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const fileInputRef = useRef();

  const handleSelectScreenshots = () => {
    // Trigger file dialog while keeping home screen visible
    setShouldTriggerFileDialog(true);
    setTimeout(() => {
      if (fileInputRef.current) {
        fileInputRef.current.click();
      }
    }, 100);
  };

  const handleFilesSelected = (files) => {
    // Switch to processor only after files are selected
    if (files && files.length > 0) {
      setSelectedFiles(files);
      setShowProcessor(true);
    }
    setShouldTriggerFileDialog(false);
  };

  const handleFileDialogCancel = () => {
    // Reset state if user cancels file dialog
    setShouldTriggerFileDialog(false);
  };

  return (
    <div className="min-h-screen bg-[#f6f3ee]">
      {!showProcessor ? (
        <>
          <HomeScreen onSelectScreenshots={handleSelectScreenshots} />
          {/* Hidden file input for home screen */}
          <input
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            ref={fileInputRef}
            onChange={(e) => {
              const files = Array.from(e.target.files);
              handleFilesSelected(files);
            }}
            onCancel={handleFileDialogCancel}
          />
        </>
      ) : (
        <PodcastScreenshotProcessor 
          fileInputRef={fileInputRef}
          shouldTriggerFileDialog={shouldTriggerFileDialog}
          initialFiles={selectedFiles}
        />
      )}
    </div>
  );
}

export default App; 