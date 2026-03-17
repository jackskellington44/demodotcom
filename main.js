// ============================================
// SUPABASE IMPORTS
// ============================================

import { supabase } from './supabase-config.js';

// ============================================
// DOM ELEMENT REFERENCES
// ============================================

const mainPageContainer = document.getElementById('mainPageContainer');
const postFeed = document.getElementById('postFeed');
const postFormOverlay = document.getElementById('postFormOverlay');
const postTitle = document.getElementById('postTitle');
const postCategory = document.getElementById('postCategory');
const postFileInput = document.getElementById('postFileInput');
const postFileName = document.getElementById('postFileName');
const postText = document.getElementById('postText');
const postSubmitBtn = document.getElementById('postSubmitBtn');
const postCancelBtn = document.getElementById('postCancelBtn');
const addCategoryToggle = document.getElementById('addCategoryToggle');
const postCategoryInput = document.getElementById('postCategoryInput');

// ============================================
// STATE VARIABLES
// ============================================

let currentUser = null;
let currentUserData = null;

// ============================================
// 1. AUTH CHECK
// ============================================

async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        window.location.href = './index.html';
        return null;
    }

    currentUser = session.user;
    console.log('Logged in as:', currentUser.id);

    // Fetch user data (username, pfp) from database
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', currentUser.id)
        .single();

    if (error) {
        console.error('Failed to fetch user data:', error);
        return null;
    }

    currentUserData = data;
    console.log('User data loaded:', currentUserData.username);
    return session;
}

// ============================================
// 2. RIGHT-CLICK TO OPEN POST FORM
// ============================================

function initializePostForm() {
    // Right-click opens form
    mainPageContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openPostForm();
    });

    // Cancel button closes form
    postCancelBtn.addEventListener('click', () => {
        closePostForm();
    });

    // Click overlay background to close
    postFormOverlay.addEventListener('click', (e) => {
        if (e.target === postFormOverlay) {
            closePostForm();
        }
    });

    // File input display name
    postFileInput.addEventListener('change', () => {
        if (postFileInput.files[0]) {
            postFileName.textContent = postFileInput.files[0].name;
        } else {
            postFileName.textContent = 'choose file';
        }
    });

    // Submit button
    postSubmitBtn.addEventListener('click', () => {
        handlePostSubmit();
    });

        // Add category toggle - swap between dropdown and text input
    addCategoryToggle.addEventListener('click', () => {
        if (postCategory.style.display !== 'none') {
            // Switch to text input mode
            postCategory.style.display = 'none';
            postCategoryInput.style.display = 'block';
            postCategoryInput.value = '';
            postCategoryInput.focus();
            addCategoryToggle.textContent = '×';
        } else {
            // Switch back to dropdown
            postCategory.style.display = 'block';
            postCategoryInput.style.display = 'none';
            postCategoryInput.value = '';
            addCategoryToggle.textContent = '+';
        }
    });

    // Enter key in category input adds the category
    postCategoryInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddCategory();
        }
    });

    console.log('Post form initialized');
}

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
}

// ============================================
// 3. CATEGORIES
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

    // Clear existing options except "none"
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
        const { data, error } = await supabase
            .from('categories')
            .insert([{ name: name, group_id: 'group1' }])
            .select();

        if (error) {
            console.error('Add category error:', error);
            throw error;
        }

        console.log('Category added:', name);

        // Reload categories and select the new one
        await loadCategories();
        postCategory.value = name;

        // Switch back to dropdown mode
        postCategory.style.display = 'block';
        postCategoryInput.style.display = 'none';
        postCategoryInput.value = '';
        addCategoryToggle.textContent = '+';

    } catch (error) {
        alert(`Failed to add category: ${error.message}`);
    }
}

// ============================================
// 4. POST SUBMISSION
// ============================================

