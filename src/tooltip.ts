// Hover overlay for skills, items, shards and other icons. Elements carry `data-tip="<kind>:<arg>"` (rich card, built by the
// resolver registered for <kind>) or `data-tip-text="..."` (a short label). One delegated listener, so markup rebuilt with
// innerHTML keeps working. Mouse and keyboard focus only: touch has no hover.

export interface Tip {
  icon?: string;
  key?: string; // key cap shown in the corner (Q, W, P...)
  title: string;
  /** Small tag under the title (damage type, "Passive"); `kindClass` colors it (`physical`, `magic`). */
  kind?: string;
  kindClass?: string;
  meta?: readonly [label: string, value: string][];
  body?: string;
  rows?: readonly [label: string, value: string][];
  foot?: string;
  /** Frame color: gold by default. */
  accent?: string;
}

type Resolver = (arg: string) => Tip | null;
const resolvers = new Map<string, Resolver>();
/** Registers (or replaces) the card builder for `data-tip="<kind>:..."`. */
export const registerTip = (kind: string, fn: Resolver) => { resolvers.set(kind, fn); };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
/** Attribute for a plain one-line tooltip. */
export const tipText = (text: string) => `data-tip-text="${esc(text)}"`;

export const tipHtml = (x: Tip) => `<div class="tt-in"${x.accent ? ` style="--ta:${x.accent}"` : ''}>
  <div class="tt-head">${x.icon ? `<span class="tt-icon"><img src="${x.icon}" alt=""></span>` : ''}
    <div><b class="tt-title">${x.title}</b>${x.kind ? `<small class="dt ${x.kindClass ?? ''}">${x.kind}</small>` : ''}</div>
    ${x.key ? `<kbd class="tt-key">${x.key}</kbd>` : ''}</div>
  ${x.meta?.length ? `<div class="tt-meta">${x.meta.map(([l, v]) => `<span>${l} <b>${v}</b></span>`).join('')}</div>` : ''}
  ${x.body ? `<p class="tt-body">${x.body}</p>` : ''}
  ${x.rows?.length ? `<div class="tt-rows">${x.rows.map(([l, v]) => `<div><span>${l}</span><b>${v}</b></div>`).join('')}</div>` : ''}
  ${x.foot ? `<p class="tt-foot">${x.foot}</p>` : ''}</div>`;

let box: HTMLElement | null = null;
let target: Element | null = null;

function resolve(el: HTMLElement): Tip | null {
  const text = el.dataset.tipText;
  if (text) return { title: text };
  const [kind, ...rest] = (el.dataset.tip ?? '').split(':');
  return resolvers.get(kind)?.(rest.join(':')) ?? null;
}

function hide() {
  target = null;
  box?.classList.remove('on');
}

/** Above the element, centered; below when the top has no room; kept inside the viewport. */
function place(el: Element) {
  const b = box!;
  const r = el.getBoundingClientRect();
  const w = b.offsetWidth, h = b.offsetHeight, m = 8, gap = 10;
  const x = Math.min(Math.max(m, r.left + r.width / 2 - w / 2), innerWidth - w - m);
  const above = r.top - gap - h >= m;
  const y = above ? r.top - gap - h : Math.min(r.bottom + gap, innerHeight - h - m);
  b.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function show(el: HTMLElement) {
  const tip = resolve(el);
  if (!tip) return hide();
  if (!box) {
    box = document.createElement('div');
    box.id = 'tt';
    box.setAttribute('role', 'tooltip');
    document.body.append(box);
  }
  target = el;
  box.innerHTML = `<div class="frame" style="--tf:${tip.accent ?? 'var(--gold)'}">${tipHtml(tip)}</div>`;
  box.classList.add('on');
  place(el);
}

const find = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tip], [data-tip-text]') : null);
let ready = false;
/** Installs the listeners once (main.ts). */
export function initTooltips() {
  if (ready) return;
  ready = true;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = find(e);
    if (el && el !== target) show(el);
    else if (!el) hide();
  });
  document.addEventListener('focusin', (e) => { const el = find(e); if (el) show(el); });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true); // a click changes what the element shows: the card is stale
  document.addEventListener('keydown', hide, true);
  addEventListener('blur', hide);
  addEventListener('resize', hide);
  document.addEventListener('scroll', hide, true);
}
