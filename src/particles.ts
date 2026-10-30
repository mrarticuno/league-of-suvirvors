// Runtime for League particle systems (VfxSystemDefinitionData), exported by tools/build_vfx.py into systems.json.
// Each emitter is CPU-simulated and rebuilt every frame into one dynamic mesh (billboards, quads, meshes, trails).
// Frames: a system's local space is League's (X, Y up, Z forward) rotated by the caster's facing; missile systems
// use X side, Y along the flight direction, Z up (the bin offsets/velocities of the champions' missiles agree on this).
import * as THREE from 'three';
import { asset, compact } from './util';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Bin = any; // bin JSON is loosely typed: fields are optional and nested Value* objects

let systems: Record<string, Bin> = {};
const textures = new Map<string, THREE.Texture>();
// `bones`: joints of a skinned particle mesh (drawn static in its bind pose), where its child systems spawn
const meshes = new Map<string, { pos: number[]; uv: number[]; bones?: Record<string, number[]> }>();
let camera: THREE.Camera | null = null; // captured from the renderer, needed for billboards and camera trails

function assetNames(v: Bin, out: Set<string>) {
  if (typeof v === 'string' && /\.(png|webp|json)$/.test(v)) out.add(v);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) assetNames(x, out);
}

/** A particle event of an animation clip (tools/build_vfx.py events.json): `key` at each bone, `t` seconds in. */
export interface ClipEvent { t: number; key: string; bones: string[] }
let clipEvents: Record<string, ClipEvent[]> = {};
/** The loaded champion's clip particle events, by clip name, in time order. */
export const animEvents = () => clipEvents;

/** `dir`: the champion's folder from tools/build_vfx.py (assets/vfx/<id>/). */
export async function loadParticles(dir: string) {
  systems = await (await fetch(asset(`${dir}systems.json`))).json();
  clipEvents = await fetch(asset(`${dir}events.json`)).then((r) => r.json()).catch(() => ({})); // older exports have none
  for (const evs of Object.values(clipEvents)) evs.sort((a, b) => a.t - b.t);
  const names = new Set<string>();
  assetNames(systems, names);
  const loader = new THREE.TextureLoader();
  await Promise.all([...names].map(async (n) => {
    if (n.endsWith('.json')) meshes.set(n, await (await fetch(asset(dir + n))).json());
    else {
      const t = await loader.loadAsync(asset(dir + n));
      t.flipY = false; // League UVs (meshes and flipbooks) have v=0 at the top
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      textures.set(n, t);
    }
  }));
}

// ---- Value curves ----

function interp(times: number[], values: any[], t: number): any {
  if (t <= times[0] || times.length === 1) return values[0];
  for (let i = 1; i < times.length; i++) {
    if (t <= times[i]) {
      const k = (t - times[i - 1]) / (times[i] - times[i - 1] || 1);
      const a = values[i - 1], b = values[i];
      return Array.isArray(a) ? a.map((x: number, j: number) => x + (b[j] - x) * k) : a + (b - a) * k;
    }
  }
  return values[values.length - 1];
}

/** Value at normalized time t (ValueFloat/Vector/Color, or a raw number/array). */
function val(v: Bin, t: number): any {
  if (v == null || typeof v === 'number' || Array.isArray(v)) return v;
  const d = v.dynamics;
  return d?.times?.length && d.values ? interp(d.times, d.values, t) : v.constantValue;
}

const roll = (tb: Bin) => (tb?.keyTimes ? interp(tb.keyTimes, tb.keyValues, Math.random()) : 1);

/** Birth value: the curve at emitter time t, each component scaled by its probability table. */
function birth(v: Bin, t: number): any {
  const base = val(v, t);
  const tables = v?.dynamics?.probabilityTables;
  if (base == null || !tables) return base;
  return Array.isArray(base) ? base.map((x: number, i: number) => x * roll(tables[i])) : base * roll(tables[0]);
}

const vec3 = (a: number[] | undefined, d = 0) => new THREE.Vector3(a?.[0] ?? d, a?.[1] ?? d, a?.[2] ?? d);
const DEG = Math.PI / 180;

// ---- materials ----

const vertexShader = /* glsl */ `
attribute vec4 aColor; attribute float aLife; attribute float aErode;
varying vec2 vUv; varying vec4 vColor; varying float vLife; varying float vErode;
void main() {
  vUv = uv; vColor = aColor; vLife = aLife; vErode = aErode;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;
const fragmentShader = /* glsl */ `
uniform sampler2D map; uniform sampler2D colorTex; uniform sampler2D erosionTex; uniform sampler2D multTex;
uniform float alphaRef; uniform float slice;
varying vec2 vUv; varying vec4 vColor; varying float vLife; varying float vErode;
void main() {
#ifdef USE_CLAMP
  if (vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0 || vUv.y > 1.0) discard;
#endif
  vec4 c = texture2D(map, vUv) * vColor;
#ifdef USE_COLORTEX
  c *= texture2D(colorTex, vec2(vLife, 0.5));
#endif
#ifdef USE_MULT
  c *= texture2D(multTex, vUv);
#endif
#ifdef USE_EROSION
  c.a *= clamp((texture2D(erosionTex, vUv).r - vErode * (1.0 + slice) + slice) / slice, 0.0, 1.0);
#endif
  if (c.a <= alphaRef) discard;
  gl_FragColor = c;
}`;

// VfxPrimitiveAttachedMesh: the owner's skinned mesh redrawn with the emitter's texture and colour (glows, afterimages)
const overlayVertex = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
}`;
const overlayFragment = /* glsl */ `
uniform sampler2D map; uniform vec4 color;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv) * color;
  if (c.a <= 0.0) discard;
  gl_FragColor = c;
}`;

