/* ═══════════════════════════════════════════════════════
   T Attendii — by TAHA AMIN
   Fully offline QR-based attendance system
═══════════════════════════════════════════════════════ */

'use strict';

// ─── PWA SERVICE WORKER ───────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(r => console.log('SW registered'))
      .catch(e => console.warn('SW failed:', e));
  });
}

// ─── PWA INSTALL ─────────────────────────────────────
let deferredInstall = null;
const installBtn = document.getElementById('install-btn');

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  installBtn.classList.remove('hidden');
});

installBtn.addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  if (outcome === 'accepted') {
    installBtn.classList.add('hidden');
    deferredInstall = null;
  }
});

window.addEventListener('appinstalled', () => {
  installBtn.classList.add('hidden');
  deferredInstall = null;
});

// ─── INDEXED DB ───────────────────────────────────────
const DB_NAME = 'TAttendiiDB';
const DB_VERSION = 1;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('students')) {
        const s = d.createObjectStore('students', { keyPath: 'sid' });
        s.createIndex('name', 'name', { unique: false });
        s.createIndex('dept', 'dept', { unique: false });
      }
      if (!d.objectStoreNames.contains('sessions')) {
        const sess = d.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        sess.createIndex('date', 'date', { unique: false });
        sess.createIndex('subject', 'subject', { unique: false });
      }
      if (!d.objectStoreNames.contains('attendance')) {
        const att = d.createObjectStore('attendance', { keyPath: 'id', autoIncrement: true });
        att.createIndex('sessionId', 'sessionId', { unique: false });
        att.createIndex('sid', 'sid', { unique: false });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e);
  });
}

function dbGet(store, key) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = e => rej(e);
  });
}

function dbGetAll(store) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = e => rej(e);
  });
}

function dbPut(store, obj) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(obj);
    req.onsuccess = () => res(req.result);
    req.onerror = e => rej(e);
  });
}

function dbDelete(store, key) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror = e => rej(e);
  });
}

function dbGetByIndex(store, indexName, value) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const idx = tx.objectStore(store).index(indexName);
    const req = idx.getAll(value);
    req.onsuccess = () => res(req.result);
    req.onerror = e => rej(e);
  });
}

function dbClear(store) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => res();
    req.onerror = e => rej(e);
  });
}

// ─── TOAST ───────────────────────────────────────────
function toast(msg, type = 'info', duration = 3000) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  document.getElementById('toast-container').prepend(t);
  setTimeout(() => t.remove(), duration);
}

// ─── VIEW NAVIGATION ─────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) {
    target.classList.add('active');
    window.scrollTo(0, 0);
  }
  // Refresh data when navigating
  if (id === 'view-dashboard') refreshDashboard();
  if (id === 'view-students') renderStudents();
  if (id === 'view-history') renderHistory();
  if (id === 'view-qr-cards') renderQRCards();
  if (id === 'view-export') populateExportSubjects();
  if (id === 'view-session-list') renderSessionList();
}

function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// ─── DASHBOARD ───────────────────────────────────────
async function refreshDashboard() {
  const [students, sessions, records] = await Promise.all([
    dbGetAll('students'), dbGetAll('sessions'), dbGetAll('attendance')
  ]);
  document.getElementById('stat-students').textContent = students.length;
  document.getElementById('stat-sessions').textContent = sessions.length;
  document.getElementById('stat-records').textContent = records.length;
}

// ─── STUDENTS ────────────────────────────────────────
let allStudents = [];

async function renderStudents(filter = '') {
  allStudents = await dbGetAll('students');
  const q = filter.toLowerCase();
  const list = q
    ? allStudents.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.sid.toLowerCase().includes(q) ||
        (s.dept || '').toLowerCase().includes(q))
    : allStudents;

  const container = document.getElementById('students-list');
  if (!list.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">👨‍🎓</div><div class="empty-text">${q ? 'No results' : 'No students yet. Tap + Add to begin.'}</div></div>`;
    return;
  }
  container.innerHTML = list.map(s => `
    <div class="student-item">
      <div class="student-avatar">${s.photo ? `<img src="${s.photo}" alt="${s.name}"/>` : '👤'}</div>
      <div class="student-info">
        <div class="student-name">${s.name}</div>
        <div class="student-id">${s.sid}</div>
        <div class="student-dept">${s.dept || ''}</div>
      </div>
      <div class="student-actions">
        <button class="icon-btn" onclick="editStudent('${s.sid}')">✏️</button>
        <button class="icon-btn danger" onclick="deleteStudent('${s.sid}')">🗑️</button>
      </div>
    </div>`).join('');
}

