// Aurelion Sol: today's model, VFX and sounds with the kit he had before his 2023 rework (Data Dragon 13.1.1),
// ultimate included (Voice of Light: a line of starfire that slows, knocking nearby enemies back to the Outer Limit).
// Stats are the 13.1.1 ones. The comets and Voice of Light's blast are drawn by aurelionsolFx.ts (gone from today's client).
// Adapted for hordes: each star hits an enemy once per pass over it; star kills restore a bit of
// mana (0.5s cooldown against minions and small monsters, always from elite and epic ones) because Celestial
// Expansion drains mana per second (6-10/s, no activation cost) and the old kit had no other mana source.
// Comet of Legend is a 3s flight high above the ground along the cast direction, ended by a move order (at Starsurge's speed, through walls and units, no attacks) on a 20-12s
// cooldown instead of a long locked line on 80-60s. Starsurge grows while Aurelion stays within 650 units and
// detonates past that or after 5s (full size only stops its growth); the bigger it got, the more it deals (+50%) and stuns (0.55-1.1s).
// It wears today's Singularity vortex, scaled to its radius.
import * as THREE from 'three';
import { audio } from '../audio';
import type { ChampionDef, ChampionKit, Hit, SkillDef, SkillKey } from '../champion';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';
import { Blast, Comet } from './aurelionsolFx';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
const OLD_ICON = 'https://ddragon.leagueoflegends.com/cdn/13.1.1/img'; // the pre-rework kit's icons
const HANDS = ['Star1', 'Star2']; // the bones of the stars he holds
// Starsurge wears today's Singularity vortex (E_AoE): its systems are authored for this radius, scaled to the star's
const VORTEX_RADIUS = 450;

const STARS = {
  count: 3, radius: 250, expandedRadius: 650,
  hitRadius: 150, // matches the comet's glow (its head flare is 150 across the radius)
  head: 62, tail: 560, tailWidth: 52, // comet head glow radius, tail length and half width at its root
  period: 6, expandedPeriod: 2, // seconds per revolution
  reach: 1400, // units per second the orbit widens and shrinks
  damage: [20, 120], apRatio: 0.25, expandedMult: 1.4, // base damage by level, Celestial Expansion multiplier
  passGap: 0.25, // seconds out of a star's contact that end its pass over an enemy (one hit per pass)
  manaRestore: [4, 12], manaCooldown: 0.5,
};

