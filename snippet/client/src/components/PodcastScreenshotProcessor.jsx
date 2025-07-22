import React, { useState, useEffect } from 'react';
import { CloudArrowUpIcon } from '@heroicons/react/24/outline';
import TimeRangeSelector from './TimeRangeSelector';
import TimeRangeSelection from './TimeRangeSelection';
import TextSelection from './TextSelection';
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
  const [showNewUI, setShowNewUI] = useState(true); // Always start with new UI
  const [processedEpisodeCount, setProcessedEpisodeCount] = useState(0); // Track how many episodes have been processed

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

  const handleProcess = async () => {
    if (files.length === 0) return;
    await processFiles(files);
  };

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
          if (transcriptResult && transcriptResult.text) {
            console.log(`✅ Successfully got transcript for episode ${index}:`, {
              episodeTitle: transcriptResult.episode?.title || info.validation?.validatedEpisode?.title,
              textLength: transcriptResult.text.length,
              hasWords: !!transcriptResult.words
            });

            const episodeData = {
              transcript: transcriptResult.text,
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
        [index]: transcriptResult.data
      }));
      
      // Return the transcript data (for the new UI)
      return transcriptResult.data;
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

  // Show new UI when requested (even without files initially)
  if (showNewUI) {
    return (
      <div className="w-full max-w-[393px] mx-auto px-4">
        <TimeRangeSelection
          screenshots={screenshots}
          onAddScreenshots={handleAddScreenshots}
          onGenerateTranscript={handleGenerateTranscript}
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
        
        {/* Toggle back to old UI - centered */}
        <div className="flex justify-center mt-6">
          <button
            onClick={() => setShowNewUI(false)}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Look under the hood
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="space-y-6">
          {/* Toggle to new UI - always visible */}
          <div className="flex justify-center mb-4">
            <button
              onClick={() => setShowNewUI(true)}
              className="text-sm text-blue-600 hover:text-blue-800 underline"
            >
              Go back
            </button>
          </div>

          {/* File Upload Section */}
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
            <div className="text-center">
              <CloudArrowUpIcon className="mx-auto h-12 w-12 text-gray-400" />
              <div className="mt-4">
                <label htmlFor="file-upload" className="cursor-pointer bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700">
                  Select Screenshots
                </label>
                <input
                  id="file-upload"
                  type="file"
                  multiple
                  accept="image/*,image/jpeg,image/jpg,image/png,image/heic,image/heif"
                  className="hidden"
                  onChange={handleFileChange}
                  ref={fileInputRef}
                />
              </div>
              <p className="mt-2 text-sm text-gray-500">
                Upload one or more podcast screenshots
              </p>
            </div>
          </div>

          {/* Preview Section */}
          {previews.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              {previews.map((preview, index) => (
                <div key={index} className="relative">
                  <img
                    src={preview}
                    alt={`Preview ${index + 1}`}
                    className="w-full h-48 object-cover rounded-lg"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Time Range Selector */}
          <TimeRangeSelector
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
          />

          {/* Process Button or Loading Bar */}
          <div className="flex justify-center min-h-[56px]">
            {isProcessing ? (
              <div className="w-full max-w-[361px]">
                <div className="w-full bg-gray-200 rounded-full h-4">
                  <div className="bg-indigo-600 h-4 rounded-full animate-pulse" style={{ width: '80%' }}></div>
                </div>
                <div className="text-center text-sm text-gray-600 mt-2">Processing screenshots…</div>
              </div>
            ) : (
              <button
                onClick={handleProcess}
                disabled={files.length === 0}
                className={`px-6 py-3 rounded-md text-white font-medium ${
                  files.length === 0
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                Process Screenshots
              </button>
            )}
          </div>

          {/* Results Section */}
          {podcastInfo && Array.isArray(podcastInfo.data) && (
            <div className="mt-6 space-y-6">
              {podcastInfo.data.map((info, idx) => (
                <div key={idx} className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Extracted Information - Screenshot {idx + 1}
                  </h3>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    {/* First Pass - OCR Results */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="flex items-center mb-3">
                        <div className="w-3 h-3 bg-gray-400 rounded-full mr-2"></div>
                        <h4 className="font-medium text-gray-900">First Pass (OCR)</h4>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="font-medium text-gray-700">Podcast:</span>
                          <span className="ml-2 text-gray-600">
                            {info.firstPass?.podcastTitle || 
                              <span className="italic text-gray-400">Not found</span>
                            }
                          </span>
                        </div>
                        <div>
                          <span className="font-medium text-gray-700">Episode:</span>
                          <span className="ml-2 text-gray-600">
                            {info.firstPass?.episodeTitle || 
                              <span className="italic text-gray-400">Not found</span>
                            }
                          </span>
                        </div>
                        <div>
                          <span className="font-medium text-gray-700">Timestamp:</span>
                          <span className="ml-2 text-gray-600">
                            {info.firstPass?.timestamp || 
                              <span className="italic text-gray-400">Not found</span>
                            }
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Second Pass - Validated Results */}
                    <div className="bg-blue-50 rounded-lg p-4">
                      <div className="flex items-center mb-3">
                        <div className={`w-3 h-3 rounded-full mr-2 ${
                          info.secondPass?.player === 'validated' ? 'bg-green-500' :
                          info.secondPass?.player === 'partially_validated' ? 'bg-yellow-500' :
                          'bg-red-500'
                        }`}></div>
                        <h4 className="font-medium text-gray-900">
                          Second Pass (API Validated)
                        </h4>
                        {info.validation?.confidence && (
                          <span className={`ml-auto text-xs px-2 py-1 rounded-full ${
                            info.validation.confidence >= 0.7 ? 'bg-green-100 text-green-800' :
                            info.validation.confidence >= 0.6 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {(info.validation.confidence * 100).toFixed(0)}% confidence
                          </span>
                        )}
                      </div>
                      
                      {/* Podcast Artwork and Info */}
                      <div className="flex items-start space-x-4 mb-3">
                        {/* Podcast Thumbnail */}
                        {info.validation?.validatedPodcast?.artworkUrl && (
                          <div className="flex-shrink-0">
                            <img
                              src={info.validation.validatedPodcast.artworkUrl}
                              alt={`${info.validation.validatedPodcast.title} artwork`}
                              className="w-16 h-16 rounded-lg shadow-sm object-cover"
                              onError={(e) => {
                                // Hide image if it fails to load
                                e.target.style.display = 'none';
                              }}
                            />
                          </div>
                        )}
                        
                        {/* Podcast Details */}
                        <div className="flex-1 min-w-0">
                          <div className="space-y-2 text-sm">
                            <div>
                              <span className="font-medium text-gray-700">Podcast:</span>
                              <span className="ml-2 text-gray-600">
                                {info.secondPass?.podcastTitle || 
                                  <span className="italic text-gray-400">Not found</span>
                                }
                              </span>
                              {info.validation?.validatedPodcast?.confidence && (
                                <span className="ml-2 text-xs text-blue-600">
                                  ({(info.validation.validatedPodcast.confidence * 100).toFixed(0)}%)
                                </span>
                              )}
                            </div>
                            <div>
                              <span className="font-medium text-gray-700">Episode:</span>
                              <span className="ml-2 text-gray-600">
                                {info.secondPass?.episodeTitle || 
                                  <span className="italic text-gray-400">Not found</span>
                                }
                              </span>
                              {info.validation?.validatedEpisode?.confidence && (
                                <span className="ml-2 text-xs text-blue-600">
                                  ({(info.validation.validatedEpisode.confidence * 100).toFixed(0)}%)
                                </span>
                              )}
                            </div>
                            <div>
                              <span className="font-medium text-gray-700">Timestamp:</span>
                              <span className="ml-2 text-gray-600">
                                {info.secondPass?.timestamp || 
                                  <span className="italic text-gray-400">Not found</span>
                                }
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Episode Match Warnings */}
                      {info.validation?.partialMatch && (
                        <div className="mt-1 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                          <div className="flex items-center">
                            <span className="text-blue-600 mr-1">ℹ️</span>
                            <span className="font-medium text-blue-800">Partial Match:</span>
                          </div>
                          <div className="text-blue-700 mt-1">
                            {info.validation.partialMatchReason}
                          </div>
                          <div className="text-blue-600 mt-1 text-xs">
                            The extracted title appears to be truncated due to UI space constraints.
                          </div>
                        </div>
                      )}
                      {info.validation?.episodeMismatch && (
                        <div className="mt-1 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                          <div className="flex items-center">
                            <span className="text-yellow-600 mr-1">⚠️</span>
                            <span className="font-medium text-yellow-800">Episode Mismatch:</span>
                          </div>
                          <div className="text-yellow-700 mt-1">
                            {info.validation.episodeMismatchReason}
                          </div>
                          <div className="text-yellow-600 mt-1 text-xs">
                            The episode title may be from a different podcast or show.
                          </div>
                        </div>
                      )}
                      
                      {/* Validation Status */}
                      <div className="mt-3 pt-2 border-t border-blue-200">
                        <span className="text-xs text-gray-600">Status: </span>
                        <span className={`text-xs font-medium ${
                          info.secondPass?.player === 'validated' ? 'text-green-700' :
                          info.secondPass?.player === 'validated_fallback' ? 'text-green-700' :
                          info.secondPass?.player === 'partially_validated' ? 'text-yellow-700' :
                          'text-red-700'
                        }`}>
                          {info.secondPass?.player === 'validated' ? 'Validated' :
                           info.secondPass?.player === 'validated_fallback' ? 'Validated (Fallback)' :
                           info.secondPass?.player === 'partially_validated' ? 'Partially Validated' :
                           'Unvalidated'}
                        </span>
                        {info.validation?.fallbackSource && (
                          <div className="mt-1">
                            <span className="text-xs text-gray-500">
                              Fallback method: {info.validation.fallbackSource}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Get Transcript Button */}
                  {info.validation?.validated && info.secondPass?.timestamp && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex items-center justify-between">
                        <h5 className="text-sm font-medium text-gray-900">Audio Transcript</h5>
                        {!transcripts[idx] && (
                          <button
                            onClick={() => handleGetTranscript(info, idx)}
                            disabled={isGettingTranscript}
                            className={`px-4 py-2 rounded-md text-sm font-medium ${
                              isGettingTranscript
                                ? 'bg-gray-400 text-white cursor-not-allowed'
                                : 'bg-green-600 text-white hover:bg-green-700'
                            }`}
                          >
                            {isGettingTranscript ? 'Getting Transcript...' : 'Get Transcript'}
                          </button>
                        )}
                      </div>
                      
                      {/* Transcript Results */}
                      {transcripts[idx] && (
                        <div className="mt-3">
                          <TextSelection transcript={transcripts[idx]} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Suggestions */}
                  {info.validation?.suggestions && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <h5 className="text-sm font-medium text-gray-900 mb-2">Suggestions:</h5>
                      <div className="grid md:grid-cols-2 gap-4 text-xs">
                        {info.validation.suggestions.alternativePodcasts?.length > 0 && (
                          <div>
                            <span className="font-medium text-gray-700">Alternative Podcasts:</span>
                            <ul className="mt-1 space-y-2">
                              {info.validation.suggestions.alternativePodcasts.map((alt, i) => (
                                <li key={i} className="flex items-center space-x-2 text-gray-600">
                                  {alt.artworkUrl && (
                                    <img
                                      src={alt.artworkUrl}
                                      alt={`${alt.title} artwork`}
                                      className="w-8 h-8 rounded object-cover flex-shrink-0"
                                      onError={(e) => {
                                        e.target.style.display = 'none';
                                      }}
                                    />
                                  )}
                                  <span className="flex-1 min-w-0">
                                    • {alt.title} ({(alt.confidence * 100).toFixed(0)}%)
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {info.validation.suggestions.alternativeEpisodes?.length > 0 && (
                          <div>
                            <span className="font-medium text-gray-700">Alternative Episodes:</span>
                            <ul className="mt-1 space-y-2">
                              {info.validation.suggestions.alternativeEpisodes.map((alt, i) => (
                                <li key={i} className="flex items-center space-x-2 text-gray-600">
                                  {alt.artworkUrl && (
                                    <img
                                      src={alt.artworkUrl}
                                      alt={`${alt.title} artwork`}
                                      className="w-8 h-8 rounded object-cover flex-shrink-0"
                                      onError={(e) => {
                                        e.target.style.display = 'none';
                                      }}
                                    />
                                  )}
                                  <span className="flex-1 min-w-0">
                                    • {alt.title} ({(alt.confidence * 100).toFixed(0)}%)
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PodcastScreenshotProcessor; 