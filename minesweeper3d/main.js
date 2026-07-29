import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------- 設定 ----------

const DIFFICULTY = {
  4: { size: 4, mines: 8 },
  5: { size: 5, mines: 15 },
  6: { size: 6, mines: 30 },
};

const SPACING = 1.0;      // マス間隔
const CUBE_SIZE = 0.86;   // 立方体の一辺（隙間を作って構造を見せる）

const NUMBER_COLORS = [
  null,
  '#58a6ff', '#3fb950', '#f85149', '#bc8cff',
  '#d29922', '#39c5cf', '#ff7b72', '#e6edf7',
];
const numberColor = (n) => NUMBER_COLORS[Math.min(n, 8)];

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Three.js セットアップ ----------

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x0a0e1a);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0a0e1a, 18, 40);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.9;
controls.minDistance = 4;
controls.maxDistance = 30;
controls.enablePan = false;

scene.add(new THREE.AmbientLight(0xbfd4ff, 0.55));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
keyLight.position.set(5, 8, 6);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x6ea8ff, 0.8);
rimLight.position.set(-6, -4, -5);
scene.add(rimLight);

const cubeGroup = new THREE.Group();
const labelGroup = new THREE.Group();
scene.add(cubeGroup, labelGroup);

// ジオメトリ・マテリアルは全マス共有
const cubeGeometry = new RoundedBoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE, 3, 0.09);
const baseMaterial = new THREE.MeshStandardMaterial({
  color: 0x33415e, roughness: 0.42, metalness: 0.25,
});
const flagMaterial = new THREE.MeshStandardMaterial({
  color: 0xd29922, roughness: 0.4, metalness: 0.2,
  emissive: 0x7a4d00, emissiveIntensity: 0.5,
});
const mineMaterial = new THREE.MeshStandardMaterial({
  color: 0xf85149, roughness: 0.35, metalness: 0.2,
  emissive: 0xff2211, emissiveIntensity: 0.7,
});
const safeMaterial = new THREE.MeshStandardMaterial({
  color: 0x3fb950, roughness: 0.4, metalness: 0.2,
  emissive: 0x0a5c22, emissiveIntensity: 0.6,
});

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- 数字スプライト ----------

const labelTextureCache = new Map();
function labelTexture(n) {
  if (labelTextureCache.has(n)) return labelTextureCache.get(n);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.font = '700 88px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = numberColor(n);
  ctx.fillText(String(n), 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  labelTextureCache.set(n, tex);
  return tex;
}

// ---------- ゲーム状態 ----------

const state = {
  size: 5,
  mineCount: 15,
  cells: [],          // { mine, adj, revealed, flagged, mesh, label, pos }
  started: false,     // 初手を掘ったか（地雷はここで配置）
  over: false,
  flags: 0,
  revealedCount: 0,
  startTime: 0,
  elapsed: 0,
};

const idx = (x, y, z) => x + y * state.size + z * state.size * state.size;

function* neighbors(i) {
  const N = state.size;
  const x = i % N, y = Math.floor(i / N) % N, z = Math.floor(i / (N * N));
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy && !dz) continue;
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < 0 || ny < 0 || nz < 0 || nx >= N || ny >= N || nz >= N) continue;
        yield idx(nx, ny, nz);
      }
}

