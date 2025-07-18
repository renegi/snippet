import React from 'react';

function TranscriptHighlighting({ setCurrentScreen }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Transcript</h2>
        <button
          onClick={() => setCurrentScreen('home')}
          className="text-blue-600 hover:text-blue-800"
        >
          ← Back
        </button>
      </div>
      
      <div className="bg-gray-50 p-4 rounded-lg">
        <p className="text-gray-600">Transcript content will appear here...</p>
      </div>
    </div>
  );
}

export default TranscriptHighlighting; 