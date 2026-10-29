// Samira. Numbers mirror League of Legends (source: Meraki Analytics champion JSON).
// Adapted: Style counts hits on any enemy (not only champions), Wild Rush dashes toward the cursor, Flair cast
// mid-dash fires normally (no explosives), the immobilized-target juggle is left out (enemies take no crowd control).
import * as THREE from 'three';
import { audio } from '../audio';
import type { ChampionDef, ChampionKit, Hit, SkillDef, SkillKey } from '../champion';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';
import { facingQuat } from '../particles';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
// systems the skin's ResourceResolver only names by hash (tools/build_vfx.py keys them as 0x...)
const FX = {
  autoMis: '0x82c9f04d', autoHit: '0xd8bd63c1', qMis: '0x240e498c', qHit: '0x2df965b3', qSlash: '0x7dcd3148',
  rReady: '0x9ee5eae3',
};
const GRADES = ['', 'E', 'D', 'C', 'B', 'A', 'S'];

const PASSIVE = {
  maxStyle: 6, duration: 6,
  msPerStack: [0.02, 0.025, 0.03, 0.035], msLevels: [1, 6, 11, 16],
  // blade: autos within meleeRange, W, E and Flair's slash deal bonus magic damage, up to doubled by missing health
  meleeRange: 200, bladeBase: [2, 19], bladeAdRatio: [0.035, 0.105],
};

const E_ATTACK_SPEED = [0.2, 0.25, 0.3, 0.35, 0.4]; // Wild Rush's attack speed buff per rank