function material(e: Bin) {
  const defines: Record<string, string> = {};
  const uniforms: Record<string, THREE.IUniform> = {
    map: { value: textures.get(e.texture) ?? null },
    alphaRef: { value: (e.alphaRef ?? 0) / 255 },
    slice: { value: e.alphaErosionDefinition?.erosionSliceWidth ?? 0.1 },
    colorTex: { value: null }, erosionTex: { value: null }, multTex: { value: null },
  };
  // clamped emitters (e.g. a swipe sliding across once) must not repeat; textures are shared, so clip in the shader
  if (e.uvScrollClamp || e.texAddressModeBase === 2) defines.USE_CLAMP = '';
  const colorTex = textures.get(e.particleColorTexture);
  if (colorTex) { defines.USE_COLORTEX = ''; uniforms.colorTex.value = colorTex; }
  const erosion = textures.get(e.alphaErosionDefinition?.erosionMapName);
  if (erosion) { defines.USE_EROSION = ''; uniforms.erosionTex.value = erosion; }
  const mult = textures.get(e.textureMult?.textureMult);
  if (mult) { defines.USE_MULT = ''; uniforms.multTex.value = mult; }
  // only blendMode 1 is alpha blended (its textures carry real alpha); the default and the others are additive:
  // most particle textures are DXT1 with an opaque black background
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms, defines, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    // ground-layer meshes lie on the terrain plane: bias them toward the camera so they don't z-fight (flicker) with it
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
    blending: e.blendMode === 1 ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
}

// ---- dynamic geometry ----

class Buffers {
  geo = new THREE.BufferGeometry();
  pos!: Float32Array; uv!: Float32Array; col!: Float32Array; life!: Float32Array; erode!: Float32Array; idx!: Uint32Array;
  nv = 0; ni = 0;
  private cap = 0;
  private icap = 0;

  begin() { this.nv = 0; this.ni = 0; }

  reserve(verts: number, idx: number) {
    if (this.nv + verts > this.cap) {
      this.cap = Math.max(256, (this.nv + verts) * 2);
      const grow = (a: Float32Array | undefined, n: number) => { const b = new Float32Array(this.cap * n); if (a) b.set(a.subarray(0, Math.min(a.length, b.length))); return b; };
      this.pos = grow(this.pos, 3); this.uv = grow(this.uv, 2); this.col = grow(this.col, 4);
      this.life = grow(this.life, 1); this.erode = grow(this.erode, 1);
      this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
      this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4));
      this.geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
      this.geo.setAttribute('aErode', new THREE.BufferAttribute(this.erode, 1));
    }
    if (this.ni + idx > this.icap) {
      this.icap = Math.max(512, (this.ni + idx) * 2);
      const b = new Uint32Array(this.icap);
      if (this.idx) b.set(this.idx.subarray(0, this.ni));
      this.idx = b;
      this.geo.setIndex(new THREE.BufferAttribute(this.idx, 1));
    }
  }

  vert(p: THREE.Vector3, u: number, v: number, c: number[], life: number, erode: number) {
    const i = this.nv++;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
    this.col.set(c, i * 4);
    this.life[i] = life; this.erode[i] = erode;
    return i;
  }

  commit() {
    for (const name of ['position', 'uv', 'aColor', 'aLife', 'aErode']) this.geo.getAttribute(name).needsUpdate = true;
    this.geo.index!.needsUpdate = true;
    this.geo.setDrawRange(0, this.ni);
  }
}

// ---- emitters ----

interface Particle {
  age: number; life: number;
  pos: THREE.Vector3; vel: THREE.Vector3; acc: THREE.Vector3; drag: THREE.Vector3;
  quat: THREE.Quaternion; // frame of the system at birth (bound particles follow the current one)
  color: number[]; scale: THREE.Vector3; rot: THREE.Vector3; rotVel: THREE.Vector3; orbit: THREE.Vector3;
  frame: number; uvOff: [number, number]; uvRate: [number, number];
  overlay?: THREE.ShaderMaterial; // attached-mesh particles: the material shared by their skinned meshes
  children?: { sys: ParticleSystem; at: THREE.Vector3 }[]; // child systems riding the particle (at: offset in its frame)
}

const PRIMITIVES = new Set([undefined, 'VfxPrimitiveArbitraryQuad', 'VfxPrimitiveMesh', 'VfxPrimitiveArbitraryTrail', 'VfxPrimitiveCameraTrail',
  'VfxPrimitiveRay', 'VfxPrimitiveAttachedMesh', 'VfxPrimitiveBeam']);
