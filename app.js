'use strict';

/* ================================================================
 * 纯逻辑部分（不依赖 DOM，可在 Node 中直接测试）
 * ================================================================ */

/** Minecraft 单位：1 组 = 64 个，1 潜影盒 = 27 组 = 1728 个 */
const MINECRAFT = { STACK: 64, SHULKER_STACKS: 27 };
MINECRAFT.SHULKER = MINECRAFT.STACK * MINECRAFT.SHULKER_STACKS;

/**
 * 把组数折算为「盒 + 余组」：盒数向下取整，余组 = 组数 mod 27。
 * 例：30 组 → 1 盒 3 组；9 组 → 0 盒 9 组。
 */
function toBoxes(stacks) {
  return {
    shulker: Math.floor(stacks / MINECRAFT.SHULKER_STACKS),
    remainderStacks: stacks % MINECRAFT.SHULKER_STACKS,
  };
}

/**
 * 组数按 0.5 步长取整：64 为 1 组，96 为 1.5 组，128 为 2 组。
 * 规则：整组 = floor(n ÷ 64)；余数 r = n mod 64：
 *   r = 0      → 不加
 *   0 < r ≤ 32 → +0.5 组
 *   r > 32     → +1 组
 * 例：385 → 6.5 组；112 → 2 组。
 */
function stacksOf(need) {
  const whole = Math.floor(need / MINECRAFT.STACK);
  const rem = need % MINECRAFT.STACK;
  const extra = rem === 0 ? 0 : (rem <= MINECRAFT.STACK / 2 ? 0.5 : 1);
  return whole + extra;
}

/** 组数显示：整数不带小数，半组显示一位小数（如 6.5） */
function formatStacks(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 例如 30 组 → "1 盒 3 组"，30.5 组 → "1 盒 3.5 组"，9 组 → "0 盒 9 组" */
function boxLabel(stacks) {
  const b = toBoxes(stacks);
  return `${b.shulker} 盒 ${formatStacks(b.remainderStacks)} 组`;
}

/**
 * 解析 CSV 文本。
 * 支持：引号包裹的字段（含内部逗号）、"" 转义、BOM、CRLF、空行。
 */
function parseCSV(text) {
  const src = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => String(f).trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((f) => String(f).trim() !== '')) rows.push(row);
  }
  return rows;
}

/** 将字段清洗为整数；无法解析返回 null */
function toInt(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  const digits = String(v).replace(/\D/g, '');
  return digits === '' ? null : parseInt(digits, 10);
}

/**
 * 解析 Available 列（已有数量）。
 * 兼容 "0, 0.68 SB" 这类带附加标注的字段：取第一个逗号前的内容中的整数。
 */
function toAvailable(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
  const first = String(v).split(',')[0];
  const m = first.match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

/**
 * 从解析出的行中提取材料列表。
 * 读取前四列：Item / Total / Missing / Available；
 * 还需准备的数量 = Missing − Available（不小于 0），后续所有换算都基于它。
 * 第 4 列之后的多余字段（如 "0.68 SB"）一律忽略；表头行（Total 不是数字）自动跳过。
 */
function toItems(rows) {
  const items = [];
  for (const f of rows) {
    if (!Array.isArray(f) || f.length < 3) continue;
    const name = String(f[0]).trim();
    const total = toInt(f[1]);
    const missing = toInt(f[2]);
    if (!name || total === null || missing === null) continue;
    const available = toAvailable(f[3]);
    const need = Math.max(0, missing - available);
    const stacks = stacksOf(need);
    items.push({ name, total, missing, available, need, stacks, ...toBoxes(stacks) });
  }
  return items;
}

/** 汇总统计（基于需准备数量 need） */
function summarize(items) {
  const need = items.reduce((s, i) => s + i.need, 0);
  const total = items.reduce((s, i) => s + i.total, 0);
  const stacks = stacksOf(need);
  return {
    kinds: items.length,
    need,
    stacks,
    ...toBoxes(stacks),
    donePct: total > 0 ? Math.round((1 - need / total) * 100) : null,
  };
}

/** 千分位格式化 */
function fmt(n) {
  return Number(n).toLocaleString('zh-CN');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MINECRAFT, parseCSV, toItems, summarize, toBoxes, boxLabel, toAvailable, stacksOf, formatStacks, fmt };
}

/* ================================================================
 * DOM 部分（仅在浏览器中运行）
 * ================================================================ */

if (typeof document !== 'undefined') {
  document.documentElement.classList.add('js');
  document.addEventListener('DOMContentLoaded', init);
}

