import { EventSink, FinishReason, MatchEventFactory } from '../../shared/GameEvent';
import { ActionResult, GameSession, Listeners, accepted, rejected } from '../../shared/GameSession';
import { Board, Cell, Mark } from './Board';
import { HumanPlayer, Player, PrologPlayer } from './Player';
import { MoveAdvisor, PrologDecision, PrologError } from './PrologClient';
import { Outcome, Rules } from './Rules';

export const TIC_TAC_TOE_GAME_ID = 'TIC_TAC_TOE';

export type SessionStatus = 'NOT_STARTED' | 'HUMAN_TURN' | 'AI_THINKING' | 'AI_ERROR' | 'FINISHED';

export type TicTacToeAction =
  | { type: 'PLACE'; position: number }
  | { type: 'RETRY_AI' };

export interface TicTacToeState {
  matchId: string;
  status: SessionStatus;
  board: Cell[];
  turn: Mark;
  humanMark: Mark;
  aiMark: Mark;
  moveCount: number;
  outcome: Outcome;
  finishReason: FinishReason | null;
  winnerPlayerId: string | null;
  lastAiDecision: PrologDecision | null;
  error: string | null;
}

export interface TicTacToeOptions {
  humanPlayerId: string;
  advisor: MoveAdvisor;
  events: EventSink;
  /** true: el humano abre con X. false: la computadora abre con X. */
  humanStarts?: boolean;
  matchId?: string;
  newId?: () => string;
  now?: () => Date;
}

/**
 * Una partida de gato humano contra computadora.
 * Cada instancia tiene su propio tablero, turno y matchId, así que varias partidas
 * pueden convivir en la misma consola o en pestañas distintas sin mezclarse.
 */
export class TicTacToeSession implements GameSession<TicTacToeState, TicTacToeAction> {
  readonly gameId = TIC_TAC_TOE_GAME_ID;
  readonly matchId: string;

  private readonly board = new Board();
  private readonly human: HumanPlayer;
  private readonly ai: PrologPlayer;
  private readonly first: Player;
  private readonly events: EventSink;
  private readonly factory: MatchEventFactory;
  private readonly listeners = new Listeners<TicTacToeState>();
  private readonly now: () => Date;

  private status: SessionStatus = 'NOT_STARTED';
  private turn: Mark = 'X';
  private moveCount = 0;
  private outcome: Outcome = { kind: 'IN_PROGRESS' };
  private finishReason: FinishReason | null = null;
  private winnerPlayerId: string | null = null;
  private lastAiDecision: PrologDecision | null = null;
  private error: string | null = null;
  private aiRequest = 0;
  private pending: Promise<void> = Promise.resolve();

  constructor(options: TicTacToeOptions) {
    const newId = options.newId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
    this.matchId = options.matchId ?? newId();
    const humanStarts = options.humanStarts ?? true;
    this.human = new HumanPlayer(options.humanPlayerId, humanStarts ? 'X' : 'O');
    this.ai = new PrologPlayer(humanStarts ? 'O' : 'X', options.advisor);
    this.first = humanStarts ? this.human : this.ai;
    this.events = options.events;
    this.factory = new MatchEventFactory(this.gameId, this.matchId, newId, this.now);
  }

  start(): void {
    if (this.status !== 'NOT_STARTED') return;
    this.events.publish(
      this.factory.matchStarted({
        mode: 'VS_COMPUTER',
        humanPlayerId: this.human.id,
        aiPlayerId: this.ai.id,
        firstPlayerId: this.first.id,
      }),
    );
    if (this.first === this.ai) {
      this.runAiTurn();
    } else {
      this.status = 'HUMAN_TURN';
      this.emit();
    }
  }

  applyAction(action: TicTacToeAction): ActionResult {
    switch (action.type) {
      case 'PLACE':
        return this.placeHuman(action.position);
      case 'RETRY_AI':
        if (this.status !== 'AI_ERROR') return rejected('No hay una jugada de la computadora pendiente');
        this.runAiTurn();
        return accepted;
      default:
        return rejected('Acción desconocida');
    }
  }

