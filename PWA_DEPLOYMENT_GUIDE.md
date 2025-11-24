# PWA Deployment & Usage Guide

## What is a PWA?

A **Progressive Web App (PWA)** is a website that works like a native desktop or mobile app. Think of it as the best of both worlds:

- **Like a website**: Built with HTML, CSS, and JavaScript
- **Like a native app**: Installs to your computer, works offline, has its own icon

**Key Benefits:**
- ✅ No app store required
- ✅ Works on any device with a browser
- ✅ Automatically updates when you push changes
- ✅ Can work completely offline after first visit
- ✅ Users can install it like a regular desktop app

---

## For Developers: How to Deploy Your PWA

### Prerequisites
- A GitHub account (free)
- Your PWA project files ready
- Git installed on your computer

### Step 1: Prepare Your PWA Files

Make sure your project includes these essential PWA files:

1. **`manifest.json`** - Defines app name, icons, and appearance
   ```json
   {
     "name": "Your App Name",
     "short_name": "App",
     "start_url": "./index.html",
     "display": "standalone",
     "icons": [
       { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
       { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
     ]
   }
   ```

2. **`sw.js`** (Service Worker) - Enables offline functionality
   - Lists all files to cache
   - Handles offline requests

3. **Icons** - `favicon.ico`, `icon-192.png`, `icon-512.png`

4. **Link in `index.html`**:
   ```html
   <link rel="manifest" href="manifest.json">
   <link rel="icon" type="image/x-icon" href="favicon.ico">
   ```

### Step 2: Initialize Git Repository

Open terminal in your project folder:

```bash
# Initialize Git
git init

# Add all files
git add .

# Create first commit
git commit -m "Initial commit: PWA ready for deployment"
```

### Step 3: Create GitHub Repository

1. Go to [github.com](https://github.com) and sign in
2. Click the **+** icon → **New repository**
3. Name your repository (e.g., `my-pwa-app`)
4. Select **Public** (required for free GitHub Pages)
5. **Do NOT** check any boxes (README, .gitignore, license)
6. Click **Create repository**

### Step 4: Push Code to GitHub

Copy the repository URL from GitHub (looks like: `https://github.com/username/my-pwa-app.git`)

```bash
# Connect to GitHub
git remote add origin https://github.com/username/my-pwa-app.git

# Set branch name
git branch -M main

# Push code
git push -u origin main
```

### Step 5: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** → **Pages** (in left sidebar)
3. Under **Source**, select:
   - **Deploy from a branch**
   - Branch: **main**
   - Folder: **/ (root)**
4. Click **Save**
5. Wait 1-2 minutes for deployment

Your app will be live at: `https://username.github.io/my-pwa-app/`

### Step 6: Update Your App (Future Changes)

Whenever you make changes:

```bash
git add .
git commit -m "Description of changes"
git push
```

GitHub Pages automatically updates within 1-2 minutes!

---

## For Users: How to Install & Use the PWA

### Installation (One-Time Setup)

#### On Desktop (Chrome, Edge, Brave)

1. **Visit the app URL** your developer shared (e.g., `https://username.github.io/app-name/`)
2. **Look for the install icon** in the address bar (⊕ or download icon)
3. **Click Install** → Confirm
4. The app opens in its own window!

**Alternative method:**
- Click the **three dots (⋮)** menu
- Hover over **"Save and share"**
- Click **"Install [App Name]..."**

#### On Mac

After installation:
- Find the app in **Applications** folder
- Add to **Desktop**: Drag from Applications to Desktop
- Add to **Dock**: Right-click dock icon → Options → Keep in Dock
- Search in **Spotlight**: Cmd+Space, type app name

#### On Windows

After installation:
- Find in **Start Menu**
- Pin to **Desktop**: Right-click → Pin to Desktop
- Pin to **Taskbar**: Right-click → Pin to Taskbar

#### On Mobile (iOS/Android)

**Safari (iPhone/iPad):**
1. Tap the **Share** button
2. Scroll down and tap **"Add to Home Screen"**
3. Tap **Add**

**Chrome (Android):**
1. Tap the **three dots (⋮)** menu
2. Tap **"Install app"** or **"Add to Home screen"**

### Using the App Offline

#### First Time (Requires Internet)
1. Visit the app URL
2. Install it as described above
3. Use the app normally - it downloads all files in the background

#### After First Visit (100% Offline!)
1. **Launch the app** from Applications/Desktop/Start Menu
2. **No internet needed** - everything works offline:
   - Open files from your computer
   - Edit and save data
   - Use all features
3. **Chrome must be installed** (but no browser windows need to be open)

**Note:** The app runs on Chrome's engine in the background, but you don't need any browser tabs open.

### Uninstalling the App

**On Desktop:**
- Click the **three dots (⋮)** in the app window
- Select **"Uninstall [App Name]..."**

**On Mobile:**
- Remove like any other app (long-press → Delete)

---

## Troubleshooting

### "Install button doesn't appear"
- Make sure you're using Chrome, Edge, or Brave
- Check that the site uses HTTPS (GitHub Pages does this automatically)
- Try refreshing the page

### "App doesn't work offline"
- Visit the app at least once with internet
- Wait a few seconds for files to cache
- Check that the service worker is registered (Developer Tools → Application → Service Workers)

### "Updates don't appear"
- Close and reopen the app
- Clear cache: Settings → Privacy → Clear browsing data
- Reinstall the app

---

## Summary

### Developer Checklist
- ✅ Create PWA files (manifest.json, sw.js, icons)
- ✅ Initialize Git repository
- ✅ Push to GitHub
- ✅ Enable GitHub Pages
- ✅ Share the URL with users

### User Checklist
- ✅ Visit the app URL (with internet)
- ✅ Click "Install" button
- ✅ Use from Desktop/Applications folder
- ✅ Works offline after first visit!

---

## Example: This WAV Metadata Editor

**Live URL:** https://pauljisaacs.github.io/W-M-E/

**What it does:**
- Edit WAV file metadata
- Visualize audio waveforms
- Mix multi-channel audio
- Export to MP3

**Offline capabilities:**
- Load audio files from your computer
- Edit metadata
- Use all features without internet
- Save changes locally

**Perfect for:** Audio engineers working in the field without reliable internet access!
