// Setup polyfills FIRST before any other requires
require('./polyfills');

const OpenAI = require('openai');
const {
  cosineSimilarity,
  tokenize,
  keywordOverlapScore,
  isQuotaError,
  extractiveLocalAnswer,
} = require('./lib/rag');
const { loadStore } = require('./lib/storage');

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const ALLOW_QUOTA_FALLBACK = (process.env.ALLOW_QUOTA_FALLBACK || 'true').toLowerCase() === 'true';

const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

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
  try {
    if (!OPENAI_API_KEY) {
      res.status(500).json({ error: 'Missing OPENAI_API_KEY on server.' });
      return;
    }

    const question = req.body?.question?.trim();
    if (!question) {
      res.status(400).json({ error: 'Question is required.' });
      return;
    }

    const store = await loadStore();
    if (!store.chunks.length) {
      res.status(400).json({
        error: 'No study material indexed yet. Upload a PDF first.',
      });
      return;
    }

    let scored = [];
    let mode = 'openai';

    try {
      const questionEmbedding = await embedText(question);
      scored = store.chunks
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
      scored = store.chunks
        .map((chunk) => ({
          ...chunk,
          score: keywordOverlapScore(questionTokens, new Set(chunk.tokens || Array.from(tokenize(chunk.content)))),
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

    res.status(200).json({
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
};
