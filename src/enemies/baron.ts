// Baron Nashor final fight: every other enemy dies, spawns stop, and a closed arena forms around the champion and
// the Baron. Nearly every hit is lethal and every ability except the bite is telegraphed.
import * as THREE from 'three';
import { audio } from '../audio';
import { BARON } from '../data';
import type { Enemy, Game } from '../game';
import { circleGeo, coneGeo, lineGeo, spikeGeo } from '../hazards';
import type { EnemyAI } from './index';

const tentacleGeo = new THREE.CylinderGeometry(22, 22, 1, 8).rotateX(Math.PI / 2); // unit length along +Z for lookAt

export function startBaronFight(g: Game) {
  g.despawnAll(); // no XP: the Baron's arrival clears the map
  g.nextHordeAt = Infinity;
  const a = Math.random() * Math.PI * 2;
  const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  const center = g.pos.clone().addScaledVector(dir, BARON.spawnOffset / 2);
  const mesh = makeArena(BARON.arenaRadius);
  mesh.position.copy(center);
  g.scene.add(mesh);
  g.arena = { center, radius: BARON.arenaRadius, mesh };
  const baron = g.spawnEnemy('baron', g.pos.clone().addScaledVector(dir, BARON.spawnOffset));
  baron.attackTimer = 2; // grace period before the first ability
  baron.actor.play(baron.def.anims.idle);
}

