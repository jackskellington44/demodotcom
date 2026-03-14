import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyASpTOH6fqNmzBqQXwKe7W_2hIG9DJmVME",
  authDomain: "demodotcom-9e2ea.firebaseapp.com",
  databaseURL: "https://demodotcom-9e2ea-default-rtdb.firebaseio.com",
  projectId: "demodotcom-9e2ea",
  storageBucket: "demodotcom-9e2ea.firebasestorage.app",
  messagingSenderId: "558126877181",
  appId: "1:558126877181:web:f74492772a187d8c173194"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

console.log('Firebase initialized');

// Set background image immediately when script loads
const mainContainer = document.getElementById('mainContainer');
console.log('mainContainer element:', mainContainer);

if (mainContainer) {
    const backgroundImage = window.SITE_CONFIG?.backgroundImage || '/images/background.jpg';
    console.log('Setting background image to:', backgroundImage);
    mainContainer.style.backgroundImage = `url('${backgroundImage}')`;
}

document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const loginToggle = document.getElementById('loginToggle');
    const signupToggle = document.getElementById('signupToggle');
    const loginInputs = document.getElementById('loginInputs');
    const signupInputs = document.getElementById('signupInputs');
    const pfpSelection = document.getElementById('pfpSelection');
    const pfpContainers = document.querySelectorAll('.pfp-container');
    const uploadPFP = document.getElementById('uploadPFP');
    const pfpUpload = document.getElementById('pfpUpload');
    
    let selectedPFP = null;
    let uploadedPFP = null;

    // Toggle between Login and Signup views
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

    // Event listeners for toggle buttons
    loginToggle.addEventListener('click', () => setActiveView('login'));
    signupToggle.addEventListener('click', () => setActiveView('signup'));

    // Handle PFP selection
    pfpContainers.forEach(container => {
        container.addEventListener('click', function() {
            // Remove selected class from all PFPs and upload container
            pfpContainers.forEach(p => p.classList.remove('selected'));
            uploadPFP.classList.remove('selected');
            
            // Add selected class to clicked PFP
            this.classList.add('selected');
            selectedPFP = this.dataset.pfp;
            uploadedPFP = null; // Clear any uploaded PFP
        });
    });

    // Handle PFP upload
    uploadPFP.addEventListener('click', function() {
        pfpUpload.click();
    });

    pfpUpload.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                // Remove selected class from all PFPs
                pfpContainers.forEach(p => p.classList.remove('selected'));
                
                // Add selected class to upload container
                uploadPFP.classList.add('selected');
                
                // Change the + to a checkmark
                uploadPFP.innerHTML = '<span>✓</span>';
                
                selectedPFP = null;
                uploadedPFP = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    // Handle Enter key for form submission
    function handleEnterKey(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            
            if (loginToggle.classList.contains('active')) {
                // Login logic
                const username = document.getElementById('loginUsername').value;
                const password = document.getElementById('loginPassword').value;
                
                if (username && password) {
                    console.log('Login attempt:', { username, password });
                    alert(`Login attempt for user: ${username}`);
                } else {
                    alert('Please enter both username and password');
                }
            } else {
                // Signup logic
                const username = document.getElementById('signupUsername').value;
                const password = document.getElementById('signupPassword').value;
                
                // Basic validation
                if (!username || !password) {
                    alert('Please enter both username and password');
                    return;
                }
                
                if (password.length < 6) {
                    alert('Password must be at least 6 characters');
                    return;
                }
                
                // Check if PFP is selected
                if (!selectedPFP && !uploadedPFP) {
                    alert('Please select or upload a profile picture');
                    return;
                }
                
                console.log('Signup attempt:', { 
                    username, 
                    password,
                    pfp: selectedPFP || 'uploaded'
                });
                
                alert(`Signup successful for: ${username}! (demo mode)`);
            }
        }
    }

    // Add enter key listeners to all inputs
    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('keypress', handleEnterKey);
    });

    // Password masking effect
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    passwordInputs.forEach(input => {
        input.addEventListener('input', function(e) {
            const value = this.value;
            if (value.length > 0) {
                this.dataset.realValue = value;
            }
        });
    });

    // Initialize with login view
    setActiveView('login');
});