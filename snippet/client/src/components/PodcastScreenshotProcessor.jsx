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

  // Debug: Log when podcastInfo changes
  useEffect(() => {
    console.log('🔄 podcastInfo state changed:', {
      hasPodcastInfo: !!podcastInfo,
      success: podcastInfo?.success,
      dataLength: podcastInfo?.data?.length || 0,
      hasData: !!podcastInfo?.data,
      podcastInfoKeys: podcastInfo ? Object.keys(podcastInfo) : [],
      firstItem: podcastInfo?.data?.[0] ? 'exists' : 'missing'
    });
  }, [podcastInfo]);

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
          player: item.firstPass?.player || item.secondPass?.player,
          hasError: !!item.error,
          errorMessage: item.error || item.message,
          // Show what's actually in the item
          itemKeys: Object.keys(item),
          hasFirstPass: !!item.firstPass,
          hasSecondPass: !!item.secondPass,
          hasValidation: !!item.validation
        })));
        
        // Check if extraction failed
        result.data.forEach((item, index) => {
          if (item.error || (!item.firstPass && !item.secondPass && !item.validation)) {
            console.error(`❌ Extraction failed for screenshot ${index}:`, {
              error: item.error,
              message: item.message,
              hasFirstPass: !!item.firstPass,
              hasSecondPass: !!item.secondPass,
              hasValidation: !!item.validation,
              fullItem: item
            });
          }
        });
      }
      
      console.log('📱 Mobile Debug: Setting podcastInfo state:', {
        success: result.success,
        dataLength: result.data?.length || 0,
        hasData: !!result.data,
        resultKeys: Object.keys(result),
        resultType: typeof result,
        isArray: Array.isArray(result),
        firstItem: result.data?.[0] ? {
          hasValidation: !!result.data[0].validation,
          validated: result.data[0].validation?.validated,
          hasValidatedPodcast: !!result.data[0].validation?.validatedPodcast,
          hasValidatedEpisode: !!result.data[0].validation?.validatedEpisode,
          episodeTitle: result.data[0].episodeTitle || result.data[0].validation?.validatedEpisode?.title || result.data[0].secondPass?.episodeTitle || result.data[0].firstPass?.episodeTitle,
          podcastTitle: result.data[0].podcastTitle || result.data[0].validation?.validatedPodcast?.title || result.data[0].secondPass?.podcastTitle || result.data[0].firstPass?.podcastTitle,
          // Show all available properties
          allKeys: Object.keys(result.data[0]),
          firstPass: result.data[0].firstPass,
          secondPass: result.data[0].secondPass,
          validation: result.data[0].validation,
          error: result.data[0].error,
          fullItem: result.data[0]
        } : null,
        fullResult: result
      });
      
      // Ensure result has the correct structure
      const podcastInfoToSet = {
        success: result.success,
        data: result.data || [],
        error: result.error || null
      };
      
      console.log('📱 Mobile Debug: About to set state with:', {
        success: podcastInfoToSet.success,
        dataLength: podcastInfoToSet.data?.length || 0,
        hasData: !!podcastInfoToSet.data,
        podcastInfoToSet
      });
      
      setPodcastInfo(podcastInfoToSet);
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
  const screenshots = files.map((file, index) => {
    const hasData = !!podcastInfo?.data?.[index];
    const dataItem = podcastInfo?.data?.[index];
    
    if (hasData) {
      const extractedEpisodeTitle = dataItem.episodeTitle || 
                                   dataItem.validation?.validatedEpisode?.title || 
                                   dataItem.secondPass?.episodeTitle || 
                                   dataItem.firstPass?.episodeTitle ||
                                   `Episode ${index + 1}`;
      
      console.log(`📱 Debug: Screenshot ${index} has data:`, {
        index,
        hasValidation: !!dataItem.validation,
        validated: dataItem.validation?.validated,
        episodeTitle: extractedEpisodeTitle,
        podcastTitle: dataItem.podcastTitle || dataItem.validation?.validatedPodcast?.title || dataItem.secondPass?.podcastTitle || dataItem.firstPass?.podcastTitle,
        timestamp: dataItem.timestamp || dataItem.secondPass?.timestamp || dataItem.firstPass?.timestamp,
        // Show all possible sources
        rawEpisodeTitle: dataItem.episodeTitle,
        validatedEpisodeTitle: dataItem.validation?.validatedEpisode?.title,
        secondPassEpisodeTitle: dataItem.secondPass?.episodeTitle,
        firstPassEpisodeTitle: dataItem.firstPass?.episodeTitle,
        // Show full data structure
        fullDataItem: dataItem
      });
    } else {
      console.log(`📱 Debug: Screenshot ${index} has NO data:`, {
        index,
        hasPodcastInfo: !!podcastInfo,
        dataLength: podcastInfo?.data?.length || 0,
        podcastInfoKeys: podcastInfo ? Object.keys(podcastInfo) : []
      });
    }
    
    return {
      file,
      preview: previews[index],
      // Only show ghost loading for new episodes being added (index >= processedEpisodeCount) and only during initial processing (not transcript generation)
      shouldShowGhostLoading: isProcessing && !isGettingTranscript && index >= processedEpisodeCount,
      podcastInfo: hasData ? (() => {
        const dataItem = podcastInfo.data[index];
        const hasError = !!dataItem.error;
        const hasAnyData = !!(dataItem.firstPass || dataItem.secondPass || dataItem.validation);
        
        // Check if extraction completely failed
        if (hasError || !hasAnyData) {
          console.warn(`⚠️ Screenshot ${index} extraction failed:`, {
            error: dataItem.error,
            message: dataItem.message,
            hasFirstPass: !!dataItem.firstPass,
            hasSecondPass: !!dataItem.secondPass,
            hasValidation: !!dataItem.validation
          });
        }
        
        const finalEpisodeTitle = dataItem.episodeTitle ||
                                 dataItem.validation?.validatedEpisode?.title || 
                                 dataItem.secondPass?.episodeTitle || 
                                 dataItem.firstPass?.episodeTitle ||
                                 (hasError ? 'Extraction failed' : `Episode ${index + 1}`);
        
        const finalTimestamp = dataItem.timestamp ||
                              dataItem.secondPass?.timestamp || 
                              dataItem.firstPass?.timestamp ||
                              '0:00';
        
        const finalArtwork = dataItem.validation?.validatedPodcast?.artworkUrl || 
                            dataItem.validation?.validatedPodcast?.artwork || 
                            dataItem.validation?.validatedPodcast?.image ||
                            dataItem.validation?.validatedEpisode?.artworkUrl ||
                            dataItem.validation?.validatedEpisode?.artwork ||
                            dataItem.validation?.validatedEpisode?.image;
        
        console.log(`✅ Final values for Screenshot ${index}:`, {
          episodeTitle: finalEpisodeTitle,
          timestamp: finalTimestamp,
          artwork: finalArtwork || 'null',
          hasError,
          hasAnyData
        });
        
        return {
          episodeTitle: finalEpisodeTitle,
          timestamp: finalTimestamp,
          podcastArtwork: finalArtwork,
          hasError: hasError || !hasAnyData
        };
      })() : {
      episodeTitle: `Episode ${index + 1}`,
      timestamp: '0:00',
      podcastArtwork: null
    }
    };
  });

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
    
    // More detailed logging
    podcastInfo.data.forEach((info, index) => {
      const screenshot = screenshots[index];
      console.log(`🔍 Detailed Debug for Screenshot ${index}:`, {
        'Raw episodeTitle': info.episodeTitle,
        'Validated episode title': info.validation?.validatedEpisode?.title,
        'Second pass title': info.secondPass?.episodeTitle,
        'First pass title': info.firstPass?.episodeTitle,
        'Final displayed title': screenshot?.podcastInfo?.episodeTitle,
        'Has validation': !!info.validation,
        'Validation validated': info.validation?.validated,
        'Has validated podcast': !!info.validation?.validatedPodcast,
        'Has validated episode': !!info.validation?.validatedEpisode,
        'Podcast title': info.podcastTitle || info.validation?.validatedPodcast?.title,
        'Timestamp': info.timestamp || info.secondPass?.timestamp || info.firstPass?.timestamp,
        'Artwork URL': screenshot?.podcastInfo?.podcastArtwork
      });
    });
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