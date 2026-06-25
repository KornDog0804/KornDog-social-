// netlify/functions/post-to-meta.js
//
// Posts text (and optionally a photo) to the KornDog Records
// Facebook Page and/or Instagram Business Account.
//
// Required Netlify Environment Variables:
//   META_PAGE_ACCESS_TOKEN  — Page Access Token from Graph API Explorer
//   META_PAGE_ID            — Facebook Page ID (e.g. 764443310089009)
//
// Optional:
//   META_IG_USER_ID         — Instagram Business Account ID
//                             (if not set, Instagram posting is skipped)
//
// Request body:
//   { message, platform, imageBase64?, imageMimeType? }
//   platform: "facebook" | "instagram" | "both"
//
// Returns:
//   { success: true, facebook?: { id }, instagram?: { id } }
//   { error: "..." } on failure

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

const GRAPH = 'https://graph.facebook.com/v19.0';
const TIMEOUT_MS = 20000;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return fail(405, 'Method not allowed');
  }

  // ── Parse body ──────────────────────────────────────────────
  let message, platform, imageBase64, imageMimeType;
  try {
    ({ message, platform, imageBase64, imageMimeType } = JSON.parse(event.body || '{}'));
  } catch {
    return fail(400, 'Invalid JSON body');
  }

  if (!message || typeof message !== 'string' || !message.trim()) {
    return fail(400, 'message is required');
  }
  if (!['facebook', 'instagram', 'both'].includes(platform)) {
    return fail(400, 'platform must be facebook, instagram, or both');
  }

  const pageToken = process.env.META_PAGE_ACCESS_TOKEN;
  const pageId    = process.env.META_PAGE_ID;
  const igUserId  = process.env.META_IG_USER_ID;

  if (!pageToken) return fail(500, 'META_PAGE_ACCESS_TOKEN not set');
  if (!pageId)    return fail(500, 'META_PAGE_ID not set');

  const hasImage = !!(imageBase64 && imageMimeType);
  const result   = {};

  try {
    // ── FACEBOOK ──────────────────────────────────────────────
    if (platform === 'facebook' || platform === 'both') {
      if (hasImage) {
        // Upload photo first, then attach to post
        const photoId = await uploadPhotoToFacebook(pageId, pageToken, imageBase64, imageMimeType);
        const post    = await postToFacebookWithPhoto(pageId, pageToken, message, photoId);
        result.facebook = { id: post.id };
      } else {
        const post = await postTextToFacebook(pageId, pageToken, message);
        result.facebook = { id: post.id };
      }
    }

    // ── INSTAGRAM ─────────────────────────────────────────────
    if (platform === 'instagram' || platform === 'both') {
      if (!igUserId) {
        result.instagram = { skipped: true, reason: 'META_IG_USER_ID not configured' };
      } else if (!hasImage) {
        // Instagram requires an image for feed posts
        result.instagram = { skipped: true, reason: 'Instagram feed posts require an image' };
      } else {
        // Instagram needs a publicly accessible image URL — upload to FB first
        const fbImageUrl = await getPublicImageUrl(pageId, pageToken, imageBase64, imageMimeType);
        const igPost     = await postToInstagram(igUserId, pageToken, message, fbImageUrl);
        result.instagram = { id: igPost.id };
      }
    }

    return ok({ success: true, ...result });

  } catch (err) {
    console.error('[post-to-meta]', err.message);
    return fail(500, 'Posting failed. Check server logs.');
  }
};

// ── Facebook helpers ──────────────────────────────────────────

async function postTextToFacebook(pageId, token, message) {
  const res = await fetchWithTimeout(`${GRAPH}/${pageId}/feed`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, access_token: token }),
  });
  return parseJSON(res, 'Facebook feed');
}

async function uploadPhotoToFacebook(pageId, token, base64, mimeType) {
  // Upload as unpublished photo, get photo ID to attach to post
  const res = await fetchWithTimeout(`${GRAPH}/${pageId}/photos`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: token,
      published:    false,
      source:       `data:${mimeType};base64,${base64}`,
    }),
  });
  const data = await parseJSON(res, 'Facebook photo upload');
  return data.id;
}

async function postToFacebookWithPhoto(pageId, token, message, photoId) {
  const res = await fetchWithTimeout(`${GRAPH}/${pageId}/feed`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      access_token:        token,
      attached_media:      [{ media_fbid: photoId }],
    }),
  });
  return parseJSON(res, 'Facebook post with photo');
}

async function getPublicImageUrl(pageId, token, base64, mimeType) {
  // Upload photo published to get a public URL for Instagram
  const res = await fetchWithTimeout(`${GRAPH}/${pageId}/photos`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: token,
      published:    true,
      source:       `data:${mimeType};base64,${base64}`,
    }),
  });
  const data    = await parseJSON(res, 'Facebook photo for IG');
  const photoId = data.id;

  // Get the URL of the uploaded photo
  const urlRes  = await fetchWithTimeout(`${GRAPH}/${photoId}?fields=images&access_token=${token}`, {
    method: 'GET',
  });
  const urlData = await parseJSON(urlRes, 'Facebook photo URL');
  return urlData?.images?.[0]?.source;
}

// ── Instagram helpers ─────────────────────────────────────────

async function postToInstagram(igUserId, token, caption, imageUrl) {
  // Step 1: Create media container
  const containerRes = await fetchWithTimeout(`${GRAPH}/${igUserId}/media`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url:    imageUrl,
      caption,
      access_token: token,
    }),
  });
  const container = await parseJSON(containerRes, 'Instagram media container');

  // Step 2: Publish the container
  const publishRes = await fetchWithTimeout(`${GRAPH}/${igUserId}/media_publish`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id:  container.id,
      access_token: token,
    }),
  });
  return parseJSON(publishRes, 'Instagram publish');
}

// ── Shared helpers ────────────────────────────────────────────

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Meta API request timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function parseJSON(res, label) {
  let data;
  try { data = await res.json(); } catch {
    throw new Error(`${label} returned non-JSON (${res.status})`);
  }
  if (!res.ok) {
    const detail = data?.error?.message || JSON.stringify(data);
    throw new Error(`${label} error ${res.status}: ${detail}`);
  }
  return data;
}

function ok(body)         { return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(body) }; }
function fail(code, msg)  { return { statusCode: code, headers: CORS_HEADERS, body: JSON.stringify({ error: msg }) }; }
