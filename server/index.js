import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { RoomManager } from './rooms.js';
import { describeReason } from '../engine/rules.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const rooms = new RoomManager();

function publicOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const proto = forwardedProto || (req.socket.encrypted ? 'https' : 'http');
  const host = forwardedHost || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function inviteUrl(origin, code) {
  return `${origin}/?r=${encodeURIComponent(code)}`;
}

async function makeQr(link) {
  return QRCode.toDataURL(link, {
    margin: 1,
    width: 360,
    errorCorrectionLevel: 'M',
    color: { dark: '#2a1a0c', light: '#fff8ec' },
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function safeJoinPublic(rel) {
  const clean = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(PUBLIC, clean);
  if (!full.startsWith(PUBLIC)) return null;
  return full;
}

function serveStatic(req, res) {
  const parsed = url.parse(req.url);
  let pathname = decodeURIComponent(parsed.pathname || '/');
  if (pathname === '/') pathname = '/index.html';

  if (pathname === '/health') {
    sendJson(res, 200, { ok: true, rooms: rooms.rooms.size });
    return;
  }

  if (pathname === '/api/invite-qr' && req.method === 'GET') {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const code = String(q.get('r') || q.get('code') || '').trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) {
      sendJson(res, 400, { ok: false, error: '房间号无效' });
      return;
    }
    const link = inviteUrl(publicOrigin(req), code);
    makeQr(link)
      .then((qr) => sendJson(res, 200, { ok: true, url: link, qr }))
      .catch(() => sendJson(res, 500, { ok: false, error: '二维码生成失败' }));
    return;
  }

  if (pathname.startsWith('/engine/')) {
    const engineRoot = path.join(ROOT, 'engine');
    const filePath = path.normalize(path.join(ROOT, pathname));
    if (!filePath.startsWith(engineRoot) || !filePath.endsWith('.js')) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(filePath, (e, data) => {
      if (e) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
    return;
  }

  const filePath = safeJoinPublic(pathname);
  if (!filePath) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // SPA：带房间号的分享链接一律回首页
      const index = path.join(PUBLIC, 'index.html');
      fs.readFile(index, 'utf8', (e2, data) => {
        if (e2) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const body = data.replaceAll('__ORIGIN__', publicOrigin(req));
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(body);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const cache = ext === '.html' ? 'no-store' : 'public, max-age=3600';
    if (ext === '.html') {
      fs.readFile(filePath, 'utf8', (e2, html) => {
        if (e2) {
          res.writeHead(500);
          res.end('Error');
          return;
        }
        const origin = publicOrigin(req);
        const body = html.replaceAll('__ORIGIN__', origin);
        res.writeHead(200, {
          'Content-Type': type,
          'Cache-Control': cache,
        });
        res.end(body);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
    });
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server, path: '/ws' });

function clientPayload(room, color, token, origin) {
  const snap = rooms.snapshot(room);
  const link = inviteUrl(origin, room.code);
  return {
    type: 'state',
    roomCode: room.code,
    color,
    token,
    inviteUrl: link,
    you: color,
    ...snap,
  };
}

async function greet(ws, room, color, token, origin, kind) {
  let qr = null;
  try {
    qr = await makeQr(inviteUrl(origin, room.code));
  } catch {
    qr = null;
  }
  rooms.send(ws, {
    ...clientPayload(room, color, token, origin),
    type: kind,
    qr,
    reasonText: describeReason(room.game.reason),
  });
}

wss.on('connection', (ws, req) => {
  const origin = publicOrigin(req);
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      rooms.send(ws, { type: 'error', error: '消息格式不正确' });
      return;
    }
    const type = msg && msg.type;
    try {
      await handleMessage(ws, msg, origin);
    } catch (err) {
      console.error('ws handler', type, err);
      rooms.send(ws, { type: 'error', error: '服务器处理失败，请稍后重试' });
    }
  });

  ws.on('close', () => {
    const found = rooms.detach(ws);
    if (found) {
      rooms.broadcast(found.room, {
        type: 'opponentLeft',
        ...rooms.snapshot(found.room),
        reasonText: describeReason(found.room.game.reason),
      });
    }
  });
});

async function handleMessage(ws, msg, origin) {
  switch (msg.type) {
    case 'create': {
      const { room, color, token } = rooms.createRoom();
      rooms.attach(room, color, ws);
      await greet(ws, room, color, token, origin, 'created');
      return;
    }
    case 'join': {
      const result = rooms.joinRoom(msg.roomCode);
      if (!result.ok) {
        rooms.send(ws, { type: 'error', error: result.error });
        return;
      }
      rooms.attach(result.room, result.color, ws);
      await greet(ws, result.room, result.color, result.token, origin, 'joined');
      rooms.broadcast(
        result.room,
        {
          type: 'opponentJoined',
          ...rooms.snapshot(result.room),
          reasonText: describeReason(result.room.game.reason),
        },
        ws,
      );
      return;
    }
    case 'reconnect': {
      const result = rooms.reconnect(msg.roomCode, msg.token);
      if (!result.ok) {
        rooms.send(ws, { type: 'error', error: result.error });
        return;
      }
      rooms.attach(result.room, result.color, ws);
      await greet(ws, result.room, result.color, result.token, origin, 'reconnected');
      rooms.broadcast(
        result.room,
        {
          type: 'opponentReconnected',
          ...rooms.snapshot(result.room),
          reasonText: describeReason(result.room.game.reason),
        },
        ws,
      );
      return;
    }
    case 'heartbeat':
    case 'ping': {
      const found = rooms.findByWs(ws);
      if (found) rooms.heartbeat(found.room, found.color);
      rooms.send(ws, { type: 'pong', t: Date.now() });
      return;
    }
    case 'leave': {
      const found = rooms.detach(ws);
      if (found) {
        rooms.broadcast(found.room, {
          type: 'opponentLeft',
          ...rooms.snapshot(found.room),
          reasonText: describeReason(found.room.game.reason),
        });
      }
      rooms.send(ws, { type: 'left' });
      return;
    }
    default:
      break;
  }

  const seated = rooms.findByWs(ws);
  if (!seated) {
    rooms.send(ws, { type: 'error', error: '尚未加入房间' });
    return;
  }
  const { room, color } = seated;
  rooms.heartbeat(room, color);

  if (msg.type === 'move') {
    const from = msg.from;
    const to = msg.to;
    if (!from || !to) {
      rooms.send(ws, { type: 'error', error: '缺少走棋坐标' });
      return;
    }
    const result = rooms.move(room, color, from, to);
    if (!result.ok) {
      rooms.send(ws, { type: 'error', error: result.error, ...rooms.snapshot(room) });
      return;
    }
    room.game = result.state;
    room.lastActivity = Date.now();
    rooms.broadcast(room, {
      type: 'moved',
      ...rooms.snapshot(room),
      reasonText: describeReason(room.game.reason),
    });
    return;
  }

  if (msg.type === 'resign') {
    const result = rooms.resign(room, color);
    if (!result.ok) {
      rooms.send(ws, { type: 'error', error: result.error });
      return;
    }
    room.game = result.state;
    rooms.broadcast(room, {
      type: 'resigned',
      ...rooms.snapshot(room),
      reasonText: describeReason(room.game.reason),
    });
    return;
  }

  if (msg.type === 'draw' || msg.type === 'drawOffer') {
    const result = rooms.offerDraw(room, color);
    if (!result.ok) {
      rooms.send(ws, { type: 'error', error: result.error });
      return;
    }
    room.game = result.state;
    rooms.broadcast(room, {
      type: 'drawOffered',
      ...rooms.snapshot(room),
      reasonText: describeReason(room.game.reason),
    });
    return;
  }

  if (msg.type === 'drawAccept' || msg.type === 'drawDecline') {
    const accept = msg.type === 'drawAccept';
    const result = rooms.respondDraw(room, color, accept);
    if (!result.ok) {
      rooms.send(ws, { type: 'error', error: result.error });
      return;
    }
    room.game = result.state;
    rooms.broadcast(room, {
      type: accept ? 'drawAccepted' : 'drawDeclined',
      ...rooms.snapshot(room),
      reasonText: describeReason(room.game.reason),
    });
    return;
  }

  if (msg.type === 'rematch') {
    const prevRedToken = room.players.red?.token;
    const result = rooms.rematch(room, color);
    if (!result.ok) {
      rooms.send(ws, { type: 'error', error: result.error });
      return;
    }
    if (result.rematchReady) {
      for (const c of ['red', 'black']) {
        const seat = room.players[c];
        if (!seat?.ws) continue;
        rooms.send(seat.ws, {
          type: 'rematchStarted',
          color: c,
          token: seat.token,
          roomCode: room.code,
          inviteUrl: inviteUrl(origin, room.code),
          you: c,
          ...rooms.snapshot(room),
          reasonText: '',
        });
      }
      return;
    }
    rooms.broadcast(room, {
      type: 'rematchRequested',
      ...rooms.snapshot(room),
      reasonText: describeReason(room.game.reason),
    });
    void prevRedToken;
    return;
  }

  rooms.send(ws, { type: 'error', error: '未知的消息类型' });
}

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  });
  rooms.sweepExpired();
}, 30000);

wss.on('close', () => clearInterval(interval));

server.listen(PORT, HOST, () => {
  console.log(`中国象棋已启动：http://localhost:${PORT}`);
  console.log('同一台电脑请用两个浏览器窗口打开即可对弈。');
});
