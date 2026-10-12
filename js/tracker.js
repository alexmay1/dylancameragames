import { clamp, lerp } from './util.js?v=23';

const LOCAL_BUNDLE = '../vendor/vision_bundle.mjs?v=23';
const LOCAL_WASM = new URL('../vendor/wasm', import.meta.url).href;
const LOCAL_MODEL = new URL('../vendor/hand_landmarker.task', import.meta.url).href;
const CDN_VER = '1.1.0';
const CDN_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${CDN_VER}/vision_bundle.mjs`;
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${CDN_VER}/wasm`;
const CDN_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

/** One-Euro filter: heavy smoothing when still, light lag when moving fast. */
class OneEuro {
  constructor(minCutoff = 1.0, beta = 6, dCutoff = 1.5) { this.mc = minCutoff; this.beta = beta; this.dc = dCutoff; this.x = null; this.dx = 0; }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v, dt) {
    if (this.x === null) { this.x = v; return v; }
    dt = Math.max(dt, 1e-3);
    const dv = (v - this.x) / dt;
    this.dx = lerp(this.dx, dv, OneEuro.alpha(this.dc, dt));
    const cutoff = this.mc + this.beta * Math.abs(this.dx);
    this.x = lerp(this.x, v, OneEuro.alpha(cutoff, dt));
    return this.x;
  }
}

export async function loadLandmarker(onStatus = () => {}, delegates = ['GPU', 'CPU']) {
  const attempts = [
    { name: 'local', bundle: LOCAL_BUNDLE, wasm: LOCAL_WASM, model: LOCAL_MODEL },
    { name: 'cdn', bundle: CDN_BUNDLE, wasm: CDN_WASM, model: CDN_MODEL },
  ];
  let lastErr = null;
  for (const a of attempts) {
    let mod;
    try { mod = await import(/* @vite-ignore */ a.bundle); } catch (e) { lastErr = e; console.warn('bundle failed', a.name, e); continue; }
    for (const delegate of delegates) {
      try {
        onStatus(`Loading hand tracking (${a.name === 'local' ? 'this site' : 'CDN'})…`);
        const fileset = await mod.FilesetResolver.forVisionTasks(a.wasm);
        const lm = await mod.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: a.model, delegate },
          runningMode: 'VIDEO', numHands: 2,
          // Tuned: slightly eager detection, lenient tracking (keeps lock through fast motion = smoother, fewer re-detections)
          minHandDetectionConfidence: 0.45, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4,
        });
        return { lm, source: a.name, delegate };
      } catch (e) { lastErr = e; console.warn('landmarker failed', a.name, delegate, e); }
    }
  }
  throw lastErr || new Error('Could not load hand tracking');
}

const PALM_IDS = [0, 5, 9, 13, 17];
export const HOLD_S = 0.15;     // keep a briefly-lost hand at its last position this long
const PREDICT_MAX_S = 0.09;     // never extrapolate further than this
const LATENCY_S = 0.03;         // display/camera latency we pre-compensate with velocity

export { OneEuro };

export class HandTracker {
  constructor() {
    this.lm = null; this.tracks = []; this.nextId = 1; this.lastVideoTime = -1; this.lastTs = 0;
    this.hands = []; this.detections = 0; this.info = ''; this.errors = 0; this.mode = 'poll';
    this.map = null; this.minDim = () => 300; this.video = null; this.looping = false; this.detFps = 0; this._fpsT = 0; this._fpsN = 0;
  }
  async init(onStatus) { const r = await loadLandmarker(onStatus); this.lm = r.lm; this.delegate = r.delegate; this.info = `${r.source}/${r.delegate}`; }

  /** Start per-frame detection. Uses requestVideoFrameCallback (a detection for every camera frame) when available. */
  start(video, map, minDim) {
    this.video = video; this.map = map; this.minDim = minDim;
    if (this.looping) return; this.looping = true;
    if ('requestVideoFrameCallback' in video) {
      this.mode = 'rVFC';
      const cb = (now) => { try { this.processFrame(now); } catch (e) { console.warn(e); } video.requestVideoFrameCallback(cb); };
      video.requestVideoFrameCallback(cb);
    } else this.mode = 'raf';
  }
  /** Called from the render loop; only does work when rVFC is unavailable. */
  poll(now) { if (this.mode === 'raf') this.processFrame(now); }

