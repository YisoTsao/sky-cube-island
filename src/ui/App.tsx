import { Fragment, useEffect, useState } from 'react';
import { applyInitialSettings, controller, level, syncStore } from '../app/runtime';
import { useUi } from '../state/store';
import { audio } from '../audio/audio';
import { GameView } from './GameView';
import { HelpPanel, Hud, SettingsPanel } from './Hud';
import { HeartIcon, StarIcon } from './icons';
import { LEVEL_IDS, getLevel, isLevelId, type LevelId } from '../levels/registry';
import { isUnlocked } from '../persistence/progress';
import { challengesFor } from '../domain/challenges';
import { readSave } from '../persistence/save';
import { launchLevel } from './launch';

applyInitialSettings();
const params = new URLSearchParams(location.search);

function LevelCard({ id, selected, onPick }: { id: LevelId; selected: boolean; onPick: () => void }) {
  const progress = useUi((s) => s.progress);
  const l = getLevel(id);
  const open = isUnlocked(id, progress);
  const best = progress.best[id] ?? 0;
  const kinds = new Set(l.waves.flatMap((w) => w.entries.map((e) => e.enemyKind)));
  const challenges = challengesFor(l);
  const rec = progress.records?.[id];
  const done = challenges.filter((c) => rec?.challenges.includes(c.id)).length;
  return (
    <button
      className={`level-card ${selected ? 'selected' : ''} ${open ? '' : 'locked'} theme-${l.theme ?? 'day'}`}
      disabled={!open} onClick={onPick} aria-pressed={selected}
    >
      <span className="level-card-id">{l.id}</span>
      <span className="level-card-name">{l.name}</span>
      <span className="level-card-sub">{open ? l.subtitle : `通關 ${getLevel(LEVEL_IDS[LEVEL_IDS.indexOf(id) - 1]!).name} 後解鎖`}</span>
      <span className="level-card-meta">{l.waves.length} 波 · {l.portals.length} 個入口 · {kinds.size} 種怪物</span>
      <span className="level-card-stars">
        {[1, 2, 3].map((i) => <StarIcon key={i} filled={best >= i} size={18} />)}
        {open && challenges.length > 0 && <span className="level-card-challenges" title={challenges.map((c) => `${rec?.challenges.includes(c.id) ? '✓' : '・'} ${c.label}`).join('\n')}>挑戰 {done}/{challenges.length}</span>}
        {rec && rec.bestHp > 0 && <span className="level-card-best">最佳 {rec.bestHp}♥</span>}
      </span>
      {!open && <span className="level-card-lock" aria-hidden>🔒</span>}
    </button>
  );
}

function Title() {
  const hasSave = useUi((s) => s.hasSave);
  const progress = useUi((s) => s.progress);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<LevelId>(() => {
    // default to the furthest unlocked level
    const open = LEVEL_IDS.filter((id) => isUnlocked(id, progress));
    // stay on the current level until it is cleared, then move on to the furthest open one
    const current = useUi.getState().levelId;
    if (isLevelId(current) && open.includes(current) && !progress.best[current]) return current;
    return open[open.length - 1] ?? 'L1-01';
  });
  useEffect(() => {
    useUi.getState().set({ hasSave: false });
    void readSave(picked).then((v) => useUi.getState().set({ hasSave: !!v }));
  }, [picked]);
  const go = async (cont: boolean) => {
    if (busy) return;
    setBusy(true);
    await launchLevel(picked, cont);
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
        <div className="level-select" role="group" aria-label="選擇關卡">
          {LEVEL_IDS.map((id) => <LevelCard key={id} id={id} selected={picked === id} onPick={() => { audio.play('click'); setPicked(id); }} />)}
        </div>
        <div className="title-buttons">
          {hasSave && <button className="btn primary big" disabled={busy} onClick={() => void go(true)}>繼續遊戲</button>}
          <button className={`btn big ${hasSave ? '' : 'primary'}`} disabled={busy} onClick={() => void go(false)}>{hasSave ? '新遊戲' : '開始遊戲'}</button>
          <div className="title-row">
            <button className="btn ghost" onClick={() => useUi.getState().set({ settingsOpen: true })}>設定</button>
            <button className="btn ghost" onClick={() => useUi.getState().set({ helpOpen: true })}>操作說明</button>
          </div>
        </div>
      </div>
      <SettingsPanel />
      <HelpPanel />
    </div>
  );
}

export function App() {
  const screen = useUi((s) => s.screen);
  const levelId = useUi((s) => s.levelId);
  useEffect(() => {
    // Test / capture hooks: ?play skips the title (new game), ?continue loads the save.
    if (params.has('play') || params.has('visualTest') || params.has('nointro')) {
      controller.newGame();
      syncStore();
      useUi.getState().set({ screen: 'game', levelId: level.id, tutorialStep: params.has('visualTest') || level.id !== 'L1-01' ? 9 : 0 });
    }
  }, []);
  if (screen === 'title') return <Title />;
  return (
    <Fragment key={levelId}>
      <GameView />
      <Hud />
    </Fragment>
  );
}
