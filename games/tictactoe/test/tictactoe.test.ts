import { describe, expect, it } from 'vitest';
import { GameEvent } from '../../shared/GameEvent';
import { Board, Mark } from '../src/Board';
import { MoveAdvisor, PrologClient, PrologDecision, PrologError } from '../src/PrologClient';
import { Rules } from '../src/Rules';
import { TicTacToeSession } from '../src/TicTacToeSession';

const decision = (position: number, symbol: Mark = 'O'): PrologDecision => ({
  position,
  ...Board.toRowCol(position),
  symbol,
  algorithm: 'minimax-alphabeta',
  kind: 'SEARCH',
  score: 0,
  durationMs: 1,
});

/** Devuelve las posiciones indicadas en orden. */
class ScriptedAdvisor implements MoveAdvisor {
  calls = 0;
  constructor(private readonly moves: number[]) {}
  async decide(_board: Board, turn: Mark) {
    return decision(this.moves[this.calls++], turn);
  }
}

/** Respuesta controlada desde la prueba, para simular una IA lenta. */
class DeferredAdvisor implements MoveAdvisor {
  resolve!: (d: PrologDecision) => void;
  decide() {
    return new Promise<PrologDecision>((r) => (this.resolve = r));
  }
}

class FailingAdvisor implements MoveAdvisor {
  async decide(): Promise<PrologDecision> {
    throw new PrologError('El servicio Prolog no respondió a tiempo', 'TIMEOUT');
  }
}

function newSession(advisor: MoveAdvisor, humanStarts = true) {
  const events: GameEvent[] = [];
  let id = 0;
  const session = new TicTacToeSession({
    humanPlayerId: 'ana',
    advisor,
    events: { publish: (e) => events.push(e) },
    humanStarts,
    newId: () => `id-${++id}`,
  });
  return { session, events };
}

const actions = (events: GameEvent[]) => events.map((e) => e.action);

