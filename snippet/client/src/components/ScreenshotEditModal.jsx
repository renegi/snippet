import React, { useState, useEffect, useRef } from 'react';
import { XMarkIcon, TrashIcon } from '@heroicons/react/24/outline';

const ScreenshotEditModal = ({ 
  isOpen, 
  onClose, 
  screenshotData, 
  onUpdate, 
  onDelete 
}) => {
  const [selectedPodcast, setSelectedPodcast] = useState(null);
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const [selectedTimestamp, setSelectedTimestamp] = useState('');
  const [podcastSearchTerm, setPodcastSearchTerm] = useState('');
  const [episodeSearchTerm, setEpisodeSearchTerm] = useState('');
  const [podcastOptions, setPodcastOptions] = useState([]);
  const [episodeOptions, setEpisodeOptions] = useState([]);
  const [isLoadingPodcasts, setIsLoadingPodcasts] = useState(false);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);
  const [showPodcastDropdown, setShowPodcastDropdown] = useState(false);
  const [showEpisodeDropdown, setShowEpisodeDropdown] = useState(false);
  
  const podcastSearchTimeoutRef = useRef(null);
  const episodeSearchTimeoutRef = useRef(null);

  // Initialize form with existing data
  useEffect(() => {
    if (screenshotData) {
      setSelectedPodcast(screenshotData.validation?.validatedPodcast || null);
      setSelectedEpisode(screenshotData.validation?.validatedEpisode || null);
      setSelectedTimestamp(screenshotData.secondPass?.timestamp || screenshotData.firstPass?.timestamp || '');
      setPodcastSearchTerm(screenshotData.secondPass?.podcastTitle || screenshotData.firstPass?.podcastTitle || '');
      setEpisodeSearchTerm(screenshotData.secondPass?.episodeTitle || screenshotData.firstPass?.episodeTitle || '');
    }
  }, [screenshotData]);

  // Search podcasts with debouncing
  useEffect(() => {
    if (podcastSearchTimeoutRef.current) {
      clearTimeout(podcastSearchTimeoutRef.current);
    }

    if (podcastSearchTerm.length < 2) {
      setPodcastOptions([]);
      setShowPodcastDropdown(false);
      return;
    }

    podcastSearchTimeoutRef.current = setTimeout(async () => {
      setIsLoadingPodcasts(true);
      try {
        const response = await fetch('/api/search-podcasts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ searchTerm: podcastSearchTerm })
        });
        
        if (response.ok) {
          const data = await response.json();
          setPodcastOptions(data.podcasts || []);
          setShowPodcastDropdown(true);
        }
      } catch (error) {
        console.error('Error searching podcasts:', error);
      } finally {
        setIsLoadingPodcasts(false);
      }
    }, 1000);

    return () => {
      if (podcastSearchTimeoutRef.current) {
        clearTimeout(podcastSearchTimeoutRef.current);
      }
    };
  }, [podcastSearchTerm]);

  // Search episodes when podcast is selected
  useEffect(() => {
    if (episodeSearchTimeoutRef.current) {
      clearTimeout(episodeSearchTimeoutRef.current);
    }

    if (!selectedPodcast || episodeSearchTerm.length < 2) {
      setEpisodeOptions([]);
      setShowEpisodeDropdown(false);
      return;
    }

    episodeSearchTimeoutRef.current = setTimeout(async () => {
      setIsLoadingEpisodes(true);
      try {
        const response = await fetch('/api/search-episodes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            podcastId: selectedPodcast.id,
            searchTerm: episodeSearchTerm 
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          setEpisodeOptions(data.episodes || []);
          setShowEpisodeDropdown(true);
        }
      } catch (error) {
        console.error('Error searching episodes:', error);
      } finally {
        setIsLoadingEpisodes(false);
      }
    }, 1000);

    return () => {
      if (episodeSearchTimeoutRef.current) {
        clearTimeout(episodeSearchTimeoutRef.current);
      }
    };
  }, [selectedPodcast, episodeSearchTerm]);

  const handlePodcastSelect = (podcast) => {
    setSelectedPodcast(podcast);
    setPodcastSearchTerm(podcast.title);
    setShowPodcastDropdown(false);
    setEpisodeSearchTerm('');
    setSelectedEpisode(null);
    setEpisodeOptions([]);
  };

  const handleEpisodeSelect = (episode) => {
    setSelectedEpisode(episode);
    setEpisodeSearchTerm(episode.title);
    setShowEpisodeDropdown(false);
  };

  const handleUpdate = () => {
    onUpdate({
      podcast: selectedPodcast,
      episode: selectedEpisode,
      timestamp: selectedTimestamp
    });
    onClose();
  };

  const handleDelete = () => {
    onDelete();
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  // Extract timestamp candidates from the screenshot data
  const timestampCandidates = [];
  if (screenshotData?.firstPass?.timestamp) {
    timestampCandidates.push(screenshotData.firstPass.timestamp);
  }
  if (screenshotData?.secondPass?.timestamp && 
      screenshotData.secondPass.timestamp !== screenshotData.firstPass?.timestamp) {
    timestampCandidates.push(screenshotData.secondPass.timestamp);
  }

  if (!isOpen) return null;

  return (
    <>
      {/* Scrim */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
        <div className="w-full max-w-md bg-white rounded-t-lg sm:rounded-lg shadow-xl transform transition-all duration-300 ease-out">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Edit Screenshot</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-6 max-h-[70vh] overflow-y-auto">
            {/* Screenshot Thumbnail */}
            {screenshotData?.preview && (
              <div className="flex justify-center">
                <img
                  src={screenshotData.preview}
                  alt="Screenshot"
                  className="w-32 h-32 object-cover rounded-lg shadow-sm"
                />
              </div>
            )}

            {/* Podcast Selection */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Podcast Name *
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={podcastSearchTerm}
                  onChange={(e) => setPodcastSearchTerm(e.target.value)}
                  placeholder="Search for a podcast..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {isLoadingPodcasts && (
                  <div className="absolute right-3 top-2.5">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  </div>
                )}
              </div>
              
              {/* Podcast Dropdown */}
              {showPodcastDropdown && podcastOptions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                  {podcastOptions.map((podcast) => (
                    <button
                      key={podcast.id}
                      onClick={() => handlePodcastSelect(podcast)}
                      className="w-full px-3 py-2 text-left hover:bg-gray-100 flex items-center space-x-3"
                    >
                      {podcast.artworkUrl && (
                        <img
                          src={podcast.artworkUrl}
                          alt=""
                          className="w-8 h-8 rounded object-cover"
                        />
                      )}
                      <div>
                        <div className="font-medium text-gray-900">{podcast.title}</div>
                        <div className="text-sm text-gray-500">{podcast.artistName}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Episode Selection */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Episode Name *
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={episodeSearchTerm}
                  onChange={(e) => setEpisodeSearchTerm(e.target.value)}
                  placeholder={selectedPodcast ? "Search for an episode..." : "Select a podcast first"}
                  disabled={!selectedPodcast}
                  className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    !selectedPodcast ? 'bg-gray-100 cursor-not-allowed' : ''
                  }`}
                />
                {isLoadingEpisodes && (
                  <div className="absolute right-3 top-2.5">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  </div>
                )}
              </div>
              
              {/* Episode Dropdown */}
              {showEpisodeDropdown && episodeOptions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                  {episodeOptions.map((episode) => (
                    <button
                      key={episode.id}
                      onClick={() => handleEpisodeSelect(episode)}
                      className="w-full px-3 py-2 text-left hover:bg-gray-100 flex items-center space-x-3"
                    >
                      {episode.artworkUrl && (
                        <img
                          src={episode.artworkUrl}
                          alt=""
                          className="w-8 h-8 rounded object-cover"
                        />
                      )}
                      <div>
                        <div className="font-medium text-gray-900">{episode.title}</div>
                        <div className="text-sm text-gray-500">{episode.releaseDate}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Timestamp Selection */}
            {timestampCandidates.length > 0 && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Timestamp
                </label>
                <div className="flex flex-wrap gap-2">
                  {timestampCandidates.map((timestamp, index) => (
                    <button
                      key={index}
                      onClick={() => setSelectedTimestamp(timestamp)}
                      className={`px-3 py-1 text-sm rounded-full border ${
                        selectedTimestamp === timestamp
                          ? 'bg-blue-100 border-blue-500 text-blue-700'
                          : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {timestamp}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Delete Button */}
            <div className="pt-4 border-t border-gray-200">
              <button
                onClick={handleDelete}
                className="w-full flex items-center justify-center px-4 py-2 border border-red-600 text-red-600 rounded-md hover:bg-red-50 transition-colors"
              >
                <TrashIcon className="h-4 w-4 mr-2" />
                Delete Screenshot
              </button>
            </div>
          </div>

          {/* Floating Footer */}
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-50">
            <div className="flex space-x-3 max-w-md mx-auto">
              <button
                onClick={handleCancel}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdate}
                disabled={!selectedPodcast || !selectedEpisode}
                className={`flex-1 px-4 py-2 rounded-md text-white transition-colors ${
                  selectedPodcast && selectedEpisode
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-gray-400 cursor-not-allowed'
                }`}
              >
                Update
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default ScreenshotEditModal; 