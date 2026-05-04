// ============================================
// SUPABASE IMPORTS
// ============================================

import { supabase } from './supabase-config.js';

import { initMusic } from './music.js';

// ============================================
// DOM ELEMENT REFERENCES
// ============================================

const mainPageContainer = document.getElementById('mainPageContainer');

// Canvas (new)
const postCanvas = document.getElementById('postCanvas');
const linkLayer = document.getElementById('linkLayer');
const SNAP_ALIGN_THRESHOLD = 18; // px in canvas units — tweak to taste


// (legacy) if still in HTML; not used anymore once canvas is wired
const postFeed = document.getElementById('postFeed');

// Post form overlay
const postDeleteBtn = document.getElementById('postDeleteBtn');
const postFormOverlay = document.getElementById('postFormOverlay');
const postTitle = document.getElementById('postTitle');
const postCategory = document.getElementById('postCategory');
const postCategoryInput = document.getElementById('postCategoryInput');
const addCategoryToggle = document.getElementById('addCategoryToggle');
const postFileInput = document.getElementById('postFileInput');
const postFileName = document.getElementById('postFileName');
const postText = document.getElementById('postText');
const postSubmitBtn = document.getElementById('postSubmitBtn');
const postCancelBtn = document.getElementById('postCancelBtn');

// Log out
const logoutBtn = document.getElementById('logoutBtn');

// Cover image prompt
const postCoverImageLabel = document.getElementById('postCoverImageLabel');
const postCoverImageInput = document.getElementById('postCoverImageInput');
const postCoverFileName   = document.getElementById('postCoverFileName');

// Post detail modal
const postDetailOverlay = document.getElementById('postDetailOverlay');
const postDetailModal = document.getElementById('postDetailModal');
const postDetailClose = document.getElementById('postDetailClose');
const postDetailContent = document.getElementById('postDetailContent');
const commentsList = document.getElementById('commentsList');
const commentInput = document.getElementById('commentInput');
const commentSubmitBtn = document.getElementById('commentSubmitBtn');

// Notification panel
const notifBar   = document.getElementById('notifBar');
const notifPanel = document.getElementById('notifPanel');
const notifList  = document.getElementById('notifList');

// Profile Modal 

const profileOverlay = document.getElementById('profileOverlay');

// ============================================
// STATE VARIABLES
// ============================================

let currentUser = null;
let currentUserData = null;

// Link creation state: if you right-click a post, new post links to it
let pendingLinkPostId = null;

// Post create/edit state
let pendingPost = null;
let editMode = false;
let editingPostId   = null;
let editingPost     = null; // full original post row, used to preserve untouched file fields

// Filters (normal mode only)
let activeUserFilter = null;      // user_id
let activeCategoryFilter = null;  // category name or NONE_CATEGORY_FILTER
const NONE_CATEGORY_FILTER = '__NONE__';


// Modal state
let activePostForModal = null;

// Double right-click detection
let lastRightClick = 0;
const DOUBLE_CLICK_THRESHOLD = 400; // ms

// Cache last loaded data for re-rendering link lines on pan/zoom/move
let lastLoadedPosts = [];
let lastLoadedLinks = [];

let activeLinkTreeRootPostId = null; // any post id inside the selected connected component

// Profile modal state
let profileEditMode       = false;
let newProfileCoverFile   = null;
let newProfilePfpFile     = null;
let currentProfileUserId  = null;

// Post detail 3-col layout state
let pdColWidths   = { visual: 50, text: 30, comments: 20 };
let pdFullscreen  = false;
let _pdHasVisual  = false;
let _pdHasText    = false;

function buildAdjacency(links) {
  const adj = new Map(); // postId -> Set(postId)
  for (const l of (links || [])) {
    const a = String(l.a_post_id);
    const b = String(l.b_post_id);
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
  return adj;
}

function getConnectedComponent(startId, links) {
  const start = String(startId);
  const adj = buildAdjacency(links);
  const seen = new Set();
  const stack = [start];

  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);

    const neighbors = adj.get(cur);
    if (!neighbors) continue;
    for (const n of neighbors) {
      if (!seen.has(n)) stack.push(n);
    }
  }

  return seen;
}



// ============================================
// CANVAS PAN + PLACEMENT STATE
// ============================================

let canvasScale = 1;
const MIN_SCALE = 0.04;
const MAX_SCALE = 2.2;
const ZOOM_SENSITIVITY = 0.0015; // tweak: smaller = slower zoom

let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartOffsetX = 0;
let panStartOffsetY = 0;
let canvasOffsetX = 0;
let canvasOffsetY = 0;

// Placement mode
let isPlacing = false;
let placingPost = null;      // the post row (must include id)
let placingCardEl = null;    // DOM element for the card being placed
let placeMouseOffsetX = 0;   // center-of-card offset (canvas units)
let placeMouseOffsetY = 0;

const CARD_GAP = 10; // minimum gap between cards (px in canvas units)

// ============================================
// 0. CANVAS PANNING / COORD HELPERS
// ============================================

function applyCanvasTransform() {
  if (!postCanvas) return;
  postCanvas.style.transform = `translate(${canvasOffsetX}px, ${canvasOffsetY}px) scale(${canvasScale})`;
  postCanvas.style.transformOrigin = '0 0';

  // keep links in sync with pan/zoom
  renderLinks(lastLoadedPosts, lastLoadedLinks);
}

// Convert viewport mouse coordinates to canvas coordinates (account for current pan + zoom)
function viewportPointToCanvasPoint(clientX, clientY) {
  // Inverse of: screen = (canvas * scale) + offset
  return {
    x: (clientX - canvasOffsetX) / canvasScale,
    y: (clientY - canvasOffsetY) / canvasScale
  };
}

function getCardRectAt(cardEl, x, y) {
  // offsetWidth/Height are already in canvas units (CSS transform doesn't affect them)
  const w = cardEl.offsetWidth;
  const h = cardEl.offsetHeight;
  return { left: x, top: y, right: x + w, bottom: y + h };

}

function rectsOverlap(a, b, gap = 0) {
  return !(
    a.right + gap <= b.left ||
    a.left >= b.right + gap ||
    a.bottom + gap <= b.top ||
    a.top >= b.bottom + gap
  );
}

function canPlaceCardAt(cardEl, x, y) {
  const rect = getCardRectAt(cardEl, x, y);

  const others = postCanvas.querySelectorAll('.post-card');
  for (const other of others) {
    if (other === cardEl) continue;

    const ox = parseFloat(other.style.left || '0');
    const oy = parseFloat(other.style.top || '0');
    const orect = getCardRectAt(other, ox, oy);

    if (rectsOverlap(rect, orect, CARD_GAP)) return false;
  }
  return true;
}

async function waitForCardMedia(cardEl) {
  const images = [...cardEl.querySelectorAll('img')];
  const videos = [...cardEl.querySelectorAll('video')];

  const imagePromises = images.map(img => {
    if (img.complete) return Promise.resolve();
    return new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
  });

  const videoPromises = videos.map(vid => {
    if (vid.readyState >= 1) return Promise.resolve();
    return new Promise(resolve => { vid.onloadedmetadata = resolve; vid.onerror = resolve; });
  });

  await Promise.all([...imagePromises, ...videoPromises]);
}

function startPlacement(post, cardEl, mouseEvent) {
  isPlacing = true;
  placingPost = post;
  placingCardEl = cardEl;

  placingCardEl.style.zIndex = '20';
  // Disable interactive buttons so the drop click can't accidentally trigger them
  placingCardEl.querySelectorAll(
    '.post-file-preview-play, .post-file-preview-download-btn, .post-preview-mute-btn'
  ).forEach(btn => { btn.style.pointerEvents = 'none'; });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (isPlacing && placingCardEl === cardEl) {
        updatePlacementPosition(mouseEvent);
      }
    });
  });
}

function stopPlacement() {
  if (placingCardEl) {
    placingCardEl.style.zIndex = '';
    placingCardEl.style.outline = '';
    // Re-enable interactive buttons now that placement is done
    placingCardEl.querySelectorAll(
      '.post-file-preview-play, .post-file-preview-download-btn, .post-preview-mute-btn'
    ).forEach(btn => { btn.style.pointerEvents = ''; });
  }
  isPlacing = false;
  placingPost = null;
  placingCardEl = null;
}

function updatePlacementPosition(e) {
  if (!isPlacing || !placingCardEl) return;

  const pt = viewportPointToCanvasPoint(e.clientX, e.clientY);

  // offsetWidth/Height are in canvas units — no canvasScale division needed
  const w = placingCardEl.offsetWidth;
  const h = placingCardEl.offsetHeight;
  placeMouseOffsetX = w / 2;
  placeMouseOffsetY = h / 2;

  let x = pt.x - placeMouseOffsetX;
  let y = pt.y - placeMouseOffsetY;

  const pw = placingCardEl.offsetWidth;
  const ph = placingCardEl.offsetHeight;
  const pcx = x + pw / 2;
  const pcy = y + ph / 2;

  let snapX = null, snapY = null;
  let bestDx = SNAP_ALIGN_THRESHOLD;
  let bestDy = SNAP_ALIGN_THRESHOLD;

  const cards = postCanvas.querySelectorAll('.post-card');
  for (const other of cards) {
    if (other === placingCardEl) continue;
    const ox  = parseFloat(other.style.left || '0');
    const oy  = parseFloat(other.style.top  || '0');
    const ocx = ox + other.offsetWidth  / 2;
    const ocy = oy + other.offsetHeight / 2;

    const dx = Math.abs(pcx - ocx);
    if (dx < bestDx) {
      bestDx = dx;
      snapX = ox + (other.offsetWidth - placingCardEl.offsetWidth) / 2;
    }

    const dy = Math.abs(pcy - ocy);
    if (dy < bestDy) {
      bestDy = dy;
      snapY = oy + (other.offsetHeight - placingCardEl.offsetHeight) / 2;
    }
  }

  if (snapX !== null) x = snapX;
  if (snapY !== null) y = snapY;

  placingCardEl.style.left = `${x}px`;
  placingCardEl.style.top  = `${y}px`;

  const snapping = snapX !== null || snapY !== null;
  placingCardEl.style.outline = snapping
    ? '2px solid rgba(255,255,255,0.6)'
    : '2px solid rgba(255,255,255,0.25)';

  const ok = canPlaceCardAt(placingCardEl, x, y);
  placingCardEl.style.opacity = ok ? '1' : '0.6';

  renderLinks(lastLoadedPosts, lastLoadedLinks);
}

async function tryDropPlacement(e) {
  if (!isPlacing || !placingCardEl || !placingPost) return;

  const x = parseFloat(placingCardEl.style.left || '0');
  const y = parseFloat(placingCardEl.style.top || '0');

  if (!canPlaceCardAt(placingCardEl, x, y)) {
    return; // keep sticky until a valid spot
  }

  let placementQuery = supabase
  .from('posts')
  .update({ x, y })
  .eq('id', placingPost.id);

if (!currentUserData?.is_admin) {
  placementQuery = placementQuery.eq('user_id', currentUser.id);
}

const { error } = await placementQuery;

  placingPost.x = x;
  placingPost.y = y;

  stopPlacement();
  renderLinks(lastLoadedPosts, lastLoadedLinks);
}

