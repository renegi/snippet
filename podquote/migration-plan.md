# PodQuote Migration Plan for Native Apps & Sustainability

## Current Architecture
```
Web App (React) → Express Server → External APIs
                      ↓
              File Storage (Local/Temp)
```

## Recommended Future Architecture
```
Mobile App (React Native) → Firebase/Supabase → External APIs
Web App (React/Next.js)   →                  ↓
                                      Cloud Storage (Firebase/S3)
```

## Phase 1: API Abstraction Layer (Immediate)

### 1.1 Create Unified API Service
```javascript
// services/apiService.js - Abstract API calls
class ApiService {
  constructor(baseURL = process.env.REACT_APP_API_URL) {
    this.baseURL = baseURL;
  }

  // Support both FormData (web) and Base64 (mobile)
  async uploadScreenshots(files, format = 'formdata') {
    if (format === 'base64') {
      return this.uploadBase64Images(files);
    }
    return this.uploadFormData(files);
  }

  async uploadBase64Images(base64Images) {
    // Mobile-friendly upload
    return fetch(`${this.baseURL}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: base64Images })
    });
  }

  async uploadFormData(files) {
    // Web upload (current)
    const formData = new FormData();
    files.forEach(file => formData.append('screenshots', file));
    return fetch(`${this.baseURL}/extract`, {
      method: 'POST',
      body: formData
    });
  }
}
```

### 1.2 Environment-Specific Configuration
```javascript
// config/environment.js
export const config = {
  development: {
    apiUrl: 'http://localhost:3001/api',
    platform: 'web'
  },
  production: {
    apiUrl: 'https://your-app.vercel.app/api',
    platform: 'web'
  },
  mobile: {
    apiUrl: 'https://your-app.vercel.app/api',
    platform: 'mobile'
  }
};
```

## Phase 2: Database Migration (6-12 months)

### 2.1 Current Data Storage
- ❌ No persistent storage
- ❌ Session-based data only
- ❌ No user accounts

### 2.2 Recommended: Firebase/Supabase
```javascript
// User data structure
{
  users: {
    [userId]: {
      id: string,
      email?: string,
      createdAt: timestamp,
      subscription?: 'free' | 'premium'
    }
  },
  snippets: {
    [snippetId]: {
      id: string,
      userId: string,
      episodeTitle: string,
      podcastName: string,
      selectedText: string,
      timestamp: string,
      applePodcastsLink: string,
      createdAt: timestamp,
      isPublic: boolean
    }
  },
  usage: {
    [userId]: {
      monthlyExtractions: number,
      lastReset: timestamp
    }
  }
}
```

### 2.3 Benefits of Firebase/Supabase
- ✅ Real-time sync across devices
- ✅ Offline support
- ✅ Authentication built-in
- ✅ Easy mobile SDK integration
- ✅ Automatic scaling

## Phase 3: Native App Considerations

### 3.1 React Native Shared Codebase
```
shared/
├── components/          # Reusable UI components
├── services/           # API calls, business logic
├── utils/              # Helper functions
├── hooks/              # Custom React hooks
└── types/              # TypeScript definitions

platforms/
├── web/                # Next.js specific
├── mobile/             # React Native specific
└── desktop/            # Electron (future)
```

### 3.2 Platform-Specific Features

**Mobile Enhancements:**
- Camera integration for screenshot capture
- Share sheet integration
- Push notifications for transcript completion
- Offline transcript viewing
- Background processing

**Web Advantages:**
- Drag & drop file uploads
- Keyboard shortcuts
- Multi-tab workflow
- Browser extensions (future)

## Phase 4: Monetization & Sustainability

### 4.1 Usage-Based Pricing Model
```javascript
// Pricing tiers
const pricingTiers = {
  free: {
    monthlyExtractions: 10,
    features: ['basic_extraction', 'text_highlighting']
  },
  pro: {
    monthlyExtractions: 100,
    features: ['basic_extraction', 'text_highlighting', 'bulk_export', 'custom_timestamps']
  },
  unlimited: {
    monthlyExtractions: -1, // unlimited
    features: ['all_features', 'api_access', 'team_sharing']
  }
};
```

### 4.2 Cost Optimization
- **Vision API**: Batch processing, caching
- **AssemblyAI**: Optimize audio clip length
- **Storage**: CDN for cached transcripts
- **Hosting**: Edge functions for global performance

## Phase 5: Migration Timeline

### Immediate (0-3 months)
1. ✅ Deploy to Vercel (current state)
2. ⏳ Add API abstraction layer
3. ⏳ Implement user authentication (optional)
4. ⏳ Add basic analytics

### Short-term (3-6 months)
1. Add Firebase/Supabase integration
2. Implement snippet saving/sharing
3. Add usage tracking and limits
4. Optimize API costs

### Medium-term (6-12 months)
1. React Native app development
2. Camera integration
3. Offline functionality
4. Advanced features (batch processing, etc.)

### Long-term (12+ months)
1. Desktop app (Electron)
2. Browser extension
3. API for third-party integrations
4. Advanced AI features

## Migration Checklist

### Pre-Migration
- [ ] Backup current codebase
- [ ] Document all API endpoints
- [ ] Test current functionality thoroughly
- [ ] Set up monitoring/analytics

### During Migration
- [ ] Maintain backward compatibility
- [ ] Implement feature flags
- [ ] Gradual user migration
- [ ] Performance monitoring

### Post-Migration
- [ ] User feedback collection
- [ ] Performance optimization
- [ ] Cost monitoring
- [ ] Feature usage analytics
``` 