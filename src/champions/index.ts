// Playable champions. Register new ones here (see src/champion.ts for the contract).
import type { ChampionDef } from '../champion';
import { APHELIOS } from './aphelios';
import { BRAND } from './brand';
import { EZREAL } from './ezreal';
import { SAMIRA } from './samira';

export const CHAMPIONS: Record<string, ChampionDef> = { ezreal: EZREAL, samira: SAMIRA, brand: BRAND, aphelios: APHELIOS };
export const DEFAULT_CHAMPION = EZREAL;
