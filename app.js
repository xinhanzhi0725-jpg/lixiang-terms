/* ─────────────────────────────────────────────────────────────────────────
   理想汽车 英文术语对照库 — app.js
   ───────────────────────────────────────────────────────────────────────── */

// ── Supabase ────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://askehkptrpbtybvfkpwm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFza2Voa3B0cnBidHlidmZrcHdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNzMxNDcsImV4cCI6MjA5MDc0OTE0N30.oAQo9z1sjIVjhHBLZDYYYxUT0H5CGJ9bRCBoDva2JbM';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── State ───────────────────────────────────────────────────────────────────
let allTerms        = [];
let allCategories   = [];
let selectedCatId   = 'all';   // 'all' | category uuid | 'uncategorized'
let searchQuery     = '';
let fuseInstance    = null;
let editingTermId   = null;    // null = add mode, string = edit mode
let confirmCallback = null;    // function to call on confirm-ok

// ── Init ────────────────────────────────────────────────────────────────────
async function init() {
  try {
    await Promise.all([loadCategories(), loadTerms()]);
    renderCategories();
    renderTerms();
    setupEventListeners();
  } catch (err) {
    console.error('初始化失败:', err);
    showToast('加载失败，请刷新页面重试');
    document.getElementById('loading-state').classList.add('hidden');
  }
}

// ── Data loading ────────────────────────────────────────────────────────────
async function loadTerms() {
  const { data, error } = await db
    .from('terms')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  allTerms = data || [];
  rebuildFuse();
  document.getElementById('term-count').textContent = `共 ${allTerms.length} 条术语`;
}

async function loadCategories() {
  const { data, error } = await db
    .from('categories')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  allCategories = data || [];
}

function rebuildFuse() {
  fuseInstance = new Fuse(allTerms, {
    keys: ['zh', 'en', 'abbr', 'notes', 'source'],
    threshold: 0.35,
    includeMatches: true,
    ignoreLocation: true,
  });
}

// ── Render: Categories ──────────────────────────────────────────────────────
function renderCategories() {
  const list = document.getElementById('category-list');

  // Build category rows
  const rows = [];

  // "全部" row
  rows.push({ id: 'all', name: '全部', count: allTerms.length, special: true });

  // Named categories
  allCategories.forEach(cat => {
    const count = allTerms.filter(t => t.category === cat.name).length;
    rows.push({ id: cat.id, name: cat.name, count });
  });

  // "未分类" row (only if there are such terms)
  const knownNames = new Set(allCategories.map(c => c.name));
  const uncatCount = allTerms.filter(t => !knownNames.has(t.category)).length;
  if (uncatCount > 0) {
    rows.push({ id: 'uncategorized', name: '未分类', count: uncatCount, special: true });
  }

  list.innerHTML = rows.map(row => {
    const active = row.id === selectedCatId ? 'active' : '';
    const actions = (!row.special)
      ? `<div class="category-actions">
           <button class="btn-icon"
                   data-action="edit-cat"
                   data-id="${row.id}"
                   data-name="${esc(row.name)}"
                   title="编辑分类">✏</button>
           <button class="btn-icon danger"
                   data-action="del-cat"
                   data-id="${row.id}"
                   data-name="${esc(row.name)}"
                   data-count="${row.count}"
                   title="删除分类">🗑</button>
         </div>`
      : '';

    return `
      <div class="category-item ${active}"
           data-action="select-cat"
           data-id="${row.id}">
        <span class="category-name">${h(row.name)}</span>
        <span class="category-count">${row.count}</span>
        ${actions}
      </div>`;
  }).join('');
}

