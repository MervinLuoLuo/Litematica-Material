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

  /* ---------------- 元素引用 ---------------- */

  const errorBox = $('#errorBox');
  const dropzone = $('#dropzone');
  const fileInput = $('#fileInput');
  const result = $('#result');
  const archiveSelect = $('#archiveSelect');
  const newArchiveBtn = $('#newArchiveBtn');
  const archiveNameEl = $('#archiveName');
  const archiveDescEl = $('#archiveDesc');
  const editArchiveBtn = $('#editArchiveBtn');
  const deleteArchiveBtn = $('#deleteArchiveBtn');
  const modeBadge = $('#modeBadge');
  const statKinds = $('#statKinds');
  const statMissing = $('#statMissing');
  const statStacks = $('#statStacks');
  const statShulker = $('#statShulker');
  const statDone = $('#statDone');
  const searchInput = $('#search');
  const filterSelect = $('#filter');
  const sortSelect = $('#sort');
  const countLine = $('#countLine');
  const grid = $('#grid');
  const modalOverlay = $('#modalOverlay');
  const modalTitle = $('#modalTitle');
  const modalName = $('#modalName');
  const modalDesc = $('#modalDesc');
  const modalCsv = $('#modalCsv');
  const modalError = $('#modalError');
  const modalUploadBtn = $('#modalUploadBtn');
  const modalFileInput = $('#modalFileInput');
  const modalCancelBtn = $('#modalCancelBtn');
  const modalSaveBtn = $('#modalSaveBtn');

  /* ---------------- 状态 ---------------- */

  const LAST_KEY = 'litematica-last-archive'; // 仅记录上次打开的档案 id（偏好，非业务数据）

  let archives = [];
  let currentArchive = null; // 当前档案（含 csv / done）
  let allItems = [];
  let query = '';
  let filterKey = 'all';
  let sortKey = 'need';
  let doneSet = new Set();
  let editingId = null;

  /* ---------------- 存储层（服务器 / 本地降级） ---------------- */

  /**
   * API 地址配置（优先级：URL 参数 ?api= > window.API_BASE / window.__API_BASE__ > 同源 ''）
   * 例如把前端部署在 GitHub Pages、后端部署在云服务时：
   *   访问地址带 ?api=https://your-app.onrender.com
   *   或在加载 app.js 前设置 window.API_BASE = 'https://your-app.onrender.com'
   */
  const API_BASE = (function () {
    const fromQuery = new URLSearchParams(location.search).get('api');
    const base = fromQuery || window.__API_BASE__ || window.API_BASE || '';
    return base.replace(/\/+$/, '');
  })();

  const LOCAL_KEY = 'litematica-archives-local'; // 静态托管（如 GitHub Pages）时的本地档案存储

  function localLoad() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function localSave(list) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
    } catch (e) {
      /* 存储不可用时静默忽略 */
    }
  }

  function localId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  async function serverFetch(path, options = {}) {
    const res = await fetch(API_BASE + path, options);
    if (!res.ok) {
      let msg = `请求失败（${res.status}）`;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) { /* 忽略 */ }
      throw new Error(msg);
    }
    return res.json();
  }

  /** 档案存储抽象：同一套接口，服务器可用走服务器，否则降级到 localStorage */
  const storage = {
    mode: 'server', // 'server' | 'local'

    async list() {
      if (this.mode === 'local') {
        return localLoad().map(({ csv, done, ...rest }) => rest);
      }
      return serverFetch('/api/archives');
    },

    async get(id) {
      if (this.mode === 'local') {
        const a = localLoad().find((x) => x.id === id);
        if (!a) throw new Error('档案不存在');
        return a;
      }
      return serverFetch(`/api/archives/${encodeURIComponent(id)}`);
    },

    async create(data) {
      if (this.mode === 'local') {
        const list = localLoad();
        const archive = {
          id: localId(),
          name: data.name,
          description: data.description || '',
          csv: data.csv,
          done: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        list.push(archive);
        localSave(list);
        return archive;
      }
      return serverFetch('/api/archives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },

    async update(id, data) {
      if (this.mode === 'local') {
        const list = localLoad();
        const a = list.find((x) => x.id === id);
        if (!a) throw new Error('档案不存在');
        Object.assign(a, data, { updatedAt: Date.now() });
        localSave(list);
        return a;
      }
      return serverFetch(`/api/archives/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },

    async remove(id) {
      if (this.mode === 'local') {
        localSave(localLoad().filter((x) => x.id !== id));
        return { ok: true };
      }
      return serverFetch(`/api/archives/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    async setDone(id, done) {
      if (this.mode === 'local') {
        const list = localLoad();
        const a = list.find((x) => x.id === id);
        if (!a) throw new Error('档案不存在');
        a.done = done;
        a.updatedAt = Date.now();
        localSave(list);
        return { ok: true, done };
      }
      return serverFetch(`/api/archives/${encodeURIComponent(id)}/done`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done }),
      });
    },
  };

  /** 探测后端是否可用：可用 → 服务器模式；否则自动降级为本地存储模式 */
  async function detectMode() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(API_BASE + '/api/archives', { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        storage.mode = 'server';
        return true;
      }
      throw new Error('接口不可用');
    } catch (e) {
      storage.mode = 'local';
      return false;
    }
  }

  /* ---------------- 预览图 ---------------- */

  let previewMap = {};
  fetch('previews.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : {}))
    .then((m) => {
      previewMap = m && typeof m === 'object' ? m : {};
      if (allItems.length) renderGrid({ moves: true });
    })
    .catch(() => {});

  /** 图片候选顺序：previews.json 映射 → images/<材料名>.png/.webp/.jpg/.jpeg */
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

  /* ---------------- 收集完成（同步到服务器） ---------------- */

  const CHECK_SVG =
    '<svg viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M52 136l56 56 96-120"></path></svg>';

  /** 判断材料是否视为收集完成（手动勾选或需准备为 0 自动完成） */
  function isItemDone(item) {
    return item.need === 0 || doneSet.has(item.name);
  }

  /** 切换完成状态：立即更新界面，异步同步到服务器 */
  function toggleDone(item) {
    if (item.need === 0) return;
    if (doneSet.has(item.name)) doneSet.delete(item.name);
    else doneSet.add(item.name);
    saveDone();
    renderGrid({ moves: true });
  }

  async function saveDone() {
    if (!currentArchive) return;
    try {
      await storage.setDone(currentArchive.id, [...doneSet]);
      hideError();
    } catch (e) {
      showError(`同步收集进度失败：${e.message}`);
    }
  }

  /* ---------------- 渲染 ---------------- */

  function visibleItems() {
    const q = query.trim();
    let list = q ? allItems.filter((i) => i.name.includes(q)) : allItems.slice();
    if (filterKey === 'done') {
      list = list.filter((i) => isItemDone(i));
    } else if (filterKey === 'undone') {
      list = list.filter((i) => !isItemDone(i));
    }
    if (sortKey === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    } else if (sortKey === 'total') {
      list.sort((a, b) => b.total - a.total || b.need - a.need);
    } else {
      list.sort((a, b) => b.need - a.need || a.name.localeCompare(b.name, 'zh-CN'));
    }
    // 已收集完成的材料固定排到列表最下方（组内保持相对顺序）
    return list
      .filter((i) => !isItemDone(i))
      .concat(list.filter((i) => isItemDone(i)));
  }

  /**
   * 渲染材料网格。
   * moves=true 时使用 FLIP 动画平滑过渡（勾选沉底、搜索、排序、筛选）。
   */
  function renderGrid({ moves = false } = {}) {
    const prev = new Map();
    if (moves) {
      grid.querySelectorAll('.card').forEach((el) => {
        prev.set(el.dataset.name, el.getBoundingClientRect().top);
      });
    }

    const list = visibleItems();
    countLine.textContent = `共 ${list.length} 种材料`;
    grid.innerHTML = '';

    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = query.trim()
        ? `没有匹配「${query.trim()}」的材料`
        : (filterKey !== 'all' ? '没有符合条件的材料' : '没有材料数据');
      grid.appendChild(li);
      return;
    }

    const frag = document.createDocumentFragment();
    list.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'card';
      li.dataset.name = item.name;
      if (moves) li.classList.add('instant');
      else li.style.setProperty('--index', Math.min(i, 12));

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
      const isDone = isItemDone(item);

      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'check';
      check.setAttribute('aria-label', `标记 ${item.name} 收集完成`);
      check.setAttribute('aria-pressed', String(isDone));
      check.innerHTML = CHECK_SVG;
      check.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDone(item);
      });
      top.appendChild(check);

      li.addEventListener('click', () => toggleDone(item));
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

    /* FLIP：把每张卡片从旧位置平滑过渡到新位置 */
    if (moves) {
      grid.querySelectorAll('.card').forEach((el) => {
        const from = prev.get(el.dataset.name);
        if (from === undefined) return;
        const dy = from - el.getBoundingClientRect().top;
        if (dy === 0) return;
        el.style.transform = `translateY(${dy}px)`;
        el.getBoundingClientRect(); // 强制回流，确保初始位移生效
        el.style.transition = 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)';
        el.style.transform = '';
        el.addEventListener('transitionend', () => { el.style.transition = ''; }, { once: true });
      });
    }
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
  }

  /* ---------------- 视图切换 ---------------- */

  function showResult() {
    dropzone.style.display = 'none';
    archiveNameEl.textContent = currentArchive.name;
    archiveDescEl.textContent = currentArchive.description || '';
    archiveDescEl.hidden = !currentArchive.description;
    result.classList.add('show');
    renderStats();
    renderGrid();
  }

  function showEmpty() {
    result.classList.remove('show');
    dropzone.style.display = '';
    allItems = [];
    currentArchive = null;
    doneSet = new Set();
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add('show');
  }

  function hideError() {
    errorBox.classList.remove('show');
  }

  /* ---------------- 档案管理 ---------------- */

  function renderArchiveSelect(selectedId) {
    archiveSelect.innerHTML = '';
    if (!archives.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '暂无档案';
      archiveSelect.appendChild(opt);
      archiveSelect.disabled = true;
      return;
    }
    archiveSelect.disabled = false;
    for (const a of archives) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name;
      if (a.id === selectedId) opt.selected = true;
      archiveSelect.appendChild(opt);
    }
  }

  async function refreshArchiveList(selectedId) {
    try {
      archives = await storage.list();
      renderArchiveSelect(selectedId);
    } catch (e) {
      showError(`获取档案列表失败：${e.message}`);
    }
  }

  function parseItems(text) {
    const rows = parseCSV(text);
    const items = toItems(rows);
    if (!items.length) throw new Error('没有从 CSV 中解析到任何材料数据，请检查内容格式');
    return items;
  }

  async function selectArchive(id) {
    try {
      const a = await storage.get(id);
      currentArchive = a;
      doneSet = new Set(a.done || []);
      allItems = parseItems(a.csv);
      localStorage.setItem(LAST_KEY, id);
      hideError();
      showResult();
    } catch (e) {
      showError(`加载档案失败：${e.message}`);
    }
  }

  async function initArchives() {
    const isServer = await detectMode();
    modeBadge.textContent = isServer ? '服务端缓存模式' : '本地缓存模式';
    modeBadge.classList.toggle('local', !isServer);
    modeBadge.hidden = false;
    try {
      archives = await storage.list();
      renderArchiveSelect(null);
      const urlId = new URLSearchParams(location.search).get('a');
      let target = urlId || localStorage.getItem(LAST_KEY) || '';
      if (!archives.some((a) => a.id === target)) {
        target = archives.length ? archives[0].id : '';
      }
      if (target) {
        renderArchiveSelect(target);
        await selectArchive(target);
      } else {
        showEmpty();
      }
    } catch (e) {
      showError(
        storage.mode === 'local'
          ? `读取本地档案失败：${e.message}`
          : `无法连接服务器：${e.message}。已切换为本地模式，数据仅保存在当前浏览器。`
      );
    }
  }

  /* ---------------- 档案弹窗 ---------------- */

  function openModal(prefill = {}) {
    editingId = prefill.id || null;
    modalTitle.textContent = editingId ? '编辑档案' : '新建档案';
    modalName.value = prefill.name || '';
    modalDesc.value = prefill.description || '';
    modalCsv.value = prefill.csv || '';
    modalError.hidden = true;
    modalOverlay.hidden = false;
    modalName.focus();
  }

  function closeModal() {
    modalOverlay.hidden = true;
    editingId = null;
  }

  function showModalError(message) {
    modalError.textContent = message;
    modalError.hidden = false;
  }

  async function saveModal() {
    const name = modalName.value.trim();
    const csv = modalCsv.value.trim();
    const description = modalDesc.value.trim();
    if (!name) { showModalError('请填写档案名'); modalName.focus(); return; }
    if (!csv) { showModalError('请填写 CSV 内容（可粘贴或上传文件）'); modalCsv.focus(); return; }
    try {
      parseItems(csv);
    } catch (e) {
      showModalError(e.message);
      return;
    }

    try {
      let id = editingId;
      if (id) {
        await storage.update(id, { name, csv, description });
      } else {
        const created = await storage.create({ name, csv, description });
        id = created.id;
      }
      closeModal();
      hideError();
      await refreshArchiveList(id);
      await selectArchive(id);
    } catch (e) {
      showModalError(`保存失败：${e.message}`);
    }
  }

  async function deleteCurrent() {
    if (!currentArchive) return;
    if (!window.confirm(`确定删除档案「${currentArchive.name}」吗？删除后无法恢复。`)) return;
    try {
      await storage.remove(currentArchive.id);
      localStorage.removeItem(LAST_KEY);
      showEmpty();
      await refreshArchiveList(null);
    } catch (e) {
      showError(`删除档案失败：${e.message}`);
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

  async function readFileIntoModal(file) {
    try {
      const text = await file.text();
      const base = (file.name || '').replace(/\.[^.]+$/, '');
      openModal({ name: base, csv: text });
    } catch (e) {
      showError(`读取文件失败：${e.message}`);
    }
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) readFileIntoModal(fileInput.files[0]);
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
    if (file) readFileIntoModal(file);
  });

  $('#pickBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });
  $('#pasteBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    openModal();
    modalCsv.focus();
  });

  newArchiveBtn.addEventListener('click', () => openModal());
  archiveSelect.addEventListener('change', () => {
    if (archiveSelect.value) selectArchive(archiveSelect.value);
  });
  editArchiveBtn.addEventListener('click', () => {
    if (!currentArchive) return;
    openModal({
      id: currentArchive.id,
      name: currentArchive.name,
      description: currentArchive.description,
      csv: currentArchive.csv,
    });
  });
  deleteArchiveBtn.addEventListener('click', deleteCurrent);

  modalCancelBtn.addEventListener('click', closeModal);
  modalSaveBtn.addEventListener('click', saveModal);
  modalUploadBtn.addEventListener('click', () => modalFileInput.click());
  modalFileInput.addEventListener('change', () => {
    if (modalFileInput.files && modalFileInput.files[0]) readFileIntoModal(modalFileInput.files[0]);
    modalFileInput.value = '';
  });
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalOverlay.hidden) closeModal();
  });

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    renderGrid({ moves: true });
  });
  sortSelect.addEventListener('change', () => {
    sortKey = sortSelect.value;
    renderGrid({ moves: true });
  });
  filterSelect.addEventListener('change', () => {
    filterKey = filterSelect.value;
    renderGrid({ moves: true });
  });

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

  /* ---------------- 启动 ---------------- */

  initArchives();
}
