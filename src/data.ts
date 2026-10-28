// Game data. Ezreal numbers mirror League of Legends (source: Meraki Analytics champion JSON).
// Enemy numbers are tuned for the survivors-like genre (many weak enemies), keeping LoL relative scale.

export const EZREAL = {
  model: 'ezreal',
  base: {
    hp: 600, hpPerLevel: 102,
    hpRegen5: 4, hpRegen5PerLevel: 0.65, // LoL regen is per 5 seconds
    mana: 375, manaPerLevel: 70,
    manaRegen5: 8.5, manaRegen5PerLevel: 1,
    ad: 60, adPerLevel: 2.75,
    attackSpeed: 0.625, attackSpeedPerLevel: 0.025, // +2.5% bonus AS per level
    attackRange: 550,
    moveSpeed: 325,
    critDamage: 1.75,
    windupPercent: 0.3 / 1.6, // attackCastTime / attackTotalTime
    missileSpeed: 2000,
    radius: 65,
    armor: 24, armorPerLevel: 4.2,
  },
  passive: { asPerStack: 0.10, maxStacks: 5, duration: 6 },
  Q: {
    name: 'Mystic Shot', maxRank: 5,
    cooldown: [5.5, 5.25, 5, 4.75, 4.5], cost: [28, 31, 34, 37, 40],
    damage: [20, 45, 70, 95, 120], adRatio: 1.3,
    range: 1200, speed: 2000, width: 120, castTime: 0.25, cdRefundOnHit: 1.5,
  },
  W: {
    name: 'Essence Flux', maxRank: 5,
    cooldown: [8, 8, 8, 8, 8], cost: [50, 50, 50, 50, 50],
    damage: [80, 135, 190, 245, 300], bonusAdRatio: 1.0,
    range: 1200, speed: 1700, width: 160, castTime: 0.25, markDuration: 4, manaRestore: 60,
  },
  E: {
    name: 'Arcane Shift', maxRank: 5,
    cooldown: [26, 23, 20, 17, 14], cost: [70, 70, 70, 70, 70],
    damage: [80, 130, 180, 230, 280], bonusAdRatio: 0.5,
    blinkRange: 475, boltRange: 750, speed: 2000, castTime: 0.25,
  },
  R: {
    name: 'Trueshot Barrage', maxRank: 3,
    cooldown: [120, 105, 90], cost: [100, 100, 100],
    damage: [350, 550, 750], bonusAdRatio: 1.0,
    range: 6000, speed: 2000, width: 320, castTime: 1, nonEpicMultiplier: 0.5,
  },
  anims: {
    idle: 'ezreal_idle', run: 'ezreal_run', death: 'ezreal_death',
    attacks: ['ezreal_attack1', 'ezreal_attack2', 'ezreal_attack3', 'ezreal_attack4'], crit: 'ezreal_crit',
    Q: 'ezreal_spell1', W: 'ezreal_spell2', E: 'ezreal_spell3_generic', R: 'ezreal_spell4',
  },
} as const;

export type SkillKey = 'Q' | 'W' | 'E' | 'R';
export const SKILL_KEYS: SkillKey[] = ['Q', 'W', 'E', 'R'];
export const MAX_CHAMPION_LEVEL = 18;

export interface EnemyDef {
  model: string;
  mesh?: string; // .glb to load when this model only swaps the texture of another one
  name?: string; // shown on the boss bar
  hp: number;
  speed: number;
  damage: number;
  attackRange: number; // edge-to-edge distance
  attackCooldown: number;
  windup: number;
  ranged?: number; // projectile speed for ranged attackers (fixed-direction skillshot)
  xp: number;
  radius: number;
  scale?: number;
  tier: 'minion' | 'monster' | 'elite' | 'epic';
  armor?: number; // defaults by tier (ENEMY_ARMOR)
  hide?: string[]; // material names to hide (unused submeshes)
  anims: { run: string; idle: string; death: string; attacks: string[] };
}