// ── Render: Terms ───────────────────────────────────────────────────────────
function renderTerms() {
  const grid    = document.getElementById('terms-grid');
  const empty   = document.getElementById('empty-state');
  const loading = document.getElementById('loading-state');
  const info    = document.getElementById('results-info');

  loading.classList.add('hidden');

  // 1. Filter by category
  let pool = allTerms;
  if (selectedCatId !== 'all') {
    if (selectedCatId === 'uncategorized') {
      const known = new Set(allCategories.map(c => c.name));
      pool = allTerms.filter(t => !known.has(t.category));
    } else {
      const cat = allCategories.find(c => c.id === selectedCatId);
      if (cat) pool = allTerms.filter(t => t.category === cat.name);
    }
  }

  // 2. Search within pool
  let display = pool;
  let matchMap = {};

  if (searchQuery.trim()) {
    const localFuse = new Fuse(pool, {
      keys: ['zh', 'en', 'abbr', 'notes', 'source'],
      threshold: 0.35,
      includeMatches: true,
      ignoreLocation: true,
    });
    const results = localFuse.search(searchQuery);
    display = results.map(r => r.item);
    results.forEach(r => { matchMap[r.item.id] = r.matches; });
  }

  // 3. Results count
  if (searchQuery.trim() || selectedCatId !== 'all') {
    info.textContent = `找到 ${display.length} 条结果`;
    info.classList.remove('hidden');
  } else {
    info.classList.add('hidden');
  }

  // 4. Render
  if (display.length === 0) {
    grid.innerHTML = '';
    const emptyText = document.getElementById('empty-text');
    emptyText.textContent = searchQuery
      ? `未找到与「${searchQuery}」相关的术语`
      : '该分类下暂无词条';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  grid.innerHTML = display.map(term => termCard(term, matchMap[term.id])).join('');
}

function termCard(term, matches) {
  const hi = (text, key) => {
    if (!text) return '';
    if (!matches) return h(text);
    const m = matches.find(x => x.key === key);
    return m ? applyHighlight(text, m.indices) : h(text);
  };

  const abbrBadge    = term.abbr
    ? `<span class="term-tag abbr">缩写：${h(term.abbr)}</span>` : '';
  const catBadge     = term.category
    ? `<span class="term-tag category">${h(term.category)}</span>` : '';
  const sourceBadge  = term.source
    ? `<span class="term-tag">📄 ${h(term.source)}</span>` : '';
  const notesBlock   = term.notes
    ? `<div class="term-notes">备注：${h(term.notes)}</div>` : '';

  return `
    <div class="term-card">
      <div class="card-actions">
        <button class="btn-icon"
                data-action="edit-term" data-id="${term.id}"
                title="编辑">✏</button>
        <button class="btn-icon danger"
                data-action="del-term"  data-id="${term.id}"
                data-zh="${esc(term.zh)}"
                title="删除">🗑</button>
      </div>
      <div class="term-zh">${hi(term.zh, 'zh')}</div>
      <div class="term-en-row">
        <div class="term-en">${hi(term.en, 'en')}</div>
        <button class="btn-copy"
                data-action="copy" data-en="${esc(term.en)}">复制</button>
      </div>
      <div class="term-meta">
        ${abbrBadge}${catBadge}${sourceBadge}
      </div>
      ${notesBlock}
    </div>`;
}

// ── Event listeners ─────────────────────────────────────────────────────────
function setupEventListeners() {
  // Search
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  searchInput.addEventListener('input', e => {
    searchQuery = e.target.value;
    searchClear.classList.toggle('hidden', !searchQuery);
    renderTerms();
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClear.classList.add('hidden');
    renderTerms();
    searchInput.focus();
  });

  // Add term button (header)
  document.getElementById('add-term-btn').addEventListener('click', openAddModal);

  // Empty-state add button
  document.getElementById('empty-add-btn').addEventListener('click', () => {
    openAddModal();
    if (searchQuery) document.getElementById('field-zh').value = searchQuery;
  });

  // Term modal controls
  document.getElementById('modal-close').addEventListener('click', closeTermModal);
  document.getElementById('form-cancel').addEventListener('click', closeTermModal);
  document.getElementById('term-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeTermModal();
  });
  document.getElementById('term-form').addEventListener('submit', handleTermSubmit);

  // Add category
  document.getElementById('add-category-btn').addEventListener('click', showAddCatInput);
  document.getElementById('cancel-add-category').addEventListener('click', hideAddCatInput);
  document.getElementById('confirm-add-category').addEventListener('click', doAddCategory);
  document.getElementById('new-category-input').addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); doAddCategory(); }
    if (e.key === 'Escape') hideAddCatInput();
  });

  // Confirm dialog
  document.getElementById('confirm-cancel').addEventListener('click', closeConfirm);
  document.getElementById('confirm-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeConfirm();
  });
  document.getElementById('confirm-ok').addEventListener('click', async () => {
    const cb = confirmCallback;
    closeConfirm();
    if (cb) await cb();
  });

  // Global escape key
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    closeTermModal();
    closeConfirm();
    hideAddCatInput();
    cancelEditCat();
  });

  // ── Event delegation: sidebar category list ────────────────────────────
  document.getElementById('category-list').addEventListener('click', e => {
    const btn  = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();

    const { action, id, name, count } = btn.dataset;

    if (action === 'select-cat') {
      selectedCatId = id;
      renderCategories();
      renderTerms();
    } else if (action === 'edit-cat') {
      startEditCat(id, name);
    } else if (action === 'del-cat') {
      confirmDeleteCat(id, name, parseInt(count, 10));
    }
  });

  // ── Event delegation: terms grid ──────────────────────────────────────
  document.getElementById('terms-grid').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const { action, id, zh, en } = btn.dataset;

    if (action === 'edit-term') {
      openEditModal(id);
    } else if (action === 'del-term') {
      confirmDeleteTerm(id, zh);
    } else if (action === 'copy') {
      copyText(en, btn);
    }
  });
}

