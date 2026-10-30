// Lux. Numbers mirror League of Legends (source: Meraki Analytics champion JSON and the skin bins).
// Illumination: every damaging ability marks the enemies it hits for 6s; Lux's next basic attack or Final Spark on a
// marked enemy consumes the mark for bonus magic damage (Final Spark then marks it again).
// Adapted for hordes: mana costs are lower (Q 40, W 40-60, E 50-70, R 80) and an illuminated enemy dying restores
// 10-30 mana (by level; 1s cooldown against minions and small monsters, elite and epic kills always restore), shown
// with the skin's otherwise unused Lux_globalhit_mana flash. Prismatic Barrier only shields Lux (there are no allies).
// Lucent Singularity's recast uses ChampionKit.recast: pressing E while it is on cooldown detonates the zone (on
// arrival when it is still flying).
import * as THREE from 'three';
import { audio } from '../audio';
import type { ChampionDef, ChampionKit, Hit, SkillDef, SkillKey } from '../champion';
import { boundSize } from '../data';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';
import { facingQuat } from '../particles';
import type { MissileFx } from '../vfx';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
const CENTER = 'C_BUFFBONE_GLB_CENTER_LOC';
const HEIGHT = 110; // missile height (Game.spawnMissile's default)
const SPARK = { casAhead: 110, beamAhead: 220 }; // Final Spark's visuals, units ahead of Lux
const BODY_HEIGHT = 95; // Prismatic Barrier's system is centred on the body (its ground glow sits 95 below)
// Lucent Singularity's area and blast are authored 100 above the ground (their ring and shockwave sit 100 below)
const ZONE_HEIGHT = 100;
const MARK_HEIGHT = 100; // Illumination's starburst shines on the body (at the feet the model hides it)

const PASSIVE = {
  duration: 6, damage: [30, 200], apRatio: 0.3, // damage by level
  manaRestore: [10, 30], manaCooldown: 1,
  maxMarkFx: 40, // particle budget: past it, enemies are still illuminated without their own mark
  renewFx: 1, // seconds between renewals of a mark's particles (its emitters last the 6s of one application)
  maxHitFx: 30, // impact systems per cast on a crowd
};

