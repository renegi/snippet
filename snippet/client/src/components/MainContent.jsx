import React, { useState } from 'react';
import PodcastScreenshotProcessor from './PodcastScreenshotProcessor';
import TranscriptHighlighting from './TranscriptHighlighting';

function MainContent({ currentScreen, setCurrentScreen }) {
  return (
    <main className="flex-1 bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {currentScreen === 'home' && (
          <PodcastScreenshotProcessor setCurrentScreen={setCurrentScreen} />
        )}
        {currentScreen === 'highlighting' && (
          <TranscriptHighlighting setCurrentScreen={setCurrentScreen} />
        )}
      </div>
    </main>
  );
}

export default MainContent; 