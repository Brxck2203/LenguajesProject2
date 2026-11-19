/** Sobre de 8 campos que acepta GameStats (ver docs/contratos.md). */
export interface GameEvent {
  eventId: string;
  timestamp: string;
  gameId: string;
  matchId: string;
  playerId: string;
  type: 'MATCH' | 'ACTION';
  action: string;
  data: Record<string, unknown>;
}

/** Destino de los eventos. Lo implementa el EventPublisher de la consola. */
export interface EventSink {
  publish(event: GameEvent): void;
}

export const SYSTEM_PLAYER_ID = 'SYSTEM';

export type FinishReason = 'COMPLETED' | 'DRAW' | 'ABANDONED';

/** Fábrica de eventos de una partida: fija gameId y matchId, genera eventId y timestamp. */
export class MatchEventFactory {
  constructor(
    private readonly gameId: string,
    private readonly matchId: string,
    private readonly newId: () => string = () => crypto.randomUUID(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  matchStarted(data: Record<string, unknown> = {}): GameEvent {
    return this.build(SYSTEM_PLAYER_ID, 'MATCH', 'MATCH_STARTED', data);
  }

  matchFinished(reason: FinishReason, winnerPlayerId?: string): GameEvent {
    const data: Record<string, unknown> = { reason };
    if (winnerPlayerId) data.winnerPlayerId = winnerPlayerId;
    return this.build(SYSTEM_PLAYER_ID, 'MATCH', 'MATCH_FINISHED', data);
  }

  action(playerId: string, action: string, data: Record<string, unknown>): GameEvent {
    return this.build(playerId, 'ACTION', action, data);
  }

  private build(playerId: string, type: GameEvent['type'], action: string, data: Record<string, unknown>): GameEvent {
    return {
      eventId: this.newId(),
      timestamp: this.now().toISOString(),
      gameId: this.gameId,
      matchId: this.matchId,
      playerId,
      type,
      action,
      data,
    };
  }
}
