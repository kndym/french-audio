# Deployment Guide

This guide covers various deployment options for the French Speech Flashcards application.

## 🚀 Quick Deploy Options

### Vercel (Recommended)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-username/french-audio)

**Why Vercel?**
- Zero-config deployment from GitHub
- Automatic HTTPS (required for Web Speech API)
- Free tier available
- Built-in CI/CD

---

## 📋 Deployment Requirements

### Prerequisites
- **HTTPS required** - Web Speech API only works over secure connections
- **Node.js build environment** - For generating flashcard data
- **Static file hosting** - The app is a static site after build

### Build Process
The app requires a **two-step build**:
1. `npm run build-deck` - Generate `public/cards.json` from `words.csv`
2. `npm run build` - Build React app to `dist/`

### Environment Variables
No environment variables required - the app is fully client-side.

---

## 🏗️ Platform-Specific Guides

### Vercel

#### Automatic Deployment
1. Connect your GitHub repository to Vercel
2. Vercel auto-detects settings from `vercel.json`
3. Deploy automatically on push to main branch

#### Manual Deployment
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy from project root
vercel

# Deploy to production
vercel --prod
```

#### Vercel Configuration
```json
// vercel.json
{
  "buildCommand": "npm run build-deck && npm run build",
  "outputDirectory": "dist",
  "installCommand": "npm install"
}
```

### Netlify

#### Configuration
Create `netlify.toml`:
```toml
[build]
  command = "npm run build-deck && npm run build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "16"

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-XSS-Protection = "1; mode=block"
```

#### Deployment Steps
1. Connect GitHub repository to Netlify
2. Set build command: `npm run build-deck && npm run build`
3. Set publish directory: `dist`
4. Deploy automatically on pushes

### GitHub Pages

#### Setup
1. Create `gh-pages` branch
2. Configure GitHub Pages in repository settings
3. Use GitHub Actions for automatic deployment

#### GitHub Actions Workflow
Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '16'
        
    - name: Install dependencies
      run: npm install
      
    - name: Generate flashcards
      run: npm run build-deck
      
    - name: Build application
      run: npm run build
      
    - name: Deploy to GitHub Pages
      uses: peaceiris/actions-gh-pages@v3
      with:
        github_token: ${{ secrets.GITHUB_TOKEN }}
        publish_dir: ./dist
```

### Firebase Hosting

#### Setup
```bash
# Install Firebase CLI
npm install -g firebase-tools

# Initialize Firebase
firebase init hosting

# Deploy
firebase deploy
```

#### firebase.json Configuration
```json
{
  "hosting": {
    "public": "dist",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

### Self-Hosted Options

#### Nginx Configuration
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    root /var/www/french-audio/dist;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # Security headers
    add_header X-Frame-Options "DENY" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

#### Apache Configuration
```apache
<VirtualHost *:443>
    ServerName your-domain.com
    DocumentRoot /var/www/french-audio/dist
    
    SSLEngine on
    SSLCertificateFile /path/to/cert.pem
    SSLCertificateKeyFile /path/to/key.pem
    
    <Directory "/var/www/french-audio/dist">
        RewriteEngine On
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule . /index.html [L]
    </Directory>
</VirtualHost>
```

---

## 🔧 Build Configuration

### package.json Scripts
```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "build-deck": "node scripts/build-deck.js",
    "preview": "vite preview"
  }
}
```

### vite.config.js
```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    minify: 'terser'
  },
  server: {
    port: 5173,
    https: false // Enable for local HTTPS testing
  }
})
```

---

## 🔒 Security Considerations

### HTTPS Requirements
- **Mandatory for production** - Web Speech API requires secure context
- Use Let's Encrypt for free SSL certificates
- Most hosting platforms provide automatic HTTPS

### Security Headers
```javascript
// Add these headers in your hosting configuration
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

### Content Security Policy
```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               script-src 'self' 'unsafe-inline'; 
               style-src 'self' 'unsafe-inline';
               media-src 'self' blob:;
               connect-src 'self';">
```

---

## 📊 Performance Optimization

### Build Optimizations
```javascript
// vite.config.js
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom']
        }
      }
    }
  }
})
```

### Caching Strategy
- Static assets: Cache for 1 year
- HTML: Cache for 1 hour
- Service worker: Cache for offline usage

### CDN Configuration
```javascript
// For CDN deployment
const CDN_BASE_URL = 'https://cdn.your-domain.com'
export const ASSET_BASE = CDN_BASE_URL + '/french-audio/'
```

---

## 🐛 Troubleshooting

### Common Deployment Issues

#### Build Fails
```bash
# Ensure build-deck runs first
npm run build-deck && npm run build

# Check words.csv exists
ls -la words.csv

# Verify Node.js version
node --version  # Should be 16+
```

#### Speech Recognition Not Working
- Verify HTTPS is enabled
- Check browser compatibility (Chrome/Edge recommended)
- Test microphone permissions
- Verify Web Speech API support

#### CORS Issues
```javascript
// In vite.config.js for development
export default defineConfig({
  server: {
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*'
    }
  }
})
```

#### Large File Size
```bash
# Analyze bundle size
npm run build -- --analyze

# Optimize images and assets
npm run build && npx vite-bundle-analyzer dist/
```

---

## 📈 Monitoring and Analytics

### Performance Monitoring
```javascript
// Add to main.jsx
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
}

// Performance monitoring
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.log(entry.name, entry.duration)
  }
})
observer.observe({ entryTypes: ['measure'] })
```

### Error Tracking
```javascript
// Global error handler
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error)
  // Send to error tracking service
})

// Speech recognition errors
const handleSpeechError = (error) => {
  console.error('Speech recognition error:', error)
  // Implement retry logic
}
```

---

## 🔄 CI/CD Pipeline

### GitHub Actions Example
```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    - uses: actions/setup-node@v3
      with:
        node-version: '16'
    
    - name: Install dependencies
      run: npm install
    
    - name: Run tests
      run: npm test
    
    - name: Build application
      run: npm run build-deck && npm run build

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
    - name: Deploy to production
      run: echo "Deploy to your hosting platform"
```

---

This deployment guide should help you get the French Speech Flashcards app running on any platform. Choose the option that best fits your needs and technical requirements.
