// Records a gameplay clip for social posts: picks a champion, plays a run casting every skill, writes an mp4.
// Needs `pnpm dev` running (window.game is only exposed in dev) and Playwright installed outside the project:
//   npm i --prefix ~/.cache/los-recorder playwright && npx --prefix ~/.cache/los-recorder playwright install chromium
// usage: node tools/record_showcase.mjs --champ aphelios --out /tmp/x.mp4 [--seconds 30] [--url http://localhost:5173] [--locale pt-BR] [--scenario ./my.mjs]
// --scenario: module whose default export async ({ page, game, wait }) => {} replaces the default skill loop (e.g. to open a HUD panel).
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { parseArgs } from 'util';

const { values: args } = parseArgs({ options: {
  champ: { type: 'string' }, out: { type: 'string' }, seconds: { type: 'string', default: '30' },
  url: { type: 'string', default: 'http://localhost:5173' }, locale: { type: 'string', default: 'pt-BR' }, scenario: { type: 'string' },
} });
const { champ, url, locale } = args;
if (!champ || !args.out) throw new Error('usage: --champ <id> --out <file.mp4>');
const out = path.resolve(args.out);
const seconds = Number(args.seconds);

const pwDir = process.env.PW_DIR ?? path.join(os.homedir(), '.cache/los-recorder');
const { chromium } = createRequire(path.join(pwDir, 'node_modules/'))('playwright');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'los-rec-'));
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale, viewport: { width: 1280, height: 720 }, recordVideo: { dir: tmp, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
const recStart = Date.now();

await page.goto(url);
await page.click(`#select-list [data-id="${champ}"]`);
await page.click('#sel-confirm');
await page.click('#runes-play');
await page.waitForFunction(() => window.game?.player && !document.body.classList.contains('menus'), null, { timeout: 60000 });
await page.evaluate(() => { window.game.hurtPlayer = () => {}; }); // the clip must not end in a death screen

const wait = (ms) => page.waitForTimeout(ms);
// level-up popups pause the game: take the first option so skills get ranks and the run keeps going
const unpause = async () => {
  if (!(await page.evaluate(() => window.game.paused))) return;
  await page.keyboard.press('1');
  await wait(300);
  const cont = page.locator('#continue');
  if (await cont.isVisible()) await cont.click();
};
await wait(500);
await unpause(); // the run opens on the level 1 item pick
await wait(500);
const start = (Date.now() - recStart) / 1000; // the clip is cut from here: champion select, loading and that pick are not shown

if (args.scenario) {
  const mod = await import(pathToFileURL(path.resolve(args.scenario)).href);
  await mod.default({ page, game: () => page.evaluateHandle(() => window.game), wait, unpause });
} else {
  const arrows = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
  const end = Date.now() + seconds * 1000;
  for (let i = 0; Date.now() < end; i++) {
    await unpause();
    // early in a run the map is empty: keep a few minions around so the skills have something to hit
    await page.evaluate(() => {
      const g = window.game;
      if (g.nearestEnemy(g.pos, 900)) return;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        g.spawnEnemy(k % 2 ? 'minion_melee' : 'minion_caster', g.pos.clone().set(g.pos.x + Math.cos(a) * 600, 0, g.pos.z + Math.sin(a) * 600));
      }
    });
    const dir = arrows[Math.floor(i / 4) % 4];
    await page.keyboard.down(dir);
    for (const k of ['q', 'w', 'e', 'r']) { await page.keyboard.press(k); await wait(350); }
    await page.keyboard.up(dir);
  }
}

await ctx.close();
await browser.close();
const webm = path.join(tmp, fs.readdirSync(tmp).find((f) => f.endsWith('.webm')));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(start), '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', '-an', out]);
fs.rmSync(tmp, { recursive: true });
console.log(out);