// ============================================
// 1. AUTH CHECK
// ============================================

async function checkAuth() {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (error) {
    console.error('Failed to get session:', error);
    return null;
  }

  if (!session) {
    window.location.href = './index.html';
    return null;
  }

  currentUser = session.user;
  console.log('Logged in as:', currentUser.id);

  const { data, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('id', currentUser.id)
    .single();

  if (userError) {
    console.error('Failed to fetch user data:', userError);
    return null;
  }

  currentUserData = data;
  console.log('User data loaded:', currentUserData.username);
  return session;
}

// ============================================
// 2. FILE TYPE DETECTION
// ============================================

async function getFileType(file) {
  const mime = file?.type || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';

  if (mime.startsWith('video/')) {
    // probe: audio-only mp4 has no video track (videoWidth stays 0)
    const isAudioOnly = await new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const vid = document.createElement('video');
      vid.preload = 'metadata';
      vid.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(vid.videoWidth === 0);
      };
      vid.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(false);
      };
      vid.src = url;
    });
    return isAudioOnly ? 'audio' : 'video';
  }

  return 'other';
}

async function isVisualFile(file) {
  const type = await getFileType(file);
  return type === 'image' || type === 'video';
}


// ============================================
// 3. OVERLAY OPEN/CLOSE HELPERS
// ============================================

function openPostForm() {
  postFormOverlay.style.display = 'flex';
}

function closePostForm() {
  postCoverImageInput.value = '';
  postCoverFileName.textContent = 'choose cover image';
  postCoverImageLabel.style.display = 'none';
  postFormOverlay.style.display = 'none';
  postTitle.value = '';
  postFileInput.value = '';
  postFileName.textContent = 'choose file';
  postText.value = '';
  postCategory.value = '';
  postCategory.style.display = 'block';
  postCategoryInput.style.display = 'none';
  postCategoryInput.value = '';
  addCategoryToggle.textContent = '+';
  editingPostId = null;
  editingPost   = null;
  postDeleteBtn.style.display = 'none'; // hide when form closes


  // clear pending link target
  pendingLinkPostId = null;
}

function closeCoverImagePrompt() {
  coverImageOverlay.style.display = 'none';
  coverImageInput.value = '';
  coverImageFileName.textContent = 'choose image';
  pendingPost = null;
}

function initFileNav(files) {
  let idx = 0;

  const viewer = document.getElementById('fileNavViewer');
  const label  = document.getElementById('fileNavLabel');
  const prev   = document.getElementById('fileNavPrev');
  const next   = document.getElementById('fileNavNext');
  if (!viewer || !label || !prev || !next) return;

  function render() {
    const f = files[idx];
    label.textContent = `${f.name}  (${idx + 1} / ${files.length})`;

    if (f.type === 'image') {
      viewer.innerHTML = `<img class="post-image" src="${f.url}" alt="">`;
    } else if (f.type === 'video') {
      viewer.innerHTML = `<video class="post-video" src="${f.url}" controls></video>`;
    } else if (f.type === 'audio') {
      viewer.innerHTML = `<audio src="${f.url}" controls style="width:100%"></audio>`;
    } else {
      viewer.innerHTML = `
        <div class="file-nav-download">
          <a href="${f.url}" download>${f.name}</a>
        </div>
      `;
    }
  }

  prev.addEventListener('click', () => { idx = (idx - 1 + files.length) % files.length; render(); });
  next.addEventListener('click', () => { idx = (idx + 1) % files.length; render(); });
  render();
}

// (modal functions unchanged)


function formatBodyText(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

function initPdAudioPlayer(audioFiles, container) {
  if (!audioFiles || audioFiles.length === 0) return;

  let idx = 0;
  const audio = new Audio();
  audio.preload = 'none';

  const player = document.createElement('div');
  player.className = 'pd-audio-player';

  player.innerHTML = `
    <button class="pd-audio-btn pd-audio-play" title="play / pause">▷</button>
    ${audioFiles.length > 1 ? `<button class="pd-audio-btn pd-audio-next" title="next">›</button>` : ''}
    <span class="pd-audio-title"></span>
  `;

  container.appendChild(player);

  const playBtn  = player.querySelector('.pd-audio-play');
  const nextBtn  = player.querySelector('.pd-audio-next');
  const titleEl  = player.querySelector('.pd-audio-title');

  function loadTrack(i) {
    const wasPlaying = !audio.paused;
    audio.pause();
    audio.src = audioFiles[i].url;
    titleEl.textContent = audioFiles[i].name || `track ${i + 1}`;
    playBtn.textContent = '▷';
    if (wasPlaying) audio.play().then(() => { playBtn.textContent = '||'; }).catch(() => {});
  }

  loadTrack(0);

  playBtn.addEventListener('click', () => {
    if (audio.paused) {
      audio.play().then(() => { playBtn.textContent = '||'; }).catch(() => {});
    } else {
      audio.pause();
      playBtn.textContent = '▷';
    }
  });

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      idx = (idx + 1) % audioFiles.length;
      loadTrack(idx);
      audio.play().then(() => { playBtn.textContent = '||'; }).catch(() => {});
    });
  }

  audio.addEventListener('ended', () => {
    if (audioFiles.length > 1) {
      idx = (idx + 1) % audioFiles.length;
      loadTrack(idx);
      audio.play().then(() => { playBtn.textContent = '||'; }).catch(() => {});
    } else {
      playBtn.textContent = '▷';
    }
  });

  // Stop audio when modal closes
  const observer = new MutationObserver(() => {
    if (document.getElementById('postDetailOverlay')?.style.display === 'none') {
      audio.pause();
      audio.src = '';
      observer.disconnect();
    }
  });
  const overlay = document.getElementById('postDetailOverlay');
  if (overlay) observer.observe(overlay, { attributes: true, attributeFilter: ['style'] });
}

// ── Apply column flex widths to DOM ──
function applyPdColWidths() {
  const vc = document.getElementById('pdVisualCol');
  const tc = document.getElementById('pdTextCol');
  const cc = document.getElementById('pdCommentsCol');
  if (vc && pdColWidths.visual > 0) vc.style.flex = `0 0 ${pdColWidths.visual}%`;
  if (tc && pdColWidths.text   > 0) tc.style.flex = `0 0 ${pdColWidths.text}%`;
  if (cc) cc.style.flex = `0 0 ${pdColWidths.comments}%`;
}

// ── Show/hide cols based on what content exists ──
function applyPdLayout(hasVisual, hasText) {
  _pdHasVisual = hasVisual;
  _pdHasText   = hasText;
  pdFullscreen = false;

  const vc  = document.getElementById('pdVisualCol');
  const tc  = document.getElementById('pdTextCol');
  const cc  = document.getElementById('pdCommentsCol');
  const h1  = document.getElementById('pdHandle1');
  const h2  = document.getElementById('pdHandle2');
  const fsb = document.getElementById('pdFullscreenBtn');
  if (fsb) fsb.textContent = '⤢';

  if (hasVisual && hasText) {
    pdColWidths = { visual: 50, text: 30, comments: 20 };
    vc.style.display = ''; h1.style.display = '';
    tc.style.display = ''; h2.style.display = '';
  } else if (hasVisual) {
    pdColWidths = { visual: 80, text: 0, comments: 20 };
    vc.style.display = ''; h1.style.display = 'none';
    tc.style.display = 'none'; h2.style.display = '';
  } else if (hasText) {
    pdColWidths = { visual: 0, text: 80, comments: 20 };
    vc.style.display = 'none'; h1.style.display = 'none';
    tc.style.display = ''; h2.style.display = '';
  } else {
    pdColWidths = { visual: 0, text: 0, comments: 100 };
    vc.style.display = 'none'; h1.style.display = 'none';
    tc.style.display = 'none'; h2.style.display = 'none';
  }
  cc.style.display = '';
  applyPdColWidths();
}

// ── Fullscreen toggle for visual col ──
function togglePdFullscreen() {
  pdFullscreen = !pdFullscreen;
  const vc  = document.getElementById('pdVisualCol');
  const tc  = document.getElementById('pdTextCol');
  const cc  = document.getElementById('pdCommentsCol');
  const h1  = document.getElementById('pdHandle1');
  const h2  = document.getElementById('pdHandle2');
  const fsb = document.getElementById('pdFullscreenBtn');

  if (pdFullscreen) {
    tc.style.display  = 'none';
    cc.style.display  = 'none';
    h1.style.display  = 'none';
    h2.style.display  = 'none';
    vc.style.flex     = '0 0 100%';
    if (fsb) fsb.textContent = '⤡';
  } else {
    cc.style.display = '';
    if (fsb) fsb.textContent = '⤢';
    applyPdLayout(_pdHasVisual, _pdHasText);
  }
}

// ── Build visual carousel in the visual col ──
function buildPdVisualCarousel(visuals, inner, prevBtn, nextBtn, counterEl) {
  if (!visuals || visuals.length === 0) return;
  let idx = 0;

  function render() {
    const f = visuals[idx];
    if (f.type === 'image') {
      inner.innerHTML = `<img class="pd-visual-img" src="${f.url}" alt="">`;
    } else {
      inner.innerHTML = `<video class="pd-visual-video" src="${f.url}" controls></video>`;
    }
    if (counterEl) counterEl.textContent = visuals.length > 1 ? `${idx + 1} / ${visuals.length}` : '';
  }

  render();

  if (prevBtn) {
    prevBtn.style.visibility = visuals.length > 1 ? 'visible' : 'hidden';
    prevBtn.onclick = () => { idx = (idx - 1 + visuals.length) % visuals.length; render(); };
  }
  if (nextBtn) {
    nextBtn.style.visibility = visuals.length > 1 ? 'visible' : 'hidden';
    nextBtn.onclick = () => { idx = (idx + 1) % visuals.length; render(); };
  }
}

// ── Drag-to-resize columns ──
function initPdResize() {
  const body = document.getElementById('pdBody');
  const h1   = document.getElementById('pdHandle1');
  const h2   = document.getElementById('pdHandle2');
  let dragging = null;

  h1.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = { handle: 'h1', startX: e.clientX, start: { ...pdColWidths } };
  });
  h2.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = { handle: 'h2', startX: e.clientX, start: { ...pdColWidths } };
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const totalW = body.getBoundingClientRect().width;
    if (!totalW) return;
    const dxPct = ((e.clientX - dragging.startX) / totalW) * 100;

    if (dragging.handle === 'h1') {
      const newV = Math.max(15, Math.min(75, dragging.start.visual + dxPct));
      const newT = Math.max(10, dragging.start.visual + dragging.start.text - newV);
      pdColWidths.visual = newV;
      pdColWidths.text   = newT;
    } else {
      const leftKey = _pdHasText ? 'text' : 'visual';
      const newL = Math.max(15, Math.min(85, dragging.start[leftKey] + dxPct));
      const newC = Math.max(10, dragging.start[leftKey] + dragging.start.comments - newL);
      pdColWidths[leftKey]  = newL;
      pdColWidths.comments  = newC;
    }
    applyPdColWidths();
  });

  document.addEventListener('mouseup', () => { dragging = null; });
}

