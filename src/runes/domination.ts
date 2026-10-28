import type { Enemy } from '../game';
import { ADAPTIVE_AD, isBig, isOwnHit, RUNE_HIT, RUNE_MAGIC, runeList } from './def';

export const DOMINATION = runeList('domination', [
  ['electrocute', 'Eletrocutar', 0, 'Styles/Domination/Electrocute/Electrocute.png',
    '3 acertos distintos (ataque ou habilidade) no mesmo alvo em 3s causam dano adaptativo extra. Recarga de 4s.'],
  ['dark-harvest', 'Colheita Sombria', 0, 'Styles/Domination/DarkHarvest/DarkHarvest.png',
    'Acertar um inimigo abaixo de 50% da Vida causa dano extra que cresce com Almas (+1 a cada 50 abates). Recarga de 1,5s.'],
  ['hail-of-blades', 'Chuva de Lâminas', 0, 'Styles/Domination/HailOfBlades/HailOfBlades.png',
    'Os 3 primeiros ataques após 4s sem atacar recebem +110% de Vel. de Ataque.'],
  ['cheap-shot', 'Golpe Desleal', 1, 'Styles/Domination/CheapShot/CheapShot.png',
    'Dano verdadeiro extra contra inimigos lentos, elites e épicos. Recarga de 4s.'],
  ['taste-of-blood', 'Gosto de Sangue', 1, 'Styles/Domination/TasteOfBlood/GreenTerror_TasteOfBlood.png',
    'Causar dano a um elite ou épico cura 16 + 5% do DdA. Recarga de 20s.'],
  ['sudden-impact', 'Impacto Repentino', 1, 'Styles/Domination/SuddenImpact/SuddenImpact.png',
    'Por 4s após usar o E, causa +7% de dano.'],
  ['sixth-sense', 'Sexto Sentido', 2, 'Styles/Domination/SixthSense/SixthSense.png',
    'Quando uma horda surge, recebe um escudo de 10% da Vida máxima por 3s.'],
  ['grisly-mementos', 'Lembranças Aterrorizantes', 2, 'Styles/Domination/GrislyMementos/GrislyMementos.png',
    'Abater um elite ou épico concede +2 de DdA permanente na partida (máx. +20).'],
  ['deep-ward', 'Sentinela Profunda', 2, 'Styles/Domination/DeepWard/DeepWard.png',
    '+6% de dano contra inimigos a mais de 500 unidades.'],
  ['treasure-hunter', 'Caçador de Tesouros', 3, 'Styles/Domination/TreasureHunter/TreasureHunter.png',
    'Cada abate de elite ou épico concede +1 ponto de runa ao fim da partida (máx. +5).'],
  ['relentless-hunter', 'Caça Incansável', 3, 'Styles/Domination/RelentlessHunter/RelentlessHunter.png',
    '+1% de Vel. de Movimento a cada 200 abates (máx. +10%).'],
  ['ultimate-hunter', 'Caça Suprema', 3, 'Styles/Domination/UltimateHunter/UltimateHunter.png',
    '+2 de Aceleração de Habilidade no R a cada 500 abates (máx. +15).'],
], {
  electrocute: (g) => {
    const hits = new WeakMap<Enemy, number[]>(); // times of recent hits per enemy
    let ready = 0;
    return {
      onDealt: (e, hit) => {
        if (!isOwnHit(hit) || g.time < ready) return;
        const recent = (hits.get(e) ?? []).filter((t) => g.time - t <= 3);
        recent.push(g.time);
        hits.set(e, recent);
        if (recent.length < 3) return;
        hits.delete(e);
        ready = g.time + 4;
        g.hurtEnemy(e, ADAPTIVE_AD * (50 + 15 * g.level) + 0.4 * g.bonusAd, RUNE_HIT);
      },
    };
  },
  'dark-harvest': (g) => {
    let ready = 0;
    return {
      onDealt: (e, hit) => {
        if (!isOwnHit(hit) || g.time < ready || e.hp <= 0 || e.hp / e.maxHp >= 0.5) return;
        ready = g.time + 1.5;
        const souls = Math.floor(g.kills / 50);
        g.hurtEnemy(e, ADAPTIVE_AD * (20 + 5 * g.level + 5 * souls), RUNE_HIT);
      },
    };
  },
  'hail-of-blades': (g) => {
    let charges = 0, last = -Infinity;
    return {
      onAttack: () => {
        if (g.time - last >= 4) charges = 3;
        last = g.time;
        charges = Math.max(0, charges - 1); // this attack already started at the old speed
      },
      stat: (k) => (k === 'as' && charges > 0 ? 1.1 : 0),
    };
  },
  'cheap-shot': (g) => {
    let ready = 0;
    return {
      onDealt: (e, hit) => {
        if (!isOwnHit(hit) || g.time < ready || e.hp <= 0 || !(g.isSlowed(e) || isBig(e))) return;
        ready = g.time + 4;
        g.hurtEnemy(e, 10 + 4 * g.level, RUNE_MAGIC);
      },
    };
  },
  'taste-of-blood': (g) => {
    let ready = 0;
    return {
      onDealt: (e, hit) => {
        if (!isOwnHit(hit) || !isBig(e) || g.time < ready) return;
        ready = g.time + 20;
        g.heal(16 + 0.05 * g.ad);
      },
    };
  },
  'sudden-impact': (g) => {
    let until = 0;
    return {
      onCastResolved: (key) => { if (key === 'E') until = g.time + 4; },
      damageMult: () => (until > g.time ? 1.07 : 1),
    };
  },
  'sixth-sense': (g) => ({ onHorde: () => g.addShield(0.1 * g.maxHp, 3) }),
  'grisly-mementos': () => {
    let ad = 0;
    return {
      onKill: (e) => { if (isBig(e)) ad = Math.min(20, ad + 2); },
      stat: (k) => (k === 'ad' ? ad : 0),
    };
  },
  'deep-ward': (g) => ({ damageMult: (e) => (e.pos.distanceTo(g.pos) > 500 ? 1.06 : 1) }),
  'treasure-hunter': (g) => ({ onKill: (e) => { if (isBig(e)) g.bonusRunePoints = Math.min(5, g.bonusRunePoints + 1); } }),
  'relentless-hunter': (g) => ({ stat: (k) => (k === 'msPct' ? 0.01 * Math.min(10, Math.floor(g.kills / 200)) : 0) }),
  'ultimate-hunter': (g) => ({
    // no per-skill haste in the Game: shorten R's cooldown as if it had this much haste
    onCastResolved: (key) => {
      const haste = Math.min(15, 2 * Math.floor(g.kills / 500));
      if (key === 'R') g.cooldowns.R *= 100 / (100 + haste);
    },
  }),
});
