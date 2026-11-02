// Aurelion Sol's pre-rework visuals, drawn procedurally: today's client no longer ships them (the orbiting comets of
// Center of the Universe and Voice of Light's blast). Matched by eye to 2022 gameplay footage: comets with a white-hot
// head and a long tail fading white -> pink -> violet along their path; Voice of Light a wide violet band of starfire with a
// pale core that runs out from his mouth, then frays into indigo smoke, with a white-violet flash at the mouth.
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

/** A camera-facing glow: white core into `color`, `radius` world units. */
function glow(color: THREE.Color, radius: number) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uRadius: { value: radius }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uRadius; varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = length(modelMatrix[0].xyz); // the object's scale
        mv.xy += position.xy * uRadius * 2.0 * s;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
      void main() {
        float d = length(vUv);
        if (d > 1.0) discard;
        float core = exp(-d * d * 22.0), halo = pow(1.0 - d, 2.2);
        gl_FragColor = vec4(mix(uColor * halo, vec3(1.0), core) * uAlpha, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
  mesh.frustumCulled = false;
  return mesh;
}

const TAIL_POINTS = 28;

/** One orbiting comet: a glowing head and a tail drawn along the path it really travelled (it trails behind when he walks). */
export class Comet {
  readonly root = new THREE.Group();
  private head = glow(new THREE.Color(1, 0.72, 0.92), 1);
  private flare = glow(new THREE.Color(0.75, 0.55, 1), 1);
  private path: THREE.Vector3[] = []; // newest first, world positions
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array(TAIL_POINTS * 2 * 3);
  private tmp = new THREE.Vector3();
  private side = new THREE.Vector3();

  /** `length` of the tail and `width` of its root, in world units. */
  constructor(private length: number, private width: number, headRadius: number) {
    (this.head.material as THREE.ShaderMaterial).uniforms.uRadius.value = headRadius;
    (this.flare.material as THREE.ShaderMaterial).uniforms.uRadius.value = headRadius * 2.4;
    (this.flare.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.35;
    const t = new Float32Array(TAIL_POINTS * 2), s = new Float32Array(TAIL_POINTS * 2), idx: number[] = [];
    for (let i = 0; i < TAIL_POINTS; i++) {
      t[i * 2] = t[i * 2 + 1] = i / (TAIL_POINTS - 1);
      s[i * 2] = -1; s[i * 2 + 1] = 1;
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    this.geo.setAttribute('aSide', new THREE.BufferAttribute(s, 1));
    this.geo.setIndex(idx);
    const tail = new THREE.Mesh(this.geo, new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute float aT; attribute float aSide; varying float vT; varying float vSide;
        void main() { vT = aT; vSide = aSide; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying float vT; varying float vSide;
        void main() {
          vec3 c = mix(vec3(1.0, 0.97, 0.95), vec3(1.0, 0.62, 0.85), smoothstep(0.0, 0.35, vT));
          c = mix(c, vec3(0.55, 0.38, 1.0), smoothstep(0.35, 0.9, vT));
          float across = 1.0 - vSide * vSide;
          float a = pow(1.0 - vT, 1.6) * across * (0.35 + 0.65 * exp(-vSide * vSide * 6.0));
          gl_FragColor = vec4(c * a, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    tail.frustumCulled = false;
    this.root.add(tail, this.flare, this.head);
  }

  /** Moves the head to `p` (world) and rebuilds the tail behind it. */
  update(p: THREE.Vector3) {
    this.head.position.copy(p);
    this.flare.position.copy(p);
    const path = this.path;
    if (!path.length || path[0].distanceToSquared(p) > 1) path.unshift(p.clone());
    // keep just over the tail's length of path
    let len = 0;
    for (let i = 1; i < path.length; i++) {
      len += path[i].distanceTo(path[i - 1]);
      if (len > this.length) { path.length = i + 1; break; }
    }
    // resample the path at even steps from the head
    const step = this.length / (TAIL_POINTS - 1);
    let seg = 0, along = 0; // walked: whole segments before `seg`, and into it
    for (let i = 0; i < TAIL_POINTS; i++) {
      const want = i * step;
      while (seg < path.length - 1 && along + path[seg].distanceTo(path[seg + 1]) < want) { along += path[seg].distanceTo(path[seg + 1]); seg++; }
      const a = path[seg], b = path[Math.min(seg + 1, path.length - 1)];
      const d = a.distanceTo(b);
      const at = this.tmp.copy(a);
      if (d > 0) at.lerp(b, Math.min(1, (want - along) / d));
      // across the path, flat to the ground; tapering to a point
      const prev = path[Math.max(seg - 1, 0)], next = path[Math.min(seg + 2, path.length - 1)];
      this.side.set(-(next.z - prev.z), 0, next.x - prev.x);
      if (this.side.lengthSq() < 1e-6) this.side.set(1, 0, 0);
      const w = this.width * Math.pow(1 - i / (TAIL_POINTS - 1), 0.6);
      this.side.setLength(w);
      this.pos.set([at.x - this.side.x, at.y, at.z - this.side.z, at.x + this.side.x, at.y, at.z + this.side.z], i * 6);
    }
    this.geo.attributes.position.needsUpdate = true;
  }

  set visible(v: boolean) { this.root.visible = v; if (!v) this.path.length = 0; }

  dispose() {
    this.root.removeFromParent();
    this.geo.dispose();
    for (const o of [this.head, this.flare]) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    ((this.root.children[0] as THREE.Mesh).material as THREE.Material).dispose();
  }
}

/** Voice of Light: the blast along `dir` from `from` (its mouth end), `length` x `width` world units. */
export class Blast {
  readonly root = new THREE.Group();
  private band: THREE.Mesh;
  private flash = glow(new THREE.Color(0.7, 0.45, 1), 1);
  private age = 0;

  constructor(from: THREE.Vector3, dir: THREE.Vector3, readonly length: number, width: number,
    private travel: number, private hold = 0.15, private fade = 0.55) {
    const geo = new THREE.PlaneGeometry(length, width * 2, 1, 1);
    geo.rotateX(-Math.PI / 2); // flat on the ground plane, length along +X
    geo.translate(length / 2, 0, 0);
    this.band = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { uHead: { value: 0 }, uFade: { value: 0 }, uTime: { value: 0 }, uSeed: { value: Math.random() * 50 }, uAspect: { value: length / (width * 2) } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: NOISE + /* glsl */ `
        uniform float uHead, uFade, uTime, uSeed, uAspect; varying vec2 vUv;
        void main() {
          float x = vUv.x, y = abs(vUv.y - 0.5) * 2.0; // along 0..1, across 0 (axis)..1 (edge)
          float spread = 0.55 + 0.45 * smoothstep(0.0, 0.35, x); // widens out of the mouth
          float n = fbm(vec2(x * uAspect * 1.6 - uTime * 3.0, vUv.y * 3.0) + uSeed);
          float wisp = fbm(vec2(x * uAspect * 0.7 - uTime * 1.2, vUv.y * 5.0) + uSeed * 1.7);
          float edge = y / spread + (n - 0.5) * 0.55;
          if (edge > 1.0) discard;
          float body = 1.0 - smoothstep(0.35, 1.0, edge);
          float core = exp(-edge * edge * 9.0);
          vec3 c = mix(vec3(0.28, 0.14, 0.65), vec3(0.62, 0.36, 1.0), body);
          c = mix(c, vec3(0.95, 0.88, 1.0), core * 0.85);
          float front = smoothstep(uHead, uHead - 0.06, x);
          float fray = smoothstep(uFade - 0.15, uFade + 0.25, wisp * 0.6 + n * 0.6 - 0.1 + (1.0 - edge) * 0.25);
          float a = body * front * (1.0 - uFade * 0.6) * mix(1.0, fray, step(0.001, uFade)) * (0.55 + 0.45 * wisp);
          a *= smoothstep(0.0, 0.03, x) * (1.0 - smoothstep(0.92, 1.0, x));
          gl_FragColor = vec4(c * a * 1.4, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.band.frustumCulled = false;
    this.band.position.set(from.x, 60, from.z);
    this.band.rotation.y = Math.atan2(-dir.z, dir.x);
    (this.flash.material as THREE.ShaderMaterial).uniforms.uRadius.value = width * 1.6;
    this.flash.position.copy(from);
    this.root.add(this.band, this.flash);
  }

  /** Advances the blast; false once it is gone. */
  update(dt: number) {
    this.age += dt;
    const u = (this.band.material as THREE.ShaderMaterial).uniforms;
    u.uTime.value = this.age;
    u.uHead.value = Math.min(1.06, this.age / this.travel);
    u.uFade.value = Math.max(0, (this.age - this.travel - this.hold) / this.fade);
    const f = this.age / 0.4; // the mouth flash: bursts in 0.06s, gone by 0.4s
    this.flash.scale.setScalar(Math.min(1, this.age / 0.06) * (1 + 0.3 * f));
    (this.flash.material as THREE.ShaderMaterial).uniforms.uAlpha.value = Math.max(0, 1 - f);
    return u.uFade.value < 1;
  }

  dispose() {
    this.root.removeFromParent();
    for (const o of [this.band, this.flash]) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
  }
}
