import * as THREE from 'three';
import { Game } from './game';
import { t, type Key } from './i18n';
import { browserStorage, credit, loadProgress, saveProgress } from './progress';
import { showChampionSelect, showRunePage } from './runePage';
import { IS_TOUCH, TouchControls } from './touch';
import { Hud } from './ui';
import { Cinematic } from './cinematic';
import type { ChampionDef, SkillKey } from './champion';

// LoL-style camera: high, pitched ~56°, looking down at the champion
const CAMERA_OFFSET = new THREE.Vector3(0, 1900, 1250);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById('app')!.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(40, 1, 50, 10000);
// UI scale (`--ui-scale`, the CSS `zoom` of the HUD and menus): below the reference height everything shrinks to fit the
// screen instead of scrolling. Phones have their own layouts, built for ~660px; landscape ones get at most 30% smaller.
const UI_REF_HEIGHT = IS_TOUCH ? 660 : 720;
const resize = () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  document.documentElement.style.setProperty('--ui-scale', String(Math.max(IS_TOUCH ? 0.7 : 0, Math.min(1, innerHeight / UI_REF_HEIGHT))));
};
addEventListener('resize', resize);
resize();

// Static texts of index.html: `data-i18n` holds the src/locales key
document.documentElement.lang = t('meta.tag');
document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => { el.innerHTML = t(el.dataset.i18n as Key); });

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
      game.moveOrder();
    }
  } else if (e.button === 0 && !game.autoAttack) game.manualTarget = enemy;
});
addEventListener('mouseup', (e) => {
  if (e.button === 2) rightHeld = false;
});

// Touch: tapping an enemy marks it as focus (the tap's emulated mousedown above already covers manual targets)
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  updateCursor(e);
  const enemy = game.enemyAt(cursor);
  if (enemy) game.focus = enemy;
});

let inMenu = true; // champion select / rune page open: the run doesn't simulate, nothing is drawn behind them
let credited = false; // rune points of the finished run already saved
let cine: Cinematic | null = null; // end-of-run cinematic, then the end screen (keeps the camera until the menus open)

/** Champion select, then the rune page. */
function openMenus() {
  enterMenus();
  showChampionSelect(openRunes);
}

/** The rune page of `champ`; Jogar starts a fresh run with the page, Back returns to champion select. */
function openRunes(champ: ChampionDef) {
  enterMenus();
  showRunePage(champ, async (page) => {
    loading.textContent = t('loading.champion', { champion: champ.name });
    loading.style.display = '';
    await game.setChampion(champ);
    loading.style.display = 'none';
    if (champ !== hudChamp) {
      hud = new Hud(champ, toggleAuto);
      hudChamp = champ;
    }
    document.body.classList.remove('menus');
    game.reset(page);
    credited = false;
    inMenu = false;
  }, openMenus);
}

function enterMenus() {
  inMenu = true;
  cine?.dispose();
  cine = null;
  document.body.classList.add('menus');
  keys.clear();
}

addEventListener('keydown', (e) => {
  if (inMenu) return;
  const k = e.key.toLowerCase();
  if (cine && ['escape', 'enter', ' '].includes(k)) return cine.skip();
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
  if (k === 't') toggleAuto();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function toggleAuto() {
  game.autoAttack = !game.autoAttack;
  game.manualTarget = null;
}

const touch = IS_TOUCH ? new TouchControls(
  (key, dir) => {
    if (inMenu || hud.menuOpen || game.paused || game.over) return;
    // tap: like casting while moving with the arrows (auto-aim, else the joystick or facing direction); drag: that way
    const along = dir ?? (touch!.move.lengthSq() ? touch!.move : new THREE.Vector3(Math.sin(game.facing), 0, Math.cos(game.facing)));
    if (key === 'flash') return game.flash(game.pos.clone().addScaledVector(along, 5000)); // Flash caps its range
    const aim = game.champ.skills[key].aim;
    // same reach as aimPoint, without its auto-target when aimed by hand
    const point = (!dir && game.aimPoint(key, along)) || game.pos.clone().addScaledVector(along, typeof aim === 'number' ? aim : aim === 'move' ? 5000 : 0);
    game.cast(key, point);
  },
  () => { if (!inMenu && !game.over) hud.toggleMenu(); },
  toggleAuto,
) : null;
addEventListener('blur', () => keys.clear());

// Arrow keys as a survivors-style alternative (WASD would collide with Q/W/E/R)
function arrowDir() {
  return new THREE.Vector3(
    (keys.has('arrowright') ? 1 : 0) - (keys.has('arrowleft') ? 1 : 0),
    0,
    (keys.has('arrowdown') ? 1 : 0) - (keys.has('arrowup') ? 1 : 0),
  ).normalize();
}

let inputHeld = false; // arrows or joystick last frame: pressing them again is a new move order
function moveInput() {
  const v = arrowDir();
  if (touch?.move.lengthSq()) v.copy(touch.move);
  if (v.lengthSq() && !inputHeld && !game.paused) game.moveOrder();
  inputHeld = v.lengthSq() > 0;
  if (game.steering) moveTarget = null; // the kit walks the champion: an older click must not pull it back afterwards
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
    hud.closePrompts();
    if (hud.menuOpen) hud.toggleMenu();
    cine = new Cinematic(game, camera, CAMERA_OFFSET, () =>
      hud.showEnd(game, r.gained, r.progress, { runePage: () => openRunes(game.champ), again: openMenus }));
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
const view = new THREE.Frustum(), viewMatrix = new THREE.Matrix4();
function frame(now = last) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  requestAnimationFrame(frame);
  if (inMenu) return renderer.clear(); // black behind champion select and the rune page
  // last frame's camera view: enemies outside it are neither drawn nor animated
  game.view = view.setFromProjectionMatrix(viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  if (!hud.menuOpen) game.update(dt * (cine?.timeScale ?? 1), moveInput()); // the ESC menu pauses the simulation
  checkPrompts();
  if (cine) cine.update();
  else {
    camera.position.copy(game.pos).add(CAMERA_OFFSET);
    camera.lookAt(game.pos);
  }
  hud.update(game);
  touch?.update(game);
  hud.floaters(game, camera);
  renderer.render(game.scene, camera);
}

game
  .load((done, total) => (loading.textContent = t('loading.models', { done, total })))
  .then(() => {
    loading.style.display = 'none';
    frame();
    openMenus();
  });

if (import.meta.env.DEV) Object.assign(window, { game, camera, CAMERA_OFFSET });
