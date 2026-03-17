// ============================================
// SUPABASE IMPORTS
// ============================================

import { supabase } from './supabase-config.js';

// ============================================
// 1. AUTH CHECK
// ============================================

async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        // Not logged in, send back to landing
        window.location.href = './index.html';
        return null;
    }

    console.log('Logged in as:', session.user.id);
    return session;
}

// ============================================
// 2. INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Main page loaded');

    const session = await checkAuth();
    if (!session) return;
    
    console.log('Main page ready');
});