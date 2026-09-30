'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = path.resolve(__dirname, '..');
const ROOM_TTL = 30_000;
const token = () => randomBytes(24).toString('hex');
const send = (ws, message) => {
  if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 512 * 1024)
    ws.send(JSON.stringify(message));
};

function createRoomServer({ reconnectMs = ROOM_TTL, maxRooms = 200 } = {}) {
  const rooms = new Map();
  // Explicit public files: never expose repository configuration, saves, or credentials.
  const publicFiles = new Map([
    ['/', 'BrilliantFacility.html'], ['/BrilliantFacility.html', 'BrilliantFacility.html'],
    ['/vendor/phaser.min.js', 'node_modules/phaser/dist/phaser.min.js'],
    ...['data', 'game', 'bot', 'online', 'ProposalReviewScene', 'CycleEndScene', 'YearEndScene']
      .map(name => [`/js/${name}.js`, `js/${name}.js`]),
    ['/css/styles.css', 'css/styles.css'], ['/css/online.css', 'css/online.css'],
  ]);
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    const file = publicFiles.get(pathname);
    if (!file) { res.writeHead(404); return res.end('Not found'); }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    fs.readFile(path.join(ROOT, file), (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': `${types[path.extname(file)]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    // Same-origin browser clients only; no cross-site use of this relay.
    let allowed = !req.headers.origin;
    try { allowed ||= new URL(req.headers.origin).host === req.headers.host; } catch {}
    if (new URL(req.url, 'http://localhost').pathname !== '/coop' || !allowed) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return;
    }
    if (wss.clients.size >= maxRooms * 4) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  function broadcast(room, message) { for (const p of Object.values(room.players)) send(p?.ws, message); }
  function status(room) {
    broadcast(room, { type: 'room', code: room.code, started: room.started,
      players: Object.fromEntries(Object.entries(room.players).map(([id, p]) => [id, p && {
        connected: p.ws?.readyState === WebSocket.OPEN, ready: p.ready, visible: p.visible,
      }])) });
  }
  function destroy(room, reason) {
    rooms.delete(room.code);
    broadcast(room, { type: 'ended', reason });
    for (const p of Object.values(room.players)) {
      if (p?.timeout) clearTimeout(p.timeout);
      if (p?.ws) { p.ws.member = null; p.ws.close(1000, 'Room ended'); }
    }
  }
  wss.on('connection', ws => {
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    const joinDeadline = setTimeout(() => { if (!ws.member) ws.close(1008, 'Join a room first'); }, 10_000);
    ws.on('message', (raw, binary) => {
      const now = Date.now();
      if (now - (ws.rateAt || 0) >= 1000) { ws.rateAt = now; ws.rateCount = 0; }
      if (++ws.rateCount > 100 || binary) { ws.close(1008, 'Message rate exceeded'); return; }
      let m;
      try { m = JSON.parse(raw); } catch { return send(ws, { type: 'error', message: 'Invalid message.' }); }
      if (!m || typeof m !== 'object') return;
      if (m.type === 'ping') return send(ws, { type: 'pong' });
      const fail = message => send(ws, { type: 'error', message });
      if (!ws.member) {
        let room, role;
        if (m.type === 'create') {
          if (rooms.size >= maxRooms) return fail('The server is full. Please try later.');
          let code;
          do { code = randomBytes(5).toString('hex').toUpperCase(); } while (rooms.has(code));
          room = { code, started: false, players: { host: null, guest: null }, snapshot: null };
          rooms.set(code, room); role = 'host';
        } else if (m.type === 'join') {
          room = typeof m.code === 'string' && rooms.get(m.code.toUpperCase());
          if (!room) return fail('Room not found or expired. Ask your friend for a new link.');
          role = typeof m.token === 'string' && Object.keys(room.players).find(id => room.players[id]?.token === m.token);
          if (role && room.players[role].ws) return fail('This player is already connected in another tab.');
          if (!role) {
            if (room.started || room.players.guest) return fail('This room is full or already playing.');
            role = 'guest';
          }
        } else return fail('Create or join a room first.');
        let p = room.players[role];
        if (!p) p = room.players[role] = { token: token(), ready: false, visible: true, seq: -1 };
        clearTimeout(p.timeout);
        p.ws = ws; p.visible = true; p.seq = -1;
        ws.member = { room, role }; clearTimeout(joinDeadline);
        send(ws, { type: 'joined', code: room.code, role, token: p.token, started: room.started });
        status(room);
        if (role === 'guest' && room.snapshot) send(ws, { type: 'snapshot', ...room.snapshot });
        return;
      }
      const { room, role } = ws.member;
      const p = room.players[role];
      if (m.type === 'leave') {
        if (role === 'host' || room.started) return destroy(room, 'A player left the session. Create a new room to play again.');
        room.players.guest = null; ws.member = null; ws.close(); status(room); return;
      }
      if (m.type === 'ready' && !room.started) { p.ready = m.ready === true; status(room); return; }
      if (m.type === 'visibility') { p.visible = m.visible === true; status(room); return; }
      if (m.type === 'start' && role === 'host' && !room.started) {
        if (!Object.values(room.players).every(q => q?.ws && q.ready && q.visible)) return fail('Both players must be connected and ready.');
        room.started = true; broadcast(room, { type: 'started' }); status(room); return;
      }
      if (m.type === 'snapshot' && role === 'host' && room.started) {
        if (!Number.isSafeInteger(m.epoch) || !['ProposalReview', 'Game', 'CycleEnd', 'YearEnd', 'Tutorial'].includes(m.scene)
          || !m.data || typeof m.data !== 'object' || !m.state || typeof m.state !== 'object') return;
        room.snapshot = { epoch: m.epoch, scene: m.scene, data: m.data, state: m.state };
        send(room.players.guest?.ws, { type: 'snapshot', ...room.snapshot }); return;
      }
      if (m.type === 'input' && role === 'guest' && room.started) {
        if (!Number.isSafeInteger(m.seq) || m.seq <= p.seq || !Number.isSafeInteger(m.epoch)
          || ![-1, 0, 1].includes(m.x) || ![-1, 0, 1].includes(m.y)
          || (m.action != null && !['interact', 'pass', 'pause'].includes(m.action))) return;
        p.seq = m.seq;
        send(room.players.host?.ws, { type: 'input', seq: m.seq, epoch: m.epoch, x: m.x, y: m.y, action: m.action || null });
      }
    });
    ws.on('close', () => {
      clearTimeout(joinDeadline);
      if (!ws.member) return;
      const { room, role } = ws.member;
      const p = room.players[role];
      if (p?.ws !== ws) return;
      p.ws = null;
      status(room);
      p.timeout = setTimeout(() => {
        if (role === 'guest' && !room.started) { room.players.guest = null; status(room); }
        else destroy(room, 'Connection expired. Create a new room to play again.');
      }, reconnectMs);
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
    }
  }, 5000);
  heartbeat.unref();
  async function close() {
    clearInterval(heartbeat);
    for (const room of rooms.values()) destroy(room, 'Server stopped.');
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
  return { server, rooms, close };
}
if (require.main === module) {
  const app = createRoomServer();
  app.server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
    console.log(`The Brilliant Facility: http://localhost:${app.server.address().port}`);
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
module.exports = { createRoomServer };
