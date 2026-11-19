export type Mark = 'X' | 'O';
export type Cell = Mark | null;

export const BOARD_SIZE = 3;
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

/** Tablero 3×3. Posiciones de 0 a 8 por filas. Encapsula las casillas: solo se modifica con place(). */
export class Board {
  private readonly cells: Cell[];

  constructor(cells?: readonly Cell[]) {
    if (cells && cells.length !== CELL_COUNT) {
      throw new RangeError(`El tablero debe tener ${CELL_COUNT} casillas`);
    }
    this.cells = cells ? [...cells] : Array<Cell>(CELL_COUNT).fill(null);
  }

  static isValidPosition(position: number): boolean {
    return Number.isInteger(position) && position >= 0 && position < CELL_COUNT;
  }

  static toPosition(row: number, col: number): number {
    return row * BOARD_SIZE + col;
  }

  static toRowCol(position: number): { row: number; col: number } {
    return { row: Math.floor(position / BOARD_SIZE), col: position % BOARD_SIZE };
  }

  get(position: number): Cell {
    if (!Board.isValidPosition(position)) throw new RangeError(`Posición inválida: ${position}`);
    return this.cells[position];
  }

  isEmpty(position: number): boolean {
    return Board.isValidPosition(position) && this.cells[position] === null;
  }

  /** Coloca la marca; lanza si la casilla no existe o está ocupada. */
  place(position: number, mark: Mark): void {
    if (!this.isEmpty(position)) throw new Error(`Casilla ocupada o inválida: ${position}`);
    this.cells[position] = mark;
  }

  emptyPositions(): number[] {
    return this.cells.flatMap((cell, i) => (cell === null ? [i] : []));
  }

  isFull(): boolean {
    return this.cells.every((cell) => cell !== null);
  }

  count(mark: Mark): number {
    return this.cells.filter((cell) => cell === mark).length;
  }

  toArray(): Cell[] {
    return [...this.cells];
  }
}
