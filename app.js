// ═══════════════════════════════════════════════════════════
//  app.js — KornDog Social Engine
//  Browser-side only. No API keys. No provider config.
//  All LLM calls go through /.netlify/functions/generate
// ═══════════════════════════════════════════════════════════

// ── AI CALL ─────────────────────────────────────────────────
async function generate(payload) {
  const res = await fetch('/.netlify/functions/generate', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  let data;
  try { data = await res.json(); }
  catch { throw new Error('Server returned an unreadable response.'); }

  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);

  const text = (data?.text || '').trim();
  if (!text) throw new Error('Server returned empty text.');
  return text;
}

// ── IMAGE HANDLING ────────────────────────────────────────────
let currentPhoto = null;

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const MAX_BYTES = 3.5 * 1024 * 1024;
    const MAX_DIM   = 1280;

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);

      let quality = 0.85;
      let dataUrl;
      do {
        dataUrl  = canvas.toDataURL('image/jpeg', quality);
        quality -= 0.1;
      } while (dataUrl.length > MAX_BYTES * 1.37 && quality > 0.2);

      const base64 = dataUrl.split(',')[1];
      resolve({ base64, mimeType: 'image/jpeg' });
    };
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}

function handlePhotoSelect(input) {
  const file = input.files?.[0];
  if (!file) return;

  const preview    = document.getElementById('photoPreview');
  const previewImg = document.getElementById('photoPreviewImg');
  const clearBtn   = document.getElementById('photoClearBtn');
  const label      = document.getElementById('photoLabel');

  label.textContent = '⏳ Compressing...';

  compressImage(file)
    .then(({ base64, mimeType }) => {
      currentPhoto = { base64, mimeType };
      previewImg.src = `data:${mimeType};base64,${base64}`;
      preview.style.display = 'block';
      clearBtn.style.display = 'inline-flex';
      label.textContent = '📷 Photo attached';
      label.style.color = 'var(--lime)';
    })
    .catch(err => {
      console.error('[photo]', err);
      showToast('Could not load photo. Try another.');
      label.textContent = '📷 Add a photo';
      label.style.color = '';
    });

  input.value = '';
}

function clearPhoto() {
  currentPhoto = null;
  document.getElementById('photoPreview').style.display  = 'none';
  document.getElementById('photoClearBtn').style.display = 'none';
  const label = document.getElementById('photoLabel');
  label.textContent = '📷 Add a photo';
  label.style.color = '';
}

// ── STATE ────────────────────────────────────────────────────
const state = {
  postType:   'new_arrival',
  platform:   'facebook',
  tone:       'raw',
  count:      1,
  pending:    [],
  queue:      [],
  editTarget: null,
  editIdx:    null,
};

try {
  const savedQueue   = localStorage.getItem('kd_social_queue');
  const savedPending = localStorage.getItem('kd_social_pending');
  if (savedQueue)   state.queue   = JSON.parse(savedQueue);
  if (savedPending) state.pending = JSON.parse(savedPending);
} catch (e) {}

// ── TABS ──────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === 'view-' + tab);
  });
  if (tab === 'swipe') renderSwipe();
  if (tab === 'queue') renderQueue();
}