function filterStudents() {
  renderStudents(document.getElementById('student-search').value);
}

function openAddStudent() {
  document.getElementById('student-modal-title').textContent = 'Add Student';
  document.getElementById('edit-student-id').value = '';
  ['f-name','f-sid','f-father','f-email','f-phone','f-dept'].forEach(id =>
    document.getElementById(id).value = '');
  document.getElementById('photo-preview').style.display = 'none';
  document.getElementById('photo-placeholder').style.display = '';
  document.getElementById('f-sid').disabled = false;
  currentPhotoData = null;
  openModal('modal-student');
}

async function editStudent(sid) {
  const s = await dbGet('students', sid);
  if (!s) return;
  document.getElementById('student-modal-title').textContent = 'Edit Student';
  document.getElementById('edit-student-id').value = sid;
  document.getElementById('f-name').value = s.name || '';
  document.getElementById('f-sid').value = s.sid || '';
  document.getElementById('f-sid').disabled = true;
  document.getElementById('f-father').value = s.father || '';
  document.getElementById('f-email').value = s.email || '';
  document.getElementById('f-phone').value = s.phone || '';
  document.getElementById('f-dept').value = s.dept || '';
  if (s.photo) {
    document.getElementById('photo-preview').src = s.photo;
    document.getElementById('photo-preview').style.display = 'block';
    document.getElementById('photo-placeholder').style.display = 'none';
    currentPhotoData = s.photo;
  } else {
    document.getElementById('photo-preview').style.display = 'none';
    document.getElementById('photo-placeholder').style.display = '';
    currentPhotoData = null;
  }
  openModal('modal-student');
}

async function saveStudent() {
  const name = document.getElementById('f-name').value.trim();
  const sid = document.getElementById('f-sid').value.trim();
  if (!name || !sid) { toast('Name and Student ID are required', 'error'); return; }

  const editId = document.getElementById('edit-student-id').value;
  if (!editId) {
    const existing = await dbGet('students', sid);
    if (existing) { toast('Student ID already exists!', 'error'); return; }
  }

  const student = {
    sid, name,
    father: document.getElementById('f-father').value.trim(),
    email: document.getElementById('f-email').value.trim(),
    phone: document.getElementById('f-phone').value.trim(),
    dept: document.getElementById('f-dept').value.trim(),
    photo: currentPhotoData || null,
    createdAt: editId ? (await dbGet('students', editId))?.createdAt || Date.now() : Date.now()
  };

  await dbPut('students', student);
  closeModal('modal-student');
  renderStudents();
  refreshDashboard();
  toast(editId ? 'Student updated' : 'Student added successfully', 'success');
}

async function deleteStudent(sid) {
  if (!confirm(`Delete student ${sid}? This cannot be undone.`)) return;
  await dbDelete('students', sid);
  renderStudents();
  refreshDashboard();
  toast('Student deleted', 'info');
}

// ─── PHOTO UPLOAD ────────────────────────────────────
let currentPhotoData = null;

function handlePhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX = 200;
      let w = img.width, h = img.height;
      if (w > h) { if (w > MAX) { h *= MAX/w; w = MAX; } }
      else { if (h > MAX) { w *= MAX/h; h = MAX; } }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      currentPhotoData = canvas.toDataURL('image/jpeg', 0.75);
      document.getElementById('photo-preview').src = currentPhotoData;
      document.getElementById('photo-preview').style.display = 'block';
      document.getElementById('photo-placeholder').style.display = 'none';
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ─── QR CARD GENERATION ──────────────────────────────
async function renderQRCards(filter = '') {
  const students = await dbGetAll('students');
  const q = filter.toLowerCase();
  const list = q ? students.filter(s => s.name.toLowerCase().includes(q) || s.sid.toLowerCase().includes(q)) : students;
  const container = document.getElementById('qr-cards-list');

  if (!list.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🆔</div><div class="empty-text">${q ? 'No results' : 'No students found. Add students first.'}</div></div>`;
    return;
  }

  container.innerHTML = '';
  for (const s of list) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginBottom = '12px';

    const qrDataUrl = await generateQRDataURL(s.sid, 120);
    card.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
        <div class="student-avatar">${s.photo ? `<img src="${s.photo}"/>` : '👤'}</div>
        <div style="flex:1">
          <div style="font-weight:700">${s.name}</div>
          <div class="monospace" style="font-size:0.75rem;color:var(--text3)">${s.sid}</div>
          <div style="font-size:0.72rem;color:var(--text2)">${s.dept||''}</div>
        </div>
        <img src="${qrDataUrl}" width="60" height="60" style="border-radius:6px"/>
      </div>
      <div class="btn-group">
        <button class="btn btn-secondary btn-sm" onclick="downloadQRCard('${s.sid}')">⬇ PNG</button>
        <button class="btn btn-secondary btn-sm" onclick="printQRCard('${s.sid}')">🖨 Print</button>
        <button class="btn btn-primary btn-sm" onclick="downloadQRCardPDF('${s.sid}')">📄 PDF</button>
      </div>`;
    container.appendChild(card);
  }
}

