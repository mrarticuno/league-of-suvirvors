// Kayle. Numbers mirror League of Legends: the character and skin bins of the current client (DataValues,
// mSpellCalculations, missile specs, Mana, CooldownTime) and the LoL wiki for the hitbox details (Radiant Blast's cross,
// the fire wave). Divine Ascent: Zealous (1), Arisen (6, ranged), Aflame (11, fire waves, +10% size), Transcendent
// (16, more range, always Exalted); each form shows its gear (wings, armour) and plays its ascension clip.
// Adapted for hordes: mana costs are lower (Q 30-50, W 35-55, R 50/25/0; League: 60-100, 70-90, 100/50/0) since Kayle
// casts on cooldown against hordes with no mana of her own; melee range is 250 (League: 175, like every melee champion
// here) and the attack ranges keep League's totals (525 Arisen, 625 Transcendent). Celestial Blessing and Divine Judgment
// are self-cast (no allies): W's ally beam (Kayle_W_Beam) never plays, and Kayle walks during W and R casts as in League.
// Not reproduced: the wings' and sword's custom shaders (Kayle_Wings / Kayle_Sword: fire mask scrolling under Exalted,
// fire wings at 16, the E-buff sword colour) — the runtime draws champion meshes with their diffuse texture only.
import * as THREE from 'three';
import { audio } from '../audio';
import type { ChampionDef, ChampionKit, DamageType, Hit, SkillDef, SkillKey } from '../champion';
import { boundSize } from '../data';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';
import { animEvents, facingQuat, type ParticleSystem } from '../particles';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';
const MELEE = 250; // our melee attack range (League: 175)

const PASSIVE = {
  forms: [1, 6, 11, 16], // Zealous, Arisen, Aflame, Transcendent
  rangeArisen: 525, rangeTranscendent: 625, // total attack range (League's UpgradedAttackRange / FinalAttackRange)
  maxStacks: 5, duration: 5, asPerStack: 0.06, asPerStackPer100Ap: 0.01, exaltedMs: 0.1,
  sizeBonus: 0.1, sizeGrow: 1, // Aflame: +10% size, grown over 1s
  // Aflame's fire wave: three hitboxes 9° apart from 75 behind Kayle (a 4th projectile in League is the visual only)
  wave: { base: 20, perLevel: 3, fromLevel: 11, bonusAdRatio: 0.1, apRatio: 0.25, speed: 2800, range: 850, radius: 100, spread: 9, behind: 75 },
};