// ── SELECTORS ─────────────────────────────────────────────────
function selectPostType(el) {
  document.querySelectorAll('.post-type-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  state.postType = el.dataset.type;
}
function selectPlatform(el) {
  document.querySelectorAll('.platform-btn[data-plat]').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  state.platform = el.dataset.plat;
}
function selectTone(el) {
  document.querySelectorAll('.tone-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  state.tone = el.dataset.tone;
}
function selectCount(el) {
  document.querySelectorAll('.platform-btn[data-count]').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  state.count = parseInt(el.dataset.count, 10);
}

// ── PROMPT HELPERS ────────────────────────────────────────────
const POST_TYPE_LABELS = {
  new_arrival:   'New Arrival post',
  sale:          'Sale / Deal post',
  vinyl_therapy: 'Vinyl Therapy culture post',
  spotlight:     'Artist Spotlight post',
  whatsnew:      'Haul Post (just picked these up)',
  engagement:    'Community engagement / question post',
};
const PLATFORM_LABELS = {
  facebook:  'Facebook (conversational, 60-200 words)',
  instagram: 'Instagram (punchy, 40-100 words, strong hashtags)',
  both:      'Facebook AND Instagram — write one version for each, labeled FB: and IG:',
};
const TONE_LABELS = {
  raw:         "Raw & real — blunt, passionate, like talking to a friend at a show",
  hype:        'Hype mode — energetic, ALL CAPS moments, pure vinyl hype',
  nostalgic:   'Nostalgic — evocative, story-driven, makes you feel the weight of the record',
  funny:       'Funny & informal — dry humor, self-aware KornDog personality',
  educational: 'Deep cut — talk about the music, the pressing, the history, the culture',
};

const SALE_TYPES    = new Set(['sale']);
const CULTURE_TYPES = new Set(['vinyl_therapy', 'spotlight', 'engagement', 'whatsnew', 'new_arrival']);

function buildMainPrompt(details, hasPhoto) {
  const isSale     = SALE_TYPES.has(state.postType);
  const hasDetails = details.length > 0;

  return `════ HARD RULE — NEVER BREAK ════
Never invent price, condition, pressing, color variant, quantity, shipping, availability, stock count, release year, edition, or claim details.
If any of those details are missing from what was provided, either omit them entirely or say "DM me for details." Do not fill gaps with plausible-sounding guesses.

════ TASK ════
Post type: ${POST_TYPE_LABELS[state.postType]}
Platform:  ${PLATFORM_LABELS[state.platform]}
Tone:      ${TONE_LABELS[state.tone]}
Count:     ${state.count} post${state.count > 1 ? 's' : ''}

${hasPhoto
  ? `A photo of the record or item has been provided. Use only what you can visually confirm from it — do not assume condition, pressing, or price from the image alone.`
  : ''}
${hasDetails
  ? `Item details (use only what is listed here — do not add to it):\n${details}`
  : `No item details were provided. Do not invent a specific artist, album, price, condition, pressing, quantity, or availability. Write a general KornDog culture/community post instead, unless the selected post type requires item details. If item details are required, say "DM me for details."`}

════ ENDING RULE ════
${isSale
  ? `SALE POST: End with a specific claim action — "comment SOLD", "DM me to claim it", "grab it at korndogrecords.com", or "link in bio." Do NOT end with a question.`
  : `CULTURE/COMMUNITY POST: End with a short, genuine question that invites comments. Make it feel like you actually want to hear the answer.`}

${isSale ? `════ SALE POST RULES ════
- Lead with emotion or story first. Then reveal the record and the deal.
- Use soft selling language: "claim it", "going in the crate", "DM me", "comment SOLD", "link in bio."
- Only include price, condition, format, and claim method IF they appear in the item details above or are clearly visible in the photo.
- If those details are missing, say "DM me for details."` : ''}

════ FORMAT ════
- Include 4-6 hashtags at the end on their own line, after a blank line (always #KorndogRecords #VinylTherapy, rest relevant).
${state.count > 1 ? '- Separate each post with exactly "---POST---" on its own line.' : ''}
- Return ONLY the post text. No intro, no labels like "Post 1:", no markdown, no explanation.`;
}

function buildRegenPrompt(post) {
  const isSale = SALE_TYPES.has(post.type);

  return `════ HARD RULE — NEVER BREAK ════
Never invent price, condition, pressing, color variant, quantity, shipping, availability, stock count, release year, edition, or claim details.
If those details are not present in the original post, do not add them. Say "DM me for details" if needed.

════ ORIGINAL POST ════
${post.text}

════ TASK ════
Write ONE completely different version of the post above.

- Keep the same record, artist, subject, or sale details that exist in the original.
- Do NOT add any new factual details (price, condition, pressing) not already in the original.
- Change the emotional angle completely.
- Try a different opening line.
- Post type is: ${POST_TYPE_LABELS[post.type] || post.type} — keep the same purpose.
- If the original tone was nostalgic → try hype. If hype → try story. If educational → try personal. If funny → try raw.

════ ENDING RULE ════
${isSale
  ? `SALE POST: End with a clear claim action — "comment SOLD", "DM me", "grab it at korndogrecords.com." Do NOT end with a question.`
  : `CULTURE/COMMUNITY POST: End with a genuine question that invites comments.`}

- Include 4-6 hashtags on their own line after a blank line — always #KorndogRecords #VinylTherapy, rest relevant.

Return ONLY the new post text. No labels, no markdown, no explanation.`;
}

// ── GENERATE ─────────────────────────────────────────────────
async function generatePosts() {
  const details    = document.getElementById('detailsInput').value.trim();
  const btn        = document.getElementById('generateBtn');
  const form       = document.getElementById('generateForm');
  const loading    = document.getElementById('loadingState');
  const loadingTxt = document.getElementById('loadingText');

  btn.disabled = true;
  form.style.display = 'none';
  loading.classList.add('active');

  const messages = [
    'Writing your posts...',
    'Channeling the Vinyl Therapy vibe...',
    currentPhoto ? 'Reading your photo...' : 'Digging through the crates...',
    'Adding KornDog sauce...',
    'Almost ready to drop...',
  ];
  let msgIdx = 0;
  const msgTimer = setInterval(() => {
    loadingTxt.textContent = messages[++msgIdx % messages.length];
  }, 1800);

  try {
    const payload = {
      prompt:    buildMainPrompt(details, !!currentPhoto),
      maxTokens: 1000,
    };
    if (currentPhoto) {
      payload.imageBase64   = currentPhoto.base64;
      payload.imageMimeType = currentPhoto.mimeType;
    }

    const raw   = await generate(payload);
    const posts = raw
      .split('---POST---')
      .map(p => p.trim())
      .filter(p => p.length > 20);

    if (posts.length === 0) throw new Error('No usable posts in response.');

    posts.forEach(text => {
      state.pending.push({
        id:        Date.now() + Math.random(),
        text,
        type:      state.postType,
        platform:  state.platform,
        tone:      state.tone,
        photoDataUrl: currentPhoto
          ? `data:${currentPhoto.mimeType};base64,${currentPhoto.base64}`
          : null,
        timestamp: new Date().toISOString(),
      });
    });

    savePending();
    updateBadge();
    showToast(`✦ ${posts.length} post${posts.length > 1 ? 's' : ''} ready to swipe!`);
    setTimeout(() => switchTab('swipe'), 800);

  } catch (err) {
    console.error('[generatePosts]', err);
    showToast('Something went wrong. Try again.');
  } finally {
    clearInterval(msgTimer);
    loading.classList.remove('active');
    form.style.display = 'block';
    btn.disabled = false;
  }
}

// ── SWIPE ─────────────────────────────────────────────────────
let _dragMoveHandler = null;
let _dragEndHandler  = null;

function clearGlobalDragListeners() {
  if (_dragMoveHandler) window.removeEventListener('mousemove', _dragMoveHandler);
  if (_dragEndHandler)  window.removeEventListener('mouseup',   _dragEndHandler);
  _dragMoveHandler = null;
  _dragEndHandler  = null;
}

function renderSwipe() {
  const empty   = document.getElementById('emptySwipe');
  const stack   = document.getElementById('cardStack');
  const actions = document.getElementById('swipeActions');
  const hint    = document.getElementById('swipeHint');
  const counter = document.getElementById('swipeCounter');

  clearGlobalDragListeners();

  const remaining = state.pending.length;
  counter.textContent = remaining > 0
    ? `${remaining} post${remaining > 1 ? 's' : ''} to review`
    : '0 posts to review';

  if (remaining === 0) {
    empty.style.display   = 'flex';
    stack.style.display   = 'none';
    actions.style.display = 'none';
    hint.style.display    = 'none';
    return;
  }

  empty.style.display   = 'none';
  stack.style.display   = 'block';
  actions.style.display = 'flex';
  hint.style.display    = 'block';

  stack.innerHTML = '';
  state.pending.slice(0, 3).forEach((post, i) => {
    stack.appendChild(buildCard(post, i));
  });

  const topCard = stack.querySelector('.card-top');
  if (topCard) attachDrag(topCard);
}

function splitPostText(rawText) {
  const lines      = rawText.split('\n');
  const bodyLines  = [];
  const hashLines  = [];
  let reachedHashBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const tokens  = trimmed.split(/\s+/).filter(Boolean);
    const allHashes = tokens.length > 0 && tokens.every(t => t.startsWith('#'));

    if (allHashes) {
      reachedHashBlock = true;
      hashLines.push(trimmed);
    } else if (reachedHashBlock) {
      bodyLines.push(line);
    } else {
      const lastHashIdx = tokens.findIndex(t => t.startsWith('#'));
      if (lastHashIdx > 0 && tokens.slice(lastHashIdx).every(t => t.startsWith('#'))) {
        bodyLines.push(tokens.slice(0, lastHashIdx).join(' '));
        hashLines.push(tokens.slice(lastHashIdx).join(' '));
        reachedHashBlock = true;
      } else {
        bodyLines.push(line);
      }
    }
  }

  return {
    bodyText: bodyLines.join('\n').trim(),
    hashText: hashLines.join(' ').trim(),
  };
}

function buildCard(post, stackPos) {
  const card = document.createElement('div');
  card.className = 'swipe-card ' + (
    stackPos === 0 ? 'card-top' : stackPos === 1 ? 'card-2' : 'card-3'
  );

  const platEmoji = { facebook: '📘', instagram: '📸', both: '🔗' }[post.platform] || '📱';
  const typeLabel = POST_TYPE_LABELS[post.type] || post.type;
  const toneLabel = (post.tone || '').charAt(0).toUpperCase() + (post.tone || '').slice(1);
  const { bodyText, hashText } = splitPostText(post.text);

  card.innerHTML = `
    <div class="vote-overlay vote-approve">QUEUE ✓</div>
    <div class="vote-overlay vote-reject">TRASH ✕</div>
    <div class="card-sleeve">
      <div class="sleeve-record"></div>
      <div class="sleeve-info">
        <div class="sleeve-type">${escHtml(typeLabel)}</div>
        <div class="sleeve-platform">${platEmoji} ${escHtml(post.platform.charAt(0).toUpperCase() + post.platform.slice(1))}</div>
        <div class="sleeve-tone">Tone: ${escHtml(toneLabel)}</div>
      </div>
      ${stackPos === 0 ? '<button class="sleeve-edit" onclick="openEdit(\'pending\', 0)">Edit</button>' : ''}
    </div>
    ${post.photoDataUrl ? `<img class="card-photo" src="${escHtml(post.photoDataUrl)}" alt="Record photo">` : ''}
    <div class="card-content">
      <div class="card-post-text">${escHtml(bodyText)}</div>
      ${hashText ? `<div class="card-hashtags">${escHtml(hashText)}</div>` : ''}
    </div>
    <div class="card-meta">
      <div class="card-char-count">${post.text.length} chars</div>
      <button class="card-copy-btn" onclick="copyPost(${JSON.stringify(post.text)})">Copy</button>
    </div>
  `;
  return card;
}

function attachDrag(card) {
  let startX = 0, curX = 0, isDrag = false;
  const approveOverlay = card.querySelector('.vote-approve');
  const rejectOverlay  = card.querySelector('.vote-reject');

  function onStart(e) {
    isDrag = true;
    startX = e.touches ? e.touches[0].clientX : e.clientX;
    card.style.transition = 'none';
  }
  function onMove(e) {
    if (!isDrag) return;
    e.preventDefault();
    curX = (e.touches ? e.touches[0].clientX : e.clientX) - startX;
    card.style.transform = `translateX(${curX}px) rotate(${curX * 0.08}deg)`;
    const pct = Math.min(Math.abs(curX) / 100, 1);
    approveOverlay.style.opacity = curX > 0 ? pct : 0;
    rejectOverlay.style.opacity  = curX < 0 ? pct : 0;
  }
  function onEnd() {
    if (!isDrag) return;
    isDrag = false;
    card.style.transition = 'transform 0.4s ease, opacity 0.4s ease';
    if      (curX >  90) flyCard(card, 'approve');
    else if (curX < -90) flyCard(card, 'reject');
    else {
      card.style.transform = '';
      approveOverlay.style.opacity = 0;
      rejectOverlay.style.opacity  = 0;
    }
    curX = 0;
  }

  card.addEventListener('touchstart', onStart, { passive: true });
  card.addEventListener('touchmove',  onMove,  { passive: false });
  card.addEventListener('touchend',   onEnd);
  card.addEventListener('mousedown',  onStart);

  _dragMoveHandler = onMove;
  _dragEndHandler  = onEnd;
  window.addEventListener('mousemove', _dragMoveHandler);
  window.addEventListener('mouseup',   _dragEndHandler);
}

function flyCard(card, direction) {
  card.style.transform = `translateX(${direction === 'approve' ? 600 : -600}px) rotate(${direction === 'approve' ? 25 : -25}deg)`;
  card.style.opacity   = '0';
  setTimeout(() => processVote(direction), 350);
}

function voteCard(direction) {
  const topCard = document.querySelector('#cardStack .card-top');
  if (!topCard) return;
  topCard.style.transition = 'transform 0.35s ease, opacity 0.35s ease';
  flyCard(topCard, direction);
}

function processVote(direction) {
  if (!state.pending.length) return;
  const post = state.pending.shift();
  if (direction === 'approve') {
    state.queue.push(post);
    saveQueue();
    showToast('✓ Added to queue!');
  } else {
    showToast('✕ Trashed');
  }
  savePending();
  updateBadge();
  renderSwipe();
}

async function regenCard() {
  if (!state.pending.length) return;
  const post = state.pending[0];
  showToast('↻ Regenerating...');
  try {
    const newText = await generate({ prompt: buildRegenPrompt(post), maxTokens: 400 });
    state.pending[0].text = newText;
    savePending();
    renderSwipe();
    showToast('✦ Fresh post loaded!');
  } catch (err) {
    console.error('[regenCard]', err);
    showToast('Regen failed. Try again.');
  }
}

// ── BRANDED GRAPHIC GENERATOR ─────────────────────────────────
// Generates a KornDog-branded image combining the record photo
// with the post text overlaid, then downloads it as a JPEG.
// User taps Post Now → saves graphic to camera roll → posts to
// Facebook as a photo post with caption pasted from clipboard.

async function generateBrandedGraphic(post) {
  const { bodyText, hashText } = splitPostText(post.text);

  // Canvas size — square 1080×1080 (works for both FB and IG feed)
  const W = 1080;
  const H = 1080;

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // ── 1. Background ──────────────────────────────────────────
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);

  // ── 2. Record photo (if present) ──────────────────────────
  if (post.photoDataUrl) {
    await new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        // Cover-fit the photo into the top 65% of canvas
        const targetH = H * 0.65;
        const scale   = Math.max(W / img.width, targetH / img.height);
        const sw      = img.width  * scale;
        const sh      = img.height * scale;
        const sx      = (W - sw) / 2;
        const sy      = 0;
        ctx.drawImage(img, sx, sy, sw, sh);
        resolve();
      };
      img.onerror = resolve; // skip silently if broken
      img.src = post.photoDataUrl;
    });

    // Dark gradient over photo — bottom fade into text area
    const grad = ctx.createLinearGradient(0, H * 0.35, 0, H * 0.68);
    grad.addColorStop(0, 'rgba(10,10,10,0)');
    grad.addColorStop(1, 'rgba(10,10,10,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, H * 0.35, W, H * 0.35);
  }

  // ── 3. KornDog banner logo at top ─────────────────────────
  await new Promise(resolve => {
    const logo = new Image();
    logo.crossOrigin = 'anonymous';
    logo.onload = () => {
      // Draw banner across top — height ~80px with padding
      const logoH = 80;
      const logoW = (logo.width / logo.height) * logoH;
      const logoX = (W - logoW) / 2;
      // Semi-transparent dark bar behind logo
      ctx.fillStyle = 'rgba(10,10,10,0.75)';
      ctx.fillRect(0, 0, W, logoH + 24);
      ctx.drawImage(logo, logoX, 12, logoW, logoH);
      resolve();
    };
    logo.onerror = resolve; // skip if CORS blocked
    logo.src = 'https://korndogrecords.com/images/korndog-banner.png';
  });

  // ── 4. Zombie Kitty — bottom right corner ─────────────────
  await new Promise(resolve => {
    const kitty = new Image();
    kitty.crossOrigin = 'anonymous';
    kitty.onload = () => {
      const kH = 140;
      const kW = (kitty.width / kitty.height) * kH;
      ctx.drawImage(kitty, W - kW - 20, H - kH - 20, kW, kH);
      resolve();
    };
    kitty.onerror = resolve;
    kitty.src = 'https://korndogrecords.com/images/zombie-kitty.png';
  });

  // ── 5. Text area background ────────────────────────────────
  const textAreaTop = post.photoDataUrl ? H * 0.63 : 120;
  ctx.fillStyle = 'rgba(10,10,10,0.0)'; // transparent — gradient covers it
  ctx.fillRect(0, textAreaTop, W, H - textAreaTop);

  // Lime green accent bar
  ctx.fillStyle = '#7FD41A';
  ctx.fillRect(48, textAreaTop + 8, 6, post.photoDataUrl ? 160 : 200);

  // ── 6. Body text ───────────────────────────────────────────
  ctx.fillStyle = '#f0f0f0';
  ctx.font      = 'bold 32px Barlow, Arial, sans-serif';
  ctx.textAlign = 'left';

  const textX    = 72;
  const maxWidth = W - textX - 60;
  let   textY    = textAreaTop + 48;
  const lineH    = 44;

  // Word-wrap body text
  const words = bodyText.split(' ');
  let   line  = '';
  const wrappedLines = [];

  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      wrappedLines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) wrappedLines.push(line);

  // Max lines that fit — leave room for hashtags + kitty
  const maxLines = post.photoDataUrl ? 7 : 12;
  const visibleLines = wrappedLines.slice(0, maxLines);
  if (wrappedLines.length > maxLines) {
    visibleLines[maxLines - 1] = visibleLines[maxLines - 1] + '…';
  }

  visibleLines.forEach(l => {
    ctx.fillText(l, textX, textY);
    textY += lineH;
  });

  // ── 7. Hashtags in lime green ──────────────────────────────
  if (hashText) {
    textY += 12;
    ctx.fillStyle = '#7FD41A';
    ctx.font      = 'bold 26px Barlow, Arial, sans-serif';

    // Word-wrap hashtags too
    const hashWords   = hashText.split(' ');
    let   hashLine    = '';
    const hashWrapped = [];
    for (const w of hashWords) {
      const t = hashLine ? hashLine + ' ' + w : w;
      if (ctx.measureText(t).width > maxWidth && hashLine) {
        hashWrapped.push(hashLine);
        hashLine = w;
      } else { hashLine = t; }
    }
    if (hashLine) hashWrapped.push(hashLine);

    hashWrapped.slice(0, 2).forEach(l => {
      ctx.fillText(l, textX, textY);
      textY += 36;
    });
  }

  // ── 8. korndogrecords.com watermark ───────────────────────
  ctx.fillStyle = 'rgba(127,212,26,0.55)';
  ctx.font      = '22px Barlow, Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('korndogrecords.com', 48, H - 28);

  return canvas;
}