async function handlePostSubmit() {
    const title = postTitle.value.trim();
    const body = postText.value.trim();
    const category = postCategory.value || null;
    const file = postFileInput.files[0] || null;

    // Must have at least one thing
    if (!title && !file && !body) {
        alert('Add a title, text, or choose a file');
        return;
    }

    try {
        let fileURL = null;
        let fileName = null;
        let fileType = null;

        // Upload file if one was selected
        if (file) {
            fileName = file.name;
            fileType = file.type.startsWith('image/') ? 'image' : 'other';

            const filePath = `${currentUser.id}/${Date.now()}-${file.name}`;
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('group1-posts')
                .upload(filePath, file);

            if (uploadError) {
                console.error('File upload error:', uploadError);
                throw uploadError;
            }

            const { data: urlData } = supabase.storage
                .from('group1-posts')
                .getPublicUrl(filePath);

            fileURL = urlData.publicUrl;
            console.log('File uploaded:', fileURL);
        }

        // Save post to database
        const { data, error } = await supabase
            .from('posts')
            .insert([{
                user_id: currentUser.id,
                title: title || null,
                body: body || null,
                category: category,
                file_url: fileURL,
                file_name: fileName,
                file_type: fileType,
                group_id: 'group1'
            }])
            .select();

        if (error) {
            console.error('Post save error:', error);
            throw error;
        }

        console.log('Post saved:', data[0].id);

        // Close form and reload posts
        closePostForm();
        await loadPosts();

    } catch (error) {
        console.error('Post submission failed:', error.message);
        alert(`Post failed: ${error.message}`);
    }
}

// ============================================
// 5. LOAD AND RENDER POSTS
// ============================================

async function loadPosts() {
    const { data: posts, error } = await supabase
        .from('posts')
        .select('*')
        .eq('group_id', 'group1')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Failed to load posts:', error);
        return;
    }

    // Get all user IDs from posts to fetch their data
    const userIds = [...new Set(posts.map(p => p.user_id))];
    const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, username, pfp, pfp_url')
        .in('id', userIds);

    if (usersError) {
        console.error('Failed to load users:', usersError);
        return;
    }

    // Map user data by ID for quick lookup
    const userMap = {};
    users.forEach(u => { userMap[u.id] = u; });

    // Clear feed and render
    postFeed.innerHTML = '';

    posts.forEach(post => {
        const user = userMap[post.user_id] || {};
        const card = buildPostCard(post, user);
        postFeed.appendChild(card);
    });

    console.log(`Loaded ${posts.length} posts`);
}

// ============================================
// 6. POST CARD BUILDER
// ============================================

function buildPostCard(post, user) {
    const card = document.createElement('div');
    card.className = 'post-card';

    // Determine what content exists
    const hasTitle = post.title && post.title.trim();
    const hasVisual = post.file_url && post.file_type === 'image';
    const hasText = post.body && post.body.trim();

    // Build content area
    const content = document.createElement('div');
    content.className = 'post-card-content';

    // Title + visual + text side by side
    if (hasTitle && hasVisual && hasText) {
        content.classList.add('post-layout-title-visual-text');
        content.innerHTML = `
            <div class="post-title">${post.title}</div>
            <div class="post-visual-text-row">
                <img class="post-image" src="${post.file_url}" alt="">
                <div class="post-body">${post.body}</div>
            </div>
        `;
    }
    // Title + visual
    else if (hasTitle && hasVisual) {
        content.classList.add('post-layout-title-visual');
        content.innerHTML = `
            <div class="post-title">${post.title}</div>
            <img class="post-image" src="${post.file_url}" alt="">
        `;
    }
    // Title + text
    else if (hasTitle && hasText) {
        content.classList.add('post-layout-title-text');
        content.innerHTML = `
            <div class="post-title">${post.title}</div>
            <div class="post-body">${post.body}</div>
        `;
    }
    // Visual only
    else if (hasVisual) {
        content.classList.add('post-layout-visual');
        content.innerHTML = `
            <img class="post-image" src="${post.file_url}" alt="">
        `;
    }
    // Title only
    else if (hasTitle) {
        content.classList.add('post-layout-title');
        content.innerHTML = `
            <div class="post-title">${post.title}</div>
        `;
    }
    // Text only
    else if (hasText) {
        content.classList.add('post-layout-text');
        content.innerHTML = `
            <div class="post-body">${post.body}</div>
        `;
    }

    card.appendChild(content);

    // Build footer
    const footer = document.createElement('div');
    footer.className = 'post-footer';

    // PFP
    const pfpSrc = user.pfp_url || `./images/pfps/${user.pfp}`;
    footer.innerHTML = `
        <img class="post-footer-pfp" src="${pfpSrc}" alt="">
        <span class="post-footer-username">${user.username || 'unknown'}</span>
        ${post.file_name ? `<span class="post-footer-filename">${post.file_name}</span>` : ''}
        <span class="post-footer-category">${post.category || 'none'}</span>
    `;

    card.appendChild(footer);

    return card;
}

// ============================================
// 7. INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Main page loaded');

    const session = await checkAuth();
    if (!session) return;

    initializePostForm();
    await loadCategories();
    await loadPosts();

    console.log('Main page ready');
});