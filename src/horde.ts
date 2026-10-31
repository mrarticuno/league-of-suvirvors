// Instanced enemies: one InstancedMesh per model, the bone matrices of every clip baked into a float texture at load.
// Each instance carries (row A, row B, blend) and the vertex shader skins from the texture, so an animated enemy costs the
// CPU a few arithmetic ops and one matrix write per frame, and the whole model is one draw call.
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { template } from './assets';

export const BAKE_FPS = 30; // pose rows per second of clip; rows are blended, so this stays smooth

interface ClipRows { row: number; frames: number; duration: number }

interface Bake {
  texture: THREE.DataTexture; // width = bones × 4 texels (one mat4 per bone), one row per pose
  clips: Map<string, ClipRows>;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Every pose of every clip, as `Skeleton.boneMatrices` rows, sampled at BAKE_FPS on a private clone of the model. */
function bake(scene: THREE.Object3D, clips: Map<string, THREE.AnimationClip>): Bake {
  let skeleton: THREE.Skeleton | undefined;
  scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skeleton ??= (o as THREE.SkinnedMesh).skeleton; });
  if (!skeleton) throw new Error('no skinned mesh to bake');
  const stride = skeleton.bones.length * 16;
  const rows = new Map<string, ClipRows>();
  let total = 0;
  for (const [name, clip] of clips) {
    const frames = Math.ceil(clip.duration * BAKE_FPS) + 1;
    rows.set(name, { row: total, frames, duration: clip.duration });
    total += frames;
  }
  const data = new Float32Array(stride * total);
  const mixer = new THREE.AnimationMixer(scene);
  for (const [name, clip] of clips) {
    const { row, frames } = rows.get(name)!;
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    for (let f = 0; f < frames; f++) {
      mixer.setTime(Math.min(f / BAKE_FPS, clip.duration));
      scene.updateMatrixWorld(true);
      skeleton.update();
      data.set(skeleton.boneMatrices!, (row + f) * stride);
    }
    action.stop();
    mixer.uncacheClip(clip);
  }
  const texture = new THREE.DataTexture(data, skeleton.bones.length * 4, total, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return { texture, clips: rows };
}

