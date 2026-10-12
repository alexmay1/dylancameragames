import { HandTracker, PointerHand, PoseTracker, CONNECTIONS } from './tracker.js?v=23';
import { Sfx } from './audio.js?v=23';
import { store, clamp } from './util.js?v=23';
import { BubbleGame } from './games/bubble.js?v=23';
import { JuggleGame } from './games/juggle.js?v=23';
import { BaseballGame } from './games/baseball.js?v=23';
import { FootballGame } from './games/football.js?v=23';
import { JacksGame } from './games/jacks.js?v=23';
import { SoccerGame } from './games/soccer.js?v=23';
import { BowlingGame } from './games/bowling.js?v=23';
import { BasketballGame } from './games/basketball.js?v=23';
import { BoxingGame } from './games/boxing.js?v=23';
import { DodgeballGame } from './games/dodgeball.js?v=23';
import { GolfGame } from './games/golf.js?v=23';
import { FruitGame } from './games/fruit.js?v=23';
import { TennisGame } from './games/tennis.js?v=23';
import { CamCheckGame } from './games/camcheck.js?v=23';
import { PingPongGame } from './games/pingpong.js?v=23';
import { AirHockeyGame } from './games/airhockey.js?v=23';
import { WhackGame } from './games/whack.js?v=23';
import { RpsGame } from './games/rps.js?v=23';
import { ArcheryGame } from './games/archery.js?v=23';
import { VolleyballGame } from './games/volleyball.js?v=23';
import { HockeyGame } from './games/hockey.js?v=23';
import { SkiGame } from './games/ski.js?v=23';
//IMPORTS

const $ = (id) => document.getElementById(id);
const CODE_VERSION = '23', VERSION_NAME = 'v23 – skiing';
{ // version label: shows which page + code actually loaded (helps spot stale caches)
  const pageV = document.documentElement.dataset.ver, ok = pageV === CODE_VERSION;
  const txt = ok ? VERSION_NAME : `⚠ mixed versions (page ${pageV}, code ${CODE_VERSION}) – reload`;
  document.querySelectorAll('.verLabel').forEach(el => { el.textContent = txt; });
  window.APP_VERSION = VERSION_NAME;
}
const qs = new URLSearchParams(location.search);
const canvas = $('stage'), ctx = canvas.getContext('2d');
const video = $('cam');

const GAMES = { bubble: BubbleGame, juggle: JuggleGame, baseball: BaseballGame, football: FootballGame, jacks: JacksGame, soccer: SoccerGame,
  bowling: BowlingGame,
  basketball: BasketballGame,
  boxing: BoxingGame,
  dodgeball: DodgeballGame,
  golf: GolfGame,
  fruit: FruitGame,
  tennis: TennisGame,
  camcheck: CamCheckGame,
  pingpong: PingPongGame,
  airhockey: AirHockeyGame,
  whack: WhackGame,
  rps: RpsGame,
  archery: ArcheryGame,
  volleyball: VolleyballGame,
  hockey: HockeyGame,
  ski: SkiGame,
  //GAMES
};

