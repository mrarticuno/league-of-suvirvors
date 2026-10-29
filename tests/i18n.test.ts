// Localization rules (CLAUDE.md "Internacionalização"): every language file has exactly the keys of en.json, with the
// same placeholders, and every key the code builds from an id (runes, items, champions...) exists.
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickLang } from '../src/i18n';

vi.mock('../src/audio', () => ({ audio: {} })); // champion kits import it; node has no AudioContext

const DIR = new URL('../src/locales/', import.meta.url);
const LOCALES = Object.fromEntries(readdirSync(DIR).filter((f) => f.endsWith('.json'))
  .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(new URL(f, DIR), 'utf8')) as Record<string, string>]));
const EN = LOCALES.en;
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

it('picks the first available browser language, English otherwise', () => {
  const langs = ['en', 'pt', 'es', 'zh'];
  expect(pickLang(['pt-BR', 'en-US'], langs)).toBe('pt');
  expect(pickLang(['de-DE', 'es-419'], langs)).toBe('es');
  expect(pickLang(['zh-TW'], langs)).toBe('zh');
  expect(pickLang(['de-DE', 'fr'], langs)).toBe('en');
  expect(pickLang([], langs)).toBe('en');
  expect(pickLang(['pt-PT', 'pt-BR'], ['en', 'pt-BR'])).toBe('pt-BR'); // exact tag wins over base
});

it('the four required languages exist', () => {
  for (const l of ['en', 'pt', 'es', 'zh']) expect(LOCALES[l], l).toBeDefined();
});

describe.each(Object.keys(LOCALES))('src/locales/%s.json', (lang) => {
  const dict = LOCALES[lang];
  it('has exactly the keys of en.json, filled in, with the same placeholders', () => {
    expect(Object.keys(dict).sort()).toEqual(Object.keys(EN).sort());
    for (const [k, v] of Object.entries(dict)) {
      expect(v.trim().length, k).toBeGreaterThan(0);
      expect(v, k).not.toMatch(/\bTODO\b/);
      expect(vars(v), k).toEqual(vars(EN[k]));
    }
  });
  if (lang === 'zh') it('Chinese texts contain Chinese characters (no untranslated leftovers)', () => {
    for (const [k, v] of Object.entries(dict)) if (k !== 'meta.tag') expect(v, k).toMatch(/[一-鿿]/);
  });
});

describe('keys used by the code exist', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('literal t() keys and data-i18n keys', () => {
    const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts')).map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'));
    files.push(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
    const used = files.flatMap((s) => [...s.matchAll(/\bt\('([\w.-]+)'|data-i18n="([\w.-]+)"/g)].map((m) => m[1] ?? m[2]));
    expect(used.length).toBeGreaterThan(50);
    for (const k of used) expect(EN, k).toHaveProperty([k]);
  });

  it('keys built from ids: catalogs never show a raw key', async () => {
    vi.resetModules();
    vi.stubGlobal('navigator', { languages: ['en-US'] });
    const [{ RUNES, SHARDS, TREES }, { ITEMS }, { PASSIVES }, { CHAMPIONS }, { ENEMIES }, { BUFF }] = await Promise.all([
      import('../src/runes'), import('../src/items'), import('../src/itemEffects'),
      import('../src/champions'), import('../src/data'), import('../src/buffs'),
    ]);
    const texts = [
      ...Object.values(RUNES).flatMap((r) => [r.name, r.desc]), ...Object.values(TREES).map((x) => x.name),
      ...SHARDS.flat().map((s) => s.name), ...Object.values(ITEMS).map((i) => i.name), ...Object.values(PASSIVES),
      ...Object.values(CHAMPIONS).flatMap((c) => [c.name, c.passive.name, ...Object.values(c.skills).map((s) => s.name)]),
      ...Object.values(ENEMIES).flatMap((e) => (e.name ? [e.name] : [])), ...Object.values(BUFF.names),
    ];
    expect(texts.length).toBeGreaterThan(150);
    for (const s of texts) expect(EN, s).not.toHaveProperty([s]);
  });
});
