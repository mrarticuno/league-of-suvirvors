// Orianna. Numbers mirror League of Legends V26.21 (sources: the League wiki, the client's orianna.bin spell data and
// the skin bins). Mana costs and cooldowns are League's, unchanged.
// The Ball is part of Orianna's own mesh while she holds it (the BallDown/BallUpper joints, collapsed while it is away;
// League swaps to the OriannaNoBall model, the same body without it). Away from her it is the OriannaBall model resting
// on the ground, and the skin's Ghost particle meshes while it flies. It attaches back when she walks within 135 of it
// and snaps back to her (Z_Ball_Flash, 0.75s on Command: Shockwave) past the 1290 leash.
// Command: Protect only targets Orianna (there are no allies). Command: Dissonance and Command: Shockwave pressed while
// the Ball flies to a Command: Attack point are buffered and go off when it lands, like League.
// Not used: OrianaReturn's Ghost_mis_return (the Ball flying back from an ally), Q_Ghost_Bind (the Ball orbiting an ally),
// the *_ally/_red variants, and the emitterless E_cas/W_cas/ball_glow systems.
import * as THREE from 'three';
import { Actor, loadModel } from '../assets';
import { audio } from '../audio';
import type { ChampionDef, ChampionKit, Hit, SkillDef, SkillKey } from '../champion';
import { boundSize } from '../data';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';
import { facingQuat, type ParticleSystem } from '../particles';
import type { MissileFx } from '../vfx';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
const SCALE = 1.18; // League's SkinScale 1.3 against Ezreal's 1.1 (his model plays at 1)
const CENTER = 'C_BUFFBONE_GLB_CENTER_LOC';
const BALL_BONES = ['BallDown', 'BallUpper']; // roots of the Ball's joints in Orianna's skeleton
// The Ball's centre rides 130 above the ground (its flight systems carry the orb 130 up); the systems played on the Ball
// itself (Shockwave's orb and nova) are authored around that centre, Dissonance's 100 above the ground (its cogs at -100).
const BALL_HEIGHT = 130;
const W_HEIGHT = 100;

const BALL = {
  leash: 1290, pickup: 135, width: 160, flashLockout: 0.75,
  // the arrow over Orianna turns blue, yellow, then red nearing the leash; the wiki gives no distances: thirds of it
  near: 1290 * 0.6, far: 1290 * 0.8,
  maxHitFx: 30, // impact systems per cast on a crowd
};
const PASSIVE = { damage: [10, 50], apRatio: 0.15, stackMult: 0.15, maxStacks: 2, duration: 4 };

