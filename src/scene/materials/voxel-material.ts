import { Color, MeshStandardMaterial, Vector2, Vector4, type IUniform } from 'three';
import { PALETTE } from '../palette';

export const FLAG_GRASS_SIDE = 1;
export const FLAG_EDITABLE = 2;
export const FLAG_EMISSIVE = 4;
export const FLAG_NO_BEVEL = 8;
export const FLAG_STONE_TOP = 16;

export const MAX_TERRAIN_ANIMS = 8;

/** Uniforms shared by every voxel material (time, height fog, rune glow, terrain tweening). */
export const sharedUniforms = {
  uTime: { value: 0 },
  uFogColor: { value: new Color(PALETTE.fog) },
  uFogTop: { value: -0.6 },
  uFogBottom: { value: -7.5 },
  uGrassSide: { value: new Color(PALETTE.grassSide) },
  uRuneColor: { value: new Color(PALETTE.rune) },
  uRuneGlow: { value: 1 },
  /** 0 hidden … 1 full emphasis (terrain tool active). */
  uRuneVis: { value: 0.35 },
  uRuneAnimate: { value: 1 },
  uAnims: { value: Array.from({ length: MAX_TERRAIN_ANIMS }, () => new Vector2(0, 0)) },
  uWind: { value: 1 },
};

export interface VoxelMaterialOptions {
  bevel?: number;
  terrainAnim?: boolean;
  transparent?: boolean;
  opacity?: number;
  emissiveStrength?: number;
  roughness?: number;
  /** Apply wind sway to vertices above `windBase` (local Y). */
  wind?: { base: number; strength: number };
}

export type VoxelMaterial = MeshStandardMaterial & {
  userData: { uniforms: { uTint: IUniform<Vector4>; uFlash: IUniform<number>; uOpacityMul: IUniform<number> } };
};

