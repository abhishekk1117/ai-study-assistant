const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const pdfParseLib = require('pdf-parse');
const fs = require('fs/promises');
const path = require('path');
const OpenAI = require('openai');

dotenv.config({ override: true });

const app = express();
const PORT = process.env.PORT || 4000;
const OPENAI_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const ALLOW_QUOTA_FALLBACK = (process.env.ALLOW_QUOTA_FALLBACK || 'true').toLowerCase() === 'true';

if (!OPENAI_API_KEY || OPENAI_API_KEY === 'your_openai_api_key_here') {
  console.error('Invalid OPENAI_API_KEY in server/.env. Add your real key and restart the server.');
  process.exit(1);
}

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const uploadDir = path.join(__dirname, 'uploads');
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

const ragStore = {
  chunks: [],
};

function chunkTextByWords(text, chunkSize = 500) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  if (!words[0]) {
    return [];
  }

  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize).join(' ').trim();
    if (chunk) {
      chunks.push(chunk);
    }
  }
  return chunks;
}

async function extractPdfText(fileBuffer) {
  // Support both old (function) and new (PDFParse class) package APIs.
  if (typeof pdfParseLib === 'function') {
    const result = await pdfParseLib(fileBuffer);
    return result?.text || '';
  }

  const PDFParseClass = pdfParseLib.PDFParse || pdfParseLib.default?.PDFParse;
  if (!PDFParseClass) {
    throw new Error('Unsupported pdf-parse export format.');
  }

  const parser = new PDFParseClass({ data: fileBuffer });
  try {
    const result = await parser.getText();
    return result?.text || '';
  } finally {
    if (typeof parser.destroy === 'function') {
      await parser.destroy();
    }
  }
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function tokenize(text) {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((token) => token.length > 2),
  );
}

function keywordOverlapScore(questionTokens, contentTokens) {
  if (!questionTokens.size || !contentTokens.size) {
    return 0;
  }

  let overlap = 0;
  questionTokens.forEach((token) => {
    if (contentTokens.has(token)) {
      overlap += 1;
    }
  });

  return overlap / Math.sqrt(questionTokens.size * contentTokens.size);
}

function isQuotaError(error) {
  const status = error?.status || error?.response?.status;
  return status === 429 || error?.code === 'insufficient_quota';
}

function extractListItems(sentence) {
  const source = sentence.includes(':') ? sentence.split(':').slice(1).join(':') : sentence;
  return source
    .split(/,|\band\b/i)
    .map((item) => item.replace(/[^a-zA-Z0-9_\- ]/g, '').trim())
    .filter((item) => item.length >= 2 && item.length <= 40);
}

function isQuestionLike(sentence) {
  const text = sentence.trim();
  return /^q\s*:/i.test(text) || text.endsWith('?');
}

function cleanAnswerPrefix(sentence) {
  return sentence.replace(/^a\s*:\s*/i, '').trim();
}

function answerQualityBonus(sentence) {
  const text = sentence.trim();
  let bonus = 0;

  if (/^a\s*:/i.test(text)) {
    bonus += 0.25;
  }
  if (isQuestionLike(text)) {
    bonus -= 0.55;
  }
  if (text.length < 20) {
    bonus -= 0.1;
  }

  return bonus;
}

function findAnswerFromQAPairs(question, contextText) {
  const lines = contextText
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const questionTokens = tokenize(question);
  let bestIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^q\s*:/i.test(line)) {
      continue;
    }
    const qText = line.replace(/^q\s*:\s*/i, '');
    const score = keywordOverlapScore(questionTokens, tokenize(qText));
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex < 0 || bestScore <= 0) {
    return '';
  }

  for (let i = bestIndex + 1; i < Math.min(lines.length, bestIndex + 5); i += 1) {
    const line = lines[i];
    if (/^q\s*:/i.test(line)) {
      break;
    }
    if (/^a\s*:/i.test(line)) {
      return cleanAnswerPrefix(line);
    }
    if (!isQuestionLike(line) && line.length > 15) {
      return line;
    }
  }

  return '';
}

