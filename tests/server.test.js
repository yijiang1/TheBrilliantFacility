const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { createRoomServer } = require('../server');

async function setup(t, options) {
  const app = createRoomServer(options);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.server.address().port}`;
  async function client() {
    const ws = new WebSocket(url.replace('http', 'ws') + '/coop');
    const messages = [], waiters = [];
    ws.on('message', raw => {
      const m = JSON.parse(raw); messages.push(m);
      for (const w of [...waiters]) if (w.type === m.type) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(m); }
    });
    await once(ws, 'open');
    return { ws, messages, send: m => ws.send(JSON.stringify(m)), next(type) {
      return new Promise((resolve, reject) => {
        const w = { type, resolve, timer: setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 1500) };
        waiters.push(w);
      });
    } };
  }
  return { ...app, url, client };
}
async function room(app) {
  const host = await app.client(); let next = host.next('joined'); host.send({ type: 'create' }); const h = await next;
  const guest = await app.client(); next = guest.next('joined'); guest.send({ type: 'join', code: h.code }); const g = await next;
  return { host, guest, h, g };
}
async function start(host, guest) {
  let next = host.next('room'); host.send({ type: 'ready', ready: true }); await next;
  next = host.next('room'); guest.send({ type: 'ready', ready: true }); await next;
  next = host.next('started'); host.send({ type: 'start' }); await next;
}

test('private room requires both ready; caps membership at two; relay enforces roles and input validation', async t => {
  const app = await setup(t); const { host, guest, h } = await room(app);
  let next = host.next('error'); host.send({ type: 'start' }); assert.match((await next).message, /ready/);
  const third = await app.client(); next = third.next('error'); third.send({ type: 'join', code: h.code }); assert.match((await next).message, /full/);
  await start(host, guest);
  const snapshot = { type: 'snapshot', epoch: 1, scene: 'Game', data: {}, state: { timer: 180 } };
  next = guest.next('snapshot'); host.send(snapshot); assert.deepEqual(await next, snapshot);
  guest.send({ ...snapshot, state: { timer: 0 } });
  guest.send({ type: 'input', epoch: 1, seq: 1, x: 99, y: 0 });
  next = host.next('input'); guest.send({ type: 'input', epoch: 1, seq: 2, x: 1, y: 0, action: 'interact' });
  assert.equal((await next).seq, 2);
  guest.send({ type: 'input', epoch: 1, seq: 2, x: 1, y: 0, action: 'interact' });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(host.messages.filter(m => m.type === 'snapshot').length, 0);
  assert.equal(host.messages.filter(m => m.type === 'input').length, 1);
});

test('guest reconnect requires its private token and receives the last snapshot', async t => {
  const app = await setup(t); const { host, guest, h, g } = await room(app);
  await start(host, guest);
  let next = guest.next('snapshot'); host.send({ type: 'snapshot', epoch: 2, scene: 'Game', data: {}, state: { held: [42] } }); await next;
  next = host.next('room'); guest.ws.close(); await next;
  const intruder = await app.client(); next = intruder.next('error'); intruder.send({ type: 'join', code: h.code, token: 'wrong' }); assert.match((await next).message, /full/);
  const returning = await app.client(); next = returning.next('snapshot'); returning.send({ type: 'join', code: h.code, token: g.token });
  assert.deepEqual((await next).state.held, [42]);
  assert.equal(returning.messages.find(m => m.type === 'joined').role, 'guest');
  assert.ok(!JSON.stringify(host.messages.filter(m => m.type === 'room')).includes(g.token));
});

test('host disconnect expires the room and notifies guest', async t => {
  const app = await setup(t, { reconnectMs: 60 }); const { host, guest, h } = await room(app);
  const next = guest.next('ended'); host.ws.close(); assert.match((await next).reason, /expired/);
  assert.equal(app.rooms.has(h.code), false);
});

test('HTTP serves game assets and never serves private project files', async t => {
  const { url } = await setup(t);
  for (const file of ['/', '/vendor/phaser.min.js', '/js/online.js', '/health']) assert.equal((await fetch(url + file)).status, 200);
  for (const file of ['/.env', '/.git/config', '/.claude/settings.local.json', '/package.json', '/server/index.js', '/js/../.env']) assert.equal((await fetch(url + file)).status, 404);
});
