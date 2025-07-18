import React, { useState, useEffect } from "react";
import MainContent from "./MainContent";
import TranscriptHighlighting from "./TranscriptHighlighting";

const TimeRangeSelection = ({
  screenshots,
  onAddScreenshots,
  onGenerateTranscript,
  isProcessing = false
}) => {
  const [showTranscript, setShowTranscript] = useState(false);
  const [episodes, setEpisodes] = useState([]);
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingStage, setProcessingStage] = useState("Processing...");
  const [localIsProcessing, setLocalIsProcessing] = useState(false);

  // Progress simulation based on typical transcript generation flow
  const simulateProgress = () => {
    const stages = [
      // Getting audio clip
      { stage: "Getting audio clip...", progress: 5, duration: 200 },
      { stage: "Getting audio clip...", progress: 10, duration: 300 },
      { stage: "Getting audio clip...", progress: 18, duration: 400 },
      { stage: "Getting audio clip...", progress: 25, duration: 500 },
      { stage: "Getting audio clip...", progress: 32, duration: 400 },
      { stage: "Getting audio clip...", progress: 35, duration: 300 },
      
      // Generating transcript
      { stage: "Generating transcript...", progress: 40, duration: 300 },
      { stage: "Generating transcript...", progress: 45, duration: 500 },
      { stage: "Generating transcript...", progress: 50, duration: 600 },
      { stage: "Generating transcript...", progress: 55, duration: 700 },
      { stage: "Generating transcript...", progress: 60, duration: 800 },
      { stage: "Generating transcript...", progress: 65, duration: 600 },
      { stage: "Generating transcript...", progress: 70, duration: 500 },
      { stage: "Generating transcript...", progress: 75, duration: 400 },
      { stage: "Generating transcript...", progress: 80, duration: 300 },
      
      // Finalizing
      { stage: "Finalizing...", progress: 85, duration: 300 },
      { stage: "Finalizing...", progress: 90, duration: 400 },
      { stage: "Finalizing...", progress: 95, duration: 500 },
      { stage: "Finalizing...", progress: 98, duration: 300 },
      { stage: "Finalizing...", progress: 100, duration: 200 }
    ];

    let currentStageIndex = 0;
    
    const updateStage = () => {
      if (currentStageIndex < stages.length) {
        const currentStage = stages[currentStageIndex];
        setProcessingStage(currentStage.stage);
        setProcessingProgress(currentStage.progress);
        
        setTimeout(() => {
          currentStageIndex++;
          updateStage();
        }, currentStage.duration);
      }
    };

    updateStage();
  };

  const handleGenerateTranscript = async (selectedRange) => {
    setLocalIsProcessing(true);
    setProcessingProgress(0);
    setProcessingStage("Starting...");
    
    // Start progress simulation
    simulateProgress();

    try {
      // Call the original onGenerateTranscript function
      if (onGenerateTranscript) {
        const result = await onGenerateTranscript(selectedRange);
        
        // Handle multiple episodes if returned
        if (result && result.episodes && result.episodes.length > 0) {
          setEpisodes(result.episodes);
          setCurrentEpisodeIndex(0);
          setShowTranscript(true);
        }
        // Handle single episode (backward compatibility)
        else if (result && result.transcript) {
          const transcriptData = {
            transcript: result.transcript,
            episodeTitle: result.episodeTitle || screenshots[0]?.podcastInfo?.episodeTitle || "Episode name",
            timestamp: `${selectedRange.start}s to ${selectedRange.end}s`,
            podcastArtwork: result.podcastArtwork || screenshots[0]?.podcastInfo?.podcastArtwork || screenshots[0]?.preview,
            originalTimestamp: result.originalTimestamp || screenshots[0]?.podcastInfo?.timestamp || "0:00",
            selectedRange: selectedRange
          };
          
          setEpisodes([transcriptData]);
          setCurrentEpisodeIndex(0);
          setShowTranscript(true);
        }
      }
    } catch (error) {
      console.error('Error generating transcript:', error);
      // Reset progress on error
      setProcessingProgress(0);
      setProcessingStage("Error occurred");
    } finally {
      setLocalIsProcessing(false);
    }
  };

  const handleBackToSelection = () => {
    setShowTranscript(false);
    setEpisodes([]);
    setCurrentEpisodeIndex(0);
    setProcessingProgress(0);
    setProcessingStage("Processing...");
  };

  const handleDone = () => {
    // Handle done action - could navigate back to main screen
    setShowTranscript(false);
    setEpisodes([]);
    setCurrentEpisodeIndex(0);
    setProcessingProgress(0);
    setProcessingStage("Processing...");
  };

  const handleExportSnippets = () => {
    // Handle export snippets action
    console.log('Exporting snippets...');
  };

  const handleEpisodeChange = (newIndex) => {
    setCurrentEpisodeIndex(newIndex);
  };

  // Scroll to top when component mounts or when switching screens
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [showTranscript]);

  if (showTranscript && episodes.length > 0) {
    return (
      <div className="w-full max-w-[393px] mx-auto">
        <TranscriptHighlighting
          episodes={episodes}
          currentEpisodeIndex={currentEpisodeIndex}
          onEpisodeChange={handleEpisodeChange}
          onBack={handleBackToSelection}
          onDone={handleDone}
          onExportSnippets={handleExportSnippets}
        />
      </div>
    );
  }
      
  return (
    <div className="w-full max-w-[393px] mx-auto">
      {/* Main Content - Remove browser chrome */}
      <MainContent 
        screenshots={screenshots}
        onAddScreenshots={onAddScreenshots}
        onGenerateTranscript={handleGenerateTranscript}
        isProcessing={localIsProcessing || isProcessing}
        processingProgress={processingProgress}
        processingStage={processingStage}
      />
    </div>
  );
};

export default TimeRangeSelection; 