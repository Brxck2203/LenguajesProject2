import { EventSink } from '../../shared/GameEvent';
import { PrologClient, TicTacToeSession, TicTacToeView } from '../src';

const games = document.getElementById('games')!;
const log = document.getElementById('log')!;
const url = document.getElementById('url') as HTMLInputElement;
const aiFirst = document.getElementById('aiFirst') as HTMLInputElement;

/** En la consola real este papel lo cumple el EventPublisher que envía a GameStats. */
const logSink: EventSink = {
  publish(event) {
    const line = `${event.timestamp.slice(11, 23)} ${event.matchId.slice(0, 8)} ${event.playerId.padEnd(9)} ${event.action} ${JSON.stringify(event.data)}\n`;
    log.textContent = line + log.textContent;
  },
};

function addGame(): void {
  const slot = document.createElement('div');
  games.append(slot);
  const session = new TicTacToeSession({
    humanPlayerId: 'demo-player',
    advisor: new PrologClient(url.value),
    events: logSink,
    humanStarts: !aiFirst.checked,
  });
  const view = new TicTacToeView(session, {
    onNewGame: () => {
      session.abandon();
      view.unmount();
      slot.remove();
      addGame();
    },
  });
  view.mount(slot);
  session.start();
  window.addEventListener('beforeunload', () => session.abandon());
}

document.getElementById('add')!.addEventListener('click', addGame);
addGame();
