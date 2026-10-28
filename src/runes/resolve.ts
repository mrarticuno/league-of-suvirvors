import { ADAPTIVE_AD, isBig, RUNE_HIT, RUNE_MAGIC, runeList } from './def';

const AFTERSHOCK_RADIUS = 350;

export const RESOLVE = runeList('resolve', [
  ['grasp-of-the-undying', 'Aperto dos Mortos-Vivos', 0, 'Styles/Resolve/GraspOfTheUndying/GraspOfTheUndying.png',
    'A cada 4s em combate, o próximo ataque causa +3,5% da sua Vida máxima como dano, cura 1,3% e concede +5 de Vida permanente na partida.'],
  ['aftershock', 'Pós-choque', 0, 'Styles/Resolve/VeteranAftershock/VeteranAftershock.png',
    'Ao ser atordoado, recebe +35 de Armadura por 2,5s e então explode, causando dano em área. Recarga de 20s.'],
  ['guardian', 'Guardião', 0, 'Styles/Resolve/Guardian/Guardian.png',
    'Abaixo de 30% da Vida, recebe um escudo de 50 + 10% da Vida adicional por 2s. Recarga de 70s.'],
  ['demolish', 'Demolir', 1, 'Styles/Resolve/Demolish/Demolish.png',
    'O primeiro acerto em um épico a cada 45s causa +10% de dano.'],
  ['font-of-life', 'Fonte da Vida', 1, 'Styles/Resolve/FontOfLife/FontOfLife.png',
    'Acertar um elite ou épico com habilidade cura 1% da sua Vida máxima em 2s.'],
  ['shield-bash', 'Golpe de Escudo', 1, 'Styles/Resolve/MirrorShell/MirrorShell.png',
    'Receber um escudo faz o próximo ataque causar dano extra.'],
  ['conditioning', 'Condicionamento', 2, 'Styles/Resolve/Conditioning/Conditioning.png',
    'Após 5 min de partida: +8 de Armadura e +3% de Armadura.'],
  ['second-wind', 'Ventos Revigorantes', 2, 'Styles/Resolve/SecondWind/SecondWind.png',
    'Ao receber dano, regenera 4 + 3% da Vida faltante em 10s.'],
  ['bone-plating', 'Osso Revestido', 2, 'Styles/Resolve/BonePlating/BonePlating.png',
    'Ao receber dano, os próximos 3 golpes em até 1,5s causam 30–60 a menos. Recarga de 55s.'],
  ['overgrowth', 'Crescimento Excessivo', 3, 'Styles/Resolve/Overgrowth/Overgrowth.png',
    '+3 de Vida máxima a cada 100 abates; a partir de 1.200 abates, +3,5% de Vida máxima.'],
  ['revitalize', 'Revitalizar', 3, 'Styles/Resolve/Revitalize/Revitalize.png',
    '+5% de cura e escudos recebidos (+10% abaixo de 40% da Vida).'],
  ['unflinching', 'Inabalável', 3, 'Styles/Sorcery/Unflinching/Unflinching.png',
    '+20% de Tenacidade (atordoamentos duram menos).'],
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
