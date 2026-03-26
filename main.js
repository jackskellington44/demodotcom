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


// Ca
let canvasOffsetX = 0;
let canvasOffsetY = 0;

let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartOffsetX = 0;
let panStartOffsetY = 0;

// ============================================
// 0. CANVAS PANNING
// ============================================

function applyCanvasTransform() {
  postCanvas.style.transform = `translate(${canvasOffsetX}px, ${canvasOffsetY}px)`;
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
}

function closeCoverImagePrompt() {
    coverImageOverlay.style.display = 'none';
    coverImageInput.value = '';
    coverImageFileName.textContent = 'choose image';
    pendingPost = null;
}

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

    // Clear filters whenever we toggle edit mode (so nothing "sticks")
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
// 6. POST SUBMISSION
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

        await savePost(postRecord);
        closePostForm();
        await loadPosts();
    } catch (error) {
        console.error('Post submission failed:', error.message);
        alert(`Post failed: ${error.message}`);
    }
}

// ============================================
// 7. COVER IMAGE PROMPT
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
    } catch (error) {
        console.error('Post save failed:', error.message);
        alert(`Post failed: ${error.message}`);
    }
}

// ============================================
// 8. SAVE / UPDATE POST
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
// 9. COMMENTS
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
// 10. LOAD AND RENDER POSTS (canvas)
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

        const userIds = [...new Set((posts || []).map(p => p.user_id).filter(Boolean))];

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

        // Reset fallback layout counter for stable positioning on refresh
        buildPostCard._indexCounter = 0;

        (posts || []).forEach(post => {
            const user = userMap[post.user_id] || {};
            const card = buildPostCard(post, user);
            postCanvas.appendChild(card);
        });

        console.log(`Loaded ${posts?.length || 0} posts`);
    } catch (err) {
        console.error('loadPosts crashed:', err);
    }
}

// ============================================
// 11. POST CARD BUILDER (now includes absolute placement)
// ============================================

function buildPostCard(post, user) {
    const card = document.createElement('div');
    card.className = 'post-card';

    // ---- absolute placement (fallback if x/y are null) ----
    const idx = (buildPostCard._indexCounter || 0);
    buildPostCard._indexCounter = idx + 1;

    const fallbackX = 60 + (idx % 4) * 340;
    const fallbackY = 60 + Math.floor(idx / 4) * 280;

    const x = (post.x ?? fallbackX);
    const y = (post.y ?? fallbackY);

    card.style.left = `${x}px`;
    card.style.top = `${y}px`;

    // ------------------------------------------------------

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

    // Content
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

    // Footer
    const footer = document.createElement('div');
    footer.className = 'post-footer';

    const pfpFallback = './images/pfps/default.png';
    const pfpSrc = user?.pfp_url || (user?.pfp ? `./images/pfps/${user.pfp}` : pfpFallback);

    if (editMode) {
        footer.innerHTML = `
            <img class="post-footer-pfp" src="${pfpSrc}" alt="">
            <span class="post-footer-action post-footer-edit">edit</span>
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
    } else {
        footer.innerHTML = `
            <img class="post-footer-pfp" src="${pfpSrc}" alt="">
            <span class="post-footer-username post-footer-filter-btn">${user?.username || 'unknown'}</span>
            ${post.file_name ? `<span class="post-footer-filename">${post.file_name}</span>` : ''}
            <span class="post-footer-category post-footer-filter-btn">${post.category || 'none'}</span>
        `;

        // username filter
        const usernameEl = footer.querySelector('.post-footer-username');
        if (usernameEl && user?.id) {
            usernameEl.addEventListener('click', (e) => {
                e.stopPropagation();
                activeUserFilter = (activeUserFilter === user.id) ? null : user.id;
                loadPosts();
            });
        }

        // category filter (supports none/null)
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

    // Card click opens modal
    card.addEventListener('click', (e) => {
        if (e.target.closest('.post-footer-action')) return;
        openPostDetailModal(post, user);
    });

    return card;
}

// ============================================
// 12. INITIALIZE EVENT LISTENERS
// ============================================

function initializeEventListeners() {

    
    const canvasViewport = document.getElementById('canvasViewport');

    // Pan by dragging empty space
    canvasViewport.addEventListener('mousedown', (e) => {
    // only left click
    if (e.button !== 0) return;

    // if clicked on a post card, don't pan (we'll use that later for placement drag)
    if (e.target.closest('.post-card')) return;

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

    

    // Right-click: single = open/close form, double = toggle edit mode
    (canvasViewport || mainPageContainer).addEventListener('contextmenu', (e) => {
        e.preventDefault();

        const now = Date.now();
        const timeSince = now - lastRightClick;
        lastRightClick = now;

        const isFormOpen = postFormOverlay.style.display === 'flex';

        // Double right-click: toggle edit mode
        if (timeSince < DOUBLE_CLICK_THRESHOLD) {
            lastRightClick = 0;
            closePostForm();
            toggleEditMode();
            return;
        }

        // Single right-click behavior (delayed so we can detect double)
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

    // Cancel button closes form
    postCancelBtn.addEventListener('click', closePostForm);

    // Click overlay background to close
    postFormOverlay.addEventListener('click', (e) => {
        if (e.target === postFormOverlay) closePostForm();
    });

    // File input display name
    postFileInput.addEventListener('change', () => {
        postFileName.textContent = postFileInput.files[0] ? postFileInput.files[0].name : 'choose file';
    });

    // Submit post
    postSubmitBtn.addEventListener('click', handlePostSubmit);

    // Category toggle
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

    // Enter key in category input
    postCategoryInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddCategory();
        }
    });

    // Cover image prompt listeners
    coverImageInput.addEventListener('change', () => {
        coverImageFileName.textContent = coverImageInput.files[0] ? coverImageInput.files[0].name : 'choose image';
    });

    coverImageSubmitBtn.addEventListener('click', handleCoverImageSubmit);
    coverImageSkipBtn.addEventListener('click', handleCoverImageSkip);

    // Logout
    logoutBtn?.addEventListener('click', async () => {
        const { error } = await supabase.auth.signOut();
        if (error) {
            alert(`Logout failed: ${error.message}`);
            return;
        }
        window.location.href = './index.html';
    });

    // Modal close
    postDetailClose?.addEventListener('click', closePostDetailModal);
    postDetailOverlay?.addEventListener('click', (e) => {
        if (e.target === postDetailOverlay) closePostDetailModal();
    });

    // Comment submit
    commentSubmitBtn?.addEventListener('click', submitComment);
    commentInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitComment();
        }
    });

    // Escape key handling
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
// 13. INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Main page loaded');

    const session = await checkAuth();
    if (!session) return;

    initializeEventListeners();
    await loadCategories();
    await loadPosts();

    console.log('Main page ready');
});