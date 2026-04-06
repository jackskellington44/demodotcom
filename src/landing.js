// ============================================
// SUPABASE IMPORTS
// ============================================

import { supabase } from './supabase-config.js';

// ============================================
// PFP CONFIGURATION
// ============================================

const PFP_LIST = [
    'pfp1.jpg', 'pfp2.jpg', 'pfp3.jpg', 'pfp4.jpg', 'pfp5.jpg',
    'pfp6.jpg', 'pfp7.jpg', 'pfp8.jpg', 'pfp9.jpg', 'pfp10.jpg',
    'pfp11.jpg', 'pfp12.jpg', 'pfp13.jpg', 'pfp14.jpg', 'pfp15.jpg',
    'pfp16.jpg', 'pfp17.jpg', 'pfp18.jpg', 'pfp19.jpg'
];

function loadPFPGrid() {
    const pfpGrid = document.getElementById('pfpGrid');

    // If this function ever gets called twice, avoid duplicating items
    if (!pfpGrid) return;
    pfpGrid.innerHTML = '';

    // Load all PFP images
    PFP_LIST.forEach(pfp => {
        const container = document.createElement('div');
        container.className = 'pfp-container';
        container.dataset.pfp = pfp;

        const img = document.createElement('img');
        img.src = `${import.meta.env.BASE_URL}images/pfps/${pfp}`;
        img.alt = pfp;

        container.appendChild(img);
        pfpGrid.appendChild(container);
    });

    // Add upload button as 20th item
    const uploadContainer = document.createElement('div');
    uploadContainer.className = 'upload-pfp-container';
    uploadContainer.id = 'uploadPFPButton';
    uploadContainer.innerHTML = '<span>+</span>';

    pfpGrid.appendChild(uploadContainer);

    console.log(`✓ Loaded ${PFP_LIST.length} PFP options + upload button`);
}

// ============================================
// DOM ELEMENT REFERENCES
// ============================================

const mainContainer = document.getElementById('mainContainer');
const loginToggle = document.getElementById('loginToggle');
const signupToggle = document.getElementById('signupToggle');
const loginInputs = document.getElementById('loginInputs');
const signupInputs = document.getElementById('signupInputs');
const pfpSelection = document.getElementById('pfpSelection');
const pfpUpload = document.getElementById('pfpUpload');

const loginUsername = document.getElementById('loginUsername');
const loginPassword = document.getElementById('loginPassword');
const signupUsername = document.getElementById('signupUsername');
const signupPassword = document.getElementById('signupPassword');

let pfpContainers; // Will be set after PFPs load
let uploadPFPButton; // Will be set after PFPs load

// ============================================
// STATE VARIABLES
// ============================================

let selectedPFP = null;
let uploadedPFP = null;

// ============================================
// 1. VIEW MANAGEMENT
// ============================================

function setActiveView(view) {
    if (view === 'login') {
        loginToggle.classList.add('active');
        signupToggle.classList.remove('active');
        loginInputs.style.display = 'flex';
        signupInputs.style.display = 'none';
        pfpSelection.style.display = 'none';
    } else {
        signupToggle.classList.add('active');
        loginToggle.classList.remove('active');
        loginInputs.style.display = 'none';
        signupInputs.style.display = 'flex';
        pfpSelection.style.display = 'flex';
    }
}

function initializeViews() {
    loginToggle.addEventListener('click', () => setActiveView('login'));
    signupToggle.addEventListener('click', () => setActiveView('signup'));
    setActiveView('login');
}

// NEW: logged-in / logged-out UI switching (no page navigation)
function showLoggedOutView() {
    // Ensure toggles are visible again
    loginToggle.style.display = '';
    signupToggle.style.display = '';

    // Default back to login view
    setActiveView('login');
}

function showLoggedInView() {
    // Hide login/signup views
    loginInputs.style.display = 'none';
    signupInputs.style.display = 'none';

    // Hide toggles so user can’t switch back to login/signup while logged in
    loginToggle.style.display = 'none';
    signupToggle.style.display = 'none';

    // Show whatever your “post-auth” view is (you already use pfpSelection)
    pfpSelection.style.display = 'flex';

    // Optional styling hook (won’t break anything if CSS doesn’t use it)
    if (mainContainer) mainContainer.classList.add('logged-in');
}

// ============================================
// 2. PFP SELECTION
// ============================================

function initializePFPSelection() {
    pfpContainers = document.querySelectorAll('.pfp-container');
    uploadPFPButton = document.getElementById('uploadPFPButton');

    pfpContainers.forEach(container => {
        container.addEventListener('click', function() {
            // Deselect all
            pfpContainers.forEach(p => p.classList.remove('selected'));
            uploadPFPButton.classList.remove('selected');

            // Select clicked PFP
            this.classList.add('selected');
            selectedPFP = this.dataset.pfp;
            uploadedPFP = null;

            console.log('Selected PFP:', selectedPFP);
        });
    });

    console.log('✓ PFP selection initialized');
}

function initializePFPUpload() {
    uploadPFPButton = document.getElementById('uploadPFPButton');

    uploadPFPButton.addEventListener('click', () => {
        pfpUpload.click();
    });

    pfpUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                // Deselect all PFPs
                pfpContainers.forEach(p => p.classList.remove('selected'));

                // Mark upload as selected
                uploadPFPButton.classList.add('selected');
                uploadPFPButton.innerHTML = '<span>✓</span>';

                selectedPFP = null;
                uploadedPFP = event.target.result;

                console.log('Uploaded PFP');
            };
            reader.readAsDataURL(file);
        }
    });

    console.log('✓ PFP upload initialized');
}

// ============================================
// 3. FORM VALIDATION
// ============================================

