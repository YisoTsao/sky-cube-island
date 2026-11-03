import { controller, selectLevel, syncStore } from '../app/runtime';
import { audio } from '../audio/audio';
import { useUi } from '../state/store';

/** Switch to `id` and enter the game (continuing its save when `cont` and one exists). */
export async function launchLevel(id: string, cont: boolean): Promise<void> {
  audio.unlock();
  audio.play('click');
  selectLevel(id);
  if (!(cont && (await controller.loadSave()))) controller.newGame();
  syncStore();
  useUi.getState().set({
    screen: 'game', levelId: id, tutorialStep: cont || id !== 'L1-01' ? 9 : 0,
    lastWaveStats: null, failureText: null, endlessNewBest: 0, selection: null, tool: { type: 'none' }, preview: null, stars: 0,
  });
}