export function createVoxelMaterial(opts: VoxelMaterialOptions = {}): VoxelMaterial {
  const mat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: opts.roughness ?? 0.86,
    metalness: 0,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
  }) as VoxelMaterial;
  const local = {
    uBevel: { value: opts.bevel ?? 0.045 },
    uEmissiveStrength: { value: opts.emissiveStrength ?? 2.4 },
    uTint: { value: new Vector4(1, 1, 1, 0) },
    uFlash: { value: 0 },
    uOpacityMul: { value: 1 },
    uWindBase: { value: opts.wind?.base ?? 0 },
    uWindStrength: { value: opts.wind?.strength ?? 0 },
  };
  mat.userData.uniforms = local;
  const defines: string[] = [];
  if (opts.terrainAnim) defines.push('#define TERRAIN_ANIM');
  if (opts.wind) defines.push('#define WIND');

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sharedUniforms, local);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
${defines.join('\n')}
attribute float aAo;
attribute vec4 aUvE;
attribute float aEdge;
attribute float aFlags;
attribute float aAnim;
uniform float uTime;
uniform vec2 uAnims[${MAX_TERRAIN_ANIMS}];
uniform float uWindBase;
uniform float uWindStrength;
uniform float uWind;
varying float vAo;
varying vec4 vUvE;
varying float vEdge;
varying float vFlags;
varying vec3 vWorldPos;
varying vec3 vNormalW;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vAo = aAo; vUvE = aUvE; vEdge = aEdge; vFlags = aFlags;
#ifdef TERRAIN_ANIM
if (aAnim > 0.5) {
  for (int i = 0; i < ${MAX_TERRAIN_ANIMS}; i++) {
    if (abs(uAnims[i].x - aAnim) < 0.5) transformed.y += uAnims[i].y;
  }
}
#endif
#ifdef WIND
{
  float hgt = max(0.0, transformed.y - uWindBase);
  vec4 wp0 = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  #ifdef USE_INSTANCING
  wp0 = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  #endif
  float ph = wp0.x * 0.7 + wp0.z * 0.9;
  transformed.x += sin(uTime * 1.7 + ph) * hgt * uWindStrength * uWind;
  transformed.z += cos(uTime * 1.3 + ph * 1.3) * hgt * uWindStrength * 0.6 * uWind;
}
#endif`)
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 wp = vec4(transformed, 1.0);
  vec3 nw = objectNormal;
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  nw = mat3(instanceMatrix) * nw;
  #endif
  wp = modelMatrix * wp;
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * nw);
}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogTop;
uniform float uFogBottom;
uniform vec3 uGrassSide;
uniform vec3 uRuneColor;
uniform float uRuneGlow;
uniform float uRuneVis;
uniform float uRuneAnimate;
uniform float uBevel;
uniform float uEmissiveStrength;
uniform vec4 uTint;
uniform float uFlash;
uniform float uOpacityMul;
varying float vAo;
varying vec4 vUvE;
varying float vEdge;
varying float vFlags;
varying vec3 vWorldPos;
varying vec3 vNormalW;
float vxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
int vFlagBits = int(vFlags + 0.5);
{
  vec2 lp = vUvE.xy * vUvE.zw;
  vec4 ed = vec4(lp.x, vUvE.z - lp.x, lp.y, vUvE.w - lp.y);
  int bits = int(vEdge + 0.5);
  float bw = uBevel;
  float eU = 0.0; float eTop = 0.0; float eBot = 0.0;
  if ((bits & 1) != 0) eU = max(eU, 1.0 - smoothstep(0.0, bw, ed.x));
  if ((bits & 2) != 0) eU = max(eU, 1.0 - smoothstep(0.0, bw, ed.y));
  if ((bits & 4) != 0) eBot = 1.0 - smoothstep(0.0, bw, ed.z);
  if ((bits & 8) != 0) eTop = 1.0 - smoothstep(0.0, bw, ed.w);
  if ((vFlagBits & ${FLAG_NO_BEVEL}) == 0) {
    if (vNormalW.y > 0.5) {
      float e = max(max(eU, eTop), eBot);
      diffuseColor.rgb *= 1.0 + 0.16 * e;
    } else if (vNormalW.y < -0.5) {
      diffuseColor.rgb *= 1.0 - 0.1 * max(max(eU, eTop), eBot);
    } else {
      diffuseColor.rgb *= (1.0 + 0.14 * eTop) * (1.0 - 0.16 * eBot) * (1.0 + 0.07 * eU);
    }
  }
  if ((vFlagBits & ${FLAG_GRASS_SIDE}) != 0) {
    float distTop = vUvE.w - lp.y;
    float n = vxHash(floor(vWorldPos.xz * 12.0 + vec2(0.37, 0.71)));
    float fringe = 0.085 + 0.075 * n;
    if (distTop < fringe) {
      diffuseColor.rgb = uGrassSide * (0.94 + 0.12 * n);
    } else if (distTop < fringe + 0.03) {
      diffuseColor.rgb *= 0.78;
    }
  }
  if ((vFlagBits & ${FLAG_EDITABLE}) != 0 && vNormalW.y > 0.5) {
    vec2 f = fract(vWorldPos.xz);
    float d = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    float border = smoothstep(0.085, 0.07, d) * smoothstep(0.03, 0.045, d);
    vec2 c = abs(f - 0.5);
    float dia = c.x + c.y;
    float glyph = smoothstep(0.205, 0.19, dia) * smoothstep(0.155, 0.17, dia);
    glyph = max(glyph, smoothstep(0.03, 0.015, min(c.x, c.y)) * step(dia, 0.12) * step(0.05, dia));
    float corner = step(max(c.x, c.y), 0.44) * step(0.36, max(c.x, c.y)) * step(0.36, min(c.x, c.y));
    float mask = max(border, max(glyph * 0.8, corner * 0.6));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.82 + uRuneColor * 0.32, mask * 0.85 * uRuneVis);
    diffuseColor.rgb = mix(diffuseColor.rgb, uRuneColor, 0.06 * uRuneVis);
  }
  diffuseColor.rgb *= vAo;
  diffuseColor.rgb = mix(diffuseColor.rgb, uTint.rgb, uTint.a);
  diffuseColor.a *= uOpacityMul;
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if ((vFlagBits & ${FLAG_EMISSIVE}) != 0) totalEmissiveRadiance += diffuseColor.rgb * uEmissiveStrength;
if ((vFlagBits & ${FLAG_EDITABLE}) != 0 && vNormalW.y > 0.5) {
  vec2 f = fract(vWorldPos.xz);
  float d = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  float border = smoothstep(0.085, 0.07, d) * smoothstep(0.03, 0.045, d);
  vec2 c = abs(f - 0.5);
  float dia = c.x + c.y;
  float glyph = smoothstep(0.205, 0.19, dia) * smoothstep(0.155, 0.17, dia);
  float pulse = mix(0.6, 0.5 + 0.5 * sin(uTime * 2.2 + vWorldPos.x * 0.35 + vWorldPos.z * 0.25), uRuneAnimate);
  totalEmissiveRadiance += uRuneColor * max(border, glyph) * (0.12 + 0.38 * pulse) * uRuneGlow * uRuneVis * uRuneVis;
}
totalEmissiveRadiance += vec3(uFlash);`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
{
  float fogK = smoothstep(uFogTop, uFogBottom, vWorldPos.y);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fogK * 0.92);
}`);
  };
  mat.customProgramCacheKey = () => `voxel:${defines.join('|')}`;
  return mat;
}