const SKILLS = {
  Q: {
    name: t('champion.kayle.Q'), desc: t('champion.kayle.Q.desc'), damageType: 'magic', maxRank: 5, anim: 'kayle_spell1', icon: `${ICON}/spell/KayleQ.png`,
    cooldown: [12, 11, 10, 9, 8], cost: [30, 35, 40, 45, 50], // League: 60-100 mana
    damage: [60, 90, 120, 150, 180], bonusAdRatio: 0.6, apRatio: 0.5,
    slow: [0.25, 0.3, 0.35, 0.4, 0.45], slowDuration: 2, shred: 0.15, shredDuration: 4,
    range: 900, aim: 900, speed: 1600, width: 75, delay: 0.25, castTime: 0.31, // cast time = attack windup (castTime hook)
    // the expansion on impact: 5 hitboxes around a point 100 past the impact (ExplosionForwardOffset)
    blast: { offset: 100, center: 100, side: 150, sideWidth: 125, forward: 400, back: 100, lineWidth: 90 },
  },
  W: {
    name: t('champion.kayle.W'), desc: t('champion.kayle.W.desc'), damageType: 'magic', maxRank: 5, anim: 'kayle_spell2', icon: `${ICON}/spell/KayleW.png`,
    cooldown: [15, 15, 15, 15, 15], cost: [35, 40, 45, 50, 55], // League: 70-90 mana
    damage: [0, 0, 0, 0, 0], heal: [55, 80, 105, 130, 155], healApRatio: 0.25,
    haste: [0.24, 0.28, 0.32, 0.36, 0.4], hastePer100Ap: 0.08, hasteDuration: 2,
    extra: { label: t('champion.kayle.W.heal'), values: [55, 80, 105, 130, 155] },
    aim: 'none', castTime: 0.05, // League: 0.25s she walks through, effects at its start
  },
  E: {
    name: t('champion.kayle.E'), desc: t('champion.kayle.E.desc'), damageType: 'magic', maxRank: 5, anim: '', icon: `${ICON}/spell/KayleE.png`,
    cooldown: [8, 7.5, 7, 6.5, 6], cost: [0, 0, 0, 0, 0],
    damage: [15, 20, 25, 30, 35], bonusAdRatio: 0.1, apRatio: 0.2, // the passive on-hit damage
    execute: [0.08, 0.085, 0.09, 0.095, 0.1], executePer100Ap: 0.015, monsterCap: 400,
    extra: { label: t('champion.kayle.E.execute'), values: [8, 8.5, 9, 9.5, 10], percent: true },
    buffDuration: 5, range: 525, meleeRange: MELEE, radius: 350, speed: 5000,
    aim: 'none', castTime: 0.05,
  },
  R: {
    name: t('champion.kayle.R'), desc: t('champion.kayle.R.desc'), damageType: 'magic', maxRank: 3, anim: 'kayle_R', icon: `${ICON}/spell/KayleR.png`,
    cooldown: [160, 120, 80], cost: [50, 25, 0], // League: 100/50/0 mana
    damage: [200, 300, 400], bonusAdRatio: 1, apRatio: 0.7, radius: [675, 675, 775], delay: 2.5,
    aim: 'none', castTime: 0.05, // League: 0.5s she walks through; invulnerable from its start
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

const HITS = {
  auto: [{ type: 'physical', source: 'auto', onHit: true }, { type: 'physical', source: 'auto', onHit: true, crit: true }],
  Q: { type: 'magic', source: 'ability', skill: 'Q' },
  wave: [{ type: 'magic', source: 'ability' }, { type: 'magic', source: 'ability', crit: true }], // passive spell damage
  R: { type: 'magic', source: 'ability', skill: 'R' },
} as const satisfies Record<string, Hit | readonly Hit[]>;

// clips by attack speed: each pair switches to its fast clip from that attack speed (the graph's ConditionFloat)
const ATTACKS = {
  melee: [['kayle_attack1', 'kayle_attack1fast', 1.6], ['kayle_attack2', 'kayle_attack2fast', 1.6]],
  exalted: [['kayle_attack3', 'kayle_attack3fast', 1.8], ['kayle_attack4', 'kayle_attack4fast', 1.8]],
  exaltedCrit: ['kayle_attackpassive', 'kayle_attackpassivefast', 1.9],
  ranged: [['kayle_attackranged2', 'kayle_attackrangedfast2', 1.6], ['kayle_attackranged1', 'kayle_attackrangedfast1', 1.6]],
} as const;
// KayleBasicAttack (Attack1, crit) and KayleBasicAttack2 hit effects; the ranged ones (BasicAttack3/4) share one
const MELEE_HIT = ['Kayle_BA_Tar_2', 'Kayle_BA_Tar'];
// windup share of the attack period: castFrame / 30 at League's base attack speed
const WINDUP = { melee: 0.3 / 1.55, ranged: (8 / 30) * 0.625, eRanged: (11 / 30) * 0.625, eMelee: (9.5 / 30) * 0.625 };
const SWORD = ['Sword_Hilt', 'Sword_Blade'], SHEATHED = ['sword_hilt_combined', 'sword_blade_combined'];
// ascension clips (Evolve1-3: Arisen, Aflame, Transcendent; Evolve4: the first ascension), standing and walking
const ASCEND_CLIP = ['kayle_evolve4', 'kayle_evolve1', 'kayle_evolve2', 'kayle_evolve3'];
const ASCEND = [['kayle_evolve4', 'kayle_evolve4'], ['kayle_ascend1', 'kayle_ascend1_run'], ['kayle_ascend2', 'kayle_ascend2_run'], ['kayle_ascend3', 'kayle_ascend3_run']] as const;

export const KAYLE: ChampionDef = {
  id: 'kayle', name: t('champion.kayle.name'), model: 'kayle', icon: `${ICON}/champion/Kayle.png`,
  title: t('champion.kayle.title'), splash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Kayle_0.jpg',
  roles: ['marksman', 'mage'], difficulty: 7,
  scale: 1.175 / 1.1, // SkinScale 1.175 (Ezreal 1.1): the exports share one unit, so the bins' ratio keeps her proportion to Ezreal
  hide: ['level11', 'wings_mid', 'wings_bot', 'sword_hilt', 'sword_blade'], // initialSubmeshToHide: level 1 gear
  textures: {
    wings_up: 'kayle_wings', wings_mid: 'kayle_wings', wings_bot: 'kayle_wings',
    sword_hilt: 'kayle_sword', sword_blade: 'kayle_sword', sword_hilt_combined: 'kayle_sword', sword_blade_combined: 'kayle_sword',
  },
  // League's body material does not cut out by alpha (the alpha is a mask): the skin under the armour is solid
  opaque: ['Kayle_Base_Body_Mat', 'level1', 'level11'],
  // the wing and blade textures are value maps (green channel) coloured by their materials: the wings by albedo remap
  // (albedoNewMin/Max 0.1-1), the blade along its Gradient_Texture at Gradient_Transform 0.5 (Kayle_Sword_inst)
  remap: {
    wings_up: { min: 0.1, max: 1 }, wings_mid: { min: 0.1, max: 1 }, wings_bot: { min: 0.1, max: 1 },
    sword_blade: { gradient: 'kayle_gradient', v: 0.5 }, sword_blade_combined: { gradient: 'kayle_gradient', v: 0.5 },
  },
  conformPath: [['L_Wing_Lo_1', 'L_Wing_Lo_4'], ['R_Wing_Lo_1', 'R_Wing_Lo_4']], // the lower wings trail her path
  base: {
    hp: 670, hpPerLevel: 92,
    hpRegen5: 5, hpRegen5PerLevel: 0.5,
    mana: 330, manaPerLevel: 50,
    manaRegen5: 8, manaRegen5PerLevel: 0.8,
    ad: 50, adPerLevel: 2.5,
    attackSpeed: 0.625, attackSpeedPerLevel: 0.015,
    attackRange: MELEE, // League: 175; Divine Ascent adds the rest (stat 'range')
    moveSpeed: 335,
    critDamage: 1.75,
    windupPercent: WINDUP.melee,
    missileSpeed: 5000,
    radius: 65,
    armor: 26, armorPerLevel: 4.2,
  },
  skills: SKILLS,
  passive: { name: t('champion.kayle.passive'), icon: `${ICON}/passive/Kayle_P.png` },
  anims: {
    idle: 'kayle_idle', run: 'kayle_run', death: 'kayle_death',
    attacks: ['kayle_attack1', 'kayle_attack2'], crit: 'kayle_attack1',
  },
  sequences: {
    kayle_idle: ['kayle_idle1', 'kayle_idle1', 'kayle_idle1', 'kayle_idle2'], // Idle1 selector: 75% / 25%
    kayle_run: ['kayle_run1', 'kayle_run2'], // Run: Run1 then a Run1/Run2 pick
    kayle_R: ['kayle_spell4', 'kayle_spell4trans'],
    kayle_R_exalted: ['kayle_spell4', 'kayle_spell4transenraged'],
    kayle_ascend1: ['kayle_evolve1', 'kayle_evolve1_toidle'], kayle_ascend1_run: ['kayle_evolve1', 'kayle_evolve1_torun'],
    kayle_ascend2: ['kayle_evolve2', 'kayle_evolve2_toidle'], kayle_ascend2_run: ['kayle_evolve2', 'kayle_evolve2_torun'],
    kayle_ascend3: ['kayle_evolve3', 'kayle_evolve3_toidle'], kayle_ascend3_run: ['kayle_evolve3', 'kayle_evolve3_torun'],
  },
  boneHeading: true, // the swipes open toward the target (authored in the backward-facing buffbone frame)
  animVfx: true, // swipes, ascensions, death dissolve and the sword drawn per clip (events.json)
  vfx: { auto: 'Kayle_BA_Ranged', crit: 'Kayle_BA_Ranged', autoHit: 'Kayle_BA_Ranged_Tar', critHit: 'Kayle_BA_Ranged_Tar' },
  kit: kayleKit,
};

const flatDist = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

function kayleKit(g: Game): ChampionKit {
  const fwd = new THREE.Vector3(), side = new THREE.Vector3(), tmp = new THREE.Vector3();
  const near: Enemy[] = [];
  let stacks = 0, zealUntil = 0;
  let form = -1, ascended = false, pendingAscend = -1, ascendBy = 0, sizeT = 0;
  let exaltedShown = false;
  let eUntil = 0, eRing: THREE.Object3D | null = null, activeE = false;
  let hasteUntil = 0, hasteRank = 0;
  let invulnUntil = 0;
  let pending: { kind: 'melee' | 'ranged' | 'E'; melee: boolean; index: number } = { kind: 'melee', melee: true, index: 0 };
  let attackIndex = 0;
  const qLaunches: { at: number; from: THREE.Vector3; dir: THREE.Vector3; rank: number }[] = [];
  const judgments: { at: number; rank: number; systems: (ParticleSystem | null)[]; marker: THREE.Object3D }[] = [];
  const shreds = new Map<Enemy, { until: number; mark: THREE.Object3D }>();

  const formOf = (level: number) => PASSIVE.forms.filter((l) => level >= l).length - 1;
  const transcendent = () => g.level >= PASSIVE.forms[3];
  const exalted = () => transcendent() || stacks >= PASSIVE.maxStacks;
  const eReady = () => g.time < eUntil;
  const inMelee = (e: Enemy) => flatDist(e.pos, g.pos) - e.def.radius - KAYLE.base.radius <= MELEE;
  const clip = ([slow, fast, from]: readonly [string, string, number]) => (g.attackSpeed >= from ? fast : slow);
  const critMult = () => KAYLE.base.critDamage + g.items.critDamage;
  const boneAt = (name: string) => g.player.bone(name)?.getWorldPosition(new THREE.Vector3()) ?? g.pos.clone().setY(100);

  /** Sword drawn (Exalted) or sheathed: the passive clips draw it themselves, this keeps it out between them. */
  const drawSword = (on: boolean) => {
    for (const s of SWORD) g.player.showSubmesh(s, on);
    for (const s of SHEATHED) g.player.showSubmesh(s, !on);
  };

  /** Each form's gear (the skin's GearSkinUpgrade): a wing pair at 6, the level 11 armour and the third pair at 11. */
  const wearForm = (f: number) => {
    g.player.showSubmesh('wings_bot', f >= 1);
    g.player.showSubmesh('wings_mid', f >= 2);
    g.player.showSubmesh('level11', f >= 2);
    g.player.showSubmesh('level1', f < 2);
  };

  const endE = () => {
    eUntil = 0;
    eRing?.removeFromParent();
    eRing = null;
  };

  const unshred = (e: Enemy) => {
    shreds.get(e)?.mark.removeFromParent();
    shreds.delete(e);
  };

  /** Radiant Blast's expansion: a cross of hitboxes 100 past the impact, along the sword's flight. */
  const blast = (at: THREE.Vector3, dir: THREE.Vector3, rank: number) => {
    const q = SKILLS.Q, b = q.blast;
    fwd.copy(dir).setY(0).normalize();
    side.set(fwd.z, 0, -fwd.x);
    const c = at.clone().addScaledVector(fwd, b.offset).setY(0);
    g.vfx.playAt('0xd54dd906', at.clone().setY(100), Math.atan2(fwd.x, fwd.z)); // Kayle_Base_Q_hit
    audio.play('kayle_Q_hit');
    const damage = q.damage[rank] + q.bonusAdRatio * g.bonusAd + q.apRatio * g.ap;
    for (const e of g.enemiesNear(c, b.forward + b.side, near)) {
      if (e.deadFor >= 0) continue;
      tmp.copy(e.pos).sub(c).setY(0);
      const x = tmp.dot(side), z = tmp.dot(fwd), r = e.def.radius;
      const hit = tmp.length() <= b.center + r
        || (Math.abs(x) <= b.side + r && Math.abs(z) <= b.sideWidth + r)
        || (Math.abs(x) <= b.lineWidth + r && z >= -b.back - r && z <= b.forward + r);
      if (!hit) continue;
      g.vfx.hit('Kayle_Q_Tar', e.pos, Math.atan2(fwd.x, fwd.z), { owner: e.actor.root, size: boundSize(e) });
      g.hurtEnemy(e, damage, HITS.Q);
      if (e.deadFor >= 0) continue;
      g.slow(e, q.slow[rank], q.slowDuration);
      // Sundered: armor and magic resist down 15% for 4s (after the damage, as in League)
      const s = shreds.get(e);
      if (s) s.until = g.time + q.shredDuration;
      else {
        const mark = g.vfx.attach('Kayle_Q_Shred', { size: boundSize(e), duration: q.shredDuration });
        g.scene.add(mark);
        shreds.set(e, { until: g.time + q.shredDuration, mark });
      }
    }
  };

  const launchQ = (from: THREE.Vector3, dir: THREE.Vector3, rank: number) => {
    const q = SKILLS.Q;
    audio.play('kayle_Q_launch');
    g.spawnMissile('Kayle_Q_Mis', from, from.clone().addScaledVector(dir, q.range), {
      speed: q.speed, range: q.range, radius: q.width, damage: 0, hit: HITS.Q, height: 100,
      onHit: (_e, m) => blast(m.pos, dir, rank),
    });
  };

  /** Starfire Spellblade's empowered strike on `target`: the attack, plus the explosion once Aflame. */
  const strikeE = (target: Enemy, damage: number, crit: boolean, aflame: boolean) => {
    activeE = true;
    const hit = HITS.auto[+crit];
    g.vfx.hit('Kayle_E_hit_fx', target.pos, g.facing, { owner: target.actor.root, size: boundSize(target) });
    g.vfx.hit('Kayle_E_Tar', target.pos, g.facing, { owner: target.actor.root, size: boundSize(target) });
    audio.play(aflame ? 'kayle_E_up_hit' : pending.melee ? 'kayle_E_melee_hit' : 'kayle_E_hit');
    g.hurtEnemy(target, damage, hit);
    if (aflame) {
      const at = target.pos.clone();
      g.vfx.playAt('Kayle_E_hit_Lvl6', at.clone().setY(0), g.facing);
      audio.play('kayle_E_magic'); // the explosion's soundOnCreateDefault
      for (const e of g.enemiesNear(at, SKILLS.E.radius, near)) {
        if (e === target || e.deadFor >= 0 || flatDist(e.pos, at) > SKILLS.E.radius + e.def.radius) continue;
        g.vfx.hit('Kayle_E_Tar_AOE', e.pos, g.facing, { owner: e.actor.root, size: boundSize(e) });
        g.hurtEnemy(e, damage, hit);
      }
    }
    activeE = false;
  };

  /** Aflame's wave of fire: three hitboxes fanned 9° apart, each enemy struck once per wave. */
  const fireWave = () => {
    const w = PASSIVE.wave;
    const damage = w.base + w.perLevel * Math.max(0, g.level - w.fromLevel) + w.bonusAdRatio * g.bonusAd + w.apRatio * g.ap;
    const struck = new Set<Enemy>();
    const facing = g.facing;
    audio.play('kayle_P_wave');
    audio.play('kayle_P_wave_launch');
    for (const k of [-1, 0, 1]) {
      const a = facing + k * w.spread * (Math.PI / 180);
      const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      const from = g.pos.clone().addScaledVector(dir, -w.behind);
      // center: the wave's own visual (it carries the cast sound in League); sides: the volley's arcs
      g.spawnMissile(k === 0 ? 'Kayle_P_Enraged_Mis' : 'Kayle_P_Enraged_Mis_2', from, from.clone().addScaledVector(dir, w.range), {
        speed: w.speed, range: w.range, radius: w.radius, damage, hit: HITS.wave[0], pierce: true, height: 100,
        onHit: (e) => {
          if (struck.has(e)) return;
          struck.add(e);
          const crit = Math.random() < g.critChance; // rolled per target
          g.vfx.hit('0x0ccf045a', e.pos, a, { owner: e.actor.root, size: boundSize(e) }); // Kayle_Base_P_Enraged_Tar
          audio.play('kayle_P_wave_hit');
          g.hurtEnemy(e, crit ? damage * critMult() : damage, HITS.wave[+crit]);
        },
      });
    }
  };

  /** Divine Ascent's next form: its gear, size, ascension clip (with its god rays) and sound. */
  const ascend = (f: number) => {
    wearForm(f);
    if (f >= 2 && sizeT === 0) sizeT = 1e-6;
    pendingAscend = f;
    ascendBy = g.time + 0.5;
  };

  const playAscend = () => {
    if (pendingAscend < 0) return;
    const [idle, run] = ASCEND[pendingAscend];
    g.gesture(idle, run);
    const started = g.player.currentName === idle || g.player.currentName === run;
    if (!started && g.time < ascendBy) return; // busy (cast, windup): retry a little
    if (!started) {
      // still attacking: League plays the ascension over her action; here the clip yields, its effects still play
      for (const ev of animEvents()[ASCEND_CLIP[pendingAscend]] ?? []) {
        const bone = ev.key && g.player.bone(ev.bones[0] ?? '');
        if (bone) g.vfx.play(ev.key, bone.getWorldPosition(new THREE.Vector3()), facingQuat(g.facing), { bone, owner: g.player.root });
      }
    }
    audio.play(`kayle_P_ascend${pendingAscend}`);
    pendingAscend = -1;
  };

  return {
    stat: (k) => {
      if (k !== 'range') return 0;
      const total = transcendent() ? PASSIVE.rangeTranscendent : g.level >= PASSIVE.forms[1] ? PASSIVE.rangeArisen
        : eReady() ? SKILLS.E.range : MELEE; // before Arisen, the empowered attack reaches 525
      return total - MELEE;
    },
    attackSpeedBonus: () => (transcendent() ? PASSIVE.maxStacks : stacks) * (PASSIVE.asPerStack + PASSIVE.asPerStackPer100Ap * g.ap / 100),
    moveSpeedBonus: () => (exalted() ? PASSIVE.exaltedMs : 0)
      + (g.time < hasteUntil ? SKILLS.W.haste[hasteRank] + SKILLS.W.hastePer100Ap * g.ap / 100 : 0),
    invulnerable: () => g.time < invulnUntil,
    resistShred: (e: Enemy, _type: DamageType) => ((shreds.get(e)?.until ?? 0) > g.time ? SKILLS.Q.shred : 0),
    moveAnims: () => (exalted() ? { idle: 'kayle_idlepassive', run: 'kayle_runpassive' } : undefined),
    hud: () => (exalted() ? t('champion.kayle.hud.exalted') : t('champion.kayle.hud', { stacks, max: PASSIVE.maxStacks })),
    gauge: () => ({ label: String(transcendent() ? PASSIVE.maxStacks : stacks), fill: (transcendent() ? PASSIVE.maxStacks : stacks) / PASSIVE.maxStacks, ready: exalted() }),

    castTime: (key) => (key === 'Q' ? KAYLE.base.windupPercent / g.attackSpeed : undefined), // Radiant Blast: the attack windup
    castAnim: (key) => {
      if (key === 'R') return exalted() ? 'kayle_R_exalted' : 'kayle_R';
      return undefined;
    },

    castStart(key, point) {
      if (key !== 'Q') return;
      // the portal opens in front of her at the start of the cast; the sword leaves it 0.25s later, wherever Kayle is
      const dir = point.clone().sub(g.pos).setY(0);
      if (dir.lengthSq() === 0) dir.set(Math.sin(g.facing), 0, Math.cos(g.facing));
      dir.normalize();
      const from = g.pos.clone().addScaledVector(dir, KAYLE.base.radius);
      g.vfx.playAt('Kayle_Q_Cas', from.clone().setY(100), Math.atan2(dir.x, dir.z));
      qLaunches.push({ at: g.time + SKILLS.Q.delay, from, dir, rank: g.ranks.Q - 1 });
    },

    cast(key, r) {
      if (key === 'W') {
        const w = SKILLS.W;
        g.heal(w.heal[r] + w.healApRatio * g.ap);
        hasteUntil = g.time + w.hasteDuration;
        hasteRank = r;
        const chest = g.player.bone('C_Buffbone_Glb_Chest_Loc');
        if (chest) g.vfx.playOn('Kayle_W_Tar', chest, g.facing, g.player.root);
        g.vfx.playAt('Kayle_W_AoE_Indicator', g.pos.clone().setY(0), g.facing, { owner: g.player.root });
      } else if (key === 'E') {
        eUntil = g.time + SKILLS.E.buffDuration;
        g.resetAttack();
        const hand = g.player.bone('R_Buffbone_Glb_Hand_Loc');
        if (hand) g.vfx.playOn('Kayle_E_Cas', hand, g.facing, g.player.root);
        // the empowered attack's range ring (Kayle_Base_E_Indicator) rides her until the attack or the buff ends
        if (!eRing) {
          eRing = g.vfx.attach('0x0bd2864f', { duration: SKILLS.E.buffDuration });
          g.scene.add(eRing);
        }
      } else if (key === 'R') {
        const R = SKILLS.R;
        invulnUntil = g.time + R.delay;
        const root = g.player.bone('Root') ?? g.player.root;
        const on = (k: string) => g.vfx.play(k, g.pos.clone(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.facing),
          { bone: root, owner: g.player.root, life: R.delay, duration: R.delay });
        audio.play('kayle_R_self');
        audio.play('kayle_R_up');
        const marker = g.vfx.attach('Kayle_R_AoE_Indicator_Green', { duration: R.delay });
        g.scene.add(marker);
        judgments.push({ at: g.time + R.delay, rank: r, marker, systems: [on('Kayle_R_Cas'), on('Kayle_R_Self'), on('Kayle_R_Swords_Self'), on('Kayle_R_Swords_Child_First')] });
      }
    },

    attackStart(target, crit) {
      const ex = exalted();
      const i = attackIndex++;
      if (eReady()) {
        const melee = g.level < PASSIVE.forms[1] && inMelee(target); // League: within 200 the empowered attack stays melee
        const aflame = g.level >= PASSIVE.forms[2];
        pending = { kind: 'E', melee, index: i };
        const anim = melee ? 'kayle_spell3melee' : ex ? 'kayle_spell3enraged' : 'kayle_spell3_l'; // Spell3: the left clip in practice
        return { anim, sound: melee ? 'kayle_E_melee' : aflame ? 'kayle_E_up' : 'kayle_E_attack', windupPercent: melee ? WINDUP.eMelee : WINDUP.eRanged };
      }
      const melee = inMelee(target); // League: within 175 units Kayle swings even after Arisen
      pending = { kind: melee ? 'melee' : 'ranged', melee, index: i };
      if (!melee) {
        const pair = ATTACKS.ranged[i % 2];
        return { anim: clip(pair), sound: i % 2 ? 'kayle_ranged1' : 'kayle_ranged2', windupPercent: WINDUP.ranged };
      }
      const anim = crit ? (ex ? clip(ATTACKS.exaltedCrit) : ATTACKS.melee[0][0]) : clip((ex ? ATTACKS.exalted : ATTACKS.melee)[i % 2]);
      return { anim, sound: crit || i % 2 === 0 ? 'kayle_melee1' : 'kayle_melee2', windupPercent: WINDUP.melee };
    },

    basicAttack(target, damage, crit, bolt) {
      if (bolt) {
        g.spawnMissile('Kayle_BA_Ranged', g.pos, target.pos, {
          speed: KAYLE.base.missileSpeed, range: 3000, radius: 10, damage, target, hit: { ...HITS.auto[+crit], bolt },
          hitFx: 'Kayle_BA_Ranged_Tar', hitSound: 'kayle_ranged1_hit',
        });
        return true;
      }
      // Zealous: every attack stacks on attack; the fifth makes her Exalted
      const was = exalted();
      stacks = Math.min(PASSIVE.maxStacks, stacks + 1);
      zealUntil = g.time + PASSIVE.duration;
      if (!was && exalted()) audio.play('kayle_P_exalted');
      else if (stacks === PASSIVE.maxStacks - 1 && !transcendent()) audio.play('kayle_P_zeal');
      if (exalted() && g.level >= PASSIVE.forms[2]) fireWave();

      const p = pending;
      if (p.kind === 'E') {
        const aflame = g.level >= PASSIVE.forms[2];
        endE();
        if (p.melee) strikeE(target, damage, crit, aflame);
        else {
          audio.play(aflame ? 'kayle_E_up_launch' : 'kayle_E_launch');
          g.spawnMissile(aflame ? 'Kayle_E_Mis_lvl6' : 'Kayle_E_Mis', boneAt('C_Buffbone_Glb_Head_Loc'), target.pos, {
            speed: SKILLS.E.speed, range: 3000, radius: 10, damage, target, hit: HITS.auto[+crit],
            height: boneAt('C_Buffbone_Glb_Head_Loc').y,
            onHit: (e) => strikeE(e, damage, crit, aflame),
          });
        }
      } else if (p.melee) {
        // melee: the hit lands at the end of the windup, no missile (the swipe plays from the clip's events)
        const k = crit ? 0 : p.index % 2;
        g.vfx.hit(MELEE_HIT[k], target.pos, g.facing, { owner: target.actor.root, size: boundSize(target) });
        audio.play(k ? 'kayle_melee2_hit' : 'kayle_melee1_hit');
        g.hurtEnemy(target, damage, HITS.auto[+crit]);
      } else {
        const k = p.index % 2;
        audio.play(k ? 'kayle_ranged1_launch' : 'kayle_ranged2_launch');
        g.spawnMissile('Kayle_BA_Ranged', boneAt('R_Hand'), target.pos, {
          speed: KAYLE.base.missileSpeed, range: 3000, radius: 10, damage, target, hit: HITS.auto[+crit],
          hitFx: 'Kayle_BA_Ranged_Tar', hitSound: k ? 'kayle_ranged1_hit' : 'kayle_ranged2_hit',
        });
      }
      return true;
    },

    onDamage(e, hit) {
      if (hit.source !== 'auto' || !hit.onHit || !g.learned('E')) return 0;
      const E = SKILLS.E, r = g.ranks.E - 1;
      let magic = E.damage[r] + E.bonusAdRatio * g.bonusAd + E.apRatio * g.ap; // Starfire Spellblade's passive
      if (activeE) {
        const bonus = (E.execute[r] + E.executePer100Ap * g.ap / 100) * Math.max(0, e.maxHp - e.hp);
        magic += e.def.tier === 'minion' ? bonus : Math.min(E.monsterCap, bonus);
      }
      return magic;
    },

    update(dt) {
      // Divine Ascent: a new form on reaching its level (the first one with her first skill point)
      const f = formOf(g.level);
      if (f !== form) {
        if (f > form && (form >= 0 || ascended)) ascend(f);
        else wearForm(f);
        form = f;
      }
      if (!ascended && (g.ranks.Q || g.ranks.W || g.ranks.E || g.ranks.R)) {
        ascended = true;
        if (pendingAscend < 0 && form === 0) pendingAscend = 0;
      }
      playAscend();
      if (sizeT > 0 && sizeT < 1) {
        sizeT = Math.min(1, sizeT + dt / PASSIVE.sizeGrow);
        g.player.root.scale.setScalar(1 + PASSIVE.sizeBonus * sizeT);
      }

      if (stacks > 0 && g.time >= zealUntil && !transcendent()) stacks = 0;
      const ex = exalted();
      if (ex !== exaltedShown) {
        exaltedShown = ex;
        drawSword(ex);
        if (ex) g.gesture('kayle_idle_to_passive', 'kayle_runpassivetransition');
      }
      if (eUntil > 0 && !eReady()) endE();
      if (eRing) eRing.position.set(g.pos.x, 0, g.pos.z);

      for (let i = qLaunches.length - 1; i >= 0; i--) {
        const q = qLaunches[i];
        if (g.time < q.at) continue;
        qLaunches.splice(i, 1);
        launchQ(q.from, q.dir, q.rank);
      }

      for (let i = judgments.length - 1; i >= 0; i--) {
        const j = judgments[i];
        j.marker.position.set(g.pos.x, 0, g.pos.z);
        if (g.time < j.at) continue;
        judgments.splice(i, 1);
        j.marker.removeFromParent();
        for (const s of j.systems) s?.stop();
        // the swords rain around Kayle (the target) where she stands now
        const R = SKILLS.R, radius = R.radius[j.rank];
        const at = g.pos.clone();
        g.vfx.playAt('Kayle_R_Explosion', at.clone().setY(0), g.facing);
        audio.play('kayle_R_down');
        audio.play('kayle_R_hit');
        const damage = R.damage[j.rank] + R.bonusAdRatio * g.bonusAd + R.apRatio * g.ap;
        for (const e of g.enemiesNear(at, radius, near)) {
          if (e.deadFor >= 0 || flatDist(e.pos, at) > radius + e.def.radius) continue;
          g.vfx.hit('Kayle_R_Tar', e.pos, g.facing, { owner: e.actor.root, size: boundSize(e) });
          g.hurtEnemy(e, damage, HITS.R);
        }
      }

      for (const [e, s] of shreds) {
        if (s.until <= g.time || e.deadFor >= 0) unshred(e);
        else s.mark.position.set(e.pos.x, 0, e.pos.z);
      }
    },

    dispose() {
      endE();
      for (const e of [...shreds.keys()]) unshred(e);
      for (const j of judgments) { j.marker.removeFromParent(); for (const s of j.systems) s?.stop(); }
      judgments.length = 0;
      qLaunches.length = 0;
    },
  };
}
