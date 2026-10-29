// Touch controls (phones and tablets), MOBA-mobile style: a floating joystick on the left moves, a button cluster on
// the right casts (tap: smart cast like the arrow-key aim, drag: aim by hand, release casts). Desktops never get it.
import * as THREE from 'three';
import { t } from './i18n';
import { RUNES } from './runes';
import type { SkillKey } from './champion';
import type { Game } from './game';

/** Touch is the primary input (no hovering pointer): phones and tablets, not touchscreen laptops. */
export const IS_TOUCH = matchMedia('(hover: none) and (pointer: coarse)').matches;

const JOY_RADIUS = 50; // px the knob travels from the joystick center
const DEAD_ZONE = 18; // px: a shorter drag on a skill button is a tap (smart cast)
const AIM_LINE = 140; // px length of the on-screen aim arrow

type Cast = (key: SkillKey | 'flash', dir: THREE.Vector3 | null) => void;

/** Screen drag to world direction: the camera has no yaw, so screen right is +x and screen down is +z. */
const toWorld = (dx: number, dy: number, out: THREE.Vector3) => out.set(dx, 0, dy).normalize();

export class TouchControls {
  /** Joystick direction on the ground plane (zero when released). */
  readonly move = new THREE.Vector3();
  private shown = new Map<string, string>();

  /** `cast`: dir null = tap (smart cast); `pause`, `toggleAuto`: the ESC and T keys. */
  constructor(cast: Cast, pause: () => void, toggleAuto: () => void) {
    document.body.classList.add('touch');
    const $ = (id: string) => document.getElementById(id)!;
    // the existing HUD pieces move instead of being duplicated: Hud keeps updating them by id
    $('touch-pad').prepend($('skills'));
    $('menu').insertBefore($('stats'), $('menu-resume'));
    $('touch-flash').querySelector('img')!.src = RUNES['hextech-flashtraption'].icon;
    $('touch-pause').setAttribute('aria-label', t('static.paused'));
    $('touch-attack').setAttribute('aria-label', t('hud.auto'));
    $('touch-pause').onclick = pause;
    $('touch-attack').onclick = toggleAuto;
    this.fullscreen($('touch-fs'));
    this.joystick($('joy-zone'), $('joy'), $('joy-knob'));
    const aim = $('aim');
    const drag = (el: HTMLElement, key: (e: PointerEvent) => SkillKey | 'flash' | null) => {
      el.addEventListener('pointerdown', (e) => {
        const k = key(e);
        if (!k) return;
        el.setPointerCapture(e.pointerId);
        const x0 = e.clientX, y0 = e.clientY, dir = new THREE.Vector3();
        let far = false;
        const onMove = (m: PointerEvent) => {
          if (m.pointerId !== e.pointerId) return; // another thumb on another skill
          const dx = m.clientX - x0, dy = m.clientY - y0;
          far = Math.hypot(dx, dy) > DEAD_ZONE;
          aim.style.display = far ? 'block' : 'none';
          if (!far) return;
          toWorld(dx, dy, dir);
          aim.style.transform = `translate(${innerWidth / 2}px, ${innerHeight / 2}px) rotate(${Math.atan2(dy, dx)}rad)`;
        };
        const onUp = (u: PointerEvent) => {
          if (u.pointerId !== e.pointerId) return;
          el.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerup', onUp);
          el.removeEventListener('pointercancel', onUp);
          aim.style.display = 'none';
          if (u.type === 'pointerup') cast(k, far ? dir : null);
        };
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointercancel', onUp);
      });
    };
    aim.style.width = `${AIM_LINE}px`;
    // skill slots are rebuilt with each champion: delegate from #skills, reading the key from the slot id
    drag($('skills'), (e) => {
      const slot = (e.target as HTMLElement).closest<HTMLElement>('.skill');
      return slot ? (slot.id.slice('skill-'.length) as SkillKey) : null;
    });
    drag($('touch-flash'), () => 'flash');
  }

  /** Enters fullscreen on the first tap (browsers only allow it from a gesture) and toggles it from the button.
   *  iPhone has no Fullscreen API (Safari and Chrome alike): the button explains the home screen shortcut instead,
   *  which opens without the URL bar. Already opened from the home screen, it stays hidden. */
  private fullscreen(btn: HTMLElement) {
    if (!document.fullscreenEnabled) {
      if (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone) return;
      const tip = document.getElementById('touch-fs-tip')!;
      tip.textContent = t('hud.fullscreenTip');
      btn.hidden = false;
      btn.setAttribute('aria-label', t('hud.fullscreen'));
      btn.onclick = () => { tip.hidden = !tip.hidden; };
      tip.onclick = () => { tip.hidden = true; };
      return;
    }
    btn.hidden = false;
    const sync = () => {
      const on = !!document.fullscreenElement;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-label', t(on ? 'hud.fullscreenExit' : 'hud.fullscreen'));
    };
    const enter = () => document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    sync();
    document.addEventListener('fullscreenchange', sync);
    // pointerup (not pointerdown) counts as user activation for touch; the button's own tap is left to its handler
    document.addEventListener('pointerup', (e) => { if (e.target !== btn && !btn.contains(e.target as Node)) enter(); }, { once: true });
    btn.onclick = () => (document.fullscreenElement ? document.exitFullscreen().catch(() => {}) : enter());
  }

  /** Floating joystick: appears where the thumb lands inside the zone, the knob follows up to JOY_RADIUS. */
  private joystick(zone: HTMLElement, base: HTMLElement, knob: HTMLElement) {
    let id = -1, cx = 0, cy = 0;
    const home = () => { base.style.left = ''; base.style.top = ''; knob.style.transform = ''; base.classList.remove('on'); };
    zone.addEventListener('pointerdown', (e) => {
      if (id !== -1) return;
      id = e.pointerId;
      zone.setPointerCapture(id);
      const r = zone.getBoundingClientRect();
      cx = e.clientX; cy = e.clientY;
      base.style.left = `${cx - r.left}px`;
      base.style.top = `${cy - r.top}px`;
      base.classList.add('on');
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > JOY_RADIUS) { dx *= JOY_RADIUS / len; dy *= JOY_RADIUS / len; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      if (len > 6) toWorld(dx, dy, this.move);
      else this.move.set(0, 0, 0);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      this.move.set(0, 0, 0);
      home();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  /** Per frame: Flash only with its rune, its cooldown, and the auto attack state on the attack button. */
  update(g: Game) {
    const set = (key: string, v: string, apply: () => void) => { if (this.shown.get(key) !== v) { this.shown.set(key, v); apply(); } };
    const flash = document.getElementById('touch-flash')!;
    set('flash', String(g.hasFlash), () => { flash.style.display = g.hasFlash ? '' : 'none'; });
    const cd = Math.max(0, g.flashReady - g.time);
    set('flash-cd', cd > 0 ? String(Math.ceil(cd)) : '', () => {
      flash.querySelector('span')!.textContent = cd > 0 ? String(Math.ceil(cd)) : '';
      flash.classList.toggle('cooling', cd > 0);
    });
    const attack = document.getElementById('touch-attack')!;
    set('auto', String(g.autoAttack), () => {
      document.getElementById('touch-attack-label')!.textContent = t(g.autoAttack ? 'touch.autoOn' : 'touch.autoOff');
      attack.classList.toggle('off', !g.autoAttack);
    });
  }
}