/** Simple (.scb/.sco) or skinned (.skn) particle mesh. */
const meshName = (e: Bin): string | undefined => e.primitive?.mMesh?.mSimpleMeshName ?? e.primitive?.mMesh?.mMeshName;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _fwd = new THREE.Vector3();
const _cs = new THREE.Vector3(), _cq = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const GROUND = 2; // ground-layer geometry, just above the (flat) terrain

class Emitter {
  particles: Particle[] = [];
  mesh: THREE.Mesh;
  private buf = new Buffers();
  private age = 0;
  private acc = 0; // fractional particles waiting to spawn
  private burst = false;
  private kind: 'billboard' | 'quad' | 'mesh' | 'trail' | 'camtrail' | 'ray' | 'attached' | 'beam';
  private meshData?: { pos: number[]; uv: number[]; bones?: Record<string, number[]> };
  private orphans: ParticleSystem[] = []; // child systems whose particle died, fading out
  private bound: boolean;
  private lastLocal = new THREE.Vector3(); // spawn point of the newest particle, in system space (trail head)

  constructor(private e: Bin, private sys: ParticleSystem) {
    const p = e.primitive?.__type;
    this.kind = p === 'VfxPrimitiveArbitraryQuad' ? 'quad' : p === 'VfxPrimitiveMesh' ? 'mesh'
      : p === 'VfxPrimitiveArbitraryTrail' ? 'trail' : p === 'VfxPrimitiveCameraTrail' ? 'camtrail'
        : p === 'VfxPrimitiveRay' ? 'ray' : p === 'VfxPrimitiveAttachedMesh' ? 'attached' : p === 'VfxPrimitiveBeam' ? 'beam' : 'billboard';
    if (this.kind === 'mesh' || this.kind === 'beam') this.meshData = meshes.get(meshName(e)!);
    this.bound = sys.bind || (val(e.bindWeight, 0) ?? 0) >= 0.5;
    this.buf.reserve(4, 6); // allocate attributes up front so an empty emitter still has a valid geometry
    this.mesh = new THREE.Mesh(this.buf.geo, material(e));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = e.pass ?? 0;
    this.mesh.onBeforeRender = (_r, _s, cam) => { camera = cam; };
  }

  static supported(e: Bin, sys: ParticleSystem) {
    const type = e.primitive?.__type;
    // distortion emitters refract the screen behind them; drawn as plain textures they become solid white quads
    return !e.disabled && !e.distortionDefinition && PRIMITIVES.has(type)
      && (type !== 'VfxPrimitiveMesh' || meshes.has(meshName(e)!))
      && (type !== 'VfxPrimitiveAttachedMesh' || (!!sys.owner && textures.has(e.texture)));
  }

  private get duration() { return this.e.lifetime > 0 ? this.e.lifetime : Infinity; }
  get active() { return !this.sys.stopped && this.age - (this.e.timeBeforeFirstEmission ?? 0) < this.duration; }
  get done() {
    return !this.active && this.particles.length === 0 && this.orphans.length === 0
      && (this.sys.stopped || this.age > (this.e.timeBeforeFirstEmission ?? 0));
  }
  private killAt = Infinity;
  /** LoL: when the system is destroyed (e.g. its missile hits) particles survive only `particleLinger` seconds. */
  kill() {
    this.killAt = Math.min(this.killAt, this.age + (this.e.particleLinger ?? 0));
    for (const p of this.particles) for (const c of p.children ?? []) c.sys.kill();
    for (const c of this.orphans) c.kill();
  }

  private drop(p: Particle) {
    for (const c of p.children ?? []) { c.sys.stop(); this.orphans.push(c.sys); }
    if (!p.overlay) return;
    for (const m of this.mesh.children.filter((m) => (m as THREE.Mesh).material === p.overlay)) m.removeFromParent();
    p.overlay.dispose();
  }

