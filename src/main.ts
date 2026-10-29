import * as THREE from 'three';
import { Game } from './game';
import { browserStorage, credit, loadProgress, saveProgress } from './progress';
import { showChampionSelect, showRunePage } from './runePage';
import { Hud } from './ui';
import type { ChampionDef, SkillKey } from './champion';

// LoL-style camera: high, pitched ~56°, looking down at the champion
const CAMERA_OFFSET = new THREE.Vector3(0, 1900, 1250);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById('app')!.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(40, 1, 50, 10000);
const resize = () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize);
resize();

const game = new Game();
let hud!: Hud; // built on the first Jogar (the menus come before), rebuilt when the champion changes
let hudChamp: ChampionDef | null = null;
const loading = document.getElementById('loading')!;
const keys = new Set<string>();
const cursor = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();

function updateCursor(e: MouseEvent) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  raycaster.ray.intersectPlane(groundPlane, cursor);
}

// LoL controls: right click on the ground moves (hold to follow the cursor), right click on an enemy marks it as focus
let moveTarget: THREE.Vector3 | null = null;
let rightHeld = false;
addEventListener('mousemove', (e) => {
  updateCursor(e);
  if (rightHeld) moveTarget?.copy(cursor);
});
addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('mousedown', (e) => {
  updateCursor(e);
  const enemy = game.enemyAt(cursor);
  if (e.button === 2) {
    if (enemy) game.focus = enemy;
    else {
      moveTarget = cursor.clone();
      rightHeld = true;
    }
  } else if (e.button === 0 && !game.autoAttack) game.manualTarget = enemy;
});
addEventListener('mouseup', (e) => {
  if (e.button === 2) rightHeld = false;
});

let inMenu = true; // champion select / rune page open: the run doesn't simulate, nothing is drawn behind them
let credited = false; // rune points of the finished run already saved

/** Champion select, then the rune page; Jogar starts a fresh run with the page. */
function openMenus() {
  inMenu = true;
  document.body.classList.add('menus');
  keys.clear();
  showChampionSelect((champ) => showRunePage(champ, async (page) => {
    loading.textContent = `Carregando ${champ.name}…`;
    loading.style.display = '';
    await game.setChampion(champ);
    loading.style.display = 'none';
    if (champ !== hudChamp) {
      hud = new Hud(champ);
      hudChamp = champ;
    }
    document.body.classList.remove('menus');
    game.reset(page);
    credited = false;
    inMenu = false;
  }));
}

addEventListener('keydown', (e) => {
  if (inMenu) return;
  const k = e.key.toLowerCase();
  if (k === 'escape' && !game.over) {
    hud.toggleMenu();
    keys.clear();
    return;
  }
  if (hud.menuOpen) return;
  keys.add(k);
  if (hud.choosing && /^[1-9]$/.test(k)) hud.key(Number(k));
  if (game.paused || game.over) return;
  if (['q', 'w', 'e', 'r'].includes(k)) {
    const key = k.toUpperCase() as SkillKey;
    // moving with the arrows: skills aim themselves (SkillDef.aim), since the cursor is not being used
    const dir = arrowDir();
    game.cast(key, (dir.lengthSq() && game.aimPoint(key, dir)) || cursor);
  }
  if (k === 'd') game.flash(cursor);
  if (k === 't') {
    game.autoAttack = !game.autoAttack;
    game.manualTarget = null;
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// Arrow keys as a survivors-style alternative (WASD would collide with Q/W/E/R)
function arrowDir() {
  return new THREE.Vector3(
    (keys.has('arrowright') ? 1 : 0) - (keys.has('arrowleft') ? 1 : 0),
    0,
    (keys.has('arrowdown') ? 1 : 0) - (keys.has('arrowup') ? 1 : 0),
  ).normalize();
}

function moveInput() {
  const v = arrowDir();
  if (v.lengthSq()) {
    moveTarget = null;
    return v;
  }
  if (!moveTarget || game.paused) return v;
  v.copy(moveTarget).sub(game.pos).setY(0);
  if (v.length() < 15) moveTarget = null;
  return moveTarget ? v.normalize() : v.set(0, 0, 0);
}

function checkPrompts() {
  if (inMenu) return;
  if (game.over) {
    if (credited) return;
    credited = true; // once per run, however often this runs before Continuar
    const r = credit(loadProgress(browserStorage), game.kills, game.bonusRunePoints);
    saveProgress(r.progress, browserStorage);
    hud.showEnd(game, r.gained, r.progress.killRemainder, openMenus);
  } else if (game.choices.length && !hud.choosing) {
    game.paused = true;
    hud.choice(game.choices.shift()!, () => { game.paused = game.pendingLevelUps > 0; });
  } else if (!game.over && game.pendingLevelUps > 0 && !hud.choosing) {
    game.paused = true;
    hud.levelUp(game, () => {
      game.pendingLevelUps--;
      game.paused = game.pendingLevelUps > 0;
    });
  }
}

let last = performance.now();
function frame(now = last) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  requestAnimationFrame(frame);
  if (inMenu) return renderer.clear(); // black behind champion select and the rune page
  if (!hud.menuOpen) game.update(dt, moveInput()); // the ESC menu pauses the simulation
  checkPrompts();
  camera.position.copy(game.pos).add(CAMERA_OFFSET);
  camera.lookAt(game.pos);
  hud.update(game);
  hud.floaters(game, camera);
  renderer.render(game.scene, camera);
}

game
  .load((done, total) => (loading.textContent = `Carregando modelos ${done}/${total}…`))
  .then(() => {
    loading.style.display = 'none';
    frame();
    openMenus();
  });

if (import.meta.env.DEV) Object.assign(window, { game, camera, CAMERA_OFFSET });
