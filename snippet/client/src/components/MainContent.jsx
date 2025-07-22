import React, { useState, useRef, useEffect } from "react";
import PrimaryButtonL from "./PrimaryButtonL";

const MainContent = ({ 
  className = "",
  screenshots = [],
  onAddScreenshots,
  onGenerateTranscript,
  onScreenshotClick,
  isProcessing = false,
  processingProgress = 0,
  processingStage = "Processing..."
}) => {
  // Time increments: 15s, 30s, 45s, 1m, 1.5m, 2m (in seconds)
  const timeIncrements = [15, 30, 45, 60, 90, 120];
  const [selectedRange, setSelectedRange] = useState({ start: -15, end: 30 }); // Default: -15s to +30s
  const [isDragging, setIsDragging] = useState(false);
  const [dragHandle, setDragHandle] = useState(null); // 'left' or 'right'
  const timelineRef = useRef(null);

  // Timeline spans from -120s to +120s with 13 notches for proper 15s intervals
  // Notch positions: -120, -90, -60, -45, -30, -15, 0, 15, 30, 45, 60, 90, 120
  const getNotchPositions = () => {
    return [-120, -90, -60, -45, -30, -15, 0, 15, 30, 45, 60, 90, 120];
  };

  // Convert time to position (responsive timeline width)
  const timeToPosition = (time) => {
    const notchPositions = getNotchPositions();
    // Get actual timeline width from the container, default to 300px
    const timelineWidth = timelineRef.current ? timelineRef.current.clientWidth - 60 : 300; // Account for 30px padding on each side
    
    // Find the position based on notch spacing
    // Each notch is equally spaced across the timeline width
    const pixelsPerNotch = timelineWidth / (notchPositions.length - 1);
    
    // Find where this time falls between notches
    for (let i = 0; i < notchPositions.length - 1; i++) {
      const currentNotch = notchPositions[i];
      const nextNotch = notchPositions[i + 1];
      
      if (time >= currentNotch && time <= nextNotch) {
        // Interpolate between these two notches
        const progress = (time - currentNotch) / (nextNotch - currentNotch);
        return (i * pixelsPerNotch) + (progress * pixelsPerNotch);
      }
    }
    
    // Handle edge cases
    if (time <= notchPositions[0]) return 0;
    if (time >= notchPositions[notchPositions.length - 1]) return timelineWidth;
    
    return timelineWidth / 2; // fallback to center
  };

  // Convert position to time
  const positionToTime = (position) => {
    const notchPositions = getNotchPositions();
    // Get actual timeline width from the container, default to 300px
    const timelineWidth = timelineRef.current ? timelineRef.current.clientWidth - 60 : 300; // Account for 30px padding on each side
    const pixelsPerNotch = timelineWidth / (notchPositions.length - 1);
    
    // Find which notch interval this position falls in
    const notchIndex = Math.floor(position / pixelsPerNotch);
    const remainder = (position % pixelsPerNotch) / pixelsPerNotch;
    
    if (notchIndex >= notchPositions.length - 1) {
      return notchPositions[notchPositions.length - 1];
    }
    if (notchIndex < 0) {
      return notchPositions[0];
    }
    
    // Interpolate between notches
    const currentNotch = notchPositions[notchIndex];
    const nextNotch = notchPositions[notchIndex + 1];
    return currentNotch + (remainder * (nextNotch - currentNotch));
  };

  // Snap time to nearest increment
  const snapToIncrement = (time) => {
    if (time === 0) return 0;
    const absTime = Math.abs(time);
    const sign = time < 0 ? -1 : 1;
    
    // Find closest increment
    let closest = timeIncrements[0];
    for (let increment of timeIncrements) {
      if (Math.abs(absTime - increment) < Math.abs(absTime - closest)) {
        closest = increment;
      }
    }
    return closest * sign;
  };

  // Format time display
  const formatTime = (seconds) => {
    const absSeconds = Math.abs(seconds);
    const sign = seconds < 0 ? '-' : '+';
    
    if (absSeconds < 60) {
      return `${sign}${absSeconds}s`;
    } else {
      const mins = Math.floor(absSeconds / 60);
      const secs = absSeconds % 60;
      if (secs === 0) {
        return `${sign}${mins}m`;
      } else if (secs === 30) {
        return `${sign}${mins}.5m`;
      } else {
        return `${sign}${mins}m ${secs}s`;
      }
    }
  };

  // Handle mouse down on drag handles
  const handleMouseDown = (e, handle) => {
    e.preventDefault();
    setIsDragging(true);
    setDragHandle(handle);
  };

  // Handle touch start on drag handles
  const handleTouchStart = (e, handle) => {
    // Only prevent default if we're actually going to handle the touch
    if (e.target.closest('[data-drag-handle]')) {
    e.preventDefault();
    }
    setIsDragging(true);
    setDragHandle(handle);
  };

  // Handle mouse move for dragging
  const handleMouseMove = (e) => {
    if (!isDragging || !dragHandle || !timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - 30; // Account for 30px padding
    const time = snapToIncrement(positionToTime(x));

    setSelectedRange(prev => {
      if (dragHandle === 'left') {
        // Left handle: constrain to negative values (0 to -120s) and allow 0s minimum range
        const constrainedTime = Math.min(0, Math.max(-120, time));
        return { ...prev, start: Math.min(constrainedTime, prev.end) };
      } else {
        // Right handle: constrain to positive values (0 to +120s) and allow 0s minimum range
        const constrainedTime = Math.max(0, Math.min(120, time));
        return { ...prev, end: Math.max(constrainedTime, prev.start) };
      }
    });
  };

  // Handle touch move for dragging
  const handleTouchMove = (e) => {
    if (!isDragging || !dragHandle || !timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.touches[0].clientX - rect.left - 30; // Account for 30px padding
    const time = snapToIncrement(positionToTime(x));

    setSelectedRange(prev => {
      if (dragHandle === 'left') {
        // Left handle: constrain to negative values (0 to -120s) and allow 0s minimum range
        const constrainedTime = Math.min(0, Math.max(-120, time));
        return { ...prev, start: Math.min(constrainedTime, prev.end) };
      } else {
        // Right handle: constrain to positive values (0 to +120s) and allow 0s minimum range
        const constrainedTime = Math.max(0, Math.min(120, time));
        return { ...prev, end: Math.max(constrainedTime, prev.start) };
      }
    });
  };

  // Handle mouse up
  const handleMouseUp = () => {
    setIsDragging(false);
    setDragHandle(null);
  };

  // Handle touch end
  const handleTouchEnd = () => {
    setIsDragging(false);
    setDragHandle(null);
  };

  // Add event listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchmove', handleTouchMove);
      document.addEventListener('touchend', handleTouchEnd);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [isDragging, dragHandle]);

  const handleGenerateTranscript = () => {
    console.log('Generate transcript button clicked!');
    console.log('totalSelected:', totalSelected);
    console.log('selectedRange:', selectedRange);
    console.log('onGenerateTranscript function:', typeof onGenerateTranscript);
    
    if (onGenerateTranscript) {
      console.log('Calling onGenerateTranscript with selectedRange:', selectedRange);
      onGenerateTranscript(selectedRange);
    } else {
      console.warn('onGenerateTranscript function is not provided!');
    }
  };

  const adjustTime = (adjustment, side) => {
    setSelectedRange(prev => {
      if (side === 'left') {
        // Left handle: constrain to negative values (0 to -120s) and allow 0s minimum range
        const newTime = snapToIncrement(prev.start + adjustment);
        const constrainedTime = Math.min(0, Math.max(-120, newTime));
        return { ...prev, start: Math.min(constrainedTime, prev.end) };
      } else {
        // Right handle: constrain to positive values (0 to +120s) and allow 0s minimum range
        const newTime = snapToIncrement(prev.end + adjustment);
        const constrainedTime = Math.max(0, Math.min(120, newTime));
        return { ...prev, end: Math.max(constrainedTime, prev.start) };
      }
    });
  };

  // Calculate total selected time
  const totalSelected = selectedRange.end - selectedRange.start;

  // Component for ghost loader
  const SkeletonLoader = ({ index }) => (
    <div className="self-stretch flex flex-row items-center justify-start gap-2 animate-pulse">
      <div className="w-14 relative rounded-xl h-14 overflow-hidden shrink-0 bg-gray-200"></div>
      <div className="w-[108px] flex flex-col items-start justify-start gap-1">
        <div className="w-full h-4 bg-gray-200 rounded animate-pulse"></div>
        <div className="w-3/4 h-3 bg-gray-200 rounded animate-pulse"></div>
      </div>
    </div>
  );

  return (
    <div
      className={`w-full max-w-[393px] bg-[#f6f3ee] h-[678px] overflow-hidden shrink-0 flex flex-col items-center justify-start pt-4 px-0 pb-0 box-border gap-0 text-left text-2xl text-[#1b1b1b] font-['Termina'] relative ${className}`}
    >
      {/* Fixed header with title and add button */}
      <div className="w-full max-w-[361px] px-4 flex flex-row items-center justify-between gap-0 mb-6">
        <b className="relative leading-[130%]">
          {screenshots.length} screenshot{screenshots.length === 1 ? '' : 's'}
        </b>
        <button
          onClick={onAddScreenshots}
          className="w-10 rounded-xl h-10 overflow-hidden shrink-0 bg-[#1b1b1b] hover:bg-[#333] transition-colors flex items-center justify-center"
        >
          <div className="relative w-4 h-4">
            {/* Horizontal line */}
            <div className="absolute top-1/2 left-0 w-4 h-0.5 bg-white rounded-full transform -translate-y-1/2"></div>
            {/* Vertical line */}
            <div className="absolute left-1/2 top-0 w-0.5 h-4 bg-white rounded-full transform -translate-x-1/2"></div>
          </div>
        </button>
      </div>

      {/* Scrollable list area */}
      <div className="w-full max-w-[361px] px-4 flex-1 flex flex-col items-start justify-start overflow-y-auto pb-[240px]">
        <div className="w-full flex flex-col items-start justify-start gap-4 text-sm">
          {screenshots.map((screenshot, index) => {
            // Use the shouldShowGhostLoading flag from the screenshot object
            // Only fall back to checking episode title if we don't have proper podcast info
            const isLoading = screenshot.shouldShowGhostLoading || 
                             (!screenshot.podcastInfo?.episodeTitle || 
                              screenshot.podcastInfo?.episodeTitle === `Episode ${index + 1}`);
            
            if (isLoading) {
              return <SkeletonLoader key={`skeleton-${index}`} index={index} />;
            }

            return (
              <div 
                key={index} 
                className="self-stretch flex flex-row items-center justify-start gap-2 cursor-pointer hover:bg-[#E4E0D2] active:bg-[#E4E0D2] rounded-lg p-2 transition-colors"
                onClick={() => {
                  console.log('Screenshot clicked:', index, 'Handler exists:', !!onScreenshotClick);
                  onScreenshotClick && onScreenshotClick(index);
                }}
              >
                <img
                  className="w-14 relative rounded-xl h-14 overflow-hidden shrink-0 object-cover"
                  alt={`Podcast thumbnail ${index + 1}`}
                  src={screenshot.podcastInfo?.podcastArtwork || screenshot.preview}
                  onError={(e) => {
                    // Fallback to screenshot preview if podcast artwork fails to load
                    if (e.target.src !== screenshot.preview) {
                      e.target.src = screenshot.preview;
                    }
                  }}
                />
                <div className="w-[108px] flex flex-col items-start justify-start gap-1">
                  <b className="w-[261px] relative leading-[130%] inline-block overflow-hidden" 
                     style={{
                       display: '-webkit-box',
                       WebkitLineClamp: 2,
                       WebkitBoxOrient: 'vertical',
                       lineHeight: '1.3'
                     }}>
                    {screenshot.podcastInfo?.episodeTitle}
                  </b>
                  <div className="self-stretch relative text-xs leading-[130%] font-medium">
                    {screenshot.podcastInfo?.timestamp}
                  </div>
                </div>
              </div>
            );
          })}
          
          {/* Show placeholder if no screenshots */}
          {screenshots.length === 0 && (
            <div className="self-stretch flex flex-row items-center justify-start gap-2 opacity-50">
              <div className="w-14 relative rounded-xl h-14 overflow-hidden shrink-0 bg-gray-200 flex items-center justify-center">
                <span className="text-gray-400 text-xs">🎧</span>
              </div>
              <div className="w-[108px] flex flex-col items-start justify-start gap-1">
                <b className="w-[142px] relative leading-[130%] inline-block text-gray-400">
                  No screenshots yet
                </b>
                <div className="self-stretch relative text-xs leading-[130%] font-medium text-gray-400">
                  Add screenshots to get started
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Floating footer with background */}
      <div className="absolute bottom-0 left-0 right-0 bg-[#f6f3ee] overflow-hidden flex flex-col items-center justify-start pt-3 px-4 pb-4 gap-6">
        {/* Edge-to-edge divider line */}
        <div className="absolute top-0 left-0 right-0 h-px bg-[#dddad1]"></div>
        <div className="w-full max-w-[361px] flex flex-col items-start justify-start gap-4">
          <div className="self-stretch flex flex-col items-start justify-start gap-[5px]">
              <div className="w-full flex flex-row items-center justify-between gap-0">
              <button
                onClick={() => adjustTime(-15, 'left')}
                className="w-[85px] relative h-[31px] text-left hover:bg-gray-100 rounded-lg p-2 transition-colors"
              >
                <b className="absolute top-[0px] left-[0px] leading-[130%]">
                  {formatTime(selectedRange.start)}
                </b>
              </button>
              <button
                onClick={() => adjustTime(15, 'right')}
                className="w-[99px] relative h-[31px] text-right hover:bg-gray-100 rounded-lg p-2 transition-colors"
              >
                <b className="absolute top-[0px] right-[0px] leading-[130%]">
                  {formatTime(selectedRange.end)}
                </b>
              </button>
            </div>
            
            {/* Time range selector */}
            <div 
              ref={timelineRef}
              className="self-stretch rounded-3xl bg-[#e8e4d9] border-[#dddad1] border-solid border-[2px] flex flex-row items-center justify-center py-0 px-[30px] relative gap-0 min-h-[73px]"
            >
              {/* Timeline markers - 13 equally spaced markers */}
              <div className="w-full relative h-[73px]">
                {getNotchPositions().map((time, i) => (
                  <div
                    key={i}
                    className={`absolute w-px border-solid box-border h-[73px] ${
                      i === 6 ? 'border-[#8b7355] border-r-[4px]' : 'border-[#dddad1] border-r-[1px]'
                    }`}
                    style={{
                      left: `${timeToPosition(time)}px`
                    }}
                  />
                ))}
              </div>
              
              {/* Selection range indicator */}
              <div 
                className="absolute top-[0px] rounded-3xl bg-[#a8c5e8] bg-opacity-20 border-[#1b1b1b] border-solid border-[5px] box-border overflow-hidden shrink-0 flex flex-row items-center justify-between gap-0 h-[73px]"
                style={{
                  left: `${30 + timeToPosition(selectedRange.start) - 24 - 5}px`, // Offset by handle width (24px) + border (5px)
                  width: `${timeToPosition(selectedRange.end) - timeToPosition(selectedRange.start) + 48 + 10}px` // Add both handles (48px) + both borders (10px)
                }}
              >
                {/* Left drag handle */}
                <div 
                  className="w-6 relative h-[72px] overflow-hidden shrink-0 bg-[#1b1b1b] flex items-center justify-center cursor-ew-resize"
                  data-drag-handle="left"
                  onMouseDown={(e) => handleMouseDown(e, 'left')}
                  onTouchStart={(e) => handleTouchStart(e, 'left')}
                >
                  <div className="w-1 h-8 bg-white rounded-full"></div>
                </div>
                
                {/* Right drag handle */}
                <div 
                  className="w-6 relative h-[72px] overflow-hidden shrink-0 bg-[#1b1b1b] flex items-center justify-center cursor-ew-resize ml-auto"
                  data-drag-handle="right"
                  onMouseDown={(e) => handleMouseDown(e, 'right')}
                  onTouchStart={(e) => handleTouchStart(e, 'right')}
                >
                  <div className="w-1 h-8 bg-white rounded-full"></div>
                </div>
              </div>
            </div>
          </div>
          <b className="w-full relative text-base leading-[125%] inline-block text-center">
            {totalSelected} seconds selected
          </b>
        </div>
        
        {/* Generate transcript button or progress bar */}
        <div className="w-full max-w-[361px] flex justify-center">
          {isProcessing ? (
            <div className="w-full max-w-[361px] rounded-[24px] h-16 flex items-center justify-center">
              <div className="w-full px-6">
                {/* Progress bar container */}
                <div className="w-full bg-[#c4c0b7] rounded-full h-2 mb-2">
                  <div 
                    className="bg-[#1b1b1b] h-2 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${processingProgress}%` }}
                  ></div>
                </div>
                
                {/* Progress text */}
                <div className="text-center">
                  <span className="text-sm font-medium text-[#1b1b1b] font-['Termina']">
                    {processingStage}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <PrimaryButtonL
              onClick={handleGenerateTranscript}
              disabled={totalSelected === 0}
              className={totalSelected === 0 ? 'opacity-50 cursor-not-allowed' : ''}
            >
              Generate transcript
            </PrimaryButtonL>
          )}
        </div>
      </div>
    </div>
  );
};

export default MainContent; 