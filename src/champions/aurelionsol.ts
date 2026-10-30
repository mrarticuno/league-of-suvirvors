// Aurelion Sol: today's model, VFX and sounds with the kit he had before his 2023 rework (Data Dragon 13.1.1),
// except the ultimate, which is today's meteor (Falling Star) instead of Voice of Light. Stats are the 13.1.1 ones.
// Adapted for hordes: each star hits an enemy once per pass over it; star kills restore a bit of
// mana (0.5s cooldown against minions and small monsters, always from elite and epic ones) because Celestial
// Expansion drains mana per second (6-10/s, no activation cost) and the old kit had no other mana source.
// Comet of Legend is a steerable 3s flight (+60-100% Move Speed, through walls and units, no attacks) on a 20-12s
// cooldown instead of a long locked line on 80-60s. Starsurge grows while Aurelion stays within 650 units and
// detonates past that, after 5s or at its full size; the bigger it got, the more it deals (+50%) and stuns (0.55-1.1s).
// It wears today's Singularity vortex, scaled to its radius.
import * as THREE from 'three';
import { audio } from '../audio';
import type { ChampionDef, ChampionKit, Hit, SkillDef, SkillKey } from '../champion';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
const OLD_ICON = 'https://ddragon.leagueoflegends.com/cdn/13.1.1/img'; // the pre-rework kit's icons
const HEAD = 'C_Buffbone_Glb_Head_Loc';
// Starsurge wears today's Singularity vortex (E_AoE): its systems are authored for this radius, scaled to the star's
const VORTEX_RADIUS = 450;

const STARS = {
  count: 3, radius: 250, expandedRadius: 650, hitRadius: 80,
  period: 3, expandedPeriod: 1.5, // seconds per revolution
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
    name: t('champion.aurelionsol.W'), desc: t('champion.aurelionsol.W.desc'), damageType: 'magic', maxRank: 5, anim: 'aurelionsol_spell2_takeoff', icon: `${OLD_ICON}/spell/AurelionSolW.png`,
    cooldown: [1.5, 1.5, 1.5, 1.5, 1.5], cost: [0, 0, 0, 0, 0],
    damage: [5, 10, 15, 20, 25], // added to each star hit (always, like the old passive rank bonus)
    drain: [6, 7, 8, 9, 10], // mana per second while expanded
    extra: { label: t('champion.aurelionsol.drain'), values: [6, 7, 8, 9, 10] },
    aim: 'none', castTime: 0.05,
  },
  E: {
    name: t('champion.aurelionsol.E'), desc: t('champion.aurelionsol.E.desc'), damageType: 'magic', maxRank: 5, anim: 'aurelionsol_dashing02', icon: `${OLD_ICON}/spell/AurelionSolE.png`,
    cooldown: [20, 18, 16, 14, 12], cost: [60, 60, 60, 60, 60],
    damage: [0, 0, 0, 0, 0], duration: 3,
    speed: [0.6, 0.7, 0.8, 0.9, 1], extra: { label: t('stat.ms'), values: [0.6, 0.7, 0.8, 0.9, 1], percent: true },
    aim: 'none', castTime: 0.05,
  },
  R: {
    name: t('champion.aurelionsol.R'), desc: t('champion.aurelionsol.R.desc'), damageType: 'magic', maxRank: 3, anim: 'aurelionsol_spell4_base', icon: `${ICON}/spell/AurelionSolR.png`,
    cooldown: [100, 85, 70], cost: [100, 100, 100],
    damage: [200, 325, 450], apRatio: 0.75, radius: 450, knockUp: 1, delay: 1,
    range: 1250, aim: 1250, castTime: 0.35,
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
  hide: ['AurelionSolFX'],
  itemPool: 'ap',
  // OP.GG mid 16.21: Liandry's, Rylai's, Rabadon's, Void Staff, Shadowflame, Cosmic Drive
  build: ['6653', '3116', '3089', '3135', '4645', '4629'],
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
    idle: 'aurelionsol_idle1', run: 'aurelionsol_runa', death: 'aurelionsol_death',
    attacks: ['aurelionsol_attack1', 'aurelionsol_attack2'], crit: 'aurelionsol_attack2',
  },
  vfx: {
    auto: 'AurelionSol_BA_Mis', crit: 'AurelionSol_BA_Mis', autoHit: 'AurelionSol_BA_tar', critHit: 'AurelionSol_BA_Crit_Tar',
    death: [['AurelionSol_Death', 'C_Buffbone_Glb_Layout_Loc']],
  },
  // the skin's idleParticlesEffects (its body beams need a second bone, which BoneVfx does not carry)
  idleVfx: [['AurelionSol_P_SkinOverride', 'spine']],
  animVfx: true,
  kit: aurelionSolKit,
};

const lerpLevel = (level: number, [a, b]: readonly number[]) => a + ((b - a) * (Math.min(level, 18) - 1)) / 17;

/** A Starsurge in flight: grows while Aurelion stays near, then detonates. */
interface Surge { pos: THREE.Vector3; dir: THREE.Vector3; rank: number; radius: number; age: number; vortex: THREE.Object3D; center: THREE.Object3D }

