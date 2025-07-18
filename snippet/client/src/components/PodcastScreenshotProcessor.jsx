import React, { useState } from 'react';
import SelectScreenshotsButton from './SelectScreenshotsButton';
import TimeRangeSelection from './TimeRangeSelection';

function PodcastScreenshotProcessor({ setCurrentScreen }) {
  const [screenshots, setScreenshots] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleScreenshotsSelected = (files) => {
    setScreenshots(Array.from(files));
  };

  const handleProcessScreenshots = async () => {
    if (screenshots.length === 0) return;

    setIsProcessing(true);
    
    try {
      const formData = new FormData();
      screenshots.forEach(file => {
        formData.append('screenshots', file);
      });

      await fetch('/api/extract/text', {
        method: 'POST',
        body: formData
      });

      setCurrentScreen('highlighting');
    } catch (error) {
      console.error('Error processing screenshots:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-2xl font-bold mb-6">Extract Podcast Information</h2>
      
      <div className="space-y-6">
        <SelectScreenshotsButton onScreenshotsSelected={handleScreenshotsSelected} />
        
        {screenshots.length > 0 && (
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-semibold mb-2">Selected Screenshots:</h3>
            <ul className="space-y-1">
              {screenshots.map((file, index) => (
                <li key={index} className="text-sm text-gray-600">
                  {file.name}
                </li>
              ))}
            </ul>
          </div>
        )}

        <TimeRangeSelection />

        <button
          onClick={handleProcessScreenshots}
          disabled={screenshots.length === 0 || isProcessing}
          className="w-full max-w-[361px] bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Processing...' : 'Generate transcript'}
        </button>
      </div>
    </div>
  );
}

export default PodcastScreenshotProcessor; 