// Teemo. Numbers mirror League of Legends (source: Meraki Analytics champion JSON and the skin bins).
// Adapted for hordes: Guerrilla Warfare never turns Teemo invisible. Standing still for 2s camouflages him instead
// (stealth idle pose): Element of Surprise's attack speed is on while he stays still and for 5s after he moves.
// Blinding Dart costs less (40-60 mana instead of 70-90) and always blinds for the doubled minion/monster duration,
// since every enemy here is one (the bosses' own AI ignores it, like stuns). Move Quick's passive speed is never lost
// (no enemy champions nor turrets). Toxic Shot is a passive skill (the E key casts nothing).
// Noxious Trap holds up to 3 charges at every rank (LoL: 3/4/5), recharged one after the other in 15/12.5/10s (LoL: 30/25/20s, halved like Gangplank's kegs; ability
// haste shortens it). A mushroom arms 1s after landing, lasts 5 min and explodes when an enemy steps on it: its full
// damage at once in a 400 radius (LoL: a 4s poison), slowing for 4s. Landing on another mushroom bounces it forward.
import * as THREE from 'three';
import { Actor, loadModel } from '../assets';
import { audio } from '../audio';
import type { ChampionDef, ChampionKit, Hit, SkillDef, SkillKey } from '../champion';
import type { Enemy, Game } from '../game';
import { t } from '../i18n';

const ICON = 'https://ddragon.leagueoflegends.com/cdn/16.21.1/img';

const PASSIVE = {
  still: 2, // seconds standing still that camouflage Teemo (LoL: 1.5s to stealth)
  duration: 5, // Element of Surprise after he moves again
  attackSpeed: [0.2, 0.4, 0.6, 0.8], levels: [1, 5, 10, 15],
};

const SKILLS = {
  Q: {
    name: t('champion.teemo.Q'), desc: t('champion.teemo.Q.desc'), damageType: 'magic', maxRank: 5, anim: 'spell1', icon: `${ICON}/spell/TeemoQ.png`,
    cooldown: [7, 7, 7, 7, 7], cost: [40, 45, 50, 55, 60],
    damage: [80, 125, 170, 215, 260], apRatio: 0.7, blind: [4, 4.5, 5, 5.5, 6],
    extra: { label: t('champion.teemo.blind'), values: [4, 4.5, 5, 5.5, 6] },
    range: 680, aim: 680, speed: 2500, castTime: 0.25,
  },
  W: {
    name: t('champion.teemo.W'), desc: t('champion.teemo.W.desc'), damageType: 'magic', maxRank: 5, anim: 'spell2', icon: `${ICON}/spell/TeemoW.png`,
    cooldown: [14, 14, 14, 14, 14], cost: [40, 40, 40, 40, 40],
    damage: [0, 0, 0, 0, 0], speed: [0.12, 0.16, 0.2, 0.24, 0.28], duration: 3, // the active doubles the speed
    extra: { label: t('stat.ms'), values: [0.12, 0.16, 0.2, 0.24, 0.28], percent: true },
    aim: 'none', castTime: 0.05,
  },
  E: {
    name: t('champion.teemo.E'), desc: t('champion.teemo.E.desc'), damageType: 'magic', maxRank: 5, anim: 'spell1', icon: `${ICON}/spell/TeemoE.png`,
    cooldown: [0, 0, 0, 0, 0], cost: [0, 0, 0, 0, 0],
    damage: [9, 23, 37, 51, 65], apRatio: 0.3, // on-hit
    poison: [6, 12, 18, 24, 30], poisonApRatio: 0.1, ticks: 4, monsterMult: 1.45, // per second over 4s
    extra: { label: t('champion.teemo.poison'), values: [24, 48, 72, 96, 120] },
    maxPoisonFx: 30, // particle budget: past it, enemies still take the poison without its cloud
    aim: 'none', castTime: 0.05,
  },
  R: {
    name: t('champion.teemo.R'), desc: t('champion.teemo.R.desc'), damageType: 'magic', maxRank: 3, anim: 'spell4_0', icon: `${ICON}/spell/TeemoR.png`,
    cooldown: [0.25, 0.25, 0.25], cost: [75, 55, 35], // lockout between casts; charges recharge on their own
    charges: 3, recharge: [15, 12.5, 10], extra: { label: t('champion.teemo.recharge'), values: [15, 12.5, 10] },
    damage: [200, 325, 450], apRatio: 0.5, slow: [0.3, 0.4, 0.5], slowDuration: 4,
    range: [600, 750, 900], aim: 900, speed: 1000, arc: 250, radius: 400, castTime: 0.25,
    arm: 1, life: 300, trigger: 135, // the trigger ring's authored radius
    bounce: [350, 450, 550], bounceHit: 75, // landing within bounceHit of a mushroom bounces this far forward
    maxSlowFx: 20,
  },
} as const satisfies Record<SkillKey, SkillDef & Record<string, unknown>>; // extra fields are the kit's own numbers

