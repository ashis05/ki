import { links, projects, type LinkItem, type Project } from './content';

type Attrs = Record<string, string | undefined>;

/** Tiny hyperscript helper; keeps all text as text nodes (no innerHTML). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, v);
  for (const c of children) if (c !== null) el.append(c);
  return el;
}

export function url(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, '');
}

const ICON_ARROW =
  '<svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false"><path d="M4.5 11.5l7-7M5.5 4.5h6v6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function arrow(): HTMLSpanElement {
  const s = h('span', { class: 'arrow', 'aria-hidden': 'true' });
  s.innerHTML = ICON_ARROW; // static, trusted markup
  return s;
}

function externalAttrs(external: boolean): Attrs {
  return external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
}

/** A link rendered as a button-like chip. `detailed` adds the hint line (2D page). */
export function linkButton(item: LinkItem, detailed = false): HTMLAnchorElement {
  const a = h(
    'a',
    { class: 'link-btn', href: item.href, 'data-link': item.id, ...externalAttrs(item.external) },
    h('span', { class: 'link-btn__label' }, item.label),
    detailed ? h('span', { class: 'link-btn__hint' }, item.hint) : null,
    arrow(),
  );
  return a;
}

export function projectTile(p: Project, index: number): HTMLAnchorElement {
  return h(
    'a',
    { class: 'project', href: p.href, 'data-project': p.id, target: '_blank', rel: 'noopener noreferrer' },
    h('span', { class: 'project__no' }, String(index + 1).padStart(2, '0')),
    h('span', { class: 'project__name' }, p.name),
    h('span', { class: 'project__blurb' }, p.blurb),
    arrow(),
  );
}

export function linkButtons(detailed = false): HTMLElement[] {
  return links.map((l) => linkButton(l, detailed));
}

export function projectTiles(): HTMLElement[] {
  return projects.map((p, i) => projectTile(p, i));
}
