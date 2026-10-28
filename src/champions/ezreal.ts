// Ezreal. Numbers mirror League of Legends (source: Meraki Analytics champion JSON).
import * as THREE from 'three';
import { audio } from '../audio';
import { SKILL_KEYS, type ChampionDef, type ChampionKit, type Hit, type SkillDef, type SkillKey } from '../champion';
import type { Enemy, Game } from '../game';
import { facingQuat } from '../particles';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
const PASSIVE = { asPerStack: 0.10, maxStacks: 5, duration: 6 };

const SKILLS = {
  Q: {
    name: 'Mystic Shot', maxRank: 5, anim: 'ezreal_spell1', icon: `${ICON}/spell/EzrealQ.png`,
    cooldown: [5.5, 5.25, 5, 4.75, 4.5], cost: [28, 31, 34, 37, 40],
    damage: [20, 45, 70, 95, 120], adRatio: 1.3,
    range: 1200, aim: 1200, speed: 2000, width: 120, castTime: 0.25, cdRefundOnHit: 1.5,
  },
  W: {
    name: 'Essence Flux', maxRank: 5, anim: 'ezreal_spell2', icon: `${ICON}/spell/EzrealW.png`,
    cooldown: [8, 8, 8, 8, 8], cost: [50, 50, 50, 50, 50],
    damage: [80, 135, 190, 245, 300], bonusAdRatio: 1.0,
    range: 1200, aim: 1200, speed: 1700, width: 160, castTime: 0.25, markDuration: 4, manaRestore: 60,
  },
  E: {
    name: 'Arcane Shift', maxRank: 5, anim: 'ezreal_spell3_generic', icon: `${ICON}/spell/EzrealE.png`,
    cooldown: [26, 23, 20, 17, 14], cost: [70, 70, 70, 70, 70],
    damage: [80, 130, 180, 230, 280], bonusAdRatio: 0.5,
    aim: 'move', blinkRange: 475, boltRange: 750, speed: 2000, castTime: 0.25,
  },
  R: {
    name: 'Trueshot Barrage', maxRank: 3, anim: 'ezreal_spell4', icon: `${ICON}/spell/EzrealR.png`,
    cooldown: [120, 105, 90], cost: [100, 100, 100],
    damage: [350, 550, 750], bonusAdRatio: 1.0,
    range: 6000, aim: 2500, speed: 2000, width: 320, castTime: 1, nonEpicMultiplier: 0.5,
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

// Ezreal's autos and Q are physical; W, E and R are magic. Mystic Shot applies on-hit effects.
const HITS: Record<SkillKey, Hit> = {
  Q: { type: 'physical', source: 'ability', skill: 'Q', onHit: true },
  W: { type: 'magic', source: 'ability', skill: 'W' },
  E: { type: 'magic', source: 'ability', skill: 'E' },
  R: { type: 'magic', source: 'ability', skill: 'R' },
};
const CAST_VFX: Partial<Record<SkillKey, string[]>> = { Q: ['Ezreal_Q_bow01'], W: ['Ezreal_W_Cas'], R: ['Ezreal_R_bow_01', 'Ezreal_R_Gauntlet_Glow'] };

export const EZREAL: ChampionDef = {
  id: 'ezreal', name: 'Ezreal', model: 'ezreal',
  base: {
    hp: 600, hpPerLevel: 102,
    hpRegen5: 4, hpRegen5PerLevel: 0.65,
    mana: 375, manaPerLevel: 70,
    manaRegen5: 8.5, manaRegen5PerLevel: 1,
    ad: 60, adPerLevel: 2.75,
    attackSpeed: 0.625, attackSpeedPerLevel: 0.025, // +2.5% bonus AS per level
    attackRange: 550,
    moveSpeed: 325,
    critDamage: 1.75,
    windupPercent: 0.3 / 1.6,
    missileSpeed: 2000,
    radius: 65,
    armor: 24, armorPerLevel: 4.2,
  },
  skills: SKILLS,
  passive: { name: 'Rising Spell Force', icon: `${ICON}/passive/Ezreal_RisingSpellForce.png` },
  anims: {
    idle: 'ezreal_idle', run: 'ezreal_run', death: 'ezreal_death',
    attacks: ['ezreal_attack1', 'ezreal_attack2', 'ezreal_attack3', 'ezreal_attack4'], crit: 'ezreal_crit',
  },
  vfx: { auto: 'Ezreal_BA_mis', crit: 'Ezreal_BA_crit_mis', autoHit: 'Ezreal_BA_tar', critHit: 'Ezreal_BA_crit_tar' },
  kit: ezrealKit,
};

function ezrealKit(g: Game): ChampionKit {
  // Rising Spell Force: ability hits grant attack speed stacks
  let stacks = 0, stackTimer = 0;
  const stack = () => {
    stacks = Math.min(PASSIVE.maxStacks, stacks + 1);
    stackTimer = PASSIVE.duration;
  };
  // Essence Flux marks, detonated by the next auto or ability hit
  const marks = new Map<Enemy, { until: number; mesh: THREE.Object3D }>();
  const marked = (e: Enemy) => (marks.get(e)?.until ?? 0) > g.time;
  const unmark = (e: Enemy) => {
    marks.get(e)?.mesh.removeFromParent();
    marks.delete(e);
  };

  return {
    attackSpeedBonus: () => stacks * PASSIVE.asPerStack,
    hud: () => `Passiva ${stacks}/${PASSIVE.maxStacks}`,

    update(dt) {
      if ((stackTimer -= dt) <= 0) stacks = 0;
      for (const [e, m] of marks) {
        if (m.until <= g.time || e.deadFor >= 0) unmark(e);
        else m.mesh.position.set(e.pos.x, 40 + e.def.radius * 2.5, e.pos.z);
      }
    },

    dispose() { for (const e of [...marks.keys()]) unmark(e); },

    castStart(key) {
      for (const k of CAST_VFX[key] ?? []) {
        // bow effects sit on the gauntlet hand in League; the R ones carry their own heights
        const p = key === 'R' ? g.pos.clone().setY(0)
          : g.pos.clone().add(new THREE.Vector3(Math.sin(g.facing) * 50, 110, Math.cos(g.facing) * 50));
        g.vfx.playAt(k, p, g.facing);
      }
    },

    cast(key, r, point) {
      if (key === 'Q') {
        const q = SKILLS.Q;
        g.spawnMissile('Ezreal_Q_mis', g.pos, point, {
          speed: q.speed, range: q.range, radius: q.width / 2, damage: q.damage[r] + q.adRatio * g.ad, hit: HITS.Q,
          hitFx: 'Ezreal_Q_tar', hitSound: 'ezreal_Q_hit',
          onHit: (e, m) => {
            g.impact(e, m);
            for (const k of SKILL_KEYS) g.cooldowns[k] = Math.max(0, g.cooldowns[k] - q.cdRefundOnHit);
          },
        });
      } else if (key === 'W') {
        const w = SKILLS.W;
        g.spawnMissile('Ezreal_W_mis', g.pos, point, {
          speed: w.speed, range: w.range, radius: w.width / 2, damage: 0, hit: HITS.W,
          onHit: (e, m) => {
            const until = g.time + w.markDuration;
            const mark = marks.get(e);
            if (mark) mark.until = until;
            else {
              const mesh = g.vfx.attach('Ezreal_W_tar');
              g.scene.add(mesh);
              marks.set(e, { until, mesh });
            }
            g.vfx.hit('Ezreal_W_hit', m.pos);
            audio.play('ezreal_W_hit');
            stack();
          },
        });
      } else if (key === 'E') {
        const e = SKILLS.E;
        const dir = point.clone().sub(g.pos).setY(0);
        const dist = Math.min(dir.length(), e.blinkRange);
        const from = g.pos.clone();
        if (dist > 0) g.pos.addScaledVector(dir.normalize(), dist);
        g.collidePlayer(); // the blink can land inside an obstacle
        const q = facingQuat(Math.atan2(g.pos.x - from.x, g.pos.z - from.z));
        g.vfx.play('Ezreal_E_cas', from.setY(0), q);
        g.vfx.play('Ezreal_E_Flash', g.pos.clone().setY(0), q);
        const target = g.nearestEnemy(g.pos, e.boltRange, marked) ?? g.nearestEnemy(g.pos, e.boltRange);
        if (target) g.spawnMissile('Ezreal_E_mis', g.pos, target.pos, {
          speed: e.speed, range: 3000, radius: 10, damage: e.damage[r] + e.bonusAdRatio * g.bonusAd, target, hit: HITS.E,
          hitFx: 'Ezreal_E_tar', hitSound: 'ezreal_E_hit',
        });
      } else {
        const R = SKILLS.R;
        const damage = R.damage[r] + R.bonusAdRatio * g.bonusAd;
        audio.play('ezreal_R_launch');
        g.spawnMissile('Ezreal_R_mis', g.pos, point, {
          speed: R.speed, range: R.range, radius: R.width / 2, damage, hit: HITS.R, height: 60, pierce: true,
          onHit: (e, m) => {
            g.vfx.hit('Ezreal_R_tar', e.pos.clone().setY(m.pos.y));
            audio.play('ezreal_R_hit');
            g.hurtEnemy(e, damage * (e.def.tier === 'epic' ? 1 : R.nonEpicMultiplier), HITS.R);
          },
        });
      }
    },

    onDamage(e, hit) {
      if (hit.source === 'item') return 0; // item burns neither stack the passive nor detonate marks
      if (hit.source === 'ability') stack();
      if (!marked(e)) return 0;
      // Essence Flux detonation; ability detonations refund mana
      unmark(e);
      g.vfx.hit('Ezreal_W_hit', e.pos.clone().setY(100));
      audio.play('ezreal_W_detonate');
      if (hit.skill) g.mana = Math.min(g.maxMana, g.mana + SKILLS.W.manaRestore + g.costOf(hit.skill));
      return SKILLS.W.damage[g.ranks.W - 1] + SKILLS.W.bonusAdRatio * g.bonusAd;
    },
  };
}