const app = {
  W: 300, H: 300, min: 300, dpr: 1,
  sfx: new Sfx(),
  tracker: new HandTracker(),
  pointer: new PointerHand(),
  pose: new PoseTracker(), poseReady: false, balanceSim: false, simBalance: { lifted: false, sway: 0 },
  cameraOn: false, touchMode: false, trackerReady: false,
  game: null, gameId: null, gameOpts: {}, paused: false,
  hands: [], lastHandSeen: 0,
  /** Balance inputs for the unicycle mode: from body pose, or from the touch-test controls. */
  getBalance() {
    if (this.balanceSim) return { visible: true, lifted: this.simBalance.lifted, swayN: this.simBalance.sway * 1.3, sim: true };
    const s = this.pose.state, fresh = performance.now() / 1000 - s.t < 1.0;
    return { visible: fresh && s.visible, lifted: s.lifted, swayN: s.swayN, pts: fresh ? s.pts : null, lift: s.lift };
  },
  async ensurePose(onStatus) {
    if (this.touchMode && !this.cameraOn) { this.balanceSim = true; return 'sim'; }
    if (!this.poseReady) {
      try { await this.pose.init(onStatus); this.poseReady = true; this.tracker.onFrame = (v, t) => this.pose.process(v, t); }
      catch (e) { console.warn(e); this.balanceSim = true; return 'failed'; }
    }
    this.balanceSim = false; return 'pose';
  },
  mapPoint(nx, ny) { return mapPoint(nx, ny); },
  light: null, lastTracked: 0,
  /** Lightweight tracking-quality read-out used by the badge and the Camera check screen. */
  quality() {
    const now = performance.now() / 1000, poseOn = this.pose.enabled, ps = this.pose.state;
    const handsN = this.hands.filter(h => !h.pointer).length, bodyOk = poseOn && ps.pts && now - ps.t < .5 && this.pose.vis > .5;
    const tracked = handsN > 0 || bodyOk; if (tracked) this.lastTracked = now;
    const fps = poseOn ? Math.max(this.pose.fps, this.tracker.detFps * .5) : this.tracker.detFps, slow = fps > 0 && fps < 14;
    const gone = now - this.lastTracked;
    let level = 'good', tip = '';
    if (this.light !== null && this.light < 60) { level = 'low'; tip = 'Too dark — turn on a light'; }
    else if (gone > 2.5) { level = 'low'; tip = poseOn ? 'Step back 6–8 ft so your body fits' : 'Keep your hand in view of the camera'; }
    else if (!tracked) { level = 'ok'; tip = poseOn ? 'Looking for you…' : 'Looking for your hand…'; }
    else if (slow) { level = 'ok'; tip = 'Tracking is slow — close other apps'; }
    return { level, tip, icon: level === 'good' ? '🟢' : level === 'ok' ? '🟡' : '🔴', label: level === 'good' ? 'Good' : level === 'ok' ? 'OK' : 'Low' };
  },
  best(id) { return Number(store('cg_best_' + id)) || 0; },
  saveBest(id, v) { if (v > this.best(id)) { store('cg_best_' + id, v); return true; } return false; },
  setScore(n) { $('score').textContent = n; },
  setScoreLabel(s) { $('scoreLbl').textContent = s; },
  setLeft(h) { if ($('hudLeft').innerHTML !== h) $('hudLeft').innerHTML = h; },
  setRight(h) { if ($('hudRight').innerHTML !== h) $('hudRight').innerHTML = h; },
  hint(t) { const el = $('hint'); if (!t) { el.classList.add('hidden'); el._t = null; return; } if (el._t !== t) { el.textContent = t; el._t = t; } el.classList.remove('hidden'); },
  banner(html, ms = 1100) {
    const el = $('banner'); el.innerHTML = html; el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(el._to); if (ms) el._to = setTimeout(() => el.classList.add('hidden'), ms);
  },
  hideBanner() { $('banner').classList.add('hidden'); },
  showResult(r) {
    this.hint(null); this.hideBanner();
    const isBest = this.saveBest(this.gameId + (r.bestKey || ''), r.score);
    $('resEmoji').textContent = r.emoji || '🎉';
    $('resTitle').textContent = r.title || 'Great job!';
    $('resScore').textContent = r.score;
    const stats = (r.stats || []).concat([['Best', this.best(this.gameId + (r.bestKey || ''))]]);
    $('resStats').innerHTML = stats.map(([k, v]) => `<span>${k}: ${v}</span>`).join('') + (isBest && r.score > 0 ? '<span>🏆 New best!</span>' : '');
    $('socSwitch').classList.add('hidden'); const sb = $('switchBtn'); sb.classList.toggle('hidden', !r.switchTo); if (r.switchTo) { sb.dataset.role = r.switchTo; sb.textContent = r.switchLabel || '🔄 Switch'; }
    show('result'); this.sfx[isBest && r.score > 0 ? 'cheer' : 'over']();
    this.ended = true;
  },
};
window.app = app; // handy for debugging

/* ---------- screens ---------- */
const SCREENS = ['splash', 'errorPanel', 'menu', 'modePanel', 'uniPanel', 'jackPanel', 'soccerPanel', 'infoPanel', 'result'];
function show(name) { for (const s of SCREENS) $(s).classList.toggle('hidden', s !== name); $('hud').classList.add('hidden'); }
function hideScreens() { for (const s of SCREENS) $(s).classList.add('hidden'); }

function showMenu() {
  stopGame(); show('menu');
  $('menuNote').textContent = app.touchMode ? 'Touch mode: drag your finger on the screen instead of using your hands.' : 'Tip: stand back so your hands and arms fit on screen. Bright light helps!';
}

