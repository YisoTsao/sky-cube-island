import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

// A game screen must never page-zoom: a two-finger pinch that starts on a HUD panel would
// otherwise zoom the whole page on phones (most visibly in landscape, where panels cover more of
// the screen), leaving a blown-up view that can't be panned back because the canvas swallows
// touches. iOS Safari ignores user-scalable=no, so block its gesture events and multi-touch
// moves outside scrollable panels as well. Camera pinch-zoom is handled on the canvas itself.
const blockPageZoom = (e: Event) => e.preventDefault();
document.addEventListener('gesturestart', blockPageZoom, { passive: false });
document.addEventListener('gesturechange', blockPageZoom, { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

createRoot(document.getElementById('root')!).render(<App />);
