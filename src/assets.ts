import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { asset, IMG } from './util';

interface Template {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
}

const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); // build:prod meshopt-compresses the .glb files
const texLoader = new THREE.TextureLoader();
const templates = new Map<string, Template>();
const loading = new Map<string, Promise<void>>(); // in flight or done: concurrent callers share one download

export interface ModelOpts {
  textures?: Readonly<Record<string, string>>;
  sequences?: Readonly<Record<string, readonly string[]>>;
  translucent?: readonly string[];
}

async function loadMaterial(texture: string) {
  const map = await texLoader.loadAsync(asset(`assets/models/${texture}.${IMG}`));
  map.flipY = false; // glTF UV convention
  // League meshes rely on UV wrap (some islands go negative or past 1.0), clamp shows atlas edges
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  // League shading is mostly baked into the diffuse texture, so an unlit material stays faithful
  return new THREE.MeshBasicMaterial({ map, alphaTest: 0.3 });
}

/**
 * `mesh` loads another model's .glb with this model's texture (texture-only skins).
 * `textures` gives submeshes their own texture (the skin bin's materialOverride): submesh name -> texture file stem.
 * `sequences` adds clips made of others played end to end: new clip name -> part clip names.
 * `translucent`: submeshes blended by their texture alpha instead of cut out by it (e.g. a see-through tail).
 */
export function loadModel(id: string, hide: readonly string[] = [], mesh = id, opts: ModelOpts = {}): Promise<void> {
  let p = loading.get(id);
  if (!p) {
    p = fetchModel(id, hide, mesh, opts).catch((e) => { loading.delete(id); throw e; }); // a failed download can retry
    loading.set(id, p);
  }
  return p;
}

/** Whether loadModel(id) finished: Actor and propModel need it. */
export const modelLoaded = (id: string) => templates.has(id);

async function fetchModel(id: string, hide: readonly string[], mesh: string, { textures = {}, sequences = {}, translucent = [] }: ModelOpts) {
  const stems = [...new Set(Object.values(textures))];
  const [gltf, material, ...overrides] = await Promise.all([
    gltfLoader.loadAsync(asset(`assets/models/${mesh}.glb`)),
    loadMaterial(id),
    ...stems.map((s) => loadMaterial(s)),
  ]);
  const blended = translucent.length ? Object.assign(material.clone(), { alphaTest: 0, transparent: true, depthWrite: false }) : material;
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    const name = (mesh.material as THREE.Material).name;
    mesh.userData.submesh = name; // the replacement material loses it; particle overlays (VfxPrimitiveAttachedMesh) filter by it
    mesh.visible = !hide.includes(name);
    mesh.material = name in textures ? overrides[stems.indexOf(textures[name])] : translucent.includes(name) ? blended : material;
    mesh.frustumCulled = false; // skinned bounds don't follow animation
  });
  for (const clip of gltf.animations) {
    const kept = clip.tracks.filter((t) => !isUnkeyed(t, gltf.scene));
    // The drakes' flying_attack1/spell1 also store keyed translations as offsets from the bind pose
    // (Root y ~0 instead of ~84 sinks the drake into the ground). Other clips with unkeyed bones, e.g. murkwolf death, are absolute.
    if (clip.name === 'sru_dragon_flying_attack1' || clip.name === 'sru_dragon_flying_spell1') {
      for (const t of kept) {
        if (!t.name.endsWith('.position')) continue;
        const bind = gltf.scene.getObjectByName(t.name.slice(0, -'.position'.length))?.position;
        if (bind) for (let i = 0; i < t.values.length; i += 3) {
          t.values[i] += bind.x; t.values[i + 1] += bind.y; t.values[i + 2] += bind.z;
        }
      }
    }
    clip.tracks = kept;
  }
  const clips = new Map(gltf.animations.map((c) => [c.name, c]));
  for (const [name, parts] of Object.entries(sequences)) {
    const found = parts.flatMap((p) => clips.get(p) ?? []);
    if (found.length === parts.length) clips.set(name, joinClips(name, found));
  }
  templates.set(id, { scene: gltf.scene, clips });
}

/** One clip playing `parts` back to back (a track missing from a part interpolates across it). */
function joinClips(name: string, parts: THREE.AnimationClip[]) {
  const tracks = new Map<string, { track: THREE.KeyframeTrack; times: number[]; values: number[] }>();
  let offset = 0;
  for (const clip of parts) {
    for (const t of clip.tracks) {
      let j = tracks.get(t.name);
      if (!j) tracks.set(t.name, (j = { track: t, times: [], values: [] }));
      for (const x of t.times) j.times.push(x + offset);
      for (const x of t.values) j.values.push(x);
    }
    offset += clip.duration;
  }
  type Track = new (name: string, times: number[], values: number[]) => THREE.KeyframeTrack;
  return new THREE.AnimationClip(name, offset, [...tracks.values()].map(({ track, times, values }) =>
    new (track.constructor as Track)(track.name, times, values)));
}

/**
 * Some converted clips (the drakes' flying_attack1/spell1) carry bones the .anm does not key as zero translation /
 * identity rotation instead of the bind pose, which collapses the mesh. Dropping those tracks lets the bind pose show.
 */