function startGame(id, opts = {}) {
  const G = GAMES[id]; if (!G) return;
  stopGame();
  app.gameId = id; app.gameOpts = opts; app.ended = false;
  hideScreens(); $('hud').classList.remove('hidden');
  app.setLeft(''); app.setRight(''); app.setScore(0); app.setScoreLabel('Score'); app.hint(null); app.hideBanner();
  app.simBalance.lifted = false; app.simBalance.sway = 0; $('simFoot').textContent = '🦶 Foot up: OFF'; $('simFoot').classList.remove('on'); $('simSway').value = 0;
  app.game = new G(app); app.game.start(opts);
}
function stopGame() { if (app.game && app.game.destroy) app.game.destroy(); app.pose.enabled = false; $('simPanel').classList.add('hidden'); $('jackTap').classList.add('hidden'); $('socSwitch').classList.add('hidden'); app.game = null; app.hint(null); app.hideBanner(); $('hud').classList.add('hidden'); }

document.querySelectorAll('.card').forEach(b => b.addEventListener('click', () => {
  app.sfx.init(); const id = b.dataset.game;
  if (id === 'juggle') show('modePanel');
  else if (id === 'jacks') { $('jackNote').textContent = app.touchMode && !app.cameraOn ? 'Touch test mode: you will tap a button to count each jumping jack.' : ''; show('jackPanel'); }
  else if (id === 'soccer') { $('socNote').textContent = app.touchMode && !app.cameraOn ? 'Touch test mode: swipe up on the screen to kick, drag your finger to be the goalie.' : ''; show('soccerPanel'); }
  else if (GAME_INFO[id]) showInfo(id);
  else startGame(id);
}));
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.mode === 'uni') {
    $('uniNote').textContent = app.touchMode && !app.cameraOn ? 'Touch test mode: use the on-screen “Foot up” button and Sway slider to balance.' : '';
    show('uniPanel');
  } else startGame('juggle', { mode: b.dataset.mode });
}));

