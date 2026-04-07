# ✅ Vercel Deployment Setup Complete

## What Was Done

### 1. **Created Vercel Configuration** (`vercel.json`)
   - Configured build command for the monorepo
   - Set output directory to `client/dist` (React build)
   - Added default environment variables for Vercel
   - Configured for optimal performance in sfo1 region

### 2. **Restructured Backend for Serverless** (`/api/` directory)
   - **`api/health.js`** → GET /api/health
   - **`api/upload.js`** → POST /api/upload (handles PDF indexing)
   - **`api/chat.js`** → POST /api/chat (handles RAG queries)
   - **`api/lib/rag.js`** → Shared RAG utilities & algorithms
   - **`api/lib/storage.js`** → Persistent JSON file storage
   - **`api/package.json`** → Dependencies for serverless functions

### 3. **Updated Frontend Environment** 
   - Modified `client/src/App.jsx` to auto-detect API URL
   - Uses `/api/*` routes on Vercel
   - Falls back to `http://localhost:4000` for local development
   - Created `client/.env.local` for dev configuration

### 4. **Added Documentation**
   - **`.env.example`** → Template for required environment variables
   - **`DEPLOYMENT.md`** → Complete deployment guide with troubleshooting
   - **`.vercelignore`** → Excludes unnecessary files from deployment

## Next Steps to Deploy

### Step 1: Commit & Push
```bash
git add .
git commit -m "Setup Vercel deployment with serverless functions"
git push
```

### Step 2: Connect to Vercel
1. Go to https://vercel.com/new
2. Import your GitHub repository
3. Vercel will auto-detect the configuration

### Step 3: Set Environment Variables
In Vercel Dashboard → Your Project → Settings → Environment Variables:

| Variable | Value | Required |
|---|---|---|
| `OPENAI_API_KEY` | Your OpenAI API key | ✅ Yes |
| `OPENAI_CHAT_MODEL` | `gpt-4o-mini` | Optional (default provided) |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Optional (default provided) |
| `ALLOW_QUOTA_FALLBACK` | `true` | Optional (default provided) |

**Get your OpenAI API Key:**
- Go to https://platform.openai.com/api-keys
- Create a new secret key
- Copy it to Vercel environment variables

### Step 4: Deploy
Click "Deploy" in Vercel dashboard. Your app will be live in ~60 seconds!

## How Vercel Deployment Works

### Architecture
```
┌─ Vercel CDN (Global EdgeNetwork)
│  └─ client/dist/ → React frontend
│
└─ Vercel Serverless Functions
   ├─ /api/health → Check server status
   ├─ /api/upload → Index PDFs with OpenAI embeddings
   └─ /api/chat → Query documents using RAG
```

### Request Flow
1. User uploads PDF → `/api/upload`
   - PDF extracted to text
   - Split into 500-word chunks
   - Embeddings generated via OpenAI
   - Stored in `rag-store.json`

2. User asks question → `/api/chat`
   - Question embedded
   - Top-3 relevant chunks retrieved (cosine similarity)
   - OpenAI generates answer from context
   - Falls back to local extraction if quota exceeded

3. Data persists between requests via `rag-store.json` on Vercel's filesystem

## Local Development

### Option 1: Full Local Stack (Recommended)
```bash
# Terminal 1: Express backend
cd server
npm install
npm run dev  # Runs on http://localhost:4000

# Terminal 2: React frontend 
cd client
npm install
npm run dev  # Runs on http://localhost:5173
```
API_URL defaults to `http://localhost:4000` via `.env.local`

### Option 2: Test Against Vercel Backend
```bash
# In client/.env.local, set:
VITE_API_URL=https://your-vercel-domain.vercel.app

npm run dev  # Frontend will call Vercel API
```

## Key Differences from Original

| Aspect | Before | After |
|--------|--------|-------|
| **Backend** | Express in `/server/` | Serverless in `/api/` |
| **Data Storage** | In-memory (lost on restart) | Persistent JSON file |
| **Scalability** | Single server | Auto-scaling functions |
| **Cost** | Paid hosting | Free tier available |
| **Cold Start** | Instant | ~1-2s first request |

## Troubleshooting

### 404 on API Calls?
- ✅ Routes are `/api/upload`, `/api/chat`, `/api/health`
- ✅ Check OPENAI_API_KEY is set in Vercel dashboard

### Upload Fails?
- Check Vercel function logs for errors
- Ensure PDF file is readable (not encrypted)

### "No chunks indexed" Error?
- Upload a PDF first before asking questions
- Check that upload was successful (look for "chunksAdded" response)

### Cold Start Slow?
- Normal on first request after deployment
- Caching will speed up subsequent requests

## File Reference

**New Files Created:**
- `vercel.json` - Vercel config
- `.vercelignore` - Exclusions
- `api/health.js` - Health check endpoint
- `api/upload.js` - PDF upload endpoint
- `api/chat.js` - Chat/RAG endpoint
- `api/lib/rag.js` - RAG utilities
- `api/lib/storage.js` - Data persistence
- `api/package.json` - API dependencies
- `.env.example` - Environment template
- `DEPLOYMENT.md` - Detailed deployment guide
- `client/.env.local` - Local dev config
- `VERCEL_SETUP.md` - This file

**Modified Files:**
- `client/src/App.jsx` - Updated API URL detection

**Unchanged:**
- `server/` - Kept for local development reference
- `client/` - Same React app

---

✨ **Ready to deploy!** Push to GitHub and connect to Vercel.
