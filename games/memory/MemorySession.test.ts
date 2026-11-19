import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameEvent } from '../shared/GameEvent';
import { MemorySession } from './MemorySession';

function createSession() {
  const events: GameEvent[] = [];
  let id = 0;
  const session = new MemorySession({
    playerId: 'player-1',
    events: { publish: (event) => events.push(event) },
    matchId: 'memory-match',
    newId: () => `id-${++id}`,
    now: () => new Date('2026-11-19T10:00:00Z'),
    random: () => 0.42,
    mismatchDelayMs: 500,
  });
  return { session, events };
}

afterEach(() => vi.useRealTimers());

describe('MemorySession', () => {
  it('crea una baraja aislada de 12 cartas y rechaza acciones inválidas', () => {
    const { session, events } = createSession();
    const firstState = session.getState();
    expect(firstState.cards).toHaveLength(12);
    expect(new Set(firstState.cards.map((card) => card.symbol)).size).toBe(6);
    const counts = new Map<string, number>();
    for (const card of firstState.cards) counts.set(card.symbol, (counts.get(card.symbol) ?? 0) + 1);
    expect([...counts.values()]).toEqual(Array(6).fill(2));

    firstState.cards[0].faceUp = true;
    expect(session.getState().cards[0].faceUp).toBe(false);
    expect(session.applyAction({ type: 'FLIP', cardIndex: -1 }).ok).toBe(false);
    expect(events).toHaveLength(0);

    session.start();
    expect(events[0].action).toBe('MATCH_STARTED');
    expect(events[0].data).toEqual({ mode: 'SOLO', pairs: 6 });
  });

  it('registra intentos en orden, bloquea una tercera carta y oculta un intento fallido', async () => {
    vi.useFakeTimers();
    const { session, events } = createSession();
    session.start();
    const cards = session.getState().cards;
    const first = 0;
    const second = cards.findIndex((card, index) => index > first && card.symbol !== cards[first].symbol);
    const third = cards.findIndex((card, index) => index !== first && index !== second);

    expect(session.applyAction({ type: 'FLIP', cardIndex: first }).ok).toBe(true);
    expect(session.applyAction({ type: 'FLIP', cardIndex: second }).ok).toBe(true);
    expect(session.applyAction({ type: 'FLIP', cardIndex: third }).ok).toBe(false);
    expect(session.getState().status).toBe('RESOLVING');
    expect(events.slice(1).map((event) => event.action)).toEqual([
      'CARD_FLIPPED',
      'CARD_FLIPPED',
      'PAIR_ATTEMPTED',
    ]);
    expect(events[3].data).toMatchObject({ firstCard: first, secondCard: second, matched: false, attempt: 1 });

    await vi.advanceTimersByTimeAsync(500);
    expect(session.getState().status).toBe('WAITING_FOR_FIRST');
    expect(session.getState().cards[first].faceUp).toBe(false);
    expect(session.getState().cards[second].faceUp).toBe(false);
  });

  it('termina una sola vez al encontrar las seis parejas y conserva el ganador', () => {
    const { session, events } = createSession();
    session.start();
    const cards = session.getState().cards;
    const symbols = [...new Set(cards.map((card) => card.symbol))];

    for (const symbol of symbols) {
      const pair = cards.filter((card) => card.symbol === symbol);
      expect(session.applyAction({ type: 'FLIP', cardIndex: pair[0].index }).ok).toBe(true);
      expect(session.applyAction({ type: 'FLIP', cardIndex: pair[1].index }).ok).toBe(true);
    }

    expect(session.getState()).toMatchObject({ status: 'FINISHED', pairsFound: 6, finishReason: 'COMPLETED' });
    const finishEvents = events.filter((event) => event.action === 'MATCH_FINISHED');
    expect(finishEvents).toHaveLength(1);
    expect(finishEvents[0].data).toEqual({ reason: 'COMPLETED', winnerPlayerId: 'player-1' });
    expect(session.applyAction({ type: 'FLIP', cardIndex: 0 }).ok).toBe(false);
  });

  it('abandona una partida abierta sin dejar pendiente el temporizador', () => {
    vi.useFakeTimers();
    const { session, events } = createSession();
    session.start();
    const cards = session.getState().cards;
    const first = 0;
    const second = cards.findIndex((card) => card.symbol !== cards[first].symbol);
    session.applyAction({ type: 'FLIP', cardIndex: first });
    session.applyAction({ type: 'FLIP', cardIndex: second });
    session.abandon();
    vi.runOnlyPendingTimers();

    expect(session.getState()).toMatchObject({ status: 'FINISHED', finishReason: 'ABANDONED' });
    expect(events.filter((event) => event.action === 'MATCH_FINISHED')).toHaveLength(1);
  });
});
