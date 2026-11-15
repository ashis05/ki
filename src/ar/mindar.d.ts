declare module 'mind-ar/dist/mindar-image-three.prod.js' {
  import type { Group, PerspectiveCamera, Matrix4, Scene, WebGLRenderer } from 'three';
  import type { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';

  export interface MindARAnchor {
    group: Group;
    targetIndex: number;
    onTargetFound: (() => void) | null;
    onTargetLost: (() => void) | null;
    onTargetUpdate: (() => void) | null;
    visible: boolean;
  }

  export interface MindARThreeOptions {
    container: HTMLElement;
    imageTargetSrc: string;
    maxTrack?: number;
    uiLoading?: string;
    uiScanning?: string;
    uiError?: string;
    filterMinCF?: number | null;
    filterBeta?: number | null;
    warmupTolerance?: number | null;
    missTolerance?: number | null;
  }

  export class MindARThree {
    constructor(options: MindARThreeOptions);
    renderer: WebGLRenderer;
    cssRenderer: CSS3DRenderer;
    scene: Scene;
    cssScene: Scene;
    camera: PerspectiveCamera;
    video: HTMLVideoElement;
    /** One per target; scale.x = target width, elements[13] = half target height (in width units). */
    postMatrixs: Matrix4[];
    controller: { dispose(): void; stopProcessVideo(): void };
    start(): Promise<void>;
    stop(): void;
    resize(): void;
    addAnchor(targetIndex: number): MindARAnchor;
    addCSSAnchor(targetIndex: number): MindARAnchor;
  }
}
