import type { QualityLevel } from '../scene/render/pipeline';

/** Phones and tablets: coarse primary pointer, or a mobile UA (iPadOS reports a desktop UA but has touch). */
export function isMobileDevice(): boolean {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const ua = navigator.userAgent ?? '';
  return coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * Auto quality tier. Mobile GPUs share a thermal budget with the CPU and run at 2–3× DPR,
 * so phones start at medium (DPR capped at 1, no SSAO) and drop to low on weak hardware;
 * dynamic resolution still adapts from there.
 */
export function autoQuality(d: { cores: number; memGb: number; mobile: boolean }): QualityLevel {
  if (d.mobile) return d.memGb <= 3 || d.cores <= 4 ? 'low' : 'medium';
  return d.cores <= 4 || d.memGb <= 4 ? 'medium' : 'high';
}