async function openPostDetailModal(post, user) {
  activePostForModal = post;

  // ── User block ──
  const pfpFallback = './images/pfps/default.png';
  const pfpSrc = user?.pfp_url || (user?.pfp ? `./images/pfps/${user.pfp}` : pfpFallback);
  document.getElementById('pdPfp').src              = pfpSrc;
  document.getElementById('pdUsername').textContent = user?.username || '';

  // ── Date ──
  const dateEl = document.getElementById('pdDate');
  dateEl.textContent = post.created_at
    ? new Date(post.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  // ── Title + Category ──
  document.getElementById('pdTitle').textContent = post.title || '';
  let categoryEl = document.getElementById('pdCategory');
  if (!categoryEl) {
    categoryEl = document.createElement('div');
    categoryEl.id        = 'pdCategory';
    categoryEl.className = 'pd-category';
    document.getElementById('pdTitle').insertAdjacentElement('afterend', categoryEl);
  }
  categoryEl.textContent  = post.category || '';
  categoryEl.style.display = post.category ? '' : 'none';

  // ── Classify files ──
  const ext     = getFileExtension(post.file_name || '');
  const isImage = post.file_type === 'image'  || isImageExtension(ext);
  const isAudio = post.file_type === 'audio'  || isAudioExtension(ext);
  const isVideo = (post.file_type === 'video' || isVideoExtension(ext)) && !isAudio;
  const isMulti = !!(post.files && post.files.length > 1);
  const hasCover = !!post.cover_image_url;

  let visualFiles   = []; // { url, name, type:'image'|'video' }
  let audioFiles    = []; // { url, name }
  let downloadFiles = []; // { url, name }

  if (isMulti) {
    (post.files || []).forEach(f => {
      if      (f.type === 'image' || f.type === 'video') visualFiles.push(f);
      else if (f.type === 'audio') audioFiles.push({ url: f.url, name: f.name });
      else    downloadFiles.push({ url: f.url, name: f.name });
    });
  } else if (post.file_url) {
    if      (isImage) visualFiles.push({ url: post.file_url, name: post.file_name, type: 'image' });
    else if (isVideo) visualFiles.push({ url: post.file_url, name: post.file_name, type: 'video' });
    else if (isAudio) audioFiles.push({ url: post.file_url, name: post.file_name || 'audio' });
    else              downloadFiles.push({ url: post.file_url, name: post.file_name || 'file' });
  }

  // Cover counts as visual if no real visual files
  const coverAsVisual = hasCover && visualFiles.length === 0;
  if (coverAsVisual) {
    visualFiles.push({ url: post.cover_image_url, name: 'cover', type: 'image' });
  }

  const hasVisual = visualFiles.length > 0;
  const hasText   = !!(post.body?.trim()) || audioFiles.length > 0 || downloadFiles.length > 0;

  // ── Visual column ──
  const visualInner = document.getElementById('pdVisualInner');
  visualInner.innerHTML = '';
  if (hasVisual) {
    buildPdVisualCarousel(
      visualFiles,
      visualInner,
      document.getElementById('pdVisPrev'),
      document.getElementById('pdVisNext'),
      document.getElementById('pdVisualCounter')
    );
  }

  // ── Text column ──
  const contentCol = document.getElementById('postDetailContent');
  contentCol.innerHTML = '';

  // Download tabs
    // Download tabs
  if (downloadFiles.length > 0) {
    const bar = document.createElement('div');
    bar.className = 'pd-file-tab-bar';
    downloadFiles.forEach(f => {
      const btn = document.createElement('button');
      btn.className   = 'pd-file-tab pd-file-tab-dl';
      btn.innerHTML = `<span class="pd-tab-name">${f.name}</span><span class="pd-dl-icon">⤓</span>`;
      btn.style.display = 'flex';
      btn.style.alignItems = 'center';
      btn.title       = f.name;
      btn.addEventListener('click', async () => {
        try {
          const res  = await fetch(f.url);
          const blob = await res.blob();
          const a    = document.createElement('a');
          a.href     = URL.createObjectURL(blob);
          a.download = f.name;
          a.click();
          URL.revokeObjectURL(a.href);
        } catch {
          // fallback: let browser handle it
          const a    = document.createElement('a');
          a.href     = f.url;
          a.download = f.name;
          a.click();
        }
      });
      bar.appendChild(btn);
    });
    contentCol.appendChild(bar);
  }

  // Audio tabs + player
   // Audio tabs + player
  if (audioFiles.length > 0) {
    const bar = document.createElement('div');
    bar.className = 'pd-file-tab-bar';
    audioFiles.forEach(f => {
      const btn = document.createElement('button');
      btn.className   = 'pd-file-tab pd-file-tab-dl';
      btn.innerHTML = `<span class="pd-tab-name">${f.name}</span><span class="pd-dl-icon">⤓</span>`;
      btn.style.display = 'flex';
      btn.style.alignItems = 'center';
      btn.title       = f.name;
      btn.addEventListener('click', async () => {
        try {
          const res  = await fetch(f.url);
          const blob = await res.blob();
          const a    = document.createElement('a');
          a.href     = URL.createObjectURL(blob);
          a.download = f.name;
          a.click();
          URL.revokeObjectURL(a.href);
        } catch {
          const a    = document.createElement('a');
          a.href     = f.url;
          a.download = f.name;
          a.click();
        }
      });
      bar.appendChild(btn);
    });
    contentCol.appendChild(bar);
    initPdAudioPlayer(audioFiles, contentCol);
  }

  // Body text
  if (post.body) {
    const bodyEl = document.createElement('div');
    bodyEl.className = 'post-body post-body-formatted';
    bodyEl.innerHTML  = formatBodyText(post.body);
    contentCol.appendChild(bodyEl);
  }

  // ── Apply layout ──
  applyPdLayout(hasVisual, hasText);

  postDetailOverlay.style.display = 'flex';
  loadCommentsForPost(post.id);
  loadConnectedTabs(post);
}

async function loadConnectedTabs(post) {
  const tabContainer = document.getElementById('pdThreadTabs');
  tabContainer.innerHTML = '';

  const { data: links, error } = await supabase
    .from('post_links')
    .select('a_post_id, b_post_id')
    .or(`a_post_id.eq.${post.id},b_post_id.eq.${post.id}`)
    .eq('group_id', 'group1');

  if (error || !links || links.length === 0) return;

  const connectedIds = links.map(l =>
    String(l.a_post_id) === String(post.id) ? l.b_post_id : l.a_post_id
  );

  const { data: connectedPosts, error: postsErr } = await supabase
    .from('posts')
    .select('id, title, body, user_id')
    .in('id', connectedIds);

  if (postsErr || !connectedPosts || connectedPosts.length === 0) return;

  const userIds = [...new Set(connectedPosts.map(p => p.user_id).filter(Boolean))];
  let userMap = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users').select('id, username').in('id', userIds);
    (users || []).forEach(u => { userMap[u.id] = u.username; });
  }

  connectedPosts.forEach(cp => {
    const label = cp.title || cp.body?.slice(0, 30) || userMap[cp.user_id] || 'post';
    const tab = document.createElement('button');
    tab.className   = 'pd-thread-tab';
    tab.textContent = label;
    tab.title       = label;

    tab.addEventListener('click', async () => {
      const { data: fullPost } = await supabase.from('posts').select('*').eq('id', cp.id).single();
      const { data: fullUser } = await supabase.from('users').select('id, username, pfp, pfp_url').eq('id', cp.user_id).single();
      if (fullPost) openPostDetailModal(fullPost, fullUser || {});
    });

    tabContainer.appendChild(tab);
  });
}

function closePostDetailModal() {
  postDetailOverlay.style.display = 'none';
  document.getElementById('postDetailContent').innerHTML = '';
  commentsList.innerHTML  = '';
  commentInput.value      = '';
  activePostForModal      = null;
  pdFullscreen            = false;
}

// ============================================
// 4. EDIT MODE
// ============================================

function toggleEditMode() {
  editMode = !editMode;
  activeUserFilter = null;
  activeCategoryFilter = null;
  mainPageContainer.classList.toggle('edit-mode', editMode);
  document.getElementById('editModeBtn')?.classList.toggle('active', editMode);
  if (!editMode) closePostForm();
  loadPosts();
}

function openEditForm(post) {
  editingPostId = post.id;
  editingPost   = post; // preserve full row so we can keep untouched file fields
  postTitle.value = post.title || '';
  postText.value = post.body || '';
  postCategory.value = post.category || '';

  // Show what file(s) are currently attached
  if (post.files && post.files.length > 1) {
    postFileName.textContent = `${post.files.length} files attached`;
  } else {
    postFileName.textContent = post.file_name || 'replace file';
  }

  postDeleteBtn.style.display = 'inline-block'; // show in edit mode

  const hasNonVisualFile = post.file_url && post.file_type !== 'image' && post.file_type !== 'video';
if (hasNonVisualFile || post.cover_image_url) {
  postCoverImageLabel.style.display = 'block';
  postCoverFileName.textContent = post.cover_image_url
    ? decodeURIComponent(post.cover_image_url.split('/').pop().replace(/^\d+-/, ''))
    : 'choose cover image';
}
  openPostForm();

}

async function handleDeletePost(postId) {
  try {
    const { error } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId)
      .eq('user_id', currentUser.id);

    if (error) throw error;

    console.log('Post deleted:', postId);
    await loadPosts();
    await loadLinks();
    renderLinks(lastLoadedPosts, lastLoadedLinks);
  } catch (error) {
    console.error('Delete failed:', error.message);
    alert(`Delete failed: ${error.message}`);
  }
}

// ============================================
// 5. CATEGORIES
// ============================================

async function loadCategories() {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('group_id', 'group1')
    .order('name', { ascending: true });

  if (error) {
    console.error('Failed to load categories:', error);
    return;
  }

  postCategory.innerHTML = '<option value="">none</option>';

  data.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat.name;
    option.textContent = cat.name;
    postCategory.appendChild(option);
  });

  console.log(`Loaded ${data.length} categories`);
}

async function handleAddCategory() {
  const name = postCategoryInput.value.trim();
  if (!name) return;

  try {
    const { error } = await supabase
      .from('categories')
      .insert([{ name: name, group_id: 'group1' }]);

    if (error) throw error;

    console.log('Category added:', name);
    await loadCategories();
    postCategory.value = name;

    postCategory.style.display = 'block';
    postCategoryInput.style.display = 'none';
    postCategoryInput.value = '';
    addCategoryToggle.textContent = '+';
  } catch (error) {
    alert(`Failed to add category: ${error.message}`);
  }
}

// ============================================
// 6. LINKS (post_links table)
// ============================================

async function loadLinks() {
  const { data, error } = await supabase
    .from('post_links')
    .select('id, a_post_id, b_post_id')
    .eq('group_id', 'group1');

  if (error) {
    console.error('Failed to load links:', error);
    lastLoadedLinks = [];
    return [];
  }

  lastLoadedLinks = data || [];
  return lastLoadedLinks;
}

