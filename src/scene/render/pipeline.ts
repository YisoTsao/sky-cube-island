import {
  HalfFloatType, NoToneMapping, PCFShadowMap, BasicShadowMap, SRGBColorSpace, Uniform, WebGLRenderer,
  MeshBasicMaterial, type Camera, type Scene,
} from 'three';
import {
  BloomEffect, Effect, EffectComposer, EffectPass, FXAAEffect, RenderPass, SMAAEffect, SMAAPreset,
  ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityProfile {
  dprMin: number; dprMax: number;
  aa: 'fxaa' | 'smaa' | 'msaa' | 'msaa+smaa';
  shadowSize: number; softShadows: boolean;
  ssao: 'off' | 'half' | 'full';
  bloom: number; // intensity, 0 = off
  wind: boolean; cloudLayers: 1 | 2;
  particles: number; decorDensity: number;
  runeAnimate: boolean;
}

/** Quality tiers (Tech §9.6). High is the art acceptance baseline. */
export const QUALITY: Record<QualityLevel, QualityProfile> = {
  low: { dprMin: 0.75, dprMax: 1, aa: 'fxaa', shadowSize: 1024, softShadows: false, ssao: 'off', bloom: 0, wind: false, cloudLayers: 1, particles: 300, decorDensity: 0.5, runeAnimate: false },
  medium: { dprMin: 1, dprMax: 1, aa: 'smaa', shadowSize: 2048, softShadows: true, ssao: 'off', bloom: 0.45, wind: true, cloudLayers: 1, particles: 800, decorDensity: 0.75, runeAnimate: true },
  high: { dprMin: 1, dprMax: 2, aa: 'msaa', shadowSize: 4096, softShadows: true, ssao: 'half', bloom: 0.75, wind: true, cloudLayers: 2, particles: 1500, decorDensity: 1, runeAnimate: true },
  ultra: { dprMin: 1, dprMax: 2, aa: 'msaa+smaa', shadowSize: 4096, softShadows: true, ssao: 'full', bloom: 0.8, wind: true, cloudLayers: 2, particles: 2500, decorDensity: 1, runeAnimate: true },
};

/** Procedural colour grade (stands in for a per-chapter LUT): split-toning, saturation, soft contrast. */
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */`
      uniform float uSat;
      uniform float uContrast;
      uniform vec3 uShadowTint;
      uniform vec3 uHighTint;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat);
        c = mix(c, c * uShadowTint, (1.0 - smoothstep(0.0, 0.45, l)) * 0.6);
        c = mix(c, c * uHighTint, smoothstep(0.5, 1.0, l) * 0.5);
        c = clamp((c - 0.5) * uContrast + 0.5 + 0.0, 0.0, 1.0) * 0.6 + c * 0.4;
        outputColor = vec4(c, inputColor.a);
      }`, {
      uniforms: new Map<string, Uniform>([
        ['uSat', new Uniform(1.1)],
        ['uContrast', new Uniform(1.08)],
        ['uShadowTint', new Uniform([0.94, 0.98, 1.08])],
        ['uHighTint', new Uniform([1.05, 1.02, 0.95])],
      ]),
    });
  }
}

export class RenderPipeline {
  readonly renderer: WebGLRenderer;
  composer!: EffectComposer;
  private quality: QualityLevel = 'high';
  private ao?: N8AOPostPass;
  private width = 1;
  private height = 1;
  dynamicResolution = true;
  private pixelRatio = 1;
  private frameTimes: number[] = [];
  private lastAdjust = 0;

