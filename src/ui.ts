import * as THREE from 'three';
import { audio } from './audio';
import { BUFF } from './buffs';
import { SKILL_KEYS, type ChampionDef, type SkillKey } from './champion';
import { HORDE, xpToNext } from './data';
import { t } from './i18n';
import type { Choice, Game } from './game';
import { KILLS_PER_POINT } from './progress';
import { PASSIVES } from './itemEffects';
import {
  buildComplete, claimed, describeStats, finalsVia, isFinal, isLocked, itemIcon, ITEMS, LEGENDARY_BONUS, lineTree, MAX_ITEMS,
  nextSteps, POTIONS, rollOffers, slotItem, type LineNode,
} from './items';

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
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Hud {
  /** Number-key handlers for the open level-up step (index 0 = key 1). */
  private keyActions: (() => void)[] = [];
  choosing = false;
  menuOpen = false;

  private skillEls: Record<SkillKey, { root: HTMLElement; cd: HTMLElement; cdText: HTMLElement; pips: HTMLElement }>;

  constructor(champ: ChampionDef) {
    $('menu-resume').onclick = () => this.toggleMenu();
    $('menu-music').onclick = () => { audio.setMusic(!audio.musicOn); this.menuLabels(); };
    $('menu-sfx').onclick = () => { audio.setSfx(!audio.sfxOn); this.menuLabels(); };
    $('skills').innerHTML = SKILL_KEYS.map((k) => `
      <div class="skill" id="skill-${k}">
        <img src="${champ.skills[k].icon}" alt="">
        <div class="cd"></div><div class="cd-text"></div><span class="key">${k}</span><div class="pips"></div>
      </div>`).join('');
    // not $(): its id cache would still hold the previous HUD's (now detached) skill slots
    const root = (k: SkillKey) => document.getElementById(`skill-${k}`)!;
    const part = (k: SkillKey, sel: string) => root(k).querySelector<HTMLElement>(sel)!;
    this.skillEls = Object.fromEntries(SKILL_KEYS.map((k) => [k, {
      root: root(k), cd: part(k, '.cd'), cdText: part(k, '.cd-text'), pips: part(k, '.pips'),
    }])) as Hud['skillEls'];
    $('gauge').querySelector('img')!.src = champ.passive.icon;
    shown.clear(); // a new HUD (new champion) redraws everything
  }

  update(g: Game) {
    text('timer', fmt(g.time));
    text('kills', t('hud.kills', { n: g.kills }));
    text('level', String(g.level));
    style('xp-fill', 'width', `${((g.xp / xpToNext(g.level)) * 100).toFixed(1)}%`);
    style('hp-fill', 'width', `${((g.hp / g.maxHp) * 100).toFixed(1)}%`);
    text('hp-text', g.stasis > 0 ? `${ITEMS['3026'].name} ${g.stasis.toFixed(1)}s` : `${Math.ceil(g.hp)} / ${Math.ceil(g.maxHp)}`);
    style('mana-fill', 'width', `${((g.mana / g.maxMana) * 100).toFixed(1)}%`);
    text('mana-text', `${Math.floor(g.mana)} / ${Math.floor(g.maxMana)}`);
    if (changed('auto', String(g.autoAttack))) {
      $('auto').textContent = t(g.autoAttack ? 'hud.autoOn' : 'hud.autoOff');
      $('auto').classList.toggle('off', !g.autoAttack);
    }
    const passive = g.kit.hud?.();
    const buffs = (['blue', 'red'] as const).filter((k) => g.buffs[k] > g.time).map((k) => ` · ${BUFF.names[k]} ${fmt(g.buffs[k] - g.time)}`).join('');
    text('stats', [
      `${t('hud.stat.ad')} ${Math.round(g.ad)}`, `${t('hud.stat.as')} ${g.attackSpeed.toFixed(2)}`, `${t('hud.stat.armor')} ${Math.round(g.armor)}`,
      `${t('hud.stat.ms')} ${g.moveSpeed}`, `${t('hud.stat.ah')} ${g.abilityHaste}`, `${t('hud.stat.crit')} ${Math.round(g.critChance * 100)}%`,
    ].join(' · ') + `${passive ? ` · ${passive}` : ''}${buffs}`);
    const gauge = g.kit.gauge?.();
    style('gauge', 'display', gauge ? 'block' : 'none');
    if (gauge) {
      text('gauge-label', gauge.label);
      style('gauge-fill', 'height', `${(Math.min(1, gauge.fill) * 100).toFixed(1)}%`);
      if (changed('gauge-ready', String(gauge.ready))) $('gauge').classList.toggle('ready', gauge.ready);
    }
    for (const k of SKILL_KEYS) {
      const el = this.skillEls[k];
      const rank = g.ranks[k];
      const cd = g.cooldowns[k];
      el.root.classList.toggle('locked', rank === 0);
      el.root.classList.toggle('nomana', rank > 0 && g.mana < g.costOf(k));
      el.root.classList.toggle('blocked', rank > 0 && g.kit.canCast?.(k) === false);
      el.root.classList.toggle('empowered', rank > 0 && !!gauge?.ready && gauge.skill === k);
      // text stays centered on the icon while the overlay shrinks, so the last seconds stay readable
      const cdText = cd > 0 ? (cd < 1 ? cd.toFixed(1) : String(Math.ceil(cd))) : '';
      if (changed(`cd-text-${k}`, cdText)) el.cdText.textContent = cdText;
      const height = rank > 0 && cd > 0 ? `${((cd / g.cooldownOf(k)) * 100).toFixed(1)}%` : '0';
      if (changed(`cd-${k}`, height)) el.cd.style.height = height;
      if (changed(`pips-${k}`, String(rank))) {
        el.pips.innerHTML = Array.from({ length: g.champ.skills[k].maxRank }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
      }
    }
    if (changed('inventory', `${g.inventory.join(',')}|${g.legendary}`)) {
      $('inventory').innerHTML = slotsHtml(g, (i, cls, title) => `<img src="${itemIcon(slotItem(g.slots[i]))}" class="${cls}" title="${title}">`, '<span></span>');
    }
    const hordeIn = g.nextHordeAt - g.time;
    style('horde', 'display', hordeIn <= HORDE.warning ? 'block' : 'none');
    if (hordeIn <= HORDE.warning) text('horde', t('hud.horde', { s: Math.ceil(hordeIn) }));
    const boss = g.boss;
    style('boss', 'display', boss ? 'block' : 'none');
    if (boss) {
      text('boss-name', boss.def.name ?? boss.def.model);
      style('boss-fill', 'width', `${((boss.hp / boss.maxHp) * 100).toFixed(1)}%`);
    }
  }

  key(n: number) { this.keyActions[n - 1]?.(); }

  /** Floating combat text: pooled DOM labels projected from world positions, rising and fading. */
  private floatPool: HTMLDivElement[] = [];
  private projected = new THREE.Vector3();
  floaters(g: Game, camera: THREE.Camera) {
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

  /** ESC menu: pauses the game and toggles music / sound effects. */
  toggleMenu() {
    this.menuOpen = !this.menuOpen;
    $('menu').style.display = this.menuOpen ? 'flex' : 'none';
    audio.setPaused(this.menuOpen);
    audio.play(this.menuOpen ? 'hud_open' : 'hud_close');
    this.menuLabels();
  }

  private menuLabels() {
    $('menu-music').textContent = t(audio.musicOn ? 'menu.musicOn' : 'menu.musicOff');
    $('menu-sfx').textContent = t(audio.sfxOn ? 'menu.sfxOn' : 'menu.sfxOff');
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

  private skillStep(g: Game, skills: SkillKey[], next: () => void) {
    $('levelup-title').textContent = t('levelup.skill', { level: g.level });
    $('inv-edit').innerHTML = '';
    $('tree').innerHTML = '';
    $('choices').innerHTML = skills.map((k, i) => {
      const s = g.champ.skills[k];
      const r = g.ranks[k];
      return `<button data-i="${i}" class="skill-choice">
        <img src="${s.icon}" alt="">
        <div><b>${i + 1}. [${k}] ${s.name}</b>
        <span>${r === 0 ? t('levelup.learn') : t('levelup.rank', { from: r, to: r + 1 })} · ${t('levelup.cooldown', { s: s.cooldown[r] })} · ${t('levelup.cost', { mana: s.cost[r] })}</span></div></button>`;
    }).join('');
    this.keyActions = skills.map((k) => () => { g.rankUp(k); next(); });
    this.bindChoices();
    $('continue').style.display = 'none';
  }

  private itemStep(g: Game, done: () => void) {
    $('levelup-title').textContent = t('levelup.item', { level: g.level });
    $('inv-edit').innerHTML = slotsHtml(g, (i, cls, title) =>
      `<div class="slot ${cls}" title="${title}" data-slot="${i}"><img src="${itemIcon(slotItem(g.slots[i]))}" alt=""></div>`,
    '<div class="slot empty"></div>');
    $('inv-edit').querySelectorAll<HTMLElement>('[data-slot]').forEach((el) =>
      el.addEventListener('mouseenter', () => showTree(g, g.slots[Number(el.dataset.slot)].base)));
    $('continue').style.display = 'block';
    $('continue').onclick = () => done();
    if (buildComplete(g.slots)) return this.potionStep(g, done);
    $('continue').textContent = t('levelup.declineItems');
    const offers = rollOffers(g.slots);
    // every choice is one numbered button: take the offer as a new item, or spend it evolving a slot of its line
    const actions: { label: string; run: () => void }[] = [];
    const cards = offers.map((base, o) => {
      const buttons: string[] = [];
      const add = (label: string, run: () => void) => {
        buttons.push(`<button class="act" data-a="${actions.length}">${actions.length + 1}. ${label}</button>`);
        actions.push({ label, run });
      };
      if (g.slots.length < MAX_ITEMS) add(t('levelup.takeNew'), () => g.takeItem(base));
      g.slots.forEach((s, i) => {
        if (s.base !== base) return;
        for (const step of nextSteps(g.slots, i)) {
          const finals = finalsVia(g.slots, i, step).map((f) => ITEMS[f].name).join(' / ');
          add(t('levelup.evolve', { from: ITEMS[slotItem(s)].name, to: ITEMS[step].name, finals }), () => g.evolve(i, step));
        }
      });
      return `<div class="offer" data-o="${o}">${itemCard(base)}<div class="acts">${buttons.join('')}</div></div>`;
    });
    $('choices').innerHTML = cards.join('') || `<div class="offer">${t('levelup.noItems')}</div>`;
    $('choices').querySelectorAll<HTMLElement>('[data-o]').forEach((el) =>
      el.addEventListener('mouseenter', () => showTree(g, offers[Number(el.dataset.o)])));
    this.keyActions = actions.map((a) => () => { a.run(); done(); });
    $('choices').querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) =>
      b.addEventListener('click', () => this.keyActions[Number(b.dataset.a)]()));
    if (offers[0]) showTree(g, offers[0]);
  }

  /** Build complete: level ups offer potions instead of items. */
  private potionStep(g: Game, done: () => void) {
    $('levelup-title').textContent = t('levelup.potion', { level: g.level });
    $('continue').textContent = t('levelup.decline');
    $('tree').innerHTML = '';
    const potions = [
      { ...POTIONS.hp, run: () => g.drinkPotion('hp') },
      { ...POTIONS.mana, run: () => g.drinkPotion('mana') },
    ];
    $('choices').innerHTML = potions.map((p, i) => `<div class="offer" role="button" tabindex="0" data-i="${i}">
      <img src="${itemIcon(p.icon)}" alt=""><div><b>${i + 1}. ${p.name}</b><span>${p.text}</span></div></div>`).join('');
    this.keyActions = potions.map((p) => () => { p.run(); done(); });
    this.bindChoices();
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
    $('tree').innerHTML = '';
    $('continue').style.display = 'block';
    $('continue').textContent = t('levelup.decline');
    $('continue').onclick = close;
    $('choices').innerHTML = c.options.map((o, i) => `<div class="offer" role="button" tabindex="0" data-i="${i}">
      <img src="${o.icon}" alt=""><div><b>${i + 1}. ${o.name}</b><span>${o.text}</span></div></div>`).join('');
    this.keyActions = c.options.map((o) => () => { o.run(); close(); });
    this.bindChoices();
  }

  /** `gained`: rune points earned this run; `remainder`: kills already counted towards the next point. */
  showEnd(g: Game, gained: number, remainder: number, onRestart: () => void) {
    $('end-title').textContent = t(g.over === 'won' ? 'end.won' : 'end.lost');
    $('end-stats').textContent = t('end.stats', { time: fmt(g.time), level: g.level, kills: g.kills });
    $('end-runes').textContent = t('end.runes', { gained, kills: KILLS_PER_POINT - remainder });
    $('end-items').innerHTML = g.inventory.map((id) => `<img src="${itemIcon(id)}" title="${ITEMS[id].name}">`).join('');
    $('end').style.display = 'flex';
    $('restart').onclick = () => { $('end').style.display = 'none'; onRestart(); };
  }
}

/** Six inventory cells; `cell` renders an owned slot with its state class and tooltip. */
function slotsHtml(g: Game, cell: (i: number, cls: string, title: string) => string, empty: string) {
  return Array.from({ length: MAX_ITEMS }, (_, i) => {
    const s = g.slots[i];
    if (!s) return empty;
    const legendary = g.legendary === i;
    const state = legendary ? 'legendary' : isFinal(s) ? 'final' : isLocked(g.slots, i) ? 'locked' : '';
    const item = ITEMS[slotItem(s)].name;
    return cell(i, state, state ? t(`slot.${state}`, { item }) : item);
  }).join('');
}

function itemCard(id: string) {
  const it = ITEMS[id];
  return `<img src="${itemIcon(id)}" alt="">
    <div><b>${it.name}</b><span>${describeStats(it.stats)}</span>
    ${PASSIVES[id] ? `<span class="passive">${PASSIVES[id]}</span>` : ''}</div>`;
}

/**
 * Evolution tree of a line, top-down: every branch with its stats, the copies of the base each finished item costs,
 * where the player's slots of this line sit, and which finished items are already owned or reserved (blocked).
 */
function showTree(g: Game, base: string) {
  const taken = claimed(g.slots);
  const here = (n: LineNode) => g.slots.filter((s) => s.base === base && s.path.join() === n.path.join()).length;
  const blocked = (n: LineNode): boolean => (n.kids.length ? n.kids.every(blocked) : taken.has(n.id) && !here(n));
  const node = (n: LineNode): string => {
    const it = ITEMS[n.id];
    const owned = here(n);
    const finalItem = !n.kids.length;
    const state = owned ? 'owned' : blocked(n) ? 'missing' : finalItem ? 'root' : '';
    const badge = owned ? `${t('tree.owned')}${owned > 1 ? ` ×${owned}` : ''}` : blocked(n) ? t('tree.blocked') : finalItem ? t('tree.copies', { n: n.path.length + 1 }) : '';
    const legendary = owned && g.legendary >= 0 && g.slots[g.legendary].base === base && g.slots[g.legendary].path.join() === n.path.join();
    const stats = describeStats(it.stats, legendary ? 1 + LEGENDARY_BONUS : 1);
    return `<li><div class="node ${state}" title="${it.name}${PASSIVES[n.id] ? ` — ${PASSIVES[n.id]}` : ''}">
        <img src="${itemIcon(n.id)}" alt=""><b>${it.name}</b><small>${stats}</small>${badge ? `<em>${badge}</em>` : ''}
      </div>${n.kids.length ? `<ul>${n.kids.map(node).join('')}</ul>` : ''}</li>`;
  };
  $('tree').innerHTML = `<div class="tree-head"><b>${t('tree.line', { item: ITEMS[base].name })}</b>
      <span>${t('tree.help', { item: ITEMS[base].name })}</span></div>
    <ul class="tree">${node(lineTree(base))}</ul>`;
}