function orthogonalPathD(x1, y1, x2, y2) {
  // Option A: horizontal then vertical
  const d1 = `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;
  const len1 = Math.abs(x2 - x1) + Math.abs(y2 - y1);

  // Option B: vertical then horizontal
  const d2 = `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`;
  const len2 = Math.abs(x2 - x1) + Math.abs(y2 - y1);

  // lengths are the same in this simple case, but we’ll keep structure
  // in case you later add margins/avoidance.
  return (len2 < len1) ? d2 : d1;
}

  function renderLinks(posts, links) {
    if (!linkLayer || !postCanvas) return;
    linkLayer.innerHTML = '';

    const postsById = new Map((posts || []).map(p => [String(p.id), p]));

    // Only render links that are fully inside the current visible set (tree view etc.)
    const allowedIds = new Set((posts || []).map(p => String(p.id)));

    // linkLayer fills the viewport; use its own rect as the SVG coordinate origin
    const svgRect = linkLayer.getBoundingClientRect();

    for (const link of (links || [])) {
      const aId = String(link.a_post_id);
      const bId = String(link.b_post_id);

      if (!allowedIds.has(aId) || !allowedIds.has(bId)) continue;

      const a = postsById.get(aId);
      const b = postsById.get(bId);
      if (!a || !b) continue;

      const aEl = postCanvas.querySelector(`.post-card[data-post-id="${a.id}"]`);
      const bEl = postCanvas.querySelector(`.post-card[data-post-id="${b.id}"]`);
      if (!aEl || !bEl) continue;

      const aRect = aEl.getBoundingClientRect();
      const bRect = bEl.getBoundingClientRect();

  function clampToEdge(rect, svgRect, px, py) {
  // Returns the closest point on rect's perimeter to point (px, py)
  const l = rect.left   - svgRect.left;
  const r = rect.right  - svgRect.left;
  const t = rect.top    - svgRect.top;
  const b = rect.bottom - svgRect.top;

  // Clamp point to rect bounds first
  const cx = Math.max(l, Math.min(r, px));
  const cy = Math.max(t, Math.min(b, py));

  // Find which edge is closest
  const dLeft   = Math.abs(cx - l);
  const dRight  = Math.abs(cx - r);
  const dTop    = Math.abs(cy - t);
  const dBottom = Math.abs(cy - b);
  const minD    = Math.min(dLeft, dRight, dTop, dBottom);

  if (minD === dLeft)   return { x: l,  y: cy };
  if (minD === dRight)  return { x: r,  y: cy };
  if (minD === dTop)    return { x: cx, y: t  };
                        return { x: cx, y: b  };
}

// Each card's anchor = closest point on its edge to the other card's center
const aCx = (aRect.left + aRect.right)  / 2 - svgRect.left;
const aCy = (aRect.top  + aRect.bottom) / 2 - svgRect.top;
const bCx = (bRect.left + bRect.right)  / 2 - svgRect.left;
const bCy = (bRect.top  + bRect.bottom) / 2 - svgRect.top;

const p1 = clampToEdge(aRect, svgRect, bCx, bCy);
const p2 = clampToEdge(bRect, svgRect, aCx, aCy);

const x1 = p1.x, y1 = p1.y;
const x2 = p2.x, y2 = p2.y;

const d = `M ${x1} ${y1} L ${x2} ${y2}`;


    // --- HIT PATH (invisible but thick; receives click) ---
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('fill', 'none');
    hit.setAttribute('stroke', 'rgba(0,0,0,0)'); // invisible
    hit.setAttribute('stroke-width', '14');      // big click target
    hit.style.pointerEvents = 'stroke';
    hit.style.cursor = 'pointer';

    hit.addEventListener('click', (e) => {
  e.stopPropagation();

  // If this thread's tree is already active, toggle it off
  if (activeLinkTreeRootPostId === aId || activeLinkTreeRootPostId === bId) {
    activeLinkTreeRootPostId = null;
  } else {
    activeUserFilter = null;
    activeCategoryFilter = null;
    activeLinkTreeRootPostId = aId;
  }

  loadPosts();
});

    linkLayer.appendChild(hit);

    // --- VISIBLE PATH (thin; ignores clicks so hit-path gets them) ---
    // --- GRADIENT (fades from one corner to the other) ---
const gradId = `link-grad-${aId}-${bId}`;
const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
grad.setAttribute('id', gradId);
grad.setAttribute('gradientUnits', 'userSpaceOnUse');
grad.setAttribute('x1', x1); grad.setAttribute('y1', y1);
grad.setAttribute('x2', x2); grad.setAttribute('y2', y2);

const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
stop1.setAttribute('offset', '0%');
stop1.setAttribute('stop-color', 'rgba(0,0,0,0)');

const stopMid = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
stopMid.setAttribute('offset', '75%');
stopMid.setAttribute('stop-color', 'rgba(0,0,0,0.44)');

const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
stop2.setAttribute('offset', '100%');
stop2.setAttribute('stop-color', 'rgba(0,0,0,0)');

grad.appendChild(stop1);
grad.appendChild(stopMid);
grad.appendChild(stop2);

let defs = linkLayer.querySelector('defs');
if (!defs) {
  defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  linkLayer.appendChild(defs);
}
defs.appendChild(grad);

// --- VISIBLE PATH ---
const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
path.setAttribute('d', d);
path.setAttribute('fill', 'none');
path.setAttribute('stroke', `url(#${gradId})`);
path.setAttribute('stroke-width', '2.0');
path.setAttribute('stroke-linecap', 'round');
path.setAttribute('stroke-dasharray', '1 9');
path.setAttribute('stroke-dashoffset', '0');
path.style.animation = 'link-flow 6s linear infinite';
path.style.pointerEvents = 'none';
linkLayer.appendChild(path);
}
  }

// ============================================
// 6B. NOTIFICATIONS
// ============================================

const MAX_NOTIFICATIONS = 40;

async function loadNotifications() {
  if (!currentUser) return;

  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, post_id, actor_user_id, created_at')
    .eq('recipient_user_id', currentUser.id)
    .eq('group_id', 'group1')
    .order('created_at', { ascending: false })
    .limit(MAX_NOTIFICATIONS);

  if (error) {
    console.error('Failed to load notifications:', error);
    return;
  }

  if (!data || data.length === 0) {
    notifList.innerHTML = `<div class="notif-empty">no notifications</div>`;
    return;
  }

  // Fetch actor usernames
  const actorIds = [...new Set(data.map(n => n.actor_user_id).filter(Boolean))];
  let actorMap = {};
  if (actorIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, username')
      .in('id', actorIds);
    (users || []).forEach(u => { actorMap[u.id] = u.username; });
  }

  notifList.innerHTML = '';

  data.forEach(n => {
    const actor = actorMap[n.actor_user_id] || 'someone';
    const text  = n.type === 'comment'
      ? 'commented on your post'
      : 'connected a thread to your post';

    const item = document.createElement('div');
    item.className = 'notif-item';
    item.innerHTML = `
      <div class="notif-actor">${actor}</div>
      <div class="notif-text">${text}</div>
    `;

    item.addEventListener('click', async () => {
      // Load the related post and open its detail modal
      const { data: post, error: postErr } = await supabase
        .from('posts')
        .select('*')
        .eq('id', n.post_id)
        .single();

      if (postErr || !post) return;

      const { data: userData } = await supabase
        .from('users')
        .select('id, username, pfp, pfp_url')
        .eq('id', post.user_id)
        .single();

      openPostDetailModal(post, userData || {});
    });

    notifList.appendChild(item);
  });
}


// ============================================
// 6C. PROFILE MODAL
// ============================================

// ============================================
// 6C. PROFILE MODAL
// ============================================

async function openProfileModal(userId) {
  if (!userId) return;
  currentProfileUserId = userId;
  profileEditMode     = false;
  newProfileCoverFile = null;
  newProfilePfpFile   = null;

  const { data: user, error } = await supabase
    .from('users').select('*').eq('id', userId).single();
  if (error || !user) return;

  const isOwnProfile = currentUser && userId === currentUser.id;

  // ── Cover ──
  const coverImg         = document.getElementById('profileCoverImg');
  const coverPlaceholder = document.getElementById('profileCoverPlaceholder');
  const coverOverlay     = document.getElementById('profileCoverOverlay');

  if (user.cover_image_url) {
    coverImg.src           = user.cover_image_url;
    coverImg.style.display = 'block';
    coverPlaceholder.style.display = 'none';
  } else {
    coverImg.style.display         = 'none';
    coverPlaceholder.style.display = 'block';
  }
  coverOverlay.style.display = 'none';

  // ── PFP ──
  const pfpWidget  = document.getElementById('profilePfpWidget');
  const pfpOverlay = document.getElementById('profilePfpOverlay');
  pfpWidget.innerHTML = '';
  const pfpFallback = './images/pfps/default.webp';
  const pfpSrc = user.pfp_url || (user.pfp ? `./images/pfps/${user.pfp}` : pfpFallback);
  const img = document.createElement('img');
  img.src = pfpSrc;
  img.style.cssText = 'width:60px;height:60px;object-fit:cover;display:block;';
  pfpWidget.appendChild(img);
  pfpOverlay.style.display = 'none';

  // ── Username ──
  const usernameSpan  = document.getElementById('profileUsername');
  const usernameInput = document.getElementById('profileUsernameInput');
  usernameSpan.textContent  = user.username;
  usernameSpan.style.display  = 'inline';
  usernameInput.value         = user.username;
  usernameInput.style.display = 'none';

  // ── Save btn ──
  document.getElementById('profileSaveBtn').style.display = 'none';

  // ── Posts ──
  const postsList = document.getElementById('profilePostsList');
  postsList.innerHTML = '';

  const { data: posts } = await supabase
    .from('posts')
    .select('id, title, body, file_name')
    .eq('user_id', userId)
    .eq('group_id', 'group1')
    .order('created_at', { ascending: false });

  if (posts && posts.length > 0) {
    posts.forEach(p => {
      const label = p.title || p.body?.slice(0, 60) || p.file_name || 'untitled';
      const item = document.createElement('div');
      item.className    = 'profile-post-item';
      item.textContent  = label;

      item.addEventListener('click', async () => {
        const { data: fullPost } = await supabase
          .from('posts').select('*').eq('id', p.id).single();
        if (fullPost) openPostDetailModal(fullPost, user);
      });

      postsList.appendChild(item);
    });
  } else {
    postsList.innerHTML = '<div style="color:rgba(255,255,255,0.2);font-size:0.8rem;padding:10px 0;">no posts yet</div>';
  }

  // ── Edit mode (own profile only, triggered by right-click) ──
  const profileModal = document.getElementById('profileModal');

    let lastProfileRightClick = 0;

  profileModal.oncontextmenu = (e) => {
    if (!isOwnProfile) return;
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    const timeSince = now - lastProfileRightClick;
    lastProfileRightClick = now;

    if (timeSince < DOUBLE_CLICK_THRESHOLD) {
      lastProfileRightClick = 0;
      profileEditMode = !profileEditMode;

      coverOverlay.style.display  = profileEditMode ? 'flex'         : 'none';
      pfpOverlay.style.display    = profileEditMode ? 'flex'         : 'none';
      usernameSpan.style.display  = profileEditMode ? 'none'         : 'inline';
      usernameInput.style.display = profileEditMode ? 'inline'       : 'none';
      document.getElementById('profileSaveBtn').style.display = profileEditMode ? 'inline-block' : 'none';
    }
    // single right-click inside profile does nothing
  };
    profileOverlay.classList.add('open');
  document.body.classList.add('profile-open');
}