/* ---------- generic instruction screen for the newer games ---------- */
const GAME_INFO = {
  bowling: { emoji: '🎳', title: 'Bowling', pose: false,
    steps: ['Hold your <b>hand up</b> where the camera can see it. The ball follows your hand left &amp; right — that’s your <b>aim</b>.', '<b>Swing your arm fast</b> like you’re rolling a ball, then <b>let go</b>. A harder swing = a faster ball.', '5 frames, 2 rolls each. Knock down all 10 pins for a <b>strike</b>! Strikes and spares earn bonus points.'],
    touch: 'Touch test mode: swipe your finger quickly across the screen to roll. Where you swipe sets the aim.' },
  basketball: { emoji: '🏀', title: 'Basketball', pose: false,
    steps: ['Hold a hand up in front of the camera. The ball follows your hand — <b>line it up under the hoop</b>.', '<b>Flick your hand UP fast</b> to shoot! A harder flick goes farther, so aim the power at how far the hoop is.', 'You have <b>60 seconds</b>. Score in a row for a <b>streak bonus</b>. The hoop moves after every basket, and a defender shows up later!'],
    touch: 'Touch test mode: swipe UP quickly. Start your swipe lined up with the hoop.' },
  boxing: { emoji: '🥊', title: 'Boxing', pose: true,
    steps: ['<b>Step back</b> so the camera sees your <b>head, shoulders and arms</b>. Prop the device up at chest height.', '<b>Punch toward the boxer</b> with either fist — fast and straight! Hit the glowing spots for <b>critical hits</b>.', 'When the boxer <b>cocks a fist and flashes red</b>, <b>lean away</b> to dodge it! 3 rounds of 45 seconds. Dodge, then counter-punch for extra damage!'],
    touch: 'Touch test mode: tap the left or right side of the boxer to punch. Hold your finger low on the screen, left or right, to lean and dodge.' },
  dodgeball: { emoji: '🏐', title: 'Dodgeball', pose: true,
    steps: ['<b>Stand back</b> so the camera sees your <b>head, shoulders and hands</b>. Your blue shadow at the bottom follows your body.', '<b>Sidestep</b> out of the way of red balls. <b>Duck</b> under the orange high balls!', '<b>Catch</b> a ball by putting your hand on it. Then <b>flick your hand UP</b> to throw it back and knock the other team out. You have 3 hearts!'],
    touch: 'Touch test mode: slide your finger left/right to sidestep, hold it low to duck. Hold your finger on a ball to catch it, then swipe UP to throw.' },
  golf: { emoji: '⛳', title: 'Golf', pose: false,
    steps: ['Hold a hand up where the camera can see it. <b>Hand left/right = aim</b> (the dotted line shows where the ball will go).', '<b>Swing your arm like a golf club</b>, then <b>let go</b> to hit. A harder swing goes farther. Watch the <b>wind</b> arrow!', 'Near the green the game switches to <b>PUTT</b> — swing <b>slow and gentle</b>. 3 holes: get the ball in the cup in as few strokes as you can. Avoid water 💦 and sand!'],
    touch: 'Touch test mode: swipe your finger across the screen and let go. Fast swipe = drive, slow swipe = putt. Where you swipe sets the aim.' },
  fruit: { emoji: '🍉', title: 'Fruit Slicer', pose: false,
    steps: ['Hold your hand up where the camera can see it. Your <b>fingertip is the blade</b> — you’ll see a glowing trail.', '<b>Swipe fast through the fruit</b> as it flies up! Slice several in one swipe for a <b>combo bonus</b>.', 'Don’t slice the <b>bombs 💣</b> — they cost you 5 points. You have <b>60 seconds</b>.'],
    touch: 'Touch test mode: swipe your finger quickly through the fruit.' },
  tennis: { emoji: '🎾', title: 'Tennis', pose: false,
    steps: ['Your <b>hand is the racket</b>. Hold it up where the camera sees it and slide it <b>left &amp; right under the ball</b> (the yellow ring shows where it will bounce).', '<b>Swing fast through the ball</b> when it reaches you. <b>Hand position</b> aims, and a <b>harder swing</b> hits it deeper. To serve, swing up fast (or wait for the auto-serve).', 'Points go to 4 for a game; first to <b>3 games</b> wins (or the 4-minute timer ends). The CPU gets a little better every game!'],
    touch: 'Touch test mode: slide your finger under the ball, then swipe quickly through it. Swipe up to serve.' },
  pingpong: { emoji: "\ud83c\udfd3", title: "Ping-Pong", pose: false,
    steps: ["Your <b>hand is the paddle</b>. Hold it up and slide it <b>left &amp; right under the ball</b> (the yellow ring shows where it will bounce on your side).", "<b>Swing fast through the ball</b> when it reaches you. <b>Hand position</b> aims, a <b>harder swing</b> hits harder, and a <b>sideways swing</b> adds spin.", "Score by making the CPU miss. <b>First to 11</b> points wins (or the 4:00 timer ends). Serve: swing your hand <b>up</b>."],
    touch: "Touch test mode: slide your finger under the ball, then swipe quickly through it. Swipe up to serve." },
  airhockey: { emoji: "\ud83c\udfd2", title: "Air Hockey", pose: false,
    steps: ["Hold your hand up where the camera sees it. <b>Your hand slides the red mallet</b> around <b>your half</b> of the table (the bottom half).", "<b>Hit the puck</b> into the CPU’s goal at the <b>top</b>. Move fast to hit harder; bank it off the walls!", "Block the puck from going into <b>your goal</b> at the bottom. <b>First to 7 goals</b> wins."],
    touch: "Touch test mode: drag your finger on the table to move the red mallet." },
  whack: { emoji: "\ud83d\udd28", title: "Whack-a-Mole", pose: false,
    steps: ["Hold your hand up where the camera sees it. You’ll see a <b>hammer</b> follow your hand.", "<b>Swat the moles</b> as they pop up — move your hand over them! <b>Golden moles</b> are worth 5. Don’t hit the <b>bombs 💣</b> (−5).", "Whack several in a row for a <b>combo bonus</b>. <b>2 players:</b> each gets a 30-second turn — pass the device and see who wins!"],
    touch: "Touch test mode: tap or swipe your finger over the moles.",
    modes: [["1 Player", {"players": 1}], ["2 Players (take turns)", {"players": 2}]] },
  rps: { emoji: "\u270c\ufe0f", title: "Rock Paper Scissors", pose: false,
    steps: ["Hold one hand up so the camera can see it clearly, <b>palm toward the camera</b>.", "Pump your fist with the beat: <b>ROCK… PAPER… SCISSORS… SHOOT!</b> On “SHOOT!” show <b>✊ rock</b> (fist), <b>✋ paper</b> (open hand) or <b>✌️ scissors</b> (two fingers).", "The game shows what it sees (“I see: ✋ paper”). <b>First to 3 round wins</b> takes the match. Ties go again!"],
    touch: "Touch test mode: tap the ROCK / PAPER / SCISSORS buttons before “SHOOT!”." },
  archery: { emoji: "\ud83c\udff9", title: "Archery", pose: false,
    steps: ["<b>One hand:</b> hold your hand steady to <b>aim</b> the red crosshair. The crosshair stays where you were aiming.", "To shoot, <b>pull your hand DOWN fast</b> (like drawing a bowstring), then <b>swing it back UP</b> to release. A longer pull = more power — keep it in the green zone!", "<b>Two hands:</b> your left hand aims; spread your hands apart to draw, then bring them together to release. Watch the <b>wind 💨</b> and the <b>distance</b>. <b>10 arrows</b>, 10 points each for a bullseye."],
    touch: "Touch test mode: move/press to aim, drag DOWN to pull the bow back, let go to shoot." },
  volleyball: { emoji: "\ud83c\udfd0", title: "Volleyball", pose: false,
    steps: ["<b>BUMP:</b> when the CPU sends the ball over, slide your hand under it (the <b>yellow ring</b> shows where it lands) and <b>swing UP</b> to pop it up near the net.", "<b>SPIKE:</b> as the ball floats down near the net, move your hand up to it and <b>swing FAST DOWN</b>! A bigger swing is a harder spike. A gentle swing just taps it over.", "Win a rally by landing the ball on the CPU’s side. <b>First to 11</b> points wins. Serve with a swing <b>UP</b>."],
    touch: "Touch test mode: slide under the ball and swipe UP to bump. Then swipe DOWN fast on the ball near the net to spike." },
  hockey: { emoji: "\ud83c\udfd2", title: "Hockey Shootout", pose: false,
    steps: ["<b>Shooter:</b> hold your hand up and <b>swing it fast like a hockey stick</b>. <b>Hand left/right = aim</b>. Swing <b>UP</b> to lift the puck high, swing flat to keep it low. A harder swing is a faster shot!", "The goalie guesses which way to dive — shoot to the <b>corners</b> and use a <b>hard swing</b> to beat him. <b>5 shots</b> per round.", "<b>Goalie:</b> use the <b>Switch</b> button (in the game or on the results screen) — then your hand is the <b>glove</b>. Move it to block the puck!"],
    touch: "Touch test mode: swipe fast across the screen to shoot (swipe up to lift it). As goalie, drag your finger to move the glove.",
    modes: [["🏒 Shooter", {"role": "shoot"}], ["🥅 Goalie", {"role": "goalie"}]] },
  ski: { emoji: "\u26f7\ufe0f", title: "Skiing", pose: true,
    steps: ["<b>Step back</b> so the camera sees your <b>head and shoulders</b> (prop the device up at chest height). Stand <b>tall in the middle</b> for a moment — the game learns your center.", "<b>LEAN your body left or right</b> to steer your skier. Lean more to turn harder. Dodge the <b>trees 🌲 and rocks</b>!", "Ski <b>through the gates 🚩</b> (+25) and over <b>ramps</b> (+15). You get <b>3 lives</b> and <b>60 seconds</b> — you go faster and faster!"],
    touch: "Touch test mode: slide your finger left or right across the screen to steer." },
  //INFO
};
let infoId = null, infoOpts = {};
function showInfo(id) {
  const g = GAME_INFO[id]; infoId = id;
  $('infoTitle').textContent = g.emoji + ' ' + g.title;
  $('infoSteps').innerHTML = g.steps.map((t, i) => `<li><span>${i + 1}</span><div>${t}</div></li>`).join('');
  $('infoNote').textContent = app.touchMode && !app.cameraOn ? g.touch : '';
  infoOpts = g.modes ? { ...g.modes[0][1] } : {}; const mb = $('infoModes'); mb.classList.toggle('hidden', !g.modes); mb.innerHTML = '';
  (g.modes || []).forEach(([label, o], i) => { const b = document.createElement('button'); b.className = 'mode' + (i ? '' : ' on'); b.textContent = label; b.onclick = () => { infoOpts = { ...o }; [...mb.children].forEach(c => c.classList.toggle('on', c === b)); }; mb.appendChild(b); });
  show('infoPanel');
}
$('infoBack').addEventListener('click', showMenu);
$('infoGo').addEventListener('click', async () => {
  const g = GAME_INFO[infoId], btn = $('infoGo'); btn.disabled = true; app.sfx.init();
  if (g.pose) {
    const r = await app.ensurePose((s) => { $('infoNote').textContent = s; });
    if (r === 'failed') { $('infoNote').textContent = 'Body tracking could not load, so you can play by touching the screen instead.'; await new Promise(res => setTimeout(res, 1600)); }
  }
  btn.disabled = false; startGame(infoId, infoOpts);
});
$('camCheckBtn').addEventListener('click', async () => {
  app.sfx.init(); const btn = $('camCheckBtn'); btn.disabled = true; $('menuNote').textContent = '';
  if (app.cameraOn) { const r = await app.ensurePose((s) => { $('menuNote').textContent = s; }); if (r === 'failed') $('menuNote').textContent = 'Body tracking could not load.'; }
  btn.disabled = false; startGame('camcheck');
});
$('socBack').addEventListener('click', showMenu);
async function startSoccer(role) {
  const btns = [$('socKick'), $('socGoalie')]; btns.forEach(b => b.disabled = true); app.sfx.init();
  const r = await app.ensurePose((s) => { $('socNote').textContent = s; });
  btns.forEach(b => b.disabled = false);
  if (r === 'failed') { $('socNote').textContent = 'Body tracking could not load, so you can play by touching the screen instead.'; await new Promise(res => setTimeout(res, 1600)); }
  startGame('soccer', { role });
}
app.startRole = (role) => startGame(app.gameId, { role });
$('socKick').addEventListener('click', () => startSoccer('kick'));
$('socGoalie').addEventListener('click', () => startSoccer('goalie'));
$('switchBtn').addEventListener('click', () => startGame(app.gameId, { role: $('switchBtn').dataset.role }));
$('jackBack').addEventListener('click', showMenu);
$('jackReady').addEventListener('click', async () => {
  const btn = $('jackReady'); btn.disabled = true; app.sfx.init();
  const r = await app.ensurePose((s) => { $('jackNote').textContent = s; });
  btn.disabled = false;
  if (r === 'failed') { $('jackNote').textContent = 'Body tracking could not load, so you can tap a button to count instead.'; await new Promise(res => setTimeout(res, 1600)); }
  startGame('jacks');
});
$('uniBack').addEventListener('click', () => show('modePanel'));
$('uniReady').addEventListener('click', async () => {
  const btn = $('uniReady'); btn.disabled = true; app.sfx.init();
  const r = await app.ensurePose((s) => { $('uniNote').textContent = s; });
  btn.disabled = false;
  if (r === 'failed') { $('uniNote').textContent = 'Body tracking could not load, so we will use the on-screen buttons instead.'; await new Promise(res => setTimeout(res, 1600)); }
  startGame('juggle', { mode: 'uni' });
});
$('simFoot').addEventListener('click', () => { const s = app.simBalance; s.lifted = !s.lifted; $('simFoot').textContent = '🦶 Foot up: ' + (s.lifted ? 'ON' : 'OFF'); $('simFoot').classList.toggle('on', s.lifted); });
$('simSway').addEventListener('input', (e) => { app.simBalance.sway = Number(e.target.value) / 100; });
$('modeBack').addEventListener('click', showMenu);
$('backBtn').addEventListener('click', showMenu);
$('menuBtn').addEventListener('click', showMenu);
$('againBtn').addEventListener('click', () => startGame(app.gameId, app.gameOpts));
$('muteBtn').addEventListener('click', () => { app.sfx.setMuted(!app.sfx.muted); $('muteBtn').textContent = app.sfx.muted ? '🔇' : '🔊'; });

