// Playable champions. Register new ones here (see src/champion.ts for the contract).
import type { ChampionDef } from '../champion';
import { APHELIOS } from './aphelios';
import { AURELIONSOL } from './aurelionsol';
import { BRAND } from './brand';
import { EZREAL } from './ezreal';
import { LUX } from './lux';
import { ORIANNA } from './orianna';
import { SAMIRA } from './samira';
import { SIVIR } from './sivir';
import { TEEMO } from './teemo';
import { ZIGGS } from './ziggs';

export const CHAMPIONS: Record<string, ChampionDef> = { ezreal: EZREAL, samira: SAMIRA, brand: BRAND, aphelios: APHELIOS, aurelionsol: AURELIONSOL, lux: LUX, teemo: TEEMO, ziggs: ZIGGS, sivir: SIVIR, orianna: ORIANNA };
export const DEFAULT_CHAMPION = EZREAL;
