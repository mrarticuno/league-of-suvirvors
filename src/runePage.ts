// Between runs: champion select, then the rune page (buy nodes with rune points, equip a LoL-style page).
// Every purchase or pick is saved at once; see src/progress.ts for the rules.
import type { ChampionDef } from './champion';
import { CHAMPIONS } from './champions';
import { t } from './i18n';
import {
  browserStorage, choosePrimary, chooseSecondary, emptyPage, equipRune, equipShard, loadProgress, nodeCost, saveProgress,
  SHARD_ROW_COST, unlockRune, unlockShardRow, type Page, type Progress,
} from './progress';
import { RUNES, runesOf, SHARDS, TREE_IDS, TREES, type RuneDef, type TreeId } from './runes';

const $ = (id: string) => document.getElementById(id)!;

export function showChampionSelect(onPick: (champ: ChampionDef) => void) {
  $('select-list').innerHTML = Object.values(CHAMPIONS).map((c) =>
    `<button class="champ" data-id="${c.id}"><img src="${c.icon}" alt=""><b>${c.name}</b></button>`).join('');
  $('select').style.display = 'flex';
  $('select-list').querySelectorAll<HTMLElement>('[data-id]').forEach((b) => b.addEventListener('click', () => {
    $('select').style.display = 'none';
    onPick(CHAMPIONS[b.dataset.id!]);
  }));
}

export function showRunePage(champ: ChampionDef, onPlay: (page: Page) => void) {
  let progress = loadProgress(browserStorage);
  let page = progress.pages[champ.id] ?? emptyPage();
  if (!page.primary) page = choosePrimary(page, 'precision'); // minor runes need a primary tree to land in
  let secondaryView: TreeId = page.secondary ?? TREE_IDS.find((t) => t !== page.primary)!;
  let tip = t('runes.tip');

  const commit = (p: Progress, pg: Page) => {
    progress = { ...p, pages: { ...p.pages, [champ.id]: pg } };
    page = pg;
    saveProgress(progress, browserStorage);
  };
  const equipped = (id: string) => page.keystone === id || page.primaryRunes.includes(id) || page.secondaryRunes.includes(id);

  const node = (r: RuneDef) => {
    const unlocked = progress.unlocked.includes(r.id);
    const cost = nodeCost(progress, r.tree);
    const state = equipped(r.id) ? 'on' : unlocked ? 'open' : progress.points >= cost ? 'buy' : 'locked';
    return `<button class="rune ${r.row === 0 ? 'key' : ''} ${state}" data-rune="${r.id}" title="${r.name}">
      <img src="${r.icon}" alt="">${unlocked ? '' : `<em>${cost}</em>`}</button>`;
  };
  const tabs = (current: TreeId | null, kind: string, skip?: TreeId | null) => TREE_IDS.filter((t) => t !== skip).map((t) =>
    `<button class="tab ${t === current ? 'on' : ''}" data-${kind}="${t}" title="${TREES[t].name}"><img src="${TREES[t].icon}" alt=""></button>`).join('');
  const rows = (tree: TreeId, from: number) =>
    [0, 1, 2, 3].filter((r) => r >= from).map((r) => `<div class="rune-row">${runesOf(tree, r).map(node).join('')}</div>`).join('');

  const render = () => {
    const primary = page.primary!;
    $('runes-title').textContent = t('runes.title', { champion: champ.name });
    $('runes-points').textContent = t('runes.points', { n: progress.points });
    $('runes-primary').innerHTML = `<div class="tabs">${tabs(primary, 'primary')}</div><h3>${TREES[primary].name}</h3>${rows(primary, 0)}`;
    $('runes-secondary').innerHTML = `<div class="tabs">${tabs(secondaryView, 'secondary', primary)}</div>
      <h3>${TREES[secondaryView].name} <small>${t('runes.twoRunes')}</small></h3>${rows(secondaryView, 1)}`;
    $('runes-shards').innerHTML = SHARDS.map((row, i) => progress.shardRows.includes(i)
      ? `<div class="rune-row">${row.map((s, j) => `<button class="shard ${page.shards[i] === j ? 'on' : 'open'}" data-shard="${i}:${j}" title="${s.name}"><img src="${s.icon}" alt=""></button>`).join('')}</div>`
      : `<div class="rune-row"><button class="unlock-row ${progress.points >= SHARD_ROW_COST[i] ? '' : 'locked'}" data-row="${i}">${t('runes.unlockRow', { row: i + 1, cost: SHARD_ROW_COST[i] })}</button></div>`).join('');
    $('runes-tip').innerHTML = tip;
    bind();
  };

  const describe = (r: RuneDef) => {
    const cost = progress.unlocked.includes(r.id) ? '' : ` <i>${t('runes.unlockCost', { cost: nodeCost(progress, r.tree) })}</i>`;
    return `<b>${r.name}</b>${r.row === 0 ? t('runes.keystone') : ''} — ${r.desc}${cost}`;
  };

  const bind = () => {
    const all = (sel: string) => $('runes').querySelectorAll<HTMLElement>(sel);
    all('[data-rune]').forEach((el) => {
      const r = RUNES[el.dataset.rune!];
      el.addEventListener('mouseenter', () => { $('runes-tip').innerHTML = describe(r); });
      el.addEventListener('click', () => {
        if (!progress.unlocked.includes(r.id)) {
          const bought = unlockRune(progress, r.id);
          if (!bought) { tip = t('runes.notEnoughFor', { rune: r.name }); return render(); }
          progress = bought;
          tip = t('runes.unlocked', { rune: r.name });
        } else tip = describe(r);
        if (r.tree !== page.primary) secondaryView = r.tree;
        commit(progress, equipRune(page, r.id, progress.unlocked));
        render();
      });
    });
    all('[data-primary]').forEach((el) => el.addEventListener('click', () => {
      const t = el.dataset.primary as TreeId;
      commit(progress, choosePrimary(page, t));
      if (secondaryView === t) secondaryView = page.secondary ?? TREE_IDS.find((x) => x !== t)!;
      render();
    }));
    all('[data-secondary]').forEach((el) => el.addEventListener('click', () => {
      secondaryView = el.dataset.secondary as TreeId;
      commit(progress, chooseSecondary(page, secondaryView));
      render();
    }));
    all('[data-shard]').forEach((el) => {
      const [row, i] = el.dataset.shard!.split(':').map(Number);
      el.addEventListener('mouseenter', () => { $('runes-tip').textContent = SHARDS[row][i].name; });
      el.addEventListener('click', () => { commit(progress, equipShard(page, row, i, progress.shardRows)); render(); });
    });
    all('[data-row]').forEach((el) => el.addEventListener('click', () => {
      const row = Number(el.dataset.row);
      const bought = unlockShardRow(progress, row);
      tip = bought ? t('runes.rowUnlocked', { row: row + 1 }) : t('runes.notEnough');
      if (bought) commit(bought, page);
      render();
    }));
  };

  $('runes-play').onclick = () => {
    $('runes').style.display = 'none';
    onPlay(page);
  };
  $('runes').style.display = 'flex';
  render();
}