  constructor(canvas: HTMLCanvasElement, private scene: Scene, private camera: Camera, private overlayScene: Scene) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap; // r18x: PCF honours shadow.radius (PCFSoft removed)
    this.renderer.info.autoReset = false;
    this.renderer.autoClear = false;
    this.renderer.shadowMap.autoUpdate = false;
  }

  private depthMat = new MeshBasicMaterial({ colorWrite: false });
  /** Layer used by meshes that should occlude the tactical overlay. */
  static readonly DEPTH_LAYER = 1;

  get profile(): QualityProfile { return QUALITY[this.quality]; }
  get level(): QualityLevel { return this.quality; }

  setQuality(q: QualityLevel) {
    this.quality = q;
    const p = QUALITY[q];
    this.renderer.shadowMap.type = p.softShadows ? PCFShadowMap : BasicShadowMap;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, p.dprMax);
    this.buildComposer();
    this.resize(this.width, this.height);
  }

  private buildComposer() {
    this.composer?.dispose();
    const p = this.profile;
    const msaa = p.aa === 'msaa' || p.aa === 'msaa+smaa';
    this.composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType, multisampling: msaa ? 4 : 0 });
    const rp = new RenderPass(this.scene, this.camera);
    this.composer.addPass(rp);
    this.ao = undefined;
    if (p.ssao !== 'off') {
      const ao = new N8AOPostPass(this.scene, this.camera, Math.max(1, this.width), Math.max(1, this.height));
      ao.configuration.aoRadius = 1.4;
      ao.configuration.distanceFalloff = 0.6;
      ao.configuration.intensity = 2.2;
      // n8ao 2.0.1's half-res path uses an MRT target whose `texture` getter returns an array,
      // which three r18x's setupRenderTarget can't handle → always render full res, fewer samples instead.
      ao.configuration.halfRes = false;
      ao.configuration.gammaCorrection = false;
      ao.configuration.aoSamples = p.ssao === 'half' ? 8 : 16;
      ao.configuration.denoiseSamples = p.ssao === 'half' ? 4 : 8;
      ao.configuration.color.set(0x1d2740);
      this.composer.addPass(ao as unknown as RenderPass);
      this.ao = ao;
    }
    const effects: Effect[] = [];
    if (p.bloom > 0) effects.push(new BloomEffect({ luminanceThreshold: 1.0, luminanceSmoothing: 0.25, intensity: p.bloom, mipmapBlur: true, radius: 0.72 }));
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }));
    effects.push(new GradeEffect());
    effects.push(new VignetteEffect({ offset: 0.32, darkness: 0.38 }));
    this.composer.addPass(new EffectPass(this.camera, ...effects));
    // No toggleable pass may sit at the end of the chain: postprocessing only flags the *last added*
    // pass as renderToScreen, so disabling it leaves the frame in an off-screen buffer and the canvas
    // shows black (this was the "map goes black after a click" bug with the old tilt-shift pass).
    if (p.aa === 'fxaa') this.composer.addPass(new EffectPass(this.camera, new FXAAEffect()));
    else if (p.aa === 'smaa' || p.aa === 'msaa+smaa') this.composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
  }

  resize(w: number, h: number) {
    this.width = Math.max(1, w); this.height = Math.max(1, h);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.composer?.setSize(this.width, this.height);
  }

  get currentPixelRatio() { return this.pixelRatio; }
  get aoActive() { return !!this.ao; }

  /** Dynamic resolution (Tech §9.6): 2 s moving average; >18 ms → −0.1, <12 ms → +0.1, ≥1 s apart. */
  private adapt(frameMs: number, now: number) {
    if (!this.dynamicResolution) return;
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > 120) this.frameTimes.shift();
    if (now - this.lastAdjust < 1000 || this.frameTimes.length < 60) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const p = this.profile;
    const maxPr = Math.min(window.devicePixelRatio || 1, p.dprMax);
    let next = this.pixelRatio;
    if (avg > 18) next = Math.max(p.dprMin, this.pixelRatio - 0.1);
    else if (avg < 12) next = Math.min(maxPr, this.pixelRatio + 0.1);
    if (Math.abs(next - this.pixelRatio) > 0.001) {
      this.pixelRatio = next;
      this.resize(this.width, this.height);
      this.frameTimes.length = 0;
    }
    this.lastAdjust = now;
  }

  /** World → post → depth prime → tactical overlay (Tech §9.7). */
  render(dt: number, frameMs: number, now: number) {
    this.adapt(frameMs, now);
    this.renderer.info.reset();
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.shadowMap.needsUpdate = true;
    this.composer.render(dt);
    // Tactical overlay drawn after post-processing; depth primed with world geometry so the
    // overlay can show occluded segments as see-through dashes.
    this.renderer.setRenderTarget(null);
    this.renderer.clearDepth();
    const prevMask = this.camera.layers.mask;
    const prevBg = this.scene.background;
    this.scene.overrideMaterial = this.depthMat;
    this.scene.background = null;
    this.camera.layers.set(RenderPipeline.DEPTH_LAYER);
    this.renderer.render(this.scene, this.camera);
    this.camera.layers.mask = prevMask;
    this.scene.overrideMaterial = null;
    this.scene.background = prevBg;
    this.renderer.render(this.overlayScene, this.camera);
  }

  dispose() {
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