const SKILLS = {
  Q: {
    name: t('champion.lux.Q'), desc: t('champion.lux.Q.desc'), damageType: 'magic', maxRank: 5, anim: 'lux_spell1', icon: `${ICON}/spell/LuxLightBinding.png`,
    cooldown: [11, 10.5, 10, 9.5, 9], cost: [40, 40, 40, 40, 40],
    damage: [80, 120, 160, 200, 240], apRatio: 0.65, root: 2, targets: 2,
    range: 1175, aim: 1175, speed: 1200, width: 140, castTime: 0.25,
  },
  W: {
    name: t('champion.lux.W'), desc: t('champion.lux.W.desc'), damageType: 'magic', maxRank: 5, anim: 'lux_spell2', icon: `${ICON}/spell/LuxPrismaticWave.png`,
    cooldown: [14, 13, 12, 11, 10], cost: [40, 45, 50, 55, 60],
    damage: [0, 0, 0, 0, 0], shield: [40, 55, 70, 85, 100], shieldApRatio: 0.4, duration: 2.5,
    extra: { label: t('champion.lux.shield'), values: [40, 55, 70, 85, 100] },
    range: 1175, aim: 'move', speed: 2200, castTime: 0.25,
  },
  E: {
    name: t('champion.lux.E'), desc: t('champion.lux.E.desc'), damageType: 'magic', maxRank: 5, anim: 'lux_spell3', icon: `${ICON}/spell/LuxLightStrikeKugel.png`,
    cooldown: [10, 9.5, 9, 8.5, 8], cost: [50, 55, 60, 65, 70],
    damage: [65, 115, 165, 215, 265], apRatio: 0.8, slow: [0.25, 0.3, 0.35, 0.4, 0.45], linger: 1,
    range: 1100, aim: 1100, radius: 310, speed: 1200, life: 5, castTime: 0.25,
  },
  R: {
    name: t('champion.lux.R'), desc: t('champion.lux.R.desc'), damageType: 'magic', maxRank: 3, anim: 'lux_spell4', icon: `${ICON}/spell/LuxR.png`,
    cooldown: [60, 50, 40], cost: [80, 80, 80],
    damage: [300, 400, 500], apRatio: 1.2,
    range: 3340, aim: 3340, width: 190, castTime: 1,
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

const HITS = {
  Q: { type: 'magic', source: 'ability', skill: 'Q' },
  E: { type: 'magic', source: 'ability', skill: 'E' },
  R: { type: 'magic', source: 'ability', skill: 'R' },
} as const satisfies Record<string, Hit>;

export const LUX: ChampionDef = {
  id: 'lux', name: t('champion.lux.name'), model: 'lux', icon: `${ICON}/champion/Lux.png`,
  scale: 1.3, // the export stands ~134 tall, Ezreal ~185
  title: t('champion.lux.title'), splash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Lux_0.jpg',
  roles: ['mage', 'support'], difficulty: 5,
  itemPool: 'ap',
  // OP.GG mid 16.21: Luden's, Shadowflame, Rabadon's, Horizon Focus, Void Staff, Malignance (Zhonya's has an active)
  build: ['6655', '4645', '3089', '4628', '3135', '3118'],
  base: {
    hp: 580, hpPerLevel: 99,
    hpRegen5: 5.5, hpRegen5PerLevel: 0.55,
    mana: 480, manaPerLevel: 23.5,
    manaRegen5: 7, manaRegen5PerLevel: 0.8,
    ad: 54, adPerLevel: 3.3,
    attackSpeed: 0.669, attackSpeedPerLevel: 0.03,
    attackRange: 550,
    moveSpeed: 330,
    critDamage: 1.75,
    windupPercent: 0.3 / 1.6,
    missileSpeed: 1600,
    radius: 65,
    armor: 21, armorPerLevel: 5.2,
  },
  skills: SKILLS,
  passive: { name: t('champion.lux.passive'), icon: `${ICON}/passive/LuxIlluminatingFraulein.png` },
  anims: {
    idle: 'lux_idle1', run: 'lux_run', death: 'lux_death',
    attacks: ['lux_attack1', 'lux_attack2'], crit: 'lux_crit',
  },
  vfx: {
    auto: 'Lux_BA_mis', crit: 'Lux_BA_mis', autoHit: 'Lux_BA_tar', critHit: 'Lux_BA_tar_crit',
    death: [['Lux_Death_1', CENTER], ['Lux_Death_2', CENTER]],
  },
  // the skin's idleParticlesEffects: the glowing crystals of her staff
  idleVfx: [['Lux_I_weapon', 'BUFFBONE_CSTM_WEAPON_2'], ['Lux_I_weapon', 'BUFFBONE_CSTM_WEAPON_4']],
  animVfx: true, // Light Binding's cast flash (Lux_Q_cas) rides lux_spell1
  kit: luxKit,
};

const lerpLevel = (level: number, [a, b]: readonly number[]) => a + ((b - a) * (Math.min(level, 18) - 1)) / 17;

/** Illumination on one enemy. */
interface Mark { until: number; fx: THREE.Object3D | null; fxAt: number }
/** Prismatic Barrier's wand: flies out to its range, then homes back to Lux. */
interface Wand { fx: MissileFx; dir: THREE.Vector3; travelled: number; back: boolean; rank: number }
/** Lucent Singularity: flies to `at` (`fx` while flying), then stays as a slowing area until detonated. */
interface Zone {
  at: THREE.Vector3; dir: THREE.Vector3; left: number; travelled: number; fx: MissileFx | null;
  area: THREE.Object3D | null; rank: number; until: number; detonate: boolean;
}

function luxKit(g: Game): ChampionKit {
  const near: Enemy[] = []; // own query array: hurtEnemy may run item effects that query too
  const flat = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const marks = new Map<Enemy, Mark>();
  const wands: Wand[] = [];
  const beamDir = new THREE.Vector3(0, 0, 1);
  let zone: Zone | null = null;
  let shieldFx: THREE.Object3D | null = null;
  let shieldFxUntil = 0;
  let markFx = 0;
  let manaReady = 0;
  let detonated: Enemy | null = null; // enemy whose mark the current hit consumed (an illuminated kill)

  const toward = (point: THREE.Vector3) => {
    const dir = flat.copy(point).sub(g.pos).setY(0);
    if (dir.lengthSq() < 1) dir.set(Math.sin(g.facing), 0, Math.cos(g.facing));
    return dir.normalize();
  };
  const inReach = (e: Enemy, from: THREE.Vector3, r: number) => e.deadFor < 0 && e.pos.distanceTo(from) - e.def.radius <= r;
  const follow = (key: string, at: THREE.Vector3, height = 0) => {
    const o = g.vfx.attach(key);
    o.position.copy(at).setY(height);
    g.scene.add(o);
    return o;
  };
  const missile = (key: string, at: THREE.Vector3) => {
    const fx = g.vfx.missile(key);
    fx.root.position.copy(at).setY(HEIGHT);
    g.scene.add(fx.root);
    return fx;
  };

  // ---- Illumination ----
  const marked = (e: Enemy) => (marks.get(e)?.until ?? 0) > g.time;
  const dropFx = (m: Mark) => {
    if (!m.fx) return;
    m.fx.removeFromParent();
    m.fx = null;
    markFx--;
  };
  const illuminate = (e: Enemy) => {
    let m = marks.get(e);
    if (!m) marks.set(e, (m = { until: 0, fx: null, fxAt: 0 }));
    m.until = g.time + PASSIVE.duration;
    if (m.fx && g.time - m.fxAt < PASSIVE.renewFx) return;
    dropFx(m);
    if (markFx < PASSIVE.maxMarkFx) {
      m.fx = follow('Lux_P_debuff', e.pos, MARK_HEIGHT);
      m.fxAt = g.time;
      markFx++;
    }
  };
  /** Consumes `e`'s mark: the bonus damage of the hit consuming it. */
  const ignite = (e: Enemy) => {
    const m = marks.get(e)!;
    dropFx(m);
    marks.delete(e);
    detonated = e;
    g.vfx.hit('Lux_P_tar', e.pos, 0, { size: boundSize(e) });
    audio.play('lux_passive');
    return lerpLevel(g.level, PASSIVE.damage) + PASSIVE.apRatio * g.ap;
  };
  const restoreMana = (e: Enemy) => {
    const big = e.def.tier === 'elite' || e.def.tier === 'epic';
    if (!big && g.time < manaReady) return;
    if (!big) manaReady = g.time + PASSIVE.manaCooldown;
    g.mana = Math.min(g.maxMana, g.mana + lerpLevel(g.level, PASSIVE.manaRestore));
    const bone = g.player.bone(CENTER);
    if (bone) g.vfx.playOn('Lux_globalhit_mana', bone, g.facing, g.player.root);
  };

  // ---- Prismatic Barrier ----
  const shield = (rank: number) => {
    const W = SKILLS.W;
    g.addShield(W.shield[rank] + W.shieldApRatio * g.ap, W.duration);
    shieldFx?.removeFromParent(); // restart the bubble on the second shield
    shieldFx = follow('Lux_W_tar_shield', g.pos, BODY_HEIGHT);
    shieldFxUntil = g.time + W.duration;
    audio.play('lux_W_shield');
  };

  const updateWands = (dt: number) => {
    const W = SKILLS.W;
    for (let i = wands.length - 1; i >= 0; i--) {
      const w = wands[i];
      const root = w.fx.root;
      const step = W.speed * dt;
      if (!w.back) {
        root.position.addScaledVector(w.dir, step);
        w.travelled += step;
        w.fx.update(dt, w.dir, w.travelled);
        if (w.travelled < W.range) continue;
        root.removeFromParent();
        w.fx = missile('Lux_W_mis_return', root.position);
        w.back = true;
        continue;
      }
      const to = tmp.copy(g.pos).setY(HEIGHT).sub(root.position);
      const d = to.length();
      if (d > step && g.alive) {
        w.dir.copy(to).divideScalar(d);
        root.position.addScaledVector(w.dir, step);
        w.travelled += step;
        w.fx.update(dt, w.dir, w.travelled);
        continue;
      }
      root.removeFromParent();
      if (g.alive) shield(w.rank);
      wands.splice(i, 1);
    }
    if (shieldFx) {
      if (g.time >= shieldFxUntil || g.shield <= 0) { shieldFx.removeFromParent(); shieldFx = null; }
      else shieldFx.position.copy(g.pos).setY(BODY_HEIGHT);
    }
  };

  // ---- Lucent Singularity ----
  const land = (z: Zone) => {
    z.fx!.root.removeFromParent();
    z.fx = null;
    z.area = follow('Lux_E_tar_aoe_green', z.at, ZONE_HEIGHT);
    z.until = g.time + SKILLS.E.life;
    audio.playAt('lux_E_land', z.at, g.pos);
  };
  const detonate = (z: Zone) => {
    const E = SKILLS.E;
    z.area?.removeFromParent();
    z.fx?.root.removeFromParent();
    zone = null;
    g.vfx.playAt('Lux_E_tar_nova', z.at.clone().setY(ZONE_HEIGHT));
    audio.playAt('lux_E_hit', z.at, g.pos);
    const damage = E.damage[z.rank] + E.apRatio * g.ap;
    let fx = 0;
    for (const e of g.enemiesNear(z.at, E.radius, near)) {
      if (!inReach(e, z.at, E.radius)) continue;
      if (fx++ < PASSIVE.maxHitFx) g.vfx.hit('Lux_E_tar_hit', e.pos, 0, { size: boundSize(e) });
      g.hurtEnemy(e, damage, HITS.E);
      if (e.deadFor < 0) g.slow(e, E.slow[z.rank], E.linger);
    }
  };
  const updateZone = (dt: number) => {
    const z = zone;
    if (!z) return;
    const E = SKILLS.E;
    if (z.fx) {
      const step = Math.min(z.left, E.speed * dt);
      z.fx.root.position.addScaledVector(z.dir, step);
      z.left -= step;
      z.travelled += step;
      z.fx.update(dt, z.dir, z.travelled);
      if (z.left > 0) return;
      land(z);
    }
    // the slow lingers 1s after leaving the area
    for (const e of g.enemiesNear(z.at, E.radius, near)) if (inReach(e, z.at, E.radius)) g.slow(e, E.slow[z.rank], E.linger);
    if (z.detonate || g.time >= z.until) detonate(z);
  };

  // ---- Final Spark ----
  const finalSpark = (rank: number) => {
    const R = SKILLS.R;
    const from = tmp.copy(g.pos).setY(0);
    const mid = from.clone().addScaledVector(beamDir, R.range / 2);
    const damage = R.damage[rank] + R.apRatio * g.ap;
    let fx = 0;
    for (const e of g.enemiesNear(mid, R.range / 2, near)) {
      if (e.deadFor >= 0) continue;
      const along = Math.max(0, Math.min(R.range, (e.pos.x - from.x) * beamDir.x + (e.pos.z - from.z) * beamDir.z));
      const off = Math.hypot(e.pos.x - from.x - beamDir.x * along, e.pos.z - from.z - beamDir.z * along);
      if (off > R.width / 2 + e.def.radius) continue;
      if (fx++ < PASSIVE.maxHitFx) g.vfx.hit('Lux_R_tar', e.pos, 0, { size: boundSize(e) });
      g.hurtEnemy(e, damage, HITS.R);
    }
    audio.play('lux_R_beam');
    audio.playAt('lux_R_end', mid.addScaledVector(beamDir, R.range / 2), g.pos);
  };

  return {
    hud: () => t('champion.lux.hud', { n: marks.size }),

    castStart(key, point) {
      if (key !== 'R') return;
      beamDir.copy(toward(point));
      const facing = Math.atan2(beamDir.x, beamDir.z);
      const quat = facingQuat(facing);
      // the charge glow shines at the staff tip, in front of Lux (the staff bone swings behind her in lux_spell4)
      g.vfx.playAt('Lux_R_cas', g.pos.clone().addScaledVector(beamDir, SPARK.casAhead).setY(HEIGHT), facing);
      // the beam system holds its warning lines for the 1s channel and fires its core when the cast resolves
      // (a stun cancelling the channel leaves the effect playing: it ends by itself). Its beams start 150-240 units
      // behind the system: placed ahead of Lux so they leave from the staff.
      const from = g.pos.clone().addScaledVector(beamDir, SPARK.beamAhead).setY(HEIGHT);
      g.vfx.play('Lux_R_mis_beam', from, quat, { target: from.clone().addScaledVector(beamDir, SKILLS.R.range), targetQuat: quat });
    },

    cast(key, r, point) {
      if (key === 'Q') {
        const q = SKILLS.Q;
        let hits = 0;
        g.spawnMissile('Lux_Q_mis', g.pos, g.pos.clone().add(toward(point)), {
          speed: q.speed, range: q.range, radius: q.width / 2, damage: q.damage[r] + q.apRatio * g.ap, hit: HITS.Q, pierce: true,
          hitSound: 'lux_Q_hit',
          onHit: (e, m) => {
            if (hits >= q.targets) return;
            hits++;
            g.impact(e, m);
            if (e.deadFor < 0) {
              g.rootEnemy(e, q.root);
              g.vfx.playAt('Lux_Q_tar', e.pos.clone().setY(0), 0, { size: boundSize(e) });
            }
            if (hits >= q.targets) m.travelled = m.range; // the sphere stops on its second target
          },
        });
        audio.play('lux_Q_launch');
      } else if (key === 'W') {
        wands.push({ fx: missile('Lux_W_mis', g.pos), dir: toward(point).clone(), travelled: 0, back: false, rank: r });
        shield(r);
        audio.play('lux_W_launch');
      } else if (key === 'E') {
        const E = SKILLS.E;
        if (zone) detonate(zone); // a shorter cooldown than its life: the old one goes off
        const off = toward(point).clone().multiplyScalar(Math.min(E.range, Math.hypot(point.x - g.pos.x, point.z - g.pos.z)));
        zone = {
          at: g.pos.clone().add(off).setY(0), dir: toward(point).clone(), left: off.length(), travelled: 0,
          fx: missile('Lux_E_mis', g.pos), area: null, rank: r, until: 0, detonate: false,
        };
        audio.play('lux_E_launch');
      } else finalSpark(r);
    },

    recast(key) {
      if (key !== 'E' || !zone) return;
      if (zone.fx) zone.detonate = true; // still flying: goes off on arrival
      else detonate(zone);
    },

    onDamage(e, hit) {
      if (hit.source === 'item') return 0;
      detonated = null;
      const bonus = (hit.source === 'auto' || hit.skill === 'R') && marked(e) ? ignite(e) : 0;
      if (hit.source === 'ability') illuminate(e); // after the check: Final Spark detonates, then marks again
      return bonus;
    },

    onKill(e) {
      if (e === detonated || marked(e)) restoreMana(e);
    },

    update(dt) {
      updateWands(dt);
      updateZone(dt);
      for (const [e, m] of marks) {
        if (e.deadFor >= 0 || g.time >= m.until) {
          dropFx(m);
          marks.delete(e);
        } else m.fx?.position.copy(e.pos).setY(MARK_HEIGHT);
      }
    },

    dispose() {
      for (const m of marks.values()) dropFx(m);
      for (const w of wands) w.fx.root.removeFromParent();
      if (zone) { zone.fx?.root.removeFromParent(); zone.area?.removeFromParent(); }
      shieldFx?.removeFromParent();
      marks.clear();
      wands.length = 0;
      zone = null;
      shieldFx = null;
    },
  };
}
