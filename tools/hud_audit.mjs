// Walks every screen (select, runes, HUD, level-up phases, pause, end) at several viewports and lists each
// interactive element or HUD panel that leaves the viewport, plus overlays that need a scroll to reach their button.
// usage: node tools/hud_audit.mjs [shotsDir] [configFilter]   (dev server on :5191; Playwright from PW_DIR like record_showcase.mjs)
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const pwDir = process.env.PW_DIR ?? path.join(os.homedir(), '.cache/los-recorder');
const { chromium } = createRequire(path.join(pwDir, 'node_modules/'))('playwright');
const shots = process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), '../.hud-audit');
const only = process.argv[3];
fs.mkdirSync(shots, { recursive: true });

const CONFIGS = [
  { name: 'desk-1366x657', w: 1366, h: 657 },
  { name: 'desk-1280x610', w: 1280, h: 610 },
  { name: 'desk-1024x768', w: 1024, h: 768 },
  { name: 'desk-1024x600', w: 1024, h: 600 },
  { name: 'desk-800x600', w: 800, h: 600 },
  { name: 'desk-1536x730', w: 1536, h: 730 },
  { name: 'desk-1920x1080', w: 1920, h: 1080 },
  { name: 'phone-390x844', w: 390, h: 844, touch: true },
  { name: 'phone-844x390', w: 844, h: 390, touch: true },
  { name: 'phone-360x640', w: 360, h: 640, touch: true },
  { name: 'phone-640x360', w: 640, h: 360, touch: true },
  { name: 'tab-768x1024', w: 768, h: 1024, touch: true },
  { name: 'tab-1024x768', w: 1024, h: 768, touch: true },
  { name: 'tab-1366x1024', w: 1366, h: 1024, touch: true },
];

const AUDIT = `(() => {
  const W = innerWidth, H = innerHeight, out = [];
  const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const inOverlay = (el) => el.closest('.overlay');
  const sel = 'button, input, .skill, .champ, .rn, .hex, .tab, .chip, .iact, #bottom, #hud-top, #hud-tl, #hud-tr, #tray, #touch-pad, #joy, #inventory, #sel-hero, #sel-panel, .detail, .end-cards, #menu-info, #offers, #choices, .wallet, .rp-head';
  for (const el of document.querySelectorAll(sel)) {
    if (!vis(el)) continue;
    if ([...el.querySelectorAll('*')].length === 0 && !el.textContent.trim() && !['INPUT','BUTTON'].includes(el.tagName)) continue;
    let hidden = false; for (let p = el; p; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden') { hidden = true; break; } }
    if (hidden) continue;
    const r = el.getBoundingClientRect();
    const o = { left: r.left < -1, top: r.top < -1, right: r.right > W + 1, bottom: r.bottom > H + 1 };
    if (o.left || o.top || o.right || o.bottom) out.push({ id: el.id || el.className.toString().slice(0, 40) || el.tagName, text: (el.textContent || '').trim().slice(0, 24), rect: [r.left, r.top, r.right, r.bottom].map(Math.round), over: Object.keys(o).filter((k) => o[k]).join(','), scroll: !!inOverlay(el) });
  }
  const scrollers = [...document.querySelectorAll('.overlay, #offers, .ioffer, #choices, #select-list, .col')].filter((o) => vis(o) && ['auto', 'scroll'].includes(getComputedStyle(o).overflowY) && o.scrollHeight > o.clientHeight + 1).map((o) => (o.id || o.className.toString().slice(0, 20)) + ' ' + o.scrollHeight + '>' + o.clientHeight);
  const scroll = scrollers.length ? { id: scrollers.join('; '), scrollHeight: 0, clientHeight: 0 } : null;
  return { W, H, scroll, out };
})()`;

const browser = await chromium.launch();
const report = {};
for (const c of CONFIGS) {
  if (only && !c.name.includes(only)) continue;
  const ctx = await browser.newContext({ locale: 'pt-BR', viewport: { width: c.w, height: c.h }, hasTouch: !!c.touch, isMobile: !!c.touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(c.name, 'pageerror:', e.message));
  const rep = (report[c.name] = {});
  const audit = async (screen) => {
    await page.waitForTimeout(1600);
    const r = await page.evaluate(AUDIT);
    rep[screen] = r;
    await page.screenshot({ path: path.join(shots, `${c.name}-${screen}.png`) });
  };
  try {
    await page.goto('http://localhost:5191/');
    await page.waitForFunction(() => document.getElementById('loading')?.style.display === 'none', null, { timeout: 60000 });
    await page.waitForSelector('#select', { state: 'visible' });
    await page.evaluate(() => document.querySelector('#select-list [data-id="aphelios"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await audit('select');
    await page.click('#sel-confirm');
    await page.waitForSelector('#runes', { state: 'visible' });
    await audit('runes');
    const playBtn = (await page.isVisible('#runes-play-m')) ? '#runes-play-m' : '#runes-play';
    await page.click(playBtn);
    await page.waitForFunction(() => !document.body.classList.contains('menus'), null, { timeout: 60000 });
    await page.waitForTimeout(800);
    // the first level-up (level 2) opens at once; close it to see the bare HUD
    const popups = async () => { for (let k = 0; k < 4 && await page.evaluate(() => document.getElementById('levelup')?.style.display === 'flex'); k++) { await page.evaluate(() => document.querySelector('#offers .iact, #choices button, #continue')?.click()); await page.waitForTimeout(300); } };
    await page.evaluate(() => { const g = window.game; g.gainXp = () => {}; g.level = 6; });
    await popups();
    await page.evaluate(() => { const g = window.game; for (const k of ['2501', '2502', '2503']) try { g.takeItem(k); } catch {} });
    await audit('hud');
    await page.evaluate(() => { window.game.pendingLevelUps = 1; window.game.paused = false; });
    await page.waitForFunction(() => document.getElementById('levelup')?.style.display === 'flex', null, { timeout: 5000 });
    await audit('levelup-skill');
    await page.evaluate(() => document.querySelector('#offers .iact')?.click());
    await page.waitForTimeout(900);
    if (await page.evaluate(() => document.getElementById('levelup')?.style.display === 'flex')) await audit('levelup-item');
    await page.evaluate(() => document.getElementById('continue')?.click());
    await page.waitForTimeout(400);
    await popups();
    await page.evaluate(() => { window.game.offerBoots?.(); });
    await page.waitForTimeout(600);
    if (await page.evaluate(() => document.getElementById('levelup')?.style.display === 'flex')) { await audit('levelup-choice'); await page.evaluate(() => document.getElementById('continue')?.click()); await page.waitForTimeout(300); }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (await page.evaluate(() => document.getElementById('menu')?.style.display === 'flex')) await audit('menu');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.evaluate(() => { const g = window.game; g.hp = 1; g.hurtPlayer(5); });
    await page.waitForTimeout(1500);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('end')?.style.display === 'flex', null, { timeout: 20000 });
    await audit('end');
  } catch (e) { console.log(c.name, 'ERR', e.message.split('\n')[0]); }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(shots, 'report.json'), JSON.stringify(report, null, 1));
for (const [name, screens] of Object.entries(report)) {
  for (const [screen, r] of Object.entries(screens)) {
    const lines = r.out.map((o) => `    ${o.id} "${o.text}" ${o.over} [${o.rect}]`);
    if (r.scroll) lines.unshift(`    SCROLL ${r.scroll.id}`);
    if (lines.length) console.log(`${name} ${screen} (${r.W}x${r.H})\n${lines.join('\n')}`);
  }
}
