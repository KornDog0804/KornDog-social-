// netlify/functions/generate.js
//
// Server-side LLM proxy. Keys never leave this function.
// Accepts { prompt, maxTokens, imageBase64?, imageMimeType? }
// Returns { text } on success or { error } on failure.
//
// Required Netlify Environment Variables:
//   LLM_PROVIDER        — "anthropic" | "openai" | "gemini" | "ollama"  (default: anthropic)
//   ANTHROPIC_API_KEY   — required when LLM_PROVIDER=anthropic
//   OPENAI_API_KEY      — required when LLM_PROVIDER=openai
//   GEMINI_API_KEY      — required when LLM_PROVIDER=gemini
//
// Model overrides (optional):
//   ANTHROPIC_MODEL     — default: claude-sonnet-4-6
//   OPENAI_MODEL        — default: gpt-4o
//   GEMINI_MODEL        — default: gemini-1.5-pro
//
// Ollama (self-hosted, both required):
//   OLLAMA_URL          — e.g. http://your-server:11434
//   OLLAMA_MODEL        — e.g. llama3

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

const TIMEOUT_MS = 25000;

// ── System prompt — server-side only, never sent from browser ──
const SYSTEM_PROMPT = `You are Joey Begley — owner of KornDog Records, a weird little independent vinyl record shop in Bowling Green, KY. You sell on korndogrecords.com, Discogs (korndog0804), and Whatnot. Your brand is built around "Vinyl Therapy" — records heal, stories matter, music is life. Your mascot is Zombie Kitty.

You are a Gen X record nerd talking from behind the counter. Genres you know cold: nu-metal/post-hardcore (Sleep Token, Bad Omens, Dance Gavin Dance, Spiritbox, Knocked Loose), classic rock/metal (Pantera, Metallica, Led Zeppelin), grunge/alt (Nirvana, Alice In Chains, Pearl Jam).

VOICE RULES — always follow these:
- Sound like Joey, not a marketing department. Plain language, emotional honesty, occasional humor.
- Explain WHY the music matters, not just what it is.
- Never use: "available now", "limited time", "don't miss out", "shop today."
- Never over-explain. Short gut punch beats long essay.
- It is okay to say: "hell yeah", "this one hurts", "this one rips", "rabbit hole", "crate", "therapy", "weird little record shop", "real music for weird people."
- Hashtags are secondary — the post must work without them.
- Never sound like a desperate ad.
- Lead with emotion, story, nostalgia, hype, or discovery. Then mention the record or deal naturally.`;

exports.handler = async function (event) {
  // ── CORS preflight ─────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return fail(405, 'Method not allowed');
  }

  // ── Parse + validate body ──────────────────────────────────
  let prompt, maxTokens, imageBase64, imageMimeType;
  try {
    ({ prompt, maxTokens, imageBase64, imageMimeType } = JSON.parse(event.body || '{}'));
  } catch {
    return fail(400, 'Request body must be valid JSON');
  }

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return fail(400, 'Field "prompt" is required and must be a non-empty string');
  }
  if (prompt.length > 16000) {
    return fail(400, 'Prompt exceeds maximum length');
  }

  // Validate image fields if present
  const hasImage = !!(imageBase64 && imageMimeType);
  if (imageBase64 && !imageMimeType) {
    return fail(400, 'imageMimeType required when imageBase64 is provided');
  }
  if (hasImage && typeof imageBase64 !== 'string') {
    return fail(400, 'imageBase64 must be a string');
  }
  // Rough size check: 3.5MB base64 ≈ 4.67M chars
  if (hasImage && imageBase64.length > 5_000_000) {
    return fail(400, 'Image too large. Please use a smaller photo.');
  }

  const tokens   = Math.min(Math.max(parseInt(maxTokens, 10) || 1000, 100), 2000);
  const provider = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase().trim();

  try {
    const fullPrompt = SYSTEM_PROMPT + '\n\n' + prompt.trim();
    const text = await callProvider(provider, fullPrompt, tokens, hasImage ? { base64: imageBase64, mimeType: imageMimeType } : null);

    if (!text || !text.trim()) {
      console.error('[generate] Provider returned empty text. Provider:', provider);
      return fail(502, 'Generation failed. Check server logs.');
    }

    return ok({ text: text.trim() });

  } catch (err) {
    console.error('[generate] Provider error:', provider, err.message);
    return fail(500, 'Generation failed. Check server logs.');
  }
};

