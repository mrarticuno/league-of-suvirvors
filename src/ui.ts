import * as THREE from 'three';
import { audio } from './audio';
import { BUFF } from './buffs';
import { dpsGain, SKILL_KEYS, skillNumbers, skillScore, type ChampionDef, type SkillDef, type SkillKey, type SkillStats } from './champion';
import { ENEMIES, HORDE, xpToNext } from './data';
import { t, type Key } from './i18n';
import type { Choice, Game } from './game';
import { KILLS_PER_POINT, nodeCost, type Progress } from './progress';
import { PASSIVES, type FxStat } from './itemEffects';
import {
  BOOTS, BOOTS_AT, buildComplete, describeStats, itemIcon, ITEMS, LEGENDARY_BONUS, MAX_ITEMS, PLATING, MAX_LEVEL, offerScore, PASSIVE_LEVEL, PASSIVE_POWER, POTIONS, rollOffers, statsAt, statValue,
  type ItemStats, type Offer,
} from './items';
import { RUNES, TREES } from './runes';

const els = new Map<string, HTMLElement>();
const $ = (id: string) => {
  let el = els.get(id);
  if (!el) els.set(id, (el = document.getElementById(id)!));
  return el;
};
// The HUD redraws every frame but most values rarely change: only touch the DOM when the written value differs
const shown = new Map<string, string>();
const changed = (key: string, v: string) => shown.get(key) !== v && !!shown.set(key, v);
const text = (id: string, v: string) => { if (changed(id, v)) $(id).textContent = v; };
const style = (id: string, prop: 'width' | 'height' | 'display', v: string) => { if (changed(`${id}.${prop}`, v)) $(id).style[prop] = v; };
export const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** Numbers in the player's locale (1,5 in pt/es, 1.5 in en/zh; thousands grouped). */
const formats = new Map<number, Intl.NumberFormat>();
export const num = (v: number, digits = 0) => {
  let f = formats.get(digits);
  if (!f) formats.set(digits, (f = new Intl.NumberFormat(t('meta.tag'), { minimumFractionDigits: digits, maximumFractionDigits: digits })));
  return f.format(v);
};
const pct = (v: number) => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%`;
const OVERHEAD_Y = 230; // world height of the bars above the champion (just under the 260 of XP floaters)
const XP_RING = 289; // circumference of the portrait's XP ring (r = 46)
const STATS = [
  ['ad', '#ff8a4e'], ['ap', '#c08cff'], ['as', '#ffd257'], ['armor', '#d9b56a'], ['ms', '#7fe0c2'], ['ah', '#9cc8ff'], ['crit', '#ff5a4e'],
] as const;
const BUFF_GLYPH: Record<'blue' | 'red', string> = {
  blue: '<path d="M12 4l6 8-6 8-6-8z" fill="#4a95f5"/>',
  red: '<path d="M12 3c3 4 6 7 6 10.5a6 6 0 0 1-12 0c0-2 1-3.6 2.6-5 0 2.4 1.6 3.4 2.6 3.4-1-3.4 0-6 .8-8.9z" fill="#ff6b4e"/>',
};

type SkillEls = { root: HTMLElement; img: HTMLImageElement; sweep: HTMLElement; cdText: HTMLElement; pips: HTMLElement; cost: HTMLElement; badge: HTMLElement; cooling: boolean };

export class Hud {
  private game?: Game; // the last one drawn (the ESC menu shows its stats)
  /** Number-key handlers for the open level-up step (index 0 = key 1). */
  private keyActions: (() => void)[] = [];
  choosing = false;
  menuOpen = false;

  private skillEls: Record<SkillKey, SkillEls>;
  private level = 0;

  /** `onAuto`: the auto attack chip (desktop), same as the T key. */
  constructor(champ: ChampionDef, onAuto: () => void) {
    $('menu-resume').onclick = () => this.toggleMenu();
    const slider = (id: string, value: number, set: (v: number) => void) => {
      const el = $(id) as HTMLInputElement;
      el.value = String(Math.round(value * 100));
      el.oninput = () => set(+el.value / 100);
      return el;
    };
    slider('menu-music', audio.musicVolume, (v) => audio.setMusicVolume(v));
    slider('menu-sfx', audio.sfxVolume, (v) => audio.setSfxVolume(v)).onchange = () => audio.play('hud_open'); // preview on release
    $('pause-btn').onclick = () => this.toggleMenu();
    $('pause-btn').setAttribute('aria-label', t('hud.pause'));
    $('auto').onclick = onAuto;
    $('skills').innerHTML = SKILL_KEYS.map((k) => `
      <div class="skill" id="skill-${k}" title="${champ.skills[k].name}">
        <div class="sf"><img src="${champ.skills[k].icon}" alt=""><div class="sweep"></div></div>
        <div class="cd-text"></div><span class="key">${k}</span><span class="cost"></span><span class="badge"></span><div class="pips"></div>
      </div>`).join('');
    // not $(): its id cache would still hold the previous HUD's (now detached) skill slots
    const root = (k: SkillKey) => document.getElementById(`skill-${k}`)!;
    const part = (k: SkillKey, sel: string) => root(k).querySelector<HTMLElement>(sel)!;
    this.skillEls = Object.fromEntries(SKILL_KEYS.map((k) => [k, {
      root: root(k), img: part(k, 'img') as HTMLImageElement, sweep: part(k, '.sweep'), cdText: part(k, '.cd-text'), pips: part(k, '.pips'),
      cost: part(k, '.cost'), badge: part(k, '.badge'), cooling: false,
    }])) as Hud['skillEls'];
    $('gauge').querySelector('img')!.src = champ.passive.icon;
    $('gauge').title = champ.passive.name;
    $('portrait').querySelector('img')!.src = champ.icon;
    $('flash-slot').querySelector('img')!.src = RUNES['hextech-flashtraption'].icon;
    $('stats').innerHTML = STATS.map(([k, c]) => `<div class="st"><i style="--c:${c}"></i><span>${t(`hud.stat.${k}` as Key)}</span><b id="st-${k}"></b></div>`).join('')
      + '<div id="passive-text"></div>';
    $('buffs').innerHTML = (['blue', 'red'] as const).map((k) => `<div class="buff" id="buff-${k}" title="${BUFF.names[k]}" style="--bc:${k === 'blue' ? '#4a95f5' : '#ff6b4e'};display:none">
      <i><svg viewBox="0 0 24 24" aria-hidden="true">${BUFF_GLYPH[k]}</svg></i><b></b></div>`).join('');
    els.clear(); // the rebuilt pieces above replaced some cached nodes
    shown.clear(); // a new HUD (new champion) redraws everything
    this.level = 0;
  }

  update(g: Game) {
    this.game = g;
    text('timer', fmt(g.time));
    text('kills', num(g.kills));
    text('kills-touch', t('hud.kills', { n: num(g.kills) }));
    if (g.level !== this.level) {
      if (this.level && g.level > this.level) this.levelToast(g.level);
      this.level = g.level;
      text('level', String(g.level));
    }
    const xp = Math.min(1, g.xp / xpToNext(g.level));
    if (changed('xp', xp.toFixed(3))) $('xp-ring').setAttribute('stroke-dasharray', `${(xp * XP_RING).toFixed(1)} ${XP_RING}`);
    const hp = pct(g.hp / g.maxHp);
    style('hp-fill', 'width', hp);
    style('hp-trail', 'width', hp);
    const shield = Math.min(g.shield, g.maxHp - g.hp) / g.maxHp;
    if (changed('shield', `${hp}|${shield.toFixed(3)}`)) Object.assign($('shield-fill').style, { left: hp, width: pct(shield) });
    text('hp-text', g.stasis > 0 ? `${ITEMS['3026'].name} ${num(g.stasis, 1)}s` : `${num(Math.ceil(g.hp))} / ${num(Math.ceil(g.maxHp))}`);
    style('mana-fill', 'width', pct(g.mana / g.maxMana));
    text('mana-text', `${num(Math.floor(g.mana))} / ${num(Math.floor(g.maxMana))}`);
    if (changed('auto', String(g.autoAttack))) {
      $('auto-state').textContent = t(g.autoAttack ? 'hud.on' : 'hud.off');
      $('auto').classList.toggle('off', !g.autoAttack);
      $('auto').setAttribute('aria-pressed', String(g.autoAttack));
    }
    text('st-ad', num(Math.round(g.ad)));
    text('st-ap', num(Math.round(g.ap)));
    text('st-as', num(g.attackSpeed, 2));
    text('st-armor', num(Math.round(g.armor)));
    text('st-ms', num(g.moveSpeed));
    text('st-ah', num(g.abilityHaste));
    text('st-crit', `${Math.round(g.critChance * 100)}%`);
    text('passive-text', g.kit.hud?.() ?? '');
    for (const k of ['blue', 'red'] as const) {
      const left = g.buffs[k] - g.time;
      const id = `buff-${k}`;
      style(id, 'display', left > 0 ? 'block' : 'none');
      if (left <= 0) continue;
      if (changed(`${id}.p`, (left / BUFF.duration).toFixed(3))) $(id).style.setProperty('--p', String((left / BUFF.duration) * 100));
      if (changed(`${id}.t`, fmt(left))) $(id).querySelector('b')!.textContent = fmt(left);
    }
    const gauge = g.kit.gauge?.();
    if (changed('gauge-icon', gauge?.icon ?? '')) $('gauge').querySelector('img')!.src = gauge?.icon ?? g.champ.passive.icon;
    const tray = g.kit.tray?.() ?? [];
    if (changed('tray', tray.map((x) => `${x.icon}|${x.label}`).join(','))) {
      $('tray').innerHTML = tray.map((x) => `<b title="${x.title}"><img src="${x.icon}" alt="">${x.label ? `<span>${x.label}</span>` : ''}</b>`).join('');
      // outside the dock (its frame clips), just above the skill slots
      const r = $('skills').getBoundingClientRect(), dock = $('bottom').getBoundingClientRect();
      const z = Number(getComputedStyle($('hud')).zoom) || 1; // rects are screen px, the tray's style is in the HUD's zoomed px
      Object.assign($('tray').style, { left: `${r.left / z}px`, bottom: `${(innerHeight - dock.top) / z + 6}px` });
    }
    text('gauge-label', gauge?.label ?? '');
    style('gauge-fill', 'height', gauge ? pct(gauge.fill) : '0');
    if (changed('gauge-ready', String(!!gauge?.ready))) $('gauge').classList.toggle('ready', !!gauge?.ready);
    for (const k of SKILL_KEYS) {
      const el = this.skillEls[k];
      const rank = g.ranks[k];
      const cd = g.learned(k) ? g.cooldowns[k] : 0;
      const cls = el.root.classList;
      const on = g.learned(k);
      cls.toggle('locked', !on);
      cls.toggle('nomana', on && g.mana < g.costOf(k));
      cls.toggle('blocked', on && g.kit.canCast?.(k) === false);
      cls.toggle('empowered', on && !!gauge?.ready && gauge.skill === k);
      cls.toggle('cooling', cd > 0);
      cls.toggle('ready', on && cd <= 0);
      const view = g.kit.skillView?.(k);
      if (changed(`view-${k}`, `${view?.icon}|${view?.name}|${view?.badge}`)) {
        el.img.src = view?.icon ?? g.champ.skills[k].icon;
        el.root.title = view?.name ?? g.champ.skills[k].name;
        el.badge.textContent = view?.badge ?? '';
      }
      if (el.cooling && cd <= 0) { // back off cooldown: a short pop
        cls.remove('pop');
        void el.root.offsetWidth;
        cls.add('pop');
      }
      el.cooling = cd > 0;
      // text stays centered on the icon while the sweep turns, so the last seconds stay readable
      const cdText = cd > 0 ? (cd < 1 ? num(cd, 1) : String(Math.ceil(cd))) : '';
      if (changed(`cd-text-${k}`, cdText)) el.cdText.textContent = cdText;
      const sweep = cd > 0 ? ((1 - cd / g.cooldownOf(k)) * 360).toFixed(1) : '360';
      if (changed(`cd-${k}`, sweep)) el.sweep.style.setProperty('--p', sweep);
      const cost = g.learned(k) && g.costOf(k) > 0 ? String(g.costOf(k)) : '';
      if (changed(`cost-${k}`, cost)) el.cost.textContent = cost;
      if (changed(`pips-${k}`, String(rank))) {
        el.pips.innerHTML = Array.from({ length: g.champ.skills[k].maxRank }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
      }
    }
    style('flash-slot', 'display', g.hasFlash ? 'block' : 'none');
    if (g.hasFlash) {
      const fcd = Math.max(0, g.flashReady - g.time);
      if (changed('flash-cd', fcd > 0 ? String(Math.ceil(fcd)) : '')) {
        $('flash-slot').querySelector('span')!.textContent = fcd > 0 ? String(Math.ceil(fcd)) : '';
        $('flash-slot').classList.toggle('cooling', fcd > 0);
      }
    }
    if (changed('inventory', `${g.slots.map((s) => `${s.id}:${s.level}`).join(',')}|${g.legendary}|${g.boots}`)) {
      $('inventory').innerHTML = slotsHtml(g, (i, cls, title) =>
        `<b class="${cls}" title="${title}"><img src="${itemIcon(g.slots[i].id)}" alt="">${lvBadge(g.slots[i].level)}${legTag(g, i)}</b>`, '<span></span>')
        + (g.boots ? `<b class="boots" title="${bootsTitle(g.boots)}"><img src="${itemIcon(g.boots)}" alt=""></b>` : `<span class="boots" title="${t('boots.empty', { time: fmt(BOOTS_AT) })}"></span>`);
    }
    const hordeIn = g.nextHordeAt - g.time;
    style('horde', 'display', hordeIn <= HORDE.warning ? 'block' : 'none');
    if (hordeIn <= HORDE.warning) text('horde', t('hud.horde', { s: Math.ceil(hordeIn) }));
    const boss = g.boss;
    style('boss', 'display', boss ? 'block' : 'none');
    if (boss) {
      text('boss-name', boss.def.name ?? boss.def.model);
      text('boss-pct', `${Math.ceil((boss.hp / boss.maxHp) * 100)}%`);
      style('boss-fill', 'width', pct(boss.hp / boss.maxHp));
      style('boss-trail', 'width', pct(boss.hp / boss.maxHp));
    }
  }

  private levelToast(level: number) {
    $('lvl-toast-n').textContent = t('hud.level', { level });
    for (const id of ['lvl-toast', 'portrait']) {
      const cls = id === 'portrait' ? 'leveled' : 'show';
      $(id).classList.remove(cls);
      void $(id).offsetWidth; // restart the animation
      $(id).classList.add(cls);
    }
  }

  /** The run ended: an open level-up or rune popup gives way to the end-of-run cinematic. */
  closePrompts() {
    $('levelup').style.display = 'none';
    this.choosing = false;
    this.keyActions = [];
  }

  key(n: number) { this.keyActions[n - 1]?.(); }

  /** LoL-style level + HP/mana bars above the champion; HP ticks every 100 HP. */
  private overhead(g: Game, camera: THREE.Camera) {
    this.projected.copy(g.pos).setY(OVERHEAD_Y).project(camera);
    const x = Math.round((this.projected.x * 0.5 + 0.5) * innerWidth);
    const y = Math.round((-this.projected.y * 0.5 + 0.5) * innerHeight);
    if (changed('oh.pos', `${x},${y}`)) $('overhead').style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    text('oh-level', String(g.level));
    const hp = g.hp / g.maxHp;
    style('oh-hp', 'width', pct(hp));
    const shield = Math.min(g.shield, g.maxHp - g.hp) / g.maxHp;
    if (changed('oh.shield', `${hp}|${shield.toFixed(3)}`)) Object.assign($('oh-shield').style, { left: pct(hp), width: pct(shield) });
    if (changed('oh.ticks', String(Math.round(g.maxHp)))) $('oh-ticks').style.backgroundSize = `${(100 * 100) / g.maxHp}% 100%`;
    style('oh-mana', 'width', pct(g.mana / g.maxMana));
  }

  /** Floating combat text: pooled DOM labels projected from world positions, rising and fading. */
  private floatPool: HTMLDivElement[] = [];
  private projected = new THREE.Vector3();
  floaters(g: Game, camera: THREE.Camera) {
    this.overhead(g, camera);
    const layer = $('floaters');
    while (this.floatPool.length < g.floaters.length) {
      const el = document.createElement('div');
      layer.appendChild(el);
      this.floatPool.push(el);
    }
    this.floatPool.forEach((el, i) => {
      const f = g.floaters[i];
      if (!f) { el.style.display = 'none'; return; }
      this.projected.copy(f.pos).setY(f.kind === 'xp' ? 260 : 200).project(camera);
      const x = (this.projected.x * 0.5 + 0.5) * innerWidth;
      const y = (-this.projected.y * 0.5 + 0.5) * innerHeight - f.age * 60;
      el.style.display = 'block';
      const cls = `floater ${f.kind}`;
      if (el.className !== cls) el.className = cls;
      if (el.textContent !== f.text) el.textContent = f.text;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      el.style.opacity = String(1 - Math.max(0, f.age - 0.5) / 0.4);
    });
  }

  /** ESC menu: pauses the game; music / sound effect volume sliders; save the run, or abandon it (main.ts wires both). */
  toggleMenu() {
    this.menuOpen = !this.menuOpen;
    if (this.menuOpen && this.game) $('menu-info').innerHTML = menuInfo(this.game);
    // a popup on screen (level up, rune or boots pick) can't be saved: its options are closures
    const blocked = this.choosing || !!this.game?.choices.length;
    const save = $('menu-save') as HTMLButtonElement;
    save.disabled = blocked;
    save.textContent = t('menu.save');
    save.title = blocked ? t('menu.saveBlocked') : '';
    delete $('menu-quit').dataset.armed;
    $('menu-quit').textContent = t('menu.quit');
    $('menu').style.display = this.menuOpen ? 'flex' : 'none';
    audio.setPaused(this.menuOpen);
    audio.play(this.menuOpen ? 'hud_open' : 'hud_close');
  }

  /** Level-up: pick a skill rank (when one is available), then an item (or a potion once the build is complete). */
  levelUp(g: Game, done: () => void) {
    this.choosing = true;
    $('levelup').style.display = 'flex';
    const skills = g.skillOptions();
    const itemStep = () => this.itemStep(g, () => {
      $('levelup').style.display = 'none';
      this.choosing = false;
      done();
    });
    if (skills.length) this.skillStep(g, skills, itemStep);
    else itemStep();
  }

  /**
   * Skill step: one card per skill (Q W E R). Each shows what it does, its ranks, the next rank's damage with the
   * champion's current stats, cooldown and cost, what it scales with, and why it is (or isn't) the one to take.
   */
  private skillStep(g: Game, skills: SkillKey[], next: () => void) {
    $('levelup-title').textContent = t('levelup.skill', { level: g.level });
    $('inv-edit').innerHTML = '';
    $('choices').innerHTML = '';
    $('continue').style.display = 'none';
    const st = { ad: g.ad, bonusAd: g.bonusAd, ap: g.ap, haste: g.abilityHaste };
    const best = skills.reduce((a, k) => (skillScore(k, g.champ.skills[k], g.ranks[k], st) > skillScore(a, g.champ.skills[a], g.ranks[a], st) ? k : a), skills[0]);
    $('offers').innerHTML = SKILL_KEYS.map((k, i) => skillCard(g, k, skills.indexOf(k), k === best, st, i)).join('');
    this.keyActions = skills.map((k, i) => () => this.pickSkill(g, k, i, next));
    $('offers').querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', () => this.keyActions[Number(b.dataset.a)]?.()));
  }

  /** The chosen card rises, its new rank pip ignites; learning the ultimate gets the big moment. */
  private async pickSkill(g: Game, k: SkillKey, i: number, next: () => void) {
    if (this.busy) return;
    this.busy = true;
    this.keyActions = [];
    const card = $('offers').querySelector(`[data-a="${i}"]`)?.closest('.ioffer');
    $('offers').querySelectorAll('.ioffer').forEach((c) => c.classList.add(c === card ? 'chosen' : 'dismiss'));
    card?.querySelector('.pip.next')?.classList.add('lit');
    card?.querySelector('.io-icon')?.insertAdjacentHTML('beforeend', '<i class="ring"></i><i class="ring r2"></i>');
    const first = g.ranks[k] === 0;
    g.rankUp(k);
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    audio.play('hud_levelup');
    await wait(calm ? 0 : 750);
    if (k === 'R' && first) await this.celebrate(g.champ.skills.R.icon, g.champ.skills.R.name, t('skillsel.ultimate'), calm);
    this.busy = false;
    next();
  }

  /**
   * Item step: one card per offer (a new item or the next level of an owned one), like the skill cards: the level
   * pips, each stat now and after the pick, the passive with its strength (or the level that unlocks it). The best
   * offer for the champion's recommended build is tagged.
   */
  private itemStep(g: Game, done: () => void) {
    $('levelup-title').textContent = t('levelup.item', { level: g.level });
    $('choices').innerHTML = '';
    $('continue').style.display = 'block';
    $('continue').onclick = () => done();
    this.invStrip(g);
    if (buildComplete(g.slots)) return this.potionStep(g, done);
    $('continue').textContent = t('levelup.declineItems');
    const build = g.champ.build;
    const offers = rollOffers(g.slots, g.champ.itemPool ?? 'ad', build);
    const best = offers.reduce<Offer | null>((a, o) => (!a || offerScore(o, g.slots, build) > offerScore(a, g.slots, build) ? o : a), null);
    $('offers').innerHTML = offers.map((o, i) => itemCard(g, o, i, o === best)).join('') || `<div class="ioffer">${t('levelup.noItems')}</div>`;
    const mark = (o: Offer | null) => $('inv-edit').querySelectorAll<HTMLElement>('[data-cell]').forEach((c) => c.classList.toggle('target', !!o && o.slot === Number(c.dataset.cell)));
    this.keyActions = offers.map((o, i) => () => this.pickItem(g, o, i, done));
    $('offers').querySelectorAll<HTMLElement>('[data-a]').forEach((b) => {
      const i = Number(b.dataset.a);
      b.addEventListener('mouseenter', () => mark(offers[i]));
      b.addEventListener('mouseleave', () => mark(null));
      b.addEventListener('click', () => this.keyActions[i]?.());
    });
  }

  /** Inventory strip of the item step; `burst`: the slot that just changed. */
  private invStrip(g: Game, burst = -1) {
    $('inv-edit').innerHTML = Array.from({ length: MAX_ITEMS }, (_, i) => {
      const s = g.slots[i];
      if (!s) return `<div class="slot empty" data-cell="${i}"></div>`;
      const state = slotState(g, i);
      return `<div class="slot ${state} ${burst === i ? 'burst' : ''}" data-cell="${i}" title="${slotTitle(g, i)}"><img src="${itemIcon(s.id)}" alt="">${lvBadge(s.level)}${legTag(g, i)}
        ${burst === i ? '<i class="ring"></i><i class="ring r2"></i>' : ''}</div>`;
    }).join('');
  }

  /** The pick lands: the chosen card rises, the others fall away, the item flies into its slot; max level gets its own moment. */
  private async pickItem(g: Game, o: Offer, i: number, done: () => void) {
    if (this.busy) return;
    this.busy = true;
    this.keyActions = [];
    const card = $('offers').querySelector(`[data-a="${i}"]`)?.closest('.ioffer');
    const from = card?.querySelector('.io-icon img')?.getBoundingClientRect();
    $('offers').querySelectorAll('.ioffer').forEach((c) => c.classList.add(c === card ? 'chosen' : 'dismiss'));
    if (o.kind === 'new') g.takeItem(o.id);
    else g.levelItem(o.slot);
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cell = $('inv-edit').querySelector<HTMLElement>(`[data-cell="${o.slot}"]`);
    if (!calm && from && cell) {
      await wait(200);
      const to = cell.getBoundingClientRect();
      const fly = document.createElement('img');
      fly.className = 'fly';
      fly.src = itemIcon(o.id);
      Object.assign(fly.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
      document.body.append(fly);
      const dx = to.left - from.left, dy = to.top - from.top;
      await fly.animate([
        { transform: 'translate(0, 0) scale(1)' },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 70}px) scale(1.3)`, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) scale(${to.width / from.width})` },
      ], { duration: 640, easing: 'cubic-bezier(0.5, 0, 0.3, 1)' }).finished;
      fly.remove();
    }
    this.invStrip(g, o.slot);
    if (g.slots[o.slot].level >= MAX_LEVEL) await this.celebrate(itemIcon(o.id), ITEMS[o.id].name, t('itemsel.maxed'), calm);
    else await wait(calm ? 0 : 650);
    this.busy = false;
    done();
  }
  private busy = false;

  /** A big moment (finished item, ultimate learned): the icon in the middle of the screen, rings and sparks, the name slammed in. */
  private async celebrate(icon: string, name: string, label: string, calm: boolean) {
    const fx = $('item-fx');
    fx.querySelector('img')!.src = icon;
    fx.querySelector('.halo')!.querySelectorAll('.ring, .sp').forEach((x) => x.remove());
    fx.querySelector('.halo')!.insertAdjacentHTML('beforeend', '<i class="ring"></i><i class="ring r2"></i>'
      + Array.from({ length: 10 }, (_, k) => `<i class="sp" style="--a:${k * 36}deg"></i>`).join(''));
    fx.querySelector('small')!.textContent = label;
    fx.querySelector('b')!.textContent = name;
    fx.classList.add('show');
    audio.play('hud_legendary');
    await wait(calm ? 900 : 1700);
    fx.classList.remove('show');
  }

  /** Build complete: level ups offer potions instead of items. */
  private potionStep(g: Game, done: () => void) {
    $('levelup-title').textContent = t('levelup.potion', { level: g.level });
    $('continue').textContent = t('levelup.decline');
    const potions = [
      { ...POTIONS.hp, run: () => g.drinkPotion('hp') },
      { ...POTIONS.mana, run: () => g.drinkPotion('mana') },
    ];
    $('offers').innerHTML = potions.map((p, i) => `<article class="ioffer" style="animation-delay:${i * 0.08}s">
      <header class="io-head"><span class="io-icon"><img src="${itemIcon(p.icon)}" alt=""></span><div><b>${p.name}</b><small>${p.text}</small></div></header>
      <div class="io-acts"><button class="iact" data-a="${i}"><kbd>${i + 1}</kbd><span class="ia-main"><b>${t('itemsel.drink')}</b></span></button></div></article>`).join('');
    this.keyActions = potions.map((p) => () => { p.run(); done(); });
    $('offers').querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', () => this.keyActions[Number(b.dataset.a)]()));
  }

  private bindChoices() {
    $('choices').querySelectorAll<HTMLElement>('[data-i]').forEach((b) =>
      b.addEventListener('click', () => this.keyActions[Number(b.dataset.i)]()));
  }

  /** A rune popup (Game.choices): pick one option by click or number key, or skip it. */
  choice(c: Choice, done: () => void) {
    this.choosing = true;
    const close = () => { $('levelup').style.display = 'none'; this.choosing = false; done(); };
    $('levelup').style.display = 'flex';
    $('levelup-title').textContent = c.title;
    $('inv-edit').innerHTML = '';
    $('offers').innerHTML = '';
    $('continue').style.display = 'block';
    $('continue').textContent = t('levelup.decline');
    $('continue').onclick = close;
    $('choices').innerHTML = c.options.map((o, i) => `<div class="offer" role="button" tabindex="0" data-i="${i}">
      <img src="${o.icon}" alt=""><div><b>${i + 1}. ${o.name}</b><span>${o.text}</span></div></div>`).join('');
    this.keyActions = c.options.map((o) => () => { o.run(); close(); });
    this.bindChoices();
  }

  /**
   * End of run, after the cinematic (src/cinematic.ts): victory or defeat banner, the run's numbers counting up,
   * the rune points it earned and the cheapest rune they can buy now (the reason to start the next run).
   * `progress` is already credited with `gained`.
   */
  showEnd(g: Game, gained: number, progress: Progress, actions: { runePage: () => void; again: () => void }) {
    const won = g.over === 'won';
    $('end').className = `overlay ${won ? 'won' : 'lost'}`;
    const title = t(won ? 'end.won' : 'end.lost');
    const h = $('end-title');
    h.setAttribute('aria-label', title);
    h.replaceChildren(...(won ? [title] : [...title]).map((c, i) => {
      const s = document.createElement('span');
      s.textContent = c;
      s.setAttribute('aria-hidden', 'true');
      if (!won) { s.className = 'l'; s.style.animationDelay = `${(i * 0.07).toFixed(2)}s`; }
      return s;
    }));
    if (!won) h.insertAdjacentHTML('beforeend', '<i class="crack"></i>');
    $('end-sub').textContent = won ? t('end.bossSlain', { boss: ENEMIES.baron.name ?? '' }) : t('end.fellAt', { time: fmt(g.time) });
    ($('end-portrait') as HTMLImageElement).src = g.champ.icon;
    $('end-champ').textContent = g.champ.name;
    const page = g.page;
    $('end-page').textContent = [page.keystone && RUNES[page.keystone].name, page.primary && TREES[page.primary].name, page.secondary && TREES[page.secondary].name]
      .filter(Boolean).join(' · ');
    $('end-time').textContent = fmt(g.time);
    $('end-level').textContent = String(g.level);
    $('end-items').innerHTML = g.inventory.map((id) => `<img src="${itemIcon(id)}" title="${ITEMS[id].name}" alt="">`).join('');
    $('end-reward-label').textContent = t(won ? 'end.reward' : 'end.keep');
    $('end-runes').textContent = t('end.runes', { kills: KILLS_PER_POINT - progress.killRemainder });
    countUp($('end-kills'), g.kills, 1200, 900);
    countUp($('end-points'), gained, 1300, 1300, '+');
    $('end-hook').innerHTML = hook(progress);
    $('end-fx').innerHTML = Array.from({ length: 24 }, () =>
      `<i class="ember" style="left:${(Math.random() * 100).toFixed(1)}%;top:${(won ? 55 + Math.random() * 45 : Math.random() * 30).toFixed(1)}%;animation-duration:${(5 + Math.random() * 5).toFixed(1)}s;animation-delay:${(Math.random() * 6).toFixed(1)}s"></i>`).join('');
    $('restart').textContent = t(won ? 'end.again' : 'end.retry');
    const close = (go: () => void) => () => { $('end').style.display = 'none'; go(); };
    $('end-rune-page').onclick = close(actions.runePage);
    $('restart').onclick = close(actions.again);
    $('end').style.display = 'flex';
  }
}

/** Counts `el` from 0 to `to` in the player's number format, after `delay` ms. */
function countUp(el: HTMLElement, to: number, ms: number, delay: number, prefix = '') {
  el.textContent = `${prefix}0`;
  const start = performance.now() + delay;
  const step = (now: number) => {
    const k = Math.max(0, Math.min(1, (now - start) / ms));
    el.textContent = prefix + num(Math.round(to * (1 - (1 - k) ** 3)));
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** The cheapest locked rune: "you can unlock it now", else how many points it still takes. */
function hook(p: Progress) {
  const locked = Object.values(RUNES).filter((r) => !p.unlocked.includes(r.id))
    .map((r) => ({ r, cost: nodeCost(p, r.tree) }))
    .sort((a, b) => a.cost - b.cost || a.r.row - b.r.row);
  const next = locked[0];
  if (!next) return '';
  const rune = `<b>${next.r.name}</b>`;
  const msg = p.points >= next.cost ? t('end.hookReady', { rune }) : t('end.hookMissing', { rune, n: next.cost - p.points });
  return `<img src="${next.r.icon}" alt=""><span>${msg}</span>`;
}

/** Six inventory cells; `cell` renders an owned slot with its state class and tooltip. */
function slotsHtml(g: Game, cell: (i: number, cls: string, title: string) => string, empty: string) {
  return Array.from({ length: MAX_ITEMS }, (_, i) => (g.slots[i] ? cell(i, slotState(g, i), slotTitle(g, i)) : empty)).join('');
}
const slotState = (g: Game, i: number) => (g.legendary === i ? 'legendary' : g.slots[i].level >= MAX_LEVEL ? 'final' : '');
function slotTitle(g: Game, i: number) {
  const { id, level } = g.slots[i];
  const state = slotState(g, i);
  return state ? t(`slot.${state}`, { item: ITEMS[id].name }) : t('slot.level', { item: ITEMS[id].name, level, max: MAX_LEVEL });
}
/** ESC menu: every champion stat, then each item with its stats and passive at its level. */
function menuInfo(g: Game) {
  const it = g.items;
  const pct = (v: number) => `${num(v * 100)}%`;
  const extra = (k: FxStat) => (k in it ? it[k as keyof ItemStats]! : 0) + g.fxStat(k);
  const rows: [string, string][] = [
    [t('stat.hp'), `${num(Math.round(g.hp))} / ${num(Math.round(g.maxHp))}`],
    [t('stat.mana'), `${num(Math.round(g.mana))} / ${num(Math.round(g.maxMana))}`],
    [t('stat.ad'), num(Math.round(g.ad))], [t('stat.ap'), num(Math.round(g.ap))], [t('stat.as'), num(g.attackSpeed, 2)],
    [t('stat.armor'), num(Math.round(g.armor))], [t('stat.mr'), num(Math.round(g.mr))], [t('stat.msPct'), num(g.moveSpeed)],
    [t('stat.ah'), num(Math.round(g.abilityHaste))], [t('stat.crit'), pct(g.critChance)],
    [t('stat.critDamage'), pct(g.champ.base.critDamage + it.critDamage)],
    ...(['lifesteal', 'omnivamp', 'armorPen', 'magicPen', 'tenacity'] as const).filter((k) => extra(k) > 0).map((k): [string, string] => [t(`stat.${k}`), statValue(k, extra(k))]),
    ...(['lethality', 'magicPenFlat'] as const).filter((k) => extra(k) > 0).map((k): [string, string] => [t(`stat.${k}`), num(Math.round(extra(k)))]),
  ];
  const boots = g.boots ? `<div class="mi-item"><span class="mi-icon"><img src="${itemIcon(g.boots)}" alt=""></span><div>
      <b>${BOOTS[g.boots].name}</b><p>${bootsText(g.boots)}</p></div></div>` : '';
  const items = g.slots.map(({ id, level }, i) => {
    const stats = statsAt(id, level, i === g.legendary ? 1 + LEGENDARY_BONUS : 1);
    const passive = PASSIVES[id];
    return `<div class="mi-item ${slotState(g, i)}"><span class="mi-icon ${slotState(g, i)}"><img src="${itemIcon(id)}" alt="">${legTag(g, i)}</span><div>
      <b>${ITEMS[id].name}</b><small>${t('menu.itemLevel', { level, max: MAX_LEVEL })}</small>
      <p>${Object.entries(stats).map(([k, v]) => `+${statValue(k as keyof ItemStats, v)} ${t(`stat.${k as keyof ItemStats}`)}`).join(' · ')}</p>
      ${passive ? `<p class="mi-passive ${level < PASSIVE_LEVEL ? 'locked' : ''}">${passive}${level < PASSIVE_LEVEL ? ` <em>${t('itemsel.unlocksAt', { level: PASSIVE_LEVEL })}</em>` : ` <em>${pct(PASSIVE_POWER[level - 1])}</em>`}</p>` : ''}
    </div></div>`;
  }).join('');
  return `<section><h3>${t('menu.champion')}</h3><div class="mi-stats">${rows.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div></section>
    <section><h3>${t('menu.items')}</h3>${items + boots || `<p class="mi-empty">${t('menu.noItems')}</p>`}</section>`;
}

const bootsText = (id: string) => [describeStats(BOOTS[id].stats), PLATING.has(id) ? t('boots.plating') : ''].filter(Boolean).join(' · ');
const bootsTitle = (id: string) => `${BOOTS[id].name}: ${bootsText(id)}`;
const lvBadge = (level: number) => `<i class="lv">${level}</i>`;
/** Animated "Legendary" ribbon over the slot the blueprint upgraded. */
const legTag = (g: Game, i: number) => (g.legendary === i ? `<em class="leg">${t('slot.legendaryTag')}</em>` : '');

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';

/** An item offer as a card: level pips, stats now and after the pick, the passive and its strength, the pick button. */
function itemCard(g: Game, o: Offer, n: number, best: boolean) {
  const it = ITEMS[o.id];
  const now = o.kind === 'level' ? g.slots[o.slot].level : 0;
  const next = now + 1;
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const row = (label: string, a: string | null, b: string) => `<div class="sk-row"><span>${label}</span><b>${a ?? '—'}</b>${ARROW}<b class="up">${b}</b></div>`;
  const before: ItemStats = now ? statsAt(o.id, now) : {};
  const rows = Object.entries(statsAt(o.id, next)).map(([k, v]) => {
    const key = k as keyof ItemStats;
    return row(t(`stat.${key}`), now ? statValue(key, before[key]!) : null, statValue(key, v));
  });
  const passive = PASSIVES[o.id];
  if (passive && next >= PASSIVE_LEVEL) rows.push(row(t('itemsel.passive'), PASSIVE_POWER[now - 1] ? pct(PASSIVE_POWER[now - 1]) : null, pct(PASSIVE_POWER[next - 1])));
  const pips = Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="pip ${i < now ? 'on' : i === now ? 'next' : ''}"></i>`).join('');
  const why = best && g.champ.build.includes(o.id) ? t('itemsel.inBuild') : next >= MAX_LEVEL ? t('itemsel.toMax') : '';
  return `<article class="ioffer skc ${best ? 'best' : ''}" style="animation-delay:${n * 0.07}s">
    <header class="io-head"><span class="io-icon"><img src="${itemIcon(o.id)}" alt=""></span>
      <div><b>${it.name}</b><small>${o.kind === 'new' ? t('itemsel.new') : t('itemsel.level', { from: now, to: next })}</small></div></header>
    <div class="sk-pips" aria-label="${t('itemsel.level', { from: now, to: next })}">${pips}</div>
    <div class="sk-rows">${rows.join('')}</div>
    ${passive ? `<p class="sk-desc ${next < PASSIVE_LEVEL ? 'locked' : ''}">${passive}${next < PASSIVE_LEVEL ? `<em>${t('itemsel.unlocksAt', { level: PASSIVE_LEVEL })}</em>` : ''}</p>` : ''}
    <button class="iact ${best ? 'rec' : ''}" data-a="${n}"><kbd>${n + 1}</kbd>
      <span class="ia-main"><b>${o.kind === 'new' ? t('itemsel.take') : t('itemsel.levelUp')}</b></span>
      ${why ? `<span class="ia-meta">${why}</span>` : ''}${best ? `<span class="tag">${t('itemsel.recommended')}</span>` : ''}</button>
  </article>`;
}

