// ═══════════════════════════════════════════════════════════
//  app.js — KornDog Social Engine
//  One Scan · Two Joeys · One Engine
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

// ═══════════════════════════════════════════════════════════
//  ONE SCAN · TWO JOEYS
//  Single AI call → powers both Social and Therapy outputs
// ═══════════════════════════════════════════════════════════

let _scanPhoto     = null;  // { base64, mimeType, dataUrl }
let _scanResult    = null;  // the parsed AI response object
let _scanSessNum   = parseInt(localStorage.getItem('kd_scan_session') || '0', 10);
let _currentOutput = null;  // 'social' | 'therapy'

// ── Session number ────────────────────────────────────────
function _getScanSession() {
  return String(_scanSessNum + 1).padStart(3, '0');
}
function _confirmScanSession() {
  _scanSessNum += 1;
  localStorage.setItem('kd_scan_session', _scanSessNum);
}

// ── Photo upload ──────────────────────────────────────────
function handleScanPhoto(input) {
  const file = input.files?.[0];
  if (!file) return;

  setScanStatus('⏳ Loading photo...');
  document.getElementById('scanBtn').disabled = true;
  document.getElementById('scanBtn').classList.remove('ready');

  const objectUrl = URL.createObjectURL(file);
  const img = new Image();

  img.onload = () => {
    // Compress to max 1280px, quality 0.85
    const MAX = 1280;
    let { naturalWidth: w, naturalHeight: h } = img;
    if (w > MAX || h > MAX) {
      const r = Math.min(MAX / w, MAX / h);
      w = Math.round(w * r); h = Math.round(h * r);
    }
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(objectUrl);

    const dataUrl = cv.toDataURL('image/jpeg', 0.85);
    _scanPhoto = {
      base64:  dataUrl.split(',')[1],
      mimeType: 'image/jpeg',
      dataUrl,
    };

    setScanStatus('✅ Photo ready — tap to scan!');
    document.getElementById('scanBtn').disabled = false;
    document.getElementById('scanBtn').classList.add('ready');

    // Show mini thumb in upload zone
    document.getElementById('scanUploadZone').style.backgroundImage = `url(${dataUrl})`;
    document.getElementById('scanUploadZone').style.backgroundSize  = 'cover';
    document.getElementById('scanUploadZone').style.backgroundPosition = 'center';
    document.getElementById('scanUploadZone').querySelector('.scan-upload-icon').textContent  = '✅';
    document.getElementById('scanUploadZone').querySelector('.scan-upload-title').textContent = 'PHOTO LOADED';
    document.getElementById('scanUploadZone').querySelector('.scan-upload-sub').textContent   = 'Tap to change · Ready to scan';
  };
  img.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    // FileReader fallback (Google Photos content URIs)
    const reader = new FileReader();
    reader.onload = e => {
      const img2 = new Image();
      img2.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = img2.naturalWidth; cv.height = img2.naturalHeight;
        cv.getContext('2d').drawImage(img2, 0, 0);
        const dataUrl = cv.toDataURL('image/jpeg', 0.85);
        _scanPhoto = { base64: dataUrl.split(',')[1], mimeType: 'image/jpeg', dataUrl };
        setScanStatus('✅ Photo ready — tap to scan!');
        document.getElementById('scanBtn').disabled = false;
        document.getElementById('scanBtn').classList.add('ready');
      };
      img2.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };
  img.src = objectUrl;
  input.value = '';
}

function setScanStatus(msg) {
  document.getElementById('scanStatus').textContent = msg;
}

// ── THE ONE SCAN ──────────────────────────────────────────
async function runScan() {
  if (!_scanPhoto) return;

  const loading = document.getElementById('scanLoading');
  const loadTxt = document.getElementById('scanLoadingText');
  loading.classList.add('active');

  const msgs = [
    'READING THE RECORD...',
    'IDENTIFYING ARTIST & ALBUM...',
    'WRITING SOCIAL JOEY...',
    'WRITING THERAPY JOEY...',
    'CALCULATING THERAPY SCORE...',
    'ALMOST DONE...',
  ];
  let mi = 0;
  const ticker = setInterval(() => { loadTxt.textContent = msgs[++mi % msgs.length]; }, 1600);

  try {
    const prompt = `You are the KornDog Records AI. Analyze this vinyl record cover photo.

Return ONLY a valid JSON object with these EXACT fields — no markdown, no explanation:

{
  "artist": "Full artist name from the cover",
  "album": "Full album title from the cover",
  "genre": "One or two words: Blues, Rock, Soul, Metal, Hip-Hop, Jazz, Country, R&B, Funk, Punk, etc",
  "era": "Decade or era: 60s Soul, 70s Rock, 80s Metal, 90s Hip-Hop, etc",
  "mood": "3-5 word atmospheric vibe: '2AM whiskey and hard truths', 'Smoke-filled club soul', etc",
  "joeySocial": "Joey behind the counter, excited, talking to another collector. Short. Fun. Conversational. Built to stop scrolling. 25-50 words. First person. Like he just found this in the crate. Examples: 'Man...this bassline has no business sounding this good.' / 'If this one is sitting in your bin, you are sleeping.' / 'Put this on at 11PM. Thank me later.' NEVER use: This album, Fans of, Must-have, Iconic, Legendary, Showcases, Features.",
  "joeyTherapy": "Joey alone after closing, reflective, thinking about why this record matters. Longer. More emotional. Thoughtful. Not selling — preserving the feeling. 50-80 words. Like a note to himself. Examples: 'Some records find you at the right moment. This is one of those.' / 'B.B. and Bobby don't sing songs. They testify. When two old kings meet on stage, you don't get a show. You get church.' NEVER use: This album, Fans of, Must-have, Iconic, Legendary.",
  "therapyScore": "Number 1.0-10.0 based on emotional impact and cultural weight",
  "kittyPick": "One of: Crate Gold, Late Night Spin, Sunday Morning, Heavy Rotation, Deep Cut, Store Favorite, Therapy Classic, Dusty Gem, Wall Worthy, Keeper Copy",
  "hashtags": "#KorndogRecords #VinylTherapy plus 3-4 more relevant tags as a single string"
}

If you cannot read the cover clearly, make your best guess. Always return valid JSON only.`;

    console.log('[scan] firing AI call', { imageLength: _scanPhoto.base64.length });

    const raw = await generate({
      prompt,
      maxTokens:     1200,
      imageBase64:   _scanPhoto.base64,
      imageMimeType: _scanPhoto.mimeType,
    });

    console.log('[scan] raw response:', raw);

    const clean = raw.replace(/```json|```/g, '').trim();
    let result;
    try {
      result = JSON.parse(clean);
    } catch (e) {
      console.error('[scan] JSON parse fail:', raw);
      throw new Error('AI returned invalid JSON. Try again.');
    }

    _scanResult = result;
    showScanResults();

  } catch (err) {
    console.error('[scan]', err);
    setScanStatus('❌ ' + (err.message || 'Scan failed. Try again.'));
  } finally {
    clearInterval(ticker);
    loading.classList.remove('active');
  }
}

