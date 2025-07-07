#!/bin/bash

echo "🚀 Setting up GitHub integration for PodQuote..."

# Check if Git is available
if ! command -v git &> /dev/null; then
    echo "❌ Git not found. Please install Xcode Command Line Tools first:"
    echo "   xcode-select --install"
    exit 1
fi

# Initialize Git repository
echo "📁 Initializing Git repository..."
git init

# Create .gitignore if it doesn't exist
if [ ! -f .gitignore ]; then
    echo "📝 Creating .gitignore..."
    cat > .gitignore << EOL
# Dependencies
node_modules/
*/node_modules/

# Build outputs
build/
dist/
.next/

# Environment variables
.env
.env.local
.env.production
.env.development

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# OS files
.DS_Store
Thumbs.db

# Editor directories and files
.vscode/
.idea/
*.swp
*.swo
*~

# Temporary files
*.tmp
*.temp
EOL
fi

# Add all files
echo "📦 Adding files to Git..."
git add .

# Create initial commit
echo "💾 Creating initial commit..."
git commit -m "Initial commit: PodQuote app with transcript highlighting

Features:
- Screenshot text extraction via Google Vision API
- Podcast episode validation via iTunes API  
- Audio transcription via AssemblyAI
- Interactive transcript highlighting
- Apple Podcasts deep linking
- Responsive mobile-first design"

echo "✅ Git repository initialized!"
echo ""
echo "Next steps:"
echo "1. Create a GitHub repository at https://github.com/new"
echo "2. Run: git remote add origin https://github.com/YOUR_USERNAME/podquote.git"
echo "3. Run: git push -u origin main"
echo "4. Connect to Vercel at https://vercel.com" 