// Between runs: champion select (search and role filters), then the rune page (buy nodes with rune points, equip a
// LoL-style page). Every purchase or pick is saved at once; see src/progress.ts for the rules.
import { ROLES, SKILL_KEYS, type ChampionDef, type Role } from './champion';
import { CHAMPIONS } from './champions';
import { t, type Key } from './i18n';
import {
  browserStorage, choosePrimary, chooseSecondary, emptyPage, equipRune, equipShard, KILLS_PER_POINT, loadProgress, nodeCost,
  saveProgress, SHARD_ROW_COST, unlockRune, unlockShardRow, type Page, type Progress,
} from './progress';
import { RUNES, runesOf, SHARDS, TREE_IDS, TREES, type RuneDef, type TreeId } from './runes';

const $ = (id: string) => document.getElementById(id)!;

const GEM = '<svg class="gem" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4L40 18L24 44L8 18Z" fill="#8fc7ff" opacity=".3"/><path d="M24 4L40 18L24 44L8 18Z M8 18h32" fill="none" stroke="#ddeeff" stroke-width="3" stroke-linejoin="round"/></svg>';
const LOCK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a2abbd" stroke-width="2.2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="1"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const CHEVRON = (d: string) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const ROLE_GLYPH: Record<Role | 'all', string> = {
  all: 'M8 8h12v12H8z M28 8h12v12H28z M8 28h12v12H8z M28 28h12v12H28z',
  marksman: 'M24 6V42 M6 24H42 M24 14A10 10 0 1 0 24.01 14',
  assassin: 'M10 38L34 14M30 10l8-2-2 8M14 30l4 4',
  fighter: 'M12 36L36 12M12 12L36 36',
  mage: 'M24 6L28 20L42 24L28 28L24 42L20 28L6 24L20 20Z',
  tank: 'M24 6L39 13V24C39 32 33 39 24 43C15 39 9 32 9 24V13Z',
  support: 'M24 40C10 30 6 22 10 15C14 9 21 10 24 16C27 10 34 9 38 15C42 22 38 30 24 40Z',
};
const roleIcon = (r: Role | 'all') => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ROLE_GLYPH[r]}"/></svg>`;
const roleName = (r: Role) => t(`role.${r}` as Key);
/** Tree theme colors: the page glows in the primary tree's color. */
const TREE_COLOR: Record<TreeId, string> = { precision: '#e8c46a', domination: '#e8505f', sorcery: '#93a6ff', resolve: '#93d46e', inspiration: '#4fcadb' };
const SOON_CARDS = 4; // placeholder cards while the roster is small

let picked: ChampionDef = Object.values(CHAMPIONS)[0];