// ── Show results layer ────────────────────────────────────
function showScanResults() {
  const r = _scanResult;
  if (!r) return;

  // Album thumb
  document.getElementById('scanThumb').src = _scanPhoto.dataUrl;

  // Info
  document.getElementById('scanArtist').textContent    = (r.artist || '').toUpperCase();
  document.getElementById('scanAlbumTitle').textContent = r.album || '';
  document.getElementById('scanMeta').textContent       = [r.genre, r.era].filter(Boolean).join(' · ');
  document.getElementById('scanScore').textContent      = r.therapyScore || '—';
  document.getElementById('scanKitty').textContent      = r.kittyPick || '—';
  document.getElementById('scanVibe').textContent       = r.mood || '—';
  document.getElementById('scanJoeyPreview').textContent = r.joeySocial || '';
  document.getElementById('scanSessionLabel').textContent = '#' + _getScanSession();

  document.getElementById('scanLayer').classList.add('active');
}

function closeScanLayer() {
  document.getElementById('scanLayer').classList.remove('active');
}

// ── Open output ───────────────────────────────────────────
function openOutput(mode) {
  _currentOutput = mode;
  const sheet    = document.getElementById('outputSheet');
  const label    = document.getElementById('outputModeLabel');
  const social   = document.getElementById('socialOutput');
  const therapy  = document.getElementById('therapyOutput');

  label.textContent = mode === 'social' ? '📸 SOCIAL' : '🎴 THERAPY';
  label.className   = 'output-mode-label ' + mode;

  social.style.display  = mode === 'social'  ? 'flex' : 'none';
  therapy.style.display = mode === 'therapy' ? 'flex' : 'none';

  sheet.classList.add('active');

  if (mode === 'social') {
    renderSocialOutput();
  } else {
    renderTherapyCard();
  }
}

function closeOutput() {
  document.getElementById('outputSheet').classList.remove('active');
}

// ─────────────────────────────────────────────────────────
//  OUTPUT 1: SOCIAL MODE
//  Album art is the hero. Caption lives below. No text on image.
// ─────────────────────────────────────────────────────────
function renderSocialOutput() {
  const r = _scanResult;
  // Album image — just show the clean cover art
  document.getElementById('socialAlbumImg').src = _scanPhoto.dataUrl;

  // Caption = joeySocial + hashtags
  document.getElementById('socialCaptionText').textContent = r.joeySocial || '';
  document.getElementById('socialHashtags').textContent    = r.hashtags   || '';
}

async function downloadSocial() {
  const r = _scanResult;

  // Confirm session number before building filename
  if (!_sessionConfirmed) {
    _confirmScanSession();
    _sessionConfirmed = true;
  }
  const sessStr = String(_scanSessNum).padStart(3, '0');

  const W = 1080, H = 1080;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // Draw album art — cover fill, centered
  await new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.max(W / img.width, H / img.height);
      const sw = img.width * scale, sh = img.height * scale;
      ctx.drawImage(img, (W - sw) / 2, (H - sh) / 2, sw, sh);
      resolve();
    };
    img.onerror = resolve;
    img.src = _scanPhoto.dataUrl;
  });

  // Tiny KornDog watermark bug — bottom right only, never covers art
  ctx.fillStyle = 'rgba(10,10,10,0.6)';
  ctx.beginPath();
  ctx.arc(W - 46, H - 46, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '30px Arial'; ctx.textAlign = 'center';
  ctx.fillText('🐱', W - 46, H - 36);

  // korndogrecords.com micro watermark bottom left
  ctx.fillStyle = 'rgba(127,212,26,0.5)';
  ctx.font = '18px Arial'; ctx.textAlign = 'left';
  ctx.fillText('korndogrecords.com', 20, H - 18);

  let dataUrl;
  try { dataUrl = cv.toDataURL('image/jpeg', 0.93); }
  catch (e) { showToast('❌ Download failed: ' + e.message); return; }

  const fname = `korndog-social-${sessStr}-${(r.artist || 'record').toLowerCase().replace(/[^a-z0-9]/g,'-').slice(0,25)}.jpg`;

  // Mobile-safe download: try anchor click, fallback to opening in new tab
  try {
    const a = document.createElement('a');
    a.href = dataUrl; a.download = fname;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  } catch(e) {
    // Fallback for Android WebView — open in new tab so user can long-press save
    const w = window.open(); w.document.write(`<img src="${dataUrl}" style="max-width:100%">`);
  }

  // Copy caption
  const caption = (r.joeySocial || '') + '\n\n' + (r.hashtags || '');
  copySilent(caption);
  showToast('📥 Image saved! Caption copied.');
}

async function copySocialCaption() {
  const r = _scanResult;
  const caption = (r.joeySocial || '') + '\n\n' + (r.hashtags || '');
  await copyPost(caption);
}

// ─────────────────────────────────────────────────────────
//  OUTPUT 2: THERAPY CARD
//  PSA slab collectible. joeyTherapy voice. Canvas render.
// ─────────────────────────────────────────────────────────
let _sessionConfirmed = false;