export function baronAI(g: Game, e: Enemy): EnemyAI {
  let pull: THREE.Mesh | null = null; // tentacle dragging the champion back into the arena
  const dropPull = () => {
    pull?.removeFromParent();
    pull = null;
  };
  const radius = () => g.champ.base.radius;
  const playerWithin = (at: THREE.Vector3, r: number) => Math.hypot(g.pos.x - at.x, g.pos.z - at.z) <= r + radius();
  const inArena = (p: THREE.Vector3) => {
    if (!g.arena) return p;
    const off = p.clone().sub(g.arena.center);
    const max = g.arena.radius - 100;
    return off.length() > max ? g.arena.center.clone().addScaledVector(off.normalize(), max) : p;
  };

  /** Escaped (e.g. Arcane Shift over the wall): a tentacle drags the champion back in. */
  const updatePull = (dt: number) => {
    if (!g.arena) return;
    const off = g.pos.clone().sub(g.arena.center).setY(0);
    const dist = off.length();
    const inside = g.arena.radius - 350;
    if (!pull && dist > g.arena.radius && g.alive) {
      pull = new THREE.Mesh(tentacleGeo, new THREE.MeshBasicMaterial({ color: 0x5a2a7a }));
      audio.play('baron_pull');
      g.scene.add(pull);
    }
    if (!pull) return;
    if (dist > inside && g.alive) {
      g.stun(0.2, false); // keeps the champion locked while dragged
      g.pos.addScaledVector(off.normalize(), -Math.min(BARON.pullSpeed * dt, dist - inside));
      const from = e.pos.clone().setY(80), to = g.pos.clone().setY(80);
      pull.position.copy(from).lerp(to, 0.5);
      pull.scale.set(1, 1, from.distanceTo(to));
      pull.lookAt(to);
    } else dropPull();
  };

  /** Circles erupt around the champion: knock-up, stun and heavy (non-lethal) damage. */
  const knockup = () => {
    const k = BARON.knockup;
    audio.play('baron_knockup');
    let hit = false; // overlapping circles only hit once
    for (let i = 0; i < k.count; i++) {
      const a = Math.random() * Math.PI * 2, r = i === 0 ? 0 : k.spread * Math.sqrt(Math.random());
      const at = inArena(g.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)));
      g.hazards.telegraph(at, circleGeo, k.radius, 0, k.cast, 0x9a4dff, () => {
        g.hazards.spike(at, k.radius * 0.8, 220, 0xb070ff);
        audio.playAt('baron_knockup_hit', at, g.pos);
        if (hit || !playerWithin(at, k.radius)) return;
        hit = true;
        g.hurtPlayer(k.damage, true);
        g.stun(k.stun);
      });
    }
    return k.cast;
  };

  /** A tentacle bursts out of the ground where the champion stood. Lethal. */
  const tentacle = () => {
    const t = BARON.tentacle;
    const at = g.pos.clone();
    g.hazards.telegraph(at, circleGeo, t.radius, 0, t.cast, 0xff3050, () => {
      g.hazards.spike(at, t.radius * 0.6, 520, 0x5a2a7a);
      audio.play('baron_tentacle');
      if (playerWithin(at, t.radius)) g.hurtPlayer(BARON.lethal);
    });
    return t.cast;
  };

  /** Acid spit: the line shows the path during the cast, then a fast lethal skillshot flies along it. */
  const spit = () => {
    const s = BARON.spit;
    const dir = g.pos.clone().sub(e.pos).setY(0).normalize();
    audio.play('baron_spit');
    g.hazards.telegraph(e.pos, lineGeo, s.range, Math.atan2(dir.x, dir.z), s.cast, 0x60ff40, () => {
      audio.play('baron_spit_launch');
      g.spawnMissile(null, e.pos, e.pos.clone().add(dir), { speed: s.speed, range: s.range, radius: s.radius, damage: BARON.lethal });
    }, s.radius * 2);
    return s.cast;
  };

  /** Tentacle whip in a cone towards the champion: huge damage, never lethal. */
  const whip = () => {
    const w = BARON.whip;
    const facing = Math.atan2(g.pos.x - e.pos.x, g.pos.z - e.pos.z);
    g.hazards.telegraph(e.pos, coneGeo(w.arc), w.radius + e.def.radius, facing, w.cast, 0xff8030, () => {
      const d = g.pos.clone().sub(e.pos);
      const angle = Math.abs(Math.atan2(Math.sin(Math.atan2(d.x, d.z) - facing), Math.cos(Math.atan2(d.x, d.z) - facing)));
      if (d.length() <= w.radius + e.def.radius + radius() && angle <= w.arc / 2) g.hurtPlayer(w.damage * g.maxHp, true);
    });
    return w.cast;
  };

  const bite = () => {
    const b = BARON.bite;
    audio.play('baron_bite');
    // a 1-unit marker hidden under the Baron: the hazard queue is the timer, so stasis and death still disarm it
    g.hazards.telegraph(e.pos, circleGeo, 1, 0, b.cast, 0, () => {
      if (e.deadFor < 0 && e.pos.distanceTo(g.pos) - e.def.radius - radius() <= b.radius) g.hurtPlayer(BARON.lethal);
    });
    return b.cast;
  };

  return {
    update(dt) {
      updatePull(dt);
      e.attackTimer -= dt;
      e.actor.root.rotation.y = Math.atan2(g.pos.x - e.pos.x, g.pos.z - e.pos.z);
      if (e.attackTimer < BARON.gap - 0.6) e.actor.play(e.def.anims.idle, { fade: 0.3 });
      if (e.attackTimer > 0 || !g.alive || g.stasis > 0) return;
      const edge = e.pos.distanceTo(g.pos) - e.def.radius - radius();
      let cast: number;
      let anim: string;
      if (edge <= BARON.melee.range) {
        if (Math.random() < BARON.melee.biteChance) {
          // bite: no ground marker, but it lands with the clip and misses if the champion got away
          anim = BARON.anims.bite;
          cast = bite();
        } else {
          anim = BARON.anims.whip;
          cast = whip();
          audio.play('baron_whip');
        }
      } else {
        const pick = Math.floor(Math.random() * 3);
        anim = [BARON.anims.knockup, BARON.anims.tentacle, BARON.anims.spit][pick];
        cast = [knockup, tentacle, spit][pick]();
      }
      e.actor.play(anim, { loop: false, restart: true, fade: 0.1, duration: Math.min(e.actor.duration(anim), cast + 0.6) });
      e.attackTimer = cast + BARON.gap;
    },
    onDeath() {
      dropPull();
      g.win();
    },
    dispose: dropPull,
  };
}

/** Baron arena: a ring of tall void spikes on a glowing circle. */
function makeArena(radius: number) {
  const g = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.RingGeometry(radius - 30, radius + 30, 96).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x8a3cff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  floor.position.y = 3;
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 260, 96, 1, true).translate(0, 130, 0),
    new THREE.MeshBasicMaterial({ color: 0x6a2aaa, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
  );
  g.add(floor, wall);
  const spikeMat = new THREE.MeshBasicMaterial({ color: 0x2a1240 });
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const s = new THREE.Mesh(spikeGeo, spikeMat);
    s.scale.set(55, 260 + (i % 3) * 90, 55);
    s.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    g.add(s);
  }
  return g;
}
