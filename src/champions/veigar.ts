// Veigar. Numbers mirror League of Legends (source: the skin bin's SpellObjects, patch 16.21; the LoL wiki for radii).
// Phenomenal Evil Power: each stack is 1 AP, with no cap. Baleful Strike kills grant 1 stack (3 against large minions
// and monsters); in League any ability hitting an enemy champion grants 1 and a champion takedown 5: here elite and
// epic monsters stand in for champions. Dark Matter's cooldown is 8s x 0.9 per 50 stacks.
// Adapted for hordes: mana costs are lower (Q 25, W 45-65, E 55-75, R 80) and kills by Veigar's abilities restore
// 20-40 mana by level (1s cooldown against minions and small monsters, elite and epic kills always restore).
// Primordial Burst targets any enemy (League: champions only). Event Horizon's knockdown is a plain stun.
// Systems not played: Veigar_W_cas / Veigar_W_warning (their textures are gone from the client: the old Dark Matter),
// Veigar_R_Laugh (an empty buff timer of a voice line) and the _Red team variants (the player is the ally).
import * as THREE from 'three';
import { audio } from '../audio';
import type { ChampionDef, ChampionKit, Hit, SkillDef, SkillKey } from '../champion';
import { boundSize } from '../data';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';
import type { MissileFx } from '../vfx';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
const ROOT = 'root'; // Spell1/Spell4's events ride Root
const WEAPON = 'BUFFBONE_GLB_WEAPON_1';
const HAND = 'L_hand'; // Primordial Burst's missile start bone
const FPS = 30;

const PASSIVE = {
  qKill: 1, qKillLarge: 3, abilityHit: 1, takedown: 5, // stacks
  stacksPerW: 50, wCdr: 0.1, // Dark Matter: -10% cooldown (multiplicative) per 50 stacks
  manaRestore: [20, 40], manaCooldown: 1,
};