async function renderTherapyCard() {
  const r    = _scanResult;
  const sess = _getScanSession();

  const W        = 1080;
  const SLAB_PAD = 20;
  const IX       = SLAB_PAD + 14;
  const IW       = W - (SLAB_PAD + 14) * 2;
  const LABEL_H  = 138;
  const PHOTO_H  = 600; // taller = more album art visible
  const STATS_H  = 260;
  const FOOT_H   = 70;
  const GAP      = 8;
  const IY       = SLAB_PAD + 14;
  const H        = IY + LABEL_H + GAP + PHOTO_H + GAP + STATS_H + GAP + FOOT_H + SLAB_PAD + 14;

  const LIME   = '#7FD41A';
  const PURPLE = '#4a1a8a';
  const DARK   = '#0a0a0a';
  const CREAM  = '#f0ead6';
  const PANEL  = '#111111';

  const PHOTO_Y = IY + LABEL_H + GAP;
  const STATS_Y = PHOTO_Y + PHOTO_H + GAP;
  const FOOT_Y  = STATS_Y + STATS_H + GAP;

  const canvas  = document.getElementById('therapyCanvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx     = canvas.getContext('2d');

  // Load photo only — no external URLs
  const photoImg = await new Promise(resolve => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = _scanPhoto.dataUrl;
  });

  function wrapText(txt, maxW, font) {
    ctx.font = font;
    const words = (txt || '').split(' ');
    const lines = []; let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function roundRect(x, y, w, h, r2) {
    ctx.beginPath();
    ctx.moveTo(x+r2,y); ctx.lineTo(x+w-r2,y);
    ctx.quadraticCurveTo(x+w,y,x+w,y+r2);
    ctx.lineTo(x+w,y+h-r2);
    ctx.quadraticCurveTo(x+w,y+h,x+w-r2,y+h);
    ctx.lineTo(x+r2,y+h);
    ctx.quadraticCurveTo(x,y+h,x,y+h-r2);
    ctx.lineTo(x,y+r2);
    ctx.quadraticCurveTo(x,y,x+r2,y);
    ctx.closePath();
  }

  // ── Slab shell ────────────────────────────────────────
  ctx.fillStyle = '#1c1c1c';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = DARK;
  roundRect(SLAB_PAD, SLAB_PAD, W-SLAB_PAD*2, H-SLAB_PAD*2, 16);
  ctx.fill();
  ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 2;
  roundRect(SLAB_PAD, SLAB_PAD, W-SLAB_PAD*2, H-SLAB_PAD*2, 16);
  ctx.stroke();

  // ── PSA label bar ─────────────────────────────────────
  ctx.fillStyle = CREAM;
  roundRect(IX, IY, IW, LABEL_H, 10); ctx.fill();
  ctx.fillStyle = PURPLE;
  roundRect(IX, IY, IW, 16, 10); ctx.fill();
  ctx.fillRect(IX, IY+8, IW, 8);

  // KornDog text logo (no image load = no CORS)
  ctx.fillStyle = '#0a0a0a';
  ctx.font      = 'bold 14px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('KORNDOG', IX+12, IY+36);
  ctx.fillStyle = PURPLE;
  ctx.font      = 'bold 11px Arial, sans-serif';
  ctx.fillText('RECORDS', IX+12, IY+50);
  // Lime circle as logo placeholder
  ctx.fillStyle = LIME;
  ctx.beginPath(); ctx.arc(IX+52, IY+78, 32, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.font      = '26px Arial'; ctx.textAlign = 'center';
  ctx.fillText('🎵', IX+52, IY+88);

  // Label text
  const LTX = IX + 100;
  const LTW = IW - 150;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#333'; ctx.font = 'bold 18px Arial, sans-serif';
  ctx.fillText('1990 KORNDOG', LTX, IY+38);
  ctx.fillStyle = PURPLE; ctx.font = 'bold 18px Arial, sans-serif';
  ctx.fillText(`  #${sess}`, LTX + ctx.measureText('1990 KORNDOG').width, IY+38);

  ctx.fillStyle = '#111'; ctx.font = 'bold 28px Arial Black, Arial, sans-serif';
  const artistLines = wrapText((r.artist||'').toUpperCase(), LTW, 'bold 28px Arial Black, Arial, sans-serif');
  artistLines.slice(0,2).forEach((l,i) => ctx.fillText(l, LTX, IY+66+i*30));

  ctx.fillStyle = PURPLE; ctx.font = 'italic bold 17px Arial, sans-serif';
  ctx.fillText((r.album||'').toUpperCase(), LTX, IY+66+Math.min(artistLines.length,2)*30+2);

  // Deterministic barcode
  const bcY = IY+LABEL_H-24;
  const bseed = sess+(r.artist||'')+(r.album||'');
  for (let b=0; b<55; b++) {
    const code=bseed.charCodeAt(b%bseed.length);
    ctx.fillStyle='#333';
    ctx.fillRect(LTX+b*2.4, bcY, code%3===0?3:code%2===0?2:1, 10);
  }
  ctx.fillStyle='#666'; ctx.font='9px monospace';
  ctx.fillText('VINYL THERAPY SESSION', LTX+145, bcY+10);

  // GEM MT
  const GX = IX+IW-120;
  ctx.fillStyle='#222'; ctx.font='bold 14px Arial, sans-serif'; ctx.textAlign='center';
  ctx.fillText('GEM MT', GX+50, IY+40);
  ctx.font='bold 60px Arial Black, Arial, sans-serif';
  ctx.fillText('10', GX+50, IY+112);

  // ── Gold frame + photo ────────────────────────────────
  const CARD_PAD = 10;
  const grd = ctx.createLinearGradient(IX, PHOTO_Y, IX+IW, PHOTO_Y+PHOTO_H);
  grd.addColorStop(0,'#f0c040'); grd.addColorStop(0.4,'#c9a227');
  grd.addColorStop(0.8,'#e8b820'); grd.addColorStop(1,'#906810');
  ctx.fillStyle = grd;
  roundRect(IX, PHOTO_Y, IW, PHOTO_H, 10); ctx.fill();

  if (photoImg) {
    const pX=IX+CARD_PAD, pY=PHOTO_Y+CARD_PAD;
    const pW=IW-CARD_PAD*2, pH=PHOTO_H-CARD_PAD*2;

    // Contain: show 90%+ of album art — fill frame width, let height be natural
    // Use Math.min (contain) so the full cover is visible inside the gold border
    const scaleContain = Math.min(pW / photoImg.width, pH / photoImg.height);
    // If contain leaves big letterbox gaps, blend toward cover but cap at 1.08x
    const scaleCover   = Math.max(pW / photoImg.width, pH / photoImg.height);
    const scale        = scaleCover / scaleContain <= 1.25
      ? scaleCover   // art fills frame cleanly with minimal cropping
      : scaleContain; // very portrait/landscape art — use contain to show full art

    const sw = photoImg.width  * scale;
    const sh = photoImg.height * scale;

    // Dark fill behind any letterbox areas
    ctx.fillStyle = '#0a0a0a';
    ctx.save();
    roundRect(pX,pY,pW,pH,6); ctx.clip();
    ctx.fillRect(pX,pY,pW,pH);
    ctx.drawImage(photoImg, pX+(pW-sw)/2, pY+(pH-sh)/2, sw, sh);
    ctx.restore();
  } else {
    ctx.fillStyle='#1a1a1a';
    roundRect(IX+CARD_PAD,PHOTO_Y+CARD_PAD,IW-CARD_PAD*2,PHOTO_H-CARD_PAD*2,6); ctx.fill();
  }

  // REAL MUSIC badge
  const bdX=IX+IW-92, bdY=PHOTO_Y+PHOTO_H-92;
  ctx.save(); ctx.beginPath(); ctx.arc(bdX,bdY,44,0,Math.PI*2);
  ctx.fillStyle=LIME; ctx.fill();
  ctx.strokeStyle='#0a0a0a'; ctx.lineWidth=3; ctx.stroke(); ctx.restore();
  ctx.fillStyle='#0a0a0a'; ctx.font='bold 11px Arial Black, Arial, sans-serif'; ctx.textAlign='center';
  ['REAL','MUSIC.','REAL','SOUL.'].forEach((t,i)=>ctx.fillText(t,bdX,bdY-14+i*14));

  // ── Stats panel ───────────────────────────────────────
  ctx.fillStyle=PANEL;
  roundRect(IX,STATS_Y,IW,STATS_H,8); ctx.fill();
  ctx.strokeStyle='#252525'; ctx.lineWidth=1.5;
  roundRect(IX,STATS_Y,IW,STATS_H,8); ctx.stroke();

  const COL_W=IW/3;
  [1,2].forEach(n=>{
    ctx.strokeStyle='#252525'; ctx.lineWidth=1.5;
    ctx.beginPath();
    ctx.moveTo(IX+COL_W*n,STATS_Y+12); ctx.lineTo(IX+COL_W*n,STATS_Y+STATS_H-12);
    ctx.stroke();
  });

  // COL 1 — Genre / Mood / Era — extra padding clears slab border
  const C1X=IX+22;
  function statBlock(label,value,x,y,maxW) {
    ctx.fillStyle='#666'; ctx.font='bold 11px Arial, sans-serif'; ctx.textAlign='left';
    ctx.fillText(label,x,y);
    ctx.fillStyle='#eee'; ctx.font='bold 19px Arial Black, Arial, sans-serif';
    const lines=wrapText((value||'').toUpperCase(),maxW,'bold 19px Arial Black, Arial, sans-serif');
    lines.slice(0,2).forEach((l,i)=>ctx.fillText(l,x,y+20+i*23));
    ctx.fillStyle=LIME;
    const ulY=y+22+Math.max(0,lines.length-1)*23+4;
    ctx.fillRect(x,ulY,Math.min(ctx.measureText(lines[0]||'').width+4,maxW),2);
    return ulY+16;
  }
  const statGap=(STATS_H-20)/3;
  statBlock('GENRE',  r.genre||'',  C1X, STATS_Y+16,           COL_W-24);
  statBlock('ERA',    r.era||'',    C1X, STATS_Y+16+statGap,   COL_W-24);
  statBlock('VIBE',   r.mood||'',   C1X, STATS_Y+16+statGap*2, COL_W-24);

  // COL 2 — Joey Therapy (the deeper voice)
  const C2X=IX+COL_W+14, C2W=COL_W-28;
  let c2Y=STATS_Y+18;
  ctx.fillStyle=LIME; ctx.font='italic bold 20px Georgia, serif'; ctx.textAlign='left';
  ctx.fillText('JOEY SAYS:', C2X, c2Y+16); c2Y+=30;
  ctx.fillStyle='rgba(127,212,26,0.1)'; ctx.font='bold 80px Georgia, serif';
  ctx.fillText('"', C2X-5, c2Y+65);
  ctx.fillStyle='#d0d0d0'; ctx.font='20px Arial, sans-serif';
  const jLines=(r.joeyTherapy||'').split('\n').flatMap(l=>wrapText(l,C2W,'20px Arial, sans-serif'));
  c2Y+=8;
  jLines.slice(0,8).forEach(l=>{ ctx.fillText(l,C2X,c2Y); c2Y+=26; });

  // COL 3 — Scores
  const C3X=IX+COL_W*2+14, C3W=COL_W-24;
  let c3Y=STATS_Y+18;

  function scoreBlock(label,value,y) {
    ctx.fillStyle='#555'; ctx.font='bold 12px Arial, sans-serif'; ctx.textAlign='left';
    ctx.fillText(label,C3X,y);
    ctx.fillStyle='#eee'; ctx.font='bold 25px Arial Black, Arial, sans-serif';
    ctx.fillText(value,C3X,y+26);
    ctx.fillStyle='#252525'; ctx.fillRect(C3X,y+34,C3W,1);
    return y+50;
  }

  ctx.fillStyle=LIME; ctx.font='bold 11px Arial, sans-serif'; ctx.textAlign='left';
  ctx.fillText('💜 THERAPY SCORE', C3X, c3Y); c3Y+=10;
  const scoreBY=c3Y+50;
  ctx.fillStyle='#fff'; ctx.font='bold 52px Arial Black, Arial, sans-serif';
  ctx.fillText(r.therapyScore||'9.5', C3X, scoreBY);
  ctx.fillStyle=LIME; ctx.font='bold 20px Arial, sans-serif';
  ctx.fillText('/10', C3X+(()=>{
    ctx.font='bold 52px Arial Black, Arial, sans-serif';
    const w=ctx.measureText(r.therapyScore||'9.5').width;
    ctx.font='bold 20px Arial, sans-serif'; return w;
  })()+4, scoreBY);
  ctx.fillStyle='#252525'; ctx.fillRect(C3X,scoreBY+8,C3W,1);
  c3Y=scoreBY+20;

  c3Y=scoreBlock('💿 VINYL GRADE', 'VG+', c3Y);

  ctx.fillStyle=LIME; ctx.font='bold 12px Arial, sans-serif';
  ctx.fillText('🐱 KITTY PICK', C3X, c3Y);
  ctx.fillStyle='#eee'; ctx.font='bold 17px Arial Black, Arial, sans-serif';
  wrapText((r.kittyPick||'').toUpperCase(),C3W,'bold 17px Arial Black, Arial, sans-serif')
    .slice(0,2).forEach((l,i)=>ctx.fillText(l,C3X,c3Y+20+i*20));

  // ── Footer ────────────────────────────────────────────
  ctx.fillStyle=LIME;
  roundRect(IX,FOOT_Y,IW,FOOT_H,8); ctx.fill();
  ctx.fillStyle='#0a0a0a'; ctx.font='bold 15px Arial Black, Arial, sans-serif'; ctx.textAlign='left';
  ctx.fillText('RAW GROOVES. REAL REVIEWS. ZERO FLUFF.', IX+16, FOOT_Y+FOOT_H/2+6);
  ctx.font='bold 13px Arial, sans-serif'; ctx.textAlign='right';
  ctx.fillText('★ korndogrecords.com ★', IX+IW-16, FOOT_Y+FOOT_H/2+6);
}

async function downloadTherapy() {
  if (!_sessionConfirmed) {
    _confirmScanSession();
    _sessionConfirmed = true;
  }
  // Re-render with confirmed session
  await renderTherapyCard();

  const canvas  = document.getElementById('therapyCanvas');
  let dataUrl;
  try { dataUrl = canvas.toDataURL('image/jpeg', 0.93); }
  catch (e) { showToast('❌ Download failed: ' + e.message); return; }

  const r = _scanResult;
  const a = document.createElement('a');
  a.href     = dataUrl;
  a.download = `korndog-therapy-${_getScanSession()}-${(r.artist||'record').toLowerCase().replace(/[^a-z0-9]/g,'-').slice(0,25)}.jpg`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);

  // Copy joeyTherapy caption
  const caption = (r.joeyTherapy||'') + '\n\n' + (r.hashtags||'') + '\n\nkorndogrecords.com';
  copySilent(caption);
  showToast('🎴 Card saved! Caption copied.');
}

async function copyTherapyCaption() {
  const r = _scanResult;
  const caption = (r.joeyTherapy||'') + '\n\n' + (r.hashtags||'') + '\n\nkorndogrecords.com';
  await copyPost(caption);
}

function openEditFields() {
  // For now, close scan layer — user can rescan with different details
  // Future: inline edit of extracted fields
  closeScanLayer();
  showToast('Rescan with a clearer photo, or edit fields below.');
}

// ── Silent copy helper ────────────────────────────────────
async function copySilent(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch(e) {}
  }
  const ta = document.createElement('textarea');
  ta.value=text; ta.style.cssText='position:fixed;opacity:0;top:0;left:0;';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand('copy'); } catch(e) {}
  document.body.removeChild(ta);
}