// ── Provider dispatch ─────────────────────────────────────────

async function callProvider(provider, prompt, tokens, image) {
  switch (provider) {
    case 'anthropic': return callAnthropic(prompt, tokens, image);
    case 'openai':    return callOpenAI(prompt, tokens, image);
    case 'gemini':    return callGemini(prompt, tokens, image);
    case 'ollama':    return callOllama(prompt, tokens);  // Ollama vision varies by model
    default:
      throw new Error(`Unknown LLM_PROVIDER: "${provider}"`);
  }
}

// ── Anthropic ─────────────────────────────────────────────────
async function callAnthropic(prompt, tokens, image) {
  const apiKey = requireEnv('ANTHROPIC_API_KEY');
  const model  = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

  // Build message content — text only or text + image
  let content;
  if (image) {
    content = [
      {
        type:   'image',
        source: { type: 'base64', media_type: image.mimeType, data: image.base64 },
      },
      { type: 'text', text: prompt },
    ];
  } else {
    content = prompt;
  }

  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: tokens,
      messages: [{ role: 'user', content }],
    }),
  });

  const data = await parseJSON(res, 'Anthropic');
  const text = (data?.content || [])
    .map(c => (c?.type === 'text' ? c.text : '') || '')
    .join('')
    .trim();
  if (!text) throw new Error('Anthropic returned no text content');
  return text;
}

// ── OpenAI ────────────────────────────────────────────────────
async function callOpenAI(prompt, tokens, image) {
  const apiKey = requireEnv('OPENAI_API_KEY');
  const model  = process.env.OPENAI_MODEL || 'gpt-4o';

  let messageContent;
  if (image) {
    messageContent = [
      { type: 'text', text: prompt },
      {
        type:      'image_url',
        image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
      },
    ];
  } else {
    messageContent = prompt;
  }

  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: tokens,
      messages: [{ role: 'user', content: messageContent }],
    }),
  });

  const data = await parseJSON(res, 'OpenAI');
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('OpenAI returned no text content');
  return text;
}

// ── Gemini ────────────────────────────────────────────────────
async function callGemini(prompt, tokens, image) {
  const apiKey      = requireEnv('GEMINI_API_KEY');
  const cleanModel  = (process.env.GEMINI_MODEL || 'gemini-1.5-flash').replace('models/', '');
  const url         = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;

  // Build parts — image first if present, then text
  const parts = [];
  if (image) {
    parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });
  }
  parts.push({ text: prompt });

  const res = await fetchWithTimeout(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents:         [{ parts }],
      generationConfig: { maxOutputTokens: tokens },
    }),
  });

  const data = await parseJSON(res, 'Gemini');
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map(p => p?.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini returned no text content');
  return text;
}

// ── Ollama ────────────────────────────────────────────────────
async function callOllama(prompt, tokens) {
  const baseUrl = requireEnv('OLLAMA_URL');
  const model   = requireEnv('OLLAMA_MODEL');
  const url     = baseUrl.replace(/\/$/, '') + '/api/chat';

  const res = await fetchWithTimeout(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream:   false,
      options:  { num_predict: tokens },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await parseJSON(res, 'Ollama');
  const text = data?.message?.content?.trim();
  if (!text) throw new Error('Ollama returned no text content');
  return text;
}

// ── Helpers ───────────────────────────────────────────────────

function requireEnv(name) {
  const val = process.env[name];
  if (!val || !val.trim()) throw new Error(`Environment variable "${name}" is not set`);
  return val.trim();
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Provider request timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function parseJSON(res, providerName) {
  let data;
  try { data = await res.json(); }
  catch { throw new Error(`${providerName} returned non-JSON response (status ${res.status})`); }
  if (!res.ok) {
    const detail = data?.error?.message || data?.error || JSON.stringify(data);
    throw new Error(`${providerName} API error ${res.status}: ${detail}`);
  }
  return data;
}

function ok(body)   { return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(body) }; }
function fail(code, message) {
  return { statusCode: code, headers: CORS_HEADERS, body: JSON.stringify({ error: message }) };
}
