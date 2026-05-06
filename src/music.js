import { supabase } from './supabase-config.js';

// ── State ──────────────────────────────────────────────────────────────────
let tracks       = [];
let currentIndex = -1;
let isPlaying    = false;
let currentUser     = null;
let currentUserData = null;
let barPosition  = localStorage.getItem('musicBarPosition') || 'bottom';
let isShuffled = false;
let isLooping  = false;
let isMusicEditMode = false;

const MUSIC_DBLCLICK_MS = 400;

const audio = new Audio();
audio.preload = 'none';

// ── DOM refs ───────────────────────────────────────────────────────────────
let musicBar, musicBarPfp, musicBarUsername, musicBarTitle, musicBarArtist, musicBarSep;
let musicPrev, musicPlayPause, musicNext, musicOpenPanel;
let musicPanelOverlay, musicPanelTitle, musicTrackList, musicDropZone;
let musicDownloadPlaylist, musicClosePanel;
let musicShuffle, musicLoop;

// ── Helpers ────────────────────────────────────────────────────────────────
function getPlaylistTitle() {
  const month = new Date().toLocaleString('default', { month: 'long' }).toLowerCase();
  return `monkey ${month} music`;
}

function pfpSrcFor(userRow) {
  const fallback = './images/pfps/default.png';
  if (!userRow) return fallback;
  return userRow.pfp_url || (userRow.pfp ? `./images/pfps/${userRow.pfp}` : fallback);
}

function escAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Load ───────────────────────────────────────────────────────────────────
export async function loadTracks() {
  const { data, error } = await supabase
    .from('music_tracks')
    .select('*')
    .eq('group_id', 'group1')
    .order('created_at', { ascending: true });

  if (error) { console.error('Failed to load tracks:', error); return; }

  const userIds = [...new Set((data || []).map(t => t.user_id).filter(Boolean))];
  let userMap = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, username, pfp, pfp_url')
      .in('id', userIds);
    (users || []).forEach(u => { userMap[u.id] = u; });
  }

  tracks = (data || []).map(t => ({ ...t, users: userMap[t.user_id] || null }));

  if (currentIndex === -1 && tracks.length > 0) {
    currentIndex = 0;
  }

  renderTrackList();
  updateBarDisplay();
}

// ── Render playlist ────────────────────────────────────────────────────────
function renderTrackList() {
  if (!musicTrackList) return;
  musicTrackList.innerHTML = '';

  // In edit mode only show the signed-in user's own tracks
  const visibleTracks = isMusicEditMode
    ? tracks.filter(t => currentUserData?.is_admin || t.user_id === currentUser?.id)
    : tracks;

  if (visibleTracks.length === 0) {
    musicTrackList.innerHTML = `<div class="music-empty">${
      isMusicEditMode ? 'no tracks to edit' : 'no tracks yet — drag a file above'
    }</div>`;
    return;
  }

  visibleTracks.forEach((track) => {
    const idx      = tracks.indexOf(track);
    const isActive = idx === currentIndex;

    const row = document.createElement('div');
    row.className   = `music-track-row${isActive ? ' active' : ''}${isMusicEditMode ? ' edit-mode' : ''}`;
    row.dataset.idx     = idx;
    row.dataset.trackId = track.id;

    if (isMusicEditMode) {
      // ── Edit-mode row: inline inputs + delete button ──
      row.innerHTML = `
        <img class="music-track-pfp" src="${pfpSrcFor(track.users)}" alt="">
        <div class="music-track-info">
          <input class="music-rename-input music-rename-title"
                 value="${escAttr(track.title)}" placeholder="title">
          <input class="music-rename-input music-rename-artist"
                 value="${escAttr(track.artist || '')}" placeholder="artist">
        </div>
        <div class="music-track-actions">
          <button class="music-track-btn music-delete-btn">delete</button>
        </div>
      `;

      // Inputs: stop row-click bubbling; Enter = save this track
      row.querySelectorAll('.music-rename-input').forEach(input => {
        input.addEventListener('click', e => e.stopPropagation());
        input.addEventListener('keydown', async (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            await saveTrackRename(track, row);
            input.blur();
          }
        });
      });

      row.querySelector('.music-delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTrack(track.id, idx);
      });

      // Row click in edit mode does nothing
      row.addEventListener('click', e => e.stopPropagation());

    } else {
      // ── Normal row: pfp + title/artist, click to play ──
      row.innerHTML = `
        <img class="music-track-pfp" src="${pfpSrcFor(track.users)}" alt="">
        <div class="music-track-info">
          <span class="music-track-title">${escAttr(track.title)}</span>
          ${track.artist ? `<span class="music-track-artist">${escAttr(track.artist)}</span>` : ''}
        </div>
      `;

      row.addEventListener('click', () => playTrack(idx));
    }

    musicTrackList.appendChild(row);
  });
}

