import { supabase } from './supabase-config.js';

// ============================================
// PFP CONFIGURATION
// ============================================

const PFP_LIST = [
  'pfp1.webp',  'pfp2.webp',  'pfp3.webp',  'pfp4.webp',  'pfp5.webp',
  'pfp6.webp',  'pfp7.webp',  'pfp8.webp',  'pfp9.webp',  'pfp10.webp',
  'pfp11.webp', 'pfp12.webp', 'pfp13.webp', 'pfp14.webp', 'pfp15.webp',
  'pfp16.webp', 'pfp17.webp', 'pfp18.webp', 'pfp19.webp'
];

function loadPFPGrid() {
  const pfpGrid = document.getElementById('pfpGrid');

  PFP_LIST.forEach(pfpName => {
    const container = document.createElement('div');
    container.className = 'pfp-container';
    container.dataset.pfp = pfpName;

    const src = `${import.meta.env.BASE_URL}images/pfps/${pfpName}`;

    const cvs = document.createElement('canvas');
    cvs.width  = 200;
    cvs.height = 200;
    const ctx  = cvs.getContext('2d');

    const img = document.createElement('img');
    img.src = src;
    img.alt = pfpName;

    const drawFrame = () => {
      try { ctx.drawImage(img, 0, 0, 200, 200); } catch(e) {}
    };

    if (img.complete && img.naturalWidth > 0) drawFrame();
    else img.addEventListener('load', drawFrame, { once: true });

    container.addEventListener('mouseenter', () => {
      img.classList.add('pfp-playing');
    });

    container.addEventListener('mouseleave', () => {
      if (!container.classList.contains('selected')) {
        drawFrame();
        img.classList.remove('pfp-playing');
      }
    });

    container.appendChild(cvs);
    container.appendChild(img);
    pfpGrid.appendChild(container);
  });

  // Upload button
  const uploadContainer = document.createElement('div');
  uploadContainer.className = 'upload-pfp-container';
  uploadContainer.id = 'uploadPFPButton';
  uploadContainer.innerHTML = '<span>+</span>';
  pfpGrid.appendChild(uploadContainer);
}

// ============================================
// DOM ELEMENT REFERENCES
// ============================================

const loginToggle    = document.getElementById('loginToggle');
const signupToggle   = document.getElementById('signupToggle');
const loginInputs    = document.getElementById('loginInputs');
const signupInputs   = document.getElementById('signupInputs');
const pfpSelection   = document.getElementById('pfpSelection');
const pfpUpload      = document.getElementById('pfpUpload');
const loginUsername  = document.getElementById('loginUsername');
const loginPassword  = document.getElementById('loginPassword');
const signupUsername = document.getElementById('signupUsername');
const signupPassword = document.getElementById('signupPassword');

let pfpContainers  = null;
let uploadPFPButton = null;

// ============================================
// STATE
// ============================================

let selectedPFP     = null;
let uploadedPFPFile = null;

// ============================================
// 1. VIEW MANAGEMENT
// ============================================

function setActiveView(view) {
  if (view === 'login') {
    loginToggle.classList.add('active');
    signupToggle.classList.remove('active');
    loginInputs.style.display  = 'flex';
    signupInputs.style.display = 'none';
    pfpSelection.style.display = 'none';
  } else {
    signupToggle.classList.add('active');
    loginToggle.classList.remove('active');
    loginInputs.style.display  = 'none';
    signupInputs.style.display = 'flex';
    pfpSelection.style.display = 'flex';
  }
}

function initializeViews() {
  loginToggle.addEventListener('click',  () => setActiveView('login'));
  signupToggle.addEventListener('click', () => setActiveView('signup'));
  setActiveView('login');
}

// ============================================
// 2. PFP SELECTION
// ============================================

function initializePFPSelection() {
  pfpContainers   = document.querySelectorAll('.pfp-container');
  uploadPFPButton = document.getElementById('uploadPFPButton');

  pfpContainers.forEach(container => {
    container.addEventListener('click', function () {
      // Deselect all — freeze previously selected
      pfpContainers.forEach(p => {
        if (p.classList.contains('selected')) {
          const img = p.querySelector('img');
          const cvs = p.querySelector('canvas');
          if (img && cvs && img.naturalWidth > 0) {
            try { cvs.getContext('2d').drawImage(img, 0, 0, 200, 200); } catch(e) {}
            img.classList.remove('pfp-playing');
          }
        }
        p.classList.remove('selected');
      });
      uploadPFPButton.classList.remove('selected');

      this.classList.add('selected');
      this.querySelector('img')?.classList.add('pfp-playing'); // keep playing when selected
      selectedPFP     = this.dataset.pfp;
      uploadedPFPFile = null;
    });
  });
}

