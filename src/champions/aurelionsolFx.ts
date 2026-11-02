// Aurelion Sol's pre-rework visuals, drawn procedurally: today's client no longer ships them (the orbiting comets of
// Center of the Universe and Voice of Light's blast). Matched frame by frame to his 2016 Champion Spotlight (1080p):
// - comets: a small white-gold head; a wide tail a quarter turn long fading white -> lavender -> blue-violet; a faint
//   blue-violet ring along the orbit;
// - Voice of Light: an orange-pink flash at the mouth, a white-lavender orb leading a translucent purple band streaked
//   along its length, which breaks into purple wisps and gold sparkles; every enemy knocked back trails gold lightning.
import * as THREE from 'three';

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
`;

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide } as const;

/** A camera-facing glow: `core` at the centre into `color`, `radius` world units (times the object's scale). */
function glow(color: THREE.Color, radius: number, core = new THREE.Color(1, 1, 1)) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uCore: { value: core }, uRadius: { value: radius }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uRadius; varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy * uRadius * 2.0 * length(modelMatrix[0].xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uCore; uniform float uAlpha; varying vec2 vUv;
      void main() {
        float d = length(vUv);
        if (d > 1.0) discard;
        float core = exp(-d * d * 18.0), halo = pow(1.0 - d, 2.4);
        gl_FragColor = vec4(mix(uColor * halo, uCore, core) * uAlpha, 1.0);
      }`,
    ...additive,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
  mesh.frustumCulled = false;
  return mesh;
}
const uniformsOf = (m: THREE.Mesh) => (m.material as THREE.ShaderMaterial).uniforms;

/** A ribbon through `points` world positions: `aT` 0 (first) .. 1 (last), `aSide` -1 .. 1 across. */
class Ribbon {
  readonly geo = new THREE.BufferGeometry();
  readonly pos: Float32Array;
  constructor(readonly points: number) {
    this.pos = new Float32Array(points * 2 * 3);
    const t = new Float32Array(points * 2), s = new Float32Array(points * 2), idx: number[] = [];
    for (let i = 0; i < points; i++) {
      t[i * 2] = t[i * 2 + 1] = i / (points - 1);
      s[i * 2] = -1; s[i * 2 + 1] = 1;
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    this.geo.setAttribute('aSide', new THREE.BufferAttribute(s, 1));
    this.geo.setIndex(idx);
  }
  /** Point `i` at `at`, `w` to each side along `side` (unit). */
  set(i: number, at: THREE.Vector3, side: THREE.Vector3, w: number) {
    this.pos.set([at.x - side.x * w, at.y, at.z - side.z * w, at.x + side.x * w, at.y, at.z + side.z * w], i * 6);
  }
  mesh(fragmentShader: string, uniforms: Record<string, THREE.IUniform> = {}) {
    const m = new THREE.Mesh(this.geo, new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        attribute float aT; attribute float aSide; varying float vT; varying float vSide;
        void main() { vT = aT; vSide = aSide; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader, ...additive,
    }));
    m.frustumCulled = false;
    return m;
  }
}

const TAIL_POINTS = 32;

/** One orbiting comet: a glowing head and a tail drawn along the path it really travelled (it trails behind when he walks). */
export class Comet {
  readonly root = new THREE.Group();
  /** Tail length in world units (the kit keeps it a quarter turn of the orbit). */
  length: number;
  private head = glow(new THREE.Color(1, 0.78, 0.55), 1, new THREE.Color(1, 0.97, 0.88));
  private flare = glow(new THREE.Color(0.62, 0.55, 1), 1);
  private path: THREE.Vector3[] = []; // newest first, world positions
  private tail = new Ribbon(TAIL_POINTS);
  private tmp = new THREE.Vector3();
  private side = new THREE.Vector3();

  /** `width`: half width of the tail at its widest. */
  constructor(length: number, private width: number, headRadius: number) {
    this.length = length;
    uniformsOf(this.head).uRadius.value = headRadius;
    uniformsOf(this.flare).uRadius.value = headRadius * 2.6;
    uniformsOf(this.flare).uAlpha.value = 0.3;
    const tail = this.tail.mesh(/* glsl */ `
      varying float vT; varying float vSide;
      void main() {
        vec3 c = mix(vec3(1.0, 0.9, 0.75), vec3(0.8, 0.66, 1.0), smoothstep(0.0, 0.1, vT));
        c = mix(c, vec3(0.36, 0.4, 1.0), smoothstep(0.15, 0.6, vT));
        float across = 1.0 - vSide * vSide;
        float a = pow(1.0 - vT, 1.1) * across * (0.5 + 0.5 * exp(-vSide * vSide * 3.0));
        gl_FragColor = vec4(c * a * 0.85, 1.0);
      }`);
    this.root.add(tail, this.flare, this.head);
  }

