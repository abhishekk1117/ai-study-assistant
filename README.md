# AI Study Assistant (RAG)

A full-stack web app where users upload PDFs, ask questions, and get answers grounded in their own notes.

## Tech Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- AI: OpenAI API
- File Upload: Multer
- PDF Parsing: pdf-parse
- Retrieval: In-memory vector store (FAISS-style flow for MVP)

## Architecture (RAG)

1. Upload PDF
2. Extract text
3. Split into chunks (~500 words)
4. Create embeddings for chunks
5. Store embeddings in memory
6. Embed user question
7. Retrieve top-3 similar chunks by cosine similarity
8. Ask LLM to answer using retrieved context only

## Project Structure

- `client/` React UI (upload + chat)
- `server/` Express API (`/upload`, `/chat`, `/health`)

## Setup

### 1) Backend

```bash
cd server
cp .env.example .env
# Add your OPENAI_API_KEY in .env
npm install
npm run dev
```

Backend runs at `http://localhost:4000`.

### 2) Frontend

```bash
cd client
cp .env.example .env
npm install
npm run dev
```

Frontend runs at `http://localhost:5173`.

## API Endpoints

### POST `/upload`

- Form-data: `file` (PDF)
- Parses and indexes document chunks
- Response includes chunks added and total indexed chunks

### POST `/chat`

- JSON body: `{ "question": "..." }`
- Retrieves top-3 relevant chunks
- Returns LLM answer + source chunk metadata

### GET `/health`

- Health and indexed chunk count

## Day-by-Day Mapping

- Day 1: Project setup completed (`client/`, `server/`, dependencies)
- Day 2: File upload completed (`/upload`, Multer, frontend upload UI)
- Day 3: PDF extraction completed (`pdf-parse` in upload pipeline)
- Day 4: Chunking + embeddings completed (`chunkTextByWords`, OpenAI embeddings)
- Day 5: Retrieval completed (cosine similarity top-3 chunks)
- Day 6: Answer generation completed (`/chat` with constrained prompt)
- Day 7: Chat UI completed (message list + ask form)
- Day 8: Polish completed (loader, status indicators, styled bubbles)
- Day 9: Deployment guidance below

## Deployment Notes

- Frontend -> Vercel
  - Set `VITE_API_URL` to your deployed backend URL
- Backend -> Render
  - Add env vars: `OPENAI_API_KEY`, optional model vars
  - Ensure Node service starts with `npm start`

## Interview Answers (Quick)

1. What is RAG?
   - Retrieve relevant data at query time and pass it as context to an LLM.
2. Why embeddings?
   - They convert text into vectors for semantic similarity search.
3. How retrieval works?
   - Compare question embedding with stored chunk embeddings, pick highest scores.
4. Why chunking?
   - Documents are split to fit token limits and improve retrieval granularity.

## Next MVP Upgrades

- Persist vectors in a real vector database
- Multiple PDF support with per-document filters
- Citation highlighting in UI
- Chat history persistence
- Voice input