const SKILLS = {
  Q: {
    name: t('champion.samira.Q'), desc: t('champion.samira.Q.desc'), damageType: 'physical', maxRank: 5, anim: 'spell1_gun', icon: `${ICON}/spell/SamiraQ.png`,
    cooldown: [6, 5, 4, 3, 2], cost: [30, 30, 30, 30, 30],
    damage: [0, 5, 10, 15, 20], adRatio: [0.95, 1.025, 1.1, 1.175, 1.25], critMultiplier: 1.25,
    range: 950, aim: 950, speed: 2600, width: 120, slashRange: 340, slashCone: 0, /* cos of the half angle: 180° in front */ slashFxOffset: 165, castTime: 0.25,
  },
  W: {
    name: t('champion.samira.W'), desc: t('champion.samira.W.desc'), damageType: 'physical', hits: 2, maxRank: 5, anim: 'spell2', icon: `${ICON}/spell/SamiraW.png`,
    cooldown: [30, 28, 26, 24, 22], cost: [60, 60, 60, 60, 60],
    damage: [20, 35, 50, 65, 80], bonusAdRatio: 0.6, radius: 325, duration: 0.75, castTime: 0.1, aim: 'none',
  },
  E: {
    name: t('champion.samira.E'), desc: t('champion.samira.E.desc'), damageType: 'magic', maxRank: 5, anim: 'spell3', icon: `${ICON}/spell/SamiraE.png`,
    cooldown: [20, 18, 16, 14, 12], cost: [40, 40, 40, 40, 40],
    damage: [50, 60, 70, 80, 90], bonusAdRatio: 0.2, attackSpeed: E_ATTACK_SPEED, buffDuration: 5,
    extra: { label: t('skillsel.bonusAs'), values: E_ATTACK_SPEED, percent: true },
    distance: 600, aim: 600, speed: 1600, width: 150, castTime: 0.05,
  },
  R: {
    name: t('champion.samira.R'), desc: t('champion.samira.R.desc'), damageType: 'physical', hits: 10, maxRank: 3, anim: 'spell4', icon: `${ICON}/spell/SamiraR.png`,
    cooldown: [0, 0, 0], cost: [0, 0, 0], // gated by Style S instead of a cooldown
    damage: [5, 15, 25], adRatio: 0.45, minionMultiplier: 0.25, shots: 10, interval: 0.2, range: 600,
    slow: 0.3, speed: 2800, maxMissilesPerShot: 8, castTime: 0.05, aim: 'none',
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

// Q, W and R are physical; E and the blade bonus are magic.
const HITS = {
  Q: { type: 'physical', source: 'ability', skill: 'Q' },
  QCrit: { type: 'physical', source: 'ability', skill: 'Q', crit: true },
  slash: { type: 'physical', source: 'ability', skill: 'Q' },
  slashCrit: { type: 'physical', source: 'ability', skill: 'Q', crit: true },
  W: { type: 'physical', source: 'ability', skill: 'W' },
  E: { type: 'magic', source: 'ability', skill: 'E' },
  R: { type: 'physical', source: 'ability', skill: 'R' },
  RCrit: { type: 'physical', source: 'ability', skill: 'R', crit: true },
} as const satisfies Record<string, Hit>;
const BLADE = new Set<Hit>([HITS.slash, HITS.slashCrit, HITS.W, HITS.E]);

export const SAMIRA: ChampionDef = {
  id: 'samira', name: t('champion.samira.name'), model: 'samira', icon: `${ICON}/champion/Samira.png`,
  title: t('champion.samira.title'), splash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Samira_0.jpg',
  roles: ['marksman', 'assassin'], difficulty: 6,
  hide: ['Pistol_Blur', 'Revolver_Blur', 'Coin'],
  textures: { Pistol: 'samira_weapons', Revolver: 'samira_weapons', Sword: 'samira_weapons' },
  base: {
    hp: 630, hpPerLevel: 108,
    hpRegen5: 3.25, hpRegen5PerLevel: 0.55,
    mana: 349, manaPerLevel: 38,
    manaRegen5: 8.2, manaRegen5PerLevel: 0.7,
    ad: 57, adPerLevel: 3,
    attackSpeed: 0.658, attackSpeedPerLevel: 0.033,
    attackRange: 500,
    moveSpeed: 335,
    critDamage: 1.75,
    windupPercent: 0.3 / 1.6,
    missileSpeed: 2800,
    radius: 65,
    armor: 26, armorPerLevel: 4.7,
  },
  skills: SKILLS,
  passive: { name: t('champion.samira.passive'), icon: `${ICON}/passive/SamiraP.png` },
  anims: {
    idle: 'idle_gun', run: 'run_gun', death: 'death',
    attacks: ['attack1_gun_start', 'attack2_gun_start'], crit: 'crit_gun_start',
  },
  vfx: { auto: FX.autoMis, crit: 'Samira_AA_mis_Crit', autoHit: FX.autoHit, critHit: 'Samira_AA_tar_Crit' },
  // Daredevil Impulse: autos on enemies within PASSIVE.meleeRange are blade slashes
  melee: {
    attacks: ['attack1_sword', 'attack2_sword'], crit: 'crit_sword',
    vfx: {
      swing: ['Samira_BA_Melee_One', 'Samira_BA_Melee_Two'], crit: 'Samira_BA_Melee_Crit_Swipe',
      hit: ['Samira_BA_Melee_One_Tar', 'Samira_BA_Melee_two_Tar'], critHit: 'Samira_BA_Melee_Crit_Tar',
    },
  },
  kit: samiraKit,
};

const lerpLevel = (level: number, [a, b]: readonly number[]) => a + ((b - a) * (Math.min(level, 18) - 1)) / 17;

function samiraKit(g: Game): ChampionKit {
  const near: Enemy[] = []; // own query array: hurtEnemy may run item effects that query too
  const flat = new THREE.Vector3();
  const zone = (key: string) => {
    const o = g.vfx.attach(key);
    o.position.copy(g.pos).setY(0);
    g.scene.add(o);
    return o;
  };

  // Daredevil Impulse: a hit of a different kind than the previous one grants a Style grade
  let style = 0, styleTimer = 0, last = '';
  // Blade Whirl spin, Wild Rush dash and its attack speed, Inferno Trigger channel
  let whirl: { t: number; rank: number; fx: THREE.Object3D } | null = null;
  let rush: { hit: Set<Enemy>; damage: number; fx: THREE.Object3D } | null = null;
  let rushAs = 0, rushTimer = 0;
  let inferno: { shots: number; next: number; rank: number } | null = null;
  let qBlade = false; // Flair's form, chosen when the cast starts (animation) and kept for its resolve
  let aura: THREE.Object3D | null = null; // Style S glow around Samira while the ultimate is ready

  const inMelee = (e: Enemy) => e.pos.distanceTo(g.pos) - e.def.radius - SAMIRA.base.radius <= PASSIVE.meleeRange;
  const bladeBonus = (e: Enemy) =>
    (lerpLevel(g.level, PASSIVE.bladeBase) + lerpLevel(g.level, PASSIVE.bladeAdRatio) * g.ad) * (2 - Math.max(0, e.hp) / e.maxHp);
  const styleMs = () => {
    let i = 0;
    while (i + 1 < PASSIVE.msLevels.length && g.level >= PASSIVE.msLevels[i + 1]) i++;
    return style * PASSIVE.msPerStack[i];
  };
  const crit = () => Math.random() < g.critChance;
  const toward = (point: THREE.Vector3) => {
    const dir = flat.copy(point).sub(g.pos).setY(0);
    if (dir.lengthSq() < 1) dir.set(Math.sin(g.facing), 0, Math.cos(g.facing));
    return dir.normalize();
  };
  const inCone = (e: Enemy, dir: THREE.Vector3) => {
    const dx = e.pos.x - g.pos.x, dz = e.pos.z - g.pos.z;
    const d = Math.hypot(dx, dz);
    return d - e.def.radius <= SKILLS.Q.slashRange && (d < 1 || (dx * dir.x + dz * dir.z) / d >= SKILLS.Q.slashCone);
  };
  const endAura = () => {
    aura?.removeFromParent();
    aura = null;
  };
  const slash = (rank: number) => {
    const w = SKILLS.W;
    g.vfx.playAt('Samira_W_CircleCut', g.pos.clone().setY(0), g.facing);
    audio.play('samira_W_hit');
    for (const e of g.enemiesNear(g.pos, w.radius, near)) {
      if (e.deadFor >= 0 || e.pos.distanceTo(g.pos) - e.def.radius > w.radius) continue;
      g.hurtEnemy(e, w.damage[rank] + w.bonusAdRatio * g.bonusAd, HITS.W);
    }
  };
  const endWhirl = () => {
    whirl?.fx.removeFromParent();
    whirl = null;
  };
  const endRush = () => {
    rush?.fx.removeFromParent();
    rush = null;
  };

  return {
    attackSpeedBonus: () => (rushTimer > 0 ? rushAs : 0),
    moveSpeedBonus: () => styleMs() - (inferno ? SKILLS.R.slow : 0),
    disarmed: () => whirl !== null || inferno !== null,
    meleeAuto: inMelee,
    canCast(key) {
      if (inferno) return key === 'E';
      if (key === 'Q') return !whirl;
      if (key === 'R') return style >= PASSIVE.maxStyle && g.nearestEnemy(g.pos, SKILLS.R.range) !== null;
      return true;
    },
    gauge: () => ({ label: GRADES[style] || '-', fill: style / PASSIVE.maxStyle, ready: style >= PASSIVE.maxStyle, skill: 'R' }),

    update(dt) {
      rushTimer -= dt;
      if (!inferno && (styleTimer -= dt) <= 0) style = 0;
      if (style < PASSIVE.maxStyle) endAura();
      else aura?.position.copy(g.pos).setY(0);

      if (whirl) {
        whirl.fx.position.copy(g.pos).setY(0);
        if (g.blockMissiles(g.pos, SKILLS.W.radius) > 0) {
          g.vfx.playAt('Samira_W_Missle_Block', g.pos.clone().setY(100));
          audio.play('samira_W_block');
        }
        if ((whirl.t -= dt) <= 0) {
          slash(whirl.rank);
          endWhirl();
        }
      }

      if (rush) {
        rush.fx.position.copy(g.pos).setY(0);
        const r = SKILLS.E.width / 2 + SAMIRA.base.radius;
        for (const e of g.enemiesNear(g.pos, r, near)) {
          if (e.deadFor >= 0 || rush.hit.has(e) || e.pos.distanceTo(g.pos) - e.def.radius > r) continue;
          rush.hit.add(e);
          g.vfx.hit('Samira_E_dash_hit', e.pos);
          audio.play('samira_E_hit');
          g.hurtEnemy(e, rush.damage, HITS.E);
        }
        if (!g.dashing) endRush();
      }

      if (inferno && (inferno.next -= dt) <= 0) {
        const R = SKILLS.R;
        inferno.next += R.interval;
        audio.play('samira_R_shot');
        let missiles = 0;
        for (const e of g.enemiesNear(g.pos, R.range, near)) {
          if (e.deadFor >= 0 || e.pos.distanceTo(g.pos) - e.def.radius > R.range) continue;
          const c = crit();
          const damage = (R.damage[inferno.rank] + R.adRatio * g.ad) * (c ? SAMIRA.base.critDamage + g.items.critDamage : 1)
            * (e.def.tier === 'minion' ? R.minionMultiplier : 1);
          const hit = c ? HITS.RCrit : HITS.R;
          // hordes: only the first few targets of a volley get a visible tracer, the rest are hit at once
          if (missiles++ < R.maxMissilesPerShot) {
            g.spawnMissile('Samira_R_mis', g.pos, e.pos, {
              speed: R.speed, range: 3000, radius: 10, damage, target: e, hit, hitFx: 'Samira_R_Tar', // one shot sound per volley
            });
          } else g.hurtEnemy(e, damage, hit);
        }
        if (--inferno.shots <= 0) {
          inferno = null;
          style = 0; // Style is spent at the end of the barrage
        }
      }
    },

    dispose() {
      endAura();
      endWhirl();
      endRush();
    },

    castAnim(key, point) {
      if (key !== 'Q') return undefined;
      const dir = toward(point);
      qBlade = g.nearestEnemy(g.pos, SKILLS.Q.slashRange, (e) => inCone(e, dir)) !== null;
      return qBlade ? 'spell1_sword' : undefined;
    },

    castStart(key) {
      if (key === 'R') g.vfx.playAt('Samira_R_Cas', g.pos.clone().setY(0), g.facing);
    },

    cast(key, r, point) {
      const dir = toward(point);

      if (key === 'Q') {
        const q = SKILLS.Q;
        const c = crit();
        const damage = (q.damage[r] + q.adRatio[r] * g.ad) * (c ? q.critMultiplier + g.items.critDamage : 1);
        if (qBlade) {
          // an enemy in front when the cast started: slash with the blade in a half circle instead of shooting.
          // The arc system is authored facing -Z with its tips ~slashFxOffset behind its origin: half turn, then
          // push it forward so the arc starts at Samira
          g.vfx.play(FX.qSlash, g.pos.clone().addScaledVector(dir, q.slashFxOffset).setY(0), facingQuat(Math.atan2(dir.x, dir.z) + Math.PI));
          audio.play('samira_Q_slash');
          for (const e of g.enemiesNear(g.pos, q.slashRange, near)) {
            if (e.deadFor >= 0 || !inCone(e, dir)) continue;
            g.vfx.hit('Samira_Q_Melee_Tar', e.pos);
            g.hurtEnemy(e, damage, c ? HITS.slashCrit : HITS.slash);
          }
        } else {
          g.spawnMissile(FX.qMis, g.pos, g.pos.clone().add(dir), {
            speed: q.speed, range: q.range, radius: q.width / 2, damage, hit: c ? HITS.QCrit : HITS.Q,
            hitFx: FX.qHit, hitSound: 'samira_Q_hit',
          });
        }
      } else if (key === 'W') {
        endWhirl();
        whirl = { t: SKILLS.W.duration, rank: r, fx: zone('Samira_W_Zone') };
        slash(r);
      } else if (key === 'E') {
        const e = SKILLS.E;
        endRush();
        rush = { hit: new Set(), damage: e.damage[r] + e.bonusAdRatio * g.bonusAd, fx: zone('Samira_E_DashTrail') };
        rushAs = e.attackSpeed[r];
        rushTimer = e.buffDuration;
        g.dash(dir, e.distance, e.speed);
      } else {
        endWhirl(); // Inferno Trigger ends Blade Whirl early
        inferno = { shots: SKILLS.R.shots, next: 0, rank: r };
      }
    },

    onDamage(e, hit) {
      if (hit.source === 'item') return 0; // item burns neither grant Style nor use the blade
      const melee = hit.source === 'auto' && inMelee(e);
      const kind = melee ? 'blade' : hit.source === 'auto' ? 'gun' : hit.skill!;
      if (kind !== last) {
        last = kind;
        if (style < PASSIVE.maxStyle && ++style === PASSIVE.maxStyle) {
          aura = g.vfx.attach(FX.rReady);
          aura.position.copy(g.pos).setY(0);
          g.scene.add(aura);
          audio.play('samira_R_ready');
        } else if (style < PASSIVE.maxStyle) audio.play('samira_style');
      }
      styleTimer = PASSIVE.duration;
      return melee || BLADE.has(hit) ? bladeBonus(e) : 0;
    },
  };
}
