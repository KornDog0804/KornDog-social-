// netlify/functions/generate.js
//
// Proxies LLM requests to Gemini (or Claude fallback).
// Accepts: { prompt, maxTokens, imageBase64?, imageMimeType? }
// Returns: { text }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return fail(405, 'Method not allowed');
  }

  let prompt, maxTokens, imageBase64, imageMimeType;
  try {
    ({ prompt, maxTokens = 1000, imageBase64, imageMimeType } = JSON.parse(event.body || '{}'));
  } catch {
    return fail(400, 'Invalid JSON body');
  }

  if (!prompt) return fail(400, 'prompt is required');

  const provider   = process.env.LLM_PROVIDER || 'gemini';
  const geminiKey  = process.env.GEMINI_API_KEY;
  const geminiModel= process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  if (provider === 'gemini') {
    if (!geminiKey) return fail(500, 'GEMINI_API_KEY not set');

    // Build Gemini parts — text always, image optional
    const parts = [];

    if (imageBase64 && imageMimeType) {
      parts.push({
        inlineData: {
          mimeType: imageMimeType,
          data:     imageBase64,
        },
      });
    }

    parts.push({ text: prompt });

    const body = {
      contents: [{ parts }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature:     0.85,
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;

    let res, data;
    // Retry up to 3 times on 503/429
    for (let attempt = 0; attempt < 3; attempt++) {
      res  = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      data = await res.json();
      if (res.status !== 503 && res.status !== 429) break;
      await new Promise(r => setTimeout(r, (attempt + 1) * 1500));
    }

    if (!res.ok) {
      const msg = data?.error?.message || JSON.stringify(data);
      return fail(502, `Gemini error: ${msg}`);
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return fail(502, 'Gemini returned empty response');

    return ok({ text });
  }

  return fail(500, `Unknown LLM_PROVIDER: ${provider}`);
};

function ok(body)        { return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(body) }; }
function fail(code, msg) { return { statusCode: code, headers: CORS_HEADERS, body: JSON.stringify({ error: msg }) }; }
