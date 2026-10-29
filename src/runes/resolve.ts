import { ADAPTIVE_AD, isBig, RUNE_HIT, RUNE_MAGIC, runeList } from './def';

const AFTERSHOCK_RADIUS = 350;

export const RESOLVE = runeList('resolve', [
  ['grasp-of-the-undying', 0, 'Styles/Resolve/GraspOfTheUndying/GraspOfTheUndying.png'],
  ['aftershock', 0, 'Styles/Resolve/VeteranAftershock/VeteranAftershock.png'],
  ['guardian', 0, 'Styles/Resolve/Guardian/Guardian.png'],
  ['demolish', 1, 'Styles/Resolve/Demolish/Demolish.png'],
  ['font-of-life', 1, 'Styles/Resolve/FontOfLife/FontOfLife.png'],
  ['shield-bash', 1, 'Styles/Resolve/MirrorShell/MirrorShell.png'],
  ['conditioning', 2, 'Styles/Resolve/Conditioning/Conditioning.png'],
  ['second-wind', 2, 'Styles/Resolve/SecondWind/SecondWind.png'],
  ['bone-plating', 2, 'Styles/Resolve/BonePlating/BonePlating.png'],
  ['overgrowth', 3, 'Styles/Resolve/Overgrowth/Overgrowth.png'],
  ['revitalize', 3, 'Styles/Resolve/Revitalize/Revitalize.png'],
  ['unflinching', 3, 'Styles/Sorcery/Unflinching/Unflinching.png'],
], {
  'grasp-of-the-undying': (g) => {
    let ready = 0, hp = 0;
    return {
      onDealt: (e, hit) => {
        if (hit.source !== 'auto' || hit.bolt || g.time < ready || e.hp <= 0) return;
        ready = g.time + 4;
        g.hurtEnemy(e, 0.035 * g.maxHp, RUNE_MAGIC);
        g.heal(0.013 * g.maxHp);
        hp += 5;
      },
      stat: (k) => (k === 'hp' ? hp : 0),
    };
  },
  aftershock: (g) => {
    let ready = 0, blastAt = Infinity;
    return {
      onStunned: () => {
        if (g.time < ready) return;
        ready = g.time + 20;
        blastAt = g.time + 2.5;
      },
      stat: (k) => (k === 'armor' && blastAt !== Infinity ? 35 : 0),
      tick: () => {
        if (g.time < blastAt) return;
        blastAt = Infinity;
        const dmg = 25 + 8 * g.level + 0.08 * (g.maxHp - g.baseHp);
        for (const e of [...g.enemiesNear(g.pos, AFTERSHOCK_RADIUS)]) {
          if (e.deadFor < 0 && e.pos.distanceTo(g.pos) - e.def.radius <= AFTERSHOCK_RADIUS) g.hurtEnemy(e, dmg, RUNE_MAGIC);
        }
      },
    };
  },
  guardian: (g) => {
    let ready = 0;
    return {
      onHurt: (amount) => {
        if (g.time >= ready && (g.hp - amount) / g.maxHp < 0.3) {
          ready = g.time + 70;
          g.addShield(50 + 0.1 * (g.maxHp - g.baseHp), 2); // lands before the shield soaks this hit
        }
        return amount;
      },
    };
  },
  demolish: (g) => {
    let ready = 0;
    return {
      damageMult: (e) => {
        if (e.def.tier !== 'epic' || g.time < ready) return 1;
        ready = g.time + 45;
        return 1.1;
      },
    };
  },
  'font-of-life': (g) => {
    let ready = 0;
    return {
      onDealt: (e, hit) => {
        if (hit.source !== 'ability' || !isBig(e) || g.time < ready) return;
        ready = g.time + 2;
        g.heal(0.01 * g.maxHp);
      },
    };
  },
  'shield-bash': (g) => {
    let armed = false;
    return {
      onShield: () => { armed = true; },
      onDealt: (e, hit) => {
        if (!armed || hit.source !== 'auto' || hit.bolt || e.hp <= 0) return;
        armed = false;
        g.hurtEnemy(e, ADAPTIVE_AD * (10 + 4 * g.level) + 0.015 * (g.maxHp - g.baseHp), RUNE_HIT);
      },
    };
  },
  // base armor, not g.armor: reading the armor getter here would recurse into this stat
  conditioning: (g) => ({ stat: (k) => (k === 'armor' && g.time >= 300 ? 8 + 0.03 * g.champ.base.armor : 0) }),
  'second-wind': (g) => {
    let until = 0;
    return {
      onHurt: (amount) => { until = g.time + 10; return amount; },
      tick: (dt) => { if (until > g.time) g.heal(((4 + 0.03 * (g.maxHp - g.hp)) / 10) * dt); },
    };
  },
  'bone-plating': (g) => {
    let ready = 0, charges = 0, until = 0;
    return {
      onHurt: (amount) => {
        if (charges > 0 && until > g.time) {
          charges--;
          return Math.max(0, amount - (30 + (30 * (g.level - 1)) / 17));
        }
        if (g.time >= ready) {
          ready = g.time + 55;
          charges = 3;
          until = g.time + 1.5;
        }
        return amount;
      },
    };
  },
  // base + item HP: reading maxHp here would recurse into this stat
  overgrowth: (g) => ({
    stat: (k) => (k !== 'hp' ? 0 : 3 * Math.floor(g.kills / 100) + (g.kills >= 1200 ? 0.035 * (g.baseHp + g.items.hp) : 0)),
  }),
  revitalize: (g) => ({ stat: (k) => (k === 'healMult' ? (g.hp / g.maxHp < 0.4 ? 0.1 : 0.05) : 0) }),
  unflinching: () => ({ stat: (k) => (k === 'tenacity' ? 0.2 : 0) }),
});
