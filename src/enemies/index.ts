// Enemy peculiarities. Plain enemies only need an EnemyDef (src/data.ts) and use the generic chase-and-attack loop
// in game.ts. An enemy with its own behaviour registers an AI factory here (one instance per spawned enemy); an
// event of the timeline (EVENTS) with special spawn rules registers a spawner.
import { DRAGONS } from '../data';
import type { Enemy, Game } from '../game';
import { baronAI, startBaronFight } from './baron';

export interface EnemyAI {
  /** Replaces the generic chase-and-attack loop while the enemy is alive. */
  update(dt: number): void;
  onDeath?(): void;
  /** The enemy left the game (corpse removed or run reset). */
  dispose?(): void;
}

export const AI: Record<string, (g: Game, e: Enemy) => EnemyAI> = {
  baron: baronAI,
};

export const SPAWNERS: Record<string, (g: Game) => void> = {
  baron: startBaronFight,
  dragon: (g) => g.spawnEnemy(DRAGONS[Math.floor(Math.random() * DRAGONS.length)].model), // rolls an elemental drake, like the Rift
};