function buildCountAnswer(question, rankedSentences) {
  const asksCount = /how many|number of|count/i.test(question);
  if (!asksCount) {
    return '';
  }

  for (const sentence of rankedSentences) {
    const items = extractListItems(sentence);
    if (items.length >= 2) {
      return `There are ${items.length} in the notes: ${items.join(', ')}.`;
    }
  }

  return '';
}

function buildInsightLine(question, directAnswer) {
  const q = question.toLowerCase();

  if (/data type/.test(q)) {
    return 'Knowing the right data type helps you write safer code and choose operations correctly.';
  }
  if (/difference|compare|vs/.test(q)) {
    return 'A strong way to study this is to compare purpose, syntax, and common use-cases side by side.';
  }
  if (/why|importance|benefit/.test(q)) {
    return 'This matters because it directly affects how you design logic and debug mistakes in real programs.';
  }

  if (directAnswer.length > 80) {
    return 'The notes suggest this as a core concept, so focus on understanding when to apply it, not just memorizing the definition.';
  }

  return 'A good next step is to pair this concept with one small example so it becomes easy to recall in exams/interviews.';
}

function buildQuickTakeaway(question, supportSentences) {
  const qTokens = tokenize(question);
  const bestSupport = supportSentences
    .map((sentence) => ({
      sentence,
      score: keywordOverlapScore(qTokens, tokenize(sentence)),
    }))
    .sort((a, b) => b.score - a.score)[0]?.sentence;

  return bestSupport
    ? `Takeaway: ${cleanAnswerPrefix(bestSupport)}`
    : 'Takeaway: Revise one concrete example from your notes to lock this in.';
}

function extractiveLocalAnswer(question, scoredChunks) {
  const questionTokens = tokenize(question);
  const contextText = scoredChunks.map((item) => item.content).join(' ');
  const qaAnswer = findAnswerFromQAPairs(question, contextText);

  if (qaAnswer) {
    const insight = buildInsightLine(question, qaAnswer);
    return ['Answer: ' + qaAnswer, '', 'Insight: ' + insight].join('\n');
  }

  const sentences = contextText.split(/(?<=[.!?])\s+/).filter(Boolean);

  const ranked = sentences
    .map((sentence) => ({
      sentence,
      score: keywordOverlapScore(questionTokens, tokenize(sentence)) + answerQualityBonus(sentence),
    }))
    .sort((a, b) => b.score - a.score)
    .filter((item) => item.score > 0)
    .slice(0, 3)
    .map((item) => item.sentence.trim())
    .filter((sentence) => !isQuestionLike(sentence));

  if (!ranked.length) {
    return 'I could not find a confident answer in the uploaded notes. Try a more specific question.';
  }

  const countAnswer = buildCountAnswer(question, ranked);
  const directAnswer = countAnswer || cleanAnswerPrefix(ranked[0]);
  const support = ranked.slice(1);
  const insight = buildInsightLine(question, directAnswer);
  const takeaway = buildQuickTakeaway(question, support);

  const lines = [`Answer: ${directAnswer}`, '', `Insight: ${insight}`, '', takeaway];
  if (support.length) {
    lines.push('', 'Why this answer:', ...support.map((item) => `- ${item}`));
  }

  return lines.join('\n');
}