  async fallbackToCPU() {
    if (this.delegate === 'CPU' || this.reloading) return;
    this.reloading = true;
    try { const r = await loadLandmarker(() => {}, ['CPU']); this.lm = r.lm; this.delegate = 'CPU'; this.info = `${r.source}/CPU`; this.errors = 0; } catch (e) { console.warn('cpu fallback failed', e); }
    this.reloading = false;
  }

  processFrame(nowMs) {
    const video = this.video;
    if (!this.lm || this.reloading || !video || video.readyState < 2 || video.videoWidth === 0) return;
    if (video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;
    const ts = Math.max(nowMs, this.lastTs + 1); this.lastTs = ts;
    let res;
    try { res = this.lm.detectForVideo(video, ts); this.errors = 0; }
    catch (e) { console.warn('detect error', e); if (++this.errors >= 4) this.fallbackToCPU(); return; }
    this.detections++; this._fpsN++; if (nowMs - this._fpsT > 1000) { this.detFps = this._fpsN * 1000 / (nowMs - this._fpsT); this._fpsN = 0; this._fpsT = nowMs; }
    this.ingest((res && res.landmarks) || [], nowMs / 1000);
    if (this.onFrame) { try { this.onFrame(video, nowMs); } catch (e) { console.warn('onFrame', e); } }
  }

  /** landmark lists (normalised video coords) -> tracks. Matching is by position only, never by the left/right label,
   *  so label flips can't swap or mirror anything. */
  ingest(lists, t) {
    const map = this.map, minDim = this.minDim();
    const used = new Set();
    for (const lmk of lists) {
      let px = 0, py = 0;
      for (const i of PALM_IDS) { px += lmk[i].x; py += lmk[i].y; }
      px /= 5; py /= 5;
      let best = null, bd = 0.35;
      for (const tr of this.tracks) {
        if (used.has(tr)) continue;
        const d = Math.hypot(tr.nx - px, tr.ny - py);
        if (d < bd) { bd = d; best = tr; }
      }
      if (best && t - best.seen > 0.3) { best.f.forEach(f => { f.x = null; f.dx = 0; }); best.fresh = true; } // long gap: restart filters
      if (!best) {
        best = { id: this.nextId++, f: Array.from({ length: 42 }, () => new OneEuro(1.2, 9, 1.2)), pts: [], dpts: [], vel: { x: 0, y: 0 }, speed: 0, born: t, seen: t, nx: px, ny: py, palmT: null };
        for (let i = 0; i < 21; i++) { best.pts.push({ x: 0, y: 0 }); best.dpts.push({ x: 0, y: 0 }); }
        best.palm = { x: 0, y: 0 }; best.tip = { x: 0, y: 0 }; best.size = 50; best.fresh = true; best.placed = false;
        this.tracks.push(best);
      }
      used.add(best);
      { const slow = this.detFps > 0 && this.detFps < 22; for (const f of best.f) { f.beta = slow ? 14 : 9; f.mc = slow ? 1.5 : 1.2; } }  // adapt smoothing to the measured detection rate
      const dt = Math.min(Math.max(t - best.seen, 0.004), 0.3);
      best.nx = px; best.ny = py;
      for (let i = 0; i < 21; i++) {
        const fx = best.f[i * 2].filter(lmk[i].x, best.fresh ? 1 / 30 : dt);
        const fy = best.f[i * 2 + 1].filter(lmk[i].y, best.fresh ? 1 / 30 : dt);
        const m = map(fx, fy);
        best.pts[i].x = m.x; best.pts[i].y = m.y;
        if (best.fresh) { best.dpts[i].x = m.x; best.dpts[i].y = m.y; }
      }
      let cx = 0, cy = 0;
      for (const i of PALM_IDS) { cx += best.pts[i].x; cy += best.pts[i].y; }
      cx /= 5; cy /= 5;
      if (best.palmT && !best.fresh) {
        const vx = (cx - best.palmT.x) / dt / minDim, vy = (cy - best.palmT.y) / dt / minDim, a = 1 - Math.exp(-dt * 30); // time-based: same feel at 30 or 60 fps
        best.vel.x = lerp(best.vel.x, vx, a); best.vel.y = lerp(best.vel.y, vy, a);
      } else { best.vel.x = 0; best.vel.y = 0; }
      best.speed = Math.hypot(best.vel.x, best.vel.y);
      best.palmT = { x: cx, y: cy };
      best.size = Math.hypot(best.pts[0].x - best.pts[9].x, best.pts[0].y - best.pts[9].y);
      best.seen = t; best.fresh = false;
    }
  }

  /** Per-frame: velocity-predict, ease displayed points toward targets, hold dropouts ~150 ms, then drop the hand. */
  step(dt, nowMs, minDim = 300) {
    const t = nowMs / 1000, k = 1 - Math.exp(-dt * 35);
    this.tracks = this.tracks.filter(tr => t - tr.seen < 0.8);
    this.hands = [];
    for (const tr of this.tracks) {
      const stale = t - tr.seen;
      if (stale > HOLD_S) continue;
      // decay velocity once a detection is overdue (dropout or slow frame)
      if (stale > 0.06) { const d = Math.exp(-dt * 10); tr.vel.x *= d; tr.vel.y *= d; tr.speed = Math.hypot(tr.vel.x, tr.vel.y); }
      const lead = Math.min(stale, PREDICT_MAX_S) + LATENCY_S;
      let ox = tr.vel.x * lead * minDim, oy = tr.vel.y * lead * minDim;
      const om = Math.hypot(ox, oy), cap = minDim * .1; if (om > cap) { ox *= cap / om; oy *= cap / om; }
      for (let i = 0; i < 21; i++) { tr.dpts[i].x += (tr.pts[i].x + ox - tr.dpts[i].x) * k; tr.dpts[i].y += (tr.pts[i].y + oy - tr.dpts[i].y) * k; }
      let cx = 0, cy = 0;
      for (const i of PALM_IDS) { cx += tr.dpts[i].x; cy += tr.dpts[i].y; }
      tr.palm.x = cx / 5; tr.palm.y = cy / 5;
      tr.tip.x = tr.dpts[8].x; tr.tip.y = tr.dpts[8].y;
      tr.pointer = false;
      this.hands.push(tr);
    }
  }
}


/* ================= Body pose (for the unicycle mode) ================= */
const poseLocal = (v) => new URL(`../vendor/pose_landmarker_${v}.task`, import.meta.url).href;
const poseCdn = (v) => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${v}/float16/1/pose_landmarker_${v}.task`;

export async function loadPose(onStatus = () => {}, delegates = ['GPU', 'CPU'], variant = 'full') {
  const variants = variant === 'full' ? ['full', 'lite'] : ['lite'];
  const attempts = [];
  for (const v of variants) attempts.push({ name: 'local', variant: v, bundle: LOCAL_BUNDLE, wasm: LOCAL_WASM, model: poseLocal(v) });
  for (const v of variants) attempts.push({ name: 'cdn', variant: v, bundle: CDN_BUNDLE, wasm: CDN_WASM, model: poseCdn(v) });
  let lastErr = null;
  for (const a of attempts) {
    let mod;
    try { mod = await import(/* @vite-ignore */ a.bundle); } catch (e) { lastErr = e; continue; }
    for (const delegate of delegates) {
      try {
        onStatus('Loading body tracking…');
        const fileset = await mod.FilesetResolver.forVisionTasks(a.wasm);
        const lm = await mod.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: a.model, delegate }, runningMode: 'VIDEO', numPoses: 1,
          minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4,
        });
        return { lm, source: a.name, delegate, variant: a.variant };
      } catch (e) { lastErr = e; console.warn('pose failed', a.name, delegate, e); }
    }
  }
  throw lastErr || new Error('Could not load body tracking');
}

const BODY_IDS = [11, 12, 23, 24, 25, 26, 27, 28];
const ALL_IDS = [0, 13, 14, 15, 16, 31, 32, ...BODY_IDS];        // + nose and wrists (jumping jacks)
/** Pure analysis of (smoothed) pose landmarks -> balance inputs. lm[i] = {x,y,visibility} in normalised video coords. */
export function analyzeBody(lm, vw, vh, wasLifted = false) {
  const ok = BODY_IDS.every(i => lm[i] && (lm[i].visibility ?? 1) > 0.4 && lm[i].x > -0.02 && lm[i].x < 1.02 && lm[i].y > -0.02 && lm[i].y < 1.0);
  if (!ok) return { visible: false, lift: 0, lifted: false, swayN: 0 };
  const X = (i) => lm[i].x * vw, Y = (i) => lm[i].y * vh;
  const hipX = (X(23) + X(24)) / 2, hipY = (Y(23) + Y(24)) / 2, shX = (X(11) + X(12)) / 2, shY = (Y(11) + Y(12)) / 2;
  const torso = Math.max(10, Math.hypot(shX - hipX, shY - hipY));
  const lowIdx = Y(27) > Y(28) ? 27 : 28, highIdx = lowIdx === 27 ? 28 : 27;
  const legLen = Math.max(torso * .8, Y(lowIdx) - hipY);
  const ankleLift = (Y(lowIdx) - Y(highIdx)) / legLen, kneeLift = Math.abs(Y(25) - Y(26)) / legLen * .8;
  const lift = Math.max(ankleLift, kneeLift);
  const lifted = wasLifted ? lift > 0.06 : lift > 0.10; // hysteresis
  const baseX = lifted ? X(lowIdx) : (X(27) + X(28)) / 2;
  const swayN = -(hipX - baseX) / (torso * .5);          // minus: the on-screen view is mirrored, so + = lean to screen-right
  return { visible: true, lift, lifted, swayN };
}

export class PoseTracker {
  constructor() {
    this.lm = null; this.enabled = false; this.lastTs = 0; this.lastRun = -1e9; this.interval = 40; this.minInterval = 40; this.variant = ''; this.vis = 0; this.fps = 0; this._fn = 0; this._ft = 0; this.lastPts = -9; this.cost = 0; this.runs = 0; this.errors = 0;
    this.f = Array.from({ length: 33 }, () => [new OneEuro(1.0, 4, 1.0), new OneEuro(1.0, 4, 1.0)]);
    this.state = { visible: false, lifted: false, swayN: 0, lift: 0, pts: null, t: 0 };
    this.liftRaw = false; this.liftSince = 0; this.lastSeen = -1; this.lastFrameT = 0; this.info = '';
  }
  async init(onStatus) { const r = await loadPose(onStatus, ['GPU', 'CPU'], 'full'); this.lm = r.lm; this.delegate = r.delegate; this.variant = r.variant; this.info = `${r.variant}/${r.delegate}`; }
  async fallbackToCPU() {
    if (this.delegate === 'CPU' || this.reloading) return; this.reloading = true;
    try { const r = await loadPose(() => {}, ['CPU'], this.variant === 'lite' ? 'lite' : 'full'); this.lm = r.lm; this.delegate = 'CPU'; this.variant = r.variant; this.info = `${r.variant}/CPU`; this.errors = 0; this.runs = 0; this.cost = 0; } catch (e) { console.warn(e); }
    this.reloading = false;
  }
  /** If the heavier 'full' model is too slow on this device, switch to 'lite' (adaptive by measured cost). */
  async downgrade() {
    if (this.variant !== 'full' || this.reloading) return; this.reloading = true;
    try { const r = await loadPose(() => {}, [this.delegate === 'CPU' ? 'CPU' : 'GPU', 'CPU'], 'lite'); this.lm = r.lm; this.delegate = r.delegate; this.variant = 'lite'; this.info = `lite/${r.delegate}`; this.runs = 0; this.cost = 0; this.interval = this.minInterval; } catch (e) { console.warn(e); }
    this.reloading = false;
  }
  /** Runs at a reduced rate (~14 Hz, adaptive) alongside hand tracking. */
  process(video, nowMs) {
    if (!this.enabled || !this.lm || this.reloading || video.readyState < 2 || !video.videoWidth) return;
    if (nowMs - this.lastRun < this.interval) return;
    this.lastRun = nowMs; const ts = Math.max(nowMs, this.lastTs + 1); this.lastTs = ts;
    const t0 = performance.now(); let res;
    try { res = this.lm.detectForVideo(video, ts); this.errors = 0; } catch (e) { console.warn('pose error', e); if (++this.errors >= 4) this.fallbackToCPU(); return; }
    this.cost = this.cost * .7 + (performance.now() - t0) * .3;
    this.interval = Math.min(220, Math.max(this.minInterval, this.cost * 1.4)); // back off only if inference is slow (older iPads)
    this.runs++; this._fn++; if (nowMs - this._ft > 1000) { this.fps = this._fn * 1000 / (nowMs - this._ft); this._fn = 0; this._ft = nowMs; }
    if (this.variant === 'full' && this.runs >= 20 && this.cost > 60) this.downgrade();
    const raw = res && res.landmarks && res.landmarks[0];
    this.ingest(raw, nowMs / 1000, video.videoWidth, video.videoHeight);
  }
  ingest(raw, t, vw, vh) {
    const st = this.state; st.t = t;
    if (!raw) { st.visible = false; if (t - this.lastPts > .15) st.pts = null; return; }   // hold the last pose ~150 ms through a dropout
    this.lastPts = t;
    const dt = Math.min(Math.max(t - (this.lastFrameT || t - .07), .02), .4); this.lastFrameT = t;
    const lm = {};
    let vs = 0; for (const i of [11, 12, 23, 24]) vs += raw[i].visibility ?? 1; this.vis = vs / 4;
    for (const i of ALL_IDS) {
      const vis = raw[i].visibility ?? 1, k = .55 + .45 * Math.min(1, vis), fx = this.f[i][0], fy = this.f[i][1];   // less sure -> smoother
      fx.mc = fy.mc = (this.fps && this.fps < 15 ? 1.4 : 1.0) * k; fx.beta = fy.beta = this.fps && this.fps < 15 ? 6 : 4;
      lm[i] = { x: fx.filter(raw[i].x, dt), y: fy.filter(raw[i].y, dt), z: raw[i].z || 0, visibility: raw[i].visibility };
    }
    const a = analyzeBody(lm, vw, vh, this.liftRaw);
    st.pts = lm; st.vw = vw; st.vh = vh; st.visible = a.visible; st.lift = a.lift; st.swayN = a.swayN;
    if (a.visible) {
      this.lastSeen = t;
      if (a.lifted !== this.liftRaw) { this.liftRaw = a.lifted; this.liftSince = t; }
      if (st.lifted !== this.liftRaw && t - this.liftSince >= 0.1) st.lifted = this.liftRaw; // debounce ~100 ms
    }
  }
}

/** Mouse/touch stand-in for a hand (used when the camera is unavailable, or ?touch=1). */
export class PointerHand {
  constructor() { this.hand = { id: 'ptr', pointer: true, pts: [], dpts: [], palm: { x: 0, y: 0 }, tip: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, speed: 0, size: 70, seen: 0 }; this.down = false; this.lastMove = -9; this.prev = null; this.enabled = false; }
  attach(el) {
    const h = this.hand;
    const move = (e, down) => {
      if (!this.enabled) return;
      const now = performance.now() / 1000, r = el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (this.prev && now - this.prev.t > 0) {
        const dt = Math.max(now - this.prev.t, 0.004), m = Math.min(r.width, r.height);
        h.vel.x = lerp(h.vel.x, (x - this.prev.x) / dt / m, .5); h.vel.y = lerp(h.vel.y, (y - this.prev.y) / dt / m, .5);
        h.speed = Math.hypot(h.vel.x, h.vel.y);
      }
      this.prev = { x, y, t: now };
      h.palm.x = h.tip.x = x; h.palm.y = h.tip.y = y; h.size = Math.min(r.width, r.height) * .1;
      this.lastMove = now; if (down !== undefined) this.down = down; h.seen = now;
    };
    el.addEventListener('pointerdown', e => { move(e, true); });
    el.addEventListener('pointermove', e => move(e));
    const up = () => { this.down = false; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', () => { this.lastMove = -9; });
  }
  get() {
    if (!this.enabled) return null;
    const now = performance.now() / 1000;
    if (now - this.lastMove > 0.35 && !this.down) { this.hand.vel.x = this.hand.vel.y = this.hand.speed = 0; if (now - this.lastMove > 1.5) return null; }
    // decay velocity when pointer stops moving
    if (now - this.lastMove > 0.06) { this.hand.vel.x *= .8; this.hand.vel.y *= .8; this.hand.speed = Math.hypot(this.hand.vel.x, this.hand.vel.y); }
    return this.hand;
  }
}
