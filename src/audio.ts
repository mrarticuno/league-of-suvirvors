// Sound effects and music extracted from the LoL Wwise banks by tools/build_audio.py (assets/sfx/sounds.json:
// {key: [mp3 files]}, several files = random takes). Keys missing from the manifest play nothing.
import type * as THREE from 'three';
import { asset } from './util';

const BASE = 'assets/sfx/';
const SETTINGS = 'los-audio';
const HEARING = 2200; // world units where positional sounds fade out
const MAX_VOICES = 32;
const MIN_REPEAT = 0.05; // seconds before the same key can play again (hordes dying together)

/** Linear falloff by distance from the listener (Ezreal): 1 next to him, 0 at HEARING. */
export const falloff = (distance: number) => Math.max(0, 1 - distance / HEARING);

class GameAudio {
  private ctx = new AudioContext();
  private out = this.ctx.createGain();
  private buffers = new Map<string, AudioBuffer[]>();
  private lastPlayed = new Map<string, number>();
  private voices = 0;
  private music = new Audio();
  private tracks: string[] = [];
  private paused = false;
  musicOn = true;
  sfxOn = true;

  constructor() {
    this.out.gain.value = 0.6;
    this.out.connect(this.ctx.destination);
    this.music.volume = 0.35;
    this.music.onended = () => this.nextTrack();
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS) ?? '{}');
      this.musicOn = s.music ?? true;
      this.sfxOn = s.sfx ?? true;
    } catch { /* storage blocked: keep defaults */ }
    // browsers keep audio locked until the first user gesture
    const unlock = () => {
      this.ctx.resume();
      this.syncMusic();
    };
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
  }

  private manifest?: Promise<Record<string, string[]>>;
  private loaded = new Set<string>(); // prefixes already decoded (or decoding)

  /** Reads the manifest (music streams from it) and decodes the HUD sounds; the rest load by prefix (loadPrefix). */
  async load() {
    this.tracks = (await (this.manifest ??= this.readManifest())).music ?? [];
    await this.loadPrefix('hud');
  }

  private async readManifest(): Promise<Record<string, string[]>> {
    const res = await fetch(asset(BASE + 'sounds.json')).catch(() => null);
    if (!res?.ok) return {}; // sounds not extracted: play silently
    // the dev server answers a missing file with index.html (200), so a parse failure also means "not extracted"
    return (await res.json().catch(() => null)) ?? {};
  }

  /** Decodes the sounds whose key starts with `${prefix}_` (a champion, an enemy, the HUD), once per prefix. */
  async loadPrefix(prefix: string) {
    if (this.loaded.has(prefix)) return;
    this.loaded.add(prefix);
    const manifest = await (this.manifest ??= this.readManifest());
    await Promise.all(Object.entries(manifest).filter(([k]) => k !== 'music' && k.startsWith(`${prefix}_`)).map(async ([key, files]) => {
      const takes = await Promise.all(files.map(async (f) => {
        const data = await (await fetch(asset(BASE + f))).arrayBuffer();
        return this.ctx.decodeAudioData(data).catch(() => null);
      }));
      this.buffers.set(key, takes.filter((b): b is AudioBuffer => !!b));
    }));
  }

  play(key: string, volume = 1) {
    const takes = this.buffers.get(key);
    if (!this.sfxOn || !takes?.length || volume <= 0.02 || this.voices >= MAX_VOICES) return;
    const now = this.ctx.currentTime;
    if (now - (this.lastPlayed.get(key) ?? -1) < MIN_REPEAT) return;
    this.lastPlayed.set(key, now);
    const src = this.ctx.createBufferSource();
    src.buffer = takes[Math.floor(Math.random() * takes.length)];
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(this.out);
    this.voices++;
    src.onended = () => this.voices--;
    src.start();
  }

  /** Positional sound, quieter the farther `at` is from the listener. */
  playAt(key: string, at: THREE.Vector3, listener: THREE.Vector3) {
    this.play(key, falloff(Math.hypot(at.x - listener.x, at.z - listener.z)));
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.syncMusic();
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    this.save();
    this.syncMusic();
  }

  setSfx(on: boolean) {
    this.sfxOn = on;
    this.save();
  }

  private save() {
    try { localStorage.setItem(SETTINGS, JSON.stringify({ music: this.musicOn, sfx: this.sfxOn })); } catch { /* not persisted */ }
  }

  private syncMusic() {
    if (!this.musicOn || this.paused || !this.tracks.length) return this.music.pause();
    if (!this.music.src) return this.nextTrack();
    this.music.play().catch(() => {}); // rejected until the first gesture; unlock retries
  }

  private nextTrack() {
    if (!this.tracks.length) return;
    this.music.src = asset(BASE + this.tracks[Math.floor(Math.random() * this.tracks.length)]);
    this.syncMusic();
  }
}

export const audio = new GameAudio();
