import { Board, Mark } from './Board';
import { MoveAdvisor, PrologDecision } from './PrologClient';

/** Participante de la partida: tiene id para los eventos y una marca en el tablero. */
export abstract class Player {
  constructor(readonly id: string, readonly mark: Mark) {}
  abstract readonly isComputer: boolean;
}

/** Jugador humano: sus jugadas llegan desde la vista mediante applyAction(). */
export class HumanPlayer extends Player {
  readonly isComputer = false;
}

export const PROLOG_AI_PLAYER_ID = 'PROLOG_AI';

/** Computadora: delega la decisión en el servicio Prolog. No hay jugada de respaldo aleatoria. */
export class PrologPlayer extends Player {
  readonly isComputer = true;

  constructor(mark: Mark, private readonly advisor: MoveAdvisor, id = PROLOG_AI_PLAYER_ID) {
    super(id, mark);
  }

  chooseMove(board: Board): Promise<PrologDecision> {
    return this.advisor.decide(board, this.mark);
  }
}
