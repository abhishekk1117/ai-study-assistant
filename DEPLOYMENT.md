# Deployment guide for AI Study Assistant on Vercel

## Quick Setup

### 1. Prerequisites
- GitHub account with your code pushed
- Vercel account (free tier works fine)
- OpenAI API key from https://platform.openai.com/api-keys

### 2. Deploy Frontend + Backend

1. Go to https://vercel.com/new
2. Import your GitHub repository
3. Vercel will auto-detect the setup (React + Node.js)
4. Click "Deploy"

### 3. Set Environment Variables

After deployment (or during), add these in Vercel Dashboard → Settings → Environment Variables:

```
OPENAI_API_KEY = your_actual_api_key_here
OPENAI_CHAT_MODEL = gpt-4o-mini
OPENAI_EMBEDDING_MODEL = text-embedding-3-small
ALLOW_QUOTA_FALLBACK = true
```

### 4. Test It

1. Visit your Vercel deployment URL
2. Upload a PDF to index it
3. Ask a question to test the RAG system

### 5. Local Development

```bash
# Terminal 1: Start backend API
cd server
npm install
npm run dev

# Terminal 2: Start frontend
cd client
npm install
npm run dev
```

Then visit http://localhost:5173 (Vite default port)

## How It Works

- **Frontend**: Built React app deployed to Vercel CDN
- **Backend**: Express routes converted to Vercel serverless functions in `/api/`
- **Storage**: RAG chunks stored in `rag-store.json` (persists across requests)
- **Models**: Uses OpenAI for embeddings and chat completion

## Troubleshooting

### 404 Errors
- Check that API calls use `/api/upload`, `/api/chat`, `/api/health`
- Verify environment variables are set in Vercel dashboard

### PDF Upload Fails
- Ensure OPENAI_API_KEY is set
- Check Vercel function logs: Dashboard → Deployments → Function Logs

### No Answers to Questions
- Verify PDF was uploaded successfully
- Check if ALLOW_QUOTA_FALLBACK is enabled (uses local search)
- Upload a PDF with clear text content (avoid scanned images)

## File Structure

```
.
├── api/                    # Vercel serverless functions
│   ├── health.js          # GET /api/health
│   ├── upload.js          # POST /api/upload
│   ├── chat.js            # POST /api/chat
│   ├── lib/
│   │   ├── rag.js         # RAG utilities
│   │   └── storage.js     # Data persistence
│   └── package.json
├── client/                 # React frontend (Vite)
│   ├── src/
│   │   └── App.jsx
│   └── package.json
├── server/                 # Original Express (kept for local dev)
│   ├── index.js
│   └── package.json
├── vercel.json            # Vercel configuration
├── .env.example           # Environment template
└── .vercelignore          # Files to exclude from deployment
```