// ═══════════════════════════════════════════════════════════
//  EXISTING SOCIAL ENGINE (unchanged)
// ═══════════════════════════════════════════════════════════

// ── IMAGE HANDLING ───────────────────────────────────────
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
        width = Math.round(width*ratio); height = Math.round(height*ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width=width; canvas.height=height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      let quality=0.85, dataUrl;
      do { dataUrl=canvas.toDataURL('image/jpeg',quality); quality-=0.1; }
      while (dataUrl.length > MAX_BYTES*1.37 && quality>0.2);
      resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
    };
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}

function handlePhotoSelect(input) {
  const file = input.files?.[0];
  if (!file) return;
  const preview=document.getElementById('photoPreview');
  const previewImg=document.getElementById('photoPreviewImg');
  const clearBtn=document.getElementById('photoClearBtn');
  const label=document.getElementById('photoLabel');
  label.textContent='⏳ Compressing...';
  compressImage(file)
    .then(({base64,mimeType})=>{
      currentPhoto={base64,mimeType};
      previewImg.src=`data:${mimeType};base64,${base64}`;
      preview.style.display='block';
      clearBtn.style.display='inline-flex';
      label.textContent='📷 Photo attached';
      label.style.color='var(--lime)';
    })
    .catch(err=>{ console.error('[photo]',err); showToast('Could not load photo.'); label.textContent='📷 Add a photo'; label.style.color=''; });
  input.value='';
}