/* ---------- camera ---------- */
let stream = null;
function friendlyCamError(e) {
  const n = e && e.name;
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
    return ['Camera needs a secure page', 'This page must be opened with https:// so Safari will allow the camera. Check the address starts with https.'];
  if (n === 'NotAllowedError' || n === 'SecurityError')
    return ['Camera is blocked', 'Camera permission was not allowed. Tap the “aA” button in Safari’s address bar → Website Settings → Camera → Allow, then tap Try again. (If it keeps failing: Settings → Safari → Camera → Ask or Allow.)'];
  if (n === 'NotFoundError' || n === 'OverconstrainedError')
    return ['No camera found', 'We couldn’t find a front camera on this device. You can still play by touching the screen.'];
  if (n === 'NotReadableError' || n === 'AbortError')
    return ['Camera is busy', 'Another app (like FaceTime or Zoom) may be using the camera. Close it, then tap Try again.'];
  return ['Camera trouble', 'Something went wrong starting the camera' + (e && e.message ? ` (${e.message})` : '') + '. Tap Try again, or play with touch.'];
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('no mediaDevices'), { name: 'SecurityError' });
  if (stream) stream.getTracks().forEach(t => t.stop());
  // Best sensible quality first (720p @ up to 60fps; iOS picks the closest it supports), then relax.
  const tries = [
    { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60, min: 24 } },
    { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30 } },
    { facingMode: 'user' },
  ];
  let lastErr = null; stream = null;
  for (const v of tries) {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: v }); break; }
    catch (e) { lastErr = e; if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'NotFoundError')) throw e; }
  }
  if (!stream) throw lastErr || new Error('camera failed');
  video.srcObject = stream; video.muted = true; video.playsInline = true; video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
  await video.play();
  const tr = stream.getVideoTracks()[0];
  tr.addEventListener('ended', () => { app.cameraOn = false; stopGame(); showError(['Camera stopped', 'The camera turned off (maybe another app took it). Tap Try again.']); });
  app.cameraOn = true;
}

