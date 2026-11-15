import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { person } from '../content';
import { h, linkButtons, projectTiles } from '../dom';

/**
 * CSS-anchor content. MindAR scales the CSS anchor by 0.001, so 1000 CSS px === the
 * card width (1 MindAR unit). Positions below are therefore in px, y up, relative to
 * the card centre.
 */
const PX_PER_UNIT = 1000;
const GAP = 56;

interface PanelSpec {
  name: string;
  height: number;
  build: () => HTMLElement;
}

function wrap(name: string, index: number, child: HTMLElement): HTMLElement {
  // Outer element is owned by CSS3DRenderer (it writes `transform` and MindAR writes
  // `visibility`); the inner one carries our enter/exit animation.
  const inner = h('div', { class: `ar-panel ar-panel--${name}`, style: `--i:${index}` }, child);
  return h('div', { class: 'ar-anchor', 'data-panel': name }, inner);
}

export interface PanelSet {
  objects: CSS3DObject[];
  elements: HTMLElement[];
  setVisible(on: boolean): void;
}

/** @param cardRatio card height / card width */
export function buildPanels(cardRatio: number, z: number): PanelSet {
  const halfCard = (cardRatio * PX_PER_UNIT) / 2;

  const specs: (PanelSpec & { at: 'above' | 'below'; offset: number })[] = [
    {
      name: 'projects',
      height: 200,
      at: 'above',
      offset: 0,
      build: () => {
        const list = h('div', { class: 'ar-projects' }, ...projectTiles());
        return h('div', {}, h('p', { class: 'ar-eyebrow' }, 'Selected projects'), list);
      },
    },
    {
      name: 'identity',
      height: 150,
      at: 'below',
      offset: 0,
      build: () =>
        h(
          'div',
          {},
          h('p', { class: 'ar-name' }, person.name),
          h('p', { class: 'ar-role' }, `${person.role} · ${person.place}`),
        ),
    },
    {
      name: 'links',
      height: 140,
      at: 'below',
      offset: 150 + 28,
      build: () => h('div', { class: 'ar-links' }, ...linkButtons()),
    },
  ];

  const elements: HTMLElement[] = [];
  const objects = specs.map((spec, i) => {
    const el = wrap(spec.name, i, spec.build());
    el.style.width = `${PX_PER_UNIT}px`;
    el.style.height = `${spec.height}px`;
    el.style.visibility = 'hidden';
    const obj = new CSS3DObject(el);
    const y =
      spec.at === 'above'
        ? halfCard + GAP + spec.height / 2
        : -(halfCard + GAP + spec.offset + spec.height / 2);
    obj.position.set(0, y, z * PX_PER_UNIT);
    elements.push(el);
    return obj;
  });

  return {
    objects,
    elements,
    setVisible(on) {
      for (const el of elements) el.classList.toggle('is-in', on);
    },
  };
}