function filterQRCards() {
  renderQRCards(document.getElementById('qr-search').value);
}

function generateQRDataURL(text, size = 200) {
  return new Promise(resolve => {
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, size, size);

    // Simple QR representation using a hash-based pattern
    const hash = [...text].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);
    const modules = 21;
    const cellSize = Math.floor(size / (modules + 4));
    const offset = Math.floor((size - modules * cellSize) / 2);

    ctx.fillStyle = '#000';

    // Finder patterns
    const drawFinder = (x, y) => {
      ctx.fillRect(x, y, 7*cellSize, 7*cellSize);
      ctx.fillStyle = '#fff';
      ctx.fillRect(x+cellSize, y+cellSize, 5*cellSize, 5*cellSize);
      ctx.fillStyle = '#000';
      ctx.fillRect(x+2*cellSize, y+2*cellSize, 3*cellSize, 3*cellSize);
    };

    drawFinder(offset, offset);
    drawFinder(offset + (modules-7)*cellSize, offset);
    drawFinder(offset, offset + (modules-7)*cellSize);

    // Data modules based on text hash + text chars
    const seed = [...text].map(c => c.charCodeAt(0));
    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        if ((r < 8 && c < 8) || (r < 8 && c >= modules-8) || (r >= modules-8 && c < 8)) continue;
        const idx = r * modules + c;
        const bit = (seed[idx % seed.length] >> (idx % 8)) & 1;
        const extra = (hash >> (idx % 32)) & 1;
        if (bit ^ extra) {
          ctx.fillStyle = '#000';
          ctx.fillRect(offset + c*cellSize, offset + r*cellSize, cellSize, cellSize);
        }
      }
    }

    resolve(canvas.toDataURL());
  });
}

async function buildQRCardCanvas(student) {
  const canvas = document.createElement('canvas');
  const W = 320, H = 430;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.roundRect ? ctx.roundRect(0, 0, W, H, 14) : ctx.rect(0, 0, W, H);
  ctx.fill();

  // Header
  ctx.fillStyle = '#1a5e2a';
  ctx.fillRect(0, 0, W, 60);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('UNIVERSITY OF EXCELLENCE', W/2, 24);
  ctx.font = '11px Outfit, sans-serif';
  ctx.fillText('Student Identity Card', W/2, 42);

  // Photo
  const photoSize = 90;
  const photoX = (W - photoSize) / 2;
  const photoY = 74;

  ctx.fillStyle = '#e8f5e9';
  ctx.strokeStyle = '#1a5e2a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(photoX, photoY, photoSize, photoSize, 8) : ctx.rect(photoX, photoY, photoSize, photoSize);
  ctx.fill(); ctx.stroke();

  if (student.photo) {
    await new Promise(res => {
      const img = new Image();
      img.onload = () => {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(photoX, photoY, photoSize, photoSize, 8) : ctx.rect(photoX, photoY, photoSize, photoSize);
        ctx.clip();
        ctx.drawImage(img, photoX, photoY, photoSize, photoSize);
        ctx.restore();
        res();
      };
      img.onerror = res;
      img.src = student.photo;
    });
  } else {
    ctx.fillStyle = '#444';
    ctx.font = '36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('👤', W/2, photoY + 60);
  }

  // Name & ID
  ctx.fillStyle = '#111';
  ctx.font = 'bold 16px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(student.name, W/2, photoY + photoSize + 26);

  ctx.fillStyle = '#555';
  ctx.font = '12px JetBrains Mono, monospace';
  ctx.fillText(student.sid, W/2, photoY + photoSize + 44);

  if (student.dept) {
    ctx.fillStyle = '#777';
    ctx.font = '11px Outfit, sans-serif';
    ctx.fillText(student.dept, W/2, photoY + photoSize + 60);
  }

  // QR Code
  const qrDataUrl = await generateQRDataURL(student.sid, 140);
  await new Promise(res => {
    const qrImg = new Image();
    qrImg.onload = () => {
      const qrX = (W - 130) / 2;
      ctx.drawImage(qrImg, qrX, 290, 130, 130);
      res();
    };
    qrImg.src = qrDataUrl;
  });

  // Footer
  ctx.fillStyle = '#1a5e2a';
  ctx.fillRect(0, H - 36, W, 36);
  ctx.fillStyle = '#fff';
  ctx.font = '10px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Powered by T Attendii  •  by TAHA AMIN', W/2, H - 14);

  return canvas;
}

