// ============================================
// SUPABASE IMPORTS
// ============================================

import { supabase } from './supabase-config.js';

// ============================================
// DOM ELEMENT REFERENCES
// ============================================

const mainPageContainer = document.getElementById('mainPageContainer');

// Canvas (new)
const postCanvas = document.getElementById('postCanvas');
const linkLayer = document.getElementById('linkLayer');

// (legacy) if still in HTML; not used anymore once canvas is wired
const postFeed = document.getElementById('postFeed');

// Post form overlay
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
const coverImageOverlay = document.getElementById('coverImageOverlay');
const coverImageInput = document.getElementById('coverImageInput');
const coverImageFileName = document.getElementById('coverImageFileName');
const coverImageSubmitBtn = document.getElementById('coverImageSubmitBtn');
const coverImageSkipBtn = document.getElementById('coverImageSkipBtn');

// Post detail modal
const postDetailOverlay = document.getElementById('postDetailOverlay');
const postDetailModal = document.getElementById('postDetailModal');
const postDetailClose = document.getElementById('postDetailClose');
const postDetailContent = document.getElementById('postDetailContent');
const commentsList = document.getElementById('commentsList');
const commentInput = document.getElementById('commentInput');
const commentSubmitBtn = document.getElementById('commentSubmitBtn');

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
let editingPostId = null;

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
const MIN_SCALE = 0.4;
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
  // offsetWidth/Height are unscaled layout px; convert to canvas units
  const w = cardEl.offsetWidth / canvasScale;
  const h = cardEl.offsetHeight / canvasScale;
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

function startPlacement(post, cardEl, mouseEvent) {
  isPlacing = true;
  placingPost = post;
  placingCardEl = cardEl;

  placingCardEl.style.zIndex = '20';

  // center under cursor (canvas units)
  const w = placingCardEl.offsetWidth;
  const h = placingCardEl.offsetHeight;
  placeMouseOffsetX = (w / 2) / canvasScale;
  placeMouseOffsetY = (h / 2) / canvasScale;

  placingCardEl.style.outline = '2px solid rgba(255,255,255,0.25)';

  // Position immediately
  updatePlacementPosition(mouseEvent);

  // Reposition once after layout settles (images etc.)
  requestAnimationFrame(() => {
    if (isPlacing && placingCardEl === cardEl) {
      updatePlacementPosition(mouseEvent);
    }
  });
}

function stopPlacement() {
  if (placingCardEl) {
    placingCardEl.style.zIndex = '';
    placingCardEl.style.outline = '';
  }
  isPlacing = false;
  placingPost = null;
  placingCardEl = null;
}

function updatePlacementPosition(e) {
  if (!isPlacing || !placingCardEl) return;

  const pt = viewportPointToCanvasPoint(e.clientX, e.clientY);
  const x = pt.x - placeMouseOffsetX;
  const y = pt.y - placeMouseOffsetY;

  placingCardEl.style.left = `${x}px`;
  placingCardEl.style.top = `${y}px`;

  // Preview valid/invalid
  const ok = canPlaceCardAt(placingCardEl, x, y);
  placingCardEl.style.opacity = ok ? '1' : '0.6';

  // keep links in sync while dragging
  renderLinks(lastLoadedPosts, lastLoadedLinks);
}