function initializePFPUpload() {
  uploadPFPButton = document.getElementById('uploadPFPButton');

  uploadPFPButton.addEventListener('click', () => pfpUpload.click());

  pfpUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Deselect grid items
    pfpContainers.forEach(p => {
      if (p.classList.contains('selected')) {
        const img = p.querySelector('img');
        const cvs = p.querySelector('canvas');
        if (img && cvs && img.naturalWidth > 0) {
          try { cvs.getContext('2d').drawImage(img, 0, 0, 200, 200); } catch(e) {}
          img.classList.remove('pfp-playing');
        }
      }
      p.classList.remove('selected');
    });

    uploadPFPButton.classList.add('selected');
    uploadPFPButton.innerHTML = '<span>✓</span>';
    selectedPFP     = null;
    uploadedPFPFile = file;
  });
}

// ============================================
// 3. FORM VALIDATION
// ============================================

function validateLoginForm() {
  if (!loginUsername.value.trim()) { alert('Please enter a username'); return false; }
  if (!loginPassword.value)        { alert('Please enter a password'); return false; }
  return true;
}

function validateSignupForm() {
  const u = signupUsername.value.trim();
  if (!u || u.length > 12)    { alert('Username must be 1–12 characters'); return false; }
  if (!signupPassword.value)  { alert('Please enter a password'); return false; }
  if (signupPassword.value.length < 6) { alert('Password must be at least 6 characters'); return false; }
  if (!selectedPFP && !uploadedPFPFile) { alert('Please select or upload a profile picture'); return false; }
  return true;
}

// ============================================
// 4. LOGIN
// ============================================

async function handleLogin() {
  if (!validateLoginForm()) return;
  const username = loginUsername.value.trim();
  const password = loginPassword.value;

  try {
    // Look up internal email by username
    const { data: userData, error: lookupErr } = await supabase
      .from('users')
      .select('email')
      .eq('username', username)
      .maybeSingle();

    if (lookupErr || !userData) throw new Error('Username not found');

    const { error } = await supabase.auth.signInWithPassword({
      email: userData.email,
      password
    });
    if (error) throw error;

    window.location.href = './main.html';
  } catch (error) {
    console.error('Login error:', error.message);
    alert(`Login failed: ${error.message}`);
  }
}

// ============================================
// 5. SIGNUP
// ============================================

async function handleSignup() {
  if (!validateSignupForm()) return;
  const username = signupUsername.value.trim();
  const password = signupPassword.value;

  try {
    // Check uniqueness
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .maybeSingle();
    if (existing) { alert('Username already taken'); return; }

    // Generate opaque internal email (never shown to user)
    const internalEmail = `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@grp.io`;

    const { data, error } = await supabase.auth.signUp({ email: internalEmail, password });
    if (error) throw error;
    const userId = data.user.id;

    // Sign in immediately
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: internalEmail, password });
    if (signInErr) throw signInErr;

    // Upload custom pfp if provided
    let pfpURL = null;
    if (uploadedPFPFile) {
      const ext  = uploadedPFPFile.name.split('.').pop() || 'webp';
      const path = `${userId}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('group5-pfps')
        .upload(path, uploadedPFPFile);
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('group5-pfps').getPublicUrl(path);
      pfpURL = urlData.publicUrl;
    }

    // Save user record
    const { error: dbErr } = await supabase.from('users').insert([{
      id:         userId,
      username,
      email:      internalEmail,
      pfp:        selectedPFP  || null,
      pfp_url:    pfpURL       || null,
      created_at: new Date(),
      updated_at: new Date()
    }]);
    if (dbErr) throw dbErr;

    window.location.href = './main.html';
  } catch (error) {
    console.error('Signup error:', error.message);
    alert(`Signup failed: ${error.message}`);
  }
}

// ============================================
// 6. ENTER KEY
// ============================================

function handleEnterKey(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (loginToggle.classList.contains('active')) handleLogin();
  else handleSignup();
}

function initializeFormSubmission() {
  document.querySelectorAll('input').forEach(input => {
    input.addEventListener('keypress', handleEnterKey);
  });
}

// ============================================
// 7. INIT
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.style.setProperty(
    '--bg-url',
    `url(${import.meta.env.BASE_URL}images/background.jpg)`
  );

  loadPFPGrid();
  initializeViews();
  initializePFPSelection();
  initializePFPUpload();
  initializeFormSubmission();
});