function closeProfileModal() {
  profileOverlay.classList.remove('open');
  document.body.classList.remove('profile-open');
  profileEditMode     = false;
  newProfileCoverFile = null;
  newProfilePfpFile   = null;
  currentProfileUserId = null;
}

async function saveProfileChanges() {
  if (!currentProfileUserId) return;

  const updates = {};

  // Username
  const usernameInput = document.getElementById('profileUsernameInput');
  const newUsername = usernameInput.value.trim();
  if (!newUsername || newUsername.length > 12) {
    alert('Username must be 1–12 characters'); return;
  }

  // Check uniqueness only if changed
  const { data: currentUserRow } = await supabase
    .from('users').select('username').eq('id', currentProfileUserId).single();
  if (newUsername !== currentUserRow?.username) {
    const { data: taken } = await supabase
      .from('users').select('id').eq('username', newUsername).maybeSingle();
    if (taken) { alert('Username already taken'); return; }
    updates.username = newUsername;
  }

  // New cover image
  if (newProfileCoverFile) {
    const path = `covers/${currentProfileUserId}-${Date.now()}.${newProfileCoverFile.name.split('.').pop()}`;
    const { error: upErr } = await supabase.storage
      .from('group1-pfps').upload(path, newProfileCoverFile);
    if (upErr) { alert('Cover upload failed'); return; }
    const { data: urlData } = supabase.storage.from('group1-pfps').getPublicUrl(path);
    updates.cover_image_url = urlData.publicUrl;
  }

  // New pfp
  if (newProfilePfpFile) {
    const ext  = newProfilePfpFile.name.split('.').pop() || 'webp';
    const path = `${currentProfileUserId}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('group1-pfps').upload(path, newProfilePfpFile);
    if (upErr) { alert('PFP upload failed'); return; }
    const { data: urlData } = supabase.storage.from('group1-pfps').getPublicUrl(path);
    updates.pfp_url = urlData.publicUrl;
    updates.pfp     = null;
  }

  if (Object.keys(updates).length === 0) {
    closeProfileModal(); return;
  }

  updates.updated_at = new Date();
  const { error } = await supabase
    .from('users').update(updates).eq('id', currentProfileUserId);
  if (error) { alert(`Save failed: ${error.message}`); return; }

  // Refresh current user data if it's their own profile
  if (currentProfileUserId === currentUser?.id) {
    currentUserData = { ...currentUserData, ...updates };
  }

  closeProfileModal();
  await loadPosts();
  renderLinks(lastLoadedPosts, lastLoadedLinks);
}
// ============================================
// 7. POST SUBMISSION
// ============================================


async function handlePostSubmit() {
  if (postSubmitBtn.disabled) return; // prevent double-submit

  const title     = postTitle.value.trim();
  const body      = postText.value.trim();
  const category  = postCategory.value || null;
  const fileList  = [...postFileInput.files];
  const isMulti   = fileList.length > 1;
  const coverFile = postCoverImageInput.files[0] || null;

  if (!title && fileList.length === 0 && !body) {
    alert('Add a title, text, or choose a file');
    return;
  }

  // Client-side file size check (Supabase free tier = 50 MB per file)
  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  for (const file of fileList) {
    if (file.size > MAX_FILE_SIZE) {
      alert(`"${file.name}" is too large — max 50 MB per file.`);
      return;
    }
  }

  postSubmitBtn.disabled    = true;
  postSubmitBtn.textContent = '...';

  try {

    let fileURL = null, fileName = null, fileType = null;
    let filesArray = null;

    if (fileList.length === 1) {
      const file = fileList[0];
      fileName = file.name;
      fileType = await getFileType(file);
      const filePath = `${currentUser.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('group1-posts').upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage
        .from('group1-posts').getPublicUrl(filePath);
      fileURL = urlData.publicUrl;

    } else if (isMulti) {
      filesArray = [];
      for (const file of fileList) {
        const ft = await getFileType(file);
        const filePath = `${currentUser.id}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('group1-posts').upload(filePath, file);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage
          .from('group1-posts').getPublicUrl(filePath);
        filesArray.push({ url: urlData.publicUrl, name: file.name, type: ft });
      }
    }


    // Auto-cover: if multi-file and no manual cover chosen, use first visual file's URL
    let autoCoverUrl = null;
    if (isMulti && !coverFile && filesArray) {
      const firstVisual = filesArray.find(f => f.type === 'image' || f.type === 'video');
      if (firstVisual) autoCoverUrl = firstVisual.url;
    }

    let coverImageURL = null;
    if (coverFile) {
      const coverPath = `${currentUser.id}/covers/${Date.now()}-${coverFile.name}`;
      const { error: coverError } = await supabase.storage
        .from('group1-posts').upload(coverPath, coverFile);
      if (coverError) throw coverError;
      const { data: coverUrlData } = supabase.storage
        .from('group1-posts').getPublicUrl(coverPath);
      coverImageURL = coverUrlData.publicUrl;
    }

        const postRecord = {
      title:    title    || null,
      body:     body     || null,
      category: category || null,
    };

    if (fileList.length === 1) {
      // User chose a new single file — replace everything
      postRecord.file_url  = fileURL;
      postRecord.file_name = fileName;
      postRecord.file_type = fileType;
      postRecord.files     = null;
    } else if (isMulti) {
      // User chose multiple new files — replace everything
      postRecord.files     = filesArray;
      postRecord.file_url  = null;
      postRecord.file_name = null;
      postRecord.file_type = null;
    } else if (editingPostId && editingPost) {
      // Edit with no new file chosen — preserve whatever was already there
      postRecord.file_url  = editingPost.file_url  ?? null;
      postRecord.file_name = editingPost.file_name ?? null;
      postRecord.file_type = editingPost.file_type ?? null;
      postRecord.files     = editingPost.files     ?? null;
    } else {
      // New post with no file
      postRecord.file_url  = null;
      postRecord.file_name = null;
      postRecord.file_type = null;
      postRecord.files     = null;
    }

    // Cover image: use new upload, or auto-cover, or preserve existing on edit
    if (coverImageURL) {
      postRecord.cover_image_url = coverImageURL;
    } else if (autoCoverUrl) {
      postRecord.cover_image_url = autoCoverUrl;
    } else if (editingPostId && editingPost) {
      postRecord.cover_image_url = editingPost.cover_image_url ?? null;
    }

    // ── EDIT ──
    if (editingPostId) {
      await updatePost(editingPostId, postRecord);
      closePostForm();
      await loadPosts();
      await loadLinks();
      renderLinks(lastLoadedPosts, lastLoadedLinks);
      return;
    }

    // ── CREATE ──
    postRecord.user_id  = currentUser.id;
    postRecord.group_id = 'group1';

    const created = await savePost(postRecord);

    if (pendingLinkPostId) {
      const a = String(pendingLinkPostId);
      const b = String(created.id);
      const a_post_id = a < b ? a : b;
      const b_post_id = a < b ? b : a;
      const { error: linkErr } = await supabase
        .from('post_links')
        .insert([{ group_id: 'group1', a_post_id, b_post_id, created_by: currentUser.id }]);
      if (linkErr) console.error('Failed to create link:', linkErr);
    }

    closePostForm();
    await loadPosts();
    await loadLinks();
    renderLinks(lastLoadedPosts, lastLoadedLinks);

    const createdEl = postCanvas.querySelector(`.post-card[data-post-id="${created.id}"]`);
    if (createdEl) {
      await waitForCardMedia(createdEl);
      startPlacement(created, createdEl,
        window.__lastMouseEventForPlacement || { clientX: 200, clientY: 200 });
    }
   } catch (error) {
    console.error('Post submission failed:', error?.message || error);
    alert(`Post failed: ${error?.message || error}`);
  } finally {
    postSubmitBtn.disabled    = false;
    postSubmitBtn.textContent = 'submit';
  }
}

// ============================================
// 8. COVER IMAGE PROMPT
// ============================================

async function handleCoverImageSubmit() {
  if (!pendingPost) return;

  const coverFile = coverImageInput.files[0];
  if (!coverFile) { alert('Choose an image or click skip'); return; }

  try {
    const filePath = `${currentUser.id}/covers/${Date.now()}-${coverFile.name}`;
    const { error: uploadError } = await supabase.storage.from('group1-posts').upload(filePath, coverFile);
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('group1-posts').getPublicUrl(filePath);
    pendingPost.cover_image_url = urlData.publicUrl;

    const isEdit = pendingPost._isEdit;
    const editId = pendingPost._editId;
    if (isEdit) { delete pendingPost._isEdit; delete pendingPost._editId; }

    const saved = isEdit ? await updatePost(editId, pendingPost) : await savePost(pendingPost);

    closeCoverImagePrompt();
    await loadPosts();
    await loadLinks();
    renderLinks(lastLoadedPosts, lastLoadedLinks);

    if (!isEdit && saved) {
      const createdEl = postCanvas.querySelector(`.post-card[data-post-id="${saved.id}"]`);
      if (createdEl) {
        await waitForCardMedia(createdEl);
        startPlacement(saved, createdEl, window.__lastMouseEventForPlacement || { clientX: 200, clientY: 200 });
      }
    }
  } catch (error) {
    console.error('Cover image upload failed:', error.message);
    alert(`Cover image failed: ${error.message}`);
  }
}

async function handleCoverImageSkip() {
  if (!pendingPost) return;

  try {
    const isEdit = pendingPost._isEdit;
    const editId = pendingPost._editId;
    if (isEdit) { delete pendingPost._isEdit; delete pendingPost._editId; }

    const saved = isEdit ? await updatePost(editId, pendingPost) : await savePost(pendingPost);

    closeCoverImagePrompt();
    await loadPosts();
    await loadLinks();
    renderLinks(lastLoadedPosts, lastLoadedLinks);

    if (!isEdit && saved) {
      const createdEl = postCanvas.querySelector(`.post-card[data-post-id="${saved.id}"]`);
      if (createdEl) {
        await waitForCardMedia(createdEl);
        startPlacement(saved, createdEl, window.__lastMouseEventForPlacement || { clientX: 200, clientY: 200 });
      }
    }
  } catch (error) {
    console.error('Post save failed:', error.message);
    alert(`Post failed: ${error.message}`);
  }
}

// ============================================
// 9. SAVE / UPDATE POST
// ============================================

async function savePost(postRecord) {
  const { data, error } = await supabase
    .from('posts')
    .insert([postRecord])
    .select();

  if (error) throw error;

  console.log('Post saved:', data?.[0]?.id);
  return data?.[0];
}

async function updatePost(postId, updates) {
  let query = supabase
    .from('posts')
    .update(updates)
    .eq('id', postId);

  if (!currentUserData?.is_admin) {
    query = query.eq('user_id', currentUser.id);
  }

  const { data, error } = await query.select();
  if (error) throw error;
  return data?.[0];
}

// ============================================
// 10. COMMENTS (unchanged)
// ============================================

async function loadCommentsForPost(postId) {
  const { data: comments, error } = await supabase
    .from('comments')
    .select('id, body, created_at, user_id')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to load comments:', error);
    commentsList.innerHTML = `<div style="opacity:0.7;">failed to load comments</div>`;
    return;
  }

  const commentUserIds = [...new Set((comments || []).map(c => c.user_id).filter(Boolean))];

  let commentUsers = [];
  if (commentUserIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, username')
      .in('id', commentUserIds);

    if (usersError) {
      console.error('Failed to load comment users:', usersError);
    } else {
      commentUsers = users || [];
    }
  }

  const commentUserMap = {};
  commentUsers.forEach(u => { commentUserMap[u.id] = u; });

  commentsList.innerHTML = '';

  if (!comments || comments.length === 0) {
    commentsList.innerHTML = `<div style="opacity:0.7;">no comments yet</div>`;
    return;
  }

  comments.forEach(c => {
    const row = document.createElement('div');
    row.className = 'comment-row';

    const uname = commentUserMap[c.user_id]?.username || 'unknown';

    row.innerHTML = `
      <div class="comment-username">${uname}</div>
      <div class="comment-body">${c.body}</div>
    `;

    commentsList.appendChild(row);
  });
}

async function submitComment() {
  if (!activePostForModal) return;

  const text = commentInput.value.trim();
  if (!text) return;

  const { error } = await supabase
    .from('comments')
    .insert([{
      post_id: activePostForModal.id,
      user_id: currentUser.id,
      body: text
    }]);

  if (error) {
    console.error('Failed to post comment:', error);
    alert(`Comment failed: ${error.message}`);
    return;
  }

  commentInput.value = '';
  await loadCommentsForPost(activePostForModal.id);

  postDetailModal.scrollTop = postDetailModal.scrollHeight;
}

// ============================================
// 11. LOAD AND RENDER POSTS (canvas)
// ============================================
async function loadPosts() {
  try {
    let query = supabase
      .from('posts')
      .select('*')
      .eq('group_id', 'group1')
      .order('created_at', { ascending: false });

    if (editMode) {
  if (!currentUserData?.is_admin) {
    query = query.eq('user_id', currentUser.id);
  }
  // admin sees everyone's posts in edit mod
    } else {
      // NOTE: tree filter is exclusive, but we do NOT clear it here.
      // We clear it only when user clicks category/username (in those handlers),
      // or when they click empty background (optional).
      if (activeUserFilter) {
        query = query.eq('user_id', activeUserFilter);
      }
      if (activeCategoryFilter) {
        if (activeCategoryFilter === NONE_CATEGORY_FILTER) {
          query = query.is('category', null);
        } else {
          query = query.eq('category', activeCategoryFilter);
        }
      }
    }

    const { data: posts, error } = await query;

    if (error) {
      console.error('Failed to load posts:', error);
      return;
    }

    // Store + apply tree filter (exclusive)
    lastLoadedPosts = posts || [];

    if (activeLinkTreeRootPostId) {
      const allowed = getConnectedComponent(activeLinkTreeRootPostId, lastLoadedLinks);
      lastLoadedPosts = lastLoadedPosts.filter(p => allowed.has(String(p.id)));
    }

    // Build user map based on *visible* posts (so you don't fetch unused users)
    const userIds = [...new Set((lastLoadedPosts || []).map(p => p.user_id).filter(Boolean))];

    let users = [];
    if (userIds.length > 0) {
      const { data, error: usersError } = await supabase
        .from('users')
        .select('id, username, pfp, pfp_url')
        .in('id', userIds);

      if (usersError) {
        console.error('Failed to load users:', usersError);
        return;
      }
      users = data || [];
    }

    const userMap = {};
    users.forEach(u => { userMap[u.id] = u; });

    if (!postCanvas) {
      console.error('postCanvas element not found. Check your HTML wrapper.');
      return;
    }

    postCanvas.innerHTML = '';
    buildPostCard._indexCounter = 0;

    // IMPORTANT: render from lastLoadedPosts (filtered), not posts
    (lastLoadedPosts || []).forEach(post => {
      const user = userMap[post.user_id] || {};
      const card = buildPostCard(post, user);
      postCanvas.appendChild(card);
    });

    console.log(`Loaded ${lastLoadedPosts?.length || 0} posts`);

    renderLinks(lastLoadedPosts, lastLoadedLinks);
  } catch (err) {
    console.error('loadPosts crashed:', err);
  }
}



function trapScrollInside(el) {
  if (!el) return;

  el.addEventListener('wheel', (e) => {
    if (isPlacing) return; // let canvas zoom handle it during placement
    const canScroll = el.scrollHeight > el.clientHeight;
    if (!canScroll) return;

    e.stopPropagation();

    const atTop = el.scrollTop <= 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    const scrollingUp = e.deltaY < 0;
    const scrollingDown = e.deltaY > 0;

    if ((scrollingUp && !atTop) || (scrollingDown && !atBottom)) {
      e.preventDefault();
      el.scrollTop += e.deltaY;
    } else {
      /* still prevent canvas zoom when hovering text */
      e.preventDefault();
    }
  }, { passive: false });
}

function getFileExtension(filename = '') {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function isImageExtension(ext) {
  return [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
    'heif', 'avif', 'svg'
  ].includes(ext);
}

function isAudioExtension(ext) {
  return [
    'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga'
  ].includes(ext);
}

function isVideoExtension(ext) {
  return [
    'mp4', 'mov', 'webm', 'm4v', 'ogv'
  ].includes(ext);
}

function isVisualExtension(ext) {
  return isImageExtension(ext) || isVideoExtension(ext);
}

function getFilePreviewLabel(filename = '') {
  const ext = getFileExtension(filename);
  if (!ext) return '?';
  return ext.toUpperCase();
}

function buildFilePreviewMarkup(post) {
  // ── MULTI-FILE ──
  if (post.files && post.files.length > 1) {
    const hasCover = !!post.cover_image_url;
    return `
      <div class="post-file-preview post-file-preview-download${hasCover ? ' has-cover' : ''}">
        ${hasCover ? `<img class="post-file-preview-cover" src="${post.cover_image_url}" alt="">` : ''}
        <div class="post-file-preview-label">+</div>
        <span class="post-file-preview-download-btn">›</span>
      </div>
    `;
  }

  const ext = getFileExtension(post.file_name || '');
  const label = getFilePreviewLabel(post.file_name || '');

  const isImage = post.file_type === 'image' || isImageExtension(ext);
  const isAudio = post.file_type === 'audio' || isAudioExtension(ext);
  const isVideo = (post.file_type === 'video' || isVideoExtension(ext)) && !isAudio;

  if (isImage && post.file_url) {
    return `<img class="post-image" src="${post.file_url}" alt="">`;
  }

  if (isVideo && post.file_url) {
    const label = getFilePreviewLabel(post.file_name || '');
    return `
      <div class="post-file-preview post-file-preview-video">
        <video class="post-preview-video" src="${post.file_url}" muted loop autoplay playsinline preload="metadata"></video>
        <div class="post-file-preview-label">${label}</div>
        <button class="post-preview-mute-btn" type="button" aria-label="toggle sound">X</button>
      </div>
    `;
  }

  if (isAudio && post.file_url) {
    const hasCover = !!post.cover_image_url;
    return `
      <div class="post-file-preview post-file-preview-audio ${hasCover ? 'has-cover' : ''}">
        ${hasCover ? `<img class="post-file-preview-cover" src="${post.cover_image_url}" alt="">` : ''}
        <div class="post-file-preview-label">${label}</div>
        <button class="post-file-preview-play" type="button" aria-label="play audio">></button>
        <audio class="post-preview-audio" src="${post.file_url}" preload="none"></audio>
      </div>
    `;
  }

  // replace the existing `if (post.file_url)` (the download tile) with:
  if (post.file_url) {
    const hasCover = !!post.cover_image_url;
    return `
      <div class="post-file-preview post-file-preview-download${hasCover ? ' has-cover' : ''}">
        ${hasCover ? `<img class="post-file-preview-cover" src="${post.cover_image_url}" alt="">` : ''}
        <div class="post-file-preview-label">${label}</div>
        <a class="post-file-preview-download-btn" href="${post.file_url}" download aria-label="download file">⤓</a>
      </div>
    `;
  }

  return `
    <div class="post-file-preview">
      <div class="post-file-preview-label">${label}</div>
    </div>
  `;
}

// ============================================
// 12. POST CARD BUILDER
// ============================================
function buildPostCard(post, user) {
  const card = document.createElement('div');
  card.className = 'post-card';
  card.dataset.postId = post.id;

  const idx = (buildPostCard._indexCounter || 0);
  buildPostCard._indexCounter = idx + 1;

  const fallbackX = 60 + (idx % 4) * 340;
  const fallbackY = 60 + Math.floor(idx / 4) * 280;

  const x = (post.x ?? fallbackX);
  const y = (post.y ?? fallbackY);

  card.style.left = `${x}px`;
  card.style.top = `${y}px`;

  const hasTitle = !!(post.title && post.title.trim());
  const hasText = !!(post.body && post.body.trim());

  const isMultiFile  = !!(post.files && post.files.length > 1);
  const fileExt = getFileExtension(post.file_name || '');
  const isImageFile  = isImageExtension(fileExt)  || post.file_type === 'image';
  const isAudioFile  = isAudioExtension(fileExt)  || post.file_type === 'audio';
  const isVideoFile  = (isVideoExtension(fileExt) || post.file_type === 'video') && !isAudioFile;
  const isVisualFile = isImageFile || isVideoFile;
  const hasCoverImage = !!post.cover_image_url;
  // CHANGE these two lines:
  const hasAnyFile = !!post.file_url || isMultiFile;
  const isOtherFile = (!!post.file_url && !isVisualFile && !isAudioFile) || isMultiFile;

  const hasVisual = hasAnyFile && (isVisualFile || hasCoverImage);

  let visualSrc = null;
  if (isImageFile || isVideoFile) {
    visualSrc = post.file_url;
  } else if (hasCoverImage) {
    visualSrc = post.cover_image_url;
  }

  const content = document.createElement('div');
  content.className = 'post-card-content';

 if (hasTitle && (hasVisual || isAudioFile || isOtherFile) && hasText) {
  content.classList.add('post-layout-title-visual-text');

  let previewMarkup = '';
  if (isImageFile) {
    previewMarkup = `<img class="post-image" src="${visualSrc}" alt="">`;
  } else if (isVideoFile || isAudioFile || isOtherFile) {
    previewMarkup = buildFilePreviewMarkup(post);
  } else if (hasCoverImage) {
    previewMarkup = `<img class="post-image" src="${visualSrc}" alt="">`;
  }

  content.innerHTML = `
    <div class="post-title"><span class="post-title-track">${post.title}</span></div>
    <div class="post-visual-text-row">
      ${previewMarkup}
      <div class="post-body">${post.body}</div>
    </div>
  `;

} else if (hasTitle && (hasVisual || isAudioFile || isOtherFile)) {
  // ← NEW: title + file/audio, no text
  content.classList.add('post-layout-title-visual');

  let previewMarkup = '';
  if (isImageFile) {
    previewMarkup = `<img class="post-image" src="${visualSrc}" alt="">`;
  } else if (isVideoFile || isAudioFile || isOtherFile) {
    previewMarkup = buildFilePreviewMarkup(post);
  } else if (hasCoverImage) {
    previewMarkup = `<img class="post-image" src="${visualSrc}" alt="">`;
  }

  content.innerHTML = `
    <div class="post-title"><span class="post-title-track">${post.title}</span></div>
    ${previewMarkup}
  `;

 } else if ((isAudioFile || isOtherFile) && hasText) {
  content.classList.add('post-layout-visual-text');
  content.innerHTML = `
    <div class="post-visual-text-row">
      ${buildFilePreviewMarkup(post)}
      <div class="post-body">${post.body}</div>
    </div>
  `;

} else if (hasVisual && hasText) {
  // image/video + text, no title
  content.classList.add('post-layout-visual-text');
  let previewMarkup = isImageFile
    ? `<img class="post-image" src="${visualSrc}" alt="">`
    : buildFilePreviewMarkup(post);
  content.innerHTML = `
    <div class="post-visual-text-row">
      ${previewMarkup}
      <div class="post-body">${post.body}</div>
    </div>
  `;

} else if (hasTitle && hasText) {
  content.classList.add('post-layout-title-text');
  content.innerHTML = `
    <div class="post-title"><span class="post-title-track">${post.title}</span></div>
    <div class="post-body">${post.body}</div>
  `;
} else if (hasVisual) {
  content.classList.add('post-layout-visual');
  if (isVideoFile) {
    content.innerHTML = buildFilePreviewMarkup(post);
    content.querySelector('.post-file-preview-video')?.classList.add('post-file-preview-video-natural');
    content.classList.add('post-layout-visual-natural');
    card.classList.add('post-card-natural-video');

    // Lock card width to the video's actual rendered size once metadata is available
    const vid = content.querySelector('.post-preview-video');
    if (vid) {
      const applyNaturalWidth = () => {
        if (!vid.videoWidth || !vid.videoHeight) return;
        const aspect = vid.videoWidth / vid.videoHeight;
        // Constrain to max-height:400px and max-width:300px
        let h = Math.min(vid.videoHeight, 400);
        let w = Math.round(h * aspect);
        if (w > 300) { w = 300; h = Math.round(w / aspect); }
        card.style.width = `${w}px`;
      };
      if (vid.readyState >= 1) applyNaturalWidth();
      else vid.addEventListener('loadedmetadata', applyNaturalWidth, { once: true });
    }
  } else if (isOtherFile) {
    content.innerHTML = buildFilePreviewMarkup(post);
  } else {
    content.innerHTML = `<img class="post-image" src="${visualSrc}" alt="">`;
  }

} else if (isAudioFile || isOtherFile) {
  // ← NEW: file only, no title, no text
  content.classList.add('post-layout-visual');
  content.innerHTML = buildFilePreviewMarkup(post);

} else if (hasTitle) {
  content.classList.add('post-layout-title');
  content.innerHTML = `<div class="post-title"><span class="post-title-track">${post.title}</span></div>`;

} else if (hasText) {
  content.classList.add('post-layout-text');
  content.innerHTML = `<div class="post-body">${post.body}</div>`;
}

  if (
  content.classList.contains('post-layout-title-visual-text') ||
  content.classList.contains('post-layout-title-text') ||
  content.classList.contains('post-layout-visual-text') ||
  content.classList.contains('post-layout-text')  // ← add this
) {
  const bodyEl = content.querySelector('.post-body');
  if (bodyEl) {
    const text = bodyEl.textContent.trim();
    if (text.length >= 35) {
      content.classList.add('is-long-text');
      trapScrollInside(bodyEl);
    }
  }
}

  const titleEl = content.querySelector('.post-title');
const titleTrackEl = content.querySelector('.post-title-track');

if (titleEl && titleTrackEl) {
  requestAnimationFrame(() => {
    if (titleTrackEl.scrollWidth > titleEl.clientWidth) {
      const origText = titleTrackEl.textContent;
      const sep = '\u00A0\u00A0'; // just 3 spaces — tight but readable

      titleTrackEl.textContent = origText + sep + origText;

      // Measure the real seam after the text is set
      requestAnimationFrame(() => {
        const totalW = titleTrackEl.scrollWidth;
        if (totalW > 0) {
          // seam is at exactly (origText + sep) width
          // easiest: just divide — if both halves are equal it's very close to 50%
          // but we measure to be safe
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const style = getComputedStyle(titleTrackEl);
          ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const firstHalfW = ctx.measureText(origText + sep).width;
          const pct = (firstHalfW / totalW) * 100;
          titleTrackEl.style.setProperty('--marquee-end-pct', `-${pct.toFixed(3)}%`);
        }
      });

      titleEl.classList.add('is-marquee');
    }
  });
}



  const previewVideo = content.querySelector('.post-preview-video');
  const muteBtn = content.querySelector('.post-preview-mute-btn');

   if (previewVideo && muteBtn) {
    muteBtn.textContent = '♪'; // starts muted — click to toggle sound

    // Hover to preview; pause when mouse leaves
    previewVideo.addEventListener('mouseenter', () => previewVideo.play().catch(() => {}));
    previewVideo.addEventListener('mouseleave', () => { previewVideo.pause(); });

    // Prevent drag-drop placement from accidentally triggering mute
    muteBtn.addEventListener('mousedown', e => e.stopPropagation());
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      previewVideo.muted = !previewVideo.muted;
      muteBtn.textContent = previewVideo.muted ? '♪' : '⊘';
    });
  }

  const dlBtn = content.querySelector('.post-file-preview-download-btn[data-url]');
  if (dlBtn) {
    dlBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = document.createElement('a');
      a.href     = dlBtn.dataset.url;
      a.download = dlBtn.dataset.name || 'file';
      a.click();
    });
  }

  const audioPreview = content.querySelector('.post-preview-audio');
  const playBtn = content.querySelector('.post-file-preview-play');

  if (audioPreview && playBtn) {
    playBtn.textContent = audioPreview.paused ? '▷' : '☐';

        playBtn.addEventListener('click', async (e) => {
      e.stopPropagation();

      try {
        // Lazy-load src on first click — prevents autoplay on card render
        if (!audioPreview.src && audioPreview.dataset.src) {
          audioPreview.src = audioPreview.dataset.src;
        }
        if (audioPreview.paused) {
          await audioPreview.play();
          playBtn.textContent = '☐';
        } else {
          audioPreview.pause();
          playBtn.textContent = '▷';
        }
      } catch (err) {
        console.error('Audio preview failed:', err);
      }
    });

    audioPreview.addEventListener('ended', () => {
      playBtn.textContent = '▷';
    });

    audioPreview.addEventListener('pause', () => {
      playBtn.textContent = '▷';
    });

    audioPreview.addEventListener('play', () => {
      playBtn.textContent = '☐';
    });
  }

  card.appendChild(content);

  const footer = document.createElement('div');
  footer.className = 'post-footer';

  const pfpFallback = './images/pfps/default.png';
  const pfpSrc = user?.pfp_url || (user?.pfp ? `./images/pfps/${user.pfp}` : pfpFallback);


      if (editMode) {
    footer.innerHTML = `
      <img class="post-footer-pfp" src="${pfpSrc}" alt="" data-user-id="${post.user_id}" style="cursor:pointer;">
      <span class="post-footer-action post-footer-edit">edit</span>
      <span class="post-footer-action post-footer-reposition">⟴</span>
      <span class="post-footer-category post-footer-filter-btn"><span class="post-footer-category-track">${post.category || 'none'}</span></span>
    `;

    footer.querySelector('.post-footer-edit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditForm(post);
    });

    footer.querySelector('.post-footer-delete')?.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeletePost(post.id);
    });

    footer.querySelector('.post-footer-reposition')?.addEventListener('click', (e) => {
      e.stopPropagation();
      startPlacement(post, card, window.__lastMouseEventForPlacement || { clientX: 200, clientY: 200 });
    });

    const pfpEl = footer.querySelector('.post-footer-pfp'); // ← const was missing, causing ReferenceError
    if (pfpEl) {
      let pfpPressTimer = null;
      pfpEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        pfpPressTimer = setTimeout(() => { pfpPressTimer = null; openProfileModal(post.user_id); }, 400);
      });
      pfpEl.addEventListener('mouseup',    () => { clearTimeout(pfpPressTimer); pfpPressTimer = null; });
      pfpEl.addEventListener('mouseleave', () => { clearTimeout(pfpPressTimer); pfpPressTimer = null; });
    }
  }

  else {
    footer.innerHTML = `
    <img class="post-footer-pfp" src="${pfpSrc}" alt="" data-user-id="${post.user_id}" style="cursor:pointer;">
    <span class="post-footer-username post-footer-filter-btn"><span class="post-footer-username-track">${user?.username || 'unknown'}</span></span>
    <span class="post-footer-category post-footer-filter-btn"><span class="post-footer-category-track">${post.category || 'none'}</span></span>
  `;

    // Replace the single-click pfp listener in BOTH branches with this:
const pfpEl = footer.querySelector('.post-footer-pfp');
if (pfpEl) {
  let pfpPressTimer = null;
  pfpEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pfpPressTimer = setTimeout(() => {
      pfpPressTimer = null;
      openProfileModal(post.user_id);
    }, 400);
  });
  pfpEl.addEventListener('mouseup',    () => { clearTimeout(pfpPressTimer); pfpPressTimer = null; });
  pfpEl.addEventListener('mouseleave', () => { clearTimeout(pfpPressTimer); pfpPressTimer = null; });
}

    const usernameEl = footer.querySelector('.post-footer-username');
    if (usernameEl && user?.id) {
      usernameEl.addEventListener('click', (e) => {
        e.stopPropagation();
        activeUserFilter = (activeUserFilter === user.id) ? null : user.id;
        loadPosts();
      });
    }

    const categoryEl = footer.querySelector('.post-footer-category');
    if (categoryEl) {
      categoryEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const isNone = post.category == null;
        const nextFilter = isNone ? NONE_CATEGORY_FILTER : post.category;
        activeCategoryFilter = (activeCategoryFilter === nextFilter) ? null : nextFilter;
        loadPosts();
      });
    }
  }

  card.appendChild(footer);

  const categoryEl = card.querySelector('.post-footer-category');
const categoryTrackEl = card.querySelector('.post-footer-category-track');

if (categoryEl && categoryTrackEl) {
  requestAnimationFrame(() => {
    if (categoryTrackEl.scrollWidth > categoryEl.clientWidth) {
      const origText = categoryTrackEl.textContent;
      const sep = '\u00A0\u00A0';

      categoryTrackEl.textContent = origText + sep + origText;

      requestAnimationFrame(() => {
        const totalW = categoryTrackEl.scrollWidth;
        if (totalW > 0) {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const style = getComputedStyle(categoryTrackEl);
          ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const firstHalfW = ctx.measureText(origText + sep).width;
          const pct = (firstHalfW / totalW) * 100;
          categoryTrackEl.style.setProperty('--marquee-end-pct', `-${pct.toFixed(3)}%`);
        }
      });

      categoryEl.classList.add('is-marquee');
    }
  });
}

  const usernameEl      = card.querySelector('.post-footer-username');
  const usernameTrackEl = card.querySelector('.post-footer-username-track');

  if (usernameEl && usernameTrackEl) {
    requestAnimationFrame(() => {
      if (usernameTrackEl.scrollWidth > usernameEl.clientWidth) {
        const origText = usernameTrackEl.textContent;
        const sep = '\u00A0';
        usernameTrackEl.textContent = origText + sep + origText;

        requestAnimationFrame(() => {
          const totalW = usernameTrackEl.scrollWidth;
          if (totalW > 0) {
            const cvs = document.createElement('canvas');
            const ctx = cvs.getContext('2d');
            const style = getComputedStyle(usernameTrackEl);
            ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const firstHalfW = ctx.measureText(origText + sep).width;
            const pct = (firstHalfW / totalW) * 100;
            usernameTrackEl.style.setProperty('--marquee-end-pct', `-${pct.toFixed(3)}%`);
          }
        });

        usernameEl.classList.add('is-marquee');
      }
    });
  }

  const LONG_PRESS_DURATION = 400; // ms — tweak to taste
let longPressTimer = null;

card.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (isPlacing) return;
  if (e.target.closest('.post-footer-action')) return;
  if (e.target.closest('.post-preview-mute-btn')) return;
  if (e.target.closest('.post-file-preview-play')) return;
  if (e.target.closest('.post-file-preview-download-btn')) return;

  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    openPostDetailModal(post, user);
  }, LONG_PRESS_DURATION);
});

card.addEventListener('mouseup', () => {
  clearTimeout(longPressTimer);
  longPressTimer = null;
});

  card.addEventListener('mouseleave', () => {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  });

  return card;
} // ← THIS is missing — closes buildPostCard

// ============================================
// 13. INITIALIZE EVENT LISTENERS
// ============================================

function initializeEventListeners() {
  window.addEventListener('mousemove', (e) => {
    window.__lastMouseEventForPlacement = e;
  });

  document.getElementById('pdFullscreenBtn')?.addEventListener('click', togglePdFullscreen);
  initPdResize();

  const canvasViewport = document.getElementById('canvasViewport');

  // ── Middle-click pan (works in ALL modes including placement) ──
  canvasViewport.addEventListener('mousedown', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartOffsetX = canvasOffsetX;
    panStartOffsetY = canvasOffsetY;
  });

  // ── Left-click pan (view mode only, disabled during placement) ──
  canvasViewport.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (isPlacing) return;
    if (e.target.closest('.post-card')) return;
    if (e.target.closest('#linkLayer')) return;

    if (activeLinkTreeRootPostId) {
      activeLinkTreeRootPostId = null;
      loadPosts();
      return;
    }

    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartOffsetX = canvasOffsetX;
    panStartOffsetY = canvasOffsetY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    canvasOffsetX = panStartOffsetX + dx;
    canvasOffsetY = panStartOffsetY + dy;
    applyCanvasTransform();
  });

  window.addEventListener('mouseup', () => {
    isPanning = false;
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 1) isPanning = false;
  }); 

  window.addEventListener('mousemove', (e) => {
    if (isPlacing) updatePlacementPosition(e);
  });

  window.addEventListener('mousedown', async (e) => {
    if (!isPlacing) return;
    if (e.button !== 0) return;
    await tryDropPlacement(e);
  });

  canvasViewport.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault();
  });

  // Right-click: single = open/close form, double = toggle edit mode
    (canvasViewport || mainPageContainer).addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (isPlacing) return;

    const now = Date.now();
    const timeSince = now - lastRightClick;
    lastRightClick = now;

    const isFormOpen = postFormOverlay.style.display === 'flex';

    if (timeSince < DOUBLE_CLICK_THRESHOLD) {
      lastRightClick = 0;
      closePostForm();
      toggleEditMode();
      return;
    }

    // if right-clicked on a post, next created post links to it
    const clickedCard = e.target.closest('.post-card');
    pendingLinkPostId = clickedCard ? clickedCard.dataset.postId : null;

    setTimeout(() => {
      if (lastRightClick !== now) return;

      if (isFormOpen) {
        closePostForm();
        return;
      }

      if (!editMode) {
        openPostForm();
      }
    }, DOUBLE_CLICK_THRESHOLD);
  });

    // Profile modal
  document.getElementById('profileClose').addEventListener('click', closeProfileModal);


  document.getElementById('profileSaveBtn').addEventListener('click', saveProfileChanges);

  document.getElementById('profileCoverInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    newProfileCoverFile = file;
    const coverImg = document.getElementById('profileCoverImg');
    coverImg.src           = URL.createObjectURL(file);
    coverImg.style.display = 'block';
    document.getElementById('profileCoverPlaceholder').style.display = 'none';
  });

  document.getElementById('profilePfpInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    newProfilePfpFile = file;
    const pfpWidget = document.getElementById('profilePfpWidget');
    pfpWidget.innerHTML = '';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.style.cssText = 'width:60px;height:60px;object-fit:cover;display:block;';
    pfpWidget.appendChild(img);
  });

  // Escape closes profile modal too
  // (add to existing keydown handler)

  // Wheel zoom (disable during placement to keep it stable)
  canvasViewport.addEventListener('wheel', (e) => {
      e.preventDefault();
  

    e.preventDefault();

    const delta = e.deltaY;
    const zoomFactor = Math.exp(-delta * ZOOM_SENSITIVITY);

    const oldScale = canvasScale;
    let newScale = oldScale * zoomFactor;
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    if (newScale === oldScale) return;

    const mouseX = e.clientX;
    const mouseY = e.clientY;

    const before = viewportPointToCanvasPoint(mouseX, mouseY);

    canvasScale = newScale;

    canvasOffsetX = mouseX - before.x * canvasScale;
    canvasOffsetY = mouseY - before.y * canvasScale;

    applyCanvasTransform();
  }, { passive: false });

  postCancelBtn.addEventListener('click', closePostForm);

  postFormOverlay.addEventListener('click', (e) => {
    if (e.target === postFormOverlay) closePostForm();
  });

   postCoverImageInput.addEventListener('change', () => {
    const file = postCoverImageInput.files[0];
    if (file) {
      postCoverFileName.textContent = file.name;
    } else {
      postCoverFileName.textContent = editingPost?.cover_image_url
        ? 'replace cover'
        : 'choose cover image';
    }
  });


  postFileInput.addEventListener('change', async () => {
  const files = [...postFileInput.files];
  if (files.length === 0) {
    postFileName.textContent = 'choose file';
    postCoverImageLabel.style.display = 'none';
    postCoverImageInput.value = '';
    postCoverFileName.textContent = 'choose cover image';
    return;
  }

  postFileName.textContent = files.length === 1
    ? files[0].name
    : `${files.length} files`;

  // Show cover input if any file is non-visual
  const types = await Promise.all(files.map(f => getFileType(f)));
  const anyNonVisual = types.some(t => t !== 'image' && t !== 'video');

  if (anyNonVisual) {
    postCoverImageLabel.style.display = 'block';
  } else {
    postCoverImageLabel.style.display = 'none';
    postCoverImageInput.value = '';
    postCoverFileName.textContent = 'choose cover image';
  }
});

  postSubmitBtn.addEventListener('click', handlePostSubmit);

  addCategoryToggle.addEventListener('click', () => {
    if (postCategory.style.display !== 'none') {
      postCategory.style.display = 'none';
      postCategoryInput.style.display = 'block';
      postCategoryInput.value = '';
      postCategoryInput.focus();
      addCategoryToggle.textContent = '×';
    } else {
      postCategory.style.display = 'block';
      postCategoryInput.style.display = 'none';
      postCategoryInput.value = '';
      addCategoryToggle.textContent = '+';
    }
  });

  postCategoryInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddCategory();
    }
  });


  logoutBtn?.addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      alert(`Logout failed: ${error.message}`);
      return;
    }
    window.location.href = './index.html';
  });

  postDeleteBtn.addEventListener('click', async () => {
  if (!editingPostId) return;
  await handleDeletePost(editingPostId);
  closePostForm();
});

  postDetailClose?.addEventListener('click', closePostDetailModal);
  postDetailOverlay?.addEventListener('click', (e) => {
    if (e.target === postDetailOverlay) closePostDetailModal();
  });

  commentSubmitBtn?.addEventListener('click', submitComment);
  commentInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitComment();
    }
  });

   // Escape key — closes post detail first, then panels
  document.addEventListener('keydown', (e) => {
  // H key — open/close help (only when not typing)
  if (
    e.key === 'h' || e.key === 'H'
  ) {
    const tag = document.activeElement?.tagName?.toLowerCase();
    const isTyping = tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable;
    if (!isTyping) {
      e.preventDefault();
      const helpOverlay = document.getElementById('helpOverlay');
      const isOpen = helpOverlay.style.display !== 'none';
      helpOverlay.style.display = isOpen ? 'none' : 'flex';
      return;
    }
  }

  if (e.key !== 'Escape') return;
  const helpOverlay = document.getElementById('helpOverlay');
  if (helpOverlay.style.display !== 'none') {
    helpOverlay.style.display = 'none';
  } else if (postDetailOverlay?.style.display === 'flex') {
    closePostDetailModal();
  } else if (profileOverlay?.classList.contains('open')) {
    closeProfileModal();
  } else if (notifPanel?.classList.contains('open')) {
    notifPanel.classList.remove('open');
    document.body.classList.remove('notif-open');
  } else if (postFormOverlay?.style.display === 'flex') {
    closePostForm();
  } else if (editMode) {
    toggleEditMode();
  }
});

document.getElementById('helpClose')?.addEventListener('click', () => {
  document.getElementById('helpOverlay').style.display = 'none';
});

document.getElementById('helpOverlay')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('helpOverlay')) {
    document.getElementById('helpOverlay').style.display = 'none';
  }
});

  // Notification panel toggle — persistent, no canvas-click close
  notifBar.addEventListener('click', () => {
    const isOpen = notifPanel.classList.contains('open');
    if (isOpen) {
      notifPanel.classList.remove('open');
      document.body.classList.remove('notif-open');
    } else {
      notifPanel.classList.add('open');
      document.body.classList.add('notif-open');
      loadNotifications();
    }
  });

}




// ============================================
// 14. INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Main page loaded');

  document.documentElement.style.setProperty(
    "--bg-url",
    `url(${import.meta.env.BASE_URL}images/background.jpg)`
  );

  const session = await checkAuth();
if (!session) return;

initializeEventListeners();
await loadCategories();
await loadPosts();
await loadLinks();
await loadNotifications();
await initMusic(currentUser, currentUserData);  // ← after auth confirmed
renderLinks(lastLoadedPosts, lastLoadedLinks);

  console.log('Main page ready');
});