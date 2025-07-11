import React from 'react';
import SelectScreenshotsButton from './SelectScreenshotsButton';

function HomeScreen({ onSelectScreenshots }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#f6f3ee] px-4">
      <div className="text-center w-full max-w-xl">
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-termina-extrabold mb-12 text-[#232323] leading-tight">
          Copy and paste<br />notes from any<br />podcast
        </h1>
        <SelectScreenshotsButton onClick={onSelectScreenshots} />
      </div>
    </div>
  );
}

export default HomeScreen; 