function showError([title, msg]) { $('errTitle').textContent = title; $('errMsg').textContent = msg; show('errorPanel'); }

let trackerPromise = null;
function loadTracker() {
  if (!trackerPromise) {
    trackerPromise = app.tracker.init((s) => { $('startStatus').textContent = s; })
      .then(() => { app.trackerReady = true; })
      .catch((e) => { trackerPromise = null; throw e; });
  }
  return trackerPromise;
}

async function onStart() {
  const btn = $('startBtn'); btn.disabled = true;
  app.sfx.init();
  $('startStatus').textContent = 'Starting camera…';
  // getUserMedia must be reached directly from the tap for iOS Safari
  if (!qs.has('touch')) {
    try { await startCamera(); }
    catch (e) { console.warn(e); btn.disabled = false; $('startStatus').textContent = ''; showError(friendlyCamError(e)); return; }
  } else { app.touchMode = true; app.pointer.enabled = true; }
  if (app.cameraOn) {
    $('startStatus').textContent = 'Loading hand tracking… (first time takes a few seconds)';
    try { await loadTracker(); }
    catch (e) {
      console.warn(e); btn.disabled = false; $('startStatus').textContent = '';
      showError(['Couldn’t load hand tracking', 'We need an internet connection the first time to load the hand-tracking brain. Check Wi‑Fi and tap Try again, or play with touch.']);
      return;
    }
  }
  btn.disabled = false; $('startStatus').textContent = '';
  showMenu();
}
$('startBtn').addEventListener('click', onStart);
$('retryBtn').addEventListener('click', () => { show('splash'); onStart(); });
$('touchBtn').addEventListener('click', () => { app.touchMode = true; app.pointer.enabled = true; app.sfx.init(); showMenu(); });
app.pointer.attach(canvas);
if (qs.has('touch')) app.pointer.enabled = true;
// start loading the model right away (no camera needed) so Start feels quick
if (!qs.has('touch')) loadTracker().catch(() => {});