const SKILLS = {
  Q: {
    name: t('champion.aurelionsol.Q'), desc: t('champion.aurelionsol.Q.desc'), damageType: 'magic', maxRank: 5, anim: 'aurelionsol_spell3_new', icon: `${OLD_ICON}/spell/AurelionSolQ.png`,
    cooldown: [12, 11, 10, 9, 8], cost: [50, 55, 60, 65, 70],
    damage: [70, 110, 150, 190, 230], apRatio: 0.65, sizeBonus: 0.5, stun: [0.55, 1.1],
    speed: 600, leash: 650, life: 5, radius: [150, 450], grow: 120, // radius per second while near
    aim: 1075, castTime: 0.25,
  },
  W: {
    name: t('champion.aurelionsol.W'), desc: t('champion.aurelionsol.W.desc'), damageType: 'magic', maxRank: 5, anim: 'aurelionsol_passive', icon: `${OLD_ICON}/spell/AurelionSolW.png`,
    cooldown: [1.5, 1.5, 1.5, 1.5, 1.5], cost: [0, 0, 0, 0, 0],
    damage: [5, 10, 15, 20, 25], // added to each star hit (always, like the old passive rank bonus)
    drain: [6, 7, 8, 9, 10], // mana per second while expanded
    extra: { label: t('champion.aurelionsol.drain'), values: [6, 7, 8, 9, 10] },
    aim: 'none', castTime: 0.05,
  },
  E: {
    name: t('champion.aurelionsol.E'), desc: t('champion.aurelionsol.E.desc'), damageType: 'magic', maxRank: 5, anim: 'aurelionsol_spell2_takeoff', icon: `${OLD_ICON}/spell/AurelionSolE.png`,
    cooldown: [20, 18, 16, 14, 12], cost: [60, 60, 60, 60, 60],
    damage: [0, 0, 0, 0, 0], duration: 3,
    height: 150, rise: 600, // flight altitude and how fast he climbs to it or lands (units per second); he flies at Starsurge's speed
    aim: 'move', castTime: 0.05,
  },
  R: {
    name: t('champion.aurelionsol.R'), desc: t('champion.aurelionsol.R.desc'), damageType: 'magic', maxRank: 3, anim: 'aurelionsol_channel_windup', icon: `${OLD_ICON}/spell/AurelionSolR.png`,
    cooldown: [110, 90, 70], cost: [100, 100, 100],
    damage: [150, 250, 350], apRatio: 0.7, slow: [0.4, 0.5, 0.6], slowTime: 2,
    extra: { label: t('champion.aurelionsol.slow'), values: [0.4, 0.5, 0.6], percent: true },
    range: 1500, width: 120, // half width of the blast
    outer: 650, push: 0.4, // enemies hit closer than the Outer Limit are knocked back to it over 0.4s
    speed: 4500, // the blast runs out at its missile's speed
    aim: 1500, castTime: 0.35,
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

const HITS = {
  Q: { type: 'magic', source: 'ability', skill: 'Q' },
  R: { type: 'magic', source: 'ability', skill: 'R' },
  star: { type: 'magic', source: 'item' }, // continuous contact damage: triggers no ability items
} as const satisfies Record<string, Hit>;

export const AURELIONSOL: ChampionDef = {
  id: 'aurelionsol', name: t('champion.aurelionsol.name'), model: 'aurelionsol', icon: `${ICON}/champion/AurelionSol.png`,
  title: t('champion.aurelionsol.title'), splash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/AurelionSol_0.jpg',
  roles: ['mage'], difficulty: 7,
  scale: 0.85, // League's SkinScale for him (Ezreal's is 1.1)
  hide: ['AurelionSolFX'], // the body shell only AurelionSol_P_SkinOverride draws, with its galaxy and rim light
  conformPath: [['Neck1_Ground', 'Tail11']], // his tail snakes along the path he travelled
  opaque: ['AurelionSol_BodyLower'], // the tail: blue scales fading into black space; its texture alpha is not opacity
  base: {
    hp: 645, hpPerLevel: 106,
    hpRegen5: 7, hpRegen5PerLevel: 0.6,
    mana: 350, manaPerLevel: 50,
    manaRegen5: 6, manaRegen5PerLevel: 0.8,
    ad: 57, adPerLevel: 3.2,
    attackSpeed: 0.625, attackSpeedPerLevel: 0.0136,
    attackRange: 550,
    moveSpeed: 325,
    critDamage: 1.75,
    windupPercent: (7.75 / 30) * 0.625, // cast frame 7.75 at 30 fps over a 1.6s attack
    missileSpeed: 4000,
    radius: 65,
    armor: 19, armorPerLevel: 4.8,
  },
  skills: SKILLS,
  passive: { name: t('champion.aurelionsol.passive'), icon: `${OLD_ICON}/passive/AurelionSol_Passive.png` },
  anims: {
    idle: 'aurelionsol_idle1', run: 'aurelionsol_run', death: 'aurelionsol_death',
    attacks: ['aurelionsol_attack1', 'aurelionsol_attack2'], crit: 'aurelionsol_attack2',
  },
  // Run_Base is a SequencerClipData: one cycle is these four clips in a row
  sequences: { aurelionsol_run: ['aurelionsol_runb', 'aurelionsol_runc', 'aurelionsol_rund', 'aurelionsol_runa'] },
  vfx: {
    auto: 'AurelionSol_BA_Mis', crit: 'AurelionSol_BA_Mis', autoHit: 'AurelionSol_BA_tar', critHit: 'AurelionSol_BA_Crit_Tar',
    // the death clip's particle events: the body dissolves, the hand stars go out and crumble
    death: [
      ['AurelionSol_Death', 'C_Buffbone_Glb_Layout_Loc'],
      ['AurelionSol_Z_Death_Idle_Star', 'Star1'], ['AurelionSol_Z_Death_Idle_Star', 'Star2'],
      ['AurelionSol_Z_Death_Idle_Star', 'Star3'], ['AurelionSol_Z_Death_Idle_Star', 'Star4'],
      ['AurelionSol_Z_Death_Crumble_Star', 'Star1'], ['AurelionSol_Z_Death_Crumble_Star', 'Star2'],
    ],
  },
  // The skin's idleParticlesEffects: the galaxy and rim light over the body (the bin names a `spine` bone the rig lacks; the
  // shell rides the skeleton, so any bone does) and the stars in his hands, which in League every clip's particle events
  // relight (as clip events here they would go out 3 s into each clip; as idle systems they stay). Its body beams between
  // tail bones need a second bone and tiled beam UVs, which are not supported. The other clip events (the cast hands of
  // Q and R) play from castStart, so animVfx stays off.
  idleVfx: [['AurelionSol_P_SkinOverride', 'Root'], ['AurelionSol_Z_Idle_Star', 'Star1'], ['AurelionSol_Z_Idle_Star', 'Star2']],
  kit: aurelionSolKit,
};

const lerpLevel = (level: number, [a, b]: readonly number[]) => a + ((b - a) * (Math.min(level, 18) - 1)) / 17;

/** A Starsurge in flight: grows while Aurelion stays near, then detonates. */
interface Surge { pos: THREE.Vector3; dir: THREE.Vector3; rank: number; radius: number; age: number; vortex: THREE.Object3D; center: THREE.Object3D }

function aurelionSolKit(g: Game): ChampionKit {
  const near: Enemy[] = []; // own query array: hurtEnemy may run item effects that query too
  const flat = new THREE.Vector3();
  // the old kit's comets (today's client has only the hand stars, whose particle trail does not look like them)
  const stars = Array.from({ length: STARS.count }, () => new Comet(STARS.tail, STARS.tailWidth, STARS.head));
  for (const s of stars) g.scene.add(s.root);
  const starPos = stars.map(() => new THREE.Vector3());
  const blasts: Blast[] = [];
  const touching = stars.map(() => new Map<Enemy, number>()); // per star: enemy -> last run time in contact
  const surges: Surge[] = [];
  let angle = 0, orbit: number = STARS.radius;
  let expanded = false;
  let expandFx: THREE.Object3D | null = null;
  let flightUntil = -1;
  const flightDir = new THREE.Vector3(); // Comet of Legend keeps this course until a move order
  let flightFx: THREE.Object3D | null = null;
  let manaReady = 0;
  let lift = 0; // Comet of Legend's altitude
  let speedProbe = false; // moveSpeedBonus is reading his speed without itself

  const toward = (point: THREE.Vector3) => {
    const dir = flat.copy(point).sub(g.pos).setY(0);
    if (dir.lengthSq() < 1) dir.set(Math.sin(g.facing), 0, Math.cos(g.facing));
    return dir.normalize();
  };
  const inReach = (e: Enemy, from: THREE.Vector3, r: number) => e.deadFor < 0 && e.pos.distanceTo(from) - e.def.radius <= r;
  const flying = () => g.time < flightUntil;
  const follow = (key: string) => {
    const o = g.vfx.attach(key, { owner: g.player.root }); // W_Buff redraws his body glowing
    o.position.copy(g.pos);
    g.scene.add(o);
    return o;
  };

  const hands = (key: string) => {
    for (const b of HANDS) { const bone = g.player.bone(b); if (bone) g.vfx.playOn(key, bone, g.facing, g.player.root); }
  };

  const setExpanded = (on: boolean) => {
    if (expanded === on) return;
    expanded = on;
    expandFx?.removeFromParent();
    expandFx = on ? follow('AurelionSol_W_Buff') : null;
    if (!on) audio.play('aurelionsol_W_off');
  };

  /** Moves and sizes a Starsurge's visuals to its position and radius. */
  const place = (s: Surge) => {
    for (const o of [s.vortex, s.center]) { o.position.copy(s.pos); o.scale.setScalar(s.radius / VORTEX_RADIUS); }
  };

  const detonate = (s: Surge) => {
    const q = SKILLS.Q;
    const size = (s.radius - q.radius[0]) / (q.radius[1] - q.radius[0]); // 0..1
    const damage = (q.damage[s.rank] + q.apRatio * g.ap) * (1 + q.sizeBonus * size);
    const stun = q.stun[0] + (q.stun[1] - q.stun[0]) * size;
    // today's kit has no growing star: Falling Star's impact (not the Calamity one R uses) stands in
    g.vfx.playAt('AurelionSol_R_Tar_Shockwave', s.pos);
    g.vfx.playAt('AurelionSol_R_Impact', s.pos);
    audio.playAt('aurelionsol_Q_hit', s.pos, g.pos);
    for (const e of g.enemiesNear(s.pos, s.radius, near)) {
      if (!inReach(e, s.pos, s.radius)) continue;
      g.hurtEnemy(e, damage, HITS.Q);
      if (e.deadFor < 0) g.stunEnemy(e, stun);
    }
    s.vortex.removeFromParent();
    s.center.removeFromParent();
  };

  /** Voice of Light: a blast of starfire along `dir` from his mouth. */
  const voice = (dir: THREE.Vector3, rank: number) => {
    const R = SKILLS.R;
    const jaw = g.player.bone('Jaw');
    const from = jaw ? jaw.getWorldPosition(new THREE.Vector3()) : g.pos.clone().setY(150);
    const blast = new Blast(from, dir, R.range, R.width * 2, R.range / R.speed);
    g.scene.add(blast.root);
    blasts.push(blast);
    audio.play('aurelionsol_R_hit');
    const damage = R.damage[rank] + R.apRatio * g.ap;
    const mid = g.pos.clone().addScaledVector(dir, R.range / 2).setY(0);
    for (const e of g.enemiesNear(mid, R.range / 2 + R.width, near)) {
      if (e.deadFor >= 0) continue;
      const dx = e.pos.x - g.pos.x, dz = e.pos.z - g.pos.z;
      const along = dx * dir.x + dz * dir.z;
      if (along < -e.def.radius || along > R.range + e.def.radius) continue;
      if (Math.abs(dx * dir.z - dz * dir.x) > R.width + e.def.radius) continue;
      g.hurtEnemy(e, damage, HITS.R);
      if (e.deadFor >= 0) continue;
      g.slow(e, R.slow[rank], R.slowTime);
      const dist = Math.hypot(dx, dz);
      if (dist >= R.outer) continue;
      // pushed straight away from him (along the blast if right on top of him) out to the Outer Limit
      const away = dist > 1 ? new THREE.Vector3(dx / dist, 0, dz / dist) : dir.clone();
      g.knockBack(e, away.multiplyScalar(R.outer - dist), R.push);
    }
  };

  const restoreMana = (e: Enemy) => {
    const big = e.def.tier === 'elite' || e.def.tier === 'epic';
    if (!big && g.time < manaReady) return;
    if (!big) manaReady = g.time + STARS.manaCooldown;
    g.mana = Math.min(g.maxMana, g.mana + lerpLevel(g.level, STARS.manaRestore));
  };

  const starDamage = () => {
    const w = g.ranks.W > 0 ? SKILLS.W.damage[g.ranks.W - 1] : 0;
    return (lerpLevel(g.level, STARS.damage) + w + STARS.apRatio * g.ap) * (expanded ? STARS.expandedMult : 1);
  };

  return {
    hud: () => (expanded ? t('champion.aurelionsol.hud.on', { n: SKILLS.W.drain[Math.max(0, g.ranks.W - 1)] }) : t('champion.aurelionsol.hud.off')),

    ghost: flying,
    disarmed: flying,
    steer: () => (flying() ? flightDir : undefined),
    onMoveOrder() { if (flying()) flightUntil = g.time; }, // walking ends the flight
    moveSpeedBonus() {
      // the comet keeps pace with Starsurge: whatever his speed, it becomes the star's
      if (!flying() || speedProbe) return 0;
      speedProbe = true;
      const own = g.moveSpeed;
      speedProbe = false;
      return SKILLS.Q.speed / own - 1;
    },
    moveAnims: () => (flying() ? { idle: 'aurelionsol_dashing02', run: 'aurelionsol_dashing02' } : undefined),
    castTime: (key) => (key === 'R' && flying() ? 0.01 : undefined), // Voice of Light mid-flight does not stop the comet

    castStart(key) {
      // Singularity's cast hands on Q's clip
      if (key === 'Q') hands('AurelionSol_E_Cas_Hands');
    },

    cast(key, r, point) {
      if (key === 'Q') {
        const q = SKILLS.Q;
        const pos = g.pos.clone().setY(0);
        const vortex = g.vfx.attach('AurelionSol_E_AoE_ChildParticle', { bind: true });
        const center = g.vfx.attach('AurelionSol_E_ExecuteZone_ChildParticle', { bind: true }); // the golden star at its heart
        g.scene.add(vortex, center);
        const surge = { pos, dir: toward(point).clone(), rank: r, radius: q.radius[0], age: 0, vortex, center };
        place(surge);
        surges.push(surge);
        audio.play('aurelionsol_Q_launch');
      } else if (key === 'W') {
        setExpanded(!expanded);
      } else if (key === 'E') {
        flightUntil = g.time + SKILLS.E.duration;
        flightDir.copy(toward(point));
        flightFx?.removeFromParent();
        flightFx = follow('AurelionSol_W_FlightTarget');
      } else {
        voice(toward(point), r);
      }
    },

    onKill(e, hit) {
      if (hit === HITS.star) restoreMana(e);
    },

    update(dt) {
      // Celestial Expansion: drains mana every second, switches off when it runs dry
      if (expanded) {
        const drain = SKILLS.W.drain[Math.max(0, g.ranks.W - 1)] * dt;
        if (g.mana < drain) setExpanded(false);
        else g.mana -= drain;
      }
      if (flightFx) {
        if (flying()) flightFx.position.copy(g.pos);
        else { flightFx.removeFromParent(); flightFx = null; audio.play('aurelionsol_E_end'); }
      }
      expandFx?.position.copy(g.pos);
      const E = SKILLS.E;
      const high = flying() ? E.height : 0;
      lift += Math.sign(high - lift) * Math.min(Math.abs(high - lift), E.rise * dt);
      if (lift > 0) g.player.root.position.y = lift; // the Game set the root on the ground this frame
      if (flightFx) flightFx.position.y = lift;

      // Center of the Universe
      const target = expanded ? STARS.expandedRadius : STARS.radius;
      orbit += Math.sign(target - orbit) * Math.min(Math.abs(target - orbit), STARS.reach * dt);
      angle += ((Math.PI * 2) / (expanded ? STARS.expandedPeriod : STARS.period)) * dt;
      const alive = g.hp > 0;
      const damage = starDamage();
      for (let i = 0; i < stars.length; i++) {
        const a = angle + (i * Math.PI * 2) / stars.length;
        const s = starPos[i].set(g.pos.x + Math.sin(a) * orbit, 110, g.pos.z + Math.cos(a) * orbit);
        stars[i].visible = alive;
        if (!alive) continue;
        stars[i].update(s);
        const touch = touching[i];
        for (const e of g.enemiesNear(s, STARS.hitRadius, near)) {
          if (!inReach(e, s, STARS.hitRadius)) continue;
          const last = touch.get(e);
          touch.set(e, g.time);
          if (last === undefined) g.hurtEnemy(e, damage, HITS.star);
        }
        for (const [e, last] of touch) if (e.deadFor >= 0 || g.time - last > STARS.passGap) touch.delete(e);
      }

      // Starsurge
      const q = SKILLS.Q;
      for (let i = surges.length - 1; i >= 0; i--) {
        const s = surges[i];
        s.age += dt;
        s.pos.addScaledVector(s.dir, q.speed * dt);
        const close = Math.hypot(s.pos.x - g.pos.x, s.pos.z - g.pos.z) <= q.leash;
        if (close) s.radius = Math.min(q.radius[1], s.radius + q.grow * dt);
        place(s);
        if (close && s.age < q.life && alive) continue;
        detonate(s);
        surges.splice(i, 1);
      }

      for (let i = blasts.length - 1; i >= 0; i--) if (!blasts[i].update(dt)) { blasts[i].dispose(); blasts.splice(i, 1); }
    },

    dispose() {
      for (const s of stars) s.dispose();
      for (const b of blasts) b.dispose();
      blasts.length = 0;
      for (const s of surges) { s.vortex.removeFromParent(); s.center.removeFromParent(); }
      expandFx?.removeFromParent();
      flightFx?.removeFromParent();
      surges.length = 0;
      for (const t of touching) t.clear();
    },
  };
}
