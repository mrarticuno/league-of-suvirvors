import * as THREE from 'three';
import { EZREAL, HORDE, SKILL_KEYS, xpToNext, type SkillKey } from './data';
import type { Game } from './game';
import {
  buildsInto, combinable, completedBy, describeStats, itemIcon, ITEMS, MAX_ITEMS, PASSIVES, rollOffers, type Item,
} from './items';

const $ = (id: string) => document.getElementById(id)!;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Hud {
  /** Number-key handlers for the open level-up step (index 0 = key 1). */
  private keyActions: (() => void)[] = [];
  choosing = false;

  constructor() {
    $('skills').innerHTML = SKILL_KEYS.map((k) => `
      <div class="skill" id="skill-${k}">
        <img src="https://ddragon.leagueoflegends.com/cdn/16.21.1/img/spell/Ezreal${k}.png" alt="">
        <div class="cd"></div><span class="key">${k}</span><div class="pips"></div>
      </div>`).join('');
  }

  update(g: Game) {
    $('timer').textContent = fmt(g.time);
    $('kills').textContent = `${g.kills} abates`;
    $('level').textContent = String(g.level);
    $('xp-fill').style.width = `${(g.xp / xpToNext(g.level)) * 100}%`;
    $('hp-fill').style.width = `${(g.hp / g.maxHp) * 100}%`;
    $('hp-text').textContent = g.stasis > 0 ? `Anjo Guardião ${g.stasis.toFixed(1)}s` : `${Math.ceil(g.hp)} / ${Math.ceil(g.maxHp)}`;
    $('mana-fill').style.width = `${(g.mana / g.maxMana) * 100}%`;
    $('mana-text').textContent = `${Math.floor(g.mana)} / ${Math.floor(g.maxMana)}`;
    $('auto').textContent = `Ataque automático: ${g.autoAttack ? 'LIGADO' : 'DESLIGADO'} (T)`;
    $('auto').classList.toggle('off', !g.autoAttack);
    $('stats').textContent =
      `DdA ${Math.round(g.ad)} · VA ${g.attackSpeed.toFixed(2)} · Arm ${Math.round(g.armor)} · VM ${g.moveSpeed} · AH ${g.abilityHaste} · Crit ${Math.round(g.critChance * 100)}% · Passiva ${g.passiveStacks}/5`;
    for (const k of SKILL_KEYS) {
      const el = $(`skill-${k}`);
      const rank = g.ranks[k];
      const cd = g.cooldowns[k];
      el.classList.toggle('locked', rank === 0);
      el.classList.toggle('nomana', rank > 0 && g.mana < g.costOf(k));
      const cdEl = el.querySelector<HTMLElement>('.cd')!;
      cdEl.textContent = cd > 0 ? (cd < 1 ? cd.toFixed(1) : String(Math.ceil(cd))) : '';
      cdEl.style.height = rank > 0 && cd > 0 ? `${(cd / g.cooldownOf(k)) * 100}%` : '0';
      el.querySelector('.pips')!.innerHTML = Array.from({ length: EZREAL[k].maxRank }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
    }
    const inv = g.inventory.join(',');
    if ($('inventory').dataset.inv !== inv) {
      $('inventory').dataset.inv = inv;
      $('inventory').innerHTML = slots(g.inventory).map((id) =>
        id ? `<img src="${itemIcon(id)}" title="${ITEMS[id].name}">` : '<span></span>').join('');
    }
    $('combine').style.display = combinable(g.inventory).length ? 'block' : 'none';
    const hordeIn = g.nextHordeAt - g.time;
    $('horde').style.display = hordeIn <= HORDE.warning ? 'block' : 'none';
    $('horde').textContent = `Horda chegando em ${Math.ceil(hordeIn)}s!`;
    const boss = g.boss;
    $('boss').style.display = boss ? 'block' : 'none';
    if (boss) {
      $('boss-name').textContent = boss.def.name ?? boss.def.model;
      $('boss-fill').style.width = `${(boss.hp / boss.maxHp) * 100}%`;
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
      el.className = `floater ${f.kind}`;
      el.textContent = f.text;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      el.style.opacity = String(1 - Math.max(0, f.age - 0.5) / 0.4);
    });
  }

  /** Level-up: pick a skill rank (when one is available), then an item. */
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
    $('levelup-title').textContent = `Nível ${g.level} — escolha uma habilidade`;
    $('inv-edit').innerHTML = '';
    $('combos').innerHTML = '';
    $('tree').innerHTML = '';
    $('choices').innerHTML = skills.map((k, i) => {
      const s = EZREAL[k];
      const r = g.ranks[k];
      return `<button data-i="${i}" class="skill-choice">
        <img src="https://ddragon.leagueoflegends.com/cdn/16.21.1/img/spell/Ezreal${k}.png" alt="">
        <div><b>${i + 1}. [${k}] ${s.name}</b>
        <span>${r === 0 ? 'Aprender' : `Rank ${r} → ${r + 1}`} · Recarga ${s.cooldown[r]}s · Custo ${s.cost[r]} mana</span></div></button>`;
    }).join('');
    this.keyActions = skills.map((k) => () => { g.rankUp(k); next(); });
    this.bindChoices();
    $('continue').style.display = 'none';
  }

  /** Combine-only screen, opened from the HUD (C) whenever the inventory holds a full recipe. */
  combineMenu(g: Game, done: () => void) {
    this.choosing = true;
    $('levelup').style.display = 'flex';
    this.itemStep(g, () => {
      $('levelup').style.display = 'none';
      this.choosing = false;
      done();
    }, false);
  }

  private itemStep(g: Game, done: () => void, withOffers = true) {
    const offers = withOffers ? rollOffers() : [];
    let picked: string | null = null;
    let confirmDiscard = -1;
    // recipe tree shown in the side panel: which legendary, and which offered item to highlight in it
    // offers show the legendary they lead to; the combine-only menu starts on the combinable item itself
    let tree = { root: offers[0] ? defaultTarget(offers[0], g) : combinable(g.inventory)[0]?.id ?? '', offered: offers[0]?.id ?? '' };
    const showTree = (root: string, offered: string | null) => {
      tree = { root, offered: offered ?? '' };
      $('tree').innerHTML = root ? treeHtml(root, g.inventory, picked ? '' : tree.offered) : '';
    };
    const render = () => {
      const full = g.inventory.length >= MAX_ITEMS;
      $('levelup-title').textContent = withOffers ? `Nível ${g.level} — escolha um item` : 'Combinar itens';
      $('inv-edit').innerHTML = slots(g.inventory).map((id, i) => id
        ? `<div class="slot ${confirmDiscard === i ? 'confirm' : ''}" title="${ITEMS[id].name}">
             <img src="${itemIcon(id)}" alt=""><button data-discard="${i}">${confirmDiscard === i ? 'Descartar?' : '×'}</button></div>`
        : '<div class="slot empty"></div>').join('');
      const combos = combinable(g.inventory);
      $('combos').innerHTML = combos.map((it, i) => `
        <div class="combo" role="button" tabindex="0" data-combo="${i}">
          ${itemCard(it, '', g, `<span class="recipe">Clique para combinar: ${it.from.map((c) => ITEMS[c].name).join(' + ')}</span>`)}</div>`).join('');
      // with a full inventory an offer is still takeable when it completes a recipe: it is combined on pick
      const into = offers.map((it) => (full ? completedBy(g.inventory, it.id) : undefined));
      $('choices').innerHTML = offers.map((it, i) => `
        <div data-i="${i}" role="button" tabindex="0" class="offer ${picked || (full && !into[i]) ? 'disabled' : ''} ${picked === it.id ? 'picked' : ''}">
          ${itemCard(it, `${i + 1}. `, g)}${picked ? '' : into[i] ? `<span class="warn ok">Completa ${into[i]!.name} — combina ao escolher</span>`
            : full ? '<span class="warn">Inventário cheio — descarte ou combine</span>' : ''}</div>`).join('');
      $('choices').querySelectorAll<HTMLElement>('[data-i]').forEach((el) => {
        const it = offers[Number(el.dataset.i)];
        el.addEventListener('mouseenter', () => showTree(defaultTarget(it, g), it.id));
      });
      $('shop-left').querySelectorAll<HTMLButtonElement>('[data-tree]').forEach((b) => b.addEventListener('click', (ev) => {
        ev.stopPropagation(); // choosing a recipe to inspect must not pick or combine the item
        const card = b.closest<HTMLElement>('[data-i]');
        showTree(b.dataset.tree!, card ? offers[Number(card.dataset.i)].id : null);
      }));
      $('combos').querySelectorAll<HTMLElement>('[data-combo]').forEach((el) =>
        el.addEventListener('mouseenter', () => showTree(combos[Number(el.dataset.combo)].id, null)));
      showTree(tree.root, tree.offered);
      $('continue').style.display = 'block';
      $('continue').textContent = !withOffers ? 'Fechar' : picked ? 'Continuar' : 'Pular item';
      $('inv-edit').querySelectorAll<HTMLButtonElement>('[data-discard]').forEach((b) => b.addEventListener('click', () => {
        const i = Number(b.dataset.discard);
        if (confirmDiscard === i) { g.discardItem(i); confirmDiscard = -1; } else confirmDiscard = i;
        render();
      }));
      $('combos').querySelectorAll<HTMLElement>('[data-combo]').forEach((b) => b.addEventListener('click', () => {
        const made = combos[Number(b.dataset.combo)];
        g.combineItem(made);
        tree = { root: defaultTarget(made, g), offered: '' }; // next step: the legendary it builds toward
        render();
      }));
      this.keyActions = offers.map((it, i) => () => {
        if (picked || (full && !into[i])) return;
        picked = it.id;
        if (into[i]) g.takeInto(it.id, into[i]!);
        else g.takeItem(it.id);
        // stay open when the pick completes a recipe, so the player can combine right away
        if (combinable(g.inventory).length) render();
        else done();
      });
      this.bindChoices();
    };
    $('continue').onclick = () => done();
    render();
  }

  private bindChoices() {
    $('choices').querySelectorAll<HTMLElement>('[data-i]').forEach((b) =>
      b.addEventListener('click', () => this.keyActions[Number(b.dataset.i)]()));
  }

  showEnd(g: Game, onRestart: () => void) {
    $('end-title').textContent = g.over === 'won' ? 'Vitória!' : 'Derrota';
    $('end-stats').textContent = `Tempo ${fmt(g.time)} · Nível ${g.level} · ${g.kills} abates`;
    $('end-items').innerHTML = g.inventory.map((id) => `<img src="${itemIcon(id)}" title="${ITEMS[id].name}">`).join('');
    $('end').style.display = 'flex';
    $('restart').onclick = () => { $('end').style.display = 'none'; onRestart(); };
  }
}