// ── POST NOW → Download branded graphic + copy caption ────────
async function postToMeta(post, idx, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '⚙️ Building...'; }

  try {
    showToast('🎨 Generating graphic...');

    const canvas  = await generateBrandedGraphic(post);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

    // Download the graphic
    const a = document.createElement('a');
    a.href     = dataUrl;
    a.download = `korndog-post-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Also copy the caption text to clipboard
    await copyPostSilent(post.text);

    // Show instructions toast
    showToast('📥 Graphic saved! Caption copied — open Facebook & post as photo.');

    // Remove from queue
    state.queue.splice(idx, 1);
    saveQueue();
    updateBadge();
    renderQueue();

  } catch (err) {
    console.error('[postToMeta]', err);
    showToast('Something went wrong building the graphic.');
    if (btn) { btn.disabled = false; btn.textContent = '📲 Post Now'; }
  }
}

// Silent clipboard copy (no toast) — used alongside graphic download
async function copyPostSilent(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch (e) {}
  }
  // Fallback
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
}

// ── QUEUE ─────────────────────────────────────────────────────
function renderQueue() {
  const empty = document.getElementById('queueEmpty');
  const list  = document.getElementById('queueList');

  if (!state.queue.length) {
    empty.style.display = 'block';
    list.innerHTML = '';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = '';

  state.queue.forEach((post, i) => {
    const platEmoji = { facebook: '📘', instagram: '📸', both: '🔗' }[post.platform] || '📱';
    const typeLabel = POST_TYPE_LABELS[post.type] || post.type;
    const { bodyText, hashText } = splitPostText(post.text);

    const item = document.createElement('div');
    item.className = 'queue-item';
    item.dataset.idx = i;
    item.innerHTML = `
      <div class="queue-item-header">
        <div class="queue-item-meta">${escHtml(typeLabel)}</div>
        <div class="queue-item-platform">${platEmoji} ${escHtml(post.platform)}</div>
      </div>
      ${post.photoDataUrl ? `<img class="queue-photo" src="${escHtml(post.photoDataUrl)}" alt="Record photo">` : ''}
      <div class="queue-item-body">
        <div class="queue-item-text">${escHtml(bodyText)}</div>
        ${hashText ? `<div class="queue-item-tags">${escHtml(hashText)}</div>` : ''}
      </div>
      <div class="queue-item-actions">
        <button class="qi-btn qi-copy" data-action="copy">📋 Copy</button>
        <button class="qi-btn qi-post" data-action="post">📲 Post Now</button>
        <button class="qi-btn qi-delete" data-action="delete">🗑</button>
      </div>
    `;

    item.querySelector('[data-action="copy"]').addEventListener('click', () => copyPost(post.text));
    item.querySelector('[data-action="post"]').addEventListener('click', (e) => postToMeta(post, i, e.currentTarget));
    item.querySelector('[data-action="delete"]').addEventListener('click', () => deleteQueued(i));
    list.appendChild(item);
  });
}

function deleteQueued(idx) {
  state.queue.splice(idx, 1);
  saveQueue();
  updateBadge();
  renderQueue();
  showToast('Removed from queue');
}

// ── EDIT MODAL ────────────────────────────────────────────────
function openEdit(target, idx) {
  state.editTarget = target;
  state.editIdx    = idx;
  const post = target === 'pending' ? state.pending[idx] : state.queue[idx];
  document.getElementById('editTextarea').value = post.text;
  document.getElementById('editModal').classList.add('open');
}

function closeModal() {
  document.getElementById('editModal').classList.remove('open');
  state.editTarget = null;
  state.editIdx    = null;
}

function saveEdit() {
  const newText = document.getElementById('editTextarea').value.trim();
  if (!newText) return;
  if (state.editTarget === 'pending') {
    state.pending[state.editIdx].text = newText;
    savePending();
    renderSwipe();
  } else {
    state.queue[state.editIdx].text = newText;
    saveQueue();
    renderQueue();
  }
  closeModal();
  showToast('✦ Post updated!');
}

// ── UTILS ─────────────────────────────────────────────────────
async function copyPost(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('📋 Copied!');
      return;
    } catch (e) {}
  }

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.85);
    z-index:9999;display:flex;align-items:flex-end;
  `;

  overlay.innerHTML = `
    <div style="
      width:100%;background:#1e1e1e;border-radius:20px 20px 0 0;
      padding:20px;max-height:70dvh;overflow-y:auto;
    ">
      <div style="
        width:40px;height:4px;background:#333;border-radius:2px;
        margin:0 auto 16px;
      "></div>
      <div style="
        font-family:'Bebas Neue',sans-serif;font-size:20px;
        color:#7FD41A;letter-spacing:1px;margin-bottom:12px;
      ">Select All & Copy</div>
      <textarea id="copyFallbackTA" readonly style="
        width:100%;background:#141414;border:1.5px solid #7FD41A;
        border-radius:12px;padding:14px;color:#f0f0f0;
        font-family:'Barlow',sans-serif;font-size:14px;
        line-height:1.6;resize:none;min-height:160px;outline:none;
      ">${text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
      <div style="font-size:12px;color:#888;margin:10px 0 16px;">
        Tap the text above → Select All → Copy
      </div>
      <button onclick="this.closest('div[style]').parentElement.remove()" style="
        width:100%;background:#7FD41A;color:#0a0a0a;border:none;
        border-radius:12px;padding:14px;font-family:'Bebas Neue',sans-serif;
        font-size:20px;letter-spacing:1px;cursor:pointer;
      ">DONE</button>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  setTimeout(() => {
    const ta = document.getElementById('copyFallbackTA');
    if (ta) { ta.focus(); ta.select(); }
  }, 100);
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function updateBadge() {
  const badge = document.getElementById('queueBadge');
  badge.textContent = state.queue.length + ' queued';
  badge.classList.toggle('has-items', state.queue.length > 0);
}

function saveQueue() {
  try { localStorage.setItem('kd_social_queue',   JSON.stringify(state.queue));   } catch (e) {}
}
function savePending() {
  try { localStorage.setItem('kd_social_pending', JSON.stringify(state.pending)); } catch (e) {}
}

function escHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

// ── PREFILL FROM DISCOVERY ────────────────────────────────────
function prefillGenerate(details, postType) {
  const ta = document.getElementById('detailsInput');
  if (ta) ta.value = details;

  if (postType) {
    const btn = document.querySelector(`.post-type-btn[data-type="${postType}"]`);
    if (btn) selectPostType(btn);
  }

  switchTab('generate');

  setTimeout(() => {
    const el = document.getElementById('detailsInput');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 200);
}

// ── INIT ──────────────────────────────────────────────────────
updateBadge();
if (state.pending.length > 0) renderSwipe();
