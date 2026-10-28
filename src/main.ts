import * as THREE from 'three';
import { Game } from './game';
import { Hud } from './ui';
import type { SkillKey } from './champion';

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
const hud = new Hud(game.champ);
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

addEventListener('keydown', (e) => {
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
  if (['q', 'w', 'e', 'r'].includes(k)) game.cast(k.toUpperCase() as SkillKey, cursor);
  if (k === 'd') game.flash(cursor);
  if (k === 't') {
    game.autoAttack = !game.autoAttack;
    game.manualTarget = null;
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// Arrow keys as a survivors-style alternative (WASD would collide with Q/W/E/R)
function moveInput() {
  const v = new THREE.Vector3(
    (keys.has('arrowright') ? 1 : 0) - (keys.has('arrowleft') ? 1 : 0),
    0,
    (keys.has('arrowdown') ? 1 : 0) - (keys.has('arrowup') ? 1 : 0),
  );
  if (v.lengthSq()) {
    moveTarget = null;
    return v.normalize();
  }
  if (!moveTarget || game.paused) return v;
  v.copy(moveTarget).sub(game.pos).setY(0);
  if (v.length() < 15) moveTarget = null;
  return moveTarget ? v.normalize() : v.set(0, 0, 0);
}

function checkPrompts() {
  if (game.over && !document.getElementById('end')!.checkVisibility()) {
    hud.showEnd(game, () => game.reset());
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
  if (!hud.menuOpen) game.update(dt, moveInput()); // ESC menu pauses the simulation
  checkPrompts();
  camera.position.copy(game.pos).add(CAMERA_OFFSET);
  camera.lookAt(game.pos);
  hud.update(game);
  hud.floaters(game, camera);
  renderer.render(game.scene, camera);
  requestAnimationFrame(frame);
}

game
  .load((done, total) => (document.getElementById('loading')!.textContent = `Carregando modelos ${done}/${total}…`))
  .then(() => {
    document.getElementById('loading')!.remove();
    frame();
  });

if (import.meta.env.DEV) Object.assign(window, { game, camera, CAMERA_OFFSET });