const slots = (inv: string[]) => Array.from({ length: MAX_ITEMS }, (_, i) => inv[i] ?? null);

function itemCard(it: Item, prefix = '', g?: Game, extra = '') {
  const targets = it.tier === 'legendary' ? [] : buildsInto(it.id);
  // highlight legendaries the player already owns parts of
  const owned = (l: Item) => g?.inventory.some((x) => buildsInto(x).includes(l));
  return `<img src="${itemIcon(it.id)}" alt="">
    <div><b class="tier-${it.tier}">${prefix}${it.name}</b>
    <span>${describeStats(it.stats)}</span>
    ${PASSIVES[it.id] ? `<span class="passive">${PASSIVES[it.id]}</span>` : ''}
    ${targets.length ? `<span class="into">Compõe (clique para ver a árvore): ${targets.map((l) =>
      `<button class="chip ${owned(l) ? 'hot' : ''}" data-tree="${l.id}"><img src="${itemIcon(l.id)}" alt="">${l.name}</button>`).join('')}</span>` : ''}
    ${extra}</div>`;
}

/** Legendary to show first for an item: one the player already owns parts of, else the first it builds into. */
function defaultTarget(it: Item, g: Game) {
  if (it.tier === 'legendary') return it.id;
  const targets = buildsInto(it.id);
  return (targets.find((l) => g.inventory.some((x) => buildsInto(x).includes(l))) ?? targets[0]).id;
}