const SKILLS = {
  Q: {
    name: t('champion.veigar.Q'), desc: t('champion.veigar.Q.desc'), damageType: 'magic', maxRank: 5, anim: 'veigar_attack2', icon: `${ICON}/spell/VeigarBalefulStrike.png`,
    cooldown: [6, 5.5, 5, 4.5, 4], cost: [25, 25, 25, 25, 25],
    damage: [80, 120, 160, 200, 240], apRatio: [0.5, 0.55, 0.6, 0.65, 0.7], targets: 2,
    range: 990, aim: 990, speed: 2200, radius: 70, castTime: 0.25,
  },
  W: {
    name: t('champion.veigar.W'), desc: t('champion.veigar.W.desc'), damageType: 'magic', maxRank: 5, anim: 'veigar_spell2', icon: `${ICON}/spell/VeigarDarkMatter.png`,
    cooldown: [8, 8, 8, 8, 8], cost: [45, 50, 55, 60, 65],
    damage: [85, 140, 195, 250, 305], apRatio: [0.7, 0.8, 0.9, 1.0, 1.1],
    range: 950, aim: 950, radius: 240, delay: 1.2, castTime: 0.25, // the delay counts from the start of the cast
  },
  E: {
    name: t('champion.veigar.E'), desc: t('champion.veigar.E.desc'), damageType: 'magic', maxRank: 5, anim: 'veigar_spell3', icon: `${ICON}/spell/VeigarEventHorizon.png`,
    cooldown: [20, 18.5, 17, 15.5, 14], cost: [55, 60, 65, 70, 75],
    damage: [0, 0, 0, 0, 0], stun: [1.5, 1.75, 2, 2.25, 2.5],
    extra: { label: t('champion.veigar.stun'), values: [1.5, 1.75, 2, 2.25, 2.5] },
    range: 725, aim: 725, outer: 411, inner: 290, delay: 0.5, life: 3, lockout: 4.5, castTime: 0.25,
  },
  R: {
    name: t('champion.veigar.R'), desc: t('champion.veigar.R.desc'), damageType: 'magic', maxRank: 3, anim: 'veigar_attack2', icon: `${ICON}/spell/VeigarR.png`,
    cooldown: [120, 90, 60], cost: [80, 80, 80],
    damage: [175, 250, 325], apRatio: [0.65, 0.7, 0.75], executePerMissing: 1.5, maxExecute: 2,
    range: 650, aim: 650, speed: 500, accel: 4000, maxSpeed: 4000, castTime: 0.25,
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

const HITS = {
  Q: { type: 'magic', source: 'ability', skill: 'Q' },
  W: { type: 'magic', source: 'ability', skill: 'W' },
  R: { type: 'magic', source: 'ability', skill: 'R' },
} as const satisfies Record<string, Hit>;

export const VEIGAR: ChampionDef = {
  id: 'veigar', name: t('champion.veigar.name'), model: 'veigar', icon: `${ICON}/champion/Veigar.png`,
  scale: 1.85 / 1.1, // League's SkinScale against Ezreal's: the export stands ~117 tall, ~197 here (Ezreal ~185)
  title: t('champion.veigar.title'), splash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Veigar_0.jpg',
  roles: ['mage'], difficulty: 7,
  base: {
    hp: 580, hpPerLevel: 108,
    hpRegen5: 6.5, hpRegen5PerLevel: 0.6,
    mana: 490, manaPerLevel: 26,
    manaRegen5: 8, manaRegen5PerLevel: 0.8,
    ad: 52, adPerLevel: 2.7,
    attackSpeed: 0.625, attackSpeedPerLevel: 0.0224,
    attackRange: 550,
    moveSpeed: 340,
    critDamage: 1.75,
    windupPercent: 0.3 - 0.1090625, // attack cast time 0.3 plus the bin's mAttackDelayCastOffsetPercent
    missileSpeed: 1500,
    radius: 55,
    armor: 18, armorPerLevel: 5.2,
  },
  skills: SKILLS,
  passive: { name: t('champion.veigar.passive'), icon: `${ICON}/passive/VeigarEntropy.png` },
  // Crit, Spell1 and Spell4 all play veigar_attack2.anm (the animation graph's clips)
  anims: {
    idle: 'veigar_idle1', run: 'veigar_run', death: 'veigar_death',
    attacks: ['veigar_attack1', 'veigar_attack2'], crit: 'veigar_attack2',
  },
  vfx: {
    // VeigarCritAttack hits with the shared globalhit_physical_crit, which is not in Veigar's systems
    auto: 'Veigar_BA_mis', crit: 'Veigar_BA_mis', autoHit: 'Veigar_BA_tar', critHit: 'Veigar_BA_tar',
  },
  // the skin's idleParticlesEffects: the glow and arcs of his staff
  idleVfx: [['Veigar_Base_Idle_Staff', WEAPON]],
  // Attack1's flash and Dark Matter's hand flash (Veigar_W_cas_01). veigar_attack2.anm is shared by Attack2, Crit,
  // Spell1 and Spell4 with different events, so it is left out of events.json: the kit plays those.
  animVfx: true,
  kit: veigarKit,
};

const lerpLevel = (level: number, [a, b]: readonly number[]) => a + ((b - a) * (Math.min(level, 18) - 1)) / 17;
const rankOf = (v: number | readonly number[], r: number) => (typeof v === 'number' ? v : v[r]);

/** Event Horizon: warning, then a cage for its life whose edges stun each enemy once. */
interface Cage { at: THREE.Vector3; rank: number; erect: number; until: number; hit: Set<Enemy>; stop?: () => void }
/** Primordial Burst flying to its target (it accelerates, so the kit moves it). */
interface Burst { fx: MissileFx; pos: THREE.Vector3; dir: THREE.Vector3; speed: number; travelled: number; target: Enemy; rank: number; max: boolean }

function veigarKit(g: Game): ChampionKit {
  const near: Enemy[] = []; // own query array: hurtEnemy may run item effects that query too
  const flat = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let stacks = 0;
  let manaReady = 0;
  let attack2 = false; // the basic attack under way plays veigar_attack2 (its flash is the kit's)
  const later: { at: number; run: () => void }[] = [];
  const cages: Cage[] = [];
  const stunnedUntil = new Map<Enemy, number>(); // Event Horizon affects an enemy once every 4.5s
  const bursts: Burst[] = [];

  const after = (seconds: number, run: () => void) => later.push({ at: g.time + seconds, run });
  const toward = (point: THREE.Vector3) => {
    const dir = flat.copy(point).sub(g.pos).setY(0);
    if (dir.lengthSq() < 1) dir.set(Math.sin(g.facing), 0, Math.cos(g.facing));
    return dir.normalize();
  };
  /** `point` pulled back within `range` of Veigar, on the ground. */
  const within = (point: THREE.Vector3, range: number) => {
    const off = tmp.copy(point).sub(g.pos).setY(0);
    if (off.length() > range) off.setLength(range);
    return g.pos.clone().add(off).setY(0);
  };
  const inReach = (e: Enemy, from: THREE.Vector3, r: number) => e.deadFor < 0 && e.pos.distanceTo(from) - e.def.radius <= r;
  const targetFor = (point: THREE.Vector3, range: number) => {
    const at = g.enemyAt(point);
    if (at && inReach(at, g.pos, range)) return at;
    return g.nearestEnemy(point, 3000, (e) => inReach(e, g.pos, range));
  };
  const onBone = (key: string, bone: string) => {
    const b = g.player.bone(bone);
    if (b) g.vfx.playOn(key, b, g.facing, g.player.root);
  };
  const big = (e: Enemy) => e.def.tier === 'elite' || e.def.tier === 'epic'; // the champions of League's passive

  // ---- Phenomenal Evil Power ----
  const gain = (n: number) => { stacks += n; };
  const restoreMana = (e: Enemy) => {
    if (!big(e) && g.time < manaReady) return;
    if (!big(e)) manaReady = g.time + PASSIVE.manaCooldown;
    g.mana = Math.min(g.maxMana, g.mana + lerpLevel(g.level, PASSIVE.manaRestore));
  };

  // ---- Dark Matter ----
  const darkMatter = (at: THREE.Vector3, rank: number) => {
    const W = SKILLS.W;
    g.vfx.playAt('Veigar_W_aoe_explosion', at);
    audio.playAt('veigar_W_hit', at, g.pos);
    const damage = W.damage[rank] + rankOf(W.apRatio, rank) * g.ap;
    for (const e of g.enemiesNear(at, W.radius, near)) if (inReach(e, at, W.radius)) g.hurtEnemy(e, damage, HITS.W);
  };

  // ---- Event Horizon ----
  const updateCage = (c: Cage) => {
    const E = SKILLS.E;
    for (const e of g.enemiesNear(c.at, E.outer, near)) {
      if (e.deadFor >= 0 || c.hit.has(e)) continue;
      const d = Math.hypot(e.pos.x - c.at.x, e.pos.z - c.at.z);
      if (d - e.def.radius > E.outer || d + e.def.radius < E.inner) continue; // off the edge band
      c.hit.add(e);
      if ((stunnedUntil.get(e) ?? 0) > g.time) continue;
      stunnedUntil.set(e, g.time + E.lockout);
      g.stunEnemy(e, E.stun[c.rank]);
      if (big(e)) gain(PASSIVE.abilityHit); // stacks come without damage
    }
  };

  // ---- Primordial Burst ----
  const burstDamage = (e: Enemy, rank: number) => {
    const R = SKILLS.R;
    const missing = 1 - Math.max(0, e.hp) / e.maxHp;
    const mult = Math.min(R.maxExecute, 1 + R.executePerMissing * missing); // +1.5% per 1% missing, max at 66.7% missing
    return (R.damage[rank] + rankOf(R.apRatio, rank) * g.ap) * mult;
  };
  const updateBursts = (dt: number) => {
    const R = SKILLS.R;
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      const e = b.target;
      if (e.deadFor >= 0) { b.fx.root.removeFromParent(); bursts.splice(i, 1); continue; }
      b.speed = Math.min(R.maxSpeed, b.speed + R.accel * dt);
      b.dir.copy(e.pos).setY(b.pos.y).sub(b.pos).normalize();
      const step = b.speed * dt;
      b.pos.addScaledVector(b.dir, step);
      b.travelled += step;
      b.fx.root.position.copy(b.pos);
      b.fx.update(dt, b.dir, b.travelled);
      if (Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z) > e.def.radius) continue;
      b.fx.root.removeFromParent();
      bursts.splice(i, 1);
      g.vfx.hit(b.max ? 'Veigar_R_tar_max' : 'Veigar_R_tar', e.pos, Math.atan2(b.dir.x, b.dir.z), { size: boundSize(e) });
      audio.play('veigar_R_hit');
      g.hurtEnemy(e, burstDamage(e, b.rank), HITS.R);
    }
  };

  return {
    hud: () => t('champion.veigar.hud', { n: stacks }),
    gauge: () => ({ label: String(stacks), fill: (stacks % PASSIVE.stacksPerW) / PASSIVE.stacksPerW, ready: false, skill: 'W' }),
    stat: (k) => (k === 'ap' ? stacks : 0),
    cooldownBase: (key) => (key === 'W' ? SKILLS.W.cooldown[0] * (1 - PASSIVE.wCdr) ** Math.floor(stacks / PASSIVE.stacksPerW) : undefined),

    canCast(key) {
      if (key === 'R') return targetFor(g.pos, SKILLS.R.range) !== null;
      return true;
    },

    attackStart(_target, crit) {
      // League rolls Attack1 / Attack2 at 50% each (mAttackProbability); the crit is Attack2's clip
      attack2 = crit || Math.random() < 0.5;
      return { anim: attack2 ? 'veigar_attack2' : 'veigar_attack1', sound: crit ? 'veigar_crit' : attack2 ? 'veigar_auto2' : 'veigar_auto' };
    },

    basicAttack(_target, _damage, crit, bolt) {
      if (!bolt) {
        audio.play(crit ? 'veigar_crit_launch' : 'veigar_auto_launch');
        if (attack2 && !crit) onBone('Veigar_Base_BA_Cas', WEAPON); // Attack2's event (Crit has none)
      }
      return false; // the default missile
    },

    castStart(key, point) {
      if (key === 'W') {
        // the fall is timed from the cast's start and lands even if the cast is cut short, as in League
        const at = within(point, SKILLS.W.range);
        const rank = g.ranks.W - 1;
        g.vfx.playAt('Veigar_W_cas_green', at);
        after(SKILLS.W.delay, () => darkMatter(at, rank));
      } else if (key === 'R') {
        onBone('Veigar_R_Charge', ROOT);
        after(6 / FPS, () => onBone('Veigar_R_cas', ROOT)); // Spell4's events: Charge at frame 0, cas at frame 6
      }
    },

    cast(key, r, point) {
      if (key === 'Q') {
        const Q = SKILLS.Q;
        onBone('Veigar_Q_Cas', ROOT); // Spell1's event at frame 8 (the cast ends at frame 7.5)
        let hits = 0;
        g.spawnMissile('Veigar_Q_mis', g.pos, g.pos.clone().add(toward(point)), {
          speed: Q.speed, range: Q.range, radius: Q.radius, damage: Q.damage[r] + rankOf(Q.apRatio, r) * g.ap, hit: HITS.Q, pierce: true,
          hitFx: 'Veigar_Q_tar', hitSound: 'veigar_Q_hit',
          onHit: (e, m) => {
            if (hits >= Q.targets) return;
            hits++;
            g.impact(e, m);
            if (hits >= Q.targets) m.travelled = m.range; // the bolt stops on its second enemy
          },
        });
        audio.play('veigar_Q_launch');
      } else if (key === 'E') {
        const E = SKILLS.E;
        const at = within(point, E.range);
        g.vfx.playAt('Veigar_E_cas', at);
        g.vfx.playAt('Veigar_E_Warning_Green', at);
        cages.push({ at, rank: r, erect: g.time + E.delay, until: g.time + E.delay + E.life, hit: new Set() });
      } else if (key === 'R') {
        const R = SKILLS.R;
        const target = targetFor(point, R.range);
        if (!target) return;
        const max = target.hp / target.maxHp <= 1 - (R.maxExecute - 1) / R.executePerMissing; // full damage already
        const hand = g.player.bone(HAND);
        const pos = hand ? hand.getWorldPosition(new THREE.Vector3()) : g.pos.clone().setY(110);
        const fx = g.vfx.missile(max ? 'Veigar_R_mis_max' : 'Veigar_R_mis');
        fx.root.position.copy(pos);
        g.scene.add(fx.root);
        bursts.push({ fx, pos, dir: toward(target.pos).clone(), speed: R.speed, travelled: 0, target, rank: r, max });
        audio.play('veigar_R_launch');
      }
    },

    onDamage(e, hit) {
      if (hit.source === 'ability' && big(e)) gain(PASSIVE.abilityHit);
      return 0;
    },

    onKill(e, hit) {
      if (hit.source !== 'ability') return;
      restoreMana(e);
      if (big(e)) gain(PASSIVE.takedown);
      if (hit.skill === 'Q') {
        gain(e.def.radius >= 65 || big(e) ? PASSIVE.qKillLarge : PASSIVE.qKill); // large minions (siege, super) and monsters
        onBone('Veigar_Q_powerup', ROOT);
      }
    },

    update(dt) {
      for (let i = later.length - 1; i >= 0; i--) {
        if (g.time < later[i].at) continue;
        const { run } = later[i];
        later.splice(i, 1);
        run();
      }
      for (let i = cages.length - 1; i >= 0; i--) {
        const c = cages[i];
        if (g.time < c.erect) continue;
        if (!c.stop && g.time < c.until) {
          g.vfx.play('Veigar_E_cage_green', c.at, new THREE.Quaternion(), { duration: SKILLS.E.life, life: SKILLS.E.life });
          audio.playAt('veigar_E_cage', c.at, g.pos);
          c.stop = audio.playAt('veigar_E_loop', c.at, g.pos) ?? (() => {});
        }
        if (g.time >= c.until) {
          c.stop?.();
          cages.splice(i, 1);
        } else updateCage(c);
      }
      for (const [e, until] of stunnedUntil) if (e.deadFor >= 0 || g.time >= until) stunnedUntil.delete(e);
      updateBursts(dt);
    },

    dispose() {
      for (const c of cages) c.stop?.();
      for (const b of bursts) b.fx.root.removeFromParent();
      cages.length = 0;
      bursts.length = 0;
      later.length = 0;
      stunnedUntil.clear();
    },
  };
}