function clearPhoto() {
  currentPhoto=null;
  document.getElementById('photoPreview').style.display='none';
  document.getElementById('photoClearBtn').style.display='none';
  const label=document.getElementById('photoLabel');
  label.textContent='📷 Add a photo'; label.style.color='';
}

// ── STATE ────────────────────────────────────────────────
const state = {
  postType:'new_arrival', platform:'facebook', tone:'raw', count:1,
  pending:[], queue:[], editTarget:null, editIdx:null,
};
try {
  const sq=localStorage.getItem('kd_social_queue');
  const sp=localStorage.getItem('kd_social_pending');
  if (sq) state.queue=JSON.parse(sq);
  if (sp) state.pending=JSON.parse(sp);
} catch(e) {}

// ── TABS ─────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='view-'+tab));
  if (tab==='swipe') renderSwipe();
  if (tab==='queue') renderQueue();
}

// ── SELECTORS ────────────────────────────────────────────
function selectPostType(el) { document.querySelectorAll('.post-type-btn').forEach(b=>b.classList.remove('selected')); el.classList.add('selected'); state.postType=el.dataset.type; }
function selectPlatform(el) { document.querySelectorAll('.platform-btn[data-plat]').forEach(b=>b.classList.remove('selected')); el.classList.add('selected'); state.platform=el.dataset.plat; }
function selectTone(el)     { document.querySelectorAll('.tone-btn').forEach(b=>b.classList.remove('selected')); el.classList.add('selected'); state.tone=el.dataset.tone; }
function selectCount(el)    { document.querySelectorAll('.platform-btn[data-count]').forEach(b=>b.classList.remove('selected')); el.classList.add('selected'); state.count=parseInt(el.dataset.count,10); }

// ── PROMPTS ──────────────────────────────────────────────
const POST_TYPE_LABELS = {
  new_arrival:'New Arrival post', sale:'Sale / Deal post',
  vinyl_therapy:'Vinyl Therapy culture post', spotlight:'Artist Spotlight post',
  whatsnew:'Haul Post (just picked these up)', engagement:'Community engagement / question post',
};
const PLATFORM_LABELS = {
  facebook:'Facebook (conversational, 60-200 words)',
  instagram:'Instagram (punchy, 40-100 words, strong hashtags)',
  both:'Facebook AND Instagram — write one version for each, labeled FB: and IG:',
};
const TONE_LABELS = {
  raw:"Raw & real — blunt, passionate, like talking to a friend at a show",
  hype:'Hype mode — energetic, ALL CAPS moments, pure vinyl hype',
  nostalgic:'Nostalgic — evocative, story-driven, makes you feel the weight of the record',
  funny:'Funny & informal — dry humor, self-aware KornDog personality',
  educational:'Deep cut — talk about the music, the pressing, the history, the culture',
};
const SALE_TYPES = new Set(['sale']);