function aurelionSolKit(g: Game): ChampionKit {
  const near: Enemy[] = []; // own query array: hurtEnemy may run item effects that query too
  const flat = new THREE.Vector3();
  const stars = Array.from({ length: STARS.count }, () => g.vfx.attach('AurelionSol_Z_Idle_Star'));
  for (const s of stars) g.scene.add(s);
  const touching = stars.map(() => new Map<Enemy, number>()); // per star: enemy -> last run time in contact
  const surges: Surge[] = [];
  const meteors: { at: THREE.Vector3; rank: number; fall: number }[] = [];
  let angle = 0, orbit: number = STARS.radius;
  let expanded = false;
  let expandFx: THREE.Object3D | null = null;
  let flightUntil = -1;
  let flightFx: THREE.Object3D | null = null;
  let manaReady = 0;

  const toward = (point: THREE.Vector3) => {
    const dir = flat.copy(point).sub(g.pos).setY(0);
    if (dir.lengthSq() < 1) dir.set(Math.sin(g.facing), 0, Math.cos(g.facing));
    return dir.normalize();
  };
  const inReach = (e: Enemy, from: THREE.Vector3, r: number) => e.deadFor < 0 && e.pos.distanceTo(from) - e.def.radius <= r;
  const flying = () => g.time < flightUntil;
  /** Where Falling Star lands: the cursor, within range. */
  const landing = (point: THREE.Vector3) => {
    const off = flat.copy(point).sub(g.pos).setY(0);
    if (off.length() > SKILLS.R.range) off.setLength(SKILLS.R.range);
    return g.pos.clone().add(off).setY(0);
  };
  const follow = (key: string) => {
    const o = g.vfx.attach(key);
    o.position.copy(g.pos);
    g.scene.add(o);
    return o;
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

  const impact = (m: { at: THREE.Vector3; rank: number }) => {
    const R = SKILLS.R;
    g.vfx.playAt('AurelionSol_R_Calamity_Impact', m.at);
    g.vfx.playAt('AurelionSol_R_Calamity_Shockwave', m.at);
    audio.playAt('aurelionsol_R_hit', m.at, g.pos);
    const damage = R.damage[m.rank] + R.apRatio * g.ap;
    for (const e of g.enemiesNear(m.at, R.radius, near)) {
      if (!inReach(e, m.at, R.radius)) continue;
      g.hurtEnemy(e, damage, HITS.R);
      if (e.deadFor < 0) g.knockUp(e, R.knockUp);
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

    canCast: (key) => key !== 'R' || g.nearestEnemy(g.pos, SKILLS.R.range) !== null,
    ghost: flying,
    disarmed: flying,
    moveSpeedBonus: () => (flying() ? SKILLS.E.speed[Math.max(0, g.ranks.E - 1)] : 0),
    moveAnims: () => (flying() ? { idle: 'aurelionsol_dashing02', run: 'aurelionsol_dashing02' } : undefined),

    castStart(key, point) {
      const head = g.player.bone(HEAD);
      if (key === 'Q' && head) g.vfx.playOn('AurelionSol_Q_Cas', head, g.facing, g.player.root);
      if (key === 'R') g.vfx.playAt('AurelionSol_R_Calamity_Tell', landing(point));
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
        flightFx?.removeFromParent();
        flightFx = follow('AurelionSol_W_FlightTarget');
      } else {
        const at = landing(point);
        g.vfx.playAt('AurelionSol_R_Calamity_Mis', at);
        audio.playAt('aurelionsol_R_launch', at, g.pos);
        meteors.push({ at, rank: r, fall: g.time + SKILLS.R.delay });
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

      // Center of the Universe
      const target = expanded ? STARS.expandedRadius : STARS.radius;
      orbit += Math.sign(target - orbit) * Math.min(Math.abs(target - orbit), STARS.reach * dt);
      angle += ((Math.PI * 2) / (expanded ? STARS.expandedPeriod : STARS.period)) * dt;
      const alive = g.hp > 0;
      const damage = starDamage();
      for (let i = 0; i < stars.length; i++) {
        const a = angle + (i * Math.PI * 2) / stars.length;
        const s = stars[i];
        s.position.set(g.pos.x + Math.sin(a) * orbit, 110, g.pos.z + Math.cos(a) * orbit);
        s.visible = alive;
        if (!alive) continue;
        const touch = touching[i];
        for (const e of g.enemiesNear(s.position, STARS.hitRadius, near)) {
          if (!inReach(e, s.position, STARS.hitRadius)) continue;
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
        if (close && s.age < q.life && s.radius < q.radius[1] && alive) continue;
        detonate(s);
        surges.splice(i, 1);
      }

      for (let i = meteors.length - 1; i >= 0; i--) {
        if (g.time < meteors[i].fall) continue;
        impact(meteors[i]);
        meteors.splice(i, 1);
      }
    },

    dispose() {
      for (const s of stars) s.removeFromParent();
      for (const s of surges) { s.vortex.removeFromParent(); s.center.removeFromParent(); }
      expandFx?.removeFromParent();
      flightFx?.removeFromParent();
      surges.length = 0;
      meteors.length = 0;
      for (const t of touching) t.clear();
    },
  };
}