  /** Moves the head to `p` (world) and rebuilds the tail behind it. */
  update(p: THREE.Vector3) {
    this.head.position.copy(p);
    this.flare.position.copy(p);
    const path = this.path;
    if (!path.length || path[0].distanceToSquared(p) > 1) path.unshift(p.clone());
    let len = 0; // keep just over the tail's length of path
    for (let i = 1; i < path.length; i++) {
      len += path[i].distanceTo(path[i - 1]);
      if (len > this.length) { path.length = i + 1; break; }
    }
    // resample the path at even steps from the head
    const step = this.length / (TAIL_POINTS - 1);
    let seg = 0, along = 0; // whole segments walked before `seg`
    for (let i = 0; i < TAIL_POINTS; i++) {
      const want = i * step;
      while (seg < path.length - 1 && along + path[seg].distanceTo(path[seg + 1]) < want) { along += path[seg].distanceTo(path[seg + 1]); seg++; }
      const a = path[seg], b = path[Math.min(seg + 1, path.length - 1)];
      const d = a.distanceTo(b);
      const at = this.tmp.copy(a);
      if (d > 0) at.lerp(b, Math.min(1, (want - along) / d));
      const prev = path[Math.max(seg - 1, 0)], next = path[Math.min(seg + 2, path.length - 1)];
      this.side.set(-(next.z - prev.z), 0, next.x - prev.x);
      if (this.side.lengthSq() < 1e-6) this.side.set(1, 0, 0);
      const t = i / (TAIL_POINTS - 1);
      // a crescent: narrow at the head, widest a little behind it, tapering to a point
      this.tail.set(i, at, this.side.normalize(), this.width * (0.45 + 0.55 * Math.min(1, t / 0.15)) * Math.pow(1 - t, 0.75));
    }
    this.tail.geo.attributes.position.needsUpdate = true;
  }

  set visible(v: boolean) { this.root.visible = v; if (!v) this.path.length = 0; }

  dispose() {
    this.root.removeFromParent();
    this.tail.geo.dispose();
    for (const o of this.root.children as THREE.Mesh[]) (o.material as THREE.Material).dispose();
    for (const o of [this.head, this.flare]) o.geometry.dispose();
  }
}