function buildMainPrompt(details, hasPhoto) {
  const isSale=SALE_TYPES.has(state.postType);
  const hasDetails=details.length>0;
  return `════ HARD RULE — NEVER BREAK ════
Never invent price, condition, pressing, color variant, quantity, shipping, availability, stock count, release year, edition, or claim details.
If any of those details are missing, omit them or say "DM me for details."

════ TASK ════
Post type: ${POST_TYPE_LABELS[state.postType]}
Platform:  ${PLATFORM_LABELS[state.platform]}
Tone:      ${TONE_LABELS[state.tone]}
Count:     ${state.count} post${state.count>1?'s':''}
${hasPhoto?'A photo has been provided. Use only what is visually confirmable.':''}
${hasDetails?`Item details:\n${details}`:`No item details. Write general KornDog culture/community post.`}

════ ENDING RULE ════
${isSale?`SALE POST: End with a claim action — "comment SOLD", "DM me", "grab it at korndogrecords.com." No question.`:`CULTURE POST: End with a genuine question that invites comments.`}
${isSale?`════ SALE POST RULES ════\n- Lead with emotion. Then reveal the record and deal.\n- Soft selling: "claim it", "DM me", "comment SOLD".\n- Only include price/condition if in item details or visible in photo.`:''}
════ FORMAT ════
- 4-6 hashtags at end on own line (always #KorndogRecords #VinylTherapy).
${state.count>1?'- Separate each post with exactly "---POST---" on its own line.':''}
- Return ONLY the post text. No intro, no labels, no markdown.`;
}

function buildRegenPrompt(post) {
  const isSale=SALE_TYPES.has(post.type);
  return `════ HARD RULE ════
Never invent new factual details. Keep only what exists in the original.

════ ORIGINAL POST ════
${post.text}

════ TASK ════
Write ONE completely different version. Change the emotional angle and opening. Keep same purpose.

════ ENDING RULE ════
${isSale?`SALE POST: End with claim action. No question.`:`CULTURE POST: End with genuine question.`}

Return ONLY the new post text.`;
}

// ── GENERATE ─────────────────────────────────────────────
async function generatePosts() {
  const details=document.getElementById('detailsInput').value.trim();
  const btn=document.getElementById('generateBtn');
  const form=document.getElementById('generateForm');
  const loading=document.getElementById('loadingState');
  const loadingTxt=document.getElementById('loadingText');
  btn.disabled=true; form.style.display='none'; loading.classList.add('active');
  const msgs=['Writing your posts...','Channeling the Vinyl Therapy vibe...',currentPhoto?'Reading your photo...':'Digging through the crates...','Adding KornDog sauce...','Almost ready to drop...'];
  let mi=0;
  const t=setInterval(()=>{ loadingTxt.textContent=msgs[++mi%msgs.length]; },1800);
  try {
    const payload={prompt:buildMainPrompt(details,!!currentPhoto),maxTokens:1000};
    if (currentPhoto) { payload.imageBase64=currentPhoto.base64; payload.imageMimeType=currentPhoto.mimeType; }
    const raw=await generate(payload);
    const posts=raw.split('---POST---').map(p=>p.trim()).filter(p=>p.length>20);
    if (!posts.length) throw new Error('No usable posts in response.');
    posts.forEach(text=>{ state.pending.push({id:Date.now()+Math.random(),text,type:state.postType,platform:state.platform,tone:state.tone,photoDataUrl:currentPhoto?`data:${currentPhoto.mimeType};base64,${currentPhoto.base64}`:null,timestamp:new Date().toISOString()}); });
    savePending(); updateBadge();
    showToast(`✦ ${posts.length} post${posts.length>1?'s':''} ready to swipe!`);
    setTimeout(()=>switchTab('swipe'),800);
  } catch(err) { console.error('[generatePosts]',err); showToast('Something went wrong. Try again.'); }
  finally { clearInterval(t); loading.classList.remove('active'); form.style.display='block'; btn.disabled=false; }
}

// ── SWIPE ─────────────────────────────────────────────────
let _dragMoveHandler=null, _dragEndHandler=null;
function clearGlobalDragListeners() {
  if (_dragMoveHandler) window.removeEventListener('mousemove',_dragMoveHandler);
  if (_dragEndHandler)  window.removeEventListener('mouseup',_dragEndHandler);
  _dragMoveHandler=null; _dragEndHandler=null;
}

function renderSwipe() {
  const empty=document.getElementById('emptySwipe');
  const stack=document.getElementById('cardStack');
  const actions=document.getElementById('swipeActions');
  const hint=document.getElementById('swipeHint');
  const counter=document.getElementById('swipeCounter');
  clearGlobalDragListeners();
  const remaining=state.pending.length;
  counter.textContent=remaining>0?`${remaining} post${remaining>1?'s':''} to review`:'0 posts to review';
  if (!remaining) { empty.style.display='flex'; stack.style.display='none'; actions.style.display='none'; hint.style.display='none'; return; }
  empty.style.display='none'; stack.style.display='block'; actions.style.display='flex'; hint.style.display='block';
  stack.innerHTML='';
  state.pending.slice(0,3).forEach((post,i)=>stack.appendChild(buildCard(post,i)));
  const topCard=stack.querySelector('.card-top');
  if (topCard) attachDrag(topCard);
}

function splitPostText(rawText) {
  const lines=rawText.split('\n'), bodyLines=[], hashLines=[];
  let reachedHash=false;
  for (const line of lines) {
    const trimmed=line.trim(), tokens=trimmed.split(/\s+/).filter(Boolean);
    const allH=tokens.length>0&&tokens.every(t=>t.startsWith('#'));
    if (allH) { reachedHash=true; hashLines.push(trimmed); }
    else if (reachedHash) { bodyLines.push(line); }
    else {
      const li=tokens.findIndex(t=>t.startsWith('#'));
      if (li>0&&tokens.slice(li).every(t=>t.startsWith('#'))) { bodyLines.push(tokens.slice(0,li).join(' ')); hashLines.push(tokens.slice(li).join(' ')); reachedHash=true; }
      else bodyLines.push(line);
    }
  }
  return { bodyText:bodyLines.join('\n').trim(), hashText:hashLines.join(' ').trim() };
}

