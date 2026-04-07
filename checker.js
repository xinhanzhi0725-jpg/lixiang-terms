/* ─────────────────────────────────────────────────────────────────────────
   checker.js — 英文术语核查工具
   依赖 app.js 中的全局变量：allTerms、showToast、h()、esc()
   ───────────────────────────────────────────────────────────────────────── */

// ── State ────────────────────────────────────────────────────────────────────
let checkerText   = '';
let checkerIssues = [];
// issueStates: { [id]: 'pending' | 'resolved' | 'ignored' }
let issueStates   = {};

// ── Init ─────────────────────────────────────────────────────────────────────
function initChecker() {
  // Char counter
  document.getElementById('checker-input').addEventListener('input', e => {
    const len = e.target.value.length;
    document.getElementById('checker-char-count').textContent =
      len > 0 ? `${len} 字符` : '';
  });

  // Run button
  document.getElementById('checker-run-btn').addEventListener('click', runChecker);

  // Toolbar buttons
  document.getElementById('checker-reset-btn').addEventListener('click', resetChecker);
  document.getElementById('checker-copy-btn').addEventListener('click', copyCheckerResult);

  // Issue list: event delegation
  document.getElementById('checker-issue-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, issueid } = btn.dataset;
    if (action === 'replace') applyReplace(issueid);
    if (action === 'ignore')  applyIgnore(issueid);
  });

  // Click highlight → scroll to issue card
  document.getElementById('checker-display').addEventListener('click', e => {
    const mark = e.target.closest('.issue-mark[data-issueid]');
    if (!mark) return;
    const card = document.querySelector(`.issue-card[data-cardid="${mark.dataset.issueid}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      card.classList.add('issue-card-flash');
      setTimeout(() => card.classList.remove('issue-card-flash'), 700);
    }
  });
}

// ── Run ──────────────────────────────────────────────────────────────────────
async function runChecker() {
  const text = document.getElementById('checker-input').value;
  if (!text.trim()) { showToast('请先输入需要核查的英文内容'); return; }

  if (text.length > 5000) showToast('文本较长，建议分段核查以保证准确率');

  const btn = document.getElementById('checker-run-btn');
  btn.textContent = '核查中…';
  btn.disabled = true;

  checkerText = text;
  issueStates = {};

  try {
    const [termIssues, spellIssues] = await Promise.all([
      runTermCheck(text),
      runSpellCheck(text),
    ]);

    checkerIssues = mergeIssues(termIssues, spellIssues);
    checkerIssues.forEach(i => { issueStates[i.id] = 'pending'; });

    // Switch to result view
    document.getElementById('checker-input-state').classList.add('hidden');
    document.getElementById('checker-result-state').classList.remove('hidden');
    renderDisplay();
    renderIssueList();
  } catch (err) {
    console.error('核查失败:', err);
    showToast('核查失败，请稍后重试');
  } finally {
    btn.textContent = '开始核查';
    btn.disabled = false;
  }
}

// ── Term check ────────────────────────────────────────────────────────────────
function runTermCheck(text) {
  const issues = [];

  // Build flat list of {official, zh} from knowledge base
  const termList = [];
  allTerms.forEach(t => {
    if (t.en   && t.en.trim().length   >= 2) termList.push({ official: t.en.trim(),   zh: t.zh });
    if (t.abbr && t.abbr.trim().length >= 2) termList.push({ official: t.abbr.trim(), zh: t.zh });
  });

  // Deduplicate by official term
  const seen = new Set();
  const unique = termList.filter(({ official }) => {
    if (seen.has(official.toLowerCase())) return false;
    seen.add(official.toLowerCase());
    return true;
  });

  // Longer terms first to avoid overlapping shorter matches
  unique.sort((a, b) => b.official.length - a.official.length);

  const occupied = new Set(); // char positions already claimed

  unique.forEach(({ official, zh }) => {
    // Build word-boundary-aware regex
    const escaped = official.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex   = new RegExp(
      '(?<![A-Za-z0-9])' + escaped + '(?![A-Za-z0-9])',
      'gi'
    );

    let m;
    while ((m = regex.exec(text)) !== null) {
      const found = m[0];
      const start = m.index;
      const end   = start + found.length;

      // Skip if overlapping with an already-matched range
      let overlap = false;
      for (let i = start; i < end; i++) {
        if (occupied.has(i)) { overlap = true; break; }
      }
      if (overlap) continue;

      // Exact match → no issue
      if (found === official) continue;

      const id = `term-${start}-${found.length}`;
      issues.push({
        id, type: 'capitalization',
        offset: start, length: found.length,
        found, suggestion: official,
        zh,
      });

      for (let i = start; i < end; i++) occupied.add(i);
    }
  });

  return issues;
}

// ── Spell check (LanguageTool) ───────────────────────────────────────────────
async function runSpellCheck(text) {
  let data;
  try {
    const res = await fetch('https://api.languagetool.org/v2/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ text, language: 'en-US' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.warn('LanguageTool 不可用，跳过拼写检查:', err);
    showToast('通用拼写检查暂不可用，仅执行术语核查');
    return [];
  }

  // Build whitelist: all words from knowledge-base en / abbr fields
  const whitelist = new Set([
    // Common Li Auto proper nouns that LanguageTool doesn't know
    'li','mega','erev','bev','noa','hpc','fota','ota','nvh','sic',
    'lidar','aeb','vla','vlm','mindgpt','orin','cltc','cncap','ciasi',
    'cahi','reev','lfp','hud','adas','phev','nev','suv','mpv','mpvs',
    'intelligentization','xiang','tong','xue','qilin',
  ]);
  allTerms.forEach(t => {
    if (t.en)   t.en.split(/\s+/).forEach(w => whitelist.add(w.toLowerCase().replace(/\W/g, '')));
    if (t.abbr) whitelist.add(t.abbr.toLowerCase().replace(/\W/g, ''));
  });

  return (data.matches || [])
    .filter(m => {
      if (m.rule.issueType !== 'misspelling')        return false;
      if (!m.replacements || !m.replacements.length) return false;
      const word = text.slice(m.offset, m.offset + m.length)
                       .toLowerCase().replace(/\W/g, '');
      if (whitelist.has(word)) return false;
      return true;
    })
    .map(m => ({
      id:         `spell-${m.offset}-${m.length}`,
      type:       'spelling',
      offset:     m.offset,
      length:     m.length,
      found:      text.slice(m.offset, m.offset + m.length),
      suggestion: m.replacements[0].value,
      zh:         null,
    }));
}

// ── Merge ────────────────────────────────────────────────────────────────────
function mergeIssues(termIssues, spellIssues) {
  // Term issues take priority; remove spell issues that overlap them
  const termRanges = termIssues.map(i => [i.offset, i.offset + i.length]);
  const filteredSpell = spellIssues.filter(s => {
    const se = s.offset + s.length;
    return !termRanges.some(([a, b]) => s.offset < b && se > a);
  });
  return [...termIssues, ...filteredSpell].sort((a, b) => a.offset - b.offset);
}

// ── Render: highlighted display ───────────────────────────────────────────────
function renderDisplay() {
  const display = document.getElementById('checker-display');
  let html = '';
  let last = 0;

  checkerIssues.forEach(issue => {
    if (issue.offset < last) return; // skip overlapping
    // Normal text before this issue
    html += h(checkerText.slice(last, issue.offset));

    const state = issueStates[issue.id];
    if (state === 'pending') {
      const cls = issue.type === 'spelling' ? 'mark-red' : 'mark-yellow';
      html += `<mark class="issue-mark ${cls}" data-issueid="${issue.id}">${h(issue.found)}</mark>`;
    } else if (state === 'resolved') {
      html += `<span class="mark-resolved">${h(issue.suggestion)}</span>`;
    } else {
      // ignored — plain text
      html += h(issue.found);
    }
    last = issue.offset + issue.length;
  });

  html += h(checkerText.slice(last));
  // Preserve line breaks
  display.innerHTML = html.replace(/\n/g, '<br>');
}

// ── Render: issue list ────────────────────────────────────────────────────────
function renderIssueList() {
  const list    = document.getElementById('checker-issue-list');
  const summary = document.getElementById('checker-issue-summary');
  const allDone = document.getElementById('checker-all-done');

  const total   = checkerIssues.length;
  const pending = checkerIssues.filter(i => issueStates[i.id] === 'pending');

  // Summary line
  summary.classList.remove('hidden');
  if (total === 0) {
    summary.className = 'issue-summary no-issues';
    summary.textContent = '✓ 未发现问题';
    list.innerHTML = '';
    allDone.classList.add('hidden');
    return;
  }

  summary.className = 'issue-summary has-issues';
  summary.textContent =
    `共发现 ${total} 处问题` +
    (pending.length < total ? `，已处理 ${total - pending.length} 处` : '');

  if (pending.length === 0) {
    list.innerHTML = '';
    allDone.classList.remove('hidden');
    return;
  }
  allDone.classList.add('hidden');

  list.innerHTML = pending.map(issue => {
    const typeLabel = issue.type === 'spelling'       ? '拼写错误' : '术语写法';
    const typeCls   = issue.type === 'spelling'       ? 'type-red' : 'type-yellow';
    const zhNote    = issue.zh
      ? `<div class="issue-zh">对应中文：${h(issue.zh)}</div>` : '';

    return `
      <div class="issue-card" data-cardid="${issue.id}">
        <div class="issue-card-header">
          <span class="issue-type ${typeCls}">${typeLabel}</span>
          <span class="issue-found" title="${esc(issue.found)}">${h(issue.found)}</span>
        </div>
        <div class="issue-suggestion">→ ${h(issue.suggestion)}</div>
        ${zhNote}
        <div class="issue-card-actions">
          <button class="btn-replace" data-action="replace" data-issueid="${issue.id}">替换</button>
          <button class="btn-ignore"  data-action="ignore"  data-issueid="${issue.id}">忽略</button>
        </div>
      </div>`;
  }).join('');
}

// ── Replace / Ignore ──────────────────────────────────────────────────────────
function applyReplace(id) {
  const issue = checkerIssues.find(i => i.id === id);
  if (!issue) return;
  issueStates[id] = 'resolved';
  renderDisplay();
  renderIssueList();
}

function applyIgnore(id) {
  issueStates[id] = 'ignored';
  renderDisplay();
  renderIssueList();
}

// ── Copy result ───────────────────────────────────────────────────────────────
function copyCheckerResult() {
  // Apply resolved replacements right-to-left to preserve offsets
  const resolved = checkerIssues
    .filter(i => issueStates[i.id] === 'resolved')
    .sort((a, b) => b.offset - a.offset);

  let result = checkerText;
  resolved.forEach(issue => {
    result =
      result.slice(0, issue.offset) +
      issue.suggestion +
      result.slice(issue.offset + issue.length);
  });

  navigator.clipboard.writeText(result).then(() => {
    showToast('已复制修改后的文本');
    const btn = document.getElementById('checker-copy-btn');
    const orig = btn.textContent;
    btn.textContent = '已复制 ✓';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }).catch(() => showToast('复制失败，请手动复制'));
}

// ── Reset ─────────────────────────────────────────────────────────────────────
function resetChecker() {
  checkerText   = '';
  checkerIssues = [];
  issueStates   = {};

  document.getElementById('checker-input').value = '';
  document.getElementById('checker-char-count').textContent = '';
  document.getElementById('checker-input-state').classList.remove('hidden');
  document.getElementById('checker-result-state').classList.add('hidden');
  document.getElementById('checker-issue-summary').classList.add('hidden');
  document.getElementById('checker-issue-list').innerHTML = '';
  document.getElementById('checker-all-done').classList.add('hidden');
  document.getElementById('checker-display').innerHTML = '';
}
