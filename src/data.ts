// Game data: enemies, spawns and the run timeline. Champions live in src/champions/, item passives in src/itemEffects.ts.
// Enemy numbers are tuned for the survivors-like genre (many weak enemies), keeping LoL relative scale.
import { t } from './i18n';

export interface EnemyDef {
  model: string;
  mesh?: string; // .glb to load when this model only swaps the texture of another one
  name?: string; // shown on the boss bar (a src/locales key's text)
  hp: number;
  speed: number;
  damage: number;
  damageMax?: number; // fixed hit damage rolled in [damage, damageMax], not scaled by enemyDamageScale (epic monsters)
  attackRange: number; // edge-to-edge distance
  attackCooldown: number;
  windup: number;
  ranged?: number; // projectile speed for ranged attackers (fixed-direction skillshot)
  missileRadius?: number; // projectile hit radius (default 25)
  xp: number;
  radius: number;
  scale?: number;
  tier: 'minion' | 'monster' | 'elite' | 'epic';
  armor?: number; // defaults by tier (ENEMY_ARMOR)
  immovable?: boolean; // unit collision never pushes it
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
    model: 'scuttle', name: t('enemy.scuttle'), hp: 5000, speed: 330, damage: 150, damageMax: 250, attackRange: 90, attackCooldown: 1.4, windup: 0.45,
    xp: 100, radius: 120, tier: 'epic',
    anims: { run: 'sru_crab_run2', idle: 'sru_crab_idle1', death: 'sru_crab_burrow', attacks: ['sru_crab_dash'] },
  },
  riftherald: {
    model: 'riftherald', name: t('enemy.riftherald'), hp: 12000, speed: 280, damage: 1000, damageMax: 1500, attackRange: 120, attackCooldown: 1.5, windup: 0.5,
    xp: 150, radius: 150, tier: 'epic',
    anims: { run: 'sru_riftherald_run', idle: 'sru_riftherald_angry_idle', death: 'sru_riftherald_death', attacks: ['sru_riftherald_attack1', 'sru_riftherald_attack2'] },
  },
  baron: {
    // Baron never moves (as in LoL); its abilities are driven by src/enemies/baron.ts, not the generic attack loop
    model: 'baron', name: t('enemy.baron'), hp: 70000, speed: 0, damage: 0, attackRange: 0, attackCooldown: 0, windup: 0,
    xp: 500, radius: 250, tier: 'epic', immovable: true, hide: ['Horn', 'Eye'], // LoL hides these submeshes (initialSubmeshToHide)
    anims: { run: 'sru_baron_idle1_aggro', idle: 'sru_baron_idle1_aggro', death: 'sru_baron_death', attacks: ['sru_baron_attack1', 'sru_baron_attack2'] },
  },
};

const DRAGON_SCALE = 1.5; // drakes tower over champions on the Rift; the raw meshes are herald-sized

// Elemental drakes: the 10:00 'dragon' event rolls one of them, like the Rift. Their buffs are not implemented yet.
export const DRAGONS: { model: string; name: string; mesh?: string }[] = [
  { model: 'dragon_earth', name: t('enemy.dragon_earth'), mesh: 'dragon_air' },
  { model: 'dragon_air', name: t('enemy.dragon_air') },
  { model: 'dragon_water', name: t('enemy.dragon_water') },
  { model: 'dragon_hextech', name: t('enemy.dragon_hextech') },
  { model: 'dragon_fire', name: t('enemy.dragon_fire'), mesh: 'dragon_air' },
  { model: 'dragon_chemtech', name: t('enemy.dragon_chemtech') },
];
for (const d of DRAGONS) {
  ENEMIES[d.model] = {
    ...d, hp: 9000, speed: 260, damage: 200, damageMax: 350, attackRange: 600, attackCooldown: 2.4, windup: 0.6, ranged: 1100, missileRadius: 90,
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

// Bosses at 5/10/15/20 min; blue and red respawn on their own timer (BUFF in src/buffs.ts)
export const EVENTS: { at: number; enemy: string }[] = [
  { at: 300, enemy: 'scuttle' },
  { at: 600, enemy: 'dragon' },
  { at: 900, enemy: 'riftherald' },
  { at: 1200, enemy: 'baron' },
];

// Baron Nashor final fight: a closed arena, nearly every hit is lethal and every ability except the bite is telegraphed.
export const BARON = {
  arenaRadius: 1500,
  spawnOffset: 1100, // Baron spawns this far from the champion (well outside bite range); the arena is centred between them
  gap: 1.4, // seconds between abilities
  lethal: 1e6,
  pullSpeed: 2500, // tentacle drags Ezreal back in when he gets out (e.g. Arcane Shift over the wall)
  knockup: { cast: 1, count: 7, radius: 170, spread: 650, damage: 500, stun: 1.25 },
  tentacle: { cast: 1.1, radius: 160 },
  spit: { cast: 0.9, speed: 1500, radius: 70, range: 2800 },
  melee: { range: 260, biteChance: 0.33 }, // edge distance that triggers bite (33%) or whip
  bite: { cast: 0.5, radius: 420 }, // lands with the clip; lethal if the champion is still within `radius` (edge)
  whip: { cast: 0.7, radius: 650, arc: Math.PI * 0.6, damage: 0.75 }, // 75% max HP, never lethal
  anims: { knockup: 'sru_baron_spell6', tentacle: 'sru_baron_spell3', spit: 'sru_baron_attack1', whip: 'sru_baron_attack2', bite: 'sru_baron_attack1_melee' },
};

export const ENEMY_ARMOR = { minion: 0, monster: 10, elite: 30, epic: 120 }; // LoL minions have no armor
export const ENEMY_MR = { minion: 0, monster: 5, elite: 15, epic: 60 }; // half the armor: magic damage was unmitigated before MR
export const enemyArmorScale = (time: number) => 1 + time / 450;

export const RUN_LENGTH = 1200; // baron spawns at 20:00; killing it wins the run
/** An enemy's bound object size for FlexShape VFX (League scales hit effects to the target): about its visual diameter. */
export const boundSize = (e: { def: EnemyDef }) => e.def.radius * 4;
export const MAX_ENEMIES = 260;
// Survivors curve: base HP is one basic attack early on; enemies toughen as Ezreal levels and the clock runs.
// Epic monsters keep fixed HP (they are tuned as boss fights).
export const enemyHpScale = (time: number, level: number) => (1 + 0.08 * (level - 1)) * (1 + time / 900);
// Flat for the first 2 minutes, then +1x every 4 minutes. `crowd` (enemies in contact with the champion) adds
// +10% per enemy past the third, up to +150%, so getting surrounded is what kills.
export const enemyDamageScale = (time: number, crowd = 0) =>
  (1 + Math.max(0, time - 120) / 240) * (1 + Math.min(1.5, 0.1 * Math.max(0, crowd - 3)));
export const CROWD_RANGE = 120; // edge distance at which an enemy counts as in contact for enemyDamageScale
export const HP_REGEN_MULT = 0.5; // champions regenerate half their LoL base Health regen
export const ENEMY_MISSILE_EXTRA_RANGE = 400; // skillshots fly this far past the attack range
export const xpToNext = (level: number) => 5 + (level - 1) * 5;