// ── Save a single track's rename inputs ───────────────────────────────────
async function saveTrackRename(track, row) {
  const titleInput  = row.querySelector('.music-rename-title');
  const artistInput = row.querySelector('.music-rename-artist');
  if (!titleInput) return;

  const newTitle  = titleInput.value.trim()  || track.title;
  const newArtist = artistInput.value.trim();

  // Skip DB write if nothing changed
  if (newTitle === track.title && newArtist === (track.artist || '')) return;

  const { error } = await supabase
    .from('music_tracks')
    .update({ title: newTitle, artist: newArtist })
    .eq('id', track.id)
    .eq('user_id', currentUser.id);

  if (error) { alert(`Rename failed: ${error.message}`); return; }

  // Update local state so the bar display is fresh
  track.title  = newTitle;
  track.artist = newArtist;

  // Reflect saved values back into the inputs
  titleInput.value  = newTitle;
  artistInput.value = newArtist;
}

// ── Exit edit mode — saves every modified row then re-renders ──────────────
async function exitMusicEditMode() {
  const rows = musicTrackList.querySelectorAll('.music-track-row[data-track-id]');
  for (const row of rows) {
    if (!row.querySelector('.music-rename-title')) continue;
    const trackId = row.dataset.trackId;
    const track   = tracks.find(t => String(t.id) === String(trackId));
    if (track) await saveTrackRename(track, row);
  }

  isMusicEditMode = false;
  const musicPanel = document.querySelector('.music-panel');
  if (musicPanel) musicPanel.classList.remove('edit-mode');
  musicPanelTitle.textContent = getPlaylistTitle();
  renderTrackList();
  updateBarDisplay();
}

// ── Playback ───────────────────────────────────────────────────────────────
function playTrack(idx) {
  if (idx < 0 || idx >= tracks.length) return;
  currentIndex = idx;
  audio.src = tracks[idx].file_url;
  audio.play().catch(console.error);
  isPlaying = true;
  updateBarDisplay();
  renderTrackList();
}

function updateBarDisplay() {
  if (!musicBarTitle) return;
  const track = tracks[currentIndex];

  if (track) {
    musicBarTitle.textContent    = track.title;
    musicBarArtist.textContent   = track.artist || '';
    musicBarSep.style.display    = track.artist ? 'inline' : 'none';
    musicBarPfp.src              = pfpSrcFor(track.users);
    musicBarUsername.textContent = track.users?.username || '—';
  } else {
    musicBarTitle.textContent    = 'no track';
    musicBarArtist.textContent   = '';
    musicBarSep.style.display    = 'none';
    musicBarPfp.src              = './images/pfps/default.png';
    musicBarUsername.textContent = '—';
  }

  musicPlayPause.textContent = isPlaying ? '||' : '▷';
}

// ── Bar position ───────────────────────────────────────────────────────────
function applyBarPosition() {
  const BAR_H = '44px';
  if (barPosition === 'top') {
    musicBar.style.top           = '0';
    musicBar.style.bottom        = 'auto';
    document.body.style.paddingTop    = BAR_H;
    document.body.style.paddingBottom = '';
  } else {
    musicBar.style.bottom        = '0';
    musicBar.style.top           = 'auto';
    document.body.style.paddingBottom = BAR_H;
    document.body.style.paddingTop    = '';
  }
}

