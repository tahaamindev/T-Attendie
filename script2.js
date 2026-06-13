'use strict';

/* ═══════════════════════════════════════
   T ATTENDII — QR CARD GENERATOR
   ═══════════════════════════════════════ */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

const STUDENTS_KEY = 'tattendii_students';

// ── DOM ───────────────────────────────────────────────────────────────────────
const viewList        = document.getElementById('viewList');
const viewCard        = document.getElementById('viewCard');
const studentGrid     = document.getElementById('studentGrid');
const listCount       = document.getElementById('listCount');
const emptyState      = document.getElementById('emptyState');
const emptyTitle      = document.getElementById('emptyTitle');
const emptySub        = document.getElementById('emptySub');
const searchInput     = document.getElementById('searchInput');
const deptFilter      = document.getElementById('deptFilter');
const navbarDeptLabel = document.getElementById('navbarDeptLabel');
const backBtn         = document.getElementById('backBtn');
const downloadBtn     = document.getElementById('downloadBtn');
const qrCanvas        = document.getElementById('qrCanvas');
const cardDeptBadge   = document.getElementById('cardDeptBadge');
const cardStudentName = document.getElementById('cardStudentName');
const cardStudentId   = document.getElementById('cardStudentId');
// Modal
const addBtn          = document.getElementById('addBtn');
const modalOverlay    = document.getElementById('modalOverlay');
const modalClose      = document.getElementById('modalClose');
const modalSubmit     = document.getElementById('modalSubmit');
const inputName       = document.getElementById('inputName');
const inputId         = document.getElementById('inputId');
const inputDept       = document.getElementById('inputDept');
const fieldError      = document.getElementById('fieldError');

// ── State ─────────────────────────────────────────────────────────────────────
let allStudents      = [];
let filteredStudents = [];
let currentStudent   = null;