  update(dt: number, delta: THREE.Matrix4) {
    const e = this.e;
    this.age += dt;
    // bound particles follow the system; done before spawning so newborns (already placed with the current frame) skip it
    if (this.bound) for (const p of this.particles) { p.pos.applyMatrix4(delta); p.quat.copy(this.sys.quat); }
    const t0 = this.age - (e.timeBeforeFirstEmission ?? 0);
    const et = Number.isFinite(this.duration) ? Math.min(1, Math.max(0, t0 / this.duration)) : 0;
    if (this.active && t0 >= 0) {
      if (e.isSingleParticle) {
        // single-particle emitters fire `rate` particles at once
        if (!this.burst) { this.burst = true; for (let i = Math.max(1, Math.round(val(e.rate, 0) ?? 1)); i > 0; i--) this.spawn(et); }
      } else {
        this.acc += (val(e.rate, et) ?? 0) * dt;
        for (; this.acc >= 1 && this.particles.length < 600; this.acc--) this.spawn(et);
      }
    }
    const worldAcc = vec3(val(e.worldAcceleration, et));
    const fields = e.fieldCollectionDefinition;
    if (fields) this.fieldAcc(fields, et, worldAcc);
    if (this.age >= this.killAt) { for (const p of this.particles) this.drop(p); this.particles.length = 0; }
    // -1 lifetime: ends with its system; a one-shot effect's, with its emitter
    if (this.sys.stopped || (!this.sys.persistent && !this.active)) compact(this.particles, (p) => p.life !== Infinity || (this.drop(p), false));
    compact(this.particles, (p) => {
      p.age += dt;
      if (p.age >= p.life) { this.drop(p); return false; }
      const pt = p.age / p.life;
      p.vel.addScaledVector(p.acc, dt).addScaledVector(worldAcc, dt);
      if (fields) this.fieldForces(fields, et, p, dt);
      p.vel.multiply(_v.set(1 - Math.min(1, p.drag.x * dt), 1 - Math.min(1, p.drag.y * dt), 1 - Math.min(1, p.drag.z * dt)));
      p.pos.addScaledVector(p.vel, dt);
      const extra = val(e.velocity, pt);
      if (extra) p.pos.addScaledVector(vec3(extra).applyQuaternion(p.quat), dt);
      if (p.orbit.lengthSq() > 0) {
        // orbital velocity (deg/s) spins the particle around the system origin, in the system's frame
        _w.copy(p.pos).sub(this.sys.pos).applyQuaternion(_q.copy(p.quat).invert());
        _w.applyEuler(_e.set(p.orbit.x * dt * DEG, p.orbit.y * dt * DEG, p.orbit.z * dt * DEG));
        p.pos.copy(_w.applyQuaternion(p.quat).add(this.sys.pos));
      }
      return true;
    });
    for (const p of this.particles) if (p.children) this.moveChildren(p, dt);
    compact(this.orphans, (c) => { c.update(dt); if (!c.done) return true; c.dispose(); return false; });
    this.build(et);
  }

  /** The particle's frame: its birth frame turned by its rotation, its size by its scale (child systems ride it). */
  private frame(p: Particle, pt: number, s: THREE.Vector3, q: THREE.Quaternion) {
    const e = this.e;
    const sc = vec3(val(e.scale0, pt), 1);
    if (e.isUniformScale) sc.set(sc.x, sc.x, sc.x);
    s.copy(sc.multiply(p.scale)).multiplyScalar(this.sys.scale);
    const r = _v.copy(p.rot).addScaledVector(p.rotVel, p.age).add(vec3(val(e.rotation0, pt)));
    return q.copy(p.quat).multiply(_q2.setFromEuler(_e.set(r.x * DEG, r.y * DEG, r.z * DEG)));
  }

  private moveChildren(p: Particle, dt: number) {
    const q = this.frame(p, p.age / p.life, _cs, _cq);
    for (const c of p.children!) {
      c.sys.setFrame(_w.copy(c.at).multiply(_cs).applyQuaternion(q).add(p.pos), q);
      c.sys.update(dt);
    }
  }

  /** childParticleSetDefinition: each new particle carries these systems, at the mesh's joints (`boneToSpawnAt`). */
  private spawnChildren(p: Particle) {
    const set = this.e.childParticleSetDefinition;
    const ids: Bin[] = set?.childrenIdentifiers ?? [];
    if (!ids.length || !this.sys.scene || this.sys.depth >= 3) return;
    const bones = this.meshData?.bones;
    p.children = [];
    ids.forEach((id, i) => {
      const def = systems[id.effectKey];
      if (!def) return;
      const sys = new ParticleSystem(def, this.sys.scene!, p.pos, p.quat, { owner: this.sys.owner, size: this.sys.size, depth: this.sys.depth + 1 });
      sys.persistent = this.sys.persistent;
      p.children!.push({ sys, at: vec3(bones?.[set.boneToSpawnAt?.[i]]) });
    });
  }

  /** Uniform field accelerations (fieldAccelerationDefinitions) fold into the emitter's world acceleration. */
  private fieldAcc(f: Bin, et: number, out: THREE.Vector3) {
    for (const a of f.fieldAccelerationDefinitions ?? []) {
      const v = vec3(val(a.acceleration, et));
      out.add(a.isLocalSpace ? v.applyQuaternion(this.sys.quat) : v);
    }
  }

  /**
   * Positional fields around the system: drag slows particles inside `radius`, attraction pulls them toward `Position`
   * (system space). shortcut: orbital/noise fields are ignored (the champions' orbital ones are empty), add them when one carries data.
   */
  private fieldForces(f: Bin, et: number, p: Particle, dt: number) {
    for (const d of f.fieldDragDefinitions ?? []) {
      const r = val(d.radius, et) ?? Infinity;
      if (p.pos.distanceToSquared(this.sys.pos) <= r * r) p.vel.multiplyScalar(Math.max(0, 1 - (val(d.strength, et) ?? 0) * dt));
    }
    for (const a of f.fieldAttractionDefinitions ?? []) {
      const r = val(a.radius, et) ?? Infinity;
      _w.copy(vec3(val(a.Position, et))).applyMatrix4(this.sys.matrix).sub(p.pos);
      const d = _w.length();
      if (d > 1 && d <= r) p.vel.addScaledVector(_w, ((val(a.acceleration, et) ?? 0) * dt) / d);
    }
  }