function newGame() {
  // 前回の盤面を破棄
  for (const cell of state.cells) {
    if (cell.mesh) cubeGroup.remove(cell.mesh);
    if (cell.label) { labelGroup.remove(cell.label); cell.label.material.dispose(); }
  }
  animations.length = 0;

  const conf = DIFFICULTY[state.size];
  state.mineCount = conf.mines;
  state.cells = [];
  state.started = false;
  state.over = false;
  state.flags = 0;
  state.revealedCount = 0;
  state.elapsed = 0;
  stopTimer();

  const N = state.size;
  const offset = ((N - 1) * SPACING) / 2;
  for (let z = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const pos = new THREE.Vector3(x * SPACING - offset, y * SPACING - offset, z * SPACING - offset);
        const mesh = new THREE.Mesh(cubeGeometry, baseMaterial);
        mesh.position.copy(pos);
        mesh.userData.index = state.cells.length;
        cubeGroup.add(mesh);
        state.cells.push({ mine: false, adj: 0, revealed: false, flagged: false, mesh, label: null, pos });
      }

  const dist = N * 2.4;
  camera.position.set(dist * 0.8, dist * 0.62, dist);
  controls.target.set(0, 0, 0);
  controls.update();

  updateHUD();
  hideModal(resultModal);
}

// 初手のマスとその周囲を避けて地雷を配置（初手は必ず安全）
function placeMines(firstIndex) {
  const total = state.cells.length;
  const excluded = new Set([firstIndex, ...neighbors(firstIndex)]);
  const candidates = [];
  for (let i = 0; i < total; i++) if (!excluded.has(i)) candidates.push(i);

  // 除外しすぎて地雷が置けない場合は初手マスのみ除外に緩和
  const pool = candidates.length >= state.mineCount
    ? candidates
    : [...Array(total).keys()].filter((i) => i !== firstIndex);

  for (let placed = 0; placed < state.mineCount; placed++) {
    const k = Math.floor(Math.random() * pool.length);
    state.cells[pool[k]].mine = true;
    pool.splice(k, 1);
  }
  for (let i = 0; i < total; i++) {
    if (state.cells[i].mine) continue;
    let n = 0;
    for (const j of neighbors(i)) if (state.cells[j].mine) n++;
    state.cells[i].adj = n;
  }
}

// ---------- 掘る・旗 ----------

function dig(i) {
  const cell = state.cells[i];
  if (state.over || cell.revealed || cell.flagged) return;

  if (!state.started) {
    placeMines(i);
    state.started = true;
    startTimer();
  }

  if (cell.mine) return explode(i);

  // ゼロマスは連鎖で開く（反復flood fill）
  const opened = [];
  const stack = [i];
  const seen = new Set([i]);
  while (stack.length) {
    const j = stack.pop();
    const c = state.cells[j];
    if (c.revealed || c.flagged) continue;
    c.revealed = true;
    state.revealedCount++;
    opened.push(j);
    if (c.adj === 0)
      for (const k of neighbors(j))
        if (!seen.has(k)) { seen.add(k); stack.push(k); }
  }

  // 掘った起点から波紋状に消えるよう距離順にディレイ
  const origin = state.cells[i].pos;
  for (const j of opened) {
    const c = state.cells[j];
    const delay = reducedMotion ? 0 : c.pos.distanceTo(origin) * 60;
    animateRevealCube(c, delay);
    if (c.adj > 0) addLabel(c, delay);
  }

  updateHUD();
  checkWin();
}

function toggleFlag(i) {
  const cell = state.cells[i];
  if (state.over || cell.revealed) return;
  cell.flagged = !cell.flagged;
  state.flags += cell.flagged ? 1 : -1;
  cell.mesh.material = cell.flagged ? flagMaterial : baseMaterial;
  pulse(cell.mesh);
  updateHUD();
}

function addLabel(cell, delay = 0) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: labelTexture(cell.adj),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  }));
  sprite.position.copy(cell.pos);
  sprite.scale.setScalar(0.66);
  labelGroup.add(sprite);
  cell.label = sprite;
  animations.push({ type: 'labelIn', target: sprite, t: -delay, dur: 250 });
}

// ---------- 勝敗 ----------

function explode(i) {
  state.over = true;
  stopTimer();
  const origin = state.cells[i].pos;
  for (const cell of state.cells) {
    if (!cell.mine || cell.revealed) continue;
    cell.mesh.material = mineMaterial;
    const delay = reducedMotion ? 0 : cell.pos.distanceTo(origin) * 90;
    animations.push({ type: 'shake', target: cell.mesh, base: cell.pos.clone(), t: -delay, dur: 700 });
  }
  shakeCamera();
  setTimeout(() => showResult(false), reducedMotion ? 300 : 1200);
}