// ── Storage ───────────────────────────────────────────────────────────────────
function loadStudents() {
  try {
    const raw = localStorage.getItem(STUDENTS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    if (typeof data === 'object' && data !== null) return Object.values(data);
    return [];
  } catch { return []; }
}

function saveStudents(students) {
  localStorage.setItem(STUDENTS_KEY, JSON.stringify(students));
}

// ── Dept Filter (only depts that exist in allStudents) ────────────────────────
function populateDeptFilter() {
  const current = deptFilter.value;
  const depts = [...new Set(allStudents.map(s => (s.department || '')).filter(Boolean))].sort();
  deptFilter.innerHTML = '<option value="">All Departments</option>';
  depts.forEach(dept => {
    const opt = document.createElement('option');
    opt.value = dept;
    opt.textContent = dept;
    if (dept === current) opt.selected = true;
    deptFilter.appendChild(opt);
  });
  // If previously selected dept no longer exists, reset
  if (current && !depts.includes(current)) deptFilter.value = '';
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length === 1
    ? parts[0][0].toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderStudents(students) {
  studentGrid.innerHTML = '';

  if (!students.length) {
    emptyState.style.display = 'block';
    listCount.textContent = '0 students';
    // Different message when there are real students but filter hides them
    if (allStudents.length > 0) {
      emptyTitle.textContent = 'No results';
      emptySub.innerHTML = 'Try a different search or filter.';
    } else {
      emptyTitle.textContent = 'No students yet';
      emptySub.innerHTML = 'Tap <strong>Add</strong> to create your first student card.';
    }
    return;
  }

  emptyState.style.display = 'none';
  listCount.textContent = `${students.length} student${students.length !== 1 ? 's' : ''}`;

  students.forEach(student => {
    const name = student.name || 'Unknown';
    const id   = student.id   || '—';
    const dept = student.department || '';

    const card = document.createElement('div');
    card.className = 'student-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    card.innerHTML = `
      <div class="student-avatar">${getInitials(name)}</div>
      <div class="student-info">
        <div class="student-name">${escapeHtml(name)}</div>
        <div class="student-meta">
          <span class="student-id">${escapeHtml(id)}</span>
          ${dept ? `<span class="student-dept-pill">${escapeHtml(dept)}</span>` : ''}
        </div>
      </div>
      <svg class="card-arrow" width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M7 4.5L11.5 9L7 13.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <button class="delete-btn" aria-label="Delete ${escapeHtml(name)}">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 4h10M6 4V3h4v1M5 4l.5 9h5L11 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    `;

    // Click card body → open QR (but not the delete button)
    card.addEventListener('click', e => {
      if (!e.target.closest('.delete-btn')) openCard(student);
    });
    card.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.delete-btn')) openCard(student);
    });

    // Delete button
    card.querySelector('.delete-btn').addEventListener('click', e => {
      e.stopPropagation();
      deleteStudent(student.id);
    });

    studentGrid.appendChild(card);
  });
}

// ── Filters ───────────────────────────────────────────────────────────────────
function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  const dept  = deptFilter.value;

  filteredStudents = allStudents.filter(s => {
    const matchesQuery = !query ||
      (s.name || '').toLowerCase().includes(query) ||
      (s.id   || '').toLowerCase().includes(query);
    const matchesDept  = !dept || (s.department || '') === dept;
    return matchesQuery && matchesDept;
  });

  navbarDeptLabel.textContent = dept ? dept.toUpperCase() : 'All Depts';
  renderStudents(filteredStudents);
}

// ── Add Student ───────────────────────────────────────────────────────────────
function openModal() {
  inputName.value = '';
  inputId.value   = '';
  inputDept.value = '';
  fieldError.textContent = '';
  modalOverlay.style.display = 'flex';
  setTimeout(() => inputName.focus(), 50);
}

function closeModal() {
  modalOverlay.style.display = 'none';
}

function addStudent() {
  const name = inputName.value.trim();
  const id   = inputId.value.trim();
  const dept = inputDept.value.trim();

  if (!name) { fieldError.textContent = 'Student name is required.'; inputName.focus(); return; }
  if (!id)   { fieldError.textContent = 'Student ID is required.';   inputId.focus();   return; }

  // Duplicate ID check
  if (allStudents.some(s => s.id === id)) {
    fieldError.textContent = 'A student with this ID already exists.';
    inputId.focus(); return;
  }

  const student = { id, name, department: dept };
  allStudents.push(student);
  saveStudents(allStudents);
  populateDeptFilter();
  applyFilters();
  closeModal();
}

// ── Delete Student ────────────────────────────────────────────────────────────
function deleteStudent(id) {
  allStudents = allStudents.filter(s => s.id !== id);
  saveStudents(allStudents);
  populateDeptFilter();
  applyFilters();
}

// ── Open QR Card ──────────────────────────────────────────────────────────────
function openCard(student) {
  currentStudent = student;
  const name = student.name || 'Unknown';
  const id   = student.id   || '—';
  const dept = student.department || '';

  cardStudentName.textContent = name;
  cardStudentId.textContent   = `ID: ${id}`;
  cardDeptBadge.textContent   = (dept || 'Department').toUpperCase();

  QRCode.toCanvas(qrCanvas, id, {
    width: 240, margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
    errorCorrectionLevel: 'H',
  }, err => { if (err) console.error(err); });

  viewList.style.display = 'none';
  viewCard.style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goBack() {
  viewCard.style.display = 'none';
  viewList.style.display = 'block';
  currentStudent = null;
}

// ── Download PNG ──────────────────────────────────────────────────────────────
async function downloadCardAsPng() {
  if (!currentStudent) return;
  const name = currentStudent.name || 'Unknown';
  const id   = currentStudent.id   || '';
  const dept = currentStudent.department || '';

  const SCALE = 3, W = 340, H = 430;
  const canvas = document.createElement('canvas');
  canvas.width  = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  try { await document.fonts.ready; } catch {}

  // Background
  ctx.fillStyle = '#031A0F';
  rr(ctx, 0, 0, W, H, 22); ctx.fill();
  ctx.strokeStyle = 'rgba(0,230,90,0.22)'; ctx.lineWidth = 1;
  rr(ctx, 0.5, 0.5, W - 1, H - 1, 22); ctx.stroke();

  const px = 24; let y = 28;
  ctx.fillStyle = '#F8F8F8';
  ctx.font = '700 18px Outfit, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('T Attendii', px, y); y += 24;

  const badgeText = (dept || 'Department').toUpperCase();
  ctx.font = '700 10px Outfit, sans-serif';
  const bw = ctx.measureText(badgeText).width + 24, bh = 22;
  ctx.fillStyle = 'rgba(0,230,90,0.12)'; rr(ctx, px, y, bw, bh, 11); ctx.fill();
  ctx.strokeStyle = 'rgba(0,230,90,0.3)'; ctx.lineWidth = 1;
  rr(ctx, px+0.5, y+0.5, bw-1, bh-1, 11); ctx.stroke();
  ctx.fillStyle = '#00E65A'; ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, px + 12, y + bh / 2); y += bh + 18;

  ctx.strokeStyle = 'rgba(0,230,90,0.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(W - px, y); ctx.stroke(); y += 22;

  const qrSize = 180, qrPad = 14, boxSize = qrSize + qrPad * 2;
  const qrX = (W - boxSize) / 2;
  ctx.fillStyle = '#fff'; rr(ctx, qrX, y, boxSize, boxSize, 14); ctx.fill();
  ctx.strokeStyle = 'rgba(0,230,90,0.5)'; ctx.lineWidth = 2;
  rr(ctx, qrX+1, y+1, boxSize-2, boxSize-2, 14); ctx.stroke();
  ctx.shadowColor = 'rgba(0,230,90,0.2)'; ctx.shadowBlur = 18;
  ctx.strokeStyle = 'rgba(0,230,90,0.3)'; ctx.lineWidth = 6;
  rr(ctx, qrX, y, boxSize, boxSize, 14); ctx.stroke(); ctx.shadowBlur = 0;

  const offCanvas = document.createElement('canvas');
  await new Promise((res, rej) => {
    QRCode.toCanvas(offCanvas, id, {
      width: qrSize * SCALE, margin: 1,
      color: { dark: '#000000', light: '#ffffff' }, errorCorrectionLevel: 'H',
    }, err => err ? rej(err) : res());
  });
  ctx.drawImage(offCanvas, qrX + qrPad, y + qrPad, qrSize, qrSize);
  y += boxSize + 22;

  ctx.fillStyle = '#F8F8F8'; ctx.font = '700 17px Outfit, sans-serif';
  ctx.textBaseline = 'top'; ctx.fillText(name, px, y); y += 24;
  ctx.fillStyle = '#00E65A'; ctx.font = '600 13px "JetBrains Mono", monospace';
  ctx.fillText(`ID: ${id}`, px, y); y += 24;

  ctx.strokeStyle = 'rgba(0,230,90,0.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(W - px, y); ctx.stroke(); y += 14;

  ctx.fillStyle = 'rgba(170,184,176,0.45)';
  ctx.font = '500 9px Outfit, sans-serif'; ctx.textBaseline = 'top';
  const ft = 'T Attendii by TAHA AMIN';
  ctx.fillText(ft, (W - ctx.measureText(ft).width) / 2, y);

  const link = document.createElement('a');
  link.download = `TAttendii_${(id || name).replace(/[^a-zA-Z0-9-_]/g, '_')}.png`;
  link.href = canvas.toDataURL('image/png', 1.0);
  link.click();
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Events ────────────────────────────────────────────────────────────────────
addBtn.addEventListener('click', openModal);
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
modalSubmit.addEventListener('click', addStudent);
[inputName, inputId, inputDept].forEach(el => {
  el.addEventListener('keydown', e => { if (e.key === 'Enter') addStudent(); });
});
searchInput.addEventListener('input', applyFilters);
deptFilter.addEventListener('change', applyFilters);
backBtn.addEventListener('click', goBack);
downloadBtn.addEventListener('click', downloadCardAsPng);

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  // Clear any previously seeded demo data — start fresh
  allStudents = loadStudents();
  populateDeptFilter();
  filteredStudents = [...allStudents];
  renderStudents(filteredStudents);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else { init(); }