  private spawn(et: number) {
    const e = this.e, sys = this.sys;
    const local = vec3(birth(e.EmitterPosition, et));
    const vel = vec3(birth(e.birthVelocity, et));
    const shape = e.SpawnShape;
    // FlexShape: offsets and sizes authored per unit of the bound object's size (a bigger target gets a bigger effect)
    const flex = sys.size ? e.FlexShapeDefinition : undefined;
    const kOffset = (flex?.scaleEmitOffsetByBoundObjectSize ? flex.scaleEmitOffsetByBoundObjectSize * sys.size! : 1) * sys.scale;
    let rot: THREE.Quaternion | null = null;
    if (shape) {
      const r = Math.random;
      if (shape.emitOffset) local.addScaledVector(vec3(birth(shape.emitOffset, et)), kOffset);
      if (shape.Size) local.addScaledVector(vec3(shape.Size).multiply(_v.set(r() - 0.5, r() - 0.5, r() - 0.5)), kOffset);
      if (shape.radius != null) {
        if (shape.__type === 'VfxShapeSphere') local.add(_v.randomDirection().multiplyScalar(shape.radius * kOffset * Math.cbrt(r())));
        else { const a = r() * Math.PI * 2, d = shape.radius * kOffset * Math.sqrt(r()); local.add(_v.set(Math.cos(a) * d, r() * (shape.height ?? 0) * kOffset, Math.sin(a) * d)); }
      }
      if (shape.emitRotationAxes) {
        // legacy shapes rotate the offset (and the launch velocity) around the given axes
        rot = new THREE.Quaternion();
        shape.emitRotationAxes.forEach((axis: number[], i: number) => {
          rot!.multiply(_q.setFromAxisAngle(vec3(axis).normalize(), (birth(shape.emitRotationAngles?.[i], et) ?? 0) * DEG));
        });
        local.applyQuaternion(rot);
        vel.applyQuaternion(rot);
      }
    }
    this.lastLocal.copy(local);
    const uniform = e.isUniformScale;
    const s = vec3(birth(e.birthScale0, et), 1);
    if (uniform) s.set(s.x, s.x, s.x);
    if (flex?.scaleBirthScaleByBoundObjectSize) s.multiplyScalar(flex.scaleBirthScaleByBoundObjectSize * sys.size!);
    const texDiv = e.texDiv ?? [1, 1];
    const frames = e.numFrames ?? texDiv[0] * texDiv[1];
    const life = birth(e.particleLifetime, et);
    this.particles.push({
      age: 0, life: life > 0 ? life : Infinity, // -1: lives as long as the system
      pos: local.applyMatrix4(sys.matrix),
      vel: vel.applyQuaternion(sys.quat),
      acc: vec3(birth(e.birthAcceleration, et)).applyQuaternion(sys.quat),
      drag: vec3(birth(e.birthDrag, et)),
      quat: sys.quat.clone(),
      color: birth(e.birthColor, et) ?? [1, 1, 1, 1],
      scale: s,
      rot: vec3(birth(e.birthRotation0, et)),
      rotVel: vec3(birth(e.birthRotationalVelocity0, et)),
      orbit: vec3(birth(e.birthOrbitalVelocity, et)),
      frame: (e.startFrame ?? 0) + (e.isRandomStartFrame ? Math.floor(Math.random() * frames) : 0),
      uvOff: (birth(e.birthUVOffset, et) ?? [0, 0]).slice(0, 2),
      uvRate: (birth(e.birthUvScrollRate, et) ?? [0, 0]).slice(0, 2),
      overlay: this.kind === 'attached' ? this.overlay() : undefined,
    });
    this.spawnChildren(this.particles[this.particles.length - 1]);
  }