async function tryDropPlacement(e) {
  if (!isPlacing || !placingCardEl || !placingPost) return;

  const x = parseFloat(placingCardEl.style.left || '0');
  const y = parseFloat(placingCardEl.style.top || '0');

  if (!canPlaceCardAt(placingCardEl, x, y)) {
    return; // keep sticky until a valid spot
  }

  const { error } = await supabase
    .from('posts')
    .update({ x, y })
    .eq('id', placingPost.id)
    .eq('user_id', currentUser.id);

  if (error) {
    console.error('Failed to save placement:', error);
    alert(`Failed to save placement: ${error.message}`);
    return;
  }

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

function getFileType(file) {
  const mime = file?.type || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'other';
}

function isVisualFile(file) {
  const type = getFileType(file);
  return type === 'image' || type === 'video';
}

// ============================================
// 3. OVERLAY OPEN/CLOSE HELPERS
// ============================================

function openPostForm() {
  postFormOverlay.style.display = 'flex';
}

function closePostForm() {
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

  // clear pending link target
  pendingLinkPostId = null;
}

function closeCoverImagePrompt() {
  coverImageOverlay.style.display = 'none';
  coverImageInput.value = '';
  coverImageFileName.textContent = 'choose image';
  pendingPost = null;
}

// (modal functions unchanged)
function openPostDetailModal(post, user) {
  activePostForModal = post;

  const titleHtml = post.title ? `<div class="post-title">${post.title}</div>` : '';
  const bodyHtml = post.body ? `<div class="post-body">${post.body}</div>` : '';

  let visualHtml = '';
  if (post.file_type === 'image' && post.file_url) {
    visualHtml = `<img class="post-image" src="${post.file_url}" alt="">`;
  } else if (post.file_type === 'video' && post.file_url) {
    visualHtml = `<video class="post-video" src="${post.file_url}" controls></video>`;
  } else if (post.cover_image_url) {
    visualHtml = `<img class="post-image" src="${post.cover_image_url}" alt="">`;
  }

  let fileActionsHtml = '';
  if (post.file_url && post.file_type === 'other') {
    fileActionsHtml = `
      <div class="post-file-actions" style="margin-top:10px;">
        <a href="${post.file_url}" target="_blank" rel="noreferrer">view file</a>
        <span style="opacity:0.4;"> | </span>
        <a href="${post.file_url}" download>save file</a>
      </div>
    `;
  }

  postDetailContent.innerHTML = `
    ${titleHtml}
    ${visualHtml}
    ${bodyHtml}
    ${fileActionsHtml}
    <div style="margin-top:10px; opacity:0.7;">
      ${user?.username ? `posted by ${user.username}` : ''}
      ${post.category ? ` • ${post.category}` : ''}
    </div>
  `;

  postDetailOverlay.style.display = 'flex';
  loadCommentsForPost(post.id);
}

function closePostDetailModal() {
  postDetailOverlay.style.display = 'none';
  postDetailContent.innerHTML = '';
  commentsList.innerHTML = '';
  commentInput.value = '';
  activePostForModal = null;
}

// ============================================
// 4. EDIT MODE
// ============================================

function toggleEditMode() {
  editMode = !editMode;
  console.log('Edit mode:', editMode ? 'ON' : 'OFF');

  activeUserFilter = null;
  activeCategoryFilter = null;

  if (editMode) {
    mainPageContainer.classList.add('edit-mode');
  } else {
    mainPageContainer.classList.remove('edit-mode');
  }

  loadPosts();
}

function openEditForm(post) {
  editingPostId = post.id;

  postTitle.value = post.title || '';
  postText.value = post.body || '';
  postCategory.value = post.category || '';

  postFileName.textContent = post.file_name ? post.file_name : 'choose file';

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

    // center points in VIEWPORT px (relative to svg origin)
    const x1 = (aRect.left + aRect.right) / 2 - svgRect.left;
    const y1 = (aRect.top + aRect.bottom) / 2 - svgRect.top;
    const x2 = (bRect.left + bRect.right) / 2 - svgRect.left;
    const y2 = (bRect.top + bRect.bottom) / 2 - svgRect.top;

    const d = orthogonalPathD(x1, y1, x2, y2);

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
      console.log('LINK CLICKED', link);

      // Exclusive: clicking a link clears other filters
      activeUserFilter = null;
      activeCategoryFilter = null;

      // Pick any endpoint as the "root" for the component
      activeLinkTreeRootPostId = aId;

      loadPosts();
    });

    linkLayer.appendChild(hit);

    // --- VISIBLE PATH (thin; ignores clicks so hit-path gets them) ---
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'rgba(255,255,255,0.22)');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    path.style.pointerEvents = 'none';

    linkLayer.appendChild(path);
  }
}

// ============================================
// 7. POST SUBMISSION
// ============================================