// ── Upload ─────────────────────────────────────────────────────────────────
async function uploadTrack(file) {
  const allowed = ['mp3', 'mp4', 'flac', 'wav', 'ogg', 'm4a', 'aac'];
  const ext = file.name.split('.').pop().toLowerCase();
  if (!allowed.includes(ext)) { alert(`Unsupported type: .${ext}`); return; }

  const title    = file.name.replace(/\.[^.]+$/, '');
  const filePath = `${currentUser.id}/${Date.now()}-${file.name}`;

  musicDropZone.querySelector('span').textContent = `uploading ${file.name}…`;

  const { error: upErr } = await supabase.storage
    .from('group1-music')
    .upload(filePath, file);

  if (upErr) {
    alert(`Upload failed: ${upErr.message}`);
    musicDropZone.querySelector('span').textContent = 'upload music';
    return;
  }

  const { data: urlData } = supabase.storage
    .from('group1-music')
    .getPublicUrl(filePath);

  const { error: dbErr } = await supabase
    .from('music_tracks')
    .insert([{
      group_id: 'group1',
      user_id:  currentUser.id,
      title,
      artist:   '',
      file_url: urlData.publicUrl,
      file_name: file.name
    }]);

  if (dbErr) { alert(`Failed to save track: ${dbErr.message}`); return; }

  musicDropZone.querySelector('span').textContent = 'upload music';
  await loadTracks();
}

// ── Delete ─────────────────────────────────────────────────────────────────
async function deleteTrack(trackId, idx) {
  const { error } = await supabase
    .from('music_tracks')
    .delete()
    .eq('id', trackId)
    .eq('user_id', currentUser.id);

  if (error) { alert(`Delete failed: ${error.message}`); return; }

  if (idx === currentIndex) {
    audio.pause();
    audio.src = '';
    isPlaying    = false;
    currentIndex = -1;
    updateBarDisplay();
  } else if (idx < currentIndex) {
    currentIndex--;
  }

  await loadTracks();
}