function buildCard(post,stackPos) {
  const card=document.createElement('div');
  card.className='swipe-card '+(stackPos===0?'card-top':stackPos===1?'card-2':'card-3');
  const platEmoji={facebook:'📘',instagram:'📸',both:'🔗'}[post.platform]||'📱';
  const typeLabel=POST_TYPE_LABELS[post.type]||post.type;
  const toneLabel=(post.tone||'').charAt(0).toUpperCase()+(post.tone||'').slice(1);
  const {bodyText,hashText}=splitPostText(post.text);
  card.innerHTML=`
    <div class="vote-overlay vote-approve">QUEUE ✓</div>
    <div class="vote-overlay vote-reject">TRASH ✕</div>
    <div class="card-sleeve">
      <div class="sleeve-record"></div>
      <div class="sleeve-info">
        <div class="sleeve-type">${escHtml(typeLabel)}</div>
        <div class="sleeve-platform">${platEmoji} ${escHtml(post.platform.charAt(0).toUpperCase()+post.platform.slice(1))}</div>
        <div class="sleeve-tone">Tone: ${escHtml(toneLabel)}</div>
      </div>
      ${stackPos===0?'<button class="sleeve-edit" onclick="openEdit(\'pending\',0)">Edit</button>':''}
    </div>
    ${post.photoDataUrl?`<img class="card-photo" src="${escHtml(post.photoDataUrl)}" alt="Record photo">`:''}
    <div class="card-content">
      <div class="card-post-text">${escHtml(bodyText)}</div>
      ${hashText?`<div class="card-hashtags">${escHtml(hashText)}</div>`:''}
    </div>
    <div class="card-meta">
      <div class="card-char-count">${post.text.length} chars</div>
      <button class="card-copy-btn" onclick="copyPost(${JSON.stringify(post.text)})">Copy</button>
    </div>`;
  return card;
}

function attachDrag(card) {
  let startX=0,curX=0,isDrag=false;
  const ao=card.querySelector('.vote-approve'), ro=card.querySelector('.vote-reject');
  function onStart(e) { isDrag=true; startX=e.touches?e.touches[0].clientX:e.clientX; card.style.transition='none'; }
  function onMove(e) {
    if (!isDrag) return; e.preventDefault();
    curX=(e.touches?e.touches[0].clientX:e.clientX)-startX;
    card.style.transform=`translateX(${curX}px) rotate(${curX*0.08}deg)`;
    const pct=Math.min(Math.abs(curX)/100,1);
    ao.style.opacity=curX>0?pct:0; ro.style.opacity=curX<0?pct:0;
  }
  function onEnd() {
    if (!isDrag) return; isDrag=false;
    card.style.transition='transform 0.4s ease, opacity 0.4s ease';
    if (curX>90) flyCard(card,'approve');
    else if (curX<-90) flyCard(card,'reject');
    else { card.style.transform=''; ao.style.opacity=0; ro.style.opacity=0; }
    curX=0;
  }
  card.addEventListener('touchstart',onStart,{passive:true});
  card.addEventListener('touchmove',onMove,{passive:false});
  card.addEventListener('touchend',onEnd);
  card.addEventListener('mousedown',onStart);
  _dragMoveHandler=onMove; _dragEndHandler=onEnd;
  window.addEventListener('mousemove',_dragMoveHandler);
  window.addEventListener('mouseup',_dragEndHandler);
}

function flyCard(card,direction) {
  card.style.transform=`translateX(${direction==='approve'?600:-600}px) rotate(${direction==='approve'?25:-25}deg)`;
  card.style.opacity='0';
  setTimeout(()=>processVote(direction),350);
}
function voteCard(direction) {
  const topCard=document.querySelector('#cardStack .card-top');
  if (!topCard) return;
  topCard.style.transition='transform 0.35s ease, opacity 0.35s ease';
  flyCard(topCard,direction);
}
function processVote(direction) {
  if (!state.pending.length) return;
  const post=state.pending.shift();
  if (direction==='approve') { state.queue.push(post); saveQueue(); showToast('✓ Added to queue!'); }
  else showToast('✕ Trashed');
  savePending(); updateBadge(); renderSwipe();
}
async function regenCard() {
  if (!state.pending.length) return;
  const post=state.pending[0]; showToast('↻ Regenerating...');
  try {
    const newText=await generate({prompt:buildRegenPrompt(post),maxTokens:400});
    state.pending[0].text=newText; savePending(); renderSwipe(); showToast('✦ Fresh post loaded!');
  } catch(err) { console.error('[regenCard]',err); showToast('Regen failed. Try again.'); }
}

// ── POST NOW ─────────────────────────────────────────────
async function postToMeta(post,idx,btn) {
  if (btn) { btn.disabled=true; btn.textContent='⚙️ Building...'; }
  try {
    showToast('🎨 Generating graphic...');
    const {bodyText,hashText}=splitPostText(post.text);
    const W=1080,H=1080,LIME='#7FD41A';
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    const ctx=cv.getContext('2d');
    ctx.fillStyle='#0a0a0a'; ctx.fillRect(0,0,W,H);
    if (post.photoDataUrl) {
      await new Promise(resolve=>{
        const img=new Image();
        img.onload=()=>{
          const PH=H*0.62,scale=Math.max(W/img.width,PH/img.height);
          const sw=img.width*scale,sh=img.height*scale;
          ctx.save(); ctx.beginPath(); ctx.rect(0,0,W,PH); ctx.clip();
          ctx.drawImage(img,(W-sw)/2,(PH-sh)*0.15,sw,sh); ctx.restore();
          const g=ctx.createLinearGradient(0,PH*0.55,0,PH);
          g.addColorStop(0,'rgba(10,10,10,0)'); g.addColorStop(1,'rgba(10,10,10,1)');
          ctx.fillStyle=g; ctx.fillRect(0,0,W,PH); resolve();
        };
        img.onerror=resolve; img.src=post.photoDataUrl;
      });
    }
    const TY=post.photoDataUrl?Math.round(H*0.60):80;
    ctx.fillStyle=LIME; ctx.fillRect(0,TY,8,H-TY);
    const PAD=48,maxTW=W-PAD-40,fc=bodyText.length;
    const fs=fc<180?36:fc<320?30:26,lH=fs*1.5;
    ctx.fillStyle='#f0f0f0'; ctx.font=`${fs}px Arial, sans-serif`; ctx.textAlign='left';
    function wrap(t,mW){const ws=t.split(' '),ls=[];let c='';for(const w of ws){const ts=c?c+' '+w:w;if(ctx.measureText(ts).width>mW&&c){ls.push(c);c=w;}else c=ts;}if(c)ls.push(c);return ls;}
    const aL=bodyText.split('\n').flatMap(p=>wrap(p,maxTW));
    const mL=Math.floor((H-TY-120)/lH);
    let tY=TY+48; aL.slice(0,mL).forEach(l=>{ctx.fillText(l,PAD,tY);tY+=lH;});
    if (hashText){ctx.fillStyle=LIME;ctx.font='bold 26px Arial, sans-serif';wrap(hashText,maxTW).slice(0,2).forEach((l,i)=>ctx.fillText(l,PAD,H-88+i*34));}
    ctx.fillStyle='rgba(127,212,26,0.4)';ctx.font='20px Arial, sans-serif';ctx.fillText('korndogrecords.com',PAD,H-22);
    const dataUrl=cv.toDataURL('image/jpeg',0.92);
    const a=document.createElement('a'); a.href=dataUrl; a.download=`korndog-post-${Date.now()}.jpg`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    await copySilent(post.text);
    showToast('📥 Graphic saved! Caption copied.');
    state.queue.splice(idx,1); saveQueue(); updateBadge(); renderQueue();
  } catch(err) { console.error('[postToMeta]',err); showToast('Something went wrong.'); if(btn){btn.disabled=false;btn.textContent='📲 Post Now';} }
}

