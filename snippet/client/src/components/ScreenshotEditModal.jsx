import React, { useState, useEffect, useRef } from 'react';
import { XMarkIcon, TrashIcon } from '@heroicons/react/24/outline';
import PrimaryButtonL from './PrimaryButtonL';

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
    if (isOpen && screenshotData) {
      console.log('Initializing modal with data:', screenshotData);
      
      const podcast = screenshotData.validation?.validatedPodcast || null;
      const episode = screenshotData.validation?.validatedEpisode || null;
      const timestamp = screenshotData.timestamp || screenshotData.secondPass?.timestamp || screenshotData.firstPass?.timestamp || '';
      const podcastTitle = screenshotData.podcastTitle || screenshotData.secondPass?.podcastTitle || screenshotData.firstPass?.podcastTitle || '';
      const episodeTitle = screenshotData.episodeTitle || screenshotData.secondPass?.episodeTitle || screenshotData.firstPass?.episodeTitle || '';
      
      console.log('Setting form data:', { podcast, episode, timestamp, podcastTitle, episodeTitle });
      
      setSelectedPodcast(podcast);
      setSelectedEpisode(episode);
      setSelectedTimestamp(timestamp);
      setPodcastSearchTerm(podcastTitle);
      setEpisodeSearchTerm(episodeTitle);
      
      // Close dropdowns when data is prefilled
      setShowPodcastDropdown(false);
      setShowEpisodeDropdown(false);
    }
  }, [isOpen, screenshotData]);

  // Search podcasts with debouncing
  useEffect(() => {
    if (podcastSearchTimeoutRef.current) {
      clearTimeout(podcastSearchTimeoutRef.current);
    }

    // Don't search if we're just setting initial values or if modal is not open
    if (podcastSearchTerm.length < 2 || !isOpen) {
      setPodcastOptions([]);
      setShowPodcastDropdown(false);
      return;
    }

    // Don't search if the search term matches the selected podcast title (prevents auto-opening)
    if (selectedPodcast && podcastSearchTerm === selectedPodcast.title) {
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
  }, [podcastSearchTerm, isOpen, selectedPodcast]);

  // Search episodes when podcast is selected
  useEffect(() => {
    if (episodeSearchTimeoutRef.current) {
      clearTimeout(episodeSearchTimeoutRef.current);
    }

    // Don't search if we're just setting initial values or if modal is not open
    if (!selectedPodcast || episodeSearchTerm.length < 2 || !isOpen) {
      setEpisodeOptions([]);
      setShowEpisodeDropdown(false);
      return;
    }

    // Don't search if the search term matches the selected episode title (prevents auto-opening)
    if (selectedEpisode && episodeSearchTerm === selectedEpisode.title) {
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
  }, [selectedPodcast, episodeSearchTerm, isOpen, selectedEpisode]);

  const handlePodcastSelect = (podcast) => {
    setSelectedPodcast(podcast);
    setPodcastSearchTerm(podcast.title);
    setShowPodcastDropdown(false);
    setEpisodeSearchTerm('');
    setSelectedEpisode(null);
    setEpisodeOptions([]);
    setShowEpisodeDropdown(false);
  };

  const handleEpisodeSelect = (episode) => {
    setSelectedEpisode(episode);
    setEpisodeSearchTerm(episode.title);
    setShowEpisodeDropdown(false);
  };

  const handleUpdate = () => {
    console.log('handleUpdate called with:', {
      podcast: selectedPodcast,
      episode: selectedEpisode,
      timestamp: selectedTimestamp
    });
    
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
  
  // Add any additional timestamps found in the data
  if (screenshotData?.timestamp && !timestampCandidates.includes(screenshotData.timestamp)) {
    timestampCandidates.push(screenshotData.timestamp);
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
      <div className="fixed inset-0 z-50 flex items-end justify-center">
        <div className="w-full h-[90vh] bg-[#F6F4EE] rounded-t-[24px] shadow-xl transform transition-all duration-300 ease-out flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-[#DDDAD1]">
            <h2 className="text-xl font-semibold text-[#1B1B1B] font-['Termina']">Edit screenshot</h2>
            <button
              onClick={onClose}
              className="text-[#1B1B1B] hover:text-gray-600 p-2 rounded-full hover:bg-[#E4E0D2] transition-colors"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Screenshot Thumbnail */}
            {screenshotData?.preview && (
              <div className="flex justify-center">
                <div className="w-32 h-32 bg-[#EEEBE2] rounded-[24px] flex items-center justify-center overflow-hidden">
                  <img
                    src={screenshotData.preview}
                    alt="Screenshot"
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>
            )}

            {/* Podcast Selection */}
            <div className="space-y-3">
              <label className="block text-base font-medium text-[#1B1B1B] font-['Termina']">
                Podcast Name
              </label>
              <div className="relative">
                <div className="relative">
                  <input
                    type="text"
                    value={podcastSearchTerm}
                    onChange={(e) => setPodcastSearchTerm(e.target.value)}
                    placeholder="Search for a podcast..."
                    className="w-full px-4 py-3 pr-12 border border-[#DDDAD1] rounded-[16px] focus:outline-none focus:ring-2 focus:ring-[#1B1B1B] focus:border-[#1B1B1B] bg-white text-[#1B1B1B] font-['Termina']"
                  />
                  {selectedPodcast?.artworkUrl && (
                    <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
                      <img
                        src={selectedPodcast.artworkUrl}
                        alt=""
                        className="w-8 h-8 rounded-[8px] object-cover"
                      />
                    </div>
                  )}
                  {isLoadingPodcasts && (
                    <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#1B1B1B]"></div>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Podcast Dropdown */}
              {showPodcastDropdown && podcastOptions.length > 0 && (
                <div className="absolute z-10 w-full mt-2 bg-white border border-[#DDDAD1] rounded-[16px] shadow-lg max-h-60 overflow-auto" style={{ width: '100%', maxWidth: '100%' }}>
                  {podcastOptions.map((podcast) => (
                    <button
                      key={podcast.id}
                      onClick={() => handlePodcastSelect(podcast)}
                      className="w-full px-4 py-3 text-left hover:bg-[#E4E0D2] flex items-center space-x-3 transition-colors"
                    >
                      {podcast.artworkUrl && (
                        <img
                          src={podcast.artworkUrl}
                          alt=""
                          className="w-10 h-10 rounded-[12px] object-cover"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-[#1B1B1B] font-['Termina'] truncate">{podcast.title}</div>
                        <div className="text-sm text-gray-500 font-['Termina'] truncate">{podcast.artistName}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Episode Selection */}
            <div className="space-y-3">
              <label className="block text-base font-medium text-[#1B1B1B] font-['Termina']">
                Episode Name
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={episodeSearchTerm}
                  onChange={(e) => setEpisodeSearchTerm(e.target.value)}
                  placeholder={selectedPodcast ? "Search for an episode..." : "Select a podcast first"}
                  disabled={!selectedPodcast}
                  className={`w-full px-4 py-3 border border-[#DDDAD1] rounded-[16px] focus:outline-none focus:ring-2 focus:ring-[#1B1B1B] focus:border-[#1B1B1B] bg-white text-[#1B1B1B] font-['Termina'] ${
                    !selectedPodcast ? 'bg-[#E4E0D2] cursor-not-allowed opacity-50' : ''
                  }`}
                />
                {isLoadingEpisodes && (
                  <div className="absolute right-4 top-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#1B1B1B]"></div>
                  </div>
                )}
              </div>
              
              {/* Episode Dropdown */}
              {showEpisodeDropdown && episodeOptions.length > 0 && (
                <div className="absolute z-10 w-full mt-2 bg-white border border-[#DDDAD1] rounded-[16px] shadow-lg max-h-60 overflow-auto" style={{ width: '100%', maxWidth: '100%' }}>
                  {episodeOptions.map((episode) => (
                    <button
                      key={episode.id}
                      onClick={() => handleEpisodeSelect(episode)}
                      className="w-full px-4 py-3 text-left hover:bg-[#E4E0D2] flex items-center space-x-3 transition-colors"
                    >
                      {episode.artworkUrl && (
                        <img
                          src={episode.artworkUrl}
                          alt=""
                          className="w-10 h-10 rounded-[12px] object-cover"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-[#1B1B1B] font-['Termina'] truncate">{episode.title}</div>
                        <div className="text-sm text-gray-500 font-['Termina'] truncate">{episode.releaseDate}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Timestamp Selection */}
            <div className="space-y-3">
              <label className="block text-base font-medium text-[#1B1B1B] font-['Termina']">
                Timestamp
              </label>
              {timestampCandidates.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {timestampCandidates.map((timestamp, index) => (
                    <button
                      key={index}
                      onClick={() => setSelectedTimestamp(timestamp)}
                      className={`px-4 py-2 text-sm rounded-[12px] border transition-colors font-['Termina'] ${
                        selectedTimestamp === timestamp
                          ? 'bg-[#1B1B1B] border-[#1B1B1B] text-white'
                          : 'bg-white border-[#DDDAD1] text-[#1B1B1B] hover:bg-[#E4E0D2]'
                      }`}
                    >
                      {timestamp}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500 font-['Termina']">
                  No timestamps detected
                </div>
              )}
            </div>

            {/* Delete Button */}
            <div className="pt-6 border-t border-[#DDDAD1]">
              <button
                onClick={handleDelete}
                className="w-full flex items-center justify-center px-4 py-3 border border-[#BE3E37] text-[#BE3E37] rounded-[16px] hover:bg-[#BE3E37] hover:text-white transition-colors font-['Termina']"
              >
                <TrashIcon className="h-5 w-5 mr-2" />
                Delete Screenshot
              </button>
            </div>
          </div>

          {/* Floating Footer */}
          <div className="bg-[#F6F4EE] border-t border-[#DDDAD1] p-6 flex gap-4">
            <button
              onClick={handleCancel}
              className="flex-1 h-16 rounded-[24px] bg-[#DDDAD1] transition-colors overflow-hidden flex flex-row items-center justify-center py-[18px] px-6 box-border text-left text-lg text-[#1B1B1B] font-['Termina']"
            >
              <b className="relative leading-[130%]">Cancel</b>
            </button>
            
            <PrimaryButtonL
              onClick={handleUpdate}
              disabled={!selectedPodcast || !selectedEpisode}
              className="flex-1"
            >
              Update
            </PrimaryButtonL>
          </div>
        </div>
      </div>
    </>
  );
};

export default ScreenshotEditModal; 