async function downloadQRCard(sid) {
  const student = await dbGet('students', sid);
  if (!student) return;
  const canvas = await buildQRCardCanvas(student);
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `QR_${student.sid}_${student.name.replace(/\s/g,'_')}.png`;
  a.click();
  toast('QR card downloaded', 'success');
}

async function downloadQRCardPDF(sid) {
  const student = await dbGet('students', sid);
  if (!student) return;
  const canvas = await buildQRCardCanvas(student);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [320, 430] });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 320, 430);
  pdf.save(`QR_${student.sid}.pdf`);
  toast('PDF downloaded', 'success');
}

async function printQRCard(sid) {
  const student = await dbGet('students', sid);
  if (!student) return;
  const canvas = await buildQRCardCanvas(student);
  const win = window.open('', '_blank');
  win.document.write(`<html><body style="margin:0;display:flex;justify-content:center"><img src="${canvas.toDataURL()}" onload="window.print();window.close()"/></body></html>`);
}

async function exportAllQR() {
  const students = await dbGetAll('students');
  if (!students.length) { toast('No students found', 'error'); return; }
  toast('Generating ZIP... please wait', 'info');
  const zip = new JSZip();
  for (const s of students) {
    const canvas = await buildQRCardCanvas(s);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    zip.file(`QR_${s.sid}_${s.name.replace(/\s/g,'_')}.png`, blob);
  }
  const content = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(content);
  a.download = 'TAttendii_QR_Cards.zip';
  a.click();
  toast('All QR cards exported!', 'success');
}

// ─── SESSION MANAGEMENT ──────────────────────────────
let currentSession = null;
let presentSids = new Set();
let scanCooldown = new Set();
let html5QrScanner = null;
let torchOn = false;
let currentTrack = null;

async function startSession() {
  const subject = document.getElementById('sess-subject').value.trim();
  if (!subject) { toast('Subject is required', 'error'); return; }

  const students = await dbGetAll('students');
  if (!students.length) {
    toast('No students registered. Add students first.', 'error');
    return;
  }

  const dateVal = document.getElementById('sess-date').value || new Date().toISOString().split('T')[0];

  currentSession = {
    subject,
    topic: document.getElementById('sess-topic').value.trim(),
    venue: document.getElementById('sess-venue').value.trim(),
    date: dateVal,
    teacher: document.getElementById('sess-teacher').value.trim(),
    remarks: document.getElementById('sess-remarks').value.trim(),
    startTime: Date.now(),
    locked: false
  };

  presentSids = new Set();
  document.getElementById('scanner-subject-title').textContent = subject;
  showView('view-scanner');
  await initScanner();
  updateSessionStats();
}

async function initScanner() {
  const students = await dbGetAll('students');
  document.getElementById('ss-total').textContent = students.length;

  const config = {
    fps: 15,
    qrbox: { width: 200, height: 200 },
    aspectRatio: 1.2,
    disableFlip: false,
    videoConstraints: {
      facingMode: { ideal: 'environment' },
      focusMode: 'continuous',
      advanced: [{ focusMode: 'continuous' }]
    }
  };

  html5QrScanner = new Html5Qrcode('qr-reader', { verbose: false });

  try {
    await html5QrScanner.start({ facingMode: { ideal: 'environment' } }, config, onScanSuccess, onScanFailure);
    // Capture stream for torch
    const videoEl = document.querySelector('#qr-reader video');
    if (videoEl && videoEl.srcObject) {
      const tracks = videoEl.srcObject.getVideoTracks();
      if (tracks.length) currentTrack = tracks[0];
    }
  } catch (err) {
    console.warn('Rear camera failed, trying any camera:', err);
    try {
      await html5QrScanner.start({ facingMode: 'user' }, config, onScanSuccess, onScanFailure);
    } catch (err2) {
      toast('Camera access failed: ' + err2.message, 'error');
    }
  }
}

async function onScanSuccess(decodedText) {
  const sid = decodedText.trim();

  // Cooldown check
  if (scanCooldown.has(sid)) return;
  if (presentSids.has(sid)) {
    // Already present - short feedback
    vibrate(50);
    return;
  }

  const student = await dbGet('students', sid);
  if (!student) {
    toast(`Unknown QR: ${sid}`, 'error');
    return;
  }

  // Mark present
  presentSids.add(sid);
  scanCooldown.add(sid);
  setTimeout(() => scanCooldown.delete(sid), 2500);

  // Feedback
  playBeep();
  vibrate([50, 30, 50]);
  showScanPopup(student);
  updateSessionStats();
  addRecentScan(student);
}

