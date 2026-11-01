import type { ReactElement } from 'react';
import type { EnemyKind, TowerKind } from '../domain/types';

/** Vector icons (GDD §12.1: all UI icons are SVG, crisp at any DPR). */
export function TowerIcon({ kind, size = 40 }: { kind: TowerKind; size?: number }): ReactElement {
  if (kind === 'arrow') return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <rect x="9" y="30" width="22" height="6" rx="1" fill="#8f939c" />
      <path d="M12 30 14 14h12l2 16Z" fill="#b07a4b" stroke="#825a37" strokeWidth="1.5" />
      <rect x="10" y="11" width="20" height="4" rx="1" fill="#d39d65" stroke="#825a37" strokeWidth="1.2" />
      <path d="M8 9h24M20 3v10" stroke="#f5e6c8" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M17 6l3-3 3 3" fill="none" stroke="#5b5f6a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (kind === 'frost') return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <rect x="8" y="30" width="24" height="6" rx="1" fill="#b4ab98" />
      <path d="M20 3 26 13 24 30H16L14 13Z" fill="#61d6ff" stroke="#2f9fe0" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M20 3v27M14 13h12" stroke="#b8f1ff" strokeWidth="1.2" opacity=".8" />
      <path d="M11 18 13 22 12 30H8l1-8Z M29 18 27 22 28 30h4l-1-8Z" fill="#9fe7ff" stroke="#2f9fe0" strokeWidth="1" />
    </svg>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <rect x="5" y="24" width="30" height="12" rx="1.5" fill="#8f939c" stroke="#6e7380" strokeWidth="1.5" />
      <path d="M5 24v-4h5v4M15 24v-4h4v4M23 24v-4h4v4M30 24v-4h5v4" fill="#adb1b8" />
      <rect x="15" y="9" width="14" height="9" rx="4" transform="rotate(-22 22 13)" fill="#5b5f6a" stroke="#3b3e46" strokeWidth="1.5" />
      <circle cx="16" cy="19" r="5" fill="#825a37" stroke="#5c3d27" strokeWidth="1.5" />
    </svg>
  );
}

export function EnemyIcon({ kind, size = 22 }: { kind: EnemyKind; size?: number }): ReactElement {
  if (kind === 'slime') return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden><path d="M3 19c0-8 4-14 9-14s9 6 9 14Z" fill="#72dc5a" stroke="#46b13e" strokeWidth="1.5" /><rect x="8" y="11" width="2.4" height="3" fill="#1d2333" /><rect x="13.6" y="11" width="2.4" height="3" fill="#1d2333" /></svg>
  );
  if (kind === 'runner') return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden><path d="M2 14 7 9h9l5 3-2 3h-3l-1 5h-2l-1-4H9l-2 4H5l1-5Z" fill="#ff9a3c" stroke="#d8691f" strokeWidth="1.2" strokeLinejoin="round" /><circle cx="17.5" cy="11.5" r="1" fill="#1d2333" /></svg>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden><rect x="3" y="5" width="18" height="13" rx="2" fill="#8f8b94" stroke="#6c6873" strokeWidth="1.5" /><rect x="3" y="5" width="18" height="4" fill="#5f9441" /><rect x="7" y="18" width="4" height="3" fill="#6c6873" /><rect x="13" y="18" width="4" height="3" fill="#6c6873" /><rect x="8" y="11" width="2.5" height="2" fill="#ffa040" /><rect x="13.5" y="11" width="2.5" height="2" fill="#ffa040" /></svg>
  );
}

export const CoinIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="10" fill="#f2c14e" stroke="#c9932f" strokeWidth="2" />
    <path d="M12 6 16 12 12 18 8 12Z" fill="#fff3c4" stroke="#c9932f" strokeWidth="1.2" />
  </svg>
);
export const HeartIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d="M12 2 20 12 12 22 4 12Z" fill="#7fe9ff" stroke="#2fb8ff" strokeWidth="2" strokeLinejoin="round" />
    <path d="M12 5 9 12h6Z" fill="#e6fbff" opacity=".85" />
  </svg>
);
export const RaiseIcon = () => (<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden><rect x="4" y="18" width="24" height="10" fill="#a0704a" /><rect x="4" y="15" width="24" height="4" fill="#84c95c" /><path d="M16 3 22 10H18v4h-4v-4h-4Z" fill="#fff" stroke="#3a3f4b" strokeWidth="1.4" strokeLinejoin="round" /></svg>);
export const LowerIcon = () => (<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden><rect x="4" y="18" width="24" height="10" fill="#a0704a" /><rect x="4" y="15" width="24" height="4" fill="#84c95c" /><path d="M16 14 22 7H18V3h-4v4h-4Z" fill="#fff" stroke="#3a3f4b" strokeWidth="1.4" strokeLinejoin="round" /></svg>);
export const WallIcon = () => (<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden><rect x="3" y="22" width="26" height="6" fill="#8f939c" /><path d="M6 22V9l2-2 2 2v13M13 22V7l2-2 2 2v15M20 22V9l2-2 2 2v13" fill="#b07a4b" stroke="#825a37" strokeWidth="1.3" /><path d="M4 13h24M4 18h24" stroke="#825a37" strokeWidth="2" /></svg>);
export const UndoIcon = () => (<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden><path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12h-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" transform="translate(0 -3)" /></svg>);
export const GearIcon = () => (<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.5 4 2-1.5-2-3.5-2.4.8a7 7 0 0 0-1.7-1L16 4.3h-4l-.4 2.5a7 7 0 0 0-1.7 1L7.5 7 5.5 10.5l2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-.8a7 7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.4.8 2-3.5-2-1.5a7 7 0 0 0 0-2Z" fill="currentColor" /></svg>);
export const PauseIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" /><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" /></svg>);
export const PlayIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden><path d="M7 4 19 12 7 20Z" fill="currentColor" /></svg>);
export const RotateIcon = ({ dir }: { dir: 1 | -1 }) => (<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden style={{ transform: dir < 0 ? 'scaleX(-1)' : undefined }}><path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>);
export const StarIcon = ({ filled, size = 46 }: { filled: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden><path d="M12 2.5 14.9 8.6 21.5 9.4 16.6 13.9 17.9 20.5 12 17.2 6.1 20.5 7.4 13.9 2.5 9.4 9.1 8.6Z" fill={filled ? '#ffd34a' : '#3a3f4b'} stroke={filled ? '#c9932f' : '#22252d'} strokeWidth="1.5" strokeLinejoin="round" /></svg>
);
