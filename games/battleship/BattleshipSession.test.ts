import { describe, expect, it } from 'vitest';
import { GameEvent } from '../shared/GameEvent';
import { BattleshipSession } from './BattleshipSession';

function createSession() {
  const events: GameEvent[] = [];
  let id = 0;
  const session = new BattleshipSession({
    playerId: 'player-1',
    events: { publish: (event) => events.push(event) },
    matchId: 'battle-match',
    newId: () => `id-${++id}`,
    now: () => new Date('2026-11-19T10:00:00Z'),
    random: () => 0.1,
  });
  return { session, events };
}

describe('BattleshipSession', () => {
  it('coloca barcos de tamaños 3/2/2 sin solaparlos y oculta la flota rival', () => {
    const { session } = createSession();
    const state = session.getState();
    expect(state.humanBoard).toHaveLength(36);
    expect(state.opponentBoard).toHaveLength(36);
    expect(state.ownShips.map((ship) => ship.size).sort()).toEqual([2, 2, 3]);
    expect(new Set(state.ownShips.flatMap((ship) => ship.cells)).size).toBe(7);
    expect(state.opponentBoard.every((cell) => !cell.ship)).toBe(true);
    expect(state.status).toBe('NOT_STARTED');
  });

  it('rechaza disparos inválidos y repetidos sin producir eventos', () => {
    const { session, events } = createSession();
    expect(session.applyAction({ type: 'FIRE', position: 0 }).ok).toBe(false);
    session.start();
    expect(session.applyAction({ type: 'FIRE', position: 36 }).ok).toBe(false);
    expect(session.applyAction({ type: 'FIRE', position: 0 }).ok).toBe(true);
    const countAfterValidShot = events.length;

    expect(session.applyAction({ type: 'FIRE', position: 0 }).ok).toBe(false);
    expect(events).toHaveLength(countAfterValidShot);
    expect(events[0].action).toBe('MATCH_STARTED');
    expect(events[1]).toMatchObject({
      playerId: 'player-1',
      action: 'SHOT_FIRED',
      data: { targetPlayerId: 'CPU', row: 0, col: 0, hit: expect.any(Boolean) },
    });
    expect(events[2]).toMatchObject({
      playerId: 'CPU',
      action: 'SHOT_FIRED',
      data: { targetPlayerId: 'player-1', row: 0, col: 3, hit: expect.any(Boolean) },
    });
  });

  it('termina la partida, evita disparos repetidos de CPU y registra hundimientos sin doble conteo', () => {
    const { session, events } = createSession();
    session.start();
    for (let position = 0; position < 36 && session.getState().status !== 'FINISHED'; position++) {
      expect(session.applyAction({ type: 'FIRE', position }).ok).toBe(true);
    }

    const state = session.getState();
    expect(state.status).toBe('FINISHED');
    expect(state.finishReason).toBe('COMPLETED');
    expect(state.winnerPlayerId).toBeTruthy();
    expect(events.filter((event) => event.action === 'MATCH_FINISHED')).toHaveLength(1);

    const cpuShots = events.filter((event) => event.playerId === 'CPU' && event.action === 'SHOT_FIRED');
    const cpuTargets = cpuShots.map((event) => `${event.data.row},${event.data.col}`);
    expect(new Set(cpuTargets).size).toBe(cpuTargets.length);

    for (let index = 0; index < events.length; index++) {
      if (events[index].action !== 'SHIP_SUNK') continue;
      const previous = events[index - 1];
      expect(previous.action).toBe('SHOT_FIRED');
      expect(previous.data).toMatchObject({
        targetPlayerId: events[index].data.targetPlayerId,
        hit: true,
        shipId: events[index].data.shipId,
      });
    }
  });

  it('emite el abandono una sola vez', () => {
    const { session, events } = createSession();
    session.start();
    session.abandon();
    session.abandon();
    expect(session.getState()).toMatchObject({ status: 'FINISHED', finishReason: 'ABANDONED' });
    expect(events.filter((event) => event.action === 'MATCH_FINISHED')).toHaveLength(1);
  });
});