/** The model's material, skinning from the bake texture by the instance's (rowA, rowB, blend). */
function instancedMaterial(source: THREE.Material, bake: Bake, bindMatrix: THREE.Matrix4) {
  const mat = source.clone();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.bakeTex = { value: bake.texture };
    shader.uniforms.bakeBind = { value: bindMatrix };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
        attribute vec4 skinIndex;
        attribute vec4 skinWeight;
        attribute vec4 instanceAnim;
        uniform highp sampler2D bakeTex;
        uniform mat4 bakeBind;
        mat4 bakeBone(int row, float bone) {
          int x = int(bone) * 4;
          return mat4(texelFetch(bakeTex, ivec2(x, row), 0), texelFetch(bakeTex, ivec2(x + 1, row), 0),
            texelFetch(bakeTex, ivec2(x + 2, row), 0), texelFetch(bakeTex, ivec2(x + 3, row), 0));
        }
        mat4 bakePose(int row) {
          return bakeBone(row, skinIndex.x) * skinWeight.x + bakeBone(row, skinIndex.y) * skinWeight.y
            + bakeBone(row, skinIndex.z) * skinWeight.z + bakeBone(row, skinIndex.w) * skinWeight.w;
        }`)
      .replace('#include <begin_vertex>', /* glsl */ `
        mat4 pose = bakePose(int(instanceAnim.x)) * (1.0 - instanceAnim.z) + bakePose(int(instanceAnim.y)) * instanceAnim.z;
        vec3 transformed = (pose * (bakeBind * vec4(position, 1.0))).xyz;`);
  };
  mat.customProgramCacheKey = () => 'horde';
  return mat;
}

/** All instances of one enemy model. `sync` after the enemies moved: copies each actor's root transform and pose. */
export class Horde {
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly matrices: THREE.InstancedBufferAttribute;
  private readonly anim: THREE.InstancedBufferAttribute;
  private readonly actors: InstancedActor[] = [];
  readonly bake: Bake;

  constructor(id: string, scene: THREE.Scene, readonly capacity: number) {
    const t = template(id);
    const rig = clone(t.scene);
    this.bake = bake(rig, t.clips);
    this.matrices = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
    this.anim = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.matrices.setUsage(THREE.DynamicDrawUsage);
    this.anim.setUsage(THREE.DynamicDrawUsage);
    t.scene.traverse((o) => {
      const src = o as THREE.SkinnedMesh;
      if (!src.isSkinnedMesh || !src.visible) return;
      const geometry = src.geometry.clone();
      geometry.setAttribute('instanceAnim', this.anim);
      const mesh = new THREE.InstancedMesh(geometry, instancedMaterial(src.material as THREE.Material, this.bake, src.bindMatrix), capacity);
      mesh.instanceMatrix = this.matrices; // every submesh shares the one transform per instance
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.meshes.push(mesh);
      scene.add(mesh);
    });
  }

  actor(scale: number) {
    if (this.actors.length >= this.capacity) throw new Error('horde full');
    const a = new InstancedActor(this, this.actors.length, scale);
    this.actors.push(a);
    return a;
  }

  /** @internal swap-remove keeps the live instances packed at the front. */
  free(a: InstancedActor) {
    const last = this.actors.pop()!;
    if (last !== a) { this.actors[a.slot] = last; last.slot = a.slot; }
  }

  sync() {
    const n = this.actors.length, m = this.matrices.array as Float32Array, anim = this.anim.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const a = this.actors[i];
      if (a.root.visible) { a.root.updateMatrix(); a.root.matrix.toArray(m, i * 16); } else ZERO.toArray(m, i * 16);
      a.writePose(anim, i * 4);
    }
    this.matrices.needsUpdate = true;
    this.anim.needsUpdate = true;
    for (const mesh of this.meshes) mesh.count = n;
  }

  dispose() {
    for (const mesh of this.meshes) { mesh.removeFromParent(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
    this.bake.texture.dispose();
  }
}

/** The enemy-facing subset of Actor's API, backed by one instance of a Horde. `root` is never drawn: sync reads it. */
export class InstancedActor {
  readonly root = new THREE.Object3D();
  currentName = '';
  private clip: ClipRows | null = null;
  private time = 0;
  private loop = true;
  private timeScale = 1;
  private prev: ClipRows | null = null;
  private prevTime = 0;
  private fade = 0;
  private fadeLength = 0;

  constructor(private readonly horde: Horde, public slot: number, scale: number) {
    this.root.scale.setScalar(scale);
    this.root.matrixAutoUpdate = false;
  }

  duration(name: string) {
    return this.horde.bake.clips.get(name)?.duration ?? 0;
  }

  play(name: string, opts: { loop?: boolean; fade?: number; duration?: number; restart?: boolean } = {}) {
    const clip = this.horde.bake.clips.get(name);
    if (!clip) return;
    if (this.currentName === name && !opts.restart) return;
    if (this.clip) {
      this.prev = this.clip;
      this.prevTime = this.time;
      this.fade = this.fadeLength = opts.fade ?? 0.12;
    }
    this.clip = clip;
    this.time = 0;
    this.loop = opts.loop !== false;
    this.timeScale = opts.duration ? clip.duration / opts.duration : 1;
    this.currentName = name;
  }

  update(dt: number) {
    if (!this.clip) return;
    this.time += dt * this.timeScale;
    if (this.loop) this.time %= this.clip.duration;
    else this.time = Math.min(this.time, this.clip.duration);
    if (this.fade > 0) { this.fade -= dt; this.prevTime += dt; }
  }

  /** @internal (rowA, rowB, blend): two neighbouring poses of the clip, or the clip and the one it fades from. */
  writePose(out: Float32Array, o: number) {
    const c = this.clip;
    if (!c) { out[o] = out[o + 1] = out[o + 2] = 0; return; }
    const f = Math.min(this.time * BAKE_FPS, c.frames - 1);
    if (this.fade > 0 && this.prev) {
      out[o] = c.row + Math.round(f);
      out[o + 1] = this.prev.row + Math.min(Math.round(this.prevTime * BAKE_FPS), this.prev.frames - 1);
      out[o + 2] = this.fade / this.fadeLength;
      return;
    }
    const f0 = Math.floor(f);
    out[o] = c.row + f0;
    out[o + 1] = c.row + (f0 + 1 < c.frames ? f0 + 1 : this.loop ? 0 : f0);
    out[o + 2] = f - f0;
  }

  dispose() {
    this.root.removeFromParent();
    this.horde.free(this);
  }
}
