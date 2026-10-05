import React, { useState, useEffect } from 'react';
import { XMarkIcon, CheckIcon } from '@heroicons/react/24/outline';
import PrimaryButtonL from './PrimaryButtonL';

const formatDate = (releaseDate) => {
  if (!releaseDate) return '';
  const date = new Date(releaseDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

// Episode length in ms → "1h 52m" or "27m"
const formatDuration = (milliseconds) => {
  if (!milliseconds) return '';
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

// Shown when the episode couldn't be identified for certain: the user picks from the
// likeliest episodes (screenshotData.validation.suggestions), with the screenshot on top to
// compare against.
const EpisodePickerModal = ({
  isOpen,
  onClose,
  screenshotData,
  onConfirm,
  onSearchManually
}) => {
  const [selectedIndex, setSelectedIndex] = useState(null);

  const suggestions = screenshotData?.validation?.suggestions || [];
  const currentEpisode = screenshotData?.validation?.validatedEpisode;

  // Start on the app's own guess when it made one; otherwise nothing is selected
  useEffect(() => {
    if (!isOpen) return;
    const guess = currentEpisode
      ? suggestions.findIndex(option => option.episode.title === currentEpisode.title)
      : -1;
    setSelectedIndex(guess >= 0 ? guess : null);
  }, [isOpen, screenshotData]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    const option = suggestions[selectedIndex];
    if (!option) return;
    onConfirm({ podcast: option.podcast, episode: option.episode });
    onClose();
  };

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
            <h2 className="text-xl font-semibold text-[#1B1B1B] font-['Termina']">Which episode is this?</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-[#1B1B1B] hover:text-gray-600 p-2 rounded-full hover:bg-[#E4E0D2] transition-colors"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Screenshot, large enough to read the title on it */}
            {screenshotData?.preview && (
              <div className="flex justify-center">
                <div className="h-56 bg-[#EEEBE2] rounded-[24px] flex items-center justify-center overflow-hidden">
                  <img
                    src={screenshotData.preview}
                    alt="Your screenshot"
                    className="h-full w-auto object-contain"
                  />
                </div>
              </div>
            )}

            <p className="text-sm text-[#1B1B1B] font-['Termina'] leading-[130%]">
              We couldn't tell for sure. Pick the episode that matches your screenshot.
            </p>

            {/* Episode cards */}
            <div className="flex flex-col gap-3" role="radiogroup" aria-label="Episodes">
              {suggestions.map((option, index) => {
                const isSelected = index === selectedIndex;
                const details = [formatDate(option.episode.releaseDate), formatDuration(option.episode.duration)]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <button
                    key={`${option.podcast.id}-${option.episode.id || option.episode.title}`}
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelectedIndex(index)}
                    className={`w-full flex flex-row items-center justify-start gap-3 p-3 rounded-[16px] text-left text-sm text-[#1B1B1B] font-['Termina'] transition-colors border-2 ${
                      isSelected
                        ? 'bg-white border-[#1B1B1B]'
                        : 'bg-white border-transparent hover:bg-[#E4E0D2]'
                    }`}
                  >
                    {(option.episode.artworkUrl || option.podcast.artworkUrl) && (
                      <img
                        className="w-14 h-14 rounded-xl overflow-hidden shrink-0 object-cover"
                        alt=""
                        src={option.episode.artworkUrl || option.podcast.artworkUrl}
                      />
                    )}
                    <div className="flex-1 min-w-0 flex flex-col items-start justify-start gap-1">
                      <b
                        className="leading-[130%] overflow-hidden"
                        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                      >
                        {option.episode.title}
                      </b>
                      <div className="w-full text-xs leading-[130%] font-medium truncate">
                        {option.podcast.title}
                      </div>
                      {details && (
                        <div className="w-full text-xs leading-[130%] text-gray-500 truncate">{details}</div>
                      )}
                    </div>
                    <div
                      className={`w-6 h-6 shrink-0 rounded-full border-2 flex items-center justify-center ${
                        isSelected ? 'bg-[#1B1B1B] border-[#1B1B1B]' : 'border-[#DDDAD1]'
                      }`}
                    >
                      {isSelected && <CheckIcon className="h-4 w-4 text-white" strokeWidth={3} />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Floating Footer */}
          <div className="bg-[#F6F4EE] border-t border-[#DDDAD1] p-6 flex gap-4">
            <button
              onClick={onSearchManually}
              className="flex-1 h-16 rounded-[24px] bg-[#DDDAD1] transition-colors overflow-hidden flex flex-row items-center justify-center py-[18px] px-3 box-border text-center text-base text-[#1B1B1B] font-['Termina']"
            >
              <b className="relative leading-[130%] whitespace-nowrap">None of these</b>
            </button>

            <PrimaryButtonL
              onClick={handleConfirm}
              disabled={selectedIndex === null}
              className="flex-1"
            >
              Confirm
            </PrimaryButtonL>
          </div>
        </div>
      </div>
    </>
  );
};

export default EpisodePickerModal;
