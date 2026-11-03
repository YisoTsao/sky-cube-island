import { Fragment, useEffect, useState } from 'react';
import { applyInitialSettings, controller, level, syncStore } from '../app/runtime';
import { useUi } from '../state/store';
import { audio } from '../audio/audio';
import { GameView } from './GameView';
import { HelpPanel, Hud, SettingsPanel } from './Hud';
import { HeartIcon, StarIcon } from './icons';
import { LEVEL_IDS, getLevel, isLevelId, type LevelId } from '../levels/registry';
import { isEndlessUnlocked, isUnlocked } from '../persistence/progress';
import { endlessIdOf } from '../levels/endless';
import { challengesFor } from '../domain/challenges';
import { readSave } from '../persistence/save';
import { launchLevel } from './launch';
import { CHAPTERS } from '../levels/campaign';
import { dailyIdFor, makeDailyLevel, todayString } from '../levels/daily';
import { WEATHER_NAME } from './Hud';

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
        {(progress.endless?.[id] ?? 0) > 0 && <span className="level-card-best endless">無盡 {progress.endless![id]} 波</span>}
      </span>
      {!open && <span className="level-card-lock" aria-hidden>🔒</span>}
    </button>
  );
}

function DailyCard({ date }: { date: string }) {
  const progress = useUi((s) => s.progress);
  const l = makeDailyLevel(date);
  const id = dailyIdFor(date);
  const rec = progress.records?.[id];
  const best = progress.best[id] ?? 0;
  const kinds = new Set(l.waves.flatMap((w) => w.entries.map((e) => e.enemyKind)));
  return (
    <div className={`level-card daily selected theme-${l.theme ?? 'day'}`}>
      <span className="level-card-id">每日挑戰・{date}</span>
      <span className="level-card-name">{l.name}</span>
      <span className="level-card-sub">{l.daily?.modifiers.join('・')}{l.weather && l.weather !== 'clear' ? `・${WEATHER_NAME[l.weather]}` : ''}</span>
      <span className="level-card-meta">{l.waves.length} 波 · {l.portals.length} 個入口 · {kinds.size} 種怪物 · 起始 {l.initialGold} 金</span>
      <span className="level-card-stars">
        {[1, 2, 3].map((i) => <StarIcon key={i} filled={best >= i} size={18} />)}
        {rec && rec.bestHp > 0 ? <span className="level-card-best">今日最佳 {rec.bestHp}♥</span> : <span className="level-card-best">每天換一座新島，所有玩家同一張地圖</span>}
      </span>
    </div>
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
  const [chapter, setChapter] = useState(() => Math.max(0, CHAPTERS.findIndex((c) => c.levelIds.includes(picked))));
  const [endless, setEndless] = useState(false);
  const isDaily = chapter === CHAPTERS.length;
  const [today] = useState(() => todayString());
  const endlessOpen = !isDaily && isEndlessUnlocked(picked, progress);
  const playId = isDaily ? dailyIdFor(today) : endless && endlessOpen ? endlessIdOf(picked) : picked;
  useEffect(() => {
    useUi.getState().set({ hasSave: false });
    void readSave(playId).then((v) => useUi.getState().set({ hasSave: !!v }));
  }, [playId]);
  const go = async (cont: boolean) => {
    if (busy) return;
    setBusy(true);
    await launchLevel(playId, cont);
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
        <div className="chapter-tabs" role="tablist" aria-label="選擇章節">
          {CHAPTERS.map((c, i) => {
            const first = c.levelIds[0] as LevelId;
            const open = isUnlocked(first, progress);
            const cleared = c.levelIds.filter((id) => (progress.best[id] ?? 0) > 0).length;
            return (
              <button
                key={c.id} role="tab" aria-selected={chapter === i} disabled={!open}
                className={`chapter-tab ${chapter === i ? 'on' : ''}`}
                title={open ? c.subtitle : '通關上一章後解鎖'}
                onClick={() => { audio.play('click'); setChapter(i); const ids = c.levelIds.filter((id) => isUnlocked(id as LevelId, progress)); setPicked((ids[ids.length - 1] ?? first) as LevelId); }}
              >
                {c.name}{open ? <span className="chapter-count">{cleared}/{c.levelIds.length}</span> : ' 🔒'}
              </button>
            );
          })}
          <button role="tab" aria-selected={isDaily} className={`chapter-tab daily ${isDaily ? 'on' : ''}`} title="每天一座新島，所有玩家同一張地圖" onClick={() => { audio.play('click'); setChapter(CHAPTERS.length); }}>
            ☀ 每日挑戰
          </button>
        </div>
        <div className="level-select" role="group" aria-label="選擇關卡">
          {isDaily
            ? <DailyCard date={today} />
            : (CHAPTERS[chapter]?.levelIds ?? LEVEL_IDS).map((id) => <LevelCard key={id} id={id as LevelId} selected={picked === id} onPick={() => { audio.play('click'); setPicked(id as LevelId); }} />)}
        </div>
        <div className="mode-switch" role="group" aria-label="遊戲模式" hidden={isDaily}>
          <button className={`mode-btn ${!endless || !endlessOpen ? 'on' : ''}`} aria-pressed={!endless || !endlessOpen} onClick={() => { audio.play('click'); setEndless(false); }}>戰役</button>
          <button
            className={`mode-btn ${endless && endlessOpen ? 'on' : ''}`} aria-pressed={endless && endlessOpen} disabled={!endlessOpen}
            title={endlessOpen ? '波次永不停止，挑戰最高波數' : '通關這一關後解鎖'}
            onClick={() => { audio.play('click'); setEndless(true); }}
          >
            無盡模式{endlessOpen ? '' : ' 🔒'}
          </button>
          <span className="mode-note">
            {endlessOpen
              ? endless ? `敵人一波比一波強，看你能撐幾波・最佳 ${progress.endless?.[picked] ?? 0} 波` : '五～七波的固定關卡，通關可得星等'
              : '通關這一關後解鎖無盡模式'}
          </span>
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