function onScanFailure() { /* continuous retry, no action needed */ }

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(); osc.stop(ctx.currentTime + 0.3);
  } catch(e) {}
}

function vibrate(pattern) {
  try { navigator.vibrate && navigator.vibrate(pattern); } catch(e) {}
}

async function showScanPopup(student) {
  const popup = document.getElementById('scan-popup');
  document.getElementById('popup-name').textContent = student.name;
  document.getElementById('popup-id').textContent = student.sid;
  const photoEl = document.getElementById('popup-photo');
  if (student.photo) {
    photoEl.innerHTML = `<img src="${student.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:10px"/>`;
  } else {
    photoEl.textContent = '👤';
  }
  popup.classList.add('show');
  setTimeout(() => popup.classList.remove('show'), 2000);
}

async function updateSessionStats() {
  const students = await dbGetAll('students');
  const total = students.length;
  const present = presentSids.size;
  const absent = total - present;
  const pct = total ? Math.round((present / total) * 100) : 0;

  document.getElementById('ss-total').textContent = total;
  document.getElementById('ss-present').textContent = present;
  document.getElementById('ss-absent').textContent = absent;
  document.getElementById('ss-pct').textContent = pct + '%';
  document.getElementById('tab-present-count').textContent = present;
  document.getElementById('tab-absent-count').textContent = absent;
}

function addRecentScan(student) {
  const container = document.getElementById('recent-scans');
  const item = document.createElement('div');
  item.className = 'att-item';
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  item.innerHTML = `
    <div class="att-badge present">✓</div>
    <div style="flex:1">
      <div class="att-name">${student.name}</div>
      <div class="att-id">${student.sid}</div>
    </div>
    <div class="att-time">${time}</div>`;
  container.prepend(item);
  // Keep only last 5 visible
  const items = container.querySelectorAll('.att-item');
  if (items.length > 5) items[items.length - 1].remove();
}

async function renderSessionList() {
  const students = await dbGetAll('students');
  const presentList = document.getElementById('att-present-list');
  const absentList = document.getElementById('att-absent-list');
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const presentStudents = students.filter(s => presentSids.has(s.sid));
  const absentStudents = students.filter(s => !presentSids.has(s.sid));

  presentList.innerHTML = presentStudents.length
    ? presentStudents.map(s => `
        <div class="att-item">
          <div class="att-badge present">✓</div>
          <div style="flex:1"><div class="att-name">${s.name}</div><div class="att-id">${s.sid}</div></div>
          <button class="icon-btn danger" onclick="removePresent('${s.sid}')">✕</button>
        </div>`).join('')
    : '<div class="empty-state"><div class="empty-text">No one marked present yet</div></div>';

  absentList.innerHTML = absentStudents.length
    ? absentStudents.map(s => `
        <div class="att-item">
          <div class="att-badge absent">✗</div>
          <div style="flex:1"><div class="att-name">${s.name}</div><div class="att-id">${s.sid}</div></div>
          <button class="icon-btn" onclick="markPresentManually('${s.sid}')">➕</button>
        </div>`).join('')
    : '<div class="empty-state"><div class="empty-text">All students present!</div></div>';
}

function switchAttTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('att-present-list').style.display = tab === 'present' ? '' : 'none';
  document.getElementById('att-absent-list').style.display = tab === 'absent' ? '' : 'none';
}

function removePresent(sid) {
  presentSids.delete(sid);
  updateSessionStats();
  renderSessionList();
}

function markPresentManually(sid) {
  presentSids.add(sid);
  updateSessionStats();
  renderSessionList();
}

async function toggleTorch() {
  if (!currentTrack) {
    // Try to get track again
    const videoEl = document.querySelector('#qr-reader video');
    if (videoEl && videoEl.srcObject) {
      const tracks = videoEl.srcObject.getVideoTracks();
      if (tracks.length) currentTrack = tracks[0];
    }
  }
  if (!currentTrack) { toast('Torch not available', 'info'); return; }
  try {
    torchOn = !torchOn;
    await currentTrack.applyConstraints({ advanced: [{ torch: torchOn }] });
    const btn = document.getElementById('torch-btn');
    btn.classList.toggle('on', torchOn);
    btn.textContent = torchOn ? '🔦 Torch ON' : '🔦 Torch';
  } catch(e) { toast('Torch not supported on this device', 'info'); }
}

