import { EventSink, FinishReason, MatchEventFactory } from '../shared/GameEvent';
import { ActionResult, accepted, GameSession, Listeners, rejected } from '../shared/GameSession';

export const BATTLESHIP_GAME_ID = 'BATTLESHIP';
export const BOARD_SIZE = 6;
const FLEET_SIZES = [3, 2, 2];

export type BattleshipStatus = 'NOT_STARTED' | 'HUMAN_TURN' | 'CPU_THINKING' | 'FINISHED';

export interface BattleshipCellState {
  row: number;
  col: number;
  fired: boolean;
  hit: boolean;
  ship: boolean;
}

export interface BattleshipShipState {
  shipId: string;
  size: number;
  cells: number[];
  sunk: boolean;
}

export interface BattleshipShotState {
  shooterPlayerId: string;
  targetPlayerId: string;
  row: number;
  col: number;
  hit: boolean;
  shipId: string | null;
}

export interface BattleshipState {
  matchId: string;
  status: BattleshipStatus;
  humanBoard: BattleshipCellState[];
  opponentBoard: BattleshipCellState[];
  ownShips: BattleshipShipState[];
  humanShotsFired: number;
  cpuShotsFired: number;
  opponentShipsRemaining: number;
  winnerPlayerId: string | null;
  finishReason: FinishReason | null;
  lastShot: BattleshipShotState | null;
}

export type BattleshipAction = { type: 'FIRE'; position: number };

export interface BattleshipOptions {
  playerId: string;
  events: EventSink;
  matchId?: string;
  newId?: () => string;
  now?: () => Date;
  random?: () => number;
}

interface Ship {
  shipId: string;
  size: number;
  cells: number[];
  hits: Set<number>;
}

interface Board {
  ships: Ship[];
  shots: Set<number>;
}

export class BattleshipSession implements GameSession<BattleshipState, BattleshipAction> {
  readonly gameId = BATTLESHIP_GAME_ID;
  readonly matchId: string;

  private readonly playerId: string;
  private readonly cpuPlayerId = 'CPU';
  private readonly humanBoard: Board;
  private readonly cpuBoard: Board;
  private readonly random: () => number;
  private readonly events: EventSink;
  private readonly factory: MatchEventFactory;
  private readonly listeners = new Listeners<BattleshipState>();
  private status: BattleshipStatus = 'NOT_STARTED';
  private winnerPlayerId: string | null = null;
  private finishReason: FinishReason | null = null;
  private lastShot: BattleshipShotState | null = null;

  constructor(options: BattleshipOptions) {
    const newId = options.newId ?? (() => crypto.randomUUID());
    this.matchId = options.matchId ?? newId();
    this.playerId = options.playerId;
    this.events = options.events;
    this.random = options.random ?? Math.random;
    this.factory = new MatchEventFactory(this.gameId, this.matchId, newId, options.now);
    if (!this.playerId || this.playerId === this.cpuPlayerId) {
      throw new Error('El id del jugador debe ser válido y distinto de CPU');
    }
    this.humanBoard = createBoard(this.playerId, this.random);
    this.cpuBoard = createBoard(this.cpuPlayerId, this.random);
  }

  start(): void {
    if (this.status !== 'NOT_STARTED') return;
    this.events.publish(this.factory.matchStarted({ mode: 'VS_COMPUTER', boardSize: BOARD_SIZE }));
    this.status = 'HUMAN_TURN';
    this.emit();
  }

  applyAction(action: BattleshipAction): ActionResult {
    if (this.status === 'NOT_STARTED') return rejected('La partida no ha iniciado');
    if (this.status === 'FINISHED') return rejected('La partida ya terminó');
    if (this.status !== 'HUMAN_TURN') return rejected('No es el turno del jugador');
    if (action.type !== 'FIRE') return rejected('Acción desconocida');
    if (!Number.isInteger(action.position) || action.position < 0 || action.position >= BOARD_SIZE * BOARD_SIZE) {
      return rejected('Posición fuera del tablero');
    }
    if (this.cpuBoard.shots.has(action.position)) return rejected('Ya disparaste a esa posición');

    this.fire(this.playerId, this.cpuPlayerId, this.cpuBoard, action.position);
    if (this.allShipsSunk(this.cpuBoard)) {
      this.finish('COMPLETED', this.playerId);
      return accepted;
    }

    this.status = 'CPU_THINKING';
    this.emit();
    const cpuPosition = chooseUnshotPosition(this.humanBoard.shots, this.random);
    this.fire(this.cpuPlayerId, this.playerId, this.humanBoard, cpuPosition);
    if (this.allShipsSunk(this.humanBoard)) {
      this.finish('COMPLETED', this.cpuPlayerId);
      return accepted;
    }
    this.status = 'HUMAN_TURN';
    this.emit();
    return accepted;
  }

