import React, { useState, useEffect } from 'react';
import TimeRangeSelection from './TimeRangeSelection';
import ScreenshotEditModal from './ScreenshotEditModal';
import { processScreenshots, getTranscript } from '../services/api';

function PodcastScreenshotProcessor({ fileInputRef, initialFiles = [] }) {
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGettingTranscript, setIsGettingTranscript] = useState(false);
  const [podcastInfo, setPodcastInfo] = useState(null);
  const [transcripts, setTranscripts] = useState({});
  const [timeRange, setTimeRange] = useState({
    before: 30,
    after: 15
  });
  // Removed showNewUI state since we only use the new UI now
  const [processedEpisodeCount, setProcessedEpisodeCount] = useState(0); // Track how many episodes have been processed
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedScreenshotIndex, setSelectedScreenshotIndex] = useState(null);

  // Process initial files when component mounts
  useEffect(() => {
    if (initialFiles.length > 0) {
      setFiles(initialFiles);
      
      // Create preview URLs
      const newPreviews = initialFiles.map(file => URL.createObjectURL(file));
      setPreviews(newPreviews);
      
      // Start with 0 processed episodes so all initial files show ghost loading
      setProcessedEpisodeCount(0);
      
      // Automatically process files
      processFiles(initialFiles);
    }
  }, [initialFiles]);

  const handleFileChange = (event) => {
    console.log('📱 Mobile Debug: File input changed', {
      filesCount: event.target.files?.length || 0,
      isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    });
    
    const selectedFiles = Array.from(event.target.files || []);
    
    if (selectedFiles.length === 0) {
      console.log('📱 Mobile Debug: No files selected');
      return;
    }
    
    console.log('📱 Mobile Debug: Selected files:', selectedFiles.map(f => ({ name: f.name, size: f.size, type: f.type })));
    
    // Track the number of episodes that were already processed before adding new ones
    const previousEpisodeCount = files.length;
    
    // Append new files to existing files instead of replacing them
    const updatedFiles = [...files, ...selectedFiles];
    setFiles(updatedFiles);
    
    // Create preview URLs for new files and append to existing previews
    const newPreviews = selectedFiles.map(file => {
      try {
        return URL.createObjectURL(file);
      } catch (error) {
        console.error('📱 Mobile Debug: Error creating preview URL:', error);
        return null;
      }
    }).filter(Boolean);
    
    const updatedPreviews = [...previews, ...newPreviews];
    setPreviews(updatedPreviews);
    
    // Update the processed episode count to reflect what was already processed
    setProcessedEpisodeCount(previousEpisodeCount);
    
    // Automatically process all files (existing + new) after selection
    if (selectedFiles.length > 0) {
      console.log('📱 Mobile Debug: Processing files...');
      processFiles(updatedFiles);
    }
    
    // Clear the file input so the same file can be selected again if needed
    event.target.value = '';
  };

  const processFiles = async (filesToProcess) => {
    setIsProcessing(true);
    
    console.log('📱 Mobile Debug: Starting file processing', {
      fileCount: filesToProcess.length,
      totalSize: filesToProcess.reduce((sum, file) => sum + file.size, 0),
      files: filesToProcess.map(f => ({ 
        name: f.name, 
        size: f.size, 
        type: f.type,
        sizeInMB: (f.size / 1024 / 1024).toFixed(2) + 'MB'
      })),
      isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    });
    
    try {
      const formData = new FormData();
      filesToProcess.forEach((file, index) => {
        console.log(`📱 Mobile Debug: Adding file ${index + 1} to FormData:`, {
          name: file.name,
          size: file.size,
          type: file.type
        });
        formData.append('screenshots', file);
      });
      formData.append('timeRange', JSON.stringify(timeRange));

      console.log('📱 Mobile Debug: Sending request to server...');
      const startTime = Date.now();

      const result = await processScreenshots(formData);
      
      const endTime = Date.now();
      console.log('📱 Mobile Debug: Server response received', {
        processingTime: `${endTime - startTime}ms`,
        success: result.success,
        dataLength: result.data?.length || 0,
        hasError: !!result.error
      });
      
      if (result.success && result.data) {
        console.log('📱 Mobile Debug: Processing results:', result.data.map((item, index) => ({
          index,
          podcastTitle: item.firstPass?.podcastTitle || item.secondPass?.podcastTitle,
          episodeTitle: item.firstPass?.episodeTitle || item.secondPass?.episodeTitle,
          timestamp: item.firstPass?.timestamp || item.secondPass?.timestamp,
          validated: item.validation?.validated,
          player: item.firstPass?.player || item.secondPass?.player
        })));
      }
      
      setPodcastInfo(result);
      // Update the count of processed episodes
      setProcessedEpisodeCount(result?.data?.length || 0);
      // Clear previous transcripts when processing new screenshots
      setTranscripts({});
    } catch (error) {
      console.error('📱 Mobile Debug: Error processing screenshots:', {
        error: error.message,
        stack: error.stack,
        name: error.name
      });
      
      // Show error to user
      alert(`Error processing screenshots: ${error.message}\n\nPlease try again or contact support if the issue persists.`);
      
      // Set error state for UI feedback
      setPodcastInfo({
        success: false,
        error: error.message,
        data: []
      });
      // Reset processed episode count on error
      setProcessedEpisodeCount(0);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddScreenshots = () => {
    console.log('📱 Mobile Debug: Add screenshots button clicked');
    
    if (fileInputRef.current) {
      console.log('📱 Mobile Debug: Triggering file input click');
      
      // Add a small delay for mobile browsers
      setTimeout(() => {
      fileInputRef.current.click();
      }, 100);
    } else {
      console.error('📱 Mobile Debug: File input ref not found');
    }
  };

  // Removed handleProcess function since it was only used by the old UI

  const handleGenerateTranscript = async (selectedTimeRange) => {
    if (!podcastInfo || !Array.isArray(podcastInfo.data)) return null;

    console.log(`🎯 Starting transcript generation for ${podcastInfo.data.length} episodes`);

    // Convert time range to the format expected by the API
    const convertedTimeRange = {
      before: Math.abs(selectedTimeRange.start), // Convert negative to positive
      after: selectedTimeRange.end
    };

    // Process transcripts for ALL validated screenshots
    const episodes = [];
    const validatedEpisodes = podcastInfo.data.filter(info => 
      info.validation?.validated && info.secondPass?.timestamp
    );
    
    console.log(`📊 Found ${validatedEpisodes.length} validated episodes out of ${podcastInfo.data.length} total`);
    
    for (let index = 0; index < podcastInfo.data.length; index++) {
      const info = podcastInfo.data[index];
      
      console.log(`🔄 Processing episode ${index + 1}/${podcastInfo.data.length}`);
      
      if (info.validation?.validated && (info.timestamp || info.secondPass?.timestamp || info.firstPass?.timestamp)) {
        try {
          const transcriptResult = await handleGetTranscript(info, index, convertedTimeRange);
          
          // Add each transcript to the episodes array with proper data mapping
          if (transcriptResult && (transcriptResult.transcript || transcriptResult.text)) {
            console.log(`✅ Successfully got transcript for episode ${index}:`, {
              episodeTitle: transcriptResult.episode?.title || info.validation?.validatedEpisode?.title,
              textLength: (transcriptResult.transcript || transcriptResult.text).length,
              hasWords: !!transcriptResult.words
            });

            const episodeData = {
              transcript: transcriptResult.transcript || transcriptResult.text,
              episodeTitle: transcriptResult.episode?.title || 
                           info.episodeTitle ||
                           info.validation?.validatedEpisode?.title || 
                           info.secondPass?.episodeTitle || 
                           `Episode ${index + 1}`,
              timestamp: `${selectedTimeRange.start}s to ${selectedTimeRange.end}s`,
              podcastArtwork: transcriptResult.episode?.artworkUrl || 
                             info.validation?.validatedEpisode?.artworkUrl || 
                             info.validation?.validatedPodcast?.artworkUrl ||
                             info.validation?.validatedPodcast?.artworkUrl600 ||
                             info.validation?.validatedPodcast?.artworkUrl100,
              originalTimestamp: info.timestamp || info.secondPass?.timestamp || info.firstPass?.timestamp || '0:00',
              selectedRange: selectedTimeRange,
              // Add the missing data for copy functionality
              podcastName: transcriptResult.podcast?.title || 
                          info.podcastTitle ||
                          info.validation?.validatedPodcast?.title,
              podcastId: transcriptResult.podcast?.id || 
                        info.validation?.validatedPodcast?.id,
              episodeId: transcriptResult.episode?.id || 
                        info.validation?.validatedEpisode?.id,
              words: transcriptResult.words || [], // Word-level timestamps from AssemblyAI
              utterances: transcriptResult.utterances || [], // Speaker-separated utterances from AssemblyAI
              // Include validation data for fallback
              validatedPodcast: info.validation?.validatedPodcast,
              validatedEpisode: info.validation?.validatedEpisode
            };
            
            episodes.push(episodeData);
            console.log(`📝 Added episode ${index} to episodes array. Total episodes: ${episodes.length}`);
          } else {
            console.warn(`⚠️ No transcript result for episode ${index}`);
          }
        } catch (error) {
          console.error(`❌ Error generating transcript for episode ${index}:`, error);
        }
      } else {
        console.warn(`⚠️ Episode ${index} skipped - validation failed or missing timestamp:`, {
          validated: info.validation?.validated,
          hasDirectTimestamp: !!info.timestamp,
          hasSecondPassTimestamp: !!info.secondPass?.timestamp,
          hasFirstPassTimestamp: !!info.firstPass?.timestamp
        });
      }
    }
    
    console.log(`🎉 Transcript generation complete. Generated ${episodes.length} episodes out of ${podcastInfo.data.length} total`);
    
    // Return all episodes if we have any, otherwise return null
    return episodes.length > 0 ? { episodes } : null;
  };

  const handleGetTranscript = async (info, index, customTimeRange = null) => {
    console.log(`🔍 Debug: Processing episode ${index}:`, {
      hasValidatedPodcastId: !!info.validation?.validatedPodcast?.id,
      hasValidatedEpisodeTitle: !!info.validation?.validatedEpisode?.title,
      hasSecondPassTimestamp: !!info.secondPass?.timestamp,
      hasFirstPassTimestamp: !!info.firstPass?.timestamp,
      validationValidated: info.validation?.validated,
      secondPassEpisodeTitle: info.secondPass?.episodeTitle,
      firstPassEpisodeTitle: info.firstPass?.episodeTitle
    });

    // More lenient validation - require at least basic episode info
    const hasBasicInfo = (
      info.validation?.validatedPodcast?.id && 
      (info.episodeTitle || info.validation?.validatedEpisode?.title || info.secondPass?.episodeTitle || info.firstPass?.episodeTitle) &&
      (info.timestamp || info.secondPass?.timestamp || info.firstPass?.timestamp)
    );

    if (!hasBasicInfo) {
      console.error(`❌ Missing required information for transcript (episode ${index}):`, {
        podcastId: info.validation?.validatedPodcast?.id,
        episodeTitle: info.episodeTitle || info.validation?.validatedEpisode?.title || info.secondPass?.episodeTitle || info.firstPass?.episodeTitle,
        timestamp: info.timestamp || info.secondPass?.timestamp || info.firstPass?.timestamp
      });
      return null;
    }

    console.log(`✅ Episode ${index} has required info, proceeding with transcript generation`);

    setIsGettingTranscript(true);
    try {
      const transcriptResult = await getTranscript(info, customTimeRange || timeRange);
      
      // Store transcript by index (for the classic UI)
      setTranscripts(prev => ({
        ...prev,
        [index]: transcriptResult
      }));
      
      // Return the transcript data (for the new UI)
      return transcriptResult;
    } catch (error) {
      console.error(`❌ Error getting transcript for episode ${index}:`, error);
      return null;
    } finally {
      setIsGettingTranscript(false);
    }
  };

  // Convert files to screenshot format for new UI
  const screenshots = files.map((file, index) => ({
    file,
    preview: previews[index],
    // Only show ghost loading for new episodes being added (index >= processedEpisodeCount) and only during initial processing (not transcript generation)
    shouldShowGhostLoading: isProcessing && !isGettingTranscript && index >= processedEpisodeCount,
    podcastInfo: podcastInfo?.data?.[index] ? {
      episodeTitle: podcastInfo.data[index].episodeTitle ||
                   podcastInfo.data[index].validation?.validatedEpisode?.title || 
                   podcastInfo.data[index].secondPass?.episodeTitle || 
                   podcastInfo.data[index].firstPass?.episodeTitle ||
                   `Episode ${index + 1}`,
      timestamp: podcastInfo.data[index].timestamp ||
                podcastInfo.data[index].secondPass?.timestamp || 
                podcastInfo.data[index].firstPass?.timestamp ||
                '0:00',
      podcastArtwork: podcastInfo.data[index].validation?.validatedPodcast?.artworkUrl || 
                     podcastInfo.data[index].validation?.validatedPodcast?.artwork || 
                     podcastInfo.data[index].validation?.validatedPodcast?.image ||
                     podcastInfo.data[index].validation?.validatedEpisode?.artworkUrl ||
                     podcastInfo.data[index].validation?.validatedEpisode?.artwork ||
                     podcastInfo.data[index].validation?.validatedEpisode?.image
    } : {
      episodeTitle: `Episode ${index + 1}`,
      timestamp: '0:00',
      podcastArtwork: null
    }
  }));

  // Debug: Log the extracted episode titles and artwork
  if (podcastInfo?.data) {
    console.log('Debug - Episode data extracted:', 
      podcastInfo.data.map((info, index) => ({
        index,
        validatedTitle: info.validation?.validatedEpisode?.title,
        secondPassTitle: info.secondPass?.episodeTitle,
        firstPassTitle: info.firstPass?.episodeTitle,
        finalTitle: screenshots[index]?.podcastInfo?.episodeTitle,
        podcastArtwork: info.validation?.validatedPodcast?.artworkUrl,
        episodeArtwork: info.validation?.validatedEpisode?.artworkUrl,
        finalArtwork: screenshots[index]?.podcastInfo?.podcastArtwork
      }))
    );
  }

  // Modal handlers
  const handleScreenshotClick = (index) => {
    console.log('handleScreenshotClick called with index:', index);
    setSelectedScreenshotIndex(index);
    setIsEditModalOpen(true);
    console.log('Modal state set to open');
  };

  const handleModalUpdate = (updatedData) => {
    console.log('handleModalUpdate called with:', updatedData);
    console.log('selectedScreenshotIndex:', selectedScreenshotIndex);
    console.log('podcastInfo:', podcastInfo);
    
    // Update the podcast info with the new data
    if (selectedScreenshotIndex !== null && podcastInfo?.data) {
      const updatedPodcastInfo = { ...podcastInfo };
      const screenshotData = updatedPodcastInfo.data[selectedScreenshotIndex];
      
      console.log('Original screenshot data:', screenshotData);
      
      // Update the validation data
      if (updatedData.podcast) {
        screenshotData.validation = {
          ...screenshotData.validation,
          validatedPodcast: updatedData.podcast
        };
        screenshotData.secondPass = {
          ...screenshotData.secondPass,
          podcastTitle: updatedData.podcast.title
        };
        // Also update root level for UI consistency
        screenshotData.podcastTitle = updatedData.podcast.title;
        console.log('Updated podcast:', updatedData.podcast.title);
      }
      
      if (updatedData.episode) {
        screenshotData.validation = {
          ...screenshotData.validation,
          validatedEpisode: updatedData.episode
        };
        screenshotData.secondPass = {
          ...screenshotData.secondPass,
          episodeTitle: updatedData.episode.title
        };
        // Also update root level for UI consistency
        screenshotData.episodeTitle = updatedData.episode.title;
        console.log('Updated episode:', updatedData.episode.title);
      }
      
      if (updatedData.timestamp) {
        screenshotData.secondPass = {
          ...screenshotData.secondPass,
          timestamp: updatedData.timestamp
        };
        // Also update root level for UI consistency
        screenshotData.timestamp = updatedData.timestamp;
        console.log('Updated timestamp:', updatedData.timestamp);
      }
      
      console.log('Updated screenshot data:', screenshotData);
      setPodcastInfo(updatedPodcastInfo);
      console.log('PodcastInfo state updated');
    } else {
      console.log('Cannot update: selectedScreenshotIndex or podcastInfo missing');
    }
  };

  const handleModalDelete = () => {
    if (selectedScreenshotIndex !== null) {
      // Remove the file and preview
      const updatedFiles = files.filter((_, index) => index !== selectedScreenshotIndex);
      const updatedPreviews = previews.filter((_, index) => index !== selectedScreenshotIndex);
      
      setFiles(updatedFiles);
      setPreviews(updatedPreviews);
      
      // Remove the podcast info
      if (podcastInfo?.data) {
        const updatedPodcastInfo = { ...podcastInfo };
        updatedPodcastInfo.data = updatedPodcastInfo.data.filter((_, index) => index !== selectedScreenshotIndex);
        setPodcastInfo(updatedPodcastInfo);
      }
      
      // Remove the transcript
      if (transcripts[selectedScreenshotIndex]) {
        const updatedTranscripts = { ...transcripts };
        delete updatedTranscripts[selectedScreenshotIndex];
        setTranscripts(updatedTranscripts);
      }
    }
  };

  // Always show the new UI
  return (
    <div className="w-full max-w-[393px] mx-auto px-4">
      <TimeRangeSelection
        screenshots={screenshots}
        onAddScreenshots={handleAddScreenshots}
        onGenerateTranscript={handleGenerateTranscript}
        onScreenshotClick={handleScreenshotClick}
        isProcessing={isProcessing}
      />
      
      {/* Hidden file input */}
      <input
        type="file"
        multiple
        accept="image/*,image/jpeg,image/jpg,image/png,image/heic,image/heif"
        className="hidden"
        onChange={handleFileChange}
        ref={fileInputRef}
      />

      {/* Screenshot Edit Modal */}
      <ScreenshotEditModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        screenshotData={selectedScreenshotIndex !== null && podcastInfo?.data ? {
          ...podcastInfo.data[selectedScreenshotIndex],
          preview: previews[selectedScreenshotIndex]
        } : null}
        onUpdate={handleModalUpdate}
        onDelete={handleModalDelete}
      />
    </div>
  );
}

export default PodcastScreenshotProcessor; 