// ── Term modal ───────────────────────────────────────────────────────────────
function openAddModal() {
  editingTermId = null;
  document.getElementById('modal-title').textContent   = '新增词条';
  document.getElementById('form-submit').textContent   = '保存词条';
  populateCategorySelect('');
  document.getElementById('term-form').reset();
  document.getElementById('term-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('field-zh').focus(), 50);
}

function openEditModal(id) {
  const term = allTerms.find(t => t.id === id);
  if (!term) return;
  editingTermId = id;
  document.getElementById('modal-title').textContent   = '编辑词条';
  document.getElementById('form-submit').textContent   = '保存修改';
  populateCategorySelect(term.category);
  document.getElementById('field-zh').value       = term.zh      || '';
  document.getElementById('field-en').value       = term.en      || '';
  document.getElementById('field-abbr').value     = term.abbr    || '';
  document.getElementById('field-category').value = term.category || '';
  document.getElementById('field-source').value   = term.source  || '';
  document.getElementById('field-notes').value    = term.notes   || '';
  document.getElementById('term-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('field-zh').focus(), 50);
}

function closeTermModal() {
  document.getElementById('term-modal').classList.add('hidden');
  editingTermId = null;
}

function populateCategorySelect(selected) {
  const sel = document.getElementById('field-category');
  const opts = allCategories.map(c =>
    `<option value="${esc(c.name)}" ${c.name === selected ? 'selected' : ''}>${h(c.name)}</option>`
  );
  opts.unshift(`<option value="">请选择分类</option>`);
  opts.push(`<option value="未分类" ${'未分类' === selected ? 'selected' : ''}>未分类</option>`);
  sel.innerHTML = opts.join('');
}

async function handleTermSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('form-submit');
  const origText = btn.textContent;
  btn.textContent = '保存中…';
  btn.disabled = true;

  const payload = {
    zh:       document.getElementById('field-zh').value.trim(),
    en:       document.getElementById('field-en').value.trim(),
    abbr:     document.getElementById('field-abbr').value.trim()   || null,
    category: document.getElementById('field-category').value,
    source:   document.getElementById('field-source').value.trim() || null,
    notes:    document.getElementById('field-notes').value.trim()  || null,
  };

  try {
    if (editingTermId) {
      const { error } = await db.from('terms')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', editingTermId);
      if (error) throw error;
      showToast('词条已更新');
    } else {
      const { error } = await db.from('terms').insert(payload);
      if (error) throw error;
      showToast('词条已新增');
    }
    closeTermModal();
    await loadTerms();
    renderCategories();
    renderTerms();
  } catch (err) {
    console.error(err);
    showToast('保存失败，请重试');
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

// ── Delete term ──────────────────────────────────────────────────────────────
function confirmDeleteTerm(id, zh) {
  openConfirm(
    '确认删除词条',
    `确认删除「${h(zh)}」？此操作不可撤销。`,
    'danger',
    async () => {
      const { error } = await db.from('terms').delete().eq('id', id);
      if (error) { showToast('删除失败，请重试'); return; }
      showToast('词条已删除');
      await loadTerms();
      renderCategories();
      renderTerms();
    }
  );
}

// ── Category CRUD ────────────────────────────────────────────────────────────
function showAddCatInput() {
  document.getElementById('add-category-btn').classList.add('hidden');
  document.getElementById('add-category-input-wrap').classList.remove('hidden');
  document.getElementById('new-category-input').focus();
}
function hideAddCatInput() {
  document.getElementById('add-category-btn').classList.remove('hidden');
  document.getElementById('add-category-input-wrap').classList.add('hidden');
  document.getElementById('new-category-input').value = '';
}

async function doAddCategory() {
  const name = document.getElementById('new-category-input').value.trim();
  if (!name) return;
  if (allCategories.some(c => c.name === name)) {
    showToast('该分类名称已存在'); return;
  }
  const { error } = await db.from('categories').insert({ name });
  if (error) { showToast('添加失败，请重试'); return; }
  showToast(`分类「${name}」已添加`);
  hideAddCatInput();
  await loadCategories();
  renderCategories();
}

// ── Category inline edit ─────────────────────────────────────────────────────
let editingCatOriginalId = null;

function startEditCat(id, currentName) {
  cancelEditCat(); // close any previous inline editor
  editingCatOriginalId = id;
  const item = document.querySelector(
    `#category-list [data-action="select-cat"][data-id="${id}"]`
  );
  if (!item) return;

  item.outerHTML = `
    <div class="category-edit-wrap" data-editing-id="${id}">
      <input class="cat-edit-input"
             data-id="${id}"
             data-original="${esc(currentName)}"
             value="${esc(currentName)}"
             placeholder="分类名称"
             autocomplete="off">
      <button class="btn-confirm" data-action="save-cat-edit" data-id="${id}">✓</button>
      <button class="btn-cancel"  data-action="cancel-cat-edit">✕</button>
    </div>`;

  // Event listeners on the new elements
  const wrap  = document.querySelector(`[data-editing-id="${id}"]`);
  const input = wrap.querySelector('.cat-edit-input');

  wrap.querySelector('[data-action="save-cat-edit"]')
      .addEventListener('click', () => saveCatEdit(id));
  wrap.querySelector('[data-action="cancel-cat-edit"]')
      .addEventListener('click', cancelEditCat);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); saveCatEdit(id); }
    if (e.key === 'Escape') cancelEditCat();
  });

  setTimeout(() => { input.focus(); input.select(); }, 20);
}

