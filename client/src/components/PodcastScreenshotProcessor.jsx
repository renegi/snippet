import React, { useState, useEffect, useRef } from 'react';
import TimeRangeSelection from './TimeRangeSelection';
import ScreenshotEditModal from './ScreenshotEditModal';
import EpisodePickerModal from './EpisodePickerModal';
import { processScreenshot, getTranscript } from '../services/api';

// How many screenshots to send at once (each one triggers several Apple Podcasts lookups)
const UPLOAD_CONCURRENCY = 2;

// Runs `fn` over `items` with at most `limit` in flight, preserving order
const mapWithConcurrency = async (items, limit, fn) => {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

function PodcastScreenshotProcessor({ fileInputRef, initialFiles = [] }) {
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGettingTranscript, setIsGettingTranscript] = useState(false);
  const [podcastInfo, setPodcastInfo] = useState(null);
  const [transcripts, setTranscripts] = useState({});
  const [timeRange] = useState({
    before: 30,
    after: 15
  });
  // Removed showNewUI state since we only use the new UI now
  const [processedEpisodeCount, setProcessedEpisodeCount] = useState(0); // Track how many episodes have been processed
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [selectedScreenshotIndex, setSelectedScreenshotIndex] = useState(null);

  // A screenshot whose episode the server couldn't pin down, with likely episodes to pick from
  const needsEpisodeChoice = (item) =>
    !!item?.validation?.needsConfirmation && item.validation.suggestions?.length > 0;

  // Once processing finishes, ask about the first unsure screenshot the user hasn't seen yet
  useEffect(() => {
    if (isProcessing || isEditModalOpen || isPickerOpen || !podcastInfo?.data) return;
    const index = podcastInfo.data.findIndex(item => needsEpisodeChoice(item) && !item.choiceDismissed);
    if (index >= 0) {
      setSelectedScreenshotIndex(index);
      setIsPickerOpen(true);
    }
  }, [isProcessing, isEditModalOpen, isPickerOpen, podcastInfo]);


  // Process initial files when component mounts
  const hasProcessedInitialFiles = useRef(false);
  useEffect(() => {
    if (initialFiles.length > 0 && !hasProcessedInitialFiles.current) {
      hasProcessedInitialFiles.current = true;
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
    
    const selectedFiles = Array.from(event.target.files || []);
    
    if (selectedFiles.length === 0) {
      return;
    }
    
    
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
    
    // Automatically process the new files; earlier results (and any edits to them) are kept
    if (selectedFiles.length > 0) {
      processFiles(selectedFiles);
    }
    
    // Clear the file input so the same file can be selected again if needed
    event.target.value = '';
  };

  // Extracts podcast info for newly added files and appends it to the existing results
  const processFiles = async (newFiles) => {
    setIsProcessing(true);
    const requestErrors = [];

    try {
      const results = await mapWithConcurrency(newFiles, UPLOAD_CONCURRENCY, async (file) => {
        try {
          const result = await processScreenshot(file);
          return result.data?.[0] || { error: true, message: `No result for ${file.name}` };
        } catch (error) {
          console.error(`Error processing ${file.name}:`, error);
          requestErrors.push(error.message);
          return {
            error: true,
            message: `Failed to process ${file.name}: ${error.message}`
          };
        }
      });

      setPodcastInfo(prev => ({
        success: true,
        data: [...(prev?.data || []), ...results],
        error: null
      }));
      setProcessedEpisodeCount(count => count + results.length);
      // Clear previous transcripts when processing new screenshots
      setTranscripts({});

      if (requestErrors.length > 0) {
        alert(`Error processing ${requestErrors.length} screenshot(s): ${requestErrors[0]}\n\nPlease try again or contact support if the issue persists.`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddScreenshots = () => {
    
    if (fileInputRef.current) {
      
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


    // Convert time range to the format expected by the API
    const convertedTimeRange = {
      before: Math.abs(selectedTimeRange.start), // Convert negative to positive
      after: selectedTimeRange.end
    };

    // Request transcripts for all validated screenshots at once; results keep screenshot order
    const episodes = [];
    const failures = [];
    const eligible = podcastInfo.data
      .map((info, index) => ({ info, index }))
      .filter(({ info }) => info.validation?.validated && info.timestamp);

    setIsGettingTranscript(true);
    let results;
    try {
      results = await Promise.allSettled(
        eligible.map(({ info, index }) => handleGetTranscript(info, index, convertedTimeRange))
      );
    } finally {
      setIsGettingTranscript(false);
    }

    results.forEach((result, i) => {
      const { info, index } = eligible[i];
      if (result.status === 'rejected') {
        console.error(`❌ Error generating transcript for episode ${index}:`, result.reason);
        failures.push(result.reason.message);
        return;
      }

      const transcriptResult = result.value;
      if (transcriptResult && (transcriptResult.transcript || transcriptResult.text)) {
        const episodeData = {
          transcript: transcriptResult.transcript || transcriptResult.text,
          episodeTitle: transcriptResult.episode?.title || 
                       info.episodeTitle ||
                       info.validation?.validatedEpisode?.title || 
                       `Episode ${index + 1}`,
          timestamp: `${selectedTimeRange.start}s to ${selectedTimeRange.end}s`,
          podcastArtwork: transcriptResult.episode?.artworkUrl || 
                         info.validation?.validatedEpisode?.artworkUrl || 
                         info.validation?.validatedPodcast?.artworkUrl ||
                         info.validation?.validatedPodcast?.artworkUrl600 ||
                         info.validation?.validatedPodcast?.artworkUrl100,
          originalTimestamp: info.timestamp || '0:00',
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
      } else {
        console.warn(`⚠️ No transcript result for episode ${index}`);
      }
    });
    
    
    // Return all episodes if we have any, otherwise return null
    if (failures.length > 0) {
      const summary = episodes.length > 0
        ? `${failures.length} of ${failures.length + episodes.length} transcripts couldn't be generated`
        : "The transcript couldn't be generated";
      alert(`${summary}:\n\n${failures.join('\n')}`);
    }

    return episodes.length > 0 ? { episodes } : null;
  };

  const handleGetTranscript = async (info, index, customTimeRange = null) => {

    // More lenient validation - require at least basic episode info
    const hasBasicInfo = (
      info.validation?.validatedPodcast?.id && 
      (info.episodeTitle || info.validation?.validatedEpisode?.title) &&
      info.timestamp
    );

    if (!hasBasicInfo) {
      console.error(`❌ Missing required information for transcript (episode ${index}):`, {
        podcastId: info.validation?.validatedPodcast?.id,
        episodeTitle: info.episodeTitle || info.validation?.validatedEpisode?.title,
        timestamp: info.timestamp
      });
      return null;
    }


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
      throw error;
    }
  };

  // Convert files to screenshot format for new UI
  const screenshots = files.map((file, index) => {
    const hasData = !!podcastInfo?.data?.[index];
    
    return {
      file,
      preview: previews[index],
      // Only show ghost loading for new episodes being added (index >= processedEpisodeCount) and only during initial processing (not transcript generation)
      shouldShowGhostLoading: isProcessing && !isGettingTranscript && index >= processedEpisodeCount,
      podcastInfo: hasData ? (() => {
        const dataItem = podcastInfo.data[index];
        const hasError = !!dataItem.error;
        const hasAnyData = !!dataItem.validation;
        
        // Check if extraction completely failed
        if (hasError || !hasAnyData) {
          console.warn(`⚠️ Screenshot ${index} extraction failed:`, {
            error: dataItem.error,
            message: dataItem.message,
            hasValidation: !!dataItem.validation
          });
        }
        
        // The podcast alone, or nothing, was found: the user has to choose the episode
        const episodeMissing = !hasError && hasAnyData && !dataItem.validation.validatedEpisode;

        const finalEpisodeTitle = episodeMissing ? 'Unidentified episode' : (
                                 dataItem.episodeTitle ||
                                 dataItem.validation?.validatedEpisode?.title || 
                                 (hasError ? 'Extraction failed' : `Episode ${index + 1}`));
        
        const finalTimestamp = dataItem.timestamp ||
                              '0:00';
        
        const finalArtwork = dataItem.validation?.validatedPodcast?.artworkUrl || 
                            dataItem.validation?.validatedPodcast?.artwork || 
                            dataItem.validation?.validatedPodcast?.image ||
                            dataItem.validation?.validatedEpisode?.artworkUrl ||
                            dataItem.validation?.validatedEpisode?.artwork ||
                            dataItem.validation?.validatedEpisode?.image;
        
        
        return {
          episodeTitle: finalEpisodeTitle,
          timestamp: finalTimestamp,
          podcastArtwork: finalArtwork,
          needsEpisodeChoice: episodeMissing || needsEpisodeChoice(dataItem),
          episodeMissing,
          hasError: hasError || !hasAnyData
        };
      })() : {
      episodeTitle: `Episode ${index + 1}`,
      timestamp: '0:00',
      podcastArtwork: null
    }
    };
  });

  // Modal handlers
  const handleScreenshotClick = (index) => {
    setSelectedScreenshotIndex(index);
    if (needsEpisodeChoice(podcastInfo?.data?.[index])) {
      setIsPickerOpen(true);
    } else {
      setIsEditModalOpen(true);
    }
  };

  // Closing the picker without choosing keeps the screenshot as it is; it stays marked in the
  // list and can be reopened by tapping it, but isn't asked about again automatically
  const handlePickerClose = () => {
    setIsPickerOpen(false);
    setPodcastInfo(prev => ({
      ...prev,
      data: prev.data.map((item, index) => (
        index === selectedScreenshotIndex && needsEpisodeChoice(item) ? { ...item, choiceDismissed: true } : item
      ))
    }));
  };

  // "None of these": search for the podcast and episode by hand instead
  const handleSearchManually = () => {
    handlePickerClose();
    setIsEditModalOpen(true);
  };

  // Applies edits from the modal to the selected screenshot's data (without mutating state)
  const handleModalUpdate = (updatedData) => {
    if (selectedScreenshotIndex === null || !podcastInfo?.data) return;

    const applyEdits = (item) => {
      const updated = { ...item, validation: { ...item.validation } };
      if (updatedData.podcast) {
        updated.validation.validatedPodcast = updatedData.podcast;
        updated.podcastTitle = updatedData.podcast.title;
      }
      if (updatedData.episode) {
        updated.validation.validatedEpisode = updatedData.episode;
        updated.episodeTitle = updatedData.episode.title;
      }
      if (updatedData.podcast && updatedData.episode) {
        // The user chose both, so it no longer needs confirming and can be transcribed
        updated.validation.validated = true;
        updated.validation.needsConfirmation = false;
      }
      if (updatedData.timestamp) {
        updated.timestamp = updatedData.timestamp;
      }
      return updated;
    };

    setPodcastInfo(prev => ({
      ...prev,
      data: prev.data.map((item, index) => (index === selectedScreenshotIndex ? applyEdits(item) : item))
    }));
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
    <div className="w-full max-w-[393px] h-full mx-auto px-4">
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

      {/* "Which episode is this?" picker */}
      <EpisodePickerModal
        isOpen={isPickerOpen}
        onClose={handlePickerClose}
        screenshotData={selectedScreenshotIndex !== null && podcastInfo?.data?.[selectedScreenshotIndex] ? {
          ...podcastInfo.data[selectedScreenshotIndex],
          preview: previews[selectedScreenshotIndex]
        } : null}
        onConfirm={handleModalUpdate}
        onSearchManually={handleSearchManually}
      />
    </div>
  );
}

export default PodcastScreenshotProcessor; 