function checkWin() {
  const safeTotal = state.cells.length - state.mineCount;
  if (state.revealedCount < safeTotal) return;
  state.over = true;
  stopTimer();
  for (const cell of state.cells) {
    if (!cell.mine) continue;
    cell.mesh.material = safeMaterial;
    pulse(cell.mesh);
  }
  setTimeout(() => showResult(true), reducedMotion ? 300 : 900);
}

function showResult(won) {
  const emoji = document.getElementById('resultEmoji');
  const title = document.getElementById('resultTitle');
  const text = document.getElementById('resultText');
  const best = document.getElementById('resultBest');

  if (won) {
    const sec = Math.floor(state.elapsed / 1000);
    const key = `minecube-best-${state.size}`;
    const prev = Number(localStorage.getItem(key)) || Infinity;
    const isBest = sec < prev;
    if (isBest) localStorage.setItem(key, String(sec));
    emoji.textContent = '🎉';
    title.textContent = 'CLEAR!';
    text.textContent = `全マス解除！ タイム ${formatTime(sec * 1000)}`;
    best.textContent = isBest
      ? '★ ベスト記録更新！'
      : `ベスト記録: ${formatTime(Math.min(prev, sec) * 1000)}`;
  } else {
    emoji.textContent = '💥';
    title.textContent = 'GAME OVER';
    text.textContent = '爆弾を掘ってしまった…';
    best.textContent = '';
  }
  showModal(resultModal);
}

// ---------- アニメーション ----------

const animations = [];

function animateRevealCube(cell, delay = 0) {
  animations.push({ type: 'revealCube', target: cell.mesh, t: -delay, dur: reducedMotion ? 1 : 300 });
}

function pulse(mesh) {
  if (reducedMotion) return;
  animations.push({ type: 'pulse', target: mesh, t: 0, dur: 260 });
}

let camShake = 0;
function shakeCamera() {
  if (!reducedMotion) camShake = 1;
}

function stepAnimations(dt) {
  for (let i = animations.length - 1; i >= 0; i--) {
    const a = animations[i];
    a.t += dt;
    if (a.t < 0) continue;
    const p = Math.min(a.t / a.dur, 1);
    const ease = 1 - (1 - p) ** 3;

    if (a.type === 'revealCube') {
      a.target.scale.setScalar(1 - ease);
      if (p >= 1) { cubeGroup.remove(a.target); a.target.scale.setScalar(1); }
    } else if (a.type === 'labelIn') {
      a.target.material.opacity = ease;
      a.target.scale.setScalar(0.66 * (0.5 + 0.5 * ease));
    } else if (a.type === 'pulse') {
      const s = 1 + 0.18 * Math.sin(p * Math.PI);
      a.target.scale.setScalar(s);
      if (p >= 1) a.target.scale.setScalar(1);
    } else if (a.type === 'shake') {
      const amp = 0.06 * (1 - p);
      a.target.position.set(
        a.base.x + (Math.random() - 0.5) * amp,
        a.base.y + (Math.random() - 0.5) * amp,
        a.base.z + (Math.random() - 0.5) * amp,
      );
      if (p >= 1) a.target.position.copy(a.base);
    }
    if (p >= 1) animations.splice(i, 1);
  }

  if (camShake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * 0.1 * camShake;
    camera.position.y += (Math.random() - 0.5) * 0.1 * camShake;
    camShake *= 0.88;
  }
}

// ---------- 入力（回転と掘るの判別） ----------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let flagMode = false;
let downPos = null;
let longPressTimer = null;
let longPressFired = false;