const HITS = {
  Q: { type: 'magic', source: 'ability', skill: 'Q' },
  R: { type: 'magic', source: 'ability', skill: 'R' },
  poison: { type: 'magic', source: 'item' }, // Toxic Shot's ticks trigger nothing
} as const satisfies Record<string, Hit>;

export const TEEMO: ChampionDef = {
  id: 'teemo', name: t('champion.teemo.name'), model: 'teemo', icon: `${ICON}/champion/Teemo.png`,
  title: t('champion.teemo.title'), splash: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Teemo_0.jpg',
  roles: ['marksman', 'mage'], difficulty: 6,
  hide: ['Mushroom', 'Harmonica'],
  itemPool: 'ap',
  // on-hit AP: Nashor's Tooth, Liandry's, Riftmaker; then Rabadon's, Void Staff, Shadowflame
  build: ['3115', '6653', '4633', '3089', '3135', '4645'],
  base: {
    hp: 615, hpPerLevel: 104,
    hpRegen5: 5.5, hpRegen5PerLevel: 0.65,
    mana: 334, manaPerLevel: 25,
    manaRegen5: 9.6, manaRegen5PerLevel: 0.45,
    ad: 54, adPerLevel: 3,
    attackSpeed: 0.69, attackSpeedPerLevel: 0.0338,
    attackRange: 500,
    moveSpeed: 330,
    critDamage: 1.75,
    windupPercent: 0.3 / 1.6,
    missileSpeed: 1500,
    radius: 55,
    armor: 24, armorPerLevel: 4.95,
  },
  skills: SKILLS,
  passive: { name: t('champion.teemo.passive'), icon: `${ICON}/passive/TeemoPassive.png` },
  anims: { idle: 'idle', run: 'run', death: 'death', attacks: ['attack1'], crit: 'crit' },
  vfx: { auto: 'Teemo_BA_mis', crit: 'Teemo_BA_mis', autoHit: 'Teemo_BA_tar', critHit: 'Teemo_BA_tar' },
  animVfx: true, // the death explosion
  kit: teemoKit,
};

/** A Noxious Trap: flying (and bouncing) to where it lands, then waiting for an enemy to step on it. */
interface Trap {
  rank: number;
  from: THREE.Vector3;
  at: THREE.Vector3;
  dir: THREE.Vector3; // toss direction, for bounces
  flight: number; // seconds of the current toss
  age: number; // seconds into the current toss
  armAt: number; // run time it can trigger, -1 while flying
  expireAt: number;
  mis: THREE.Object3D | null;
  actor: Actor | null; // the mushroom, null while flying or if its model is still downloading
  fx: THREE.Object3D[];
}