function init() {
  const $ = (sel) => document.querySelector(sel);

  const dropzone = $('#dropzone');
  const fileInput = $('#fileInput');
  const pastePanel = $('#pastePanel');
  const pasteArea = $('#pasteArea');
  const errorBox = $('#errorBox');
  const result = $('#result');
  const fileNameEl = $('#fileName');
  const statKinds = $('#statKinds');
  const statMissing = $('#statMissing');
  const statStacks = $('#statStacks');
  const statShulker = $('#statShulker');
  const statDone = $('#statDone');
  const searchInput = $('#search');
  const sortSelect = $('#sort');
  const countLine = $('#countLine');
  const grid = $('#grid');

  let allItems = [];
  let query = '';
  let sortKey = 'need';

  /* ---------------- 预览图 ---------------- */

  let previewMap = {};
  fetch('previews.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : {}))
    .then((m) => {
      previewMap = m && typeof m === 'object' ? m : {};
      if (allItems.length) renderGrid();
    })
    .catch(() => {});

  /**
   * 图片候选顺序：
   * 1. previews.json 中为该材料配置的图片（相对 images/ 或外链）；
   * 2. 默认约定 images/<材料名>.png / .webp / .jpg / .jpeg。
   */
  function imageCandidates(item) {
    const mapped = previewMap[item.name];
    if (typeof mapped === 'string' && mapped.trim()) {
      const v = mapped.trim();
      return /^(https?:|data:)/i.test(v) ? [v] : ['images/' + v];
    }
    const base = 'images/' + encodeURIComponent(item.name);
    return [base + '.png', base + '.webp', base + '.jpg', base + '.jpeg'];
  }

  /** 生成缩略图：有图显示图，无图显示首字占位块 */
  function createThumb(item) {
    const wrap = document.createElement('div');
    wrap.className = 'thumb';

    const img = document.createElement('img');
    img.alt = '';

    const mono = document.createElement('span');
    mono.className = 'monogram';
    mono.textContent = Array.from(item.name)[0] || '?';
    mono.hidden = true;

    wrap.append(img, mono);

    const candidates = imageCandidates(item);
    let idx = 0;
    (function tryNext() {
      if (idx >= candidates.length) {
        img.remove();
        mono.hidden = false;
        return;
      }
      img.onerror = () => { img.onerror = null; tryNext(); };
      img.src = candidates[idx++];
    })();

    return wrap;
  }

  /* ---------------- 收集完成勾选 ---------------- */

  const DONE_KEY = 'litematica-material-done';
  const CHECK_SVG =
    '<svg viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M52 136l56 56 96-120"></path></svg>';

  let doneSet = new Set();
  try {
    const raw = localStorage.getItem(DONE_KEY);
    if (raw) doneSet = new Set(JSON.parse(raw));
  } catch (e) {
    doneSet = new Set();
  }

  function saveDone() {
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify([...doneSet]));
    } catch (e) {
      /* 存储不可用时静默忽略 */
    }
  }

  /** 切换某张卡片的完成状态（背景变浅绿）；需准备为 0 的材料自动完成，不可取消 */
  function toggleDone(li, item) {
    if (item.need === 0) return;
    const isDone = li.classList.toggle('done');
    const btn = li.querySelector('.check');
    if (btn) btn.setAttribute('aria-pressed', String(isDone));
    if (isDone) doneSet.add(item.name);
    else doneSet.delete(item.name);
    saveDone();
  }

  /* ---------------- 渲染 ---------------- */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function visibleItems() {
    const q = query.trim();
    const list = q ? allItems.filter((i) => i.name.includes(q)) : allItems.slice();
    if (sortKey === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    } else if (sortKey === 'total') {
      list.sort((a, b) => b.total - a.total || b.need - a.need);
    } else {
      list.sort((a, b) => b.need - a.need || a.name.localeCompare(b.name, 'zh-CN'));
    }
    return list;
  }

  function renderGrid() {
    const list = visibleItems();
    grid.innerHTML = '';

    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = query.trim() ? `没有匹配「${query.trim()}」的材料` : '没有材料数据';
      grid.appendChild(li);
      return;
    }

    const frag = document.createDocumentFragment();
    list.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'card';
      li.style.setProperty('--index', Math.min(i, 12));

      const top = document.createElement('div');
      top.className = 'card-top';
      top.appendChild(createThumb(item));

      const info = document.createElement('div');
      const nameEl = document.createElement('h3');
      nameEl.className = 'card-name';
      nameEl.textContent = item.name;
      const meta = document.createElement('p');
      meta.className = 'card-meta';
      meta.textContent = `缺口 ${fmt(item.missing)} · 已有 ${fmt(item.available)}`;
      info.append(nameEl, meta);
      top.appendChild(info);

      const autoDone = item.need === 0;              // 需准备为 0 → 自动视为收集完成
      const isDone = doneSet.has(item.name) || autoDone;

      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'check';
      check.setAttribute('aria-label', `标记 ${item.name} 收集完成`);
      check.setAttribute('aria-pressed', String(isDone));
      check.innerHTML = CHECK_SVG;
      check.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDone(li, item);
      });
      top.appendChild(check);

      li.addEventListener('click', () => toggleDone(li, item));
      if (isDone) li.classList.add('done');
      if (autoDone) li.classList.add('auto-done');

      const foot = document.createElement('div');
      foot.className = 'card-foot';
      const cells = [
        [fmt(item.need), '需准备 · 个'],
        [`${formatStacks(item.stacks)} 组`, '64 个/组 · 0.5 步取整'],
        [boxLabel(item.stacks), '27 组/盒 · 下取整'],
      ];
      for (const [num, lbl] of cells) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        const numEl = document.createElement('span');
        numEl.className = 'num';
        numEl.textContent = num;
        const lblEl = document.createElement('span');
        lblEl.className = 'lbl';
        lblEl.textContent = lbl;
        cell.append(numEl, lblEl);
        foot.appendChild(cell);
      }

      li.append(top, foot);
      frag.appendChild(li);
    });
    grid.appendChild(frag);
  }

  /** 数字滚动动画；format 可自定义显示格式，step 为递增步长（如 0.5） */
  function countUp(el, target, format, step = 1) {
    const start = performance.now();
    const dur = 480;
    (function stepFn(now) {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = Math.round((target * eased) / step) * step;
      el.textContent = format ? format(val) : fmt(val);
      if (p < 1) requestAnimationFrame(stepFn);
    })(start);
  }

  function renderStats() {
    const s = summarize(allItems);
    countUp(statKinds, s.kinds);
    countUp(statMissing, s.need);
    countUp(statStacks, s.stacks, formatStacks, 0.5);
    countUp(statShulker, s.stacks, boxLabel, 0.5);
    statDone.textContent = s.donePct === null ? '—' : s.donePct + '%';
    countLine.textContent = `共 ${allItems.length} 种材料`;
  }

  function showResult(fileName) {
    dropzone.style.display = 'none';
    pastePanel.hidden = true;
    errorBox.classList.remove('show');
    fileNameEl.textContent = fileName;
    result.classList.add('show');
    renderStats();
    renderGrid();
  }

  function showError(message) {
    result.classList.remove('show');
    pastePanel.hidden = true;
    errorBox.textContent = message;
    errorBox.classList.add('show');
  }

  function reset() {
    allItems = [];
    query = '';
    searchInput.value = '';
    sortSelect.value = 'need';
    result.classList.remove('show');
    errorBox.classList.remove('show');
    dropzone.style.display = '';
  }

  function parseAndRender(text, fileName) {
    try {
      const rows = parseCSV(text);
      const items = toItems(rows);
      if (!items.length) throw new Error('没有从 CSV 中解析到任何材料数据，请检查文件内容与格式。');
      allItems = items;
      showResult(fileName);
    } catch (err) {
      showError(`解析失败：${err.message}`);
    }
  }

  async function loadFile(file) {
    try {
      const text = await file.text();
      parseAndRender(text, file.name || 'materials.csv');
    } catch (err) {
      showError(`读取文件失败：${err.message}`);
    }
  }

  /* ---------------- 事件 ---------------- */

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) loadFile(fileInput.files[0]);
    fileInput.value = '';
  });

  ['dragover', 'drop'].forEach((ev) =>
    document.addEventListener(ev, (e) => e.preventDefault())
  );
  dropzone.addEventListener('dragover', () => dropzone.classList.add('drag'));
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', (e) => {
    dropzone.classList.remove('drag');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  $('#pickBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });
  $('#pasteBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    pastePanel.hidden = false;
    pasteArea.focus();
  });
  $('#cancelPasteBtn').addEventListener('click', () => {
    pastePanel.hidden = true;
    pasteArea.value = '';
  });
  $('#parsePasteBtn').addEventListener('click', () => {
    const text = pasteArea.value.trim();
    if (!text) return;
    parseAndRender(text, '粘贴的 CSV');
  });
  pasteArea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#parsePasteBtn').click();
    }
  });

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    renderGrid();
  });
  sortSelect.addEventListener('change', () => {
    sortKey = sortSelect.value;
    renderGrid();
  });
  $('#resetBtn').addEventListener('click', reset);

  /* ---------------- 滚动入场（IntersectionObserver） ---------------- */

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}