// ── Download playlist ──────────────────────────────────────────────────────
async function downloadPlaylist() {
  if (tracks.length === 0) { alert('No tracks to download'); return; }

  const title = getPlaylistTitle();
  const btn   = document.getElementById('musicDownloadPlaylist');

  try {
    const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
    const zip    = new JSZip();
    const folder = zip.folder(title);

    btn.textContent = '… zipping';
    btn.disabled    = true;

    for (const track of tracks) {
      const resp = await fetch(track.file_url);
      const blob = await resp.blob();
      folder.file(track.file_name || `${track.title}.mp3`, blob);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const a       = document.createElement('a');
    a.href        = URL.createObjectURL(zipBlob);
    a.download    = `${title}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    console.warn('JSZip unavailable, falling back to M3U:', err);
    let m3u = '#EXTM3U\n';
    tracks.forEach(t => {
      m3u += `#EXTINF:-1,${t.artist ? t.artist + ' - ' : ''}${t.title}\n${t.file_url}\n`;
    });
    const blob = new Blob([m3u], { type: 'audio/x-mpegurl' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `${title}.m3u`;
    a.click();
    URL.revokeObjectURL(a.href);
  } finally {
    btn.textContent = '⤓ playlist';
    btn.disabled    = false;
  }
}

// ── Public init ────────────────────────────────────────────────────────────
export async function initMusic(user, userData) {
  currentUser     = user;
  currentUserData = userData;

  musicBar              = document.getElementById('musicBar');
  musicBarPfp           = document.getElementById('musicBarPfp');
  musicBarUsername      = document.getElementById('musicBarUsername');
  musicBarTitle         = document.getElementById('musicBarTitle');
  musicBarArtist        = document.getElementById('musicBarArtist');
  musicBarSep           = document.getElementById('musicBarSep');
  musicPrev             = document.getElementById('musicPrev');
  musicPlayPause        = document.getElementById('musicPlayPause');
  musicNext             = document.getElementById('musicNext');
  musicOpenPanel        = document.getElementById('musicOpenPanel');
  musicPanelOverlay     = document.getElementById('musicPanelOverlay');
  musicPanelTitle       = document.getElementById('musicPanelTitle');
  musicTrackList        = document.getElementById('musicTrackList');
  musicDropZone         = document.getElementById('musicDropZone');
  musicDownloadPlaylist = document.getElementById('musicDownloadPlaylist');
  musicClosePanel       = document.getElementById('musicClosePanel');
  musicShuffle = document.getElementById('musicShuffle');
  musicLoop    = document.getElementById('musicLoop');

  musicPanelTitle.textContent = getPlaylistTitle();
  applyBarPosition();

  // ── Double right-click on music panel toggles edit mode ──
  const musicPanel = document.querySelector('.music-panel');
  let lastMusicRightClick = 0;

  musicPanel.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    if (now - lastMusicRightClick < MUSIC_DBLCLICK_MS) {
      lastMusicRightClick = 0;
      if (isMusicEditMode) {
        exitMusicEditMode();
      } else {
        isMusicEditMode = true;
        musicPanel.classList.add('edit-mode');
        musicPanelTitle.textContent = getPlaylistTitle() + ' · editing';
        renderTrackList();
      }
    } else {
      lastMusicRightClick = now;
    }
  });

  // ── Audio events ──
  audio.addEventListener('ended', () => {
    if (isLooping) {
      audio.play().catch(console.error);
      return;
    }
    if (isShuffled) {
      const next = Math.floor(Math.random() * tracks.length);
      playTrack(next);
      return;
    }
    const next = currentIndex + 1;
    if (next < tracks.length) playTrack(next);
    else { isPlaying = false; currentIndex = -1; updateBarDisplay(); }
  });
  audio.addEventListener('play',  () => { isPlaying = true;  updateBarDisplay(); });
  audio.addEventListener('pause', () => { isPlaying = false; updateBarDisplay(); });

  // ── Controls ──
  musicPrev.addEventListener('click', () => {
    if (currentIndex > 0) playTrack(currentIndex - 1);
  });
  musicNext.addEventListener('click', () => {
    if (tracks.length === 0) return;
    if (isShuffled) {
      playTrack(Math.floor(Math.random() * tracks.length));
    } else if (currentIndex < tracks.length - 1) {
      playTrack(currentIndex + 1);
    }
  });
  musicPlayPause.addEventListener('click', () => {
    if (tracks.length === 0) return;
    if (isPlaying) {
      audio.pause();
    } else {
      if (currentIndex === -1) playTrack(0);
      else audio.play().catch(console.error);
    }
  });

  musicOpenPanel.addEventListener('click', () => {
    musicPanelOverlay.classList.add('open');
  });
  musicClosePanel.addEventListener('click', () => {
    if (isMusicEditMode) exitMusicEditMode();
    musicPanelOverlay.classList.remove('open');
  });
  musicPanelOverlay.addEventListener('click', (e) => {
    if (e.target === musicPanelOverlay) {
      if (isMusicEditMode) exitMusicEditMode();
      musicPanelOverlay.classList.remove('open');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && musicPanelOverlay.classList.contains('open')) {
      if (isMusicEditMode) exitMusicEditMode();
      musicPanelOverlay.classList.remove('open');
    }
  });

  musicDownloadPlaylist.addEventListener('click', downloadPlaylist);

  // ── Drag & drop ──
  musicDropZone.addEventListener('dragover',  (e) => { e.preventDefault(); musicDropZone.classList.add('drag-over'); });
  musicDropZone.addEventListener('dragleave', ()  => { musicDropZone.classList.remove('drag-over'); });
  musicDropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    musicDropZone.classList.remove('drag-over');
    for (const file of [...e.dataTransfer.files]) await uploadTrack(file);
  });

  // ── Click to browse ──
  musicDropZone.addEventListener('click', () => {
    const input  = document.createElement('input');
    input.type   = 'file';
    input.accept = '.mp3,.mp4,.flac,.wav,.ogg,.m4a,.aac';
    input.multiple = true;
    input.addEventListener('change', async () => {
      for (const file of [...input.files]) await uploadTrack(file);
    });
    input.click();
  });

  musicShuffle.addEventListener('click', () => {
    isShuffled = !isShuffled;
    musicShuffle.classList.toggle('active', isShuffled);
  });

  musicLoop.addEventListener('click', () => {
    isLooping = !isLooping;
    musicLoop.classList.toggle('active', isLooping);
  });

  await loadTracks();
}