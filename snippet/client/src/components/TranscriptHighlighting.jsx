import React, { useState, useEffect, useCallback } from "react";
import PrimaryButtonL from "./PrimaryButtonL";

const TranscriptHighlighting = ({ 
  className = "",
  transcript = "",
  episodeTitle = "Episode name",
  timestamp = "4:30-5:15",
  podcastArtwork = "/thumbnail@2x.png",
  onDone,
  onExportSnippets,
  onBack,
  originalTimestamp = "11:00",
  selectedRange = { start: -15, end: 15 },
  episodes = [], // Array of episodes with transcript data
  currentEpisodeIndex = 0,
  onEpisodeChange // Callback when episode changes
}) => {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  
  // Text selection state - now episode-specific
  const [episodeSelections, setEpisodeSelections] = useState({});
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState(null);
  const [mouseDownOccurred, setMouseDownOccurred] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [initialSelectionState, setInitialSelectionState] = useState(new Set()); // Store initial selection state
  const [isDeselecting, setIsDeselecting] = useState(false); // New state for deselection mode
  
  // Touch hold delay states
  const [touchStartPosition, setTouchStartPosition] = useState(null);
  const [isPendingSelection, setIsPendingSelection] = useState(false);

  // Get current episode's selections
  const selectedWords = episodeSelections[currentEpisodeIndex] || new Set();
  const lastSelectedWord = episodeSelections[`${currentEpisodeIndex}_lastSelected`] || null;

  // Helper function to update episode-specific selections
  const updateEpisodeSelection = (newSelectedWords, newLastSelectedWord = null) => {
    setEpisodeSelections(prev => ({
      ...prev,
      [currentEpisodeIndex]: newSelectedWords,
      [`${currentEpisodeIndex}_lastSelected`]: newLastSelectedWord
    }));
  };

  // Use episodes data if provided, otherwise use individual props
  const currentEpisode = episodes.length > 0 ? episodes[currentEpisodeIndex] : {
    transcript,
    episodeTitle,
    timestamp,
    podcastArtwork,
    originalTimestamp,
    selectedRange
  };

  const nextEpisode = episodes.length > 0 && currentEpisodeIndex < episodes.length - 1 
    ? episodes[currentEpisodeIndex + 1] 
    : null;

  const prevEpisode = episodes.length > 0 && currentEpisodeIndex > 0 
    ? episodes[currentEpisodeIndex - 1] 
    : null;

  // Function to parse timestamp string to seconds
  const parseTimestamp = (timeStr) => {
    const parts = timeStr.split(':');
    if (parts.length === 2) {
      return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }
    return 0;
  };

  // Function to format seconds back to MM:SS
  const formatTimestamp = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate the actual timeframe
  const calculateTimeframe = (episode) => {
    if (!episode.originalTimestamp || !episode.selectedRange) return episode.timestamp;
    
    const originalSeconds = parseTimestamp(episode.originalTimestamp);
    const startSeconds = Math.max(0, originalSeconds + episode.selectedRange.start);
    const endSeconds = Math.max(0, originalSeconds + episode.selectedRange.end);
    
    // Ensure end time is not before start time
    const finalEndSeconds = Math.max(startSeconds, endSeconds);
    
    return `${formatTimestamp(startSeconds)}-${formatTimestamp(finalEndSeconds)}`;
  };

  // Text selection helper functions
  const getWordIndex = (target) => {
    const wordIndex = parseInt(target.getAttribute('data-word-index'));
    return isNaN(wordIndex) ? null : wordIndex;
  };

  const selectRange = (startIndex, endIndex) => {
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    const newSelected = new Set(selectedWords);
    
    for (let i = start; i <= end; i++) {
      newSelected.add(i);
    }
    
    updateEpisodeSelection(newSelected, endIndex);
  };

  const deselectRange = (startIndex, endIndex) => {
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    const newSelected = new Set(selectedWords);
    
    for (let i = start; i <= end; i++) {
      newSelected.delete(i);
    }
    
    updateEpisodeSelection(newSelected, endIndex);
  };

  const handleWordClick = (e) => {
    e.preventDefault();
    const wordIndex = getWordIndex(e.target);
    if (wordIndex === null) return;

    // Don't process click if we detected dragging
    if (mouseDownOccurred) {
      setMouseDownOccurred(false);
      return;
    }

    if (!isSelecting) {
      if (selectedWords.has(wordIndex)) {
        // Check if this word is part of a single-word block
        const isPartOfSingleWordBlock = () => {
          // Check if the word before and after are not selected
          const prevWordSelected = selectedWords.has(wordIndex - 1);
          const nextWordSelected = selectedWords.has(wordIndex + 1);
          
          return !prevWordSelected && !nextWordSelected;
        };
        
        if (isPartOfSingleWordBlock()) {
          // Remove only this single word, keeping other blocks intact
          const newSelected = new Set(selectedWords);
          newSelected.delete(wordIndex);
          updateEpisodeSelection(newSelected);
        } else {
          // Find the continuous block that contains the clicked word
          const findContinuousBlock = (targetWord) => {
            // Convert selected words to sorted array for easier processing
            const selectedArray = Array.from(selectedWords).sort((a, b) => a - b);
            
            // Find which continuous block contains the target word
            let currentBlock = [];
            let targetBlock = null;
            
            for (let i = 0; i < selectedArray.length; i++) {
              const wordIndex = selectedArray[i];
              
              // If this is the first word or it's consecutive to the previous word
              if (currentBlock.length === 0 || wordIndex === selectedArray[i - 1] + 1) {
                currentBlock.push(wordIndex);
              } else {
                // We've hit a gap, so the current block is complete
                // Check if the target word was in this block
                if (currentBlock.includes(targetWord)) {
                  targetBlock = currentBlock;
                  break;
                }
                // Start a new block
                currentBlock = [wordIndex];
              }
            }
            
            // Don't forget to check the last block
            if (!targetBlock && currentBlock.includes(targetWord)) {
              targetBlock = currentBlock;
            }
            
            return targetBlock || [targetWord];
          };
          
          const continuousBlock = findContinuousBlock(wordIndex);
          const blockStart = Math.min(...continuousBlock);
          
          // Trim selection within this block only - keep words from block start to clicked word
          const newSelected = new Set(selectedWords);
          
          // Remove words in this block that come after the clicked word
          continuousBlock.forEach(blockWordIndex => {
            if (blockWordIndex > wordIndex) {
              newSelected.delete(blockWordIndex);
            }
          });
          
          updateEpisodeSelection(newSelected, wordIndex);
        }
      } else {
        // Clicking on unselected word - select it
        const newSelected = new Set(selectedWords);
        newSelected.add(wordIndex);
        updateEpisodeSelection(newSelected, wordIndex);
      }
    }
  };

  const handleWordMouseDown = (e) => {
    const wordIndex = getWordIndex(e.target);
    if (wordIndex === null) return;

    // Set drag selection state
    setIsSelecting(true);
    setSelectionStart(wordIndex);
    
    // Store the initial selection state when starting a drag
    setInitialSelectionState(new Set(selectedWords));
    
    e.preventDefault();
  };

  // New touch-specific handlers for word selection
  const handleWordTouchStart = (e) => {
    const wordIndex = getWordIndex(e.target);
    if (wordIndex === null) return;

    // Store touch start position and word index
    setTouchStartPosition({
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      wordIndex: wordIndex,
      timestamp: Date.now()
    });
    
    // Start selection immediately but mark as pending
    setIsPendingSelection(true);
    setSelectionStart(wordIndex);
    
    // Store the initial selection state when starting a drag
    setInitialSelectionState(new Set(selectedWords));
    
    // Check if we should start in deselection mode
    setIsDeselecting(isWordAtSelectionEdge(wordIndex) && selectedWords.has(wordIndex));
  };

  // Helper function to check if a word is at the edge of a selection
  const isWordAtSelectionEdge = (wordIndex) => {
    if (!selectedWords.has(wordIndex)) return false;
    
    const selectedArray = Array.from(selectedWords).sort((a, b) => a - b);
    const firstSelected = selectedArray[0];
    const lastSelected = selectedArray[selectedArray.length - 1];
    
    // Word is at edge if it's the first or last in the selection
    return wordIndex === firstSelected || wordIndex === lastSelected;
  };

  // Simplified touch end handler
  const handleWordTouchEnd = (e) => {
    // If we were pending selection, decide whether to convert to selection or treat as tap
    if (isPendingSelection && touchStartPosition) {
      const touchDuration = Date.now() - touchStartPosition.timestamp;
      const hasMovedSignificantly = false; // We'll check this in the global touch move handler
      
      // If it was a quick tap (less than 200ms) and no significant movement, treat as click
      if (touchDuration < 200 && !isSelecting) {
        setIsPendingSelection(false);
        setTouchStartPosition(null);
        setSelectionStart(null);
        
        // Handle as a regular click for single taps
        const wordIndex = getWordIndex(e.target);
        if (wordIndex !== null) {
          handleWordClick(e);
        }
        return;
      }
      
      // Otherwise, convert to actual selection
      if (!isSelecting) {
        setIsSelecting(true);
        setIsPendingSelection(false);
      }
    }
    
    // If we were selecting, end the selection
    if (isSelecting) {
      // Small delay to allow for potential touch move
      setTimeout(() => {
        setIsSelecting(false);
        setSelectionStart(null);
        setMouseDownOccurred(false);
        setIsDeselecting(false);
        setIsPendingSelection(false);
        setTouchStartPosition(null);
      }, 100);
    }
  };

  const handleWordMouseEnter = (e) => {
    if (!isSelecting || selectionStart === null) return;
    
    const wordIndex = getWordIndex(e.target);
    if (wordIndex === null) return;

    // Mark that we're actually dragging (mouse moved to different word)
    if (wordIndex !== selectionStart) {
      setMouseDownOccurred(true);
      
      // Start with the initial selection state
      const newSelectedWords = new Set(initialSelectionState);
      
      // Determine if we should select or deselect based on the start word's initial state
      const shouldSelect = !initialSelectionState.has(selectionStart);
      
      if (shouldSelect) {
        // Selection mode: add words in the current drag range
        const startIndex = Math.min(selectionStart, wordIndex);
        const endIndex = Math.max(selectionStart, wordIndex);
        
        for (let i = startIndex; i <= endIndex; i++) {
          newSelectedWords.add(i);
        }
      } else {
        // Deselection mode: only remove words from the continuous block containing the start point
        const startIndex = Math.min(selectionStart, wordIndex);
        const endIndex = Math.max(selectionStart, wordIndex);
        
        // Find the continuous block that contains the selection start
        const findContinuousBlock = (startWord) => {
          // Convert selected words to sorted array for easier processing
          const selectedArray = Array.from(initialSelectionState).sort((a, b) => a - b);
          
          // Find which continuous block contains the start word
          let currentBlock = [];
          let targetBlock = null;
          
          for (let i = 0; i < selectedArray.length; i++) {
            const wordIndex = selectedArray[i];
            
            // If this is the first word or it's consecutive to the previous word
            if (currentBlock.length === 0 || wordIndex === selectedArray[i - 1] + 1) {
              currentBlock.push(wordIndex);
            } else {
              // We've hit a gap, so the current block is complete
              // Check if the target start word was in this block
              if (currentBlock.includes(startWord)) {
                targetBlock = currentBlock;
                break;
              }
              // Start a new block
              currentBlock = [wordIndex];
            }
          }
          
          // Don't forget to check the last block
          if (!targetBlock && currentBlock.includes(startWord)) {
            targetBlock = currentBlock;
          }
          
          // If we found the target block, return its boundaries
          if (targetBlock && targetBlock.length > 0) {
            return {
              start: Math.min(...targetBlock),
              end: Math.max(...targetBlock)
            };
          }
          
          // Fallback: just return the start word itself
          return { start: startWord, end: startWord };
        };
        
        const continuousBlock = findContinuousBlock(selectionStart);
        
        // Only remove words that are both in the drag range AND in the continuous block
        for (let i = startIndex; i <= endIndex; i++) {
          if (i >= continuousBlock.start && i <= continuousBlock.end) {
            newSelectedWords.delete(i);
          }
        }
      }
      
      updateEpisodeSelection(newSelectedWords, wordIndex);
    }
  };

  // Function to smoothly change episodes
  const changeEpisode = useCallback((newIndex) => {
    if (newIndex < 0 || newIndex >= episodes.length || newIndex === currentEpisodeIndex) return;
    
    setIsTransitioning(true);
    
    if (newIndex > currentEpisodeIndex) {
      // Going to next episode (dragging left)
      setSwipeOffset(-300);
      
      setTimeout(() => {
        if (onEpisodeChange) {
          onEpisodeChange(newIndex);
        }
        setSwipeOffset(0);
        setTimeout(() => {
          setIsTransitioning(false);
        }, 300);
      }, 300);
    } else {
      // Going to previous episode (dragging right)
      setSwipeOffset(300);
      
      setTimeout(() => {
        if (onEpisodeChange) {
          onEpisodeChange(newIndex);
        }
        setSwipeOffset(0);
        setTimeout(() => {
          setIsTransitioning(false);
        }, 300);
      }, 300);
    }
  }, [episodes.length, currentEpisodeIndex, onEpisodeChange]);

  // Mouse event handlers for desktop
  const handleMouseMove = useCallback((e) => {
    if (!isDragging || episodes.length <= 1) return;
    
    const currentX = e.clientX;
    const diffX = currentX - startX;
    
    // Smoother drag with better resistance curve
    const maxSwipe = 150;
    const dampingFactor = 0.8;
    const limitedDiff = Math.max(-maxSwipe, Math.min(maxSwipe, diffX * dampingFactor));
    
    setSwipeOffset(limitedDiff);
  }, [isDragging, startX, episodes.length]);

  const handleMouseUp = useCallback((e) => {
    if (isSelecting) {
      setIsSelecting(false);
      setSelectionStart(null);
      return;
    }

    // Original swipe handling
    if (!isDragging || episodes.length <= 1) return;
    
    setIsDragging(false);
    
    const threshold = 50;
    
    if (swipeOffset > threshold && prevEpisode) {
      // Dragging right - go to previous episode
      setSwipeOffset(300);
      
      setTimeout(() => {
        if (onEpisodeChange) {
          onEpisodeChange(currentEpisodeIndex - 1);
        }
        setSwipeOffset(0);
      }, 300);
    } else if (swipeOffset < -threshold && nextEpisode) {
      // Dragging left - go to next episode  
      setSwipeOffset(-300);
      
      setTimeout(() => {
        if (onEpisodeChange) {
          onEpisodeChange(currentEpisodeIndex + 1);
        }
        setSwipeOffset(0);
      }, 300);
    } else {
      // Smooth snap back animation
      setSwipeOffset(0);
    }
  }, [isDragging, episodes.length, swipeOffset, prevEpisode, nextEpisode, onEpisodeChange, currentEpisodeIndex, isSelecting]);

  const handleMouseDown = (e) => {
    if (episodes.length <= 1) return;
    e.preventDefault(); // Prevent text selection
    setStartX(e.clientX);
    setIsDragging(true);
  };

  // Add global mouse event listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Add global mouse up listener for text selection
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isSelecting) {
        setIsSelecting(false);
        setSelectionStart(null);
        setInitialSelectionState(new Set()); // Reset initial selection state
      }
      // Reset mouse down flag when mouse is released
      setMouseDownOccurred(false);
    };

    if (isSelecting) {
      document.addEventListener('mouseup', handleGlobalMouseUp);
      
      return () => {
        document.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }
  }, [isSelecting]);

  // Add global touch event listeners for text selection
  useEffect(() => {
    const handleGlobalTouchEnd = () => {
      if (isSelecting) {
        setIsSelecting(false);
        setSelectionStart(null);
        setInitialSelectionState(new Set()); // Reset initial selection state
      }
      // Reset mouse down flag when touch is released
      setMouseDownOccurred(false);
    };

    const handleGlobalTouchMove = (e) => {
      if (!isSelecting || selectionStart === null) return;
      
      // Prevent page scrolling during text selection
      e.preventDefault();
      
      // Get the touch position
      const touch = e.touches[0];
      const touchX = touch.clientX;
      const touchY = touch.clientY;
      
      // Find the word element closest to the touch point
      const wordElement = findClosestWordElement(touchX, touchY);
      
      if (!wordElement) return;
      
      const wordIndex = getWordIndex(wordElement);
      if (wordIndex === null) return;

      // Mark that we're actually dragging (touch moved to different word)
      if (wordIndex !== selectionStart) {
        setMouseDownOccurred(true);
        
        // Start with the initial selection state
        const newSelectedWords = new Set(initialSelectionState);
        
        // Determine if we should select or deselect based on the start word's initial state
        const shouldSelect = !initialSelectionState.has(selectionStart);
        
        if (shouldSelect) {
          // Selection mode: add words in the current drag range
          const startIndex = Math.min(selectionStart, wordIndex);
          const endIndex = Math.max(selectionStart, wordIndex);
          
          for (let i = startIndex; i <= endIndex; i++) {
            newSelectedWords.add(i);
          }
        } else {
          // Deselection mode: only remove words from the continuous block containing the start point
          const startIndex = Math.min(selectionStart, wordIndex);
          const endIndex = Math.max(selectionStart, wordIndex);
          
          // Find the continuous block that contains the selection start
          const findContinuousBlock = (startWord) => {
            // Convert selected words to sorted array for easier processing
            const selectedArray = Array.from(initialSelectionState).sort((a, b) => a - b);
            
            // Find which continuous block contains the start word
            let currentBlock = [];
            let targetBlock = null;
            
            for (let i = 0; i < selectedArray.length; i++) {
              const wordIndex = selectedArray[i];
              
              // If this is the first word or it's consecutive to the previous word
              if (currentBlock.length === 0 || wordIndex === selectedArray[i - 1] + 1) {
                currentBlock.push(wordIndex);
              } else {
                // We've hit a gap, so the current block is complete
                // Check if the target start word was in this block
                if (currentBlock.includes(startWord)) {
                  targetBlock = currentBlock;
                  break;
                }
                // Start a new block
                currentBlock = [wordIndex];
              }
            }
            
            // Don't forget to check the last block
            if (!targetBlock && currentBlock.includes(startWord)) {
              targetBlock = currentBlock;
            }
            
            // If we found the target block, return its boundaries
            if (targetBlock && targetBlock.length > 0) {
              return {
                start: Math.min(...targetBlock),
                end: Math.max(...targetBlock)
              };
            }
            
            // Fallback: just return the start word itself
            return { start: startWord, end: startWord };
          };
          
          const continuousBlock = findContinuousBlock(selectionStart);
          
          // Only remove words that are both in the drag range AND in the continuous block
          for (let i = startIndex; i <= endIndex; i++) {
            if (i >= continuousBlock.start && i <= continuousBlock.end) {
              newSelectedWords.delete(i);
            }
          }
        }
        
        updateEpisodeSelection(newSelectedWords, wordIndex);
      }
    };

    // Helper function to find the closest word element to a touch point
    const findClosestWordElement = (x, y) => {
      // Get all word elements
      const wordElements = document.querySelectorAll('[data-word-index]');
      let closestElement = null;
      let closestDistance = Infinity;
      
      wordElements.forEach(element => {
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        // Calculate distance from touch point to word center
        const distance = Math.sqrt(
          Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2)
        );
        
        // Also check if the touch point is within reasonable bounds of the word
        const isWithinHorizontalBounds = x >= rect.left - 20 && x <= rect.right + 20;
        const isWithinVerticalBounds = y >= rect.top - 10 && y <= rect.bottom + 10;
        
        // For multi-line selection, we want to be more lenient with vertical bounds
        // and prioritize words that are in the direction of the drag
        if (isWithinHorizontalBounds && isWithinVerticalBounds && distance < closestDistance) {
          closestDistance = distance;
          closestElement = element;
        }
      });
      
      // If no element found with the above criteria, fall back to elementFromPoint
      if (!closestElement) {
        const elementUnderTouch = document.elementFromPoint(x, y);
        if (elementUnderTouch && elementUnderTouch.hasAttribute('data-word-index')) {
          return elementUnderTouch;
        }
        
        // If still no element, find the closest word element by pure distance
        wordElements.forEach(element => {
          const rect = element.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          
          const distance = Math.sqrt(
            Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2)
          );
          
          if (distance < closestDistance) {
            closestDistance = distance;
            closestElement = element;
          }
        });
      }
      
      return closestElement;
    };

    if (isSelecting) {
      document.addEventListener('touchend', handleGlobalTouchEnd);
      document.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
      
      return () => {
        document.removeEventListener('touchend', handleGlobalTouchEnd);
        document.removeEventListener('touchmove', handleGlobalTouchMove);
      };
    }
  }, [isSelecting, selectionStart, selectedWords]);

  // Touch event handlers
  const handleTouchStart = (e) => {
    if (episodes.length <= 1) return;
    
    // Don't start episode swiping if we're selecting text
    if (isSelecting || isPendingSelection) return;
    
    setStartX(e.touches[0].clientX);
    setIsDragging(true);
  };

  const handleTouchMove = (e) => {
    if (!isDragging || episodes.length <= 1) return;
    
    // Don't continue episode swiping if text selection started
    if (isSelecting || isPendingSelection) {
      setIsDragging(false);
      return;
    }
    
    const currentX = e.touches[0].clientX;
    const diffX = currentX - startX;
    
    // Smoother drag with better resistance curve
    const maxSwipe = 150;
    const dampingFactor = 0.8;
    const limitedDiff = Math.max(-maxSwipe, Math.min(maxSwipe, diffX * dampingFactor));
    
    setSwipeOffset(limitedDiff);
    
    // Prevent scroll bubbling during episode swiping
    e.preventDefault();
    e.stopPropagation();
  };

  const handleTouchEnd = () => {
    if (!isDragging || episodes.length <= 1) return;
    
    setIsDragging(false);
    
    const threshold = 50;
    
    if (swipeOffset > threshold && prevEpisode) {
      // Dragging right - go to previous episode
      setSwipeOffset(300);
      
      setTimeout(() => {
        if (onEpisodeChange) {
          onEpisodeChange(currentEpisodeIndex - 1);
        }
        setSwipeOffset(0);
      }, 300);
    } else if (swipeOffset < -threshold && nextEpisode) {
      // Dragging left - go to next episode
      setSwipeOffset(-300);
      
      setTimeout(() => {
        if (onEpisodeChange) {
          onEpisodeChange(currentEpisodeIndex + 1);
        }
        setSwipeOffset(0);
      }, 300);
    } else {
      // Smooth snap back animation
      setSwipeOffset(0);
    }
  };

  // Function to format transcript with speaker diarization
  const formatTranscriptWithSpeakers = (text, utterances) => {
    // If no utterances data, return original text
    if (!utterances || utterances.length === 0) {
      return text;
    }

    // Check if there are multiple speakers
    const speakers = new Set(utterances.map(u => u.speaker));
    if (speakers.size <= 1) {
      return text; // Single speaker, no need for paragraph breaks
    }

    // Build formatted text with paragraph breaks between speakers
    let formattedText = '';
    let currentSpeaker = null;
    
    utterances.forEach((utterance, index) => {
      // Add paragraph break when speaker changes (except for the first utterance)
      if (currentSpeaker !== null && currentSpeaker !== utterance.speaker) {
        formattedText += '\n\n';
      }
      
      // Add the utterance text
      formattedText += utterance.text;
      
      // Add space between utterances from the same speaker (except for the last one)
      if (index < utterances.length - 1 && utterances[index + 1].speaker === utterance.speaker) {
        formattedText += ' ';
      }
      
      currentSpeaker = utterance.speaker;
    });

    return formattedText;
  };

  const renderHighlightedText = (text) => {
    if (!text) return null;
    
    // Replace the last period with ellipses to indicate continuation
    const processedText = text.replace(/\.$(?=\s*$)/, '...');
    
    const words = processedText.split(/(\s+)/);
    let wordIndex = 0;
    
    return words.map((word, index) => {
      if (word.trim() === '') {
        // Whitespace
        return <span key={index}>{word}</span>;
      }
      
      const currentWordIndex = wordIndex++;
      const isSelected = selectedWords.has(currentWordIndex);
      
      return (
        <span
          key={index}
          data-word-index={currentWordIndex}
          className={`cursor-pointer transition-all duration-150 rounded-sm px-1 py-0.5 -mx-1 -my-0.5 min-h-[1.5rem] inline-flex items-center ${
            isSelected 
              ? 'bg-blue-200' 
              : 'hover:bg-gray-100'
          }`}
          style={{
            // Allow touch actions for scrolling, but prevent text selection
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none'
          }}
          onClick={handleWordClick}
          onMouseDown={handleWordMouseDown}
          onMouseEnter={handleWordMouseEnter}
          onTouchStart={handleWordTouchStart}
          onTouchEnd={handleWordTouchEnd}
        >
          {word}
        </span>
      );
    });
  };

  // Cleanup effect for component unmount
  useEffect(() => {
    return () => {
      // Clear any pending selection timer on unmount
      if (touchStartPosition) {
        setIsPendingSelection(false);
      }
    };
  }, [touchStartPosition]);

  // Clear active selection state when episode changes
  useEffect(() => {
    setIsSelecting(false);
    setSelectionStart(null);
    setMouseDownOccurred(false);
    setInitialSelectionState(new Set()); // Reset initial selection state when episode changes
    setIsDeselecting(false);
    setIsPendingSelection(false);
    setTouchStartPosition(null);
  }, [currentEpisodeIndex]);

  // Function to extract highlighted text and copy to clipboard
  const handleCopySnippets = async () => {
    // Check if there are any selections across all episodes
    const hasAnySelections = Object.keys(episodeSelections).some(key => 
      !key.includes('_lastSelected') && episodeSelections[key].size > 0
    );
    
    if (!hasAnySelections) return;

    let allFormattedText = '';
    
    // Go through all episodes and extract highlighted text
    episodes.forEach((episode, episodeIndex) => {
      const episodeSelectedWords = episodeSelections[episodeIndex];
      if (!episodeSelectedWords || episodeSelectedWords.size === 0) return;

      // Debug: Log episode data structure
      console.log('Episode data for copying:', {
        episodeIndex,
        episodeTitle: episode.episodeTitle,
        podcastName: episode.podcastName,
        podcastId: episode.podcastId,
        episodeId: episode.episodeId,
        validatedPodcastTitle: episode.validatedPodcast?.title,
        validatedPodcastId: episode.validatedPodcast?.id,
        validatedEpisodeId: episode.validatedEpisode?.id,
        wordsCount: episode.words?.length || 0
      });

      // Get the transcript text and split into words
      const transcript = episode.transcript || '';
      const formattedTranscript = formatTranscriptWithSpeakers(transcript, episode.utterances);
      const words = formattedTranscript.split(/(\s+)/);
      let wordIndex = 0;
      
      // Find all continuous blocks of selected text
      const selectedBlocks = [];
      let currentBlock = '';
      let inBlock = false;
      let blockStartWordIndex = -1;
      let blockEndWordIndex = -1;
      
      words.forEach((word, index) => {
        if (word.trim() === '') {
          // Whitespace - add to current block if we're in one
          if (inBlock) {
            currentBlock += word;
          }
          return;
        }
        
        const currentWordIndex = wordIndex++;
        const isSelected = episodeSelectedWords.has(currentWordIndex);
        
        if (isSelected) {
          if (!inBlock) {
            // Starting a new block
            inBlock = true;
            currentBlock = word;
            blockStartWordIndex = currentWordIndex;
            blockEndWordIndex = currentWordIndex;
          } else {
            // Continuing current block
            currentBlock += word;
            blockEndWordIndex = currentWordIndex;
          }
        } else {
          if (inBlock) {
            // Ending current block
            selectedBlocks.push({
              text: currentBlock.trim(),
              startWordIndex: blockStartWordIndex,
              endWordIndex: blockEndWordIndex
            });
            currentBlock = '';
            inBlock = false;
            blockStartWordIndex = -1;
            blockEndWordIndex = -1;
          }
        }
      });
      
      // Don't forget the last block if we ended while in one
      if (inBlock && currentBlock.trim()) {
        selectedBlocks.push({
          text: currentBlock.trim(),
          startWordIndex: blockStartWordIndex,
          endWordIndex: blockEndWordIndex
        });
      }

      // Add episode information if we have selected blocks
      if (selectedBlocks.length > 0) {
        if (allFormattedText) {
          allFormattedText += '\n\n\n'; // Extra line break between episodes
        }
        
        // Get podcast name with fallbacks
        const podcastName = episode.podcastName || 
                           episode.validatedPodcast?.title || 
                           episode.podcast?.title || 
                           'Unknown Podcast';
        
        // Enhanced timerange calculation using word-level timestamps if available
        let timerange = calculateTimeframe(episode);
        
        // Try to get more precise timestamps from word-level data
        if (episode.words && episode.words.length > 0 && selectedBlocks.length > 0) {
          try {
            // Get the start time of the first selected word and end time of the last selected word
            const firstBlock = selectedBlocks[0];
            const lastBlock = selectedBlocks[selectedBlocks.length - 1];
            
            // Find the corresponding word objects from AssemblyAI data
            const startWord = episode.words[firstBlock.startWordIndex];
            const endWord = episode.words[lastBlock.endWordIndex];
            
            if (startWord && endWord && startWord.start !== undefined && endWord.end !== undefined) {
              // Convert milliseconds to seconds and format
              const startSeconds = Math.floor(startWord.start / 1000);
              const endSeconds = Math.ceil(endWord.end / 1000);
              
              const formatTime = (seconds) => {
                const mins = Math.floor(seconds / 60);
                const secs = seconds % 60;
                return `${mins}:${secs.toString().padStart(2, '0')}`;
              };
              
              const wordLevelTimerange = `${formatTime(startSeconds)}-${formatTime(endSeconds)}`;
              console.log('Word-level timestamp success:', wordLevelTimerange);
              timerange = wordLevelTimerange;
            }
          } catch (error) {
            console.warn('Failed to calculate word-level timestamps:', error);
          }
        }
        
        // Format: Episode title with timestamp on first line
        allFormattedText += `${episode.episodeTitle} (${timerange})\n`;
        
        // Format: Podcast name on second line
        allFormattedText += `${podcastName}\n`;
        
        // Construct Apple Podcasts link (episode-specific if possible)
        let applePodcastsLink = '';
        if (episode.podcastId) {
          if (episode.episodeId) {
            // Episode-specific link with timestamp
            applePodcastsLink = `https://podcasts.apple.com/podcast/id${episode.podcastId}?i=${episode.episodeId}`;
            
            // Add timestamp if we have word-level timing data
            if (episode.words && episode.words.length > 0 && selectedBlocks.length > 0) {
              try {
                const firstBlock = selectedBlocks[0];
                const startWord = episode.words[firstBlock.startWordIndex];
                
                if (startWord && startWord.start !== undefined) {
                  // Convert milliseconds to seconds (no offset for exact timestamp)
                  const startSeconds = Math.floor(startWord.start / 1000);
                  const timestampSeconds = Math.max(0, startSeconds); // Ensure we don't go negative
                  
                  // Add timestamp parameter to the link
                  applePodcastsLink += `&t=${timestampSeconds}`;
                  console.log(`✅ Added timestamp to Apple Podcasts link: ${timestampSeconds}s (exact timestamp)`);
                }
              } catch (error) {
                console.warn('Failed to add timestamp to Apple Podcasts link:', error);
              }
            }
            
            console.log('✅ Added episode-specific Apple Podcasts link:', applePodcastsLink);
          } else {
            // Fallback to podcast link
            applePodcastsLink = `https://podcasts.apple.com/podcast/id${episode.podcastId}`;
            console.log('✅ Added podcast Apple Podcasts link (no episode ID):', applePodcastsLink);
          }
        } else {
          console.log('❌ No podcast ID available for Apple Podcasts link');
        }
        
        // Format: Apple Podcasts link on third line
        allFormattedText += `${applePodcastsLink}\n\n`;
        
        // Add all selected text blocks, separated by double line breaks
        selectedBlocks.forEach((block, blockIndex) => {
          if (blockIndex > 0) {
            allFormattedText += '\n\n';
          }
          allFormattedText += block.text;
        });
      }
    });

    // Copy to clipboard if we have any formatted text
    if (allFormattedText) {
      console.log('Final formatted text:', allFormattedText);
      console.log('Starting copy process...');
      
      // Try multiple methods to copy to clipboard
      let copySuccess = false;
      
      // Method 1: Modern clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(allFormattedText);
          copySuccess = true;
          console.log('✅ Copied using modern clipboard API');
        } catch (err) {
          console.warn('Modern clipboard API failed:', err);
        }
      }
      
      // Method 2: Fallback for mobile browsers
      if (!copySuccess) {
        try {
          // Create a temporary textarea element
          const textArea = document.createElement('textarea');
          textArea.value = allFormattedText;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          textArea.style.top = '-999999px';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          
          // Try to copy using execCommand
          const successful = document.execCommand('copy');
          document.body.removeChild(textArea);
          
          if (successful) {
            copySuccess = true;
            console.log('✅ Copied using fallback execCommand method');
          }
        } catch (err) {
          console.warn('Fallback copy method failed:', err);
        }
      }
      
      // Method 3: Share API for mobile (if available)
      if (!copySuccess && navigator.share) {
        try {
          await navigator.share({
            text: allFormattedText,
            title: 'Podcast Snippets'
          });
          copySuccess = true;
          console.log('✅ Shared using Web Share API');
        } catch (err) {
          console.warn('Web Share API failed:', err);
          // If user cancels share, don't treat it as success
          if (err.name === 'AbortError') {
            copySuccess = false;
          }
        }
      }
      
      console.log('Copy process completed. Success:', copySuccess);
      
      if (copySuccess) {
        console.log('Setting isCopied to true...');
        setIsCopied(true);
        
        // Reset the copied state after 2 seconds
        setTimeout(() => {
          console.log('Resetting isCopied to false...');
          setIsCopied(false);
        }, 2000);
      } else {
        // Show an alert as final fallback
        console.log('All copy methods failed, showing alert...');
        alert('Copy failed. Here is your text:\n\n' + allFormattedText);
      }
    }
  };

  // Add global touch move handler to detect scrolling
  useEffect(() => {
    const handleGlobalTouchMove = (e) => {
      // If we have a pending selection, check if the user is scrolling vs selecting
      if (isPendingSelection && touchStartPosition) {
        const currentTouch = e.touches[0];
        const deltaX = Math.abs(currentTouch.clientX - touchStartPosition.x);
        const deltaY = Math.abs(currentTouch.clientY - touchStartPosition.y);
        
        // Calculate the total movement distance
        const totalMovement = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // Only process if there's significant movement (at least 10px)
        if (totalMovement < 10) return;
        
        // Calculate the angle of the drag in degrees from horizontal
        // atan2 gives us the angle, we convert to degrees and get absolute value
        const angleRadians = Math.atan2(deltaY, deltaX);
        const angleDegrees = Math.abs(angleRadians * (180 / Math.PI));
        
        // Allow text selection for drags up to 75 degrees from horizontal
        // This means only nearly vertical drags (75-90 degrees) will be treated as scrolling
        if (angleDegrees <= 75) {
          // This is a text selection gesture - convert to selection mode
          setIsSelecting(true);
          setIsPendingSelection(false);
          
          // Prevent scrolling since we're doing text selection
          e.preventDefault();
          e.stopPropagation();
        } else {
          // This is likely a scroll gesture (close to vertical) - cancel selection
          setIsPendingSelection(false);
          setTouchStartPosition(null);
          setSelectionStart(null);
          return;
        }
      }
      
      // If we're actively selecting text, prevent scroll bubbling
      if (isSelecting) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Add global touch move listener
    if (isPendingSelection || isSelecting) {
      document.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
    }

    return () => {
      document.removeEventListener('touchmove', handleGlobalTouchMove);
    };
  }, [isPendingSelection, touchStartPosition, isSelecting]);

  return (
    <div className={`w-[393px] bg-[#f6f3ee] max-w-full h-[678px] overflow-hidden shrink-0 flex flex-col items-center justify-start box-border gap-0 text-left text-sm text-[#1b1b1b] font-['Termina'] relative ${className}`}>
      
      {/* Header with episode info */}
      <div className="w-full bg-[#FAF9F7] border-[#dddad1] border-solid border-b-[1px] flex flex-row items-center justify-between pt-2 px-4 pb-4 relative shrink-0">
        {/* Episode navigation - left arrow */}
        {episodes.length > 1 && prevEpisode ? (
          <button
            onClick={() => changeEpisode(currentEpisodeIndex - 1)}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors self-center"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 12L6 8L10 4" stroke="#1b1b1b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        ) : (
          <div className="w-8 h-8"></div>
        )}

        {/* Current episode info - centered */}
        <div className="flex-1 flex flex-row items-center justify-center gap-2 mx-4">
          <img
            className="h-10 w-10 relative rounded-xl overflow-hidden shrink-0 object-cover"
            alt="Podcast artwork"
            src={currentEpisode.podcastArtwork}
          />
          <div className="flex flex-col items-start justify-start gap-1 min-w-0">
            <div 
              className="relative leading-[130%] font-medium text-sm"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                lineHeight: '1.3'
              }}
            >
              {currentEpisode.episodeTitle}
            </div>
            <div className="relative text-xs leading-[130%] font-medium text-gray-600">
              {calculateTimeframe(currentEpisode)}
            </div>
          </div>
        </div>

        {/* Episode navigation - right arrow */}
        {episodes.length > 1 && nextEpisode ? (
          <button
            onClick={() => changeEpisode(currentEpisodeIndex + 1)}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors self-center"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 4L10 8L6 12" stroke="#1b1b1b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        ) : (
          <div className="w-8 h-8"></div>
        )}

        {/* Episode indicator dots */}
        {episodes.length > 1 && (
          <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 flex gap-1 pb-1">
            {episodes.map((_, index) => (
              <div
                key={index}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  index === currentEpisodeIndex ? 'bg-[#1b1b1b]' : 'bg-gray-300'
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Transcript content */}
      <div 
        className="self-stretch flex-1 bg-[#f6f3ee] overflow-y-auto flex flex-col items-start justify-start pt-4 px-4 pb-0 relative text-lg font-['EB_Garamond']"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onScroll={(e) => {
          // Prevent scroll events from bubbling up to parent containers
          e.stopPropagation();
        }}
        onWheel={(e) => {
          // Prevent wheel events from bubbling up to parent containers
          e.stopPropagation();
        }}
        style={{
          transform: `translateX(${swipeOffset}px)`,
          transition: isTransitioning ? 'transform 0.3s ease-out' : isDragging ? 'none' : 'transform 0.3s ease-out',
          // Add scroll containment to prevent scroll chaining
          overscrollBehavior: 'contain'
        }}
      >
        <div 
          className="self-stretch relative leading-[150%] font-medium"
        >
          {currentEpisode.transcript ? (
            <div className="whitespace-pre-wrap select-none">
              {renderHighlightedText(
                formatTranscriptWithSpeakers(
                  currentEpisode.transcript, 
                  currentEpisode.utterances
                )
              )}
            </div>
          ) : (
            <div className="text-gray-400 italic">
              <p className="m-0">
                Transcript will appear here once generated...
              </p>
              <p className="m-0">&nbsp;</p>
              <p className="m-0">
                This is where you'll be able to read through the podcast transcript 
                and highlight the sections you want to export as snippets.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom action buttons */}
      <div className="self-stretch bg-stone-100 border-[#dddad1] border-solid border-t-[1px] overflow-hidden flex flex-row items-center justify-start pt-4 px-4 pb-6 gap-4 shrink-0">
        <button
          onClick={onDone}
          className="h-16 rounded-[24px] bg-[#dddad1] transition-colors overflow-hidden flex flex-row items-center justify-center py-[18px] px-6 box-border text-left text-base text-[#1b1b1b] font-['Termina']"
        >
          <b className="relative leading-[125%]">Done</b>
        </button>
        
        <PrimaryButtonL
          onClick={handleCopySnippets}
          className={`flex-1 ${isCopied ? '!bg-[#126545] !hover:bg-[#126545] !border-[#126545] !hover:border-[#126545]' : ''}`}
        >
          {isCopied ? "Copied to clipboard" : "Copy snippets"}
        </PrimaryButtonL>
      </div>
    </div>
  );
};

export default TranscriptHighlighting; 