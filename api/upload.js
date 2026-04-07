const multer = require('multer');
const fs = require('fs/promises');
const path = require('path');
const { Readable } = require('stream');
const OpenAI = require('openai');
const {
  extractPdfText,
  chunkTextByWords,
  tokenize,
  isQuotaError,
} = require('./lib/rag');
const { loadStore, saveStore } = require('./lib/storage');

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const ALLOW_QUOTA_FALLBACK = (process.env.ALLOW_QUOTA_FALLBACK || 'true').toLowerCase() === 'true';

if (!OPENAI_API_KEY) {
  console.error('Warning: OPENAI_API_KEY not set');
}

const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const uploadDir = '/tmp/pdf-uploads';
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error, uploadDir);
    }
  },
  filename: (_req, file, cb) => {
    const safeName = `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
      return;
    }
    cb(new Error('Only PDF files are supported right now.'));
  },
});

const uploadMiddleware = upload.single('file');

async function embedText(text) {
  if (!client) {
    throw new Error('OpenAI client not initialized');
  }
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

module.exports = async (req, res) => {
  return new Promise((resolve) => {
    uploadMiddleware(req, res, async (error) => {
      try {
        if (error) {
          res.status(400).json({ error: error.message || 'Upload failed' });
          return resolve();
        }

        if (!OPENAI_API_KEY) {
          res.status(500).json({ error: 'Missing OPENAI_API_KEY on server.' });
          return resolve();
        }

        if (!req.file) {
          res.status(400).json({ error: 'No file uploaded.' });
          return resolve();
        }

        const fileBuffer = await fs.readFile(req.file.path);
        const extractedText = await extractPdfText(fileBuffer);
        const chunks = chunkTextByWords(extractedText, 500);

        if (!chunks.length) {
          res.status(400).json({ error: 'No readable text found in this PDF.' });
          return resolve();
        }

        const embeddedChunks = [];
        let usedFallback = false;

        for (let i = 0; i < chunks.length; i += 1) {
          const chunk = chunks[i];
          let embedding = null;
          try {
            embedding = await embedText(chunk);
          } catch (embError) {
            if (!(ALLOW_QUOTA_FALLBACK && isQuotaError(embError))) {
              throw embError;
            }
            usedFallback = true;
          }

          embeddedChunks.push({
            id: `${req.file.filename}-${i}`,
            source: req.file.originalname,
            index: i,
            content: chunk,
            embedding,
            tokens: Array.from(tokenize(chunk)),
          });
        }

        const store = await loadStore();
        store.chunks.push(...embeddedChunks);
        await saveStore(store);

        // Clean up uploaded file
        try {
          await fs.unlink(req.file.path);
        } catch (e) {
          console.error('Failed to delete uploaded file:', e);
        }

        res.status(200).json({
          message: 'File processed and indexed successfully.',
          source: req.file.originalname,
          chunksAdded: embeddedChunks.length,
          totalChunksIndexed: store.chunks.length,
          mode: usedFallback ? 'local-fallback' : 'openai',
          notice: usedFallback ? 'Using local retrieval mode.' : '',
        });
        resolve();
      } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message || 'Upload failed.' });
        resolve();
      }
    });
  });
};