function isUnkeyed(track: THREE.KeyframeTrack, scene: THREE.Object3D) {
  const v = track.values;
  if (track.name.endsWith('.quaternion')) {
    for (let i = 0; i < v.length; i += 4) if (Math.abs(v[i + 3]) < 0.9999) return false;
    return true;
  }
  if (!track.name.endsWith('.position')) return false;
  const bone = scene.getObjectByName(track.name.slice(0, -'.position'.length));
  if (!bone || bone.position.length() < 1) return false;
  for (let i = 0; i < v.length; i++) if (Math.abs(v[i]) > 1) return false;
  return true;
}

/** A static (unanimated) clone of a loaded model, for scenery. */
export function propModel(id: string): THREE.Object3D {
  const t = templates.get(id);
  if (!t) throw new Error(`model ${id} not loaded`);
  return clone(t.scene);
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _pq2 = new THREE.Quaternion();

/** An animated instance of a loaded model. */
export class Actor {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private clips: Map<string, THREE.AnimationClip>;
  private current?: THREE.AnimationAction;
  private bones = new Map<string, THREE.Object3D>();
  private submeshes = new Map<string, THREE.Object3D[]>();
  currentName = '';
  /** Timed events per clip (e.g. particle events): `onEvent` runs as the current clip passes each one. */
  events?: Record<string, readonly { t: number }[]>;
  onEvent?: (ev: { t: number }) => void;
  private nextEvent = 0;
  private lastTime = 0;
  private path?: { joints: THREE.Object3D[]; trail: THREE.Vector3[] };

  constructor(id: string, scale = 1) {
    const t = templates.get(id);
    if (!t) throw new Error(`model ${id} not loaded`);
    const model = clone(t.scene);
    model.scale.setScalar(scale);
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = t.clips;
    model.traverse((o) => {
      if (o.name) this.bones.set(o.name.toLowerCase(), o);
      const sub = (o.userData.submesh as string | undefined)?.toLowerCase();
      if (sub) this.submeshes.set(sub, [...(this.submeshes.get(sub) ?? []), o]);
    });
  }

  /** Shows or hides a submesh (the skin's SubmeshVisibility events, e.g. the weapon in hand), case-insensitive. */
  showSubmesh(name: string, visible: boolean) {
    for (const o of this.submeshes.get(name.toLowerCase()) ?? []) o.visible = visible;
  }

  /**
   * Bends the joint chain `from`..`to` along the ground path it has travelled, each joint trailing the one before
   * (the skin's ConformToPathRigPoseModifierData, e.g. a tail that curves behind a turn).
   */
  conformToPath(from: string, to: string) {
    const start = this.bone(from);
    const joints: THREE.Object3D[] = [];
    for (let o = this.bone(to); o && !joints.includes(start!); o = o.parent ?? undefined) joints.unshift(o);
    if (start && joints[0] === start) this.path = { joints, trail: joints.map(() => new THREE.Vector3()) };
  }

  private followPath({ joints, trail }: { joints: THREE.Object3D[]; trail: THREE.Vector3[] }) {
    joints[0].updateWorldMatrix(true, true);
    for (let i = 0; i < joints.length - 1; i++) {
      const p = joints[i].getWorldPosition(_a), c = joints[i + 1].getWorldPosition(_b), prev = trail[i + 1];
      const len = Math.hypot(c.x - p.x, c.z - p.z);
      if (prev.lengthSq() === 0 || Math.hypot(prev.x - p.x, prev.z - p.z) > len * 3) continue; // first frame or a blink: animated pose
      // turn the joint around world Y so its child points back at where the child was last frame
      let turn = Math.atan2(prev.x - p.x, prev.z - p.z) - Math.atan2(c.x - p.x, c.z - p.z);
      turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
      const parent = joints[i].parent!.getWorldQuaternion(_pq);
      _q.setFromAxisAngle(UP, turn).premultiply(_pq2.copy(parent).invert()).multiply(parent);
      joints[i].quaternion.premultiply(_q);
      joints[i].updateWorldMatrix(false, true);
    }
    for (let i = 0; i < joints.length; i++) joints[i].getWorldPosition(trail[i]);
  }

  /** A node of the model by name, case-insensitive (League bins mix the case of bone names). */
  bone(name: string) {
    return this.bones.get(name.toLowerCase());
  }

  duration(name: string) {
    return this.clips.get(name)?.duration ?? 0;
  }

  /** Crossfade to a clip. `duration` stretches the clip to last that many seconds. */
  play(name: string, opts: { loop?: boolean; fade?: number; duration?: number; restart?: boolean } = {}) {
    const clip = this.clips.get(name);
    if (!clip) return;
    if (this.currentName === name && !opts.restart) return;
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(opts.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = true;
    action.timeScale = opts.duration ? clip.duration / opts.duration : 1;
    action.play();
    if (this.current && this.current !== action) action.crossFadeFrom(this.current, opts.fade ?? 0.12, false);
    this.current = action;
    this.currentName = name;
    this.nextEvent = 0;
    this.lastTime = 0;
  }

  setTimeScale(s: number) {
    if (this.current) this.current.timeScale = s;
  }

  update(dt: number) {
    this.mixer.update(dt);
    if (this.path) this.followPath(this.path);
    const evs = this.events?.[this.currentName];
    if (!evs || !this.current || !this.onEvent) return;
    const t = this.current.time;
    if (t < this.lastTime) this.nextEvent = 0; // looped
    this.lastTime = t;
    while (this.nextEvent < evs.length && evs[this.nextEvent].t <= t) this.onEvent(evs[this.nextEvent++]);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