describe('Rules', () => {
  it('detecta las ocho líneas ganadoras', () => {
    expect(Rules.WIN_LINES).toHaveLength(8);
    for (const line of Rules.WIN_LINES) {
      const board = new Board();
      line.forEach((p) => board.place(p, 'X'));
      expect(Rules.outcome(board)).toEqual({ kind: 'WIN', mark: 'X', line });
    }
  });

  it('detecta empate con el tablero lleno y sin línea', () => {
    const board = new Board(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']);
    expect(Rules.outcome(board)).toEqual({ kind: 'DRAW' });
  });

  it('el tablero rechaza casillas ocupadas', () => {
    const board = new Board();
    board.place(0, 'X');
    expect(() => board.place(0, 'O')).toThrow();
  });
});

describe('TicTacToeSession', () => {
  it('envía MATCH_STARTED y espera al humano cuando abre el humano', () => {
    const { session, events } = newSession(new ScriptedAdvisor([]));
    session.start();
    expect(session.getState().status).toBe('HUMAN_TURN');
    expect(events[0]).toMatchObject({
      gameId: 'TIC_TAC_TOE',
      matchId: session.matchId,
      playerId: 'SYSTEM',
      type: 'MATCH',
      action: 'MATCH_STARTED',
      data: { mode: 'VS_COMPUTER', humanPlayerId: 'ana', aiPlayerId: 'PROLOG_AI', firstPlayerId: 'ana' },
    });
  });

  it('aplica la jugada del humano y luego la de Prolog', async () => {
    const { session, events } = newSession(new ScriptedAdvisor([4]));
    session.start();
    expect(session.applyAction({ type: 'PLACE', position: 0 })).toEqual({ ok: true });
    expect(session.getState().status).toBe('AI_THINKING');
    await session.whenIdle();

    const state = session.getState();
    expect(state.status).toBe('HUMAN_TURN');
    expect(state.board[0]).toBe('X');
    expect(state.board[4]).toBe('O');
    expect(actions(events)).toEqual(['MATCH_STARTED', 'MOVE_PLAYED', 'AI_DECISION', 'MOVE_PLAYED']);
    expect(events[1]).toMatchObject({ playerId: 'ana', type: 'ACTION', data: { position: 0, row: 0, col: 0, symbol: 'X', turn: 1 } });
    expect(events[2]).toMatchObject({ playerId: 'PROLOG_AI', data: { position: 4, algorithm: 'minimax-alphabeta' } });
    expect(events[3]).toMatchObject({ playerId: 'PROLOG_AI', data: { position: 4, symbol: 'O', turn: 2 } });
  });

  it('rechaza casillas ocupadas, fuera del tablero y jugadas fuera de turno', async () => {
    const advisor = new DeferredAdvisor();
    const { session, events } = newSession(advisor);
    expect(session.applyAction({ type: 'PLACE', position: 0 }).ok).toBe(false); // sin iniciar
    session.start();
    expect(session.applyAction({ type: 'PLACE', position: 9 }).ok).toBe(false);
    expect(session.applyAction({ type: 'PLACE', position: 0 }).ok).toBe(true);
    // Mientras Prolog piensa no se puede jugar.
    expect(session.applyAction({ type: 'PLACE', position: 1 })).toEqual({ ok: false, reason: 'No es el turno del jugador' });
    advisor.resolve(decision(4));
    await session.whenIdle();
    expect(session.applyAction({ type: 'PLACE', position: 4 })).toEqual({ ok: false, reason: 'Casilla ocupada' });
    expect(actions(events).filter((a) => a === 'MOVE_PLAYED')).toHaveLength(2);
  });

  it('declara victoria del humano, cierra una sola vez y no permite jugar después', async () => {
    const { session, events } = newSession(new ScriptedAdvisor([3, 4]));
    session.start();
    session.applyAction({ type: 'PLACE', position: 0 });
    await session.whenIdle();
    session.applyAction({ type: 'PLACE', position: 1 });
    await session.whenIdle();
    session.applyAction({ type: 'PLACE', position: 2 });

    const state = session.getState();
    expect(state.status).toBe('FINISHED');
    expect(state.winnerPlayerId).toBe('ana');
    expect(state.outcome).toMatchObject({ kind: 'WIN', mark: 'X', line: [0, 1, 2] });
    expect(session.applyAction({ type: 'PLACE', position: 8 }).ok).toBe(false);
    session.abandon();
    const finished = events.filter((e) => e.action === 'MATCH_FINISHED');
    expect(finished).toHaveLength(1);
    expect(finished[0].data).toEqual({ reason: 'COMPLETED', winnerPlayerId: 'ana' });
  });

  it('declara victoria de la computadora', async () => {
    const { session, events } = newSession(new ScriptedAdvisor([4, 3, 5]));
    session.start();
    for (const p of [0, 1, 8]) {
      session.applyAction({ type: 'PLACE', position: p });
      await session.whenIdle();
    }
    expect(session.getState().winnerPlayerId).toBe('PROLOG_AI');
    expect(events.at(-1)!.data).toEqual({ reason: 'COMPLETED', winnerPlayerId: 'PROLOG_AI' });
  });

  it('declara empate', async () => {
    // X: 0 2 3 7 8   O: 1 4 5 6
    const { session, events } = newSession(new ScriptedAdvisor([1, 4, 5, 6]));
    session.start();
    for (const p of [0, 2, 3, 7]) {
      session.applyAction({ type: 'PLACE', position: p });
      await session.whenIdle();
    }
    session.applyAction({ type: 'PLACE', position: 8 });
    expect(session.getState().outcome).toEqual({ kind: 'DRAW' });
    expect(events.at(-1)!.data).toEqual({ reason: 'DRAW' });
  });

  it('la computadora abre cuando el humano no empieza', async () => {
    const { session } = newSession(new ScriptedAdvisor([4]), false);
    session.start();
    await session.whenIdle();
    const state = session.getState();
    expect(state.aiMark).toBe('X');
    expect(state.board[4]).toBe('X');
    expect(state.status).toBe('HUMAN_TURN');
  });

  it('si Prolog falla queda en AI_ERROR, no juega al azar y permite reintentar', async () => {
    const { session, events } = newSession(new FailingAdvisor());
    session.start();
    session.applyAction({ type: 'PLACE', position: 0 });
    await session.whenIdle();
    let state = session.getState();
    expect(state.status).toBe('AI_ERROR');
    expect(state.error).toMatch(/no respondió/);
    expect(state.board.filter((c) => c !== null)).toHaveLength(1);
    expect(actions(events)).not.toContain('AI_DECISION');

    expect(session.applyAction({ type: 'RETRY_AI' }).ok).toBe(true);
    await session.whenIdle();
    state = session.getState();
    expect(state.status).toBe('AI_ERROR');
  });

  it('rechaza una jugada ilegal de Prolog en lugar de sobrescribir', async () => {
    const { session } = newSession(new ScriptedAdvisor([0]));
    session.start();
    session.applyAction({ type: 'PLACE', position: 0 });
    await session.whenIdle();
    expect(session.getState().status).toBe('AI_ERROR');
    expect(session.getState().board[0]).toBe('X');
  });

  it('al abandonar envía ABANDONED e ignora la respuesta tardía de Prolog', async () => {
    const advisor = new DeferredAdvisor();
    const { session, events } = newSession(advisor);
    session.start();
    session.applyAction({ type: 'PLACE', position: 0 });
    session.abandon();
    advisor.resolve(decision(4));
    await session.whenIdle();
    expect(session.getState().status).toBe('FINISHED');
    expect(session.getState().board[4]).toBeNull();
    expect(actions(events)).toEqual(['MATCH_STARTED', 'MOVE_PLAYED', 'MATCH_FINISHED']);
    expect(events.at(-1)!.data).toEqual({ reason: 'ABANDONED' });
  });

  it('dos partidas simultáneas no comparten tablero, turno ni identificadores', async () => {
    const a = newSession(new ScriptedAdvisor([4]));
    const b = newSession(new DeferredAdvisor());
    const sessionB = new TicTacToeSession({
      humanPlayerId: 'ana',
      advisor: new DeferredAdvisor(),
      events: { publish: (e) => b.events.push(e) },
    });
    a.session.start();
    sessionB.start();
    a.session.applyAction({ type: 'PLACE', position: 0 });
    await a.session.whenIdle();
    expect(a.session.matchId).not.toBe(sessionB.matchId);
    expect(sessionB.getState().board.every((c) => c === null)).toBe(true);
    expect(sessionB.getState().status).toBe('HUMAN_TURN');
    expect(b.events.every((e) => e.matchId === sessionB.matchId)).toBe(true);
  });

  it('notifica a los suscriptores en cada cambio', async () => {
    const { session } = newSession(new ScriptedAdvisor([4]));
    const statuses: string[] = [];
    session.subscribe((s) => statuses.push(s.status));
    session.start();
    session.applyAction({ type: 'PLACE', position: 0 });
    await session.whenIdle();
    expect(statuses).toEqual(['HUMAN_TURN', 'AI_THINKING', 'HUMAN_TURN']);
  });
});

describe('PrologClient', () => {
  const reply = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('envía el tablero en el formato del contrato', async () => {
    let sent: any;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return new Response(JSON.stringify(decision(2)), { status: 200 });
    }) as unknown as typeof fetch;
    const board = new Board(['X', 'X', null, null, 'O', null, null, null, null]);
    const result = await new PrologClient('http://prolog/', 1000, fetchImpl).decide(board, 'O');
    expect(sent).toEqual({ board: ['X', 'X', '', '', 'O', '', '', '', ''], turn: 'O' });
    expect(result.position).toBe(2);
  });

  it('convierte el error 400 de Prolog en PrologError con su código', async () => {
    const client = new PrologClient('http://prolog', 1000, reply(400, { error: 'GAME_OVER', message: 'terminó' }));
    await expect(client.decide(new Board(), 'X')).rejects.toMatchObject({ code: 'GAME_OVER' });
  });

  it('reporta servicio caído', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(new PrologClient('http://prolog', 1000, down).decide(new Board(), 'X')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });

  it('respeta el tiempo de espera', async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch;
    await expect(new PrologClient('http://prolog', 20, hang).decide(new Board(), 'X')).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });
});

// Integración real: PROLOG_URL=http://localhost:8082 npm test
const prologUrl: string | undefined = (globalThis as any).process?.env?.PROLOG_URL;
describe.skipIf(!prologUrl)('integración con el servicio Prolog', () => {
  it('la computadora nunca pierde contra jugadas al azar', async () => {
    for (let game = 0; game < 20; game++) {
      const { session } = newSession(new PrologClient(prologUrl!), game % 2 === 0);
      session.start();
      await session.whenIdle();
      while (session.getState().status === 'HUMAN_TURN') {
        const empty = session.getState().board.flatMap((c, i) => (c === null ? [i] : []));
        session.applyAction({ type: 'PLACE', position: empty[Math.floor(Math.random() * empty.length)] });
        await session.whenIdle();
      }
      const state = session.getState();
      expect(state.status).toBe('FINISHED');
      expect(state.winnerPlayerId).not.toBe('ana');
    }
  });
});