export function showChampionSelect(onPick: (champ: ChampionDef) => void) {
  const all = Object.values(CHAMPIONS);
  let query = '', role: Role | 'all' = 'all';
  const search = $('sel-search') as HTMLInputElement;
  search.value = '';
  search.placeholder = t('select.search');
  $('sel-filters').setAttribute('aria-label', t('select.roles'));
  $('sel-confirm').innerHTML = `${t('select.confirm')} ${CHEVRON('M9 5l7 7-7 7')}`;

  const hero = (swap: boolean) => {
    const c = picked;
    ($('sel-splash').querySelector('img') as HTMLImageElement).src = c.splash;
    $('sel-roles').innerHTML = c.roles.map((r) => `<span class="role-tag">${roleIcon(r)}${roleName(r)}</span>`).join('');
    $('sel-title').textContent = c.title;
    $('sel-name').textContent = c.name;
    const bars = Math.ceil((c.difficulty * 3) / 10);
    $('sel-meta').innerHTML = `${t('select.difficulty')} ${[1, 2, 3].map((i) => `<i class="${i <= bars ? 'on' : ''}"></i>`).join('')}`;
    $('sel-skills').innerHTML = [{ key: 'P', ...c.passive }, ...SKILL_KEYS.map((k) => ({ key: k, ...c.skills[k] }))]
      .map((s) => `<div class="sel-skill" title="${s.key}"><img src="${s.icon}" alt="">${s.name}</div>`).join('');
    for (const id of ['sel-splash', 'sel-hero']) {
      $(id).classList.remove('swap');
      if (swap) { void $(id).offsetWidth; $(id).classList.add('swap'); }
    }
  };

  const render = () => {
    const q = query.trim().toLowerCase();
    const list = all.filter((c) => (role === 'all' || c.roles.includes(role)) && (!q || c.name.toLowerCase().includes(q)));
    const soon = role === 'all' && !q;
    $('sel-filters').innerHTML = (['all', ...ROLES] as const).map((r) => {
      const n = r === 'all' ? all.length : all.filter((c) => c.roles.includes(r)).length;
      return `<button class="chip ${role === r ? 'on' : ''}" data-role="${r}" aria-pressed="${role === r}">${roleIcon(r)}${r === 'all' ? t('select.all') : roleName(r)}<b>${n}</b></button>`;
    }).join('');
    $('sel-count').innerHTML = `<span>${list.length === 1 ? t('select.countOne') : t('select.count', { n: list.length })}</span><span>${t('select.moreSoon')}</span>`;
    $('select-list').innerHTML = list.map((c, i) => `
      <button class="champ ${c === picked ? 'on' : ''}" data-id="${c.id}" aria-pressed="${c === picked}" style="animation-delay:${i * 0.05}s">
        <span class="in"><img src="${c.icon}" alt=""><b>${c.name}</b><small>${c.roles.map(roleName).join(' · ')}</small></span>
      </button>`).join('')
      + (soon ? Array.from({ length: SOON_CARDS }, (_, i) => `
      <div class="champ soon" style="animation-delay:${(list.length + i) * 0.05}s"><span class="in"><i>?</i><b>${t('select.soon')}</b><small>${t('select.newChampion')}</small></span></div>`).join('') : '')
      + (!list.length && !soon ? `<div class="sel-empty"><b>${t('select.empty')}</b><span>${t('select.emptyHint')}</span><button class="chip" data-clear>${t('select.clear')}</button></div>` : '');
    $('sel-filters').querySelectorAll<HTMLElement>('[data-role]').forEach((b) => b.addEventListener('click', () => {
      role = b.dataset.role as Role | 'all';
      render();
    }));
    $('select-list').querySelectorAll<HTMLElement>('[data-id]').forEach((b) => b.addEventListener('click', () => {
      if (CHAMPIONS[b.dataset.id!] === picked) return;
      picked = CHAMPIONS[b.dataset.id!];
      hero(true);
      render();
    }));
    $('select-list').querySelector('[data-clear]')?.addEventListener('click', () => {
      query = search.value = '';
      role = 'all';
      render();
    });
  };

  search.oninput = () => { query = search.value; render(); };
  $('sel-confirm').onclick = () => {
    $('select').style.display = 'none';
    onPick(picked);
  };
  hero(false);
  render();
  $('select').style.display = 'flex';
}

const MOTES = Array.from({ length: 18 }, (_, i) =>
  `<i class="mote" style="left:${(4 + ((i * 37) % 92)).toFixed(0)}%;top:${55 + ((i * 23) % 42)}%;animation-duration:${7 + (i % 5) * 1.6}s;animation-delay:${((i * 0.7) % 8).toFixed(1)}s"></i>`).join('');
const WHEEL = '<svg class="wheel" viewBox="0 0 400 400" fill="none" stroke="currentColor" stroke-width=".6" aria-hidden="true"><circle cx="200" cy="200" r="196"/><circle cx="200" cy="200" r="170" stroke-dasharray="2 6"/><circle cx="200" cy="200" r="120"/><path d="M200 4L370 298H30z"/><path d="M200 396L30 102h340z"/><circle cx="200" cy="200" r="60" stroke-dasharray="10 4"/></svg>';

