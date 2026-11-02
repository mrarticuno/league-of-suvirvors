// Sound button of the menus (champion select, rune page): mutes, or sets the volume of music and effects together.
// Shown only while `body.menus` is set (index.html); the run has its own sliders in the ESC menu.
import { audio } from './audio';
import { t } from './i18n';

const SPEAKER = '<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/>';
const WAVES = '<path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>';
const CROSS = '<path d="M16 9l5 6M21 9l-5 6"/>';

let root: HTMLElement | undefined;
let restore = 0.1; // volume the button gives back after a mute

const master = () => Math.max(audio.musicVolume, audio.sfxVolume);
const apply = (v: number) => { audio.setMusicVolume(v); audio.setSfxVolume(v); };

/** Redraws the button and slider from the audio settings (the ESC menu sliders may have changed them). */
export function syncSoundControl() {
  if (!root) return;
  const v = master();
  if (v > 0) restore = v;
  const btn = root.querySelector('button')!;
  const label = t(v > 0 ? 'sound.mute' : 'sound.unmute');
  btn.setAttribute('aria-label', label);
  btn.querySelector('svg')!.innerHTML = SPEAKER + (v > 0 ? WAVES : CROSS);
  const slider = root.querySelector('input')!;
  slider.value = String(Math.round(v * 100));
  slider.setAttribute('aria-label', t('sound.volume'));
}

export function initSoundControl() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'snd';
  root.innerHTML = `<button type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"></svg></button>
    <input type="range" min="0" max="100" step="5">`;
  document.body.append(root);
  root.querySelector('button')!.onclick = () => { apply(master() > 0 ? 0 : restore); syncSoundControl(); };
  const slider = root.querySelector('input')!;
  slider.oninput = () => { apply(+slider.value / 100); syncSoundControl(); };
  slider.onchange = () => audio.play('hud_open'); // preview on release
  syncSoundControl();
}