// quality badge + cheap brightness probe (4 Hz / 1 Hz, tiny canvas)
const qb = $('qBadge'), probe = document.createElement('canvas'); probe.width = 32; probe.height = 24; const pctx = probe.getContext('2d', { willReadFrequently: true });
setInterval(() => {
  const on = app.game && app.cameraOn && !app.ended;
  if (app.cameraOn && video.readyState >= 2 && (on || app.gameId === 'camcheck') && performance.now() - (app._lp || 0) > 1000) {
    app._lp = performance.now(); try { pctx.drawImage(video, 0, 0, 32, 24); const d = pctx.getImageData(0, 0, 32, 24).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; app.light = s / (d.length / 4); } catch (e) { /* optional */ }
  }
  if (!on || app.gameId === 'camcheck') { qb.classList.add('hidden'); return; }
  const q = app.quality(); qb.classList.remove('hidden'); qb.dataset.level = q.level; qb.textContent = q.level === 'good' ? '🟢 Tracking good' : `${q.icon} ${q.tip || 'Tracking ' + q.label}`;
}, 250);
document.addEventListener('visibilitychange', () => { app.paused = document.hidden; if (!document.hidden) last = performance.now(); });

/* ---------- layout / mapping ---------- */
function resize() {
  const w = window.innerWidth, h = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (w === app.W && h === app.H && dpr === app.dpr) return;
  app.W = w; app.H = h; app.min = Math.min(w, h); app.dpr = dpr;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  if (app.game && app.game.resize) app.game.resize();
}
// normalised video coords -> mirrored, "cover"-fitted screen px
function mapPoint(nx, ny) {
  const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
  const s = Math.max(app.W / vw, app.H / vh), dw = vw * s, dh = vh * s, ox = (app.W - dw) / 2, oy = (app.H - dh) / 2;
  return { x: app.W - (ox + nx * dw), y: oy + ny * dh };
}

