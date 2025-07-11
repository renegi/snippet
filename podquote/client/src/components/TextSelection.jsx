import React, { useState } from 'react';

function TextSelection({ transcript, onTextSelect }) {
  const [selectedText, setSelectedText] = useState('');
  const [showCorrected, setShowCorrected] = useState(true);
  const [showComparison, setShowComparison] = useState(false);

  if (!transcript) {
    return null;
  }

  const handleTextSelection = () => {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    if (selectedText && onTextSelect) {
      onTextSelect(selectedText);
    }
    setSelectedText(selectedText);
  };

  const formatTimeRange = (startMs, endMs) => {
    const formatTime = (ms) => {
      const totalSeconds = Math.floor(ms / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };
    
    return `${formatTime(startMs)} - ${formatTime(endMs)}`;
  };

  const hasCorrectedVersion = transcript.correctedTranscript && 
    transcript.correctedTranscript.correctedText !== transcript.text;

  const displayText = showCorrected && hasCorrectedVersion 
    ? transcript.correctedTranscript.correctedText 
    : transcript.text;

  const correctionData = transcript.correctedTranscript;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">Transcript</h3>
        <div className="flex items-center space-x-4">
          {transcript.timeRange && (
            <span className="text-sm text-gray-500">
              {formatTimeRange(transcript.timeRange.start, transcript.timeRange.end)}
            </span>
          )}
          {hasCorrectedVersion && (
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowComparison(!showComparison)}
                className="text-xs text-blue-600 hover:text-blue-800 underline"
              >
                {showComparison ? 'Hide' : 'Show'} Comparison
              </button>
              <button
                onClick={() => setShowCorrected(!showCorrected)}
                className={`px-3 py-1 rounded-full text-xs font-medium ${
                  showCorrected 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {showCorrected ? (correctionData.aiCorrected ? 'AI Corrected' : 'Basic Corrections') : 'Original'}
              </button>
            </div>
          )}
        </div>
      </div>
      
      {/* Transcript metadata */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div className="bg-blue-50 p-3 rounded-lg">
          <div className="font-medium text-blue-900">Audio Info</div>
          <div className="text-blue-700 mt-1">
            {transcript.audioUrl && (
              <div>Source: Audio file</div>
            )}
            {transcript.timeRange && (
              <div>
                Duration: {Math.round((transcript.timeRange.end - transcript.timeRange.start) / 1000)}s
              </div>
            )}
          </div>
        </div>
        <div className="bg-green-50 p-3 rounded-lg">
          <div className="font-medium text-green-900">Original Quality</div>
          <div className="text-green-700 mt-1">
            Confidence: {Math.round((transcript.confidence || 0) * 100)}%
          </div>
        </div>
        {correctionData && (
          <>
            <div className="bg-purple-50 p-3 rounded-lg">
              <div className="font-medium text-purple-900">AI Corrections</div>
              <div className="text-purple-700 mt-1">
                {correctionData.corrections?.length || 0} fixes
              </div>
            </div>
            <div className="bg-yellow-50 p-3 rounded-lg">
              <div className="font-medium text-yellow-900">Correction Quality</div>
              <div className="text-yellow-700 mt-1">
                {Math.round((correctionData.confidence || 0) * 100)}%
              </div>
            </div>
          </>
        )}
      </div>

      {/* Correction improvements summary */}
      {correctionData && correctionData.improvements && (
        <div className="bg-gray-50 p-3 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-900">Improvements Made:</span>
            {correctionData.fallback && (
              <span className="text-xs text-orange-600 bg-orange-100 px-2 py-1 rounded">
                Basic corrections only
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(correctionData.improvements).map(([type, count]) => (
              count > 0 && (
                <span key={type} className="bg-white px-2 py-1 rounded border text-gray-600">
                  {type === 'sentence_flow' ? 'sentence flow' : type}: {count}
                </span>
              )
            ))}
            {Object.values(correctionData.improvements).every(count => count === 0) && (
              <span className="text-gray-500 italic">No major corrections needed</span>
            )}
          </div>
        </div>
      )}

      {/* Main transcript text */}
      <div className="p-4 bg-gray-50 rounded-lg border">
        <div 
          className="text-gray-700 leading-relaxed cursor-text select-text"
          onMouseUp={handleTextSelection}
          style={{ 
            fontSize: '16px',
            lineHeight: '1.6'
          }}
        >
          {displayText || 'No transcript text available'}
        </div>
      </div>

      {/* Comparison view */}
      {showComparison && hasCorrectedVersion && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-100 px-4 py-2 border-b">
            <h4 className="font-medium text-gray-900">Original vs. Corrected Comparison</h4>
          </div>
          <div className="grid md:grid-cols-2 gap-0">
            <div className="p-4 bg-red-50 border-r">
              <h5 className="text-sm font-medium text-red-900 mb-2">Original</h5>
              <div className="text-sm text-red-800 leading-relaxed">
                {transcript.text}
              </div>
            </div>
            <div className="p-4 bg-green-50">
              <h5 className="text-sm font-medium text-green-900 mb-2">
                {correctionData.aiCorrected ? 'AI Corrected' : 'Basic Corrections'}
              </h5>
              <div className="text-sm text-green-800 leading-relaxed">
                {correctionData.correctedText}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detailed corrections */}
      {correctionData && correctionData.corrections && correctionData.corrections.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
            View Detailed Corrections ({correctionData.corrections.length})
          </summary>
          <div className="mt-2 space-y-2">
            {correctionData.corrections.map((correction, index) => {
              // Handle both string corrections (Claude API) and object corrections (legacy)
              if (typeof correction === 'string') {
                return (
                  <div key={index} className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                    <div className="text-blue-700">
                      {correction}
                    </div>
                  </div>
                );
              } else if (typeof correction === 'object' && correction.original) {
                return (
                  <div key={index} className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <span className="text-red-700 font-mono bg-red-100 px-2 py-1 rounded">
                            "{correction.original}"
                          </span>
                          <span className="text-gray-500">→</span>
                          <span className="text-green-700 font-mono bg-green-100 px-2 py-1 rounded">
                            "{correction.corrected}"
                          </span>
                        </div>
                        <div className="text-blue-700 text-xs">
                          {correction.reason}
                        </div>
                      </div>
                      {correction.confidence && (
                        <span className="text-xs text-gray-500 ml-2">
                          {Math.round(correction.confidence * 100)}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              } else {
                // Fallback for unexpected correction format
                return (
                  <div key={index} className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                    <div className="text-blue-700">
                      Correction applied (details not available)
                    </div>
                  </div>
                );
              }
            })}
          </div>
        </details>
      )}

      {/* Selected text display */}
      {selectedText && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="text-sm font-medium text-yellow-800 mb-1">Selected Text:</div>
          <div className="text-yellow-700 italic">"{selectedText}"</div>
        </div>
      )}

      {/* Word-level timestamps if available */}
      {transcript.words && transcript.words.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
            View Word-Level Timestamps ({transcript.words.length} words)
          </summary>
          <div className="mt-2 p-3 bg-gray-50 rounded-lg max-h-40 overflow-y-auto">
            <div className="text-xs space-y-1">
              {transcript.words.map((word, index) => (
                <span
                  key={index}
                  className={`inline-block mr-2 mb-1 p-1 rounded border text-gray-600 ${
                    word.confidence < 0.8 ? 'bg-yellow-100 border-yellow-300' : 'bg-white'
                  }`}
                  title={`${word.start}ms - ${word.end}ms (${Math.round(word.confidence * 100)}% confidence)`}
                >
                  {word.text}
                </span>
              ))}
            </div>
          </div>
        </details>
      )}

      {/* Processing info */}
      <div className="text-xs text-gray-500 pt-2 border-t space-y-1">
        {transcript.processingTime && (
          <div>Processing time: {transcript.processingTime}ms</div>
        )}
        {correctionData && correctionData.error && (
          <div className="text-orange-600">
            Correction note: {correctionData.error}
          </div>
        )}
      </div>
    </div>
  );
}

export default TextSelection; 