export function showRunePage(champ: ChampionDef, onPlay: (page: Page) => void, onBack: () => void) {
  let progress = loadProgress(browserStorage);
  let page = progress.pages[champ.id] ?? emptyPage();
  if (!page.primary) page = choosePrimary(page, 'precision'); // minor runes need a primary tree to land in
  let secondaryView: TreeId = page.secondary ?? TREE_IDS.find((x) => x !== page.primary)!;
  let focus = page.keystone ?? runesOf(page.primary!, 0)[0].id;
  let view: 'p' | 's' | 'f' = 'p';
  // one-shot motion for the next render: purchase/equip burst, tree switch, points spent
  let fx: { id: string; kind: 'unseal' | 'snap' } | null = null;
  let enter: 'p' | 's' | null = null;
  let spent = 0;
  let shown = progress.points; // wallet counter, animated towards progress.points
  const root = $('runes');

  const commit = (p: Progress, pg: Page) => {
    progress = { ...p, pages: { ...p.pages, [champ.id]: pg } };
    page = pg;
    saveProgress(progress, browserStorage);
  };
  const equipped = (id: string) => page.keystone === id || page.primaryRunes.includes(id) || page.secondaryRunes.includes(id);
  const stateOf = (r: RuneDef) => equipped(r.id) ? 'on' : progress.unlocked.includes(r.id) ? 'open' : progress.points >= nodeCost(progress, r.tree) ? 'buy' : 'locked';

  const rings = '<i class="ring"></i><i class="ring r2"></i>';
  const shards = (n: number) => Array.from({ length: n }, (_, i) => `<i class="sp" style="--a:${(360 / n) * i}deg"></i>`).join('');
  const node = (r: RuneDef) => {
    const st = stateOf(r);
    const cost = nodeCost(progress, r.tree);
    const burst = fx?.id === r.id ? fx.kind : '';
    return `<button class="rn ${r.row === 0 ? 'key' : ''} ${st} ${focus === r.id ? 'focus' : ''} ${burst}" data-rune="${r.id}"
        aria-label="${r.name}${progress.unlocked.includes(r.id) ? '' : ` — ${t('runes.unlockBtn', { cost })}`}">
      <span class="core"><img src="${r.icon}" alt=""></span>${st === 'locked' ? `<span class="lock">${LOCK}</span>` : ''}
      ${progress.unlocked.includes(r.id) ? '' : `<span class="cost">${GEM}${cost}</span>`}
      ${burst ? rings : ''}${burst === 'unseal' ? shards(r.row === 0 ? 8 : 6) : ''}</button>`;
  };
  const tabs = (current: TreeId, kind: string, skip?: TreeId) => TREE_IDS.filter((x) => x !== skip).map((x) =>
    `<button class="tab ${x === current ? 'on' : ''}" data-${kind}="${x}" style="--c:${TREE_COLOR[x]}" aria-pressed="${x === current}" aria-label="${TREES[x].name}" title="${TREES[x].name}">
      <img src="${TREES[x].icon}" alt=""></button>`).join('');
  const minorRows = (tree: TreeId) => [1, 2, 3].map((row) => `<div class="rrow">${runesOf(tree, row).map(node).join('')}</div>`).join('');

  const detail = (id: string) => {
    const r = RUNES[id];
    const st = stateOf(r);
    const cost = nodeCost(progress, r.tree);
    const burst = fx?.id === id;
    const state = { on: 'runes.stateEquipped', open: 'runes.stateUnlocked', buy: 'runes.stateLocked', locked: 'runes.stateLocked' } as const;
    const button = st === 'on' ? `<button class="cta off" disabled>${t('runes.equippedBtn')}</button>`
      : st === 'open' ? `<button class="cta ghost" data-equip="${id}">${t('runes.equipBtn')}</button>`
      : st === 'buy' ? `<button class="cta gold" data-buy="${id}">${GEM}${t('runes.unlockBtn', { cost })}</button>`
      : `<button class="cta off" disabled>${t('runes.missing', { n: cost - progress.points })}</button>`;
    const short = st === 'locked' ? `<div class="short"><div><span>${t('runes.progress', { have: progress.points, cost })}</span></div>
      <div class="track"><i style="width:${Math.min(100, (progress.points / cost) * 100).toFixed(0)}%"></i></div>
      <span>${t('runes.earn', { n: KILLS_PER_POINT })}</span></div>` : '';
    return `<div class="in" style="--dc:${TREE_COLOR[r.tree]}">
      <div class="d-top"><div class="big"><span class="halo"></span><div class="art ${st === 'on' || st === 'open' ? '' : 'dim'} ${burst && fx!.kind === 'unseal' ? 'unseal' : ''}"><img src="${r.icon}" alt=""></div>${burst ? rings : ''}</div>
        <div><div class="tags"><span>${TREES[r.tree].name}</span>${r.row === 0 ? `<span class="k">${t('runes.keystoneTag')}</span>` : ''}</div>
        <h3 class="d-name">${r.name}</h3><span class="d-state ${st}">${t(state[st])}</span></div></div>
      <p class="d-desc">${r.desc}</p>
      <div class="d-act">${short}${button}<button id="runes-play-m" class="cta gold" data-play>${t('static.play')}</button></div></div>`;
  };

  const render = () => {
    const primary = page.primary!;
    root.className = `overlay view-${view}`;
    root.style.setProperty('--tc', TREE_COLOR[primary]);
    root.style.setProperty('--sc', TREE_COLOR[secondaryView]);
    const keys = runesOf(primary, 0);
    const sCount = page.secondary === secondaryView ? page.secondaryRunes.length : 0;
    const summary = [page.keystone, ...page.primaryRunes, ...page.secondaryRunes].filter((x): x is string => !!x).map((id) =>
      `<img class="${RUNES[id].row === 0 ? 'k' : ''}" src="${RUNES[id].icon}" alt="${RUNES[id].name}" title="${RUNES[id].name}" style="--c:${TREE_COLOR[RUNES[id].tree]}">`).join('');
    root.innerHTML = `<div class="rp-bg">${WHEEL}${MOTES}</div>
      <header class="rp-head">
        <button class="cta ghost" data-back aria-label="${t('runes.back')}">${CHEVRON('M15 5l-7 7 7 7')}<span>${t('runes.back')}</span></button>
        <div class="rp-title"><span class="kicker">${champ.name}</span><h1>${t('runes.heading')}</h1></div>
        <div class="wallet ${spent ? 'spend' : ''}">${GEM}<div><b id="rw-points">${shown}</b><small>${t('runes.wallet')}</small></div>${spent ? `<span class="minus">-${spent}</span>` : ''}</div>
      </header>
      <div class="rp-segs" role="tablist">
        <button class="seg ${view === 'p' ? 'on' : ''}" data-view="p">${t('runes.tabPrimary')}</button>
        <button class="seg ${view === 's' ? 'on' : ''}" data-view="s">${t('runes.tabSecondary', { n: sCount })}</button>
        <button class="seg ${view === 'f' ? 'on' : ''}" data-view="f">${t('runes.shards')}</button>
      </div>
      <div class="rp-main">
        <section class="col col-p ${enter === 'p' ? 'enter' : ''}" aria-label="${t('runes.primary')}">
          <div class="tabs">${tabs(primary, 'primary')}</div>
          <div class="tree-name"><small>${t('runes.primary')}</small><b>${TREES[primary].name}</b></div>
          <div class="rows"><i class="spine ${page.keystone ? 'lit' : ''}"></i>
            <div class="rrow keys">${keys.map((r) => `<div class="kcell ${equipped(r.id) ? 'on' : ''}">${node(r)}<span>${r.name}</span></div>`).join('')}</div>
            ${minorRows(primary)}</div>
        </section>
        <section class="col col-s ${enter ? 'enter' : ''}" aria-label="${t('runes.secondary', { n: sCount })}">
          <div class="tabs">${tabs(secondaryView, 'secondary', primary)}</div>
          <div class="tree-name"><small>${t('runes.secondary', { n: sCount })}</small><b>${TREES[secondaryView].name}</b></div>
          <div class="rows">${minorRows(secondaryView)}</div>
        </section>
        <section class="col col-f" aria-label="${t('runes.shards')}"><div class="tree-name"><small>${t('runes.shards')}</small></div><div class="shards">
          ${SHARDS.map((row, i) => `<div class="shard-row">${progress.shardRows.includes(i)
            ? row.map((s, j) => `<button class="hex ${page.shards[i] === j ? 'on' : ''}" data-shard="${i}:${j}" title="${s.name}" aria-label="${s.name}" aria-pressed="${page.shards[i] === j}"><span><img src="${s.icon}" alt=""></span></button>`).join('')
            : `<button class="cta ${progress.points >= SHARD_ROW_COST[i] ? 'ghost' : 'off'}" data-row="${i}">${t('runes.unlockRow', { row: i + 1, cost: SHARD_ROW_COST[i] })}</button>`}</div>`).join('')}
        </div></section>
        <section class="detail frame" id="rp-detail" aria-live="polite">${detail(focus)}</section>
      </div>
      <footer class="rp-foot"><div class="summary">${t('runes.yourPage')} ${summary}</div>
        <button id="runes-play" class="cta gold breath" data-play>${t('static.play')} ${CHEVRON('M9 5l7 7-7 7')}</button></footer>`;
    fx = null;
    enter = null;
    spent = 0;
    bind();
  };

  const showDetail = (id: string) => { $('rp-detail').innerHTML = detail(id); bindDetail(); };
  const bindDetail = () => {
    $('rp-detail').querySelector<HTMLElement>('[data-buy]')?.addEventListener('click', (e) => buy((e.currentTarget as HTMLElement).dataset.buy!));
    $('rp-detail').querySelector<HTMLElement>('[data-equip]')?.addEventListener('click', (e) => pick((e.currentTarget as HTMLElement).dataset.equip!));
    $('rp-detail').querySelector<HTMLElement>('[data-play]')?.addEventListener('click', play);
  };
  const pick = (id: string) => {
    focus = id;
    if (progress.unlocked.includes(id) && !equipped(id)) {
      commit(progress, equipRune(page, id, progress.unlocked));
      fx = { id, kind: 'snap' };
    }
    if (RUNES[id].tree !== page.primary) secondaryView = RUNES[id].tree;
    render();
  };
  const buy = (id: string) => {
    const bought = unlockRune(progress, id);
    if (!bought) return;
    spent = progress.points - bought.points;
    commit(bought, equipRune(page, id, bought.unlocked));
    if (RUNES[id].tree !== page.primary) secondaryView = RUNES[id].tree;
    focus = id;
    fx = { id, kind: 'unseal' };
    render();
    tick();
  };
  const play = () => {
    root.style.display = 'none';
    onPlay(page);
  };
  // the wallet counts down to the new balance after a purchase
  const tick = () => {
    if (shown === progress.points) return;
    shown += shown > progress.points ? -1 : 1;
    const el = document.getElementById('rw-points');
    if (el) el.textContent = String(shown);
    setTimeout(tick, 28);
  };

  const bind = () => {
    const all = (sel: string) => root.querySelectorAll<HTMLElement>(sel);
    all('[data-rune]').forEach((el) => {
      const id = el.dataset.rune!;
      el.addEventListener('mouseenter', () => showDetail(id));
      el.addEventListener('mouseleave', () => showDetail(focus));
      el.addEventListener('click', () => pick(id));
    });
    all('[data-primary]').forEach((el) => el.addEventListener('click', () => {
      const tree = el.dataset.primary as TreeId;
      if (tree === page.primary) return;
      commit(progress, choosePrimary(page, tree));
      if (secondaryView === tree) secondaryView = page.secondary ?? TREE_IDS.find((x) => x !== tree)!;
      focus = runesOf(tree, 0)[0].id;
      enter = 'p';
      render();
    }));
    all('[data-secondary]').forEach((el) => el.addEventListener('click', () => {
      const tree = el.dataset.secondary as TreeId;
      if (tree === secondaryView) return;
      secondaryView = tree;
      commit(progress, chooseSecondary(page, tree));
      enter = 's';
      render();
    }));
    all('[data-shard]').forEach((el) => el.addEventListener('click', () => {
      const [row, i] = el.dataset.shard!.split(':').map(Number);
      commit(progress, equipShard(page, row, i, progress.shardRows));
      render();
    }));
    all('[data-row]').forEach((el) => el.addEventListener('click', () => {
      const row = Number(el.dataset.row);
      const bought = unlockShardRow(progress, row);
      if (!bought) return;
      spent = progress.points - bought.points;
      commit(bought, equipShard(page, row, 0, bought.shardRows));
      render();
      tick();
    }));
    all('[data-view]').forEach((el) => el.addEventListener('click', () => { view = el.dataset.view as typeof view; render(); }));
    root.querySelector('[data-back]')!.addEventListener('click', () => { root.style.display = 'none'; onBack(); });
    root.querySelector('#runes-play')!.addEventListener('click', play);
    bindDetail();
  };

  root.style.display = 'flex';
  render();
}