export const ENEMIES: Record<string, EnemyDef> = {
  minion_melee: {
    model: 'minion_melee', hp: 50, speed: 240, damage: 12, attackRange: 60, attackCooldown: 1.25, windup: 0.4,
    xp: 1, radius: 48, tier: 'minion',
    anims: { run: 'minion_melee_run', idle: 'minion_melee_idle', death: 'minion_melee_death', attacks: ['minion_melee_attack', 'minion_melee_attack2'] },
  },
  minion_caster: {
    model: 'minion_caster', hp: 45, speed: 240, damage: 15, attackRange: 450, attackCooldown: 1.6, windup: 0.45, ranged: 650,
    xp: 1, radius: 48, tier: 'minion',
    anims: { run: 'minion_caster_run', idle: 'minion_caster_idle', death: 'minion_caster_chaos_death', attacks: ['minion_caster_attack', 'minion_caster_attack2'] },
  },
  minion_siege: {
    model: 'minion_siege', hp: 160, speed: 220, damage: 30, attackRange: 250, attackCooldown: 2, windup: 0.5, ranged: 800,
    xp: 4, radius: 65, tier: 'minion',
    anims: { run: 'cannon_chaos_run1', idle: 'cannon_chaos_idle1', death: 'cannon_chaos_death1', attacks: ['cannon_chaos_attack1', 'cannon_chaos_attack2'] },
  },
  minion_super: {
    model: 'minion_super', hp: 400, speed: 260, damage: 40, attackRange: 100, attackCooldown: 1.4, windup: 0.4,
    xp: 10, radius: 70, tier: 'minion',
    anims: { run: 'superminion_red_run', idle: 'superminion_red_run', death: 'superminion_red_death', attacks: ['superminion_red_attack1', 'superminion_red_attack2'] },
  },
  razorbeak_mini: {
    model: 'razorbeak_mini', hp: 50, speed: 340, damage: 8, attackRange: 50, attackCooldown: 1.2, windup: 0.3,
    xp: 1, radius: 40, tier: 'monster',
    anims: { run: 'sru_razorbeakmini_run', idle: 'sru_razorbeakmini_idle_aggro1', death: 'sru_razorbeakmini_death', attacks: ['sru_razorbeakmini_attack1', 'sru_razorbeakmini_attack2'] },
  },
  razorbeak: {
    model: 'razorbeak', hp: 300, speed: 300, damage: 25, attackRange: 300, attackCooldown: 1.5, windup: 0.4, ranged: 750,
    xp: 15, radius: 70, tier: 'monster',
    anims: { run: 'sru_razorbeak_run', idle: 'sru_razorbeak_idle_aggro1', death: 'sru_razorbeak_death', attacks: ['sru_razorbeak_ranged_attack1', 'sru_razorbeak_ranged_attack2'] },
  },
  murkwolf: {
    model: 'murkwolf', hp: 260, speed: 300, damage: 30, attackRange: 60, attackCooldown: 1.25, windup: 0.35,
    xp: 8, radius: 70, tier: 'monster',
    anims: { run: 'sru_murkwolf_run', idle: 'sru_murkwolf_idle_aggro1', death: 'sru_murkwolf_death', attacks: ['sru_murkwolf_attack1', 'sru_murkwolf_attack2', 'sru_murkwolf_attack3'] },
  },
  krug: {
    model: 'krug', hp: 600, speed: 200, damage: 45, attackRange: 80, attackCooldown: 1.6, windup: 0.5,
    xp: 15, radius: 90, tier: 'monster',
    anims: { run: 'krug_run2', idle: 'krug_idle_aggro', death: 'krug_death', attacks: ['krug_attack1', 'krug_attack2', 'krug_attack3'] },
  },
  gromp: {
    model: 'gromp', hp: 450, speed: 260, damage: 35, attackRange: 200, attackCooldown: 1.5, windup: 0.4, ranged: 700,
    xp: 15, radius: 90, tier: 'monster', hide: ['Toad_Spawn_Mat', 'SRU_Gromp_mini_mat'],
    anims: { run: 'sru_gromp_run', idle: 'sru_gromp_idle1_aggro', death: 'sru_gromp_death', attacks: ['sru_gromp_attack1', 'sru_gromp_attack1b'] },
  },
  blue: {
    model: 'blue', hp: 1500, speed: 230, damage: 60, attackRange: 100, attackCooldown: 1.6, windup: 0.5,
    xp: 50, radius: 120, tier: 'elite',
    anims: { run: 'sru_blue_run', idle: 'sru_blue_idle_aggro', death: 'sru_blue_death', attacks: ['sru_blue_attack1', 'sru_blue_attack2', 'sru_blue_attack3'] },
  },
  red: {
    model: 'red', hp: 1500, speed: 230, damage: 70, attackRange: 100, attackCooldown: 1.6, windup: 0.5,
    xp: 50, radius: 120, tier: 'elite',
    anims: { run: 'sru_red_run', idle: 'sru_red_idle1_aggro', death: 'sru_red_death', attacks: ['sru_red_attack1', 'sru_red_attack2', 'sru_red_attack3'] },
  },
  scuttle: {
    // Rift Scuttler never fights in LoL; here it charges in and rams with its dash clip
    model: 'scuttle', name: 'Aronguejo', hp: 5000, speed: 330, damage: 80, attackRange: 90, attackCooldown: 1.4, windup: 0.45,
    xp: 100, radius: 120, tier: 'epic',
    anims: { run: 'sru_crab_run2', idle: 'sru_crab_idle1', death: 'sru_crab_burrow', attacks: ['sru_crab_dash'] },
  },
  riftherald: {
    model: 'riftherald', name: 'Arauto do Vale', hp: 12000, speed: 280, damage: 90, attackRange: 120, attackCooldown: 1.5, windup: 0.5,
    xp: 150, radius: 150, tier: 'epic',
    anims: { run: 'sru_riftherald_run', idle: 'sru_riftherald_angry_idle', death: 'sru_riftherald_death', attacks: ['sru_riftherald_attack1', 'sru_riftherald_attack2'] },
  },
  baron: {
    // Baron never moves (as in LoL); its abilities are driven by BARON in game.ts, not the generic attack loop
    model: 'baron', name: 'Barão Na\'Shor', hp: 150000, speed: 0, damage: 0, attackRange: 0, attackCooldown: 0, windup: 0,
    xp: 500, radius: 250, tier: 'epic', hide: ['Horn', 'Eye'], // LoL hides these submeshes (initialSubmeshToHide)
    anims: { run: 'sru_baron_idle1_aggro', idle: 'sru_baron_idle1_aggro', death: 'sru_baron_death', attacks: ['sru_baron_attack1', 'sru_baron_attack2'] },
  },
};

