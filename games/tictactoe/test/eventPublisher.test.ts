import { describe, expect, it } from 'vitest';
import { EventPublisher } from '../../shared/EventPublisher';
import { GameEvent } from '../../shared/GameEvent';

function event(matchId: string, eventId: string): GameEvent {
  return {
    eventId,
    timestamp: '2026-11-19T10:00:00.000Z',
    gameId: 'TIC_TAC_TOE',
    matchId,
    playerId: 'player',
    type: 'ACTION',
    action: 'MOVE_PLAYED',
    data: { position: 4, nested: { b: true, a: 1 } },
  };
}

function accepted(): Response {
  return new Response(null, { status: 202 });
}

describe('EventPublisher', () => {
  it('conserva el orden por partida y procesa partidas diferentes en paralelo', async () => {
    const calls: string[] = [];
    let releaseFirst!: () => void;
    const firstRequest = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const publisher = new EventPublisher({
      baseUrl: 'http://go.local',
      fetchImpl: async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as GameEvent;
        calls.push(request.eventId);
        if (request.eventId === 'a1') await firstRequest;
        return accepted();
      },
    });

    publisher.publish(event('a', 'a1'));
    publisher.publish(event('a', 'a2'));
    publisher.publish(event('b', 'b1'));
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toContain('a1');
    expect(calls).toContain('b1');
    expect(calls).not.toContain('a2');

    releaseFirst();
    await Promise.all([publisher.whenIdle('a'), publisher.whenIdle('b')]);
    expect(calls).toEqual(['a1', 'b1', 'a2']);
  });

  it('reintenta la misma identificación del evento tras un fallo de red', async () => {
    const eventIds: string[] = [];
    let attempts = 0;
    const publisher = new EventPublisher({
      baseUrl: 'http://go.local',
      maxAttempts: 2,
      retryBaseMs: 0,
      fetchImpl: async (_url, init) => {
        eventIds.push((JSON.parse(String(init?.body)) as GameEvent).eventId);
        attempts++;
        if (attempts === 1) throw new TypeError('offline');
        return accepted();
      },
    });

    publisher.publish(event('a', 'stable-id'));
    await publisher.whenIdle('a');

    expect(eventIds).toEqual(['stable-id', 'stable-id']);
    expect(publisher.getState('a')).toEqual({ matchId: 'a', pending: 0, failure: null });
  });

  it('reconcilia un 409 solo cuando el servidor confirma el mismo evento', async () => {
    const expected = event('a', 'same-event');
    const publisher = new EventPublisher({
      baseUrl: 'http://go.local',
      fetchImpl: async (url, init) => {
        if (init?.method === 'POST') return new Response(null, { status: 409 });
        expect(url).toBe('http://go.local/matches/a/events/same-event');
        return Response.json({ ...expected, timestamp: '2026-11-19T10:00:00Z', data: { nested: { a: 1, b: true }, position: 4 } });
      },
    });

    publisher.publish(expected);
    await publisher.whenIdle('a');

    expect(publisher.getState('a')).toEqual({ matchId: 'a', pending: 0, failure: null });
  });

  it('expone el error terminal y permite reintentar la cola', async () => {
    let reject = true;
    const publisher = new EventPublisher({
      baseUrl: 'http://go.local',
      maxAttempts: 1,
      fetchImpl: async () => (reject ? new Response('invalid event', { status: 400 }) : accepted()),
    });
    const states: Array<{ pending: number; hasError: boolean }> = [];
    publisher.subscribe((state) => states.push({ pending: state.pending, hasError: state.failure !== null }));

    publisher.publish(event('a', 'event'));
    await publisher.whenIdle('a');
    expect(publisher.getState('a').failure?.message).toContain('400');
    expect(states.some((state) => state.pending === 1 && state.hasError)).toBe(true);

    reject = false;
    publisher.retry('a');
    await publisher.whenIdle('a');
    expect(publisher.getState('a')).toEqual({ matchId: 'a', pending: 0, failure: null });
  });
});