  getState(): TicTacToeState {
    return {
      matchId: this.matchId,
      status: this.status,
      board: this.board.toArray(),
      turn: this.turn,
      humanMark: this.human.mark,
      aiMark: this.ai.mark,
      moveCount: this.moveCount,
      outcome: this.outcome,
      finishReason: this.finishReason,
      winnerPlayerId: this.winnerPlayerId,
      lastAiDecision: this.lastAiDecision,
      error: this.error,
    };
  }

  abandon(): void {
    if (this.status === 'FINISHED') return;
    const wasStarted = this.status !== 'NOT_STARTED';
    this.aiRequest++; // descarta una respuesta de Prolog que llegue después
    if (wasStarted) {
      this.finish('ABANDONED', null);
    } else {
      this.status = 'FINISHED';
      this.finishReason = 'ABANDONED';
      this.emit();
    }
  }

  subscribe(listener: (state: TicTacToeState) => void): () => void {
    return this.listeners.add(listener);
  }

  /** Se resuelve cuando termina la jugada de la computadora en curso (útil en pruebas y vistas). */
  whenIdle(): Promise<void> {
    return this.pending;
  }

  private placeHuman(position: number): ActionResult {
    if (this.status === 'NOT_STARTED') return rejected('La partida no ha iniciado');
    if (this.status === 'FINISHED') return rejected('La partida ya terminó');
    if (this.status !== 'HUMAN_TURN') return rejected('No es el turno del jugador');
    if (!Board.isValidPosition(position)) return rejected('Posición fuera del tablero');
    if (!this.board.isEmpty(position)) return rejected('Casilla ocupada');

    this.play(this.human, position);
    if (!this.checkEnd()) this.runAiTurn();
    return accepted;
  }

  private runAiTurn(): void {
    const request = ++this.aiRequest;
    this.status = 'AI_THINKING';
    this.error = null;
    this.emit();

    const startedAt = this.now().getTime();
    this.pending = this.ai
      .chooseMove(new Board(this.board.toArray()))
      .then((decision) => {
        if (request !== this.aiRequest || this.status !== 'AI_THINKING') return; // partida abandonada
        if (!this.board.isEmpty(decision.position)) {
          throw new PrologError('Prolog devolvió una casilla ocupada', 'ILLEGAL_MOVE');
        }
        this.lastAiDecision = decision;
        const { row, col } = Board.toRowCol(decision.position);
        this.events.publish(
          this.factory.action(this.ai.id, 'AI_DECISION', {
            position: decision.position,
            row,
            col,
            algorithm: decision.algorithm,
            kind: decision.kind,
            score: decision.score,
            durationMs: decision.durationMs,
            latencyMs: Math.max(0, this.now().getTime() - startedAt),
          }),
        );
        this.play(this.ai, decision.position);
        if (!this.checkEnd()) {
          this.status = 'HUMAN_TURN';
          this.emit();
        }
      })
      .catch((err: unknown) => {
        if (request !== this.aiRequest) return;
        this.status = 'AI_ERROR';
        this.error = err instanceof Error ? err.message : 'Error desconocido de la IA';
        this.emit();
      });
  }

  private play(player: Player, position: number): void {
    this.board.place(position, player.mark);
    this.moveCount++;
    const { row, col } = Board.toRowCol(position);
    this.events.publish(
      this.factory.action(player.id, 'MOVE_PLAYED', {
        position,
        row,
        col,
        symbol: player.mark,
        turn: this.moveCount,
      }),
    );
    this.turn = Rules.other(player.mark);
  }

  /** Revisa victoria o empate; si la partida terminó, envía el cierre una sola vez. */
  private checkEnd(): boolean {
    this.outcome = Rules.outcome(this.board);
    if (this.outcome.kind === 'WIN') {
      const winner = this.outcome.mark === this.human.mark ? this.human : this.ai;
      this.finish('COMPLETED', winner.id);
      return true;
    }
    if (this.outcome.kind === 'DRAW') {
      this.finish('DRAW', null);
      return true;
    }
    return false;
  }

  private finish(reason: FinishReason, winnerPlayerId: string | null): void {
    this.status = 'FINISHED';
    this.finishReason = reason;
    this.winnerPlayerId = winnerPlayerId;
    this.events.publish(this.factory.matchFinished(reason, winnerPlayerId ?? undefined));
    this.emit();
  }

  private emit(): void {
    this.listeners.notify(this.getState());
  }
}
