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
 */
export function loadModel(id: string, hide: readonly string[] = [], mesh = id, textures: Readonly<Record<string, string>> = {}): Promise<void> {
  let p = loading.get(id);
  if (!p) {
    p = fetchModel(id, hide, mesh, textures).catch((e) => { loading.delete(id); throw e; }); // a failed download can retry
    loading.set(id, p);
  }
  return p;
}

/** Whether loadModel(id) finished: Actor and propModel need it. */
export const modelLoaded = (id: string) => templates.has(id);

async function fetchModel(id: string, hide: readonly string[], mesh: string, textures: Readonly<Record<string, string>>) {
  const stems = [...new Set(Object.values(textures))];
  const [gltf, material, ...overrides] = await Promise.all([
    gltfLoader.loadAsync(asset(`assets/models/${mesh}.glb`)),
    loadMaterial(id),
    ...stems.map(loadMaterial),
  ]);
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    const name = (mesh.material as THREE.Material).name;
    mesh.userData.submesh = name; // the replacement material loses it; particle overlays (VfxPrimitiveAttachedMesh) filter by it
    mesh.visible = !hide.includes(name);
    mesh.material = name in textures ? overrides[stems.indexOf(textures[name])] : material;
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
  templates.set(id, { scene: gltf.scene, clips: new Map(gltf.animations.map((c) => [c.name, c])) });
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

/** An animated instance of a loaded model. */
export class Actor {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private clips: Map<string, THREE.AnimationClip>;
  private current?: THREE.AnimationAction;
  private bones = new Map<string, THREE.Object3D>();
  private submeshes = new Map<string, THREE.Object3D[]>();
  currentName = '';

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
  }

  setTimeScale(s: number) {
    if (this.current) this.current.timeScale = s;
  }

  update(dt: number) {
    this.mixer.update(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