  /**
   * Skinned copies of the owner's submeshes (all visible ones, or `mSubmeshesToDraw`). Pose afterimages freeze the
   * pose of the moment they spawn; the others share the owner's live skeleton.
   * shortcut: the copies are drawn at the owner's size (birth scale, UV scroll and erosion are ignored), fine for glows.
   */
  private overlay() {
    const e = this.e;
    // bins and models disagree on submesh case (BODY / Body)
    const names = (e.primitive.mMesh?.mSubmeshesToDraw as string[] | undefined)?.map((n) => n.toLowerCase());
    const mat = new THREE.ShaderMaterial({
      vertexShader: overlayVertex, fragmentShader: overlayFragment,
      uniforms: { map: { value: textures.get(e.texture) }, color: { value: new THREE.Vector4(1, 1, 1, 1) } },
      transparent: true, depthWrite: false, side: e.disableBackfaceCull ? THREE.DoubleSide : THREE.FrontSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -8, // drawn over the owner's own surface
      blending: e.blendMode === 1 ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    this.sys.owner!.traverse((o) => {
      const src = o as THREE.SkinnedMesh;
      if (!src.isSkinnedMesh || !(names ? names.includes(String(src.userData.submesh).toLowerCase()) : src.visible)) return;
      let skeleton = src.skeleton;
      if (this.sys.afterimage) {
        skeleton = skeleton.clone();
        skeleton.update();
        skeleton.update = () => {}; // keep the snapshot: the renderer updates skeletons every frame
      }
      const m = new THREE.SkinnedMesh(src.geometry, mat);
      m.bind(skeleton, src.bindMatrix);
      m.frustumCulled = false;
      m.renderOrder = this.mesh.renderOrder;
      this.mesh.add(m);
    });
    return mat;
  }

  private build(et: number) {
    const e = this.e, b = this.buf;
    b.begin();
    const [cols, rows] = e.texDiv ?? [1, 1];
    const frames = e.numFrames ?? cols * rows;
    const uvRot = (val(e.uvRotation, 0) ?? 0) * DEG;
    const cos = Math.cos(uvRot), sin = Math.sin(uvRot);
    const emitterScroll = (val(e.emitterUvScrollRate, et) ?? [0, 0]).map((x: number) => x * this.age);
    const trail = this.kind === 'trail' || this.kind === 'camtrail';
    const points: { p: Particle; c: number[]; w: number; pt: number; erode: number }[] = [];
    if (camera) {
      _right.setFromMatrixColumn(camera.matrixWorld, 0);
      _up.setFromMatrixColumn(camera.matrixWorld, 1);
    }

    for (const p of this.particles) {
      const pt = p.age / p.life;
      const cc = val(e.Color, pt) ?? [1, 1, 1, 1];
      const c = [p.color[0] * cc[0], p.color[1] * cc[1], p.color[2] * cc[2], p.color[3] * cc[3]];
      const sc = vec3(val(e.scale0, pt), 1);
      if (e.isUniformScale) sc.set(sc.x, sc.x, sc.x);
      const s = sc.multiply(p.scale).multiplyScalar(this.sys.scale);
      const erode = val(e.alphaErosionDefinition?.erosionDriveCurve, pt) ?? 0;
      if (trail) { points.push({ p, c, w: s.x, pt, erode }); continue; }
      if (p.overlay) { p.overlay.uniforms.color.value.set(c[0], c[1], c[2], c[3]); continue; }

      let frame = p.frame;
      if (!e.isRandomStartFrame && frames > 1) frame += e.frameRate ? Math.floor(p.age * e.frameRate) : Math.floor(pt * frames);
      frame %= frames;
      const fu = (frame % cols) / cols, fv = Math.floor(frame / cols) / rows;
      const scroll = (val(e.particleUVScrollRate, pt) ?? [0, 0]);
      const ou = p.uvOff[0] + p.uvRate[0] * p.age + scroll[0] * p.age + emitterScroll[0];
      const ov = p.uvOff[1] + p.uvRate[1] * p.age + scroll[1] * p.age + emitterScroll[1];
      const uv = (u: number, v: number): [number, number] => {
        const x = u - 0.5, y = v - 0.5;
        return [fu + (x * cos - y * sin + 0.5) / cols + ou, fv + (x * sin + y * cos + 0.5) / rows + ov];
      };
      const r = _v.copy(p.rot).addScaledVector(p.rotVel, p.age).add(vec3(val(e.rotation0, pt)));

      if (this.kind === 'beam') { this.buildBeam(p, s, c, pt, erode, uv); continue; }

      if (this.kind === 'mesh') {
        const m = this.meshData!;
        const n = m.pos.length / 3;
        b.reserve(n, n);
        _q.copy(p.quat).multiply(new THREE.Quaternion().setFromEuler(_e.set(r.x * DEG, r.y * DEG, r.z * DEG)));
        for (let i = 0; i < n; i++) {
          _w.set(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]).multiply(s).applyQuaternion(_q).add(p.pos);
          const [u, v] = uv(m.uv[i * 2], m.uv[i * 2 + 1]);
          b.idx[b.ni++] = b.vert(_w, u, v, c, pt, erode);
        }
        continue;
      }

      // quads: corners in the particle's XY plane; billboards: in the camera plane;
      // rays: a strip from the particle out along its rotated Z (length scale.z, half width scale.x), turned to the camera
      let ax: THREE.Vector3, ay: THREE.Vector3;
      let base = p.pos;
      if (this.kind === 'ray') {
        if (!camera) continue;
        _q.copy(p.quat).multiply(_q2.setFromEuler(_e.set(r.x * DEG, r.y * DEG, r.z * DEG)));
        ay = new THREE.Vector3(0, 0, s.z / 2).applyQuaternion(_q);
        if (ay.lengthSq() < 1e-6) continue;
        base = ay.clone().add(p.pos);
        ax = ay.clone().cross(_w.setFromMatrixPosition(camera.matrixWorld).sub(base)).normalize().multiplyScalar(s.x);
      } else if (this.kind === 'quad') {
        _q.copy(p.quat).multiply(new THREE.Quaternion().setFromEuler(_e.set(r.x * DEG, r.y * DEG, r.z * DEG)));
        ax = new THREE.Vector3(s.x, 0, 0).applyQuaternion(_q);
        ay = new THREE.Vector3(0, s.y, 0).applyQuaternion(_q);
      } else {
        if (!camera) continue;
        if (e.isDirectionOriented && p.vel.lengthSq() > 1) {
          // stretch along the velocity as seen on screen
          _fwd.setFromMatrixColumn(camera.matrixWorld, 2);
          ay = p.vel.clone().projectOnPlane(_fwd).normalize();
          ax = ay.clone().cross(_fwd).normalize();
        } else {
          const a = r.x * DEG; // billboards spin around the view axis
          ax = _right.clone().multiplyScalar(Math.cos(a)).addScaledVector(_up, Math.sin(a));
          ay = _up.clone().multiplyScalar(Math.cos(a)).addScaledVector(_right, -Math.sin(a));
        }
        ax.multiplyScalar(s.x);
        ay.multiplyScalar(s.y);
      }
      b.reserve(4, 6);
      const i0 = b.nv;
      for (const [cx, cy] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
        _w.copy(base).addScaledVector(ax, cx).addScaledVector(ay, cy);
        const [u, v] = uv((cx + 1) / 2, (1 - cy) / 2);
        b.vert(_w, u, v, c, pt, erode);
      }
      b.idx.set([i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3], b.ni);
      b.ni += 6;
    }

    if (trail) this.buildTrail(points, et, cos, sin, emitterScroll);
    b.commit();
  }

  /**
   * VfxPrimitiveBeam: from the particle (plus the source offset) to the system's target, or to its own position plus the
   * target offset (in the target's frame) without one. A beam mesh is stretched along its Z between the two ends;
   * without one, a camera-facing strip of half width scale.x, U along the length (one tile per mBirthTilingSize.y).
   * Ground-layer beams lie flat on the terrain (y = 0) between the two ends.
   */
  private buildBeam(p: Particle, s: THREE.Vector3, c: number[], pt: number, erode: number, uv: (u: number, v: number) => [number, number]) {
    const beam = this.e.primitive.mBeam ?? {};
    const b = this.buf, sys = this.sys;
    const src = vec3(beam.mLocalSpaceSourceOffset).applyQuaternion(p.quat).add(p.pos);
    const dst = vec3(beam.mLocalSpaceTargetOffset).applyQuaternion(sys.targetQuat ?? p.quat).add(sys.target ?? p.pos);
    const ground = !!this.e.isGroundLayer;
    if (ground) { src.y = GROUND; dst.y = GROUND; }
    const along = _fwd.subVectors(dst, src);
    const len = along.length();
    if (len < 1) return;
    along.divideScalar(len);
    const m = this.meshData;
    if (m) {
      // mesh frame: the mesh's +Z at the source, X level and across it, Y the rest (League's mesh space is mirrored:
      // Severum's swipe bows toward its target, Gravitum's swirl unrolls from the gun)
      const x = _right.crossVectors(along, UP);
      if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
      x.normalize();
      const y = _up.crossVectors(along, x);
      let z0 = Infinity, z1 = -Infinity;
      for (let i = 2; i < m.pos.length; i += 3) { z0 = Math.min(z0, m.pos[i]); z1 = Math.max(z1, m.pos[i]); }
      const n = m.pos.length / 3;
      b.reserve(n, n);
      for (let i = 0; i < n; i++) {
        const k = (z1 - m.pos[i * 3 + 2]) / (z1 - z0 || 1);
        _w.copy(src).addScaledVector(along, k * len).addScaledVector(x, m.pos[i * 3] * s.x).addScaledVector(y, m.pos[i * 3 + 1] * s.y);
        const [u, v] = uv(m.uv[i * 2], m.uv[i * 2 + 1]);
        b.idx[b.ni++] = b.vert(_w, u, v, c, pt, erode);
      }
      return;
    }
    if (!camera && !ground) return;
    const side = ground ? _w.crossVectors(along, UP).normalize().multiplyScalar(s.x)
      : _w.setFromMatrixPosition(camera!.matrixWorld).sub(src).cross(along).normalize().multiplyScalar(s.x);
    const tile = val(beam.mBirthTilingSize, 0)?.[1];
    const uLen = tile ? len / tile : 1;
    b.reserve(4, 6);
    const i0 = b.nv;
    for (const [end, k] of [[0, -1], [1, -1], [1, 1], [0, 1]]) {
      const [u, v] = uv(end * uLen, (k + 1) / 2);
      b.vert(_v.copy(src).addScaledVector(along, end * len).addScaledVector(side, k), u, v, c, pt, erode);
    }
    b.idx.set([i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3], b.ni);
    b.ni += 6;
  }

  /** Ribbon through the trail particles (newest first), starting at the emitter while it is active. */
  private buildTrail(points: { p: Particle; c: number[]; w: number; pt: number; erode: number }[], et: number, cos: number, sin: number, scroll: number[]) {
    const b = this.buf, e = this.e;
    if (this.active && points.length) {
      const head = points[points.length - 1];
      points.push({ ...head, pt: 0, p: { ...head.p, pos: this.lastLocal.clone().applyMatrix4(this.sys.matrix) } });
    }
    points.reverse();
    if (points.length < 2) return;
    const tile = val(e.primitive.mTrail?.mBirthTilingSize, et)?.[0] || 200;
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.sys.quat);
    b.reserve(points.length * 2, (points.length - 1) * 6);
    let dist = 0;
    for (let i = 0; i < points.length; i++) {
      const { p, c, w, pt, erode } = points[i];
      if (i > 0) dist += p.pos.distanceTo(points[i - 1].p.pos);
      let sv = side;
      if (this.kind === 'camtrail' && camera) {
        const next = points[Math.min(i + 1, points.length - 1)].p.pos, prev = points[Math.max(i - 1, 0)].p.pos;
        _fwd.subVectors(next, prev);
        _w.setFromMatrixPosition(camera.matrixWorld).sub(p.pos);
        sv = _fwd.cross(_w).normalize();
      }
      for (const k of [-1, 1]) {
        const u = dist / tile, v = (k + 1) / 2;
        const x = u - 0.5, y = v - 0.5;
        _w.copy(p.pos).addScaledVector(sv, w * k);
        b.vert(_w, x * cos - y * sin + 0.5 + scroll[0], x * sin + y * cos + 0.5 + scroll[1], c, pt, erode);
      }
      if (i > 0) {
        const a = b.nv - 4;
        b.idx.set([a, a + 1, a + 3, a, a + 3, a + 2], b.ni);
        b.ni += 6;
      }
    }
  }

