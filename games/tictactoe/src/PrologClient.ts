import { Board, Mark } from './Board';

/** Respuesta de POST /move del servicio Prolog (prolog_service/README.md). */
export interface PrologDecision {
  position: number;
  row: number;
  col: number;
  symbol: Mark;
  algorithm: string;
  kind: 'WIN' | 'BLOCK' | 'SEARCH';
  score: number;
  durationMs: number;
}

export class PrologError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'PrologError';
  }
}

/** Abstracción para poder sustituir el servicio en las pruebas. */
export interface MoveAdvisor {
  decide(board: Board, turn: Mark): Promise<PrologDecision>;
}

/** Cliente HTTP del servicio Prolog, con tiempo de espera. */
export class PrologClient implements MoveAdvisor {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 5000,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  async decide(board: Board, turn: Mark): Promise<PrologDecision> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: board.toArray().map((c) => c ?? ''), turn }),
        signal: controller.signal,
      });
    } catch (err) {
      const timedOut = controller.signal.aborted;
      throw new PrologError(
        timedOut ? 'El servicio Prolog no respondió a tiempo' : 'No se pudo contactar al servicio Prolog',
        timedOut ? 'TIMEOUT' : 'UNAVAILABLE',
      );
    } finally {
      clearTimeout(timer);
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new PrologError(body?.message ?? `Prolog respondió ${response.status}`, body?.error ?? 'HTTP_ERROR');
    }
    if (!body || !Board.isValidPosition(body.position)) {
      throw new PrologError('Respuesta de Prolog sin una posición válida', 'BAD_RESPONSE');
    }
    return body as PrologDecision;
  }
}
