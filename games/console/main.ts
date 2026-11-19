import { EventPublisher, EventPublisherState } from '../shared/EventPublisher';
import { BattleshipSession } from '../battleship/BattleshipSession';
import { BattleshipView } from '../battleship/BattleshipView';
import { MemorySession } from '../memory/MemorySession';
import { MemoryView } from '../memory/MemoryView';
import { PrologClient, TicTacToeSession, TicTacToeView } from '../tictactoe/src';
import { StatsPanel } from './StatsPanel';
import './style.css';

type GameId = 'TIC_TAC_TOE' | 'MEMORY' | 'BATTLESHIP';

interface ActiveGame {
  gameId: GameId;
  matchId: string;
  abandon: () => void;
  unmount: () => void;
  card: HTMLElement;
}

const runtimeConfig = window.GAMECONSOLE_CONFIG ?? {};
const goUrl = (runtimeConfig.goUrl || import.meta.env.VITE_GO_URL || 'http://localhost:8081').replace(/\/+$/, '');
const scalaUrl = (runtimeConfig.scalaUrl || import.meta.env.VITE_SCALA_URL || 'http://localhost:8080').replace(/\/+$/, '');
const prologUrl = (runtimeConfig.prologUrl || import.meta.env.VITE_PROLOG_URL || 'http://localhost:8082').replace(/\/+$/, '');
const playerId = getPlayerId();
const publisher = new EventPublisher({ baseUrl: goUrl });
const activeGames = new Map<string, ActiveGame>();
const deliveryStates = new Map<string, EventPublisherState>();
const sessionList = document.querySelector<HTMLElement>('#sessions')!;
const deliveryStatus = document.querySelector<HTMLElement>('#delivery-status')!;
const sessionCount = document.querySelector<HTMLElement>('#session-count')!;
const playSection = document.querySelector<HTMLElement>('#play-section')!;
const statsSection = document.querySelector<HTMLElement>('#stats-section')!;
const statsPanel = new StatsPanel(document.querySelector<HTMLElement>('#stats-panel')!, goUrl, scalaUrl);

document.querySelector<HTMLElement>('#player-label')!.textContent = `Jugador ${playerId.slice(0, 8)}`;
document.querySelector<HTMLElement>('#service-urls')!.textContent =
  `Go ${goUrl} · Scala ${scalaUrl} · Prolog ${prologUrl}`;

document.querySelectorAll<HTMLButtonElement>('[data-game]').forEach((button) => {
  button.addEventListener('click', () => {
    const gameId = button.dataset.game;
    if (isGameId(gameId)) createGame(gameId);
  });
});

document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => selectTab(button.dataset.tab === 'stats' ? 'stats' : 'play'));
});

publisher.subscribe((state) => {
  if (state.pending === 0 && state.failure === null) deliveryStates.delete(state.matchId);
  else deliveryStates.set(state.matchId, state);
  renderDeliveryStatus();
});

window.addEventListener('beforeunload', () => {
  for (const game of activeGames.values()) game.abandon();
  statsPanel.stop();
});

renderSessionCount();

function createGame(gameId: GameId): void {
  const card = document.createElement('article');
  card.className = 'game-card';
  const header = document.createElement('header');
  header.className = 'game-card__head';
  const title = document.createElement('h3');
  title.textContent = gameTitle(gameId);
  const content = document.createElement('div');
  content.className = 'game-card__content';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-button';
  close.textContent = 'Cerrar';
  close.setAttribute('aria-label', 'Cerrar partida');
  header.append(title, close);
  card.append(header, content);
  sessionList.prepend(card);

  let game: ActiveGame;
  if (gameId === 'TIC_TAC_TOE') {
    const session = new TicTacToeSession({
      humanPlayerId: playerId,
      advisor: new PrologClient(prologUrl),
      events: publisher,
    });
    const view = new TicTacToeView(session);
    view.mount(content);
    session.start();
    game = {
      gameId,
      matchId: session.matchId,
      abandon: () => session.abandon(),
      unmount: () => view.unmount(),
      card,
    };
  } else if (gameId === 'MEMORY') {
    const session = new MemorySession({ playerId, events: publisher });
    const view = new MemoryView(session);
    view.mount(content);
    session.start();
    game = {
      gameId,
      matchId: session.matchId,
      abandon: () => session.abandon(),
      unmount: () => view.unmount(),
      card,
    };
  } else {
    const session = new BattleshipSession({ playerId, events: publisher });
    const view = new BattleshipView(session);
    view.mount(content);
    session.start();
    game = {
      gameId,
      matchId: session.matchId,
      abandon: () => session.abandon(),
      unmount: () => view.unmount(),
      card,
    };
  }
  activeGames.set(game.matchId, game);
  close.addEventListener('click', () => closeGame(game.matchId));
  renderSessionCount();
}

function closeGame(matchId: string): void {
  const game = activeGames.get(matchId);
  if (!game) return;
  game.abandon();
  game.unmount();
  game.card.remove();
  activeGames.delete(matchId);
  renderSessionCount();
}

function selectTab(tab: 'play' | 'stats'): void {
  playSection.hidden = tab !== 'play';
  statsSection.hidden = tab !== 'stats';
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
    button.classList.toggle('tab--active', button.dataset.tab === tab);
  });
  if (tab === 'stats') statsPanel.start();
  else statsPanel.stop();
}

function renderSessionCount(): void {
  sessionCount.textContent = String(activeGames.size);
  if (activeGames.size === 0) {
    if (!sessionList.querySelector('.empty-state')) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No hay partidas abiertas. Elige un juego para comenzar.';
      sessionList.append(empty);
    }
  } else {
    sessionList.querySelector('.empty-state')?.remove();
  }
}

function renderDeliveryStatus(): void {
  deliveryStatus.replaceChildren();
  const failures = [...deliveryStates.values()].filter((state) => state.failure !== null);
  const pending = [...deliveryStates.values()].reduce((sum, state) => sum + state.pending, 0);
  const message = document.createElement('span');
  const failed = failures.find((state) => state.failure !== null);
  const failure = failed?.failure;
  if (failed && failure) {
    deliveryStatus.className = 'delivery-status delivery-status--error';
    message.textContent =
      `No se entregó el evento ${failure.eventId} (${failure.matchId.slice(0, 8)}): ${failure.message}`;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'text-button';
    retry.textContent = 'Reintentar';
    retry.addEventListener('click', () => failures.forEach((state) => publisher.retry(state.matchId)));
    deliveryStatus.append(message, retry);
    return;
  }
  deliveryStatus.className = pending > 0 ? 'delivery-status' : 'delivery-status delivery-status--ok';
  message.textContent = pending > 0 ? `${pending} evento(s) pendientes de GameStats.` : 'Eventos sincronizados con GameStats.';
  deliveryStatus.append(message);
}

function getPlayerId(): string {
  const key = 'gameconsole-player-id';
  let stored = localStorage.getItem(key);
  if (!stored) {
    stored = crypto.randomUUID();
    localStorage.setItem(key, stored);
  }
  return stored;
}

function gameTitle(gameId: GameId): string {
  switch (gameId) {
    case 'TIC_TAC_TOE':
      return 'Gato vs Prolog';
    case 'MEMORY':
      return 'Memoria';
    case 'BATTLESHIP':
      return 'Battleship';
  }
}

function isGameId(value: string | undefined): value is GameId {
  return value === 'TIC_TAC_TOE' || value === 'MEMORY' || value === 'BATTLESHIP';
}