function validateLoginForm() {
    const username = loginUsername.value.trim();
    const password = loginPassword.value;

    if (!username) {
        alert('Please enter a username');
        return false;
    }
    if (!password) {
        alert('Please enter a password');
        return false;
    }
    return true;
}

function validateSignupForm() {
    const username = signupUsername.value.trim();
    const password = signupPassword.value;

    if (!username) {
        alert('Please enter a username');
        return false;
    }
    if (!password) {
        alert('Please enter a password');
        return false;
    }
    if (password.length < 6) {
        alert('Password must be at least 6 characters');
        return false;
    }
    if (!selectedPFP && !uploadedPFP) {
        alert('Please select or upload a profile picture');
        return false;
    }
    return true;
}

// ============================================
// 4. SUPABASE AUTH - LOGIN
// ============================================

async function handleLogin() {
    if (!validateLoginForm()) return;

    const username = loginUsername.value.trim();
    const password = loginPassword.value;

    try {
        // Supabase Auth uses email
        const email = `${username}@demodotcom.com`;

        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        console.log('Login successful:', data.user.id);

        // CHANGED: no navigation; show “main” UI on same page
        showLoggedInView();

    } catch (error) {
        console.error('Login error:', error.message);
        alert(`Login failed: ${error.message}`);
    }
}

// ============================================
// 5. SUPABASE AUTH - SIGNUP
// ============================================

async function handleSignup() {
    if (!validateSignupForm()) return;

    const username = signupUsername.value.trim();
    const password = signupPassword.value;
    const pfp = selectedPFP || 'uploaded';

    try {
        // Create user in Supabase Auth
        const email = `${username}@demodotcom.com`;

        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password
        });

        if (error) throw error;

        const userId = data.user.id;
        console.log('User created:', userId);

        // Sign in immediately after signup to get a valid session
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (signInError) {
            console.error('Auto sign-in failed:', signInError);
            throw signInError;
        }

        console.log('Auto signed in with session');

        // Upload PFP if custom image
        let pfpURL = null;
        if (uploadedPFP) {
            console.log('Starting PFP upload...');
            pfpURL = await uploadPFPToStorage(userId, uploadedPFP);
            console.log('PFP upload complete, URL:', pfpURL);
        }

        // Save user data to Supabase database
        await saveUserToDatabase(userId, username, pfp, pfpURL);
        console.log('User saved to database');

        // Clear form
        signupUsername.value = '';
        signupPassword.value = '';
        selectedPFP = null;
        uploadedPFP = null;

        // CHANGED: no navigation; show “main” UI on same page
        console.log('ALL DONE - showing main view');
        showLoggedInView();

    } catch (error) {
        console.error('Signup error:', error.message);
        alert(`Signup failed: ${error.message}`);
    }
}

// ============================================
// 6. SUPABASE STORAGE - UPLOAD PFP
// ============================================

async function uploadPFPToStorage(userId, imageData) {
    try {
        const response = await fetch(imageData);
        const blob = await response.blob();
        const file = new File([blob], `${userId}.jpg`, { type: 'image/jpeg' });

        console.log('Uploading file:', file.name, 'Size:', file.size, 'Type:', file.type);

        // Get current user/session for debugging
        const { data: { user } } = await supabase.auth.getUser();
        console.log('Current user:', user?.id);

        // Upload file to Supabase Storage
        const { data, error } = await supabase.storage
            .from('group1-pfps')
            .upload(`${userId}.jpg`, file);

        if (error) {
            console.error('Full storage error:', JSON.stringify(error));
            throw error;
        }

        console.log('✓ PFP uploaded to Storage');

        const { data: urlData } = supabase.storage
            .from('group1-pfps')
            .getPublicUrl(`${userId}.jpg`);

        console.log('✓ PFP URL:', urlData.publicUrl);
        return urlData.publicUrl;
    } catch (error) {
        console.error('PFP upload error:', error);
        throw error;
    }
}

// ============================================
// 7. SUPABASE DATABASE - SAVE USER DATA
// ============================================

async function saveUserToDatabase(userId, username, pfp, pfpURL) {
    try {
        console.log('Attempting to insert:', {
            id: userId,
            username: username,
            email: `${username}@demodotcom.com`,
            pfp: pfp,
            pfp_url: pfpURL
        });

        const { data, error } = await supabase
            .from('users')
            .insert([
                {
                    id: userId,
                    username: username,
                    email: `${username}@demodotcom.com`,
                    pfp: pfp,
                    pfp_url: pfpURL,
                    created_at: new Date(),
                    updated_at: new Date()
                }
            ]);

        if (error) {
            console.error('Insert error details:', error);
            throw error;
        }

        console.log('✓ User saved to database');
    } catch (error) {
        console.error('Database error:', error);
        throw error;
    }
}

// ============================================
// 8. FORM SUBMISSION
// ============================================

function handleEnterKey(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();

    if (loginToggle.classList.contains('active')) {
        handleLogin();
    } else {
        handleSignup();
    }
}

function initializeFormSubmission() {
    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('keypress', handleEnterKey);
    });

    console.log('✓ Form submission initialized');
}

// ============================================
// 9. INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('✓ DOM loaded');

    loadPFPGrid();
    initializeViews();
    initializePFPSelection();
    initializePFPUpload();
    initializeFormSubmission();

    // NEW: restore view based on whether user is already logged in
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        showLoggedInView();
    } else {
        showLoggedOutView();
    }

    // Optional: keep UI in sync if auth state changes
    supabase.auth.onAuthStateChange((_event, session) => {
        if (session) showLoggedInView();
        else showLoggedOutView();
    });

    console.log('✓ All systems initialized');
});