/** The faint blue-violet ring the comets draw along their orbit. */
export class OrbitRing {
  readonly mesh: THREE.Mesh;
  constructor() {
    const geo = new THREE.RingGeometry(0.97, 1.03, 128);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0.16 } },
      vertexShader: /* glsl */ `varying float vR; void main() { vR = length(position.xz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uAlpha; varying float vR;
        void main() { float k = 1.0 - abs(vR - 1.0) / 0.03; gl_FragColor = vec4(vec3(0.3, 0.38, 1.0) * k * k * uAlpha, 1.0); }`,
      ...additive,
    }));
    this.mesh.frustumCulled = false;
  }
  /** Centred on `center`, `radius` world units, at height `y`. */
  place(center: THREE.Vector3, radius: number, y: number) {
    this.mesh.position.set(center.x, y, center.z);
    this.mesh.scale.setScalar(radius);
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Something the kit plays and forgets: `update` returns false once it is over. */
export interface Fx { readonly root: THREE.Object3D; update(dt: number): boolean; dispose(): void }

const SPARKS = 48;

/** Voice of Light: the blast along `dir` from `from` (its mouth end), `length` x `width` (half width) world units. */
export class Blast implements Fx {
  readonly root = new THREE.Group();
  private band: THREE.Mesh;
  private flash = glow(new THREE.Color(1, 0.45, 0.55), 1, new THREE.Color(1, 0.9, 0.85));
  private orb = glow(new THREE.Color(0.7, 0.55, 1), 1, new THREE.Color(1, 0.97, 1));
  private sparks: THREE.Points;
  private age = 0;
  private from: THREE.Vector3;
  private dir: THREE.Vector3;

  constructor(from: THREE.Vector3, dir: THREE.Vector3, readonly length: number, width: number,
    private travel: number, private hold = 0.12, private fade = 0.6) {
    this.from = from.clone();
    this.dir = dir.clone();
    const geo = new THREE.PlaneGeometry(length, width * 2, 1, 1);
    geo.rotateX(-Math.PI / 2); // flat, length along +X
    geo.translate(length / 2, 0, 0);
    // two passes: purple paint (translucent smoke that shades the ground), then additive light on its streaks
    const uniforms = { uHead: { value: 0 }, uFade: { value: 0 }, uTime: { value: 0 }, uSeed: { value: Math.random() * 50 }, uAspect: { value: length / (width * 2) } };
    const material = (light: boolean) => new THREE.ShaderMaterial({
      uniforms, defines: light ? { LIGHT: '' } : {},
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: NOISE + /* glsl */ `
        uniform float uHead, uFade, uTime, uSeed, uAspect; varying vec2 vUv;
        void main() {
          float x = vUv.x, y = abs(vUv.y - 0.5) * 2.0; // along 0..1, across 0 (axis)..1 (edge)
          float spread = 0.45 + 0.55 * smoothstep(0.0, 0.22, x); // flares out of the mouth
          // streaks: stretched along the blast, racing away from him
          float streak = fbm(vec2(x * uAspect * 0.45 - uTime * 5.0, vUv.y * 11.0) + uSeed);
          float cloud = fbm(vec2(x * uAspect * 1.1 - uTime * 1.6, vUv.y * 3.2) + uSeed * 1.9);
          float edge = y / spread + (cloud - 0.5) * 0.8;
          if (edge > 1.0) discard;
          float puff = smoothstep(0.3, 0.75, cloud);
          float density = (1.0 - smoothstep(0.25, 1.0, edge)) * (0.35 + 0.65 * puff);
          float hi = pow(clamp(streak * 1.45 - 0.3, 0.0, 1.0), 2.0) * (1.0 - smoothstep(0.05, 0.85, edge));
          float hot = 1.0 - smoothstep(0.0, 0.16, x); // orange-pink right at the mouth
          float front = smoothstep(uHead, uHead - 0.05, x);
          // fading: it breaks into wisps where the clouds are thin first
          float keep = uFade <= 0.0 ? 1.0 : smoothstep(uFade - 0.1, uFade + 0.2, cloud * 0.9 + streak * 0.4 - 0.1);
          float a = density * front * keep * smoothstep(0.0, 0.02, x) * (1.0 - smoothstep(0.93, 1.0, x));
          #ifdef LIGHT
            vec3 light = vec3(0.78, 0.6, 1.0) * hi * 1.6 + vec3(0.5, 0.3, 1.0) * puff * 0.25 + vec3(1.0, 0.55, 0.5) * hot * 0.9 * (1.0 - uFade);
            gl_FragColor = vec4(light * a, 1.0);
          #else
            vec3 c = mix(vec3(0.2, 0.06, 0.5), vec3(0.58, 0.32, 1.0), puff);
            c = mix(c, vec3(0.9, 0.45, 0.6), hot * 0.6);
            gl_FragColor = vec4(c, clamp(a * 1.1, 0.0, 0.88));
          #endif
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: light ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.band = new THREE.Mesh(geo, material(false));
    const light = new THREE.Mesh(geo, material(true));
    for (const m of [this.band, light]) m.frustumCulled = false;
    this.band.add(light);
    this.band.position.set(from.x, 50, from.z);
    this.band.rotation.y = Math.atan2(-dir.z, dir.x);
    uniformsOf(this.flash).uRadius.value = width * 1.3;
    this.flash.position.copy(from);
    uniformsOf(this.orb).uRadius.value = width * 0.85;
    // gold sparkles scattered over the band, drifting up while the smoke clears
    const sp = new Float32Array(SPARKS * 3), seed = new Float32Array(SPARKS);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let i = 0; i < SPARKS; i++) {
      const along = Math.random() * length, across = (Math.random() * 2 - 1) * width * 0.9;
      sp.set([from.x + dir.x * along + side.x * across, 40 + Math.random() * 120, from.z + dir.z * along + side.z * across], i * 3);
      seed[i] = Math.random();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.sparks = new THREE.Points(sg, new THREE.ShaderMaterial({
      uniforms: { uAge: { value: 0 }, uStart: { value: travel } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uAge, uStart; varying float vA;
        void main() {
          float t = uAge - uStart * (0.4 + 0.6 * aSeed); // each lights up once the blast went by
          vec3 p = position + vec3(0.0, max(t, 0.0) * (60.0 + 80.0 * aSeed), 0.0);
          vA = t < 0.0 ? 0.0 : (1.0 - smoothstep(0.3, 0.9 + 0.3 * aSeed, t)) * (0.6 + 0.4 * sin(t * 30.0 + aSeed * 40.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (14.0 + 10.0 * aSeed) * 900.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float k = exp(-d * d * 6.0); gl_FragColor = vec4(vec3(1.0, 0.82, 0.45) * k * vA, 1.0); }`,
      ...additive,
    }));
    this.sparks.frustumCulled = false;
    this.root.add(this.band, this.flash, this.orb, this.sparks);
  }

  update(dt: number) {
    this.age += dt;
    const u = (this.band.material as THREE.ShaderMaterial).uniforms;
    u.uTime.value = this.age;
    const head = Math.min(1, this.age / this.travel);
    u.uHead.value = head * 1.05;
    u.uFade.value = Math.max(0, (this.age - this.travel - this.hold) / this.fade);
    // the mouth flash: bursts in 0.05s, gone by 0.35s
    const f = this.age / 0.35;
    this.flash.scale.setScalar(Math.min(1, this.age / 0.05) * (1 + 0.4 * f));
    uniformsOf(this.flash).uAlpha.value = Math.max(0, 1 - f);
    // the orb leads the blast, then flares out at its end
    this.orb.position.copy(this.from).addScaledVector(this.dir, this.length * head * 0.97).setY(this.from.y * 0.7);
    uniformsOf(this.orb).uAlpha.value = head < 1 ? 1 : Math.max(0, 1 - (this.age - this.travel) / 0.15);
    (this.sparks.material as THREE.ShaderMaterial).uniforms.uAge.value = this.age;
    return this.age < this.travel + this.hold + Math.max(this.fade, 1.3);
  }

  dispose() {
    this.root.removeFromParent();
    const light = this.band.children[0] as THREE.Mesh;
    for (const o of [this.band, light, this.flash, this.orb, this.sparks] as THREE.Mesh[]) (o.material as THREE.Material).dispose();
    for (const o of [this.band, this.flash, this.orb, this.sparks] as THREE.Mesh[]) o.geometry.dispose();
  }
}