async function stopScanner() {
  if (html5QrScanner) {
    try { await html5QrScanner.stop(); } catch(e) {}
    html5QrScanner = null;
  }
  currentSession = null;
  presentSids = new Set();
  torchOn = false;
  currentTrack = null;
  showView('view-dashboard');
}

async function endSession() {
  if (!currentSession) return;
  if (!confirm('End this attendance session?')) return;

  const students = await dbGetAll('students');
  const total = students.length;
  const presentArr = [...presentSids];
  const absentArr = students.filter(s => !presentSids.has(s.sid)).map(s => s.sid);
  const pct = total ? Math.round((presentArr.length / total) * 100) : 0;

  const session = {
    ...currentSession,
    endTime: Date.now(),
    locked: true,
    totalStudents: total,
    presentCount: presentArr.length,
    absentCount: absentArr.length,
    percentage: pct,
    presentList: presentArr,
    absentList: absentArr
  };

  const sessionId = await dbPut('sessions', session);

  // Save attendance records
  for (const sid of presentArr) {
    await dbPut('attendance', { sessionId, sid, status: 'present', time: Date.now() });
  }
  for (const sid of absentArr) {
    await dbPut('attendance', { sessionId, sid, status: 'absent', time: Date.now() });
  }

  if (html5QrScanner) {
    try { await html5QrScanner.stop(); } catch(e) {}
    html5QrScanner = null;
  }

  currentSession = null;
  presentSids = new Set();
  torchOn = false;
  currentTrack = null;

  toast(`Session saved! ${presentArr.length}/${total} present (${pct}%)`, 'success');
  refreshDashboard();
  showView('view-history');
}

// ─── HISTORY ─────────────────────────────────────────
let allSessions = [];

async function renderHistory(filter = '') {
  allSessions = await dbGetAll('sessions');
  allSessions.sort((a, b) => b.startTime - a.startTime);
  const q = filter.toLowerCase();
  const list = q ? allSessions.filter(s =>
    (s.subject||'').toLowerCase().includes(q) ||
    (s.teacher||'').toLowerCase().includes(q) ||
    (s.date||'').includes(q)
  ) : allSessions;

  const container = document.getElementById('history-list');
  if (!list.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">${q ? 'No results' : 'No sessions yet. Start an attendance session.'}</div></div>`;
    return;
  }

  container.innerHTML = list.map(s => {
    const pct = s.percentage || 0;
    const pctClass = pct >= 75 ? 'pct-high' : pct >= 50 ? 'pct-mid' : 'pct-low';
    return `
      <div class="history-item" onclick="openSessionDetail(${s.id})">
        <div style="display:flex;align-items:flex-start">
          <div style="flex:1">
            <div class="history-subject">${s.subject}</div>
            <div class="history-meta">
              <span>📅 ${s.date}</span>
              <span>🏫 ${s.venue||'N/A'}</span>
              <span>👨‍🏫 ${s.teacher||'N/A'}</span>
            </div>
            <div class="history-meta" style="margin-top:4px">
              <span class="tag tag-green">✓ ${s.presentCount||0} present</span>
              <span class="tag tag-red">✗ ${s.absentCount||0} absent</span>
            </div>
          </div>
          <div class="history-pct ${pctClass}">${pct}%</div>
        </div>
        <div class="progress-bar" style="margin-top:10px">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
      </div>`;
  }).join('');
}

function filterHistory() {
  renderHistory(document.getElementById('history-search').value);
}

