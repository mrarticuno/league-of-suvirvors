// Post-build step of `pnpm build:prod`: shrinks dist/ in place (public/ is never touched).
// - drops asset files and animation clips the bundle never names (models, map pieces, vfx)
// - .glb: resample + prune + meshopt (decoded at runtime by GLTFLoader.setMeshoptDecoder)
// - .png -> .webp (the bundle was built with VITE_IMG_EXT=webp, systems.json is rewritten to match)
// - .mp3 re-encoded at a lower bitrate (mono for sfx)
// - .br/.gz siblings for text and binary files the server can send pre-compressed
// Needs ffmpeg and cwebp on PATH (brew install ffmpeg webp).
import { execFile, execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const DIST = 'dist';
const ASSETS = join(DIST, 'assets');
const VFX = join(ASSETS, 'vfx/ezreal');

const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const dirSize = (dir) => walk(dir).reduce((n, f) => n + statSync(f).size, 0);
const mb = (n) => `${(n / 1e6).toFixed(1)}MB`;
const stem = (f) => basename(f, extname(f));

// not idempotent (re-encodes lossy formats): only runs on a fresh `vite build` output
if (!walk(ASSETS).some((f) => f.endsWith('.png'))) throw new Error('dist/ is already optimized, run `pnpm build:prod`');
const bundle = walk(ASSETS).filter((f) => f.endsWith('.js')).map((f) => readFileSync(f, 'utf8')).join('\n');
if (!bundle.includes('.webp') && !bundle.includes('"webp"')) {
  throw new Error('bundle was not built with VITE_IMG_EXT=webp, run `pnpm build:prod`');
}
// A name the bundle never mentions is never loaded: asset URLs and clip names are string literals in src/.
// Sound keys are built at runtime (`${model}_hit`), so sfx is only re-encoded, never pruned.
const used = (name) => bundle.includes(name);
const before = dirSize(DIST);

// 1. Unused files
const vfxRefs = readFileSync(join(VFX, 'systems.json'), 'utf8');
for (const f of walk(ASSETS)) {
  const dir = f.slice(ASSETS.length + 1).split('/')[0];
  const drop = basename(f) === '.DS_Store'
    || ((dir === 'models' || dir === 'map') && !used(stem(f)))
    || (dir === 'vfx' && basename(f) !== 'systems.json' && !vfxRefs.includes(basename(f)) && !used(stem(f)));
  if (drop) {
    rmSync(f);
    console.log(`drop ${f}`);
  }
}

// 2. Models
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
for (const f of walk(ASSETS).filter((f) => f.endsWith('.glb'))) {
  const doc = await io.read(f);
  const clips = doc.getRoot().listAnimations();
  const kept = clips.filter((a) => used(a.getName()));
  // shortcut: a model whose clips are all unnamed in the bundle keeps them all (props have none anyway)
  // Animation.dispose() leaves its samplers holding the keyframe accessors, so prune would keep them
  if (kept.length) for (const a of clips) if (!kept.includes(a)) {
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  }
  await doc.transform(
    // every channel ships its own copy of the clip's keyframe times
    dedup({ propertyTypes: [PropertyType.ACCESSOR] }),
    resample(),
    // materials carry no textures (the PNG is loaded beside the .glb), so keep UVs and empty leaf nodes
    prune({ keepAttributes: true, keepLeaves: true }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(f, doc);
  console.log(`glb  ${f}: ${kept.length || clips.length}/${clips.length} clips`);
}

// 3. Textures
for (const f of walk(ASSETS).filter((f) => f.endsWith('.png'))) {
  execFileSync('cwebp', ['-quiet', '-q', '88', '-alpha_q', '100', '-m', '6', f, '-o', f.replace(/\.png$/, '.webp')]);
  rmSync(f);
}
writeFileSync(join(VFX, 'systems.json'), vfxRefs.replace(/\.png"/g, '.webp"'));

// 4. Audio (ffmpeg runs in parallel, one process per core)
const sounds = walk(ASSETS).filter((f) => f.endsWith('.mp3'));
const music = new Set(JSON.parse(readFileSync(join(ASSETS, 'sfx/sounds.json'), 'utf8')).music ?? []);
const queue = [...sounds];
await Promise.all(Array.from({ length: cpus().length }, async () => {
  for (let f; (f = queue.shift());) {
    const args = music.has(basename(f)) ? ['-b:a', '96k'] : ['-ac', '1', '-b:a', '64k'];
    const out = `${f}.tmp.mp3`;
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-y', '-i', f, ...args, out]);
    // keep the original when re-encoding does not help (already tiny files)
    if (statSync(out).size < statSync(f).size) writeFileSync(f, readFileSync(out));
    rmSync(out);
  }
}));

// 5. Pre-compressed siblings for the server (skip formats that are already compressed)
for (const f of walk(DIST).filter((f) => /\.(js|css|html|json|glb|svg)$/.test(f))) {
  const data = readFileSync(f);
  const br = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
  if (br.length < data.length * 0.9) {
    writeFileSync(`${f}.br`, br);
    writeFileSync(`${f}.gz`, gzipSync(data, { level: 9 }));
  }
}

console.log(`\ndist: ${mb(before)} -> ${mb(dirSize(DIST))} (incl. .br/.gz copies)`);
for (const d of readdirSync(ASSETS)) {
  const p = join(ASSETS, d);
  if (statSync(p).isDirectory()) console.log(`  ${d}: ${mb(dirSize(p))}`);
}