const ZAP_POINTS = 12;

/** Gold lightning from where an enemy was knocked back from to where it is now (`to` is read live). */
export class Zap implements Fx {
  readonly root = new THREE.Group();
  private strands = [new Ribbon(ZAP_POINTS), new Ribbon(ZAP_POINTS)];
  private alpha = { value: 1 };
  private age = 0;
  private jitterIn = 0;
  private offsets = new Float32Array(ZAP_POINTS * 2);
  private at = new THREE.Vector3();
  private side = new THREE.Vector3();

  constructor(private from: THREE.Vector3, private to: THREE.Vector3, private life = 1) {
    this.from = from.clone();
    for (const s of this.strands) this.root.add(s.mesh(/* glsl */ `
      uniform float uAlpha; varying float vT; varying float vSide;
      void main() { float k = 1.0 - vSide * vSide; gl_FragColor = vec4(mix(vec3(1.0, 0.95, 0.7), vec3(1.0, 0.7, 0.2), abs(vSide)) * k * uAlpha * 1.6, 1.0); }`,
    { uAlpha: this.alpha }));
  }

  update(dt: number) {
    this.age += dt;
    if ((this.jitterIn -= dt) <= 0) { // the bolts re-strike every few frames
      this.jitterIn = 0.05;
      for (let i = 0; i < this.offsets.length; i++) this.offsets[i] = Math.random() * 2 - 1;
    }
    this.side.set(-(this.to.z - this.from.z), 0, this.to.x - this.from.x);
    if (this.side.lengthSq() < 1e-6) this.side.set(1, 0, 0);
    this.side.normalize();
    this.strands.forEach((s, k) => {
      for (let i = 0; i < ZAP_POINTS; i++) {
        const t = i / (ZAP_POINTS - 1);
        const amp = Math.sin(t * Math.PI) * 28; // pinned at both ends
        this.at.lerpVectors(this.from, this.to, t).setY(70);
        this.at.addScaledVector(this.side, this.offsets[k * ZAP_POINTS + i] * amp);
        s.set(i, this.at, this.side, k === 0 ? 7 : 4);
      }
      s.geo.attributes.position.needsUpdate = true;
    });
    this.alpha.value = Math.max(0, 1 - this.age / this.life) * (0.7 + 0.3 * Math.random());
    return this.age < this.life;
  }

  dispose() {
    this.root.removeFromParent();
    for (const s of this.strands) s.geo.dispose();
    for (const o of this.root.children as THREE.Mesh[]) (o.material as THREE.Material).dispose();
  }
}
