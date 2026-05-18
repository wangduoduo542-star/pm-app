/**
 * 项目管理 - 局域网同步服务器
 * 在 Windows 电脑上运行，手机端通过局域网连接同步数据
 *
 * 启动: node server.js
 * 手机访问: http://电脑IP:3456
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3456;
const DATA_DIR = path.join(__dirname, 'sync_data');
const WWW_DIR = __dirname;

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// MIME 类型
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// 获取本机局域网 IP
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal &&
          iface.address.startsWith('192.') || iface.address.startsWith('10.') ||
          iface.address.startsWith('172.')) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// 解析请求体
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
    });
    req.on('error', reject);
  });
}

// 路由
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS 头（允许手机端跨域请求）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ====== API: 获取同步状态 ======
  if (pathname === '/api/status' && req.method === 'GET') {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    const stats = files.map(f => {
      const p = path.join(DATA_DIR, f);
      const s = fs.statSync(p);
      return { name: f, size: s.size, mtime: s.mtime.toISOString() };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', serverTime: new Date().toISOString(), files: stats, ip: getLocalIP(), port: PORT }));
    return;
  }

  // ====== API: 推送数据到服务器 ======
  if (pathname === '/api/sync/push' && req.method === 'POST') {
    const data = await parseBody(req);
    if (!data || !data.type) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: '缺少 type 字段' }));
      return;
    }
    const filename = `${data.type}.json`;
    const filepath = path.join(DATA_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(data.payload, null, 2), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', file: filename, size: data.payload ? JSON.stringify(data.payload).length : 0 }));
    return;
  }

  // ====== API: 从服务器拉取数据 ======
  if (pathname === '/api/sync/pull' && req.method === 'GET') {
    const type = url.searchParams.get('type');
    if (!type) {
      // 返回所有数据类型列表
      const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
      const types = files.map(f => f.replace('.json', ''));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', types }));
      return;
    }
    const filepath = path.join(DATA_DIR, `${type}.json`);
    if (!fs.existsSync(filepath)) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: '没有找到数据', type }));
      return;
    }
    const content = fs.readFileSync(filepath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', type, data: JSON.parse(content) }));
    return;
  }

  // ====== API: 一键全量同步（推+拉） ======
  if (pathname === '/api/sync/full' && req.method === 'POST') {
    const data = await parseBody(req);
    if (data.push) {
      // 保存推送的数据
      for (const [type, payload] of Object.entries(data.push)) {
        fs.writeFileSync(path.join(DATA_DIR, `${type}.json`), JSON.stringify(payload, null, 2), 'utf-8');
      }
    }
    // 返回服务器上所有数据
    const result = {};
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const type = file.replace('.json', '');
      result[type] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', data: result }));
    return;
  }

  // ====== 静态文件服务 ======
  let filePath = path.join(WWW_DIR, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);

  if (!fs.existsSync(filePath)) {
    // SPA 支持：未找到文件返回 index.html
    filePath = path.join(WWW_DIR, 'index.html');
  }

  const mime = MIME[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mime, 'Content-Length': content.length });
  res.end(content);
}

// 启动服务器
const server = http.createServer(handleRequest);
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('  项目管理 - 局域网同步服务器');
  console.log('═══════════════════════════════════════');
  console.log('');
  console.log(`  本机地址:    http://localhost:${PORT}`);
  console.log(`  局域网地址:  http://${ip}:${PORT}`);
  console.log('');
  console.log('  手机端操作:');
  console.log(`  1. 手机连接同一个 WiFi`);
  console.log(`  2. 浏览器打开 http://${ip}:${PORT}`);
  console.log(`  3. 或在 App 设置中点击「局域网同步」`);
  console.log('');
  console.log('  按 Ctrl+C 停止服务器');
  console.log('═══════════════════════════════════════');
  console.log('');
});