async function embedText(text) {
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', chunksIndexed: ragStore.chunks.length });
});

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({ error: 'Missing OPENAI_API_KEY on server.' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded.' });
      return;
    }

    const fileBuffer = await fs.readFile(req.file.path);
    const extractedText = await extractPdfText(fileBuffer);
    const chunks = chunkTextByWords(extractedText, 500);

    if (!chunks.length) {
      res.status(400).json({ error: 'No readable text found in this PDF.' });
      return;
    }

    const embeddedChunks = [];
    let usedFallback = false;
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      let embedding = null;
      try {
        embedding = await embedText(chunk);
      } catch (error) {
        if (!(ALLOW_QUOTA_FALLBACK && isQuotaError(error))) {
          throw error;
        }
        usedFallback = true;
      }

      embeddedChunks.push({
        id: `${req.file.filename}-${i}`,
        source: req.file.originalname,
        index: i,
        content: chunk,
        embedding,
        tokens: tokenize(chunk),
      });
    }

    ragStore.chunks.push(...embeddedChunks);

    res.json({
      message: 'File processed and indexed successfully.',
      source: req.file.originalname,
      chunksAdded: embeddedChunks.length,
      totalChunksIndexed: ragStore.chunks.length,
      mode: usedFallback ? 'local-fallback' : 'openai',
      notice: usedFallback ? 'Using local retrieval mode.' : '',
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || 'Upload failed.' });
  }
});

app.post('/chat', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({ error: 'Missing OPENAI_API_KEY on server.' });
      return;
    }

    const question = req.body?.question?.trim();
    if (!question) {
      res.status(400).json({ error: 'Question is required.' });
      return;
    }

    if (!ragStore.chunks.length) {
      res.status(400).json({
        error: 'No study material indexed yet. Upload a PDF first.',
      });
      return;
    }

    let scored = [];
    let mode = 'openai';

    try {
      const questionEmbedding = await embedText(question);
      scored = ragStore.chunks
        .filter((chunk) => Array.isArray(chunk.embedding))
        .map((chunk) => ({
          ...chunk,
          score: cosineSimilarity(questionEmbedding, chunk.embedding),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
    } catch (error) {
      if (!(ALLOW_QUOTA_FALLBACK && isQuotaError(error))) {
        throw error;
      }

      mode = 'local-fallback';
      const questionTokens = tokenize(question);
      scored = ragStore.chunks
        .map((chunk) => ({
          ...chunk,
          score: keywordOverlapScore(questionTokens, chunk.tokens || tokenize(chunk.content)),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
    }

    if (!scored.length) {
      res.status(400).json({
        error: 'No relevant context found yet. Upload a PDF with readable study content first.',
      });
      return;
    }

    const context = scored
      .map(
        (item, i) =>
          `Source: ${item.source} | Chunk: ${item.index}\n[Context ${i + 1}]\n${item.content}`,
      )
      .join('\n\n');

    let answer = '';
    if (mode === 'openai') {
      try {
        const completion = await client.chat.completions.create({
          model: OPENAI_MODEL,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                'You are a study assistant. Use only the retrieved context. Give a direct answer first, then a brief explanation. If the answer is not present in context, say that clearly.',
            },
            {
              role: 'user',
              content:
                `Answer based only on the context below.\n\n` +
                `Return format:\n` +
                `1) Answer: <one clear line>\n` +
                `2) Explanation: <2-4 short lines from context>\n` +
                `3) If useful, include key points as bullets.\n\n` +
                `${context}\n\nQuestion:\n${question}`,
            },
          ],
        });
        answer = completion.choices[0]?.message?.content || 'No answer generated.';
      } catch (error) {
        if (!(ALLOW_QUOTA_FALLBACK && isQuotaError(error))) {
          throw error;
        }
        mode = 'local-fallback';
      }
    }

    if (mode === 'local-fallback') {
      answer = extractiveLocalAnswer(question, scored);
    }

    res.json({
      answer,
      mode,
      notice: mode === 'local-fallback' ? 'Using local retrieval mode.' : '',
      sources: scored.map((item) => ({
        source: item.source,
        chunk: item.index,
        score: Number(item.score.toFixed(4)),
        excerpt: item.content.replace(/\s+/g, ' ').trim().slice(0, 180),
      })),
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message || 'Chat failed.' });
  }
});

app.listen(PORT, () => {
  console.log(`RAG server running at http://localhost:${PORT}`);
});