const DRAGON_SCALE = 1.5; // drakes tower over champions on the Rift; the raw meshes are herald-sized

// Elemental drakes: the 10:00 'dragon' event rolls one of them, like the Rift. Their buffs are not implemented yet.
export const DRAGONS: { model: string; name: string; mesh?: string }[] = [
  { model: 'dragon_earth', name: 'Dragão da Montanha', mesh: 'dragon_air' },
  { model: 'dragon_air', name: 'Dragão das Nuvens' },
  { model: 'dragon_water', name: 'Dragão do Oceano' },
  { model: 'dragon_hextech', name: 'Dragão Hextech' },
  { model: 'dragon_fire', name: 'Dragão Infernal', mesh: 'dragon_air' },
  { model: 'dragon_chemtech', name: 'Dragão Quimtech' },
];
for (const d of DRAGONS) {
  ENEMIES[d.model] = {
    ...d, hp: 9000, speed: 260, damage: 110, attackRange: 600, attackCooldown: 2, windup: 0.6, ranged: 900,
    xp: 150, radius: 250, scale: DRAGON_SCALE, tier: 'epic',
    // flying_spell1 is left out: it converts with a 90° twist
    anims: { run: 'sru_dragon_flying_run', idle: 'sru_dragon_idle_aggro1', death: 'sru_dragon_death', attacks: ['sru_dragon_flying_attack1'] },
  };
}