async function handlePostSubmit() {
  const title = postTitle.value.trim();
  const body = postText.value.trim();
  const category = postCategory.value || null;
  const file = postFileInput.files[0] || null;

  if (!title && !file && !body) {
    alert('Add a title, text, or choose a file');
    return;
  }

  try {
    let fileURL = null;
    let fileName = null;
    let fileType = null;

    if (file) {
      fileName = file.name;
      fileType = getFileType(file);

      const filePath = `${currentUser.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('group1-posts')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('group1-posts')
        .getPublicUrl(filePath);

      fileURL = urlData.publicUrl;
    }

    const postRecord = {
      title: title || null,
      body: body || null,
      category: category
    };

    if (file) {
      postRecord.file_url = fileURL;
      postRecord.file_name = fileName;
      postRecord.file_type = fileType;
    }

    // EDIT
    if (editingPostId) {
      if (file && !isVisualFile(file)) {
        pendingPost = { ...postRecord, _isEdit: true, _editId: editingPostId };
        closePostForm();
        coverImageOverlay.style.display = 'flex';
        return;
      }

      await updatePost(editingPostId, postRecord);
      closePostForm();
      await loadPosts();
    await loadLinks();
    renderLinks(lastLoadedPosts, lastLoadedLinks);
      return;
    }

    // CREATE
    postRecord.user_id = currentUser.id;
    postRecord.group_id = 'group1';

    if (!file) {
      postRecord.file_url = null;
      postRecord.file_name = null;
      postRecord.file_type = null;
    }

    if (file && !isVisualFile(file)) {
      pendingPost = postRecord;
      closePostForm();
      coverImageOverlay.style.display = 'flex';
      return;
    }

    const created = await savePost(postRecord);

    // If user right-clicked a post to open the form, connect them
    if (pendingLinkPostId) {
      const a = String(pendingLinkPostId);
      const b = String(created.id);
      const a_post_id = a < b ? a : b;
      const b_post_id = a < b ? b : a;

      const { error: linkErr } = await supabase
        .from('post_links')
        .insert([{
          group_id: 'group1',
          a_post_id,
          b_post_id,
          created_by: currentUser.id
        }]);

      if (linkErr) {
        console.error('Failed to create link:', linkErr);
      }
    }

    closePostForm();

   await loadPosts();
await loadLinks();
renderLinks(lastLoadedPosts, lastLoadedLinks);

    const createdEl = postCanvas.querySelector(`.post-card[data-post-id="${created.id}"]`);
    if (createdEl) {
      startPlacement(
        created,
        createdEl,
        window.__lastMouseEventForPlacement || { clientX: 200, clientY: 200 }
      );
    } else {
      console.warn('Created post card not found for placement', created.id);
    }
  } catch (error) {
    console.error('Post submission failed:', error?.message || error);
    alert(`Post failed: ${error?.message || error}`);
  }
}

// ============================================
// 8. COVER IMAGE PROMPT
// ============================================

async function handleCoverImageSubmit() {
  if (!pendingPost) return;

  const coverFile = coverImageInput.files[0];
  if (!coverFile) {
    alert('Choose an image or click skip');
    return;
  }

  try {
    const filePath = `${currentUser.id}/covers/${Date.now()}-${coverFile.name}`;
    const { error: uploadError } = await supabase.storage
      .from('group1-posts')
      .upload(filePath, coverFile);

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('group1-posts')
      .getPublicUrl(filePath);

    pendingPost.cover_image_url = urlData.publicUrl;

    if (pendingPost._isEdit) {
      const editId = pendingPost._editId;
      delete pendingPost._isEdit;
      delete pendingPost._editId;
      await updatePost(editId, pendingPost);
    } else {
      await savePost(pendingPost);
    }

    closeCoverImagePrompt();
   await loadPosts();
await loadLinks();
renderLinks(lastLoadedPosts, lastLoadedLinks);
  } catch (error) {
    console.error('Cover image upload failed:', error.message);
    alert(`Cover image failed: ${error.message}`);
  }
}

async function handleCoverImageSkip() {
  if (!pendingPost) return;

  try {
    if (pendingPost._isEdit) {
      const editId = pendingPost._editId;
      delete pendingPost._isEdit;
      delete pendingPost._editId;
      await updatePost(editId, pendingPost);
    } else {
      await savePost(pendingPost);
    }

    closeCoverImagePrompt();
  await loadPosts();
await loadLinks();
renderLinks(lastLoadedPosts, lastLoadedLinks);
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
  const { data, error } = await supabase
    .from('posts')
    .update(updates)
    .eq('id', postId)
    .eq('user_id', currentUser.id)
    .select();

  if (error) throw error;

  console.log('Post updated:', data?.[0]?.id);
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
      query = query.eq('user_id', currentUser.id);
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

  const hasTitle = post.title && post.title.trim();
  const hasText = post.body && post.body.trim();

  const hasVisual = !!post.file_url && (
    post.file_type === 'image' ||
    post.file_type === 'video' ||
    !!post.cover_image_url
  );

  let visualSrc = null;
  if (post.file_type === 'image') {
    visualSrc = post.file_url;
  } else if (post.cover_image_url) {
    visualSrc = post.cover_image_url;
  }

  const content = document.createElement('div');
  content.className = 'post-card-content';

  if (hasTitle && hasVisual && hasText) {
    content.classList.add('post-layout-title-visual-text');
    content.innerHTML = `
      <div class="post-title">${post.title}</div>
      <div class="post-visual-text-row">
        <img class="post-image" src="${visualSrc}" alt="">
        <div class="post-body">${post.body}</div>
      </div>
    `;
  } else if (hasTitle && hasVisual) {
    content.classList.add('post-layout-title-visual');
    content.innerHTML = `
      <div class="post-title">${post.title}</div>
      <img class="post-image" src="${visualSrc}" alt="">
    `;
  } else if (hasTitle && hasText) {
    content.classList.add('post-layout-title-text');
    content.innerHTML = `
      <div class="post-title">${post.title}</div>
      <div class="post-body">${post.body}</div>
    `;
  } else if (hasVisual) {
    content.classList.add('post-layout-visual');
    content.innerHTML = `
      <img class="post-image" src="${visualSrc}" alt="">
    `;
  } else if (hasTitle) {
    content.classList.add('post-layout-title');
    content.innerHTML = `<div class="post-title">${post.title}</div>`;
  } else if (hasText) {
    content.classList.add('post-layout-text');
    content.innerHTML = `<div class="post-body">${post.body}</div>`;
  }

  card.appendChild(content);

  const footer = document.createElement('div');
  footer.className = 'post-footer';

  const pfpFallback = './images/pfps/default.png';
  const pfpSrc = user?.pfp_url || (user?.pfp ? `./images/pfps/${user.pfp}` : pfpFallback);

  if (editMode) {
    footer.innerHTML = `
      <img class="post-footer-pfp" src="${pfpSrc}" alt="">
      <span class="post-footer-action post-footer-edit">edit</span>
      <span class="post-footer-action post-footer-reposition">reposition</span>
      <span class="post-footer-action post-footer-delete">delete</span>
      ${post.file_name ? `<span class="post-footer-filename">${post.file_name}</span>` : ''}
      <span class="post-footer-category">${post.category || 'none'}</span>
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
  } else {
    footer.innerHTML = `
      <img class="post-footer-pfp" src="${pfpSrc}" alt="">
      <span class="post-footer-username post-footer-filter-btn">${user?.username || 'unknown'}</span>
      ${post.file_name ? `<span class="post-footer-filename">${post.file_name}</span>` : ''}
      <span class="post-footer-category post-footer-filter-btn">${post.category || 'none'}</span>
    `;

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

  card.addEventListener('click', (e) => {
    if (isPlacing) return;
    if (e.target.closest('.post-footer-action')) return;
    openPostDetailModal(post, user);
  });

  return card;
}

// ============================================
// 13. INITIALIZE EVENT LISTENERS
// ============================================

function initializeEventListeners() {
  window.addEventListener('mousemove', (e) => {
    window.__lastMouseEventForPlacement = e;
  });

  const canvasViewport = document.getElementById('canvasViewport');

  // Pan by dragging empty space
canvasViewport.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (isPlacing) return;
  if (e.target.closest('.post-card')) return;

  // NEW: if tree mode is active, clicking background exits it instead of panning
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

  window.addEventListener('mousemove', (e) => {
    if (isPlacing) updatePlacementPosition(e);
  });

  window.addEventListener('mousedown', async (e) => {
    if (!isPlacing) return;
    if (e.button !== 0) return;
    await tryDropPlacement(e);
  });

  // Right-click: single = open/close form, double = toggle edit mode
  (canvasViewport || mainPageContainer).addEventListener('contextmenu', (e) => {
    e.preventDefault();

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

  postFileInput.addEventListener('change', () => {
    postFileName.textContent = postFileInput.files[0] ? postFileInput.files[0].name : 'choose file';
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

  coverImageInput.addEventListener('change', () => {
    coverImageFileName.textContent = coverImageInput.files[0] ? coverImageInput.files[0].name : 'choose image';
  });

  coverImageSubmitBtn.addEventListener('click', handleCoverImageSubmit);
  coverImageSkipBtn.addEventListener('click', handleCoverImageSkip);

  logoutBtn?.addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      alert(`Logout failed: ${error.message}`);
      return;
    }
    window.location.href = './index.html';
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

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    if (postDetailOverlay?.style.display === 'flex') {
      closePostDetailModal();
    } else if (editMode) {
      toggleEditMode();
    } else if (postFormOverlay?.style.display === 'flex') {
      closePostForm();
    } else if (coverImageOverlay?.style.display === 'flex') {
      closeCoverImagePrompt();
    }
  });
}

// ============================================
// 14. INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Main page loaded');

  const session = await checkAuth();
  if (!session) return;

  initializeEventListeners();
  await loadCategories();
  await loadPosts();
  await loadLinks();
  renderLinks(lastLoadedPosts, lastLoadedLinks);

  console.log('Main page ready');
});