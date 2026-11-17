import { Board, Mark } from './Board';

export type Outcome =
  | { kind: 'IN_PROGRESS' }
  | { kind: 'WIN'; mark: Mark; line: readonly number[] }
  | { kind: 'DRAW' };

/** Reglas del gato: las ocho líneas ganadoras y el empate. */
export class Rules {
  static readonly WIN_LINES: readonly (readonly number[])[] = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // filas
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // columnas
    [0, 4, 8], [2, 4, 6],            // diagonales
  ];

  static outcome(board: Board): Outcome {
    for (const line of Rules.WIN_LINES) {
      const [a, b, c] = line;
      const mark = board.get(a);
      if (mark !== null && mark === board.get(b) && mark === board.get(c)) {
        return { kind: 'WIN', mark, line };
      }
    }
    return board.isFull() ? { kind: 'DRAW' } : { kind: 'IN_PROGRESS' };
  }

  static other(mark: Mark): Mark {
    return mark === 'X' ? 'O' : 'X';
  }
}