function teemoKit(g: Game): ChampionKit {
  loadModel('teemomushroom', [], 'teemomushroom').catch(() => {}); // the bomb, wanted from level 6
  const near: Enemy[] = []; // own query array: hurtEnemy may run item effects that query too
  const flat = new THREE.Vector3();
  const poisons = new Map<Enemy, { ticks: number; tick: number; rank: number; fx: THREE.Object3D | null }>();
  const timed: { fx: THREE.Object3D; e: Enemy; until: number }[] = []; // blind and slow debuffs riding enemies
  const traps: Trap[] = [];
  let poisonFx = 0, slowFx = 0;
  let charges = 0, recharging = 0, ultLearned = false; // recharging: progress (0..1) of the next charge
  let camo = false, surpriseUntil = -Infinity;
  let quickUntil = -Infinity, quickFx: THREE.Object3D | null = null;

  const surprise = () => {
    let i = 0;
    while (i + 1 < PASSIVE.levels.length && g.level >= PASSIVE.levels[i + 1]) i++;
    return PASSIVE.attackSpeed[i];
  };
  const surprised = () => camo || g.time < surpriseUntil;
  const inReach = (e: Enemy, from: THREE.Vector3, r: number) => e.deadFor < 0 && e.pos.distanceTo(from) - e.def.radius <= r;
  /** Target of Blinding Dart: the enemy under the cursor if in range, else the one nearest the cursor in range. */
  const targetFor = (point: THREE.Vector3, range: number) => {
    const at = g.enemyAt(point);
    if (at && inReach(at, g.pos, range)) return at;
    return g.nearestEnemy(point, 3000, (e) => inReach(e, g.pos, range));
  };
  const follow = (key: string, e: Enemy, seconds: number) => {
    const fx = g.vfx.attach(key);
    fx.position.copy(e.pos).setY(0);
    g.scene.add(fx);
    timed.push({ fx, e, until: g.time + seconds });
    return fx;
  };
  const playAt = (key: string, at: THREE.Vector3) => {
    const fx = g.vfx.attach(key);
    fx.position.copy(at);
    g.scene.add(fx);
    return fx;
  };

  const poison = (e: Enemy) => {
    const r = g.ranks.E - 1;
    let p = poisons.get(e);
    if (!p) {
      let fx: THREE.Object3D | null = null;
      if (poisonFx < SKILLS.E.maxPoisonFx) { fx = g.vfx.attach('Teemo_E_Poison'); g.scene.add(fx); poisonFx++; }
      poisons.set(e, (p = { ticks: 0, tick: 1, rank: r, fx }));
    }
    p.ticks = SKILLS.E.ticks; // refreshes the duration
    p.tick = 1;
    p.rank = r;
  };
  const unpoison = (e: Enemy) => {
    const p = poisons.get(e);
    if (p?.fx) { p.fx.removeFromParent(); poisonFx--; }
    poisons.delete(e);
  };
  const monster = (e: Enemy) => (e.def.tier === 'minion' ? 1 : SKILLS.E.monsterMult);

  const toss = (x: Trap, from: THREE.Vector3, to: THREE.Vector3) => {
    x.from.copy(from);
    x.at.copy(to);
    x.flight = Math.max(0.1, Math.hypot(to.x - from.x, to.z - from.z) / SKILLS.R.speed);
    x.age = 0;
  };
  const land = (x: Trap) => {
    const R = SKILLS.R;
    if (traps.some((o) => o !== x && o.armAt >= 0 && Math.hypot(o.at.x - x.at.x, o.at.z - x.at.z) < R.bounceHit)) {
      // on top of another mushroom: bounce forward (again and again while it keeps landing on mushrooms)
      const from = x.at.clone();
      g.vfx.playAt('Teemo_R_Mis_Bounce', from);
      audio.playAt('teemo_R_bounce', from, g.pos);
      toss(x, from, from.clone().addScaledVector(x.dir, R.bounce[x.rank]));
      return;
    }
    x.mis?.removeFromParent();
    x.mis = null;
    x.armAt = g.time + R.arm;
    x.expireAt = g.time + R.life;
    g.vfx.playAt('Teemo_R_GroundImpact_Dust', x.at);
    x.fx.push(playAt('Teemo_R_CollisionBox_Ring', x.at), playAt('Teemo_R_Firefly_GroundLight', x.at));
    audio.playAt('teemo_R_arm', x.at, g.pos);
    try { x.actor = new Actor('teemomushroom'); } catch { return; } // model still downloading: the bomb works without it
    x.actor.root.position.copy(x.at);
    x.actor.root.rotation.y = g.facing;
    x.actor.play('spawn', { loop: false });
    g.scene.add(x.actor.root);
  };

  const explode = (x: Trap) => {
    const R = SKILLS.R;
    clearTrap(x);
    g.vfx.playAt('Teemo_R_Mushroom_Killed', x.at);
    g.vfx.playAt('Teemo_R_tar', x.at);
    audio.playAt('teemo_R_hit', x.at, g.pos);
    const damage = R.damage[x.rank] + R.apRatio * g.ap;
    for (const e of g.enemiesNear(x.at, R.radius, near)) {
      if (!inReach(e, x.at, R.radius)) continue;
      g.slow(e, R.slow[x.rank], R.slowDuration);
      if (slowFx < R.maxSlowFx) { slowFx++; follow('Teemo_R_Debuff', e, R.slowDuration).userData.slow = true; }
      g.hurtEnemy(e, damage, HITS.R);
    }
  };
  const clearTrap = (x: Trap) => {
    x.mis?.removeFromParent();
    x.actor?.dispose();
    for (const o of x.fx) o.removeFromParent();
    x.fx.length = 0;
  };

  const quickEnd = () => {
    quickFx?.removeFromParent();
    quickFx = null;
  };

  return {
    attackSpeedBonus: () => (surprised() ? surprise() : 0),
    moveSpeedBonus() {
      if (g.ranks.W === 0) return 0;
      const s = SKILLS.W.speed[g.ranks.W - 1];
      return g.time < quickUntil ? 2 * s : s;
    },
    moveAnims: () => (camo ? { idle: 'idle_stealth_loop', run: 'run' } : undefined),
    hud: () => t(surprised() ? 'champion.teemo.hud.on' : 'champion.teemo.hud.off', { n: Math.round(surprise() * 100) }),
    gauge: () => ({
      label: `${Math.round(surprise() * 100)}%`,
      fill: surprised() ? (camo ? 1 : Math.max(0, surpriseUntil - g.time) / PASSIVE.duration) : Math.min(1, g.stillFor / PASSIVE.still),
      ready: surprised(),
    }),

    canCast(key) {
      if (key === 'E') return false; // Toxic Shot is passive
      if (key === 'Q') return g.nearestEnemy(g.pos, SKILLS.Q.range) !== null;
      if (key === 'R') return charges > 0;
      return true;
    },

    castStart(key) {
      if (key !== 'R') return;
      charges--; // spent at the start: a stun that cancels the cast loses it, like the mana
      g.vfx.playAt('Teemo_R_Cas', g.pos.clone().setY(0), g.facing, { owner: g.player.root });
    },

    skillView: (key) => (key === 'R' && g.ranks.R > 0 ? { badge: String(charges) } : undefined),

    cast(key, r, point) {
      if (key === 'Q') {
        const q = SKILLS.Q;
        const target = targetFor(point, q.range);
        if (!target) return;
        audio.play('teemo_Q_launch');
        g.spawnMissile('Teemo_Q_mis', g.pos, target.pos, {
          speed: q.speed, range: 3000, radius: 10, damage: q.damage[r] + q.apRatio * g.ap, target, hit: HITS.Q,
          hitFx: 'Teemo_Q_tar', hitSound: 'teemo_Q_hit',
          onHit: (e, m) => {
            g.impact(e, m);
            if (e.deadFor >= 0) return;
            g.blindEnemy(e, q.blind[r]);
            follow('Teemo_Q_debuf', e, q.blind[r]);
          },
        });
      } else if (key === 'W') {
        quickUntil = g.time + SKILLS.W.duration;
        quickEnd();
        quickFx = g.vfx.attach('Teemo_W_buf2');
        quickFx.position.copy(g.pos).setY(0);
        g.scene.add(quickFx);
      } else if (key === 'R') {
        const R = SKILLS.R;
        const off = flat.copy(point).sub(g.pos).setY(0);
        if (off.length() > R.range[r]) off.setLength(R.range[r]);
        const at = g.pos.clone().add(off).setY(0);
        const dir = off.lengthSq() > 1 ? off.clone().normalize() : new THREE.Vector3(Math.sin(g.facing), 0, Math.cos(g.facing));
        const mis = g.vfx.attach('Teemo_R_Mis');
        const from = g.pos.clone().setY(100);
        mis.position.copy(from);
        g.scene.add(mis);
        audio.play('teemo_R_launch');
        const x: Trap = { rank: r, from: new THREE.Vector3(), at: new THREE.Vector3(), dir, flight: 0, age: 0, armAt: -1, expireAt: Infinity, mis, actor: null, fx: [] };
        toss(x, from, at);
        traps.push(x);
      }
    },

    // Toxic Shot: Teemo's autos fire the poison dart
    attackStart(_target, crit) {
      if (g.ranks.E === 0) return undefined;
      return { sound: crit ? 'teemo_E_crit' : 'teemo_E_auto' };
    },
    basicAttack(target, damage, crit, bolt) {
      if (g.ranks.E === 0) return false;
      g.spawnMissile('Teemo_E_mis', g.pos, target.pos, {
        speed: TEEMO.base.missileSpeed, range: 3000, radius: 10, damage, target,
        hit: { type: 'physical', source: 'auto', onHit: true, crit, bolt },
        hitFx: 'Teemo_E_Tar', hitSound: crit ? 'teemo_E_crit_hit' : 'teemo_E_hit',
      });
      return true;
    },

    onDamage(e, hit) {
      if (g.ranks.E === 0 || hit.source !== 'auto' || !hit.onHit) return 0;
      const E = SKILLS.E;
      poison(e);
      return (E.damage[g.ranks.E - 1] + E.apRatio * g.ap) * monster(e);
    },

    update(dt) {
      // Guerrilla Warfare: camouflaged after standing still, surprise lasts a while after moving
      const still = g.stillFor >= PASSIVE.still && g.alive;
      if (still && !camo) {
        g.vfx.playAt('Teemo_P_cas', g.pos.clone().setY(0), g.facing, { owner: g.player.root });
        audio.play('teemo_P');
      } else if (!still && camo) {
        surpriseUntil = g.time + PASSIVE.duration;
        audio.play('teemo_P_end');
      }
      camo = still;

      if (quickFx) {
        if (g.time >= quickUntil || !g.alive) { quickEnd(); audio.play('teemo_W_end'); }
        else quickFx.position.copy(g.pos).setY(0);
      }

      const E = SKILLS.E;
      for (const [e, p] of poisons) {
        if (e.deadFor >= 0) { unpoison(e); continue; }
        p.fx?.position.copy(e.pos).setY(0);
        if ((p.tick -= dt) > 0) continue;
        p.tick += 1;
        p.ticks--;
        g.hurtEnemy(e, (E.poison[p.rank] + E.poisonApRatio * g.ap) * monster(e), HITS.poison);
        if (p.ticks <= 0) unpoison(e);
      }

      for (let i = timed.length - 1; i >= 0; i--) {
        const x = timed[i];
        if (x.e.deadFor >= 0 || g.time >= x.until) {
          if (x.fx.userData.slow) slowFx--;
          x.fx.removeFromParent();
          timed.splice(i, 1);
        } else x.fx.position.copy(x.e.pos).setY(0);
      }

      // Noxious Trap charges: one recharges at a time
      const R = SKILLS.R;
      if (g.ranks.R > 0) {
        if (!ultLearned) { ultLearned = true; charges = 1; }
        const r = g.ranks.R - 1;
        const time = R.recharge[r] * (g.cooldownOf('R') / R.cooldown[r]); // ability haste shortens it too
        if (charges < R.charges && (recharging += dt / time) >= 1) { charges++; recharging = 0; }
        if (charges === 0) g.cooldowns.R = Math.max(g.cooldowns.R, (1 - recharging) * time);
      }

      const trigger = (e: Enemy, x: Trap) => inReach(e, x.at, R.trigger);
      for (let i = traps.length - 1; i >= 0; i--) {
        const x = traps[i];
        x.age += dt;
        x.actor?.update(dt);
        if (x.mis) {
          // lobbed toss: straight line plus a parabola
          const k = Math.min(1, x.age / x.flight);
          x.mis.position.lerpVectors(x.from, x.at, k);
          x.mis.position.y += R.arc * 4 * k * (1 - k);
          if (k >= 1) land(x);
          continue;
        }
        if (x.actor && x.actor.currentName === 'spawn' && x.age > x.flight + x.actor.duration('spawn')) x.actor.play('idle');
        if (g.time >= x.expireAt) {
          clearTrap(x);
          traps.splice(i, 1);
        } else if (g.time >= x.armAt && g.nearestEnemy(x.at, R.trigger + 300, (e) => trigger(e, x))) {
          explode(x);
          traps.splice(i, 1);
        }
      }
    },

    dispose() {
      for (const e of [...poisons.keys()]) unpoison(e);
      for (const x of timed) x.fx.removeFromParent();
      for (const x of traps) clearTrap(x);
      quickEnd();
      timed.length = 0;
      traps.length = 0;
      slowFx = 0;
    },
  };
}