  getState(): BattleshipState {
    return {
      matchId: this.matchId,
      status: this.status,
      humanBoard: cellsFor(this.humanBoard, true),
      opponentBoard: cellsFor(this.cpuBoard, false),
      ownShips: this.humanBoard.ships.map(toShipState),
      humanShotsFired: this.cpuBoard.shots.size,
      cpuShotsFired: this.humanBoard.shots.size,
      opponentShipsRemaining: this.cpuBoard.ships.filter((ship) => ship.hits.size < ship.size).length,
      winnerPlayerId: this.winnerPlayerId,
      finishReason: this.finishReason,
      lastShot: this.lastShot ? { ...this.lastShot } : null,
    };
  }

  abandon(): void {
    if (this.status === 'FINISHED') return;
    if (this.status === 'NOT_STARTED') {
      this.status = 'FINISHED';
      this.finishReason = 'ABANDONED';
      this.emit();
      return;
    }
    this.finish('ABANDONED', null);
  }

  subscribe(listener: (state: BattleshipState) => void): () => void {
    return this.listeners.add(listener);
  }

  private fire(shooter: string, target: string, board: Board, position: number): void {
    board.shots.add(position);
    const ship = board.ships.find((item) => item.cells.includes(position));
    const hit = ship !== undefined;
    if (ship) ship.hits.add(position);

    const { row, col } = toRowCol(position);
    const shot: BattleshipShotState = {
      shooterPlayerId: shooter,
      targetPlayerId: target,
      row,
      col,
      hit,
      shipId: ship?.shipId ?? null,
    };
    this.lastShot = shot;
    const data: Record<string, unknown> = { targetPlayerId: target, row, col, hit };
    if (ship) data.shipId = ship.shipId;
    this.events.publish(this.factory.action(shooter, 'SHOT_FIRED', data));

    if (ship && ship.hits.size === ship.size) {
      this.events.publish(
        this.factory.action(shooter, 'SHIP_SUNK', {
          targetPlayerId: target,
          shipId: ship.shipId,
          shipSize: ship.size,
        }),
      );
    }
  }

  private allShipsSunk(board: Board): boolean {
    return board.ships.every((ship) => ship.hits.size === ship.size);
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

function createBoard(playerId: string, random: () => number): Board {
  const ships: Ship[] = [];
  const occupied = new Set<number>();
  FLEET_SIZES.forEach((size, index) => {
    const placements = allPlacements(size).filter((cells) => cells.every((cell) => !occupied.has(cell)));
    if (placements.length === 0) throw new Error('No se pudo colocar la flota en el tablero');
    const cells = placements[randomIndex(placements.length, random)];
    for (const cell of cells) occupied.add(cell);
    ships.push({ shipId: `${playerId}-ship-${index + 1}`, size, cells, hits: new Set<number>() });
  });
  return { ships, shots: new Set<number>() };
}

function allPlacements(size: number): number[][] {
  const placements: number[][] = [];
  for (const horizontal of [true, false]) {
    const rowLimit = horizontal ? BOARD_SIZE : BOARD_SIZE - size + 1;
    const colLimit = horizontal ? BOARD_SIZE - size + 1 : BOARD_SIZE;
    for (let row = 0; row < rowLimit; row++) {
      for (let col = 0; col < colLimit; col++) {
        placements.push(
          Array.from({ length: size }, (_, offset) =>
            horizontal ? row * BOARD_SIZE + col + offset : (row + offset) * BOARD_SIZE + col,
          ),
        );
      }
    }
  }
  return placements;
}

function randomIndex(length: number, random: () => number): number {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new Error('La función aleatoria debe devolver un número entre 0 y 1');
  }
  return Math.floor(sample * length);
}

function chooseUnshotPosition(shots: Set<number>, random: () => number): number {
  const available = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => index).filter(
    (index) => !shots.has(index),
  );
  if (available.length === 0) throw new Error('No quedan posiciones disponibles para disparar');
  return available[randomIndex(available.length, random)];
}

function cellsFor(board: Board, revealShips: boolean): BattleshipCellState[] {
  return Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, position) => {
    const ship = board.ships.find((item) => item.cells.includes(position));
    const { row, col } = toRowCol(position);
    return {
      row,
      col,
      fired: board.shots.has(position),
      hit: ship?.hits.has(position) ?? false,
      ship: revealShips && ship !== undefined,
    };
  });
}

function toShipState(ship: Ship): BattleshipShipState {
  return {
    shipId: ship.shipId,
    size: ship.size,
    cells: [...ship.cells],
    sunk: ship.hits.size === ship.size,
  };
}

function toRowCol(position: number): { row: number; col: number } {
  return { row: Math.floor(position / BOARD_SIZE), col: position % BOARD_SIZE };
}
