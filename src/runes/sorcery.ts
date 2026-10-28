import { SKILL_KEYS } from '../champion';
import { ADAPTIVE_AD, isOwnHit, RUNE_HIT, RUNE_MAGIC, runeList } from './def';

const COMET_RADIUS = 200;

export const SORCERY = runeList('sorcery', [
  ['summon-aery', 'Invocar Aery', 0, 'Styles/Sorcery/SummonAery/SummonAery.png',
    'Acertos enviam Aery para causar dano adaptativo extra ao alvo. Recarga de 2s.'],
  ['arcane-comet', 'Cometa Arcano', 0, 'Styles/Sorcery/ArcaneComet/ArcaneComet.png',
    'Acertar uma habilidade lança um cometa no alvo, causando dano em área. Recarga de 8s, reduzida por acertos de habilidade.'],
  ['phase-rush', 'Avanço da Tempestade', 0, 'Styles/Sorcery/PhaseRush/StormraidersSurgeRuneIcon2.png',
    '3 acertos distintos em 4s concedem +30% de Vel. de Movimento por 3s. Recarga de 12s.'],
  ['axiom-arcanist', 'Arcanista do Axioma', 1, 'Styles/Sorcery/NullifyingOrb/Axiom_Arcanist.png',
    '+6% de dano do R.'],
  ['manaflow-band', 'Faixa de Fluxo de Mana', 1, 'Styles/Sorcery/ManaflowBand/ManaflowBand.png',
    'Acertar uma habilidade concede +25 de Mana máxima (máx. 250). No máximo, restaura 1% da Mana faltante a cada 5s.'],
  ['nimbus-cloak', 'Manto de Nimbus', 1, 'Styles/Sorcery/NimbusCloak/6361.png',
    'Usar o R concede +25% de Vel. de Movimento por 2,5s.'],
  ['transcendence', 'Transcendência', 2, 'Styles/Sorcery/Transcendence/Transcendence.png',
    '+5 de Aceleração de Habilidade no nível 5 e no 8. A partir do nível 11, abater reduz em 20% a recarga restante das habilidades.'],
  ['celerity', 'Celeridade', 2, 'Styles/Sorcery/Celerity/CelerityTemp.png',
    '+1% de Vel. de Movimento; bônus de Vel. de Movimento ficam 7% mais fortes.'],
  ['absolute-focus', 'Foco Absoluto', 2, 'Styles/Sorcery/AbsoluteFocus/AbsoluteFocus.png',
    'Acima de 70% da Vida, concede DdA adaptativo (até 10 no nível 18).'],
  ['scorch', 'Chamuscar', 3, 'Styles/Sorcery/Scorch/Scorch.png',
    'A próxima habilidade que acerta queima o alvo, causando dano mágico extra em 1s. Recarga de 10s.'],
  ['waterwalking', 'Caminhar Sobre as Águas', 3, 'Styles/Sorcery/Waterwalking/Waterwalking.png',
    'No rio: +10% de Vel. de Movimento e DdA adaptativo.'],
  ['gathering-storm', 'Tempestade Crescente', 3, 'Styles/Sorcery/GatheringStorm/GatheringStorm.png',
    'A cada 2 min de partida, concede DdA adaptativo crescente.'],
], {
  'summon-aery': (g) => {
    let ready = 0;
    return {
      onDealt: (e, hit) => {
        if (!isOwnHit(hit) || g.time < ready || e.hp <= 0) return;
        ready = g.time + 2;
        g.hurtEnemy(e, ADAPTIVE_AD * (10 + 3 * g.level) + 0.1 * g.bonusAd, RUNE_HIT);
      },
    };
  },
  'arcane-comet': (g) => {
    let ready = 0;
    return {
      onDealt: (e, hit) => {
        if (hit.source !== 'ability') return;
        if (g.time < ready) { ready -= 0.2 * (ready - g.time); return; } // hits shorten the cooldown
        ready = g.time + 8;
        const dmg = 30 + 8 * g.level + 0.2 * g.bonusAd;
        for (const t of [...g.enemiesNear(e.pos, COMET_RADIUS)]) {
          if (t.deadFor < 0 && t.pos.distanceTo(e.pos) - t.def.radius <= COMET_RADIUS) g.hurtEnemy(t, dmg, RUNE_MAGIC);
        }
      },
    };
  },
  'phase-rush': (g) => {
    let hits: number[] = [], ready = 0, until = 0;
    return {
      onDealt: (_e, hit) => {
        if (!isOwnHit(hit) || g.time < ready) return;
        hits = hits.filter((t) => g.time - t <= 4);
        hits.push(g.time);
        if (hits.length < 3) return;
        hits = [];
        until = g.time + 3;
        ready = g.time + 12;
      },
      stat: (k) => (k === 'msPct' && until > g.time ? 0.3 : 0),
    };
  },
  'axiom-arcanist': () => ({ damageMult: (_e, hit) => (hit.skill === 'R' ? 1.06 : 1) }),
  'manaflow-band': (g) => {
    let mana = 0, tick = 0;
    return {
      onDealt: (_e, hit) => { if (hit.source === 'ability') mana = Math.min(250, mana + 25); },
      stat: (k) => (k === 'mana' ? mana : 0),
      tick: (dt) => {
        if (mana < 250 || (tick += dt) < 5) return;
        tick = 0;
        g.mana = Math.min(g.maxMana, g.mana + 0.01 * (g.maxMana - g.mana));
      },
    };
  },
  'nimbus-cloak': (g) => {
    let until = 0;
    return {
      onCastResolved: (key) => { if (key === 'R') until = g.time + 2.5; },
      stat: (k) => (k === 'msPct' && until > g.time ? 0.25 : 0),
    };
  },
  transcendence: (g) => {
    let ready = 0;
    return {
      stat: (k) => (k === 'ah' ? (g.level >= 5 ? 5 : 0) + (g.level >= 8 ? 5 : 0) : 0),
      onKill: () => {
        // shortcut: 1s internal cooldown, or 3-4k kills a run would keep every skill permanently ready
        if (g.level < 11 || g.time < ready) return;
        ready = g.time + 1;
        for (const k of SKILL_KEYS) g.cooldowns[k] *= 0.8;
      },
    };
  },
  celerity: (g) => ({ stat: (k) => (k === 'msPct' ? 0.01 + 0.07 * g.items.msPct : 0) }), // items only: reading moveSpeed would recurse
  'absolute-focus': (g) => ({
    stat: (k) => (k === 'ad' && g.hp / g.maxHp > 0.7 ? 1 + (9 * (g.level - 1)) / 17 : 0),
  }),
  scorch: (g) => {
    let ready = 0;
    return {
      onDealt: (e, hit) => {
        if (hit.source !== 'ability' || g.time < ready || e.hp <= 0) return;
        ready = g.time + 10;
        g.hurtEnemy(e, 20 + 4 * g.level, RUNE_MAGIC);
      },
    };
  },
  waterwalking: (g) => ({
    stat: (k) => (!g.inWater() ? 0 : k === 'msPct' ? 0.1 : k === 'ad' ? ADAPTIVE_AD * (3 + g.level) : 0),
  }),
  'gathering-storm': (g) => ({
    stat: (k) => {
      const n = Math.floor(g.time / 120);
      return k === 'ad' ? ADAPTIVE_AD * n * (n + 1) : 0;
    },
  }),
});