  dispose() {
    for (const p of this.particles) this.drop(p);
    for (const c of this.orphans) c.dispose();
    this.orphans = [];
    this.mesh.removeFromParent();
    this.buf.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ---- systems ----

/**
 * `owner`: the model attached-mesh emitters redraw; `size`: the bound object's size, for FlexShape emitters;
 * `target`: where beams end (kept live: move the vector), `targetQuat` the frame of their target offset.
 * `bind`: every particle follows the system's frame (effects authored static that a kit moves).
 */
export interface SystemOpts { owner?: THREE.Object3D; size?: number; target?: THREE.Vector3; targetQuat?: THREE.Quaternion; depth?: number; bind?: boolean }

export class ParticleSystem {
  readonly matrix = new THREE.Matrix4();
  readonly quat = new THREE.Quaternion();
  readonly pos = new THREE.Vector3();
  stopped = false;
  private emitters: Emitter[] = [];
  private prev = new THREE.Matrix4();
  private delta = new THREE.Matrix4();

  readonly owner?: THREE.Object3D;
  readonly size?: number;
  readonly bind: boolean; // every particle rides the system (an effect authored static, moved by a kit)
  readonly afterimage: boolean;
  readonly scene?: THREE.Scene;
  readonly depth: number; // child systems nest: a bound on runaway sets
  readonly name: string; // League's particleName, for debugging
  target?: THREE.Vector3;
  targetQuat?: THREE.Quaternion;
  scale = 1; // live size multiplier: particle sizes and new birth offsets (an area that grows, e.g. Starsurge)
  persistent = false; // kept until stopped (marks, glows, missiles): -1-lifetime particles live that long

  constructor(def: Bin, scene: THREE.Scene, pos: THREE.Vector3, quat: THREE.Quaternion, opts: SystemOpts = {}) {
    this.owner = opts.owner;
    this.size = opts.size;
    this.bind = !!opts.bind;
    this.scene = scene;
    this.depth = opts.depth ?? 0;
    this.name = def.particleName ?? '';
    this.target = opts.target;
    this.targetQuat = opts.targetQuat;
    this.afterimage = !!def.mIsPoseAfterimage;
    this.setFrame(pos, quat);
    this.prev.copy(this.matrix);
    for (const e of [...(def.complexEmitterDefinitionData ?? []), ...(def.simpleEmitterDefinitionData ?? [])]) {
      if (!Emitter.supported(e, this)) continue;
      const em = new Emitter(e, this);
      this.emitters.push(em);
      scene.add(em.mesh);
    }
  }

  setFrame(pos: THREE.Vector3, quat: THREE.Quaternion) {
    this.pos.copy(pos);
    this.quat.copy(quat);
    this.matrix.compose(pos, quat, _v.set(1, 1, 1));
  }

  stop() { this.stopped = true; }
  /** Stops and cuts every particle short to its emitter's `particleLinger` (missile destroyed). */
  kill() { this.stopped = true; for (const e of this.emitters) e.kill(); }
  get done() { return this.emitters.every((e) => e.done); }

  update(dt: number) {
    this.delta.copy(this.prev).invert().premultiply(this.matrix);
    this.prev.copy(this.matrix);
    for (const e of this.emitters) e.update(dt, this.delta);
  }

  dispose() { for (const e of this.emitters) e.dispose(); }
}

export function createSystem(key: string, scene: THREE.Scene, pos: THREE.Vector3, quat: THREE.Quaternion, opts?: SystemOpts) {
  const def = systems[key];
  return def ? new ParticleSystem(def, scene, pos, quat, opts) : null;
}

/** Missile frame: X side, Y along the flight direction, Z up. */
export function missileQuat(dir: THREE.Vector3, out = new THREE.Quaternion()) {
  const y = _fwd.copy(dir).setY(0).normalize();
  const x = _w.crossVectors(y, UP);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, UP));
}
/** Character frame: League's Z forward turned to `facing` (radians around Y). */
export const facingQuat = (facing: number, out = new THREE.Quaternion()) => out.setFromAxisAngle(UP, facing);
