# PodQuote

A modern web application for extracting quotes from podcast screenshots using AI-powered text recognition and transcription.

## Features

- Upload podcast screenshots from various players (Apple Podcasts, Spotify, iOS Control Center)
- Extract podcast information using Google Cloud Vision API
- Get accurate transcripts using AssemblyAI
- Adjustable time range for transcript extraction
- Modern, responsive UI built with React and Tailwind CSS

## Prerequisites

- Node.js (v14 or higher)
- Google Cloud Vision API credentials
- AssemblyAI API key

## Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/podquote.git
cd podquote
```

2. Install dependencies:
```bash
npm run install-all
```

3. Set up environment variables:
   - Copy `server/.env.example` to `server/.env`
   - Add your Google Cloud Vision API credentials
   - Add your AssemblyAI API key
   - Add your Anthropic API key: your_claude_api_key_here

4. Start the development servers:
```bash
npm start
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend: http://localhost:3001

## Project Structure

```
/podquote
├── client/                   # Frontend React app
│   ├── public/              # Static files
│   └── src/                 # React source code
│       ├── components/      # React components
│       └── services/        # API services
│
├── server/                  # Backend Node.js server
│   ├── api/                # API routes
│   ├── services/           # External service integrations
│   ├── middleware/         # Express middleware
│   └── utils/              # Utility functions
```

## API Endpoints

### POST /api/extract
Process podcast screenshots and extract information.

**Request:**
- Content-Type: multipart/form-data
- Body: screenshots (files)

**Response:**
```json
{
  "success": true,
  "data": [{
    "podcastTitle": "string",
    "episodeTitle": "string",
    "timestamp": "string",
    "player": "string"
  }]
}
```

### POST /api/transcript
Get transcript for a specific time range.

**Request:**
```json
{
  "podcastInfo": {
    "podcastTitle": "string",
    "episodeTitle": "string",
    "timestamp": "string"
  },
  "timeRange": {
    "before": number,
    "after": number
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "text": "string",
    "words": [],
    "confidence": number
  }
}
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details. 