function cancelEditCat() {
  editingCatOriginalId = null;
  const wrap = document.querySelector('[data-editing-id]');
  if (wrap) renderCategories();
}

async function saveCatEdit(id) {
  const input    = document.querySelector('.cat-edit-input');
  if (!input) return;
  const newName  = input.value.trim();
  const original = input.dataset.original;

  if (!newName || newName === original) { cancelEditCat(); return; }
  if (allCategories.some(c => c.name === newName)) {
    showToast('该名称已存在'); return;
  }

  const affected = allTerms.filter(t => t.category === original).length;

  const doUpdate = async () => {
    try {
      const { error: e1 } = await db.from('categories')
        .update({ name: newName }).eq('id', id);
      if (e1) throw e1;
      const { error: e2 } = await db.from('terms')
        .update({ category: newName }).eq('category', original);
      if (e2) throw e2;
      showToast(`分类已更新为「${newName}」`);
      editingCatOriginalId = null;
      await Promise.all([loadCategories(), loadTerms()]);
      renderCategories();
      renderTerms();
    } catch (err) {
      console.error(err);
      showToast('更新失败，请重试');
      renderCategories();
    }
  };

  if (affected > 0) {
    openConfirm(
      '确认修改分类名称',
      `修改将同步更新该分类下 ${affected} 条词条，是否继续？`,
      'primary',
      doUpdate
    );
  } else {
    await doUpdate();
  }
}

// ── Delete category ──────────────────────────────────────────────────────────
function confirmDeleteCat(id, name, count) {
  const msg = count > 0
    ? `该分类下有 ${count} 条词条，删除后这些词条将移至「未分类」，是否继续？`
    : `确认删除分类「${name}」？`;
  openConfirm('确认删除分类', msg, 'danger', async () => {
    try {
      if (count > 0) {
        const { error } = await db.from('terms')
          .update({ category: '未分类' }).eq('category', name);
        if (error) throw error;
      }
      const { error } = await db.from('categories').delete().eq('id', id);
      if (error) throw error;
      if (selectedCatId === id) selectedCatId = 'all';
      showToast(`分类「${name}」已删除`);
      await Promise.all([loadCategories(), loadTerms()]);
      renderCategories();
      renderTerms();
    } catch (err) {
      console.error(err);
      showToast('删除失败，请重试');
    }
  });
}

// ── Confirm dialog ───────────────────────────────────────────────────────────
function openConfirm(title, message, type, callback) {
  document.getElementById('confirm-title').textContent   = title;
  document.getElementById('confirm-message').innerHTML   = message;
  const okBtn = document.getElementById('confirm-ok');
  okBtn.className = type === 'danger' ? 'btn btn-danger' : 'btn btn-primary';
  okBtn.textContent = type === 'danger' ? '确认删除' : '确认';
  confirmCallback = callback;
  document.getElementById('confirm-overlay').classList.remove('hidden');
}

function closeConfirm() {
  document.getElementById('confirm-overlay').classList.add('hidden');
  confirmCallback = null;
  // If we were in category edit mode, re-render to restore the list
  if (editingCatOriginalId) {
    editingCatOriginalId = null;
    renderCategories();
  }
}

// ── Clipboard ────────────────────────────────────────────────────────────────
function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '已复制 ✓';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = '复制';
      btn.classList.remove('copied');
    }, 1500);
  }).catch(() => showToast('复制失败'));
}

// ── Toast ────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

// ── Utilities ────────────────────────────────────────────────────────────────
/** Escape for HTML content (innerHTML) */
function h(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape for HTML attribute values */
function esc(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Apply Fuse.js match highlight indices */
function applyHighlight(text, indices) {
  if (!indices || !indices.length) return h(text);
  let result = '';
  let last = 0;
  indices.forEach(([s, e]) => {
    result += h(text.slice(last, s));
    result += `<mark class="hl">${h(text.slice(s, e + 1))}</mark>`;
    last = e + 1;
  });
  result += h(text.slice(last));
  return result;
}

// ── Start ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
