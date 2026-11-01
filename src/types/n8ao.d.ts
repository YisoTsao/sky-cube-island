declare module 'n8ao' {
  import type { Camera, Color, Scene } from 'three';
  export class N8AOPostPass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number; distanceFalloff: number; intensity: number; halfRes: boolean; gammaCorrection: boolean;
      aoSamples: number; denoiseSamples: number; denoiseRadius: number; color: Color; screenSpaceRadius: boolean;
      accumulate: boolean; transparencyAware: boolean;
    };
    setSize(width: number, height: number): void;
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setDisplayMode(mode: string): void;
    enabled: boolean;
  }
}