const SKILLS = {
  Q: {
    name: t('champion.orianna.Q'), desc: t('champion.orianna.Q.desc'), damageType: 'magic', maxRank: 5, anim: 'orianna_spell1_right', icon: `${ICON}/spell/OrianaIzunaCommand.png`,
    cooldown: [7, 6, 5, 4, 3], cost: [35, 35, 35, 35, 35],
    damage: [60, 90, 120, 150, 180], apRatio: 0.6, reduced: 0.7,
    range: 825, aim: 825, minTravel: 150, speed: 1400, radius: 175, castTime: 0.05,
  },
  W: {
    name: t('champion.orianna.W'), desc: t('champion.orianna.W.desc'), damageType: 'magic', maxRank: 5, anim: 'orianna_spell2', icon: `${ICON}/spell/OrianaDissonanceCommand.png`,
    cooldown: [7, 7, 7, 7, 7], cost: [60, 65, 70, 75, 80],
    damage: [70, 110, 150, 190, 230], apRatio: 0.85, speed: [0.2, 0.25, 0.3, 0.35, 0.4],
    extra: { label: t('champion.orianna.speed'), values: [0.2, 0.25, 0.3, 0.35, 0.4], percent: true },
    radius: 225, field: 3, decay: 2, aim: 'none', castTime: 0.05,
  },
  E: {
    name: t('champion.orianna.E'), desc: t('champion.orianna.E.desc'), damageType: 'magic', maxRank: 5, anim: 'orianna_spell3', icon: `${ICON}/spell/OrianaRedactCommand.png`,
    cooldown: [9, 9, 9, 9, 9], cost: [60, 60, 60, 60, 60],
    damage: [60, 90, 120, 150, 180], apRatio: 0.3, shield: [55, 90, 125, 160, 195], shieldApRatio: 0.45, duration: 2.5,
    resist: [6, 12, 18, 24, 30],
    extra: { label: t('champion.orianna.shield'), values: [55, 90, 125, 160, 195] },
    speed: 1850, aim: 'none', castTime: 0.05,
  },
  R: {
    name: t('champion.orianna.R'), desc: t('champion.orianna.R.desc'), damageType: 'magic', maxRank: 3, anim: 'orianna_spell4', icon: `${ICON}/spell/OrianaDetonateCommand.png`,
    cooldown: [110, 95, 80], cost: [100, 100, 100],
    damage: [225, 350, 475], apRatio: 1.1, radius: 415, stun: 0.75, pull: 325,
    aim: 'none', castTime: 0.5,
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

const HITS = {
  Q: { type: 'magic', source: 'ability', skill: 'Q' },
  W: { type: 'magic', source: 'ability', skill: 'W' },
  E: { type: 'magic', source: 'ability', skill: 'E' },
  R: { type: 'magic', source: 'ability', skill: 'R' },
} as const satisfies Record<string, Hit>;

// The ResourceResolver names these two systems only by hash (particleName Orianna_Base_R_VacuumIndicator and
// Orianna_Base_Z_Shockwave_nova).
const R_INDICATOR = '0x6c18c819';
const R_NOVA = '0xe54fb697';
const ARROWS = ['Orianna_Q_BallIndicatorNear', 'Orianna_Q_BallIndicatorMedium', 'Orianna_Q_BallIndicatorFar'] as const;

export const ORIANNA: ChampionDef = {
  id: 'orianna', name: t('champion.orianna.name'), model: 'orianna', icon: `${ICON}/champion/Orianna.png`,
  scale: SCALE,
  title: t('champion.orianna.title'), splash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Orianna_0.jpg',
  roles: ['mage', 'support'], difficulty: 7,
  itemPool: 'ap',
  // OP.GG mid 16.21: Luden's, Shadowflame, Rabadon's, Void Staff, Cryptbloom, Banshee's (Zhonya's has an active)
  build: ['6655', '4645', '3089', '3135', '3137', '3102'],
  base: {
    hp: 565, hpPerLevel: 110,
    hpRegen5: 7, hpRegen5PerLevel: 0.55,
    mana: 418, manaPerLevel: 25,
    manaRegen5: 8, manaRegen5PerLevel: 0.8,
    ad: 44, adPerLevel: 2.6,
    attackSpeed: 0.658, attackSpeedPerLevel: 0.035,
    attackRange: 525,
    moveSpeed: 325,
    critDamage: 1.75,
    windupPercent: 0.17544,
    missileSpeed: 1500,
    radius: 65,
    armor: 20, armorPerLevel: 4.2,
  },
  skills: SKILLS,
  passive: { name: t('champion.orianna.passive'), icon: `${ICON}/passive/OriannaPassive.png` },
  anims: {
    idle: 'orianna_idle1', run: 'orianna_run', death: 'orianna_death',
    attacks: ['orianna_attack1', 'orianna_attack2', 'orianna_attack3'], crit: 'orianna_crit',
  },
  vfx: { auto: 'Orianna_BA_Mis', crit: 'Orianna_BA_Mis', autoHit: 'Orianna_BA_tar', critHit: 'Orianna_Crit_tar' },
  kit: oriannaKit,
};

const lerpLevel = (level: number, [a, b]: readonly number[]) => a + ((b - a) * (Math.min(level, 18) - 1)) / 17;

type Mode = 'held' | 'ground' | 'attack' | 'protect';
/** The Ball's flight: Command: Attack to `to`, or Command: Protect homing on Orianna. */
interface Flight { fx: MissileFx; dir: THREE.Vector3; to: THREE.Vector3; travelled: number; rank: number; hit: Set<Enemy>; stop?: () => void }
interface Field { at: THREE.Vector3; until: number; rank: number; fx: THREE.Object3D; stop?: () => void }
/** A particle system turned every frame (the arrow toward the Ball, the leash arc). */
interface Pointer { key: string; group: THREE.Group; sys: ParticleSystem | null }

function oriannaKit(g: Game): ChampionKit {
  const near: Enemy[] = []; // own query array: hurtEnemy may run item effects that query too
  const tmp = new THREE.Vector3();
  const ball = new THREE.Vector3().copy(g.pos).setY(0); // ground point under the Ball
  let mode: Mode = 'held';
  let flight: Flight | null = null;
  let actor: Actor | null = null; // the resting Ball, null while held or flying (or its model still downloading)
  let ring: THREE.Object3D | null = null; // ground ring under the resting Ball
  let arrow: Pointer | null = null;
  let tether: Pointer | null = null;
  const fields: Field[] = [];
  let haste = 0, hasteUntil = 0; // Command: Dissonance's speed, fading over its last W.decay seconds
  const queued: { key: 'W' | 'R'; rank: number }[] = []; // pressed while the Ball flies to a Command: Attack point
  let shockwave: { at: number; rank: number } | null = null; // a buffered Command: Shockwave winding up
  let shieldFx: THREE.Object3D | null = null;
  let shieldUntil = 0;
  // Clockwork Winding
  let stacks = 0, stackTarget: Enemy | null = null, stackUntil = 0;
  let qHand = false; // Command: Attack alternates its two hand gestures

  loadModel('oriannaball', [], 'oriannaball').catch(() => {});

  const held = () => mode === 'held';
  const ballAt = () => (held() ? tmp.copy(g.pos).setY(0) : ball);
  const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
  const angleTo = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(to.x - from.x, to.z - from.z);

  const showBall = (on: boolean) => { for (const b of BALL_BONES) g.player.hideBone(b, !on); };

  // ---- the resting Ball ----
  const rest = () => {
    mode = 'ground';
    try { actor = new Actor('oriannaball', SCALE); } catch { actor = null; } // still downloading: the Ball works without it
    if (actor) {
      actor.root.position.copy(ball);
      actor.root.rotation.y = angleTo(g.pos, ball);
      actor.play('orianna_ball_idle1');
      g.scene.add(actor.root);
    }
    ring = g.vfx.attach('Orianna_Q_yomu_ring_green');
    ring.position.copy(ball);
    g.scene.add(ring);
  };
  const lift = () => { // the Ball leaves the ground (flies, or attaches to Orianna)
    actor?.dispose();
    actor = null;
    ring?.removeFromParent();
    ring = null;
  };
  const attach = () => {
    lift();
    mode = 'held';
    showBall(true);
    audio.play('orianna_ball_attach');
  };

  // ---- pointers ----
  const point = (p: Pointer | null, key: string | null, at: THREE.Vector3, facing: number): Pointer | null => {
    if (p && p.key !== key) { p.group.removeFromParent(); p = null; }
    if (!key) return null;
    if (!p) {
      const group = new THREE.Group();
      group.position.copy(at);
      g.scene.add(group);
      p = { key, group, sys: g.vfx.play(key, at, facingQuat(facing), { follow: group, killOnStop: true, bind: true }) };
    }
    p.group.position.copy(at);
    if (p.sys) facingQuat(facing, p.sys.quat);
    return p;
  };
  const updatePointers = () => {
    const away = !held();
    const at = flight ? flight.fx.root.position : ball; // where the Ball is now
    const d = away ? flat(g.pos, at) : 0;
    const band = d < BALL.near ? 0 : d < BALL.far ? 1 : 2;
    arrow = point(arrow, away && mode !== 'protect' ? ARROWS[band] : null, tmp.copy(g.pos).setY(0), angleTo(g.pos, at));
    // the leash arc, 1150 ahead of the resting Ball toward Orianna, while she is in the red band
    tether = point(tether, mode === 'ground' && band === 2 ? 'Orianna_P_tether_range_indicator' : null, ball, angleTo(ball, g.pos));
  };

  // ---- flights ----
  const fly = (key: string, rank: number, to: THREE.Vector3): Flight => {
    if (flight) { flight.fx.root.removeFromParent(); flight.stop?.(); }
    lift();
    showBall(false);
    const fx = g.vfx.missile(key);
    fx.root.position.copy(ballAt());
    g.scene.add(fx.root);
    const dir = tmp.copy(to).sub(fx.root.position).setY(0);
    if (dir.lengthSq() < 1) dir.set(Math.sin(g.facing), 0, Math.cos(g.facing));
    return { fx, dir: dir.normalize().clone(), to: to.clone().setY(0), travelled: 0, rank, hit: new Set() };
  };
  /** Damage to enemies the flying Ball passes through (once each). Returns how many it hit this step. */
  const sweep = (f: Flight, hit: (e: Enemy, first: boolean) => void) => {
    const at = f.fx.root.position;
    let n = 0;
    for (const e of g.enemiesNear(at, BALL.width / 2 + 120, near)) {
      if (e.deadFor >= 0 || f.hit.has(e) || flat(e.pos, at) > BALL.width / 2 + e.def.radius) continue;
      hit(e, f.hit.size === 0);
      f.hit.add(e);
      n++;
    }
    return n;
  };
  const attackHit = (f: Flight) => (e: Enemy, first: boolean) => {
    const Q = SKILLS.Q;
    const dmg = (Q.damage[f.rank] + Q.apRatio * g.ap) * (first ? 1 : Q.reduced);
    if (f.hit.size < BALL.maxHitFx) g.vfx.playAt('Orianna_Z_Izuna_tar', e.pos.clone().setY(0), 0, { size: boundSize(e) });
    g.hurtEnemy(e, dmg, HITS.Q);
  };
  const protectHit = (f: Flight) => (e: Enemy) => {
    const E = SKILLS.E;
    if (f.hit.size < BALL.maxHitFx) g.vfx.playAt('Orianna_Z_Redact_tar', e.pos.clone().setY(0), 0, { size: boundSize(e) });
    g.hurtEnemy(e, E.damage[f.rank] + E.apRatio * g.ap, HITS.E);
  };

  const land = (f: Flight) => {
    f.fx.root.removeFromParent();
    f.stop?.();
    flight = null;
    ball.copy(f.to);
    rest();
    // the arrival pulse hits the enemies the flight missed, at the reduced damage past the first
    const Q = SKILLS.Q;
    const hit = attackHit(f);
    for (const e of g.enemiesNear(ball, Q.radius, near)) {
      if (e.deadFor >= 0 || f.hit.has(e) || flat(e.pos, ball) > Q.radius + e.def.radius) continue;
      hit(e, f.hit.size === 0);
      f.hit.add(e);
    }
    g.vfx.playAt('Orianna_Z_Izuna_nova', ball, angleTo(g.pos, ball), { owner: actor?.root });
    audio.playAt('orianna_Q_land', ball, g.pos);
    for (const q of queued.splice(0)) q.key === 'W' ? dissonance(q.rank) : windShockwave(q.rank);
  };

  const updateFlight = (dt: number) => {
    const f = flight;
    if (!f) return;
    const root = f.fx.root;
    if (mode === 'attack') {
      const left = flat(root.position, f.to);
      const step = Math.min(left, SKILLS.Q.speed * dt);
      root.position.addScaledVector(f.dir, step);
      f.travelled += step;
      f.fx.update(dt, f.dir, f.travelled);
      if (sweep(f, attackHit(f))) audio.play('orianna_Q_hit');
      if (step >= left) land(f);
      return;
    }
    // Command: Protect homes on Orianna
    const to = tmp.copy(g.pos).setY(0).sub(root.position);
    const d = to.length();
    const step = SKILLS.E.speed * dt;
    if (d > step) {
      f.dir.copy(to).divideScalar(d);
      root.position.addScaledVector(f.dir, step);
      f.travelled += step;
      f.fx.update(dt, f.dir, f.travelled);
      if (sweep(f, protectHit(f))) audio.play('orianna_Q_hit');
      return;
    }
    root.removeFromParent();
    f.stop?.();
    flight = null;
    attach();
    shield(f.rank);
  };

  // ---- Command: Protect ----
  const shield = (rank: number) => {
    const E = SKILLS.E;
    g.addShield(E.shield[rank] + E.shieldApRatio * g.ap, E.duration);
    shieldFx?.removeFromParent();
    shieldFx = g.vfx.attach('Orianna_E_ProtectShield');
    g.scene.add(shieldFx);
    shieldUntil = g.time + E.duration;
    audio.play('orianna_E_shield');
  };
  const updateShield = () => {
    if (!shieldFx) return;
    if (g.time >= shieldUntil || g.shield <= 0) { shieldFx.removeFromParent(); shieldFx = null; return; }
    const bone = g.player.bone(CENTER);
    if (bone) bone.getWorldPosition(shieldFx.position);
    else shieldFx.position.copy(g.pos).setY(100);
  };

  // ---- Command: Dissonance ----
  const dissonance = (rank: number) => {
    const W = SKILLS.W;
    const at = ballAt().clone();
    // the field is a 3s buff in League: its particles without a lifetime last until it ends
    const field = g.vfx.attach('Orianna_W_Dissonance_ball_green', { duration: W.field });
    field.position.copy(at).setY(W_HEIGHT);
    g.scene.add(field);
    audio.playAt('orianna_W_hit', at, g.pos);
    const damage = W.damage[rank] + W.apRatio * g.ap;
    let fx = 0, any = false;
    for (const e of g.enemiesNear(at, W.radius, near)) {
      if (e.deadFor >= 0 || flat(e.pos, at) > W.radius + e.def.radius) continue;
      if (fx++ < BALL.maxHitFx) g.vfx.playAt('Orianna_W_Dissonance_tar', e.pos.clone().setY(0), 0, { size: boundSize(e) });
      g.hurtEnemy(e, damage, HITS.W);
      any = true;
    }
    if (any) audio.play('orianna_Q_hit');
    fields.push({ at, until: g.time + W.field, rank, fx: field, stop: audio.play('orianna_W_field') });
  };
  const updateFields = () => {
    const W = SKILLS.W;
    for (let i = fields.length - 1; i >= 0; i--) {
      const f = fields[i];
      if (g.time >= f.until) { f.stop?.(); f.fx.removeFromParent(); fields.splice(i, 1); continue; }
      const pct = W.speed[f.rank];
      // enemies inside are slowed, fading over 2s once they leave; Orianna inside is hasted the same way
      for (const e of g.enemiesNear(f.at, W.radius, near)) {
        if (e.deadFor < 0 && flat(e.pos, f.at) <= W.radius + e.def.radius) g.slow(e, pct, W.decay, true);
      }
      if (flat(g.pos, f.at) <= W.radius && pct >= hasteNow()) { haste = pct; hasteUntil = g.time + W.decay; }
    }
  };
  const hasteNow = () => (g.time < hasteUntil ? haste * Math.min(1, (hasteUntil - g.time) / SKILLS.W.decay) : 0);

  // ---- Command: Shockwave ----
  /** The Ball's centre: on Orianna, between its joints in her animation. */
  const ballCenter = (out: THREE.Vector3) => {
    if (!held()) return out.copy(ball).setY(BALL_HEIGHT);
    const a = g.player.bone(BALL_BONES[0]), b = g.player.bone(BALL_BONES[1]);
    if (!a || !b) return out.copy(g.pos).setY(BALL_HEIGHT);
    return a.getWorldPosition(out).add(b.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
  };
  // the floor rings (around Orianna when she holds the Ball, else the vacuum around the Ball) and the orb on the Ball
  const chargeFx = () => {
    if (held()) g.vfx.playAt('Orianna_R_VacuumIndicatorSelfRing', g.pos.clone().setY(0), g.facing);
    else g.vfx.playAt(R_INDICATOR, ball, angleTo(g.pos, ball));
    g.vfx.playAt('Orianna_R_VacuumIndicatorSelfNoRing', ballCenter(new THREE.Vector3()), angleTo(g.pos, ballAt()));
    audio.playAt('orianna_R_charge', ballAt(), g.pos);
  };
  /** A buffered Shockwave: the 0.5s windup starts once the Ball has landed. */
  const windShockwave = (rank: number) => {
    chargeFx();
    shockwave = { at: g.time + SKILLS.R.castTime, rank };
  };
  const detonate = (rank: number) => {
    const R = SKILLS.R;
    const at = ballAt().clone();
    g.vfx.playAt(R_NOVA, ballCenter(new THREE.Vector3()), angleTo(g.pos, at), { owner: held() ? g.player.root : actor?.root });
    audio.playAt('orianna_R_hit', at, g.pos);
    const damage = R.damage[rank] + R.apRatio * g.ap;
    let fx = 0;
    for (const e of g.enemiesNear(at, R.radius, near)) {
      if (e.deadFor >= 0 || flat(e.pos, at) > R.radius + e.def.radius) continue;
      if (fx++ < BALL.maxHitFx) g.vfx.playAt('Orianna_Z_Detonate_tar', e.pos.clone().setY(0), 0, { size: boundSize(e) });
      g.hurtEnemy(e, damage, HITS.R);
      if (e.deadFor >= 0) continue;
      // tossed a set distance toward the Ball: from the edge to the centre, from near the middle over it
      const pull = new THREE.Vector3(at.x - e.pos.x, 0, at.z - e.pos.z);
      if (pull.lengthSq() < 1) pull.set(Math.sin(g.facing), 0, Math.cos(g.facing));
      g.knockBack(e, pull.setLength(R.pull), R.stun);
    }
  };

  // ---- leash ----
  const updateLeash = () => {
    if (mode !== 'ground') return;
    const d = flat(g.pos, ball);
    if (d <= BALL.pickup + g.champ.base.radius) { attach(); return; }
    if (d <= BALL.leash) return;
    // too far: the Ball snaps back to Orianna
    attach();
    g.vfx.playAt('Orianna_Z_Ball_Flash', g.pos.clone().setY(0), g.facing);
    audio.play('orianna_ball_flash');
    g.cooldowns.R = Math.max(g.cooldowns.R, BALL.flashLockout);
  };

  return {
    hud: () => t('champion.orianna.hud', { stacks, max: PASSIVE.maxStacks }),

    stat(k) {
      if ((k === 'armor' || k === 'mr') && held() && g.ranks.E > 0) return SKILLS.E.resist[g.ranks.E - 1];
      return 0;
    },
    moveSpeedBonus: () => hasteNow(),

    // Command: Protect cannot start while the Ball flies to an Attack point, nor anything while it flies to Orianna
    canCast: (key) => mode !== 'protect' && !(key === 'E' && mode === 'attack'),

    castAnim(key) {
      if (key !== 'Q') return undefined;
      // two Command gestures, one per hand (Spell1 and Spell1B), taken in turn
      qHand = !qHand;
      return qHand ? 'orianna_spell1_right' : 'orianna_spell1_left';
    },

    castStart(key) {
      if (key === 'R' && mode !== 'attack') chargeFx();
    },

    cast(key, r, at) {
      if (key === 'Q') {
        const Q = SKILLS.Q;
        const off = tmp.copy(at).sub(g.pos).setY(0);
        let d = off.length();
        if (d < 1) { off.set(Math.sin(g.facing), 0, Math.cos(g.facing)); d = 1; }
        d = Math.min(Q.range, held() ? Math.max(Q.minTravel, d) : d);
        const to = g.pos.clone().setY(0).addScaledVector(off.normalize(), d);
        flight = fly('Orianna_Q_Ghost_mis', r, to);
        mode = 'attack';
        flight.stop = audio.play('orianna_Q_launch');
      } else if (key === 'W') {
        if (mode === 'attack') queued.push({ key: 'W', rank: r });
        else dissonance(r);
      } else if (key === 'E') {
        if (held()) { shield(r); return; }
        flight = fly('Orianna_Q_Ghost_mis_protect', r, g.pos);
        mode = 'protect';
        flight.stop = audio.play('orianna_E_launch');
      } else if (mode === 'attack') queued.push({ key: 'R', rank: r });
      else detonate(r);
    },

    onDamage(e, hit) {
      if (hit.source !== 'auto') return 0;
      // Clockwork Winding: +15% per stack on the same target (2 at most, 4s); a new target starts over
      if (e !== stackTarget || g.time >= stackUntil) stacks = 0;
      const bonus = (lerpLevel(g.level, PASSIVE.damage) + PASSIVE.apRatio * g.ap) * (1 + PASSIVE.stackMult * stacks);
      stackTarget = e;
      stacks = Math.min(PASSIVE.maxStacks, stacks + 1);
      stackUntil = g.time + PASSIVE.duration;
      return bonus;
    },

    update(dt) {
      if (g.time >= stackUntil) stacks = 0;
      if (stackTarget && stackTarget.deadFor >= 0) stackTarget = null;
      updateFlight(dt);
      updateLeash();
      updateFields();
      updateShield();
      updatePointers();
      if (shockwave && g.time >= shockwave.at) { const { rank } = shockwave; shockwave = null; detonate(rank); }
      actor?.update(dt);
    },

    dispose() {
      if (flight) { flight.fx.root.removeFromParent(); flight.stop?.(); }
      for (const f of fields) { f.stop?.(); f.fx.removeFromParent(); }
      lift();
      arrow?.group.removeFromParent();
      tether?.group.removeFromParent();
      shieldFx?.removeFromParent();
      showBall(true);
      flight = null;
      arrow = tether = null;
      shieldFx = null;
      fields.length = 0;
      queued.length = 0;
      shockwave = null;
    },
  };
}
