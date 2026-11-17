/** Resultado de aplicar una acción: las acciones inválidas se rechazan sin lanzar excepciones. */
export type ActionResult = { ok: true } | { ok: false; reason: string };

export const accepted: ActionResult = { ok: true };
export const rejected = (reason: string): ActionResult => ({ ok: false, reason });

/**
 * Contrato común de los tres juegos (docs/contratos.md, sección 3).
 * Cada instancia es una partida independiente con su propio matchId.
 */
export interface GameSession<State, Action> {
  readonly gameId: string;
  readonly matchId: string;
  start(): void;
  applyAction(action: Action): ActionResult;
  getState(): State;
  abandon(): void;
  subscribe(listener: (state: State) => void): () => void;
}

/** Gestión de suscriptores reutilizable por las sesiones. */
export class Listeners<State> {
  private readonly listeners = new Set<(state: State) => void>();

  add(listener: (state: State) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(state: State): void {
    for (const listener of this.listeners) listener(state);
  }
}