// Spawn pool: which enemies can appear when, and how often relative to each other (weight).
// The spawn director (game.ts) decides how many spawn; this only decides which.
// `to: Infinity`: the pool must never be empty before the Baron arena stops spawns
export const POOL: { enemy: string; from: number; to: number; weight: number }[] = [
  { enemy: 'minion_melee', from: 0, to: Infinity, weight: 6 },
  { enemy: 'minion_caster', from: 45, to: Infinity, weight: 3 },
  { enemy: 'minion_siege', from: 150, to: Infinity, weight: 0.5 },
  { enemy: 'razorbeak_mini', from: 180, to: Infinity, weight: 4 },
  { enemy: 'murkwolf', from: 240, to: Infinity, weight: 1.5 },
  { enemy: 'krug', from: 360, to: Infinity, weight: 0.8 },
  { enemy: 'gromp', from: 420, to: Infinity, weight: 0.6 },
  { enemy: 'razorbeak', from: 480, to: Infinity, weight: 0.8 },
  { enemy: 'minion_super', from: 600, to: Infinity, weight: 0.7 },
];

// Spawn director. Enemies/second = base rate (level + time) x performance (share of recent spawns the player killed).
export const DIRECTOR = {
  baseRate: (time: number, level: number) => 0.45 + 0.04 * (level - 1) + time / 450,
  window: 20, // seconds of history used to measure kill performance
  perfMin: 0.6, perfMax: 1.3, // rate multiplier when falling behind / keeping up
  maxAlive: (time: number, level: number) => 12 + 2 * level + time / 8,
};

// Every 2 minutes a big wave closes in as a ring around the player, announced a few seconds early.
export const HORDE = {
  every: 120,
  warning: 6,
  size: (level: number) => 15 + 2 * level,
  radius: 1500,
  gap: 0.25, // fraction of the ring left open as an escape route
};

// Bosses at 5/10/15/20 min; blue and red buffs fill the gaps between them
export const EVENTS: { at: number; enemy: string }[] = [
  { at: 300, enemy: 'scuttle' },
  { at: 450, enemy: 'blue' },
  { at: 600, enemy: 'dragon' },
  { at: 750, enemy: 'red' },
  { at: 900, enemy: 'riftherald' },
  { at: 1050, enemy: 'blue' },
  { at: 1050, enemy: 'red' },
  { at: 1200, enemy: 'baron' },
];

// Baron Nashor final fight: a closed arena, nearly every hit is lethal and every ability except the bite is telegraphed.
export const BARON = {
  arenaRadius: 1500,
  spawnOffset: 700, // Baron spawns this far from Ezreal, both inside the arena
  gap: 1.4, // seconds between abilities
  lethal: 1e6,
  pullSpeed: 2500, // tentacle drags Ezreal back in when he gets out (e.g. Arcane Shift over the wall)
  knockup: { cast: 1, count: 7, radius: 170, spread: 650, damage: 500, stun: 1.25 },
  tentacle: { cast: 1.1, radius: 160 },
  spit: { cast: 0.9, speed: 1500, radius: 70, range: 2800 },
  melee: { range: 260, biteChance: 0.33 }, // edge distance that triggers bite (33%) or whip
  whip: { cast: 0.7, radius: 650, arc: Math.PI * 0.6, damage: 0.75 }, // 75% max HP, never lethal
  anims: { knockup: 'sru_baron_spell6', tentacle: 'sru_baron_spell3', spit: 'sru_baron_attack1', whip: 'sru_baron_attack2', bite: 'sru_baron_attack1_melee' },
};

export const ENEMY_ARMOR = { minion: 0, monster: 10, elite: 30, epic: 120 }; // LoL minions have no armor
export const enemyArmorScale = (time: number) => 1 + time / 450;

export const RUN_LENGTH = 1200; // baron spawns at 20:00; killing it wins the run
export const MAX_ENEMIES = 260;
// Survivors curve: base HP is one basic attack early on; enemies toughen as Ezreal levels and the clock runs.
// Epic monsters keep fixed HP (they are tuned as boss fights).
export const enemyHpScale = (time: number, level: number) => (1 + 0.08 * (level - 1)) * (1 + time / 900);
export const enemyDamageScale = (time: number) => 1 + time / 600;
export const ENEMY_MISSILE_EXTRA_RANGE = 400; // skillshots fly this far past the attack range
export const xpToNext = (level: number) => 5 + (level - 1) * 5;
