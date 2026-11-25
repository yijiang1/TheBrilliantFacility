// ════════════════════════════════════════════════════════════════
//  Headless Phaser stand-in for the simulator.
//
//  Implements only what the game's scenes use: scene lifecycle and
//  scene.start(), per-scene clocks (delayedCall / addEvent), scene
//  events, keyboard keys that are never pressed, Phaser.Math helpers,
//  and display objects that accept every call and draw nothing.
//
//  Game rules are NOT reimplemented here. The real js/ scene code runs
//  on top of this, so the simulator follows the game exactly.
// ════════════════════════════════════════════════════════════════
'use strict';

function createPhaserStub(host) {
  // ── Tiny event emitter ─────────────────────────────────────────
  class Emitter {
    constructor() { this._l = new Map(); }
    on(ev, fn, ctx) { this._add(ev, fn, ctx, false); return this; }
    once(ev, fn, ctx) { this._add(ev, fn, ctx, true); return this; }
    _add(ev, fn, ctx, once) {
      if (!this._l.has(ev)) this._l.set(ev, []);
      this._l.get(ev).push({ fn, ctx, once });
    }
    off(ev, fn) {
      const list = this._l.get(ev);
      if (!list) return this;
      if (!fn) { this._l.delete(ev); return this; }
      this._l.set(ev, list.filter(l => l.fn !== fn));
      return this;
    }
    emit(ev, ...args) {
      const list = this._l.get(ev);
      if (!list || !list.length) return false;
      for (const l of [...list]) {
        if (l.once) this.off(ev, l.fn);
        l.fn.apply(l.ctx, args);
      }
      return true;
    }
    removeAllListeners() { this._l.clear(); return this; }
  }

  // ── Display objects: accept any call, draw nothing ─────────────
  // Known setters store their value so code that reads it back works.
  // Unknown methods fall through to a chainable no-op.
  const chainable = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      return function () { return this; };
    },
  });
  class GameObject {
    constructor(x = 0, y = 0, extra = {}) {
      this.x = x; this.y = y;
      this.width = extra.width || 0; this.height = extra.height || 0;
      this.displayWidth = this.width; this.displayHeight = this.height;
      this.alpha = 1; this.depth = 0; this.visible = true; this.active = true;
      this.scaleX = 1; this.scaleY = 1; this.rotation = 0; this.angle = 0;
      this.originX = 0.5; this.originY = 0.5; this.radius = extra.radius || 0;
      this.text = extra.text !== undefined ? String(extra.text) : '';
      this.style = extra.style || {};
      this.list = [];
      this.input = null;
      this.data = null;
      this._events = null;
    }
    setText(t) { this.text = Array.isArray(t) ? t.join('\n') : String(t ?? ''); return this; }
    setPosition(x = 0, y = x) { this.x = x; this.y = y; return this; }
    setX(x) { this.x = x; return this; }
    setY(y) { this.y = y; return this; }
    setVisible(v) { this.visible = !!v; return this; }
    setAlpha(a = 1) { this.alpha = a; return this; }
    setDepth(d = 0) { this.depth = d; return this; }
    setOrigin(x = 0.5, y = x) { this.originX = x; this.originY = y; return this; }
    setStyle(s) { Object.assign(this.style, s); return this; }
    setColor(c) { this.style.color = c; return this; }
    setFillStyle(c, a) { this.fillColor = c; if (a !== undefined) this.fillAlpha = a; return this; }
    setStrokeStyle(w, c, a) { this.lineWidth = w; this.strokeColor = c; this.strokeAlpha = a; return this; }
    setDisplaySize(w, h) { this.displayWidth = w; this.displayHeight = h; return this; }
    setSize(w, h) { this.width = w; this.height = h; return this; }
    setScale(x = 1, y = x) { this.scaleX = x; this.scaleY = y; return this; }
    setRotation(r = 0) { this.rotation = r; return this; }
    setAngle(a = 0) { this.angle = a; return this; }
    setInteractive() { this.input = this.input || { enabled: true }; this.input.enabled = true; return this; }
    disableInteractive() { if (this.input) this.input.enabled = false; return this; }
    removeInteractive() { this.input = null; return this; }
    on(ev, fn, ctx) { (this._events = this._events || new Emitter()).on(ev, fn, ctx); return this; }
    once(ev, fn, ctx) { (this._events = this._events || new Emitter()).once(ev, fn, ctx); return this; }
    off(ev, fn) { if (this._events) this._events.off(ev, fn); return this; }
    emit(ev, ...a) { return this._events ? this._events.emit(ev, ...a) : false; }
    add(child) { for (const c of [].concat(child)) this.list.push(c); return this; }
    getBounds() { return { x: this.x, y: this.y, width: this.width, height: this.height, centerX: this.x, centerY: this.y }; }
    setData(k, v) { (this.data = this.data || {})[k] = v; return this; }
    getData(k) { return this.data ? this.data[k] : undefined; }
    destroy() { this.active = false; this.visible = false; }
  }
  Object.setPrototypeOf(GameObject.prototype, chainable);

  class GameObjectFactory {
    constructor(scene) { this.scene = scene; }
    text(x, y, text, style) { return new GameObject(x, y, { text, style: { ...(style || {}) } }); }
    rectangle(x, y, w, h) { return new GameObject(x, y, { width: w, height: h }); }
    circle(x, y, r) { return new GameObject(x, y, { radius: r, width: r * 2, height: r * 2 }); }
    ellipse(x, y, w, h) { return new GameObject(x, y, { width: w, height: h }); }
    graphics() { return new GameObject(0, 0); }
    container(x, y, children) { const c = new GameObject(x, y); if (children) c.add(children); return c; }
    image(x, y) { return new GameObject(x, y); }
    sprite(x, y) { return new GameObject(x, y); }
    zone(x, y, w, h) { return new GameObject(x, y, { width: w, height: h }); }
    line(x, y) { return new GameObject(x, y); }
    triangle(x, y) { return new GameObject(x, y); }
    polygon(x, y) { return new GameObject(x, y); }
    arc(x, y, r) { return new GameObject(x, y, { radius: r }); }
    star(x, y) { return new GameObject(x, y); }
  }

  // ── Keyboard: keys exist but are never pressed ────────────────
  class Key { constructor(code) { this.keyCode = code; this.isDown = false; this.isUp = true; this.enabled = true; this._justDown = false; } }
  function keyboardPlugin() {
    return {
      enabled: true,
      createCursorKeys: () => ({ up: new Key(38), down: new Key(40), left: new Key(37), right: new Key(39), space: new Key(32), shift: new Key(16) }),
      addKeys: (map) => {
        const out = {};
        if (typeof map === 'string') { for (const k of map.split(',')) out[k.trim()] = new Key(k.trim()); return out; }
        for (const [name, code] of Object.entries(map)) out[name] = new Key(code);
        return out;
      },
      addKey: (code) => new Key(code),
      addCapture: () => {}, removeCapture: () => {}, clearCaptures: () => {},
      on: () => {}, once: () => {}, off: () => {},
    };
  }

  // ── Per-scene clock (Phaser.Time.Clock subset) ────────────────
  class TimerEvent {
    constructor(cfg) {
      this.delay = Math.max(0, cfg.delay || 0);
      this.callback = cfg.callback;
      this.callbackScope = cfg.callbackScope;
      this.args = cfg.args || [];
      this.loop = !!cfg.loop;
      this.repeatCount = cfg.repeat === -1 ? Infinity : (cfg.repeat || 0);
      this.elapsed = 0;
      this.paused = !!cfg.paused;
      this.hasDispatched = false;
      this._removed = false;
    }
    remove(dispatch) { if (dispatch && this.callback) this.callback.apply(this.callbackScope, this.args); this._removed = true; }
    destroy() { this._removed = true; }
    getProgress() { return this.delay ? Math.min(1, this.elapsed / this.delay) : 1; }
    getRemaining() { return Math.max(0, this.delay - this.elapsed); }
    getRemainingSeconds() { return this.getRemaining() / 1000; }
    getElapsed() { return this.elapsed; }
  }
  class Clock {
    constructor() { this.now = 0; this.paused = false; this.timeScale = 1; this._events = []; }
    addEvent(cfg) { const e = cfg instanceof TimerEvent ? cfg : new TimerEvent(cfg); this._events.push(e); return e; }
    delayedCall(delay, callback, args, scope) { return this.addEvent({ delay, callback, args, callbackScope: scope }); }
    removeEvent(e) { for (const x of [].concat(e)) x._removed = true; return this; }
    removeAllEvents() { for (const e of this._events) e._removed = true; this._events = []; return this; }
    clearPendingEvents() { return this.removeAllEvents(); }
    update(time, delta) {
      this.now = time;
      if (this.paused) return;
      delta *= this.timeScale;
      for (const e of [...this._events]) {
        if (e._removed || e.paused) continue;
        e.elapsed += delta;
        // Fire as many times as the elapsed time covers (Phaser fires once per step;
        // with small steps that is identical).
        while (!e._removed && e.elapsed >= e.delay) {
          e.hasDispatched = true;
          if (e.loop || e.repeatCount > 0) {
            e.elapsed -= e.delay;
            if (!e.loop) e.repeatCount--;
            e.callback && e.callback.apply(e.callbackScope, e.args);
            if (e.delay === 0) break;
          } else {
            e._removed = true;
            e.callback && e.callback.apply(e.callbackScope, e.args);
          }
        }
      }
      this._events = this._events.filter(e => !e._removed);
    }
  }

  // ── Scene ─────────────────────────────────────────────────────
  class Scene {
    constructor(config) {
      const key = typeof config === 'string' ? config : (config && config.key) || 'default';
      this.__key = key;
    }
  }

  function installScenePlugins(scene, game) {
    const key = scene.__key;
    scene.game = game;
    scene.events = new Emitter();
    scene.time = new Clock();
    scene.add = new GameObjectFactory(scene);
    scene.make = scene.add;
    scene.input = {
      enabled: true,
      keyboard: keyboardPlugin(),
      on: () => {}, once: () => {}, off: () => {},
      setDraggable: () => {}, setDefaultCursor: () => {},
    };
    scene.tweens = { add: (cfg) => { if (cfg && cfg.onComplete) cfg.onComplete(); return { stop() {}, remove() {} }; }, killTweensOf: () => {}, killAll: () => {} };
    scene.cameras = { main: new GameObject(0, 0, { width: host.width, height: host.height }) };
    scene.scale = { width: host.width, height: host.height, refresh: () => {}, on: () => {} };
    scene.sys = {
      settings: { key, status: 0, data: {} },
      game,
      events: scene.events,
      isActive: () => game.scene._active.has(key),
      isVisible: () => game.scene._active.has(key),
    };
    scene.scene = {
      key,
      settings: scene.sys.settings,
      start: (k, data) => game.scene._queue.push({ op: 'switch', from: key, to: k === undefined ? key : k, data }),
      restart: (data) => game.scene._queue.push({ op: 'switch', from: key, to: key, data }),
      launch: (k, data) => game.scene._queue.push({ op: 'start', to: k, data }),
      run: (k, data) => game.scene._queue.push({ op: 'start', to: k, data }),
      stop: (k) => game.scene._queue.push({ op: 'stop', to: k === undefined ? key : k }),
      pause: () => {}, resume: () => {}, sleep: () => {}, wake: () => {},
      get: (k) => game.scene.getScene(k),
      isActive: (k) => game.scene.isActive(k === undefined ? key : k),
    };
  }

  // ── Scene manager ─────────────────────────────────────────────
  class SceneManager {
    constructor(game, classes) {
      this.game = game;
      this._scenes = new Map();
      this._order = [];
      this._active = new Set();
      this._queue = [];
      for (const C of classes) {
        const s = typeof C === 'function' ? new C() : C;
        installScenePlugins(s, game);
        this._scenes.set(s.__key, s);
        this._order.push(s.__key);
      }
    }
    getScene(k) { return this._scenes.get(k) || null; }
    isActive(k) { return this._active.has(k); }
    getScenes(activeOnly = true) { return this._order.filter(k => !activeOnly || this._active.has(k)).map(k => this._scenes.get(k)); }
    start(k, data) { this._queue.push({ op: 'start', to: k, data }); }
    stop(k) { this._queue.push({ op: 'stop', to: k }); }
    _shutdown(k) {
      const s = this._scenes.get(k);
      if (!s || !this._active.has(k)) return;
      this._active.delete(k);
      s.events.emit('shutdown', s.sys);
      s.time.removeAllEvents();
      s.time.paused = false;
    }
    _boot(k, data) {
      const s = this._scenes.get(k);
      if (!s) throw new Error(`Unknown scene: ${k}`);
      if (this._active.has(k)) this._shutdown(k);
      s.sys.settings.data = data;
      s.time = new Clock();
      s.time.now = this.game._time;
      this._active.add(k);
      if (typeof s.init === 'function') s.init(data);
      s.events.emit('start', s.sys);
      if (typeof s.create === 'function') s.create(data);
      s.events.emit('create', s);
    }
    processQueue() {
      while (this._queue.length) {
        const q = this._queue.shift();
        if (q.op === 'switch') { this._shutdown(q.from); this._boot(q.to, q.data); }
        else if (q.op === 'start') this._boot(q.to, q.data);
        else if (q.op === 'stop') this._shutdown(q.to);
      }
    }
  }

  // ── Game ──────────────────────────────────────────────────────
  class Game {
    constructor(config) {
      this.config = config;
      this._time = 0;
      this.loop = { delta: 0, time: 0, actualFps: 60 };
      this.canvas = host.makeElement();
      this.events = new Emitter();
      this.scale = { width: host.width, height: host.height, refresh: () => {}, on: () => {} };
      this.scene = new SceneManager(this, [].concat(config.scene || []));
      const first = this.scene._order[0];
      if (first) this.scene.start(first);
      host.onGame(this);
    }
    // Advance the whole game by one frame of `delta` ms.
    step(delta) {
      this.scene.processQueue();
      this._time += delta;
      this.loop.delta = delta; this.loop.time = this._time;
      for (const s of this.scene.getScenes(true)) {
        if (!this.scene._active.has(s.__key)) continue;
        s.events.emit('preupdate', this._time, delta);
        s.time.update(this._time, delta);
        s.events.emit('update', this._time, delta);
        if (!this.scene._active.has(s.__key)) continue;
        if (typeof s.update === 'function') s.update(this._time, delta);
        s.events.emit('postupdate', this._time, delta);
      }
      this.scene.processQueue();
    }
    destroy() {}
  }

  const MathX = {
    Between: (min, max) => Math.floor(host.random() * (max - min + 1) + min),
    FloatBetween: (min = 0, max = 1) => host.random() * (max - min) + min,
    Clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    DegToRad: (d) => d * Math.PI / 180,
    RadToDeg: (r) => r * 180 / Math.PI,
    Linear: (a, b, t) => (b - a) * t + a,
    Wrap: (v, min, max) => { const r = max - min; return min + ((((v - min) % r) + r) % r); },
    Distance: { Between: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1) },
    Angle: { Between: (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1) },
  };

  return {
    AUTO: 0, CANVAS: 1, WEBGL: 2, HEADLESS: 3,
    Scene, Game,
    GameObjects: { GameObjectFactory, GameObject },
    Input: {
      Keyboard: {
        JustDown: (key) => { if (key && key._justDown) { key._justDown = false; return true; } return false; },
        JustUp: () => false,
        KeyCodes: { ESC: 27, SPACE: 32, ENTER: 13, UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39, E: 69, W: 87, A: 65, S: 83, D: 68 },
      },
    },
    Math: MathX,
    Scale: { FIT: 3, NONE: 0, RESIZE: 5, CENTER_BOTH: 1, CENTER_HORIZONTALLY: 2, CENTER_VERTICALLY: 3, NO_CENTER: 0 },
    Time: { Clock, TimerEvent },
    Events: { EventEmitter: Emitter },
  };
}

module.exports = { createPhaserStub };
