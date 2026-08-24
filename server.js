'use strict';

/**
 * Litematica 材料清单服务器（零依赖，仅用 Node 原生模块）
 *
 * 功能：
 *  - 提供静态页面（index.html / styles.css / app.js / images/ 等）
 *  - 档案 API：多套材料清单（档案）保存在服务器 data/archives.json，
 *    可在不同设备 / 浏览器间同步
 *
 * 用法：
 *   node server.js               （默认端口 8080，监听 0.0.0.0 全网卡）
 *   $env:PORT=9000; node server.js
 *   $env:HOST=127.0.0.1; node server.js   （仅允许本机访问）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0'; // 默认监听所有网卡，外部 IP 可直接访问
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'archives.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/* ---------------- 数据存取 ---------------- */

function loadArchives() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function saveArchives(archives) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(archives, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

/* ---------------- 工具 ---------------- */

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10 * 1024 * 1024) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => (tooBig ? reject(Object.assign(new Error('请求体过大'), { status: 413 })) : resolve(data)));
    req.on('error', reject);
  });
}

async function getJsonBody(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    throw Object.assign(new Error('请求体不是有效的 JSON'), { status: 400 });
  }
}

function cleanString(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/* ---------------- 档案 API ---------------- */

async function handleApi(req, res, pathname) {
  const method = req.method;
  const parts = pathname.split('/').filter(Boolean); // ['api', 'archives', id?, 'done'?]

  if (parts.length < 2 || parts[0] !== 'api' || parts[1] !== 'archives') {
    return sendJson(res, 404, { error: '接口不存在' });
  }

  const id = parts[2];
  const sub = parts[3]; // 'done' 或 undefined

  // 档案列表（不含 csv / done，保持轻量）
  if (method === 'GET' && !id) {
    const archives = loadArchives();
    return sendJson(res, 200, archives.map(({ csv, done, ...rest }) => rest));
  }

  // 新建档案
  if (method === 'POST' && !id) {
    const body = await getJsonBody(req);
    const name = cleanString(body.name);
    const csv = cleanString(body.csv);
    const description = cleanString(body.description);
    if (!name) return sendJson(res, 400, { error: '档案名不能为空' });
    if (!csv) return sendJson(res, 400, { error: 'CSV 内容不能为空' });
    const archives = loadArchives();
    const archive = {
      id: crypto.randomUUID(),
      name,
      description,
      csv,
      done: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    archives.push(archive);
    saveArchives(archives);
    return sendJson(res, 201, archive);
  }

  if (!id) return sendJson(res, 404, { error: '档案不存在' });

  const archives = loadArchives();
  const idx = archives.findIndex((a) => a.id === id);
  if (idx === -1) return sendJson(res, 404, { error: '档案不存在' });

  // 档案详情（含 csv 与 done）
  if (method === 'GET' && !sub) {
    return sendJson(res, 200, archives[idx]);
  }

  // 同步收集完成状态
  if (method === 'PUT' && sub === 'done') {
    const body = await getJsonBody(req);
    const done = Array.isArray(body.done)
      ? body.done.filter((d) => typeof d === 'string').map((d) => String(d))
      : [];
    archives[idx].done = done;
    archives[idx].updatedAt = Date.now();
    saveArchives(archives);
    return sendJson(res, 200, { ok: true, done });
  }

  // 更新档案（名称 / 描述 / CSV）
  if (method === 'PUT' && !sub) {
    const body = await getJsonBody(req);
    if (body.name !== undefined) {
      const name = cleanString(body.name);
      if (!name) return sendJson(res, 400, { error: '档案名不能为空' });
      archives[idx].name = name;
    }
    if (body.csv !== undefined) {
      const csv = cleanString(body.csv);
      if (!csv) return sendJson(res, 400, { error: 'CSV 内容不能为空' });
      archives[idx].csv = csv;
    }
    if (body.description !== undefined) {
      archives[idx].description = cleanString(body.description);
    }
    archives[idx].updatedAt = Date.now();
    saveArchives(archives);
    return sendJson(res, 200, archives[idx]);
  }

  // 删除档案
  if (method === 'DELETE' && !sub) {
    archives.splice(idx, 1);
    saveArchives(archives);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: '接口不存在' });
}

/* ---------------- 静态文件 ---------------- */

function serveStatic(req, res, pathname) {
  if (pathname.startsWith('/data/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  let filePath = path.normalize(path.join(ROOT, pathname === '/' ? 'index.html' : pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  fs.stat(filePath, (err, st) => {
    if (!err && st.isDirectory()) filePath = path.join(filePath, 'index.html');
    fs.readFile(filePath, (err2, data) => {
      if (err2) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    });
  });
}

/* ---------------- 服务器 ---------------- */

const server = http.createServer(async (req, res) => {
  // 跨域预检（前端部署在 GitHub Pages 等静态站、后端独立部署时使用）
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, pathname);
    } catch (e) {
      sendJson(res, e.status || 500, { error: e.message || '服务器内部错误' });
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('405 Method Not Allowed');
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Server has launched`);
  console.log(`Local: http://localhost:${PORT}`);
  console.log(`Listening: ${HOST}:${PORT}`);
  console.log(`Data saved at: ${DATA_FILE}`);

});