/**
 * Recipe tree like the LoL shop: the item on top, components below. Inventory items are matched top-down
 * (owning an epic covers its whole branch); the offered item is highlighted where it would fit.
 */
function treeHtml(rootId: string, inventory: string[], offered: string) {
  const left = [...inventory];
  let offerPlaced = false;
  let missing = 0;
  const node = (id: string, isRoot: boolean): string => {
    const it = ITEMS[id];
    let state = isRoot ? 'root' : '';
    const owned = isRoot ? -1 : left.indexOf(id);
    if (owned >= 0) { left.splice(owned, 1); state = 'owned'; }
    else if (!isRoot && !offerPlaced && id === offered) { offerPlaced = true; state = 'offer'; }
    const expand = state === '' || state === 'root';
    if (!state && !it.from.length) { state = 'missing'; missing++; }
    else if (!state) state = 'partial';
    const badge = { owned: 'Você tem', offer: 'Esta oferta', missing: 'Falta', partial: 'Montar', root: '' }[state];
    const kids = expand ? it.from.map((c) => node(c, false)).join('') : '';
    return `<li><div class="node ${state}" title="${it.name}">
        <img src="${itemIcon(id)}" alt=""><b>${it.name}</b><small>${describeStats(it.stats)}</small>${badge ? `<em>${badge}</em>` : ''}
      </div>${kids ? `<ul>${kids}</ul>` : ''}</li>`;
  };
  const html = node(rootId, true);
  const root = ITEMS[rootId];
  const summary = rootId === offered ? 'Item lendário pronto — escolha e use direto!' : missing > 0
    ? `${missing === 1 ? 'Falta 1 item básico' : `Faltam ${missing} itens básicos`}${offerPlaced ? ' além desta oferta' : ''}`
    : offerPlaced ? 'Esta oferta completa a receita!' : 'Você já tem tudo — combine!';
  return `<div class="tree-head"><b class="tier-${root.tier}">${root.name}</b>
      <span>${describeStats(root.stats)}</span>${PASSIVES[rootId] ? `<span class="passive">${PASSIVES[rootId]}</span>` : ''}
      <span class="tree-sum">${summary}</span></div>
    <ul class="tree">${html}</ul>`;
}
