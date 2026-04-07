const pdfParse = require('pdf-parse');
const PDFParse = pdfParse.PDFParse || pdfParse;

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
  try {
    const parser = new PDFParse({ data: fileBuffer });
    // PDFParse extracts text to the text property
    const text = parser.text || '';
    return text;
  } catch (error) {
    throw new Error(`Failed to extract PDF text: ${error.message}`);
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

module.exports = {
  chunkTextByWords,
  extractPdfText,
  cosineSimilarity,
  tokenize,
  keywordOverlapScore,
  isQuotaError,
  extractiveLocalAnswer,
};
