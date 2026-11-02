// Hover cards of the game's things: skills and passives, items, boots. The text is the one the level-up cards use.
import { skillNumbers, type SkillDef, type SkillKey, type SkillStats } from './champion';
import { t, type Key } from './i18n';
import { PASSIVES } from './itemEffects';
import { BOOTS, describeStats, itemIcon, ITEMS, LEGENDARY_BONUS, MAX_LEVEL, PASSIVE_LEVEL, PASSIVE_POWER, PLATING, statsAt, statValue, type ItemStats } from './items';
import type { Tip } from './tooltip';
import { fmtExtra, num } from './ui';

const sec = (v: number) => t('skillsel.seconds', { n: num(v, v % 1 ? 1 : 0) });
const ratio = (r: number | readonly number[] | undefined, rank: number, max: number) => (r === undefined ? 0 : typeof r === 'number' ? r : r[Math.min(rank, max - 1)]);

export interface SkillTipOpts {
  key: SkillKey;
  /** Rank the numbers are for (0: not learned, the first rank is shown). */
  rank: number;
  stats: SkillStats;
  /** Shown instead of the skill's own name and icon (a kit's variant). */
  name?: string;
  icon?: string;
  /** Rank cost, cooldown and damage are shown (false: a free action). */
  numbers?: boolean;
}

/** A skill: what it does (the level-up card text), cooldown, cost, damage now and what it scales with. */
export function skillTip(s: SkillDef, o: SkillTipOpts): Tip {
  const r = Math.max(0, o.rank - 1);
  const n = skillNumbers(s, r, o.stats);
  const rows: [string, string][] = [];
  const hasDamage = s.damage.some((d) => d > 0);
  if (o.numbers !== false) {
    if (hasDamage) rows.push([t(`skillsel.${s.damageType}` as Key), num(Math.round(n.damage))]);
    if (s.hits) rows.push([t('skillsel.hits', { n: s.hits, dmg: num(Math.round(n.perHit)) }), '']);
    if (s.extra) rows.push([s.extra.label, fmtExtra(s.extra, r)]);
    const scale = [
      s.adRatio !== undefined && t('skillsel.ratioAd', { n: Math.round(ratio(s.adRatio, r, s.maxRank) * 100) }),
      s.bonusAdRatio && t('skillsel.ratioBonusAd', { n: Math.round(s.bonusAdRatio * 100) }),
      s.apRatio && t('skillsel.ratioAp', { n: Math.round(ratio(s.apRatio, r, s.maxRank) * 100) }),
    ].filter(Boolean).join(' · ');
    if (scale) rows.push([t('skillsel.scaling'), scale]);
  }
  const meta: [string, string][] = [];
  if (o.numbers !== false) {
    if (s.cooldown.some((c) => c > 0)) meta.push([t('skillsel.cooldown'), sec(n.cooldown)]);
    if (s.cost.some((c) => c > 0)) meta.push([t('skillsel.cost'), num(n.cost)]);
  }
  return {
    icon: o.icon ?? s.icon, key: o.key, title: o.name ?? s.name, body: s.desc, meta, rows,
    kind: hasDamage ? t(`skillsel.${s.damageType}` as Key) : undefined, kindClass: s.damageType,
    foot: `${t('tip.rank', { rank: o.rank, max: s.maxRank })}${o.rank === 0 ? ` · ${t('tip.notLearned')}` : ''}`,
  };
}

/** The passive: name and, when the champion has one, its text. */
export function passiveTip(champId: string, p: { name: string; icon: string }): Tip {
  const key = `champion.${champId}.passive.desc` as Key;
  const body = t(key);
  return { icon: p.icon, key: 'P', title: p.name, kind: t('tip.passive'), body: body === key ? undefined : body };
}

/** An owned item at `level`: stats, passive and how strong it is. */
export function itemTip(id: string, level: number, legendary: boolean): Tip {
  const stats = statsAt(id, level, legendary ? 1 + LEGENDARY_BONUS : 1);
  const passive = PASSIVES[id];
  const power = `${Math.round(PASSIVE_POWER[level - 1] * 100)}%`;
  return {
    icon: itemIcon(id), title: ITEMS[id].name,
    kind: legendary ? t('slot.legendaryTag') : t('menu.itemLevel', { level, max: MAX_LEVEL }),
    rows: Object.entries(stats).map(([k, v]) => [t(`stat.${k as keyof ItemStats}`), `+${statValue(k as keyof ItemStats, v)}`]),
    body: passive,
    foot: passive ? (level < PASSIVE_LEVEL ? t('itemsel.unlocksAt', { level: PASSIVE_LEVEL }) : `${t('itemsel.passive')} ${power}`) : undefined,
    accent: '#b59cff',
  };
}

export function bootsTip(id: string): Tip {
  return { icon: itemIcon(id), title: BOOTS[id].name, body: [describeStats(BOOTS[id].stats), PLATING.has(id) ? t('boots.plating') : ''].filter(Boolean).join(' · '), accent: '#b59cff' };
}