// ── QUEUE ─────────────────────────────────────────────────
function renderQueue() {
  const empty=document.getElementById('queueEmpty');
  const list=document.getElementById('queueList');
  if (!state.queue.length) { empty.style.display='block'; list.innerHTML=''; return; }
  empty.style.display='none'; list.innerHTML='';
  state.queue.forEach((post,i)=>{
    const platEmoji={facebook:'📘',instagram:'📸',both:'🔗'}[post.platform]||'📱';
    const typeLabel=POST_TYPE_LABELS[post.type]||post.type;
    const {bodyText,hashText}=splitPostText(post.text);
    const item=document.createElement('div'); item.className='queue-item'; item.dataset.idx=i;
    item.innerHTML=`
      <div class="queue-item-header">
        <div class="queue-item-meta">${escHtml(typeLabel)}</div>
        <div class="queue-item-platform">${platEmoji} ${escHtml(post.platform)}</div>
      </div>
      ${post.photoDataUrl?`<img class="queue-photo" src="${escHtml(post.photoDataUrl)}" alt="Record photo">`:''}
      <div class="queue-item-body">
        <div class="queue-item-text">${escHtml(bodyText)}</div>
        ${hashText?`<div class="queue-item-tags">${escHtml(hashText)}</div>`:''}
      </div>
      <div class="queue-item-actions">
        <button class="qi-btn qi-copy" data-action="copy">📋 Copy</button>
        <button class="qi-btn qi-post" data-action="post">📲 Post Now</button>
        <button class="qi-btn qi-delete" data-action="delete">🗑</button>
      </div>`;
    item.querySelector('[data-action="copy"]').addEventListener('click',()=>copyPost(post.text));
    item.querySelector('[data-action="post"]').addEventListener('click',(e)=>postToMeta(post,i,e.currentTarget));
    item.querySelector('[data-action="delete"]').addEventListener('click',()=>deleteQueued(i));
    list.appendChild(item);
  });
}
function deleteQueued(idx){state.queue.splice(idx,1);saveQueue();updateBadge();renderQueue();showToast('Removed from queue');}

// ── EDIT MODAL ────────────────────────────────────────────
function openEdit(target,idx){state.editTarget=target;state.editIdx=idx;const post=target==='pending'?state.pending[idx]:state.queue[idx];document.getElementById('editTextarea').value=post.text;document.getElementById('editModal').classList.add('open');}
function closeModal(){document.getElementById('editModal').classList.remove('open');state.editTarget=null;state.editIdx=null;}
function saveEdit(){const t=document.getElementById('editTextarea').value.trim();if(!t)return;if(state.editTarget==='pending'){state.pending[state.editIdx].text=t;savePending();renderSwipe();}else{state.queue[state.editIdx].text=t;saveQueue();renderQueue();}closeModal();showToast('✦ Post updated!');}

// ── UTILS ─────────────────────────────────────────────────
async function copyPost(text) {
  if (navigator.clipboard&&navigator.clipboard.writeText) { try{await navigator.clipboard.writeText(text);showToast('📋 Copied!');return;}catch(e){} }
  const overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:flex-end;';
  overlay.innerHTML=`<div style="width:100%;background:#1e1e1e;border-radius:20px 20px 0 0;padding:20px;max-height:70dvh;overflow-y:auto;">
    <div style="width:40px;height:4px;background:#333;border-radius:2px;margin:0 auto 16px;"></div>
    <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:#7FD41A;letter-spacing:1px;margin-bottom:12px;">Select All & Copy</div>
    <textarea id="copyFallbackTA" readonly style="width:100%;background:#141414;border:1.5px solid #7FD41A;border-radius:12px;padding:14px;color:#f0f0f0;font-family:'Barlow',sans-serif;font-size:14px;line-height:1.6;resize:none;min-height:160px;outline:none;">${text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
    <div style="font-size:12px;color:#888;margin:10px 0 16px;">Tap the text above → Select All → Copy</div>
    <button onclick="this.closest('div[style]').parentElement.remove()" style="width:100%;background:#7FD41A;color:#0a0a0a;border:none;border-radius:12px;padding:14px;font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;cursor:pointer;">DONE</button>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  setTimeout(()=>{const ta=document.getElementById('copyFallbackTA');if(ta){ta.focus();ta.select();}},100);
}

function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);}
function updateBadge(){const b=document.getElementById('queueBadge');b.textContent=state.queue.length+' queued';b.classList.toggle('has-items',state.queue.length>0);}
function saveQueue(){try{localStorage.setItem('kd_social_queue',JSON.stringify(state.queue));}catch(e){}}
function savePending(){try{localStorage.setItem('kd_social_pending',JSON.stringify(state.pending));}catch(e){}}
function escHtml(str){if(typeof str!=='string')return '';return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ── PREFILL FROM DISCOVERY ────────────────────────────────
function prefillGenerate(details,postType){
  const ta=document.getElementById('detailsInput');if(ta)ta.value=details;
  if(postType){const btn=document.querySelector(`.post-type-btn[data-type="${postType}"]`);if(btn)selectPostType(btn);}
  switchTool('social');switchTab('generate');
  setTimeout(()=>{const el=document.getElementById('detailsInput');if(el)el.scrollIntoView({behavior:'smooth',block:'center'});},200);
}

// ── INIT ─────────────────────────────────────────────────
updateBadge();
if (state.pending.length>0) { switchTool('social'); renderSwipe(); }