function pickCell(clientX, clientY) {
  pointer.x = (clientX / innerWidth) * 2 - 1;
  pointer.y = -(clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const targets = cubeGroup.children.filter((m) => !state.cells[m.userData.index].revealed);
  const hit = raycaster.intersectObjects(targets, false)[0];
  return hit ? hit.object.userData.index : null;
}

canvas.addEventListener('pointerdown', (e) => {
  downPos = { x: e.clientX, y: e.clientY };
  longPressFired = false;
  canvas.classList.add('dragging');

  // タッチの長押しで旗
  if (e.pointerType === 'touch') {
    longPressTimer = setTimeout(() => {
      const i = pickCell(e.clientX, e.clientY);
      if (i !== null) {
        longPressFired = true;
        toggleFlag(i);
        if (navigator.vibrate) navigator.vibrate(30);
      }
    }, 450);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 8) {
    clearTimeout(longPressTimer);
  }
  if (!downPos && e.pointerType === 'mouse') {
    canvas.classList.toggle('pointing', pickCell(e.clientX, e.clientY) !== null);
  }
});

canvas.addEventListener('pointerup', (e) => {
  clearTimeout(longPressTimer);
  canvas.classList.remove('dragging');
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > 8 || longPressFired) return; // ドラッグ（回転）や長押し済みはタップ扱いしない

  const i = pickCell(e.clientX, e.clientY);
  if (i === null) return;
  if (e.button === 2 || flagMode) toggleFlag(i);
  else dig(i);
});

canvas.addEventListener('pointercancel', () => {
  clearTimeout(longPressTimer);
  canvas.classList.remove('dragging');
  downPos = null;
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- HUD ----------

const resultModal = document.getElementById('resultModal');
const helpModal = document.getElementById('helpModal');
const mineCounter = document.getElementById('mineCounter');
const timerEl = document.getElementById('timer');
const modeDig = document.getElementById('modeDig');
const modeFlag = document.getElementById('modeFlag');

function updateHUD() {
  mineCounter.textContent = String(state.mineCount - state.flags);
}

let timerId = null;
function startTimer() {
  state.startTime = performance.now() - state.elapsed;
  timerId = setInterval(() => {
    state.elapsed = performance.now() - state.startTime;
    timerEl.textContent = formatTime(state.elapsed);
  }, 250);
}
function stopTimer() {
  clearInterval(timerId);
  timerId = null;
  timerEl.textContent = formatTime(state.elapsed);
}
function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function setFlagMode(on) {
  flagMode = on;
  modeDig.classList.toggle('active', !on);
  modeFlag.classList.toggle('active', on);
  modeDig.setAttribute('aria-pressed', String(!on));
  modeFlag.setAttribute('aria-pressed', String(on));
}
modeDig.addEventListener('click', () => setFlagMode(false));
modeFlag.addEventListener('click', () => setFlagMode(true));

addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') setFlagMode(!flagMode);
  if (e.key === 'r' || e.key === 'R') newGame();
  if (e.key === 'Escape') { hideModal(helpModal); }
});

document.getElementById('difficulty').addEventListener('change', (e) => {
  state.size = Number(e.target.value);
  newGame();
});
document.getElementById('resetBtn').addEventListener('click', newGame);
document.getElementById('retryBtn').addEventListener('click', newGame);
document.getElementById('helpBtn').addEventListener('click', () => showModal(helpModal));
document.getElementById('helpCloseBtn').addEventListener('click', () => hideModal(helpModal));

function showModal(el) { el.hidden = false; }
function hideModal(el) { el.hidden = true; }

// 初回訪問時は遊び方を表示
if (!localStorage.getItem('minecube-visited')) {
  localStorage.setItem('minecube-visited', '1');
  showModal(helpModal);
}

// ---------- メインループ ----------

let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(now - lastTime, 100);
  lastTime = now;
  controls.update();
  stepAnimations(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

newGame();
requestAnimationFrame(loop);
