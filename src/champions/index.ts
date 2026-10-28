// Playable champions. Register new ones here (see src/champion.ts for the contract).
import type { ChampionDef } from '../champion';
import { EZREAL } from './ezreal';

export const CHAMPIONS: Record<string, ChampionDef> = { ezreal: EZREAL };
export const DEFAULT_CHAMPION = EZREAL;
