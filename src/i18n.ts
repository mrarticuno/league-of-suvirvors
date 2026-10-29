// Localization: one file per language in src/locales/<code>.json, a flat map key -> text with `{name}` placeholders.
// Only the player's language is loaded (picked from the browser, English when none is available), before any module
// that reads texts runs (top-level await). New language: drop src/locales/<code>.json with every key of en.json;
// tests/i18n.test.ts checks it. Rules: CLAUDE.md "Internacionalização".
import type en from './locales/en.json';

export type Key = keyof typeof en;
type Dict = Record<string, string>;

const files = import.meta.glob<Dict>('./locales/*.json', { import: 'default' });
/** Available languages: the file names in src/locales. */
export const LANGS = Object.keys(files).map((p) => p.slice('./locales/'.length, -'.json'.length));

/** First available language in the browser's preference list (exact tag, then base: `pt-BR` -> pt), else English. */
export function pickLang(prefs: readonly string[], langs: readonly string[] = LANGS): string {
  const byLower = new Map(langs.map((l) => [l.toLowerCase(), l]));
  for (const p of prefs) {
    const tag = p.toLowerCase();
    const hit = byLower.get(tag) ?? byLower.get(tag.split('-')[0]);
    if (hit) return hit;
  }
  return 'en';
}

const nav = globalThis.navigator as Navigator | undefined;
export const LANG = pickLang(nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : []);
const dict: Dict = await files[`./locales/${LANG}.json`]();

/** Text of `key` in the player's language, with `{name}` placeholders filled from `vars`. Missing key: the key itself. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  const text = dict[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}
