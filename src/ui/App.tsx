import { useEffect, useState } from 'react';
import { applyInitialSettings, controller, syncStore } from '../app/runtime';
import { useUi } from '../state/store';
import { audio } from '../audio/audio';
import { GameView } from './GameView';
import { HelpPanel, Hud, SettingsPanel } from './Hud';
import { HeartIcon } from './icons';

applyInitialSettings();
const params = new URLSearchParams(location.search);

function Title() {
  const hasSave = useUi((s) => s.hasSave);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void controller.hasSave().then((v) => useUi.getState().set({ hasSave: v })); }, []);
  const go = async (cont: boolean) => {
    if (busy) return;
    setBusy(true);
    audio.unlock();
    audio.play('click');
    if (cont && (await controller.loadSave())) { /* loaded */ } else controller.newGame();
    syncStore();
    useUi.getState().set({ screen: 'game', tutorialStep: cont ? 9 : 0, lastWaveStats: null, failureText: null, selection: null, tool: { type: 'none' } });
    setBusy(false);
  };
  return (
    <div className="title-screen">
      <div className="title-sky">
        {Array.from({ length: 14 }, (_, i) => <i key={i} className="title-cloud" style={{ ['--i' as string]: i, top: `${48 + ((i * 37) % 46)}%` }} />)}
      </div>
      <div className="title-card">
        <div className="title-gem"><HeartIcon size={64} /></div>
        <h1 className="title-logo">
          <span className="logo-main">天空方塊島</span>
          <span className="logo-sub">守護之心</span>
        </h1>
        <p className="title-tag">改造地形、架設高塔，守住漂浮島嶼的心臟。</p>
        <div className="title-buttons">
          {hasSave && <button className="btn primary big" disabled={busy} onClick={() => void go(true)}>繼續遊戲</button>}
          <button className={`btn big ${hasSave ? '' : 'primary'}`} disabled={busy} onClick={() => void go(false)}>{hasSave ? '新遊戲' : '開始遊戲'}</button>
          <div className="title-row">
            <button className="btn ghost" onClick={() => useUi.getState().set({ settingsOpen: true })}>設定</button>
            <button className="btn ghost" onClick={() => useUi.getState().set({ helpOpen: true })}>操作說明</button>
          </div>
        </div>
        <div className="title-foot">L1-01 · 漂浮的三座島 · 5 波</div>
      </div>
      <SettingsPanel />
      <HelpPanel />
    </div>
  );
}

export function App() {
  const screen = useUi((s) => s.screen);
  useEffect(() => {
    // Test / capture hooks: ?play skips the title (new game), ?continue loads the save.
    if (params.has('play') || params.has('visualTest') || params.has('nointro')) {
      controller.newGame();
      syncStore();
      useUi.getState().set({ screen: 'game', tutorialStep: params.has('visualTest') ? 9 : 0 });
    }
  }, []);
  if (screen === 'title') return <Title />;
  return (
    <>
      <GameView />
      <Hud />
    </>
  );
}