/** A skill of the skill step: `n` is its number among the skills that can rank up (-1: not this level). */
function skillCard(g: Game, k: SkillKey, n: number, best: boolean, st: SkillStats, order: number) {
  const s = g.champ.skills[k];
  const rank = g.ranks[k];
  const max = rank >= s.maxRank;
  const now = rank > 0 ? skillNumbers(s, rank - 1, st) : null;
  const nx = max ? null : skillNumbers(s, rank, st);
  const sec = (v: number) => t('skillsel.seconds', { n: num(v, v % 1 ? 1 : 0) });
  const row = (label: string, a: string | null, b: string | null, better: boolean) =>
    `<div class="sk-row"><span>${label}</span><b>${a ?? '—'}</b>${b !== null ? `${ARROW}<b class="${better ? 'up' : ''}">${b}</b>` : ''}</div>`;
  const rows = [
    s.damage.some((d) => d > 0) ? row(t(`skillsel.${s.damageType}` as Key), now && num(Math.round(now.damage)), nx && num(Math.round(nx.damage)), true) : '',
    s.hits ? `<div class="sk-row sub"><span></span><em>${t('skillsel.hits', { n: s.hits, dmg: num(Math.round((nx ?? now)!.perHit)) })}</em></div>` : '',
    s.cooldown.some((c) => c > 0) ? row(t('skillsel.cooldown'), now && sec(now.cooldown), nx && sec(nx.cooldown), !!now && !!nx && nx.cooldown < now.cooldown) : '',
    s.cost.some((c) => c > 0) ? row(t('skillsel.cost'), now && num(now.cost), nx && num(nx.cost), false) : '',
    s.extra ? row(s.extra.label, rank > 0 ? fmtExtra(s.extra, rank - 1) : null, max ? null : fmtExtra(s.extra, rank), true) : '',
    now && nx && nx.dps > 0 ? row(t('skillsel.dps'), num(Math.round(now.dps)), num(Math.round(nx.dps)), true) : '',
  ].join('');
  const ratios = [
    s.adRatio !== undefined && t('skillsel.ratioAd', { n: Math.round((typeof s.adRatio === 'number' ? s.adRatio : s.adRatio[Math.min(rank, s.maxRank - 1)]) * 100) }),
    s.bonusAdRatio && t('skillsel.ratioBonusAd', { n: Math.round(s.bonusAdRatio * 100) }),
    s.apRatio && t('skillsel.ratioAp', { n: Math.round((typeof s.apRatio === 'number' ? s.apRatio : s.apRatio[Math.min(rank, s.maxRank - 1)]) * 100) }),
  ].filter(Boolean).join(' · ');
  const why = k === 'R' ? t('skillsel.whyUlt') : rank === 0 ? t('skillsel.whyNew') : t('skillsel.whyDps', { n: num(Math.max(0, Math.round(dpsGain(s, rank, st)))) });
  const lock = max ? t('skillsel.max')
    : t('skillsel.unlocksAt', { level: (g.champ.rankLevels?.[k] ?? (k === 'R' ? [6, 11, 16] : [1, 3, 5, 7, 9]))[rank] });
  const pips = Array.from({ length: s.maxRank }, (_, i) => `<i class="pip ${i < rank ? 'on' : i === rank && n >= 0 ? 'next' : ''}"></i>`).join('');
  const action = n >= 0
    ? `<button class="iact ${best ? 'rec' : ''}" data-a="${n}"><kbd>${n + 1}</kbd>
        <span class="ia-main"><b>${rank === 0 ? t('levelup.learn') : t('levelup.rank', { from: rank, to: rank + 1 })}</b></span>
        <span class="ia-meta">${why}</span>${best ? `<span class="tag">${t('itemsel.recommended')}</span>` : ''}</button>`
    : `<div class="sk-lock">${lock}</div>`;
  return `<article class="ioffer skc ${n < 0 ? 'off' : ''} ${best ? 'best' : ''}" style="animation-delay:${order * 0.07}s">
    <header class="io-head"><span class="io-icon"><img src="${s.icon}" alt=""><kbd class="sk-key">${k}</kbd></span>
      <div><b>${s.name}</b><small class="dt ${s.damageType}">${t(`skillsel.${s.damageType}` as Key)}</small></div></header>
    <div class="sk-pips" aria-label="${t('levelup.rank', { from: rank, to: s.maxRank })}">${pips}</div>
    <p class="sk-desc">${s.desc}</p>
    <div class="sk-rows">${rows}</div>
    ${ratios ? `<div class="sk-scale"><span class="io-label">${t('skillsel.scaling')}</span> ${ratios}</div>` : ''}
    ${action}
  </article>`;
}

const fmtExtra = (e: NonNullable<SkillDef['extra']>, r: number) => (e.percent ? `${Math.round(e.values[r] * 100)}%` : num(e.values[r], e.values[r] % 1 ? 1 : 0));
