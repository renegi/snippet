# Snippet

A web application that extracts podcast and episode information from screenshots and generates transcripts for selected time ranges.

## Overview

Snippet uses OCR (Optical Character Recognition) to detect podcast and episode titles from mobile screenshots, validates them against the Apple Podcasts API, and generates transcripts for user-selected time ranges. The app is optimized for Apple Podcasts, Spotify, and native iOS player screenshots.

## Features

- **Screenshot Processing**: Upload multiple podcast screenshots for batch processing
- **OCR Text Detection**: Advanced text extraction with spatial filtering and fuzzy matching
- **Podcast Validation**: Two-phase fuzzy search against Apple Podcasts API
- **Episode Matching**: Intelligent episode title matching with fallback strategies
- **Transcript Generation**: Generate transcripts for specific time ranges using AssemblyAI
- **Text Highlighting**: Interactive transcript highlighting and snippet extraction
- **Cross-Pair Testing**: Advanced validation that reuses successfully validated podcasts
- **Mobile-Optimized UI**: Responsive design optimized for mobile devices

## Architecture

### Frontend (React)
- **Location**: `snippet/client/`
- **Key Components**:
  - `PodcastScreenshotProcessor`: Main screenshot processing interface
  - `TimeRangeSelection`: Time range selection and transcript generation
  - `TranscriptHighlighting`: Interactive transcript highlighting
  - `ScreenshotEditModal`: Manual podcast/episode editing

### Backend (Node.js/Express)
- **Location**: `snippet/server/`
- **Key Services**:
  - `VisionService`: Google Vision API integration for OCR
  - `ApplePodcastsService`: Apple Podcasts API integration
  - `AssemblyService`: AssemblyAI integration for transcript generation

## Setup

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- Google Cloud Vision API credentials
- Apple Podcasts API access
- AssemblyAI API key

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd snippet
   ```

2. **Install dependencies**
   ```bash
   # Install server dependencies
   cd server
   npm install
   
   # Install client dependencies
   cd ../client
   npm install
   ```

3. **Environment Variables**
   
   Create `.env` files in the server directory with:
   ```env
   # Google Cloud Vision API
   GOOGLE_APPLICATION_CREDENTIALS=path/to/credentials.json
   
   # AssemblyAI
   ASSEMBLYAI_API_KEY=your_assemblyai_api_key
   
   # Server configuration
   PORT=3001
   NODE_ENV=development
   ```

4. **Start the application**
   ```bash
   # Start server (from server directory)
   npm start
   
   # Start client (from client directory)
   npm start
   ```

## Usage

1. **Upload Screenshots**: Select one or more podcast screenshots from your device
2. **Automatic Processing**: The app will automatically detect and validate podcast/episode information
3. **Manual Editing**: Edit any incorrect detections using the edit modal
4. **Time Range Selection**: Set the time range around your desired quote
5. **Generate Transcript**: Generate a transcript for the selected time range
6. **Highlight Text**: Select and highlight relevant text in the transcript
7. **Export Snippets**: Copy highlighted snippets with proper attribution

## Technical Details

### OCR Processing
- Uses Google Vision API for text detection
- Implements spatial filtering to focus on relevant screen areas
- Applies height-based text grouping to prevent combining unrelated text
- Special handling for punctuation marks and colons

### Fuzzy Search
- Two-phase podcast search with cleaned text and middle words
- Episode matching with exact, partial, and substring matching
- Confidence scoring with tie-breaking logic
- Caching to reduce redundant API calls

### Transcript Generation
- Uses AssemblyAI for high-quality transcription
- Word-level timestamps for precise text selection
- Speaker detection and formatting
- Time range extraction around user-selected timestamps

## Deployment

### Render
The application is configured for deployment on Render with the provided `render.yaml` file.

### Vercel
A `vercel.json` configuration is included for Vercel deployment.

## Known Bugs

*Last updated: July 24, 2024*

- **UI Bugs**: There are various UI bugs throughout the application
- **Thumbnail Text Interference**: Podcast thumbnails with large text or vertical text may cause errors in podcast and episode detection (e.g., Every Little Thing, Good One)
- **Horizontal Scrolling Text**: Horizontal scrolling text can occasionally be cut off in a way that the podcast or episode name can't be detected
- **Player Compatibility**: Detection is optimized for Apple Podcasts, Spotify, and the native iOS player. Overcast may work as well. Functionality with other players is unknown

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

[Add your license information here]

## Support

For issues and questions, please create an issue in the repository. 