async function openSessionDetail(sessionId) {
  const session = await dbGet('sessions', sessionId);
  if (!session) return;

  const students = await dbGetAll('students');
  const studMap = {};
  students.forEach(s => studMap[s.sid] = s);

  const pct = session.percentage || 0;
  const pctClass = pct >= 75 ? 'pct-high' : pct >= 50 ? 'pct-mid' : 'pct-low';

  const presentHTML = (session.presentList || []).map(sid => {
    const s = studMap[sid];
    return `<div class="att-item">
      <div class="att-badge present">✓</div>
      <div style="flex:1">
        <div class="att-name">${s ? s.name : sid}</div>
        <div class="att-id">${sid}</div>
      </div>
      <button class="icon-btn danger" onclick="removeFromSession(${sessionId},'${sid}','present')">✕</button>
    </div>`;
  }).join('');

  const absentHTML = (session.absentList || []).map(sid => {
    const s = studMap[sid];
    return `<div class="att-item">
      <div class="att-badge absent">✗</div>
      <div style="flex:1">
        <div class="att-name">${s ? s.name : sid}</div>
        <div class="att-id">${sid}</div>
      </div>
      <button class="icon-btn" onclick="moveToPresent(${sessionId},'${sid}')">➕</button>
    </div>`;
  }).join('');

  document.getElementById('session-detail-content').innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div style="margin-bottom:8px">
        <div style="font-size:1.1rem;font-weight:800">${session.subject}</div>
        <div class="text-muted" style="margin-top:4px">${session.topic||''}</div>
      </div>
      <div class="history-meta">
        <span>📅 ${session.date}</span>
        <span>🏫 ${session.venue||'N/A'}</span>
        <span>👨‍🏫 ${session.teacher||'N/A'}</span>
      </div>
      ${session.remarks ? `<div class="text-muted" style="margin-top:6px">📝 ${session.remarks}</div>` : ''}
      <div class="session-stats" style="margin-top:14px">
        <div class="sess-stat"><div class="sess-stat-num">${session.totalStudents||0}</div><div class="sess-stat-label">Total</div></div>
        <div class="sess-stat"><div class="sess-stat-num green">${session.presentCount||0}</div><div class="sess-stat-label">Present</div></div>
        <div class="sess-stat"><div class="sess-stat-num red">${session.absentCount||0}</div><div class="sess-stat-label">Absent</div></div>
        <div class="sess-stat"><div class="sess-stat-num ${pctClass}">${pct}%</div><div class="sess-stat-label">Percent</div></div>
      </div>
    </div>
    <div class="tabs">
      <button class="tab-btn active" onclick="switchDetailTab('present',this)">✅ Present (${(session.presentList||[]).length})</button>
      <button class="tab-btn" onclick="switchDetailTab('absent',this)">❌ Absent (${(session.absentList||[]).length})</button>
    </div>
    <div id="detail-present">${presentHTML || '<div class="empty-state"><div class="empty-text">No present students</div></div>'}</div>
    <div id="detail-absent" style="display:none">${absentHTML || '<div class="empty-state"><div class="empty-text">All students present!</div></div>'}</div>
    <div style="height:60px"></div>`;

  window._currentDetailSession = sessionId;
  showView('view-session-detail');
}

function switchDetailTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('detail-present').style.display = tab === 'present' ? '' : 'none';
  document.getElementById('detail-absent').style.display = tab === 'absent' ? '' : 'none';
}

async function moveToPresent(sessionId, sid) {
  const session = await dbGet('sessions', sessionId);
  if (!session) return;
  session.presentList = [...(session.presentList || []), sid];
  session.absentList = (session.absentList || []).filter(s => s !== sid);
  session.presentCount = session.presentList.length;
  session.absentCount = session.absentList.length;
  session.percentage = session.totalStudents ? Math.round((session.presentCount / session.totalStudents) * 100) : 0;
  await dbPut('sessions', session);
  await dbPut('attendance', { sessionId, sid, status: 'present', time: Date.now() });
  toast('Marked present', 'success');
  openSessionDetail(sessionId);
}

async function removeFromSession(sessionId, sid, status) {
  const session = await dbGet('sessions', sessionId);
  if (!session) return;
  if (status === 'present') {
    session.presentList = (session.presentList || []).filter(s => s !== sid);
    session.absentList = [...(session.absentList || []), sid];
    session.presentCount = session.presentList.length;
    session.absentCount = session.absentList.length;
    session.percentage = session.totalStudents ? Math.round((session.presentCount / session.totalStudents) * 100) : 0;
    await dbPut('sessions', session);
    toast('Removed from present list', 'info');
    openSessionDetail(sessionId);
  }
}

async function exportSessionReport() {
  const sessionId = window._currentDetailSession;
  if (!sessionId) return;
  const session = await dbGet('sessions', sessionId);
  if (!session) return;
  const students = await dbGetAll('students');
  const studMap = {};
  students.forEach(s => studMap[s.sid] = s);

  let csv = `T Attendii Session Report\nby TAHA AMIN\n\n`;
  csv += `Subject,${session.subject}\nTopic,${session.topic||''}\nDate,${session.date}\nVenue,${session.venue||''}\nTeacher,${session.teacher||''}\nRemarks,${session.remarks||''}\n`;
  csv += `\nTotal,${session.totalStudents}\nPresent,${session.presentCount}\nAbsent,${session.absentCount}\nPercentage,${session.percentage}%\n\n`;
  csv += `PRESENT LIST\nSID,Name,Department\n`;
  (session.presentList || []).forEach(sid => {
    const s = studMap[sid];
    csv += `${sid},${s ? s.name : 'Unknown'},${s ? s.dept||'' : ''}\n`;
  });
  csv += `\nABSENT LIST\nSID,Name,Department\n`;
  (session.absentList || []).forEach(sid => {
    const s = studMap[sid];
    csv += `${sid},${s ? s.name : 'Unknown'},${s ? s.dept||'' : ''}\n`;
  });

  downloadCSV(csv, `Report_${session.subject}_${session.date}.csv`);
  toast('Report exported', 'success');
}

// ─── EXPORT ──────────────────────────────────────────
async function populateExportSubjects() {
  const sessions = await dbGetAll('sessions');
  const subjects = [...new Set(sessions.map(s => s.subject).filter(Boolean))];
  const sel = document.getElementById('export-subject-filter');
  sel.innerHTML = '<option value="">All Subjects</option>' +
    subjects.map(s => `<option>${s}</option>`).join('');
}

async function exportStudentsCSV() {
  const students = await dbGetAll('students');
  if (!students.length) { toast('No students to export', 'error'); return; }
  let csv = 'Student ID,Name,Father Name,Email,Phone,Department\n';
  students.forEach(s => {
    csv += `"${s.sid}","${s.name}","${s.father||''}","${s.email||''}","${s.phone||''}","${s.dept||''}"\n`;
  });
  downloadCSV(csv, 'Students_TAttendii.csv');
  toast('Students exported', 'success');
}

async function exportAttendanceCSV() {
  let sessions = await dbGetAll('sessions');
  const fromDate = document.getElementById('export-date-from').value;
  const toDate = document.getElementById('export-date-to').value;
  const subjectFilter = document.getElementById('export-subject-filter').value;

  if (subjectFilter) sessions = sessions.filter(s => s.subject === subjectFilter);
  if (fromDate) sessions = sessions.filter(s => s.date >= fromDate);
  if (toDate) sessions = sessions.filter(s => s.date <= toDate);

  if (!sessions.length) { toast('No sessions match filter', 'error'); return; }

  const students = await dbGetAll('students');
  const studMap = {};
  students.forEach(s => studMap[s.sid] = s);

  let csv = 'Session ID,Subject,Date,Venue,Teacher,Student ID,Student Name,Status,Percentage\n';
  for (const sess of sessions) {
    (sess.presentList || []).forEach(sid => {
      const s = studMap[sid];
      csv += `${sess.id},"${sess.subject}","${sess.date}","${sess.venue||''}","${sess.teacher||''}","${sid}","${s?s.name:'Unknown'}",Present,${sess.percentage}%\n`;
    });
    (sess.absentList || []).forEach(sid => {
      const s = studMap[sid];
      csv += `${sess.id},"${sess.subject}","${sess.date}","${sess.venue||''}","${sess.teacher||''}","${sid}","${s?s.name:'Unknown'}",Absent,${sess.percentage}%\n`;
    });
  }
  downloadCSV(csv, `Attendance_TAttendii_${new Date().toISOString().split('T')[0]}.csv`);
  toast('Attendance exported', 'success');
}

function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// ─── BACKUP & RESTORE ────────────────────────────────
async function exportBackup() {
  const [students, sessions, attendance] = await Promise.all([
    dbGetAll('students'), dbGetAll('sessions'), dbGetAll('attendance')
  ]);
  const backup = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    appName: 'T Attendii',
    createdBy: 'TAHA AMIN',
    students, sessions, attendance
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `TAttendii_Backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  toast('Backup downloaded successfully', 'success');
}

async function importBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('⚠️ This will REPLACE all current data with the backup. Continue?')) {
    e.target.value = '';
    return;
  }
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    if (!backup.students && !backup.sessions) throw new Error('Invalid backup file');

    await Promise.all([dbClear('students'), dbClear('sessions'), dbClear('attendance')]);

    for (const s of backup.students || []) await dbPut('students', s);
    for (const s of backup.sessions || []) {
      const { id, ...rest } = s;
      await dbPut('sessions', s);
    }
    for (const a of backup.attendance || []) {
      const { id, ...rest } = a;
      await dbPut('attendance', a);
    }

    refreshDashboard();
    toast('Backup restored successfully!', 'success');
  } catch(err) {
    toast('Invalid backup file: ' + err.message, 'error');
  }
  e.target.value = '';
}

// ─── INIT ─────────────────────────────────────────────
async function init() {
  await openDB();
  refreshDashboard();
  // Set today's date in session form
  document.getElementById('sess-date').value = new Date().toISOString().split('T')[0];
  // Load saved teacher name
  const savedTeacher = localStorage.getItem('tattendii_teacher');
  if (savedTeacher) document.getElementById('sess-teacher').value = savedTeacher;
  // Auto-save teacher name
  document.getElementById('sess-teacher').addEventListener('input', e => {
    localStorage.setItem('tattendii_teacher', e.target.value);
  });
}

init().catch(console.error);