/* ---------- drawing ---------- */
let bgT = 0;
function drawBackground(dt) {
  const W = app.W, H = app.H;
  if (app.cameraOn && video.readyState >= 2 && video.videoWidth) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const s = Math.max(W / vw, H / vh), dw = vw * s, dh = vh * s, ox = (W - dw) / 2, oy = (H - dh) / 2;
    ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); ctx.drawImage(video, ox, oy, dw, dh); ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(0, 0, W, H); // bright & friendly
  } else {
    bgT += dt;
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#5ec8ff'); g.addColorStop(1, '#c9f1ff');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    for (let i = 0; i < 4; i++) { const x = ((bgT * 12 + i * W / 3.2) % (W + 200)) - 100, y = H * (.12 + i * .13); ctx.beginPath(); ctx.ellipse(x, y, 90, 30, 0, 0, 6.3); ctx.ellipse(x + 50, y + 8, 70, 26, 0, 0, 6.3); ctx.fill(); }
  }
}
function drawHands(hands) {
  for (const h of hands) {
    if (h.pointer) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.strokeStyle = '#ff4fa3'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(h.tip.x, h.tip.y, app.min * .03, 0, 6.3); ctx.fill(); ctx.stroke(); continue; }
    const P = h.dpts;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = Math.max(4, app.min * .008);
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.shadowColor = 'rgba(120,80,255,.9)'; ctx.shadowBlur = 10;
    ctx.beginPath(); for (const [a, b] of CONNECTIONS) { ctx.moveTo(P[a].x, P[a].y); ctx.lineTo(P[b].x, P[b].y); } ctx.stroke();
    ctx.shadowBlur = 0;
    for (let i = 0; i < 21; i++) { ctx.fillStyle = [4, 8, 12, 16, 20].includes(i) ? '#ffe45e' : 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(P[i].x, P[i].y, [4, 8, 12, 16, 20].includes(i) ? app.min * .011 : app.min * .0065, 0, 6.3); ctx.fill(); }
    // glowing index fingertip
    ctx.fillStyle = 'rgba(255,80,170,.9)'; ctx.beginPath(); ctx.arc(P[8].x, P[8].y, app.min * .02, 0, 6.3); ctx.fill();
    ctx.restore();
  }
}

/* ---------- main loop ---------- */
let last = performance.now(), fpsT = 0, fpsN = 0, fps = 0;
const dbg = $('debug'); if (qs.has('debug')) dbg.classList.remove('hidden');
function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
  resize();
  if (app.paused) return;
  if (app.cameraOn && app.trackerReady) { app.tracker.start(video, mapPoint, () => app.min); app.tracker.poll(now); }
  app.tracker.step(dt, now, app.min);
  const hands = app.tracker.hands.slice();
  const ph = app.pointer.get(); if (ph) hands.push(ph);
  app.hands = hands;
  if (hands.length) app.lastHandSeen = now;

  ctx.setTransform(app.dpr, 0, 0, app.dpr, 0, 0); ctx.globalAlpha = 1;
  drawBackground(dt);
  if (app.game && !app.ended) app.game.update(dt, hands);
  if (app.game) app.game.draw(ctx);
  drawHands(hands);

  if (qs.has('debug')) { fpsN++; fpsT += dt; if (fpsT > 1) { fps = fpsN / fpsT; fpsN = 0; fpsT = 0; } dbg.textContent = `fps ${fps.toFixed(0)} det ${app.tracker.detFps.toFixed(0)}/s ${app.tracker.mode} hands ${hands.length} pose ${app.pose.enabled ? app.pose.runs + '@' + app.pose.interval.toFixed(0) + 'ms/' + app.pose.cost.toFixed(0) : 'off'} ${app.tracker.info} ${app.W}x${app.H}`; }
}
resize();
requestAnimationFrame(frame);
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
// block iOS pinch/double-tap zoom & scrolling
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('touchmove', e => { if (e.target === canvas) e.preventDefault(); }, { passive: false });
