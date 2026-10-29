// Post-build step of `pnpm deploy:cf`, after tools/optimize.mjs: makes dist/ ready for Cloudflare static assets.
// - renames every game asset to <name>.<content hash>.<ext>: an unchanged file keeps its URL across deploys,
//   so the browser cache (immutable, 1 year) never downloads it again; a changed file gets a new URL
// - injects the path -> hashed path map into dist/index.html (read by asset() in src/util.ts)
// - writes dist/_headers with the cache rules (index.html stays revalidated so a deploy shows up at once)
// - drops the .br/.gz siblings: Cloudflare ignores them and compresses at the edge itself
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const DIST = 'dist';
const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
if (html.includes('__ASSETS')) throw new Error('dist/ is already hashed, run `pnpm deploy:cf`');

for (const f of walk(DIST)) if (/\.(br|gz)$/.test(f)) rmSync(f);

const map = {};
// dist/assets/*.js are Vite's own chunks, already hashed: only the subfolders (copied from public/) are game assets
for (const f of readdirSync(join(DIST, 'assets'), { withFileTypes: true }).filter((e) => e.isDirectory())
  .flatMap((e) => walk(join(DIST, 'assets', e.name)))) {
  const hash = createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 10);
  const ext = extname(f);
  const out = `${f.slice(0, -ext.length)}.${hash}${ext}`;
  renameSync(f, out);
  map[f.slice(DIST.length + 1)] = out.slice(DIST.length + 1);
}

writeFileSync(join(DIST, 'index.html'), html.replace('<script', `<script>window.__ASSETS=${JSON.stringify(map)}</script>\n    <script`));
writeFileSync(join(DIST, '_headers'), `/assets/*
  Cache-Control: public, max-age=31536000, immutable
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
`);
console.log(`hashed ${Object.keys(map).length} assets`);
