// End-of-run cinematics, played before the end screen. Victory: the camera flies to the slain Baron in slow motion,
// light rays crack out of him, a white flash and a shockwave of fragments, then the camera pulls back. Defeat: a red
// hit flash, the world drains to grey with a heartbeat vignette while the champion's death animation plays.
// The scene keeps rendering under the end screen, so the camera stays in the cinematic's last framing.
import * as THREE from 'three';
import type { Game } from './game';

const VICTORY = { raysAt: 1.1, burstAt: 2.6, endAt: 4.4, zoom: 0.66 };
const DEFEAT = { greyAt: 0.4, endAt: 2.1, zoom: 0.82 };
const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

export class Cinematic {
  private t = 0;
  private last = performance.now();
  private ended = false;
  private fired = new Set<string>();
  private layer = document.getElementById('cine')!;
  private skipBtn = document.getElementById('end-skip')!;
  /** DOM effects pinned to a world point, re-projected every frame while the camera moves. */
  private pinned: { el: HTMLElement; at: THREE.Vector3 }[] = [];
  private focus = new THREE.Vector3();
  private v = new THREE.Vector3();

  /** `onEnd`: shows the end screen (once, after the sequence or a skip). */
  constructor(private g: Game, private camera: THREE.Camera, private offset: THREE.Vector3, private onEnd: () => void) {
    document.body.classList.add('cine');
    this.skipBtn.style.display = '';
    this.skipBtn.onclick = () => this.skip();
  }

  get won() { return this.g.over === 'won'; }
  /** Slow motion for the game's death animations. */
  get timeScale() { return this.ended ? 1 : this.won ? 0.45 : 0.6; }

  skip() {
    if (this.ended) return;
    this.t = Math.max(this.t, (this.won ? VICTORY : DEFEAT).endAt);
    this.layer.replaceChildren();
    this.pinned.length = 0;
    if (this.won) document.body.classList.add('won');
    else document.body.classList.add('dead');
  }

  /** Real time, not the frame's capped dt: a slow device still gets the sequence's timing. */
  update() {
    const now = performance.now();
    this.t += Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    const t = this.t, g = this.g;
    let zoom: number, shake = 0;
    if (this.won) {
      const fly = ease(t / 1.6);
      this.focus.copy(g.pos).lerp(g.winAt, fly);
      zoom = 1 + (VICTORY.zoom - 1) * fly + (t > 3 ? Math.min(0.3, (t - 3) * 0.08) : 0); // pulls back after the burst
      if (t < 0.5) shake = 14 * (1 - t / 0.5);
      if (t > VICTORY.burstAt && t < VICTORY.burstAt + 0.5) shake = 22 * (1 - (t - VICTORY.burstAt) / 0.5);
      this.once('rays', VICTORY.raysAt, () => { this.add('c-vig'); this.pin('c-rays', g.winAt); });
      this.once('burst', VICTORY.burstAt, () => this.burst());
      this.once('dim', VICTORY.burstAt + 0.9, () => document.body.classList.add('won'));
    } else {
      this.focus.copy(g.pos);
      zoom = 1 + (DEFEAT.zoom - 1) * ease(t / 1.8);
      if (t < 0.45) shake = 12 * (1 - t / 0.45);
      this.once('hit', 0, () => this.add('c-red'));
      this.once('grey', DEFEAT.greyAt, () => { document.body.classList.add('dead'); this.add('c-beat'); });
    }
    this.camera.position.copy(this.focus).addScaledVector(this.offset, zoom);
    if (shake) this.camera.position.add(this.v.set((Math.random() - 0.5) * shake * 4, 0, (Math.random() - 0.5) * shake * 4));
    this.camera.lookAt(this.focus);
    this.camera.updateMatrixWorld();
    for (const p of this.pinned) {
      this.v.copy(p.at).setY(120).project(this.camera);
      p.el.style.left = `${(this.v.x * 0.5 + 0.5) * innerWidth}px`;
      p.el.style.top = `${(-this.v.y * 0.5 + 0.5) * innerHeight}px`;
    }
    if (!this.ended && t >= (this.won ? VICTORY.endAt : DEFEAT.endAt)) {
      this.ended = true;
      this.skipBtn.style.display = 'none';
      this.onEnd();
    }
  }

  /** Leaving the end screen: back to a clean screen for the menus. */
  dispose() {
    this.layer.replaceChildren();
    this.skipBtn.style.display = 'none';
    document.body.classList.remove('cine', 'won', 'dead');
  }

  private once(key: string, at: number, run: () => void) {
    if (this.t >= at && !this.fired.has(key)) { this.fired.add(key); run(); }
  }

  private add(cls: string, style = '') {
    const el = document.createElement('i');
    el.className = cls;
    if (style) el.style.cssText = style;
    this.layer.append(el);
    return el;
  }

  private pin(cls: string, at: THREE.Vector3, style = '') {
    const el = this.add(cls, style);
    this.pinned.push({ el, at });
    return el;
  }

  /** Baron bursts: white flash, three shockwave rings and a spray of fragments. */
  private burst() {
    this.layer.querySelector('.c-rays')?.remove();
    this.pinned = this.pinned.filter((p) => p.el.isConnected);
    this.add('c-flash');
    for (const w of ['', ' w2', ' w3']) this.pin(`c-wave${w}`, this.g.winAt);
    for (let i = 0; i < 24; i++) this.pin('c-frag', this.g.winAt, `--a:${i * 15}deg;--d:${260 + ((i * 53) % 260)}`);
  }
}
