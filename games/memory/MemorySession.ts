import { EventSink, FinishReason, MatchEventFactory } from '../shared/GameEvent';
import { ActionResult, accepted, GameSession, Listeners, rejected } from '../shared/GameSession';

export const MEMORY_GAME_ID = 'MEMORY';
export const MEMORY_PAIRS = 6;

export type MemoryStatus = 'NOT_STARTED' | 'WAITING_FOR_FIRST' | 'WAITING_FOR_SECOND' | 'RESOLVING' | 'FINISHED';

export interface MemoryCardState {
  index: number;
  symbol: string;
  faceUp: boolean;
  matched: boolean;
}

export interface MemoryState {
  matchId: string;
  status: MemoryStatus;
  cards: MemoryCardState[];
  firstCard: number | null;
  secondCard: number | null;
  attempts: number;
  pairsFound: number;
  finishReason: FinishReason | null;
}

export type MemoryAction = { type: 'FLIP'; cardIndex: number };

export interface MemoryOptions {
  playerId: string;
  events: EventSink;
  matchId?: string;
  newId?: () => string;
  now?: () => Date;
  random?: () => number;
  mismatchDelayMs?: number;
}

const SYMBOLS = ['🍎', '🚀', '🌙', '🎲', '🎧', '🌻'];

export class MemorySession implements GameSession<MemoryState, MemoryAction> {
  readonly gameId = MEMORY_GAME_ID;
  readonly matchId: string;

  private readonly playerId: string;
  private readonly cards: MemoryCardState[];
  private readonly events: EventSink;
  private readonly factory: MatchEventFactory;
  private readonly listeners = new Listeners<MemoryState>();
  private readonly mismatchDelayMs: number;
  private status: MemoryStatus = 'NOT_STARTED';
  private firstCard: number | null = null;
  private secondCard: number | null = null;
  private attempts = 0;
  private pairsFound = 0;
  private finishReason: FinishReason | null = null;
  private mismatchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: MemoryOptions) {
    const newId = options.newId ?? (() => crypto.randomUUID());
    this.matchId = options.matchId ?? newId();
    this.playerId = options.playerId;
    this.events = options.events;
    this.factory = new MatchEventFactory(this.gameId, this.matchId, newId, options.now);
    this.mismatchDelayMs = options.mismatchDelayMs ?? 800;
    if (!this.playerId || this.mismatchDelayMs < 0) throw new Error('Configuración inválida para Memoria');
    const deck = SYMBOLS.flatMap((symbol) => [symbol, symbol]);
    this.cards = shuffle(deck, options.random ?? Math.random).map((symbol, index) => ({
      index,
      symbol,
      faceUp: false,
      matched: false,
    }));
  }

  start(): void {
    if (this.status !== 'NOT_STARTED') return;
    this.events.publish(this.factory.matchStarted({ mode: 'SOLO', pairs: MEMORY_PAIRS }));
    this.status = 'WAITING_FOR_FIRST';
    this.emit();
  }

  applyAction(action: MemoryAction): ActionResult {
    if (this.status === 'NOT_STARTED') return rejected('La partida no ha iniciado');
    if (this.status === 'FINISHED') return rejected('La partida ya terminó');
    if (this.status === 'RESOLVING') return rejected('Espera a que se oculten las cartas');
    if (action.type !== 'FLIP') return rejected('Acción desconocida');
    if (!Number.isInteger(action.cardIndex) || action.cardIndex < 0 || action.cardIndex >= this.cards.length) {
      return rejected('Carta fuera del tablero');
    }
    const first = this.firstCard;
    if (this.status === 'WAITING_FOR_SECOND' && first === null) {
      return rejected('No hay una primera carta seleccionada');
    }

    const card = this.cards[action.cardIndex];
    if (card.faceUp || card.matched) return rejected('La carta ya está visible o emparejada');

    card.faceUp = true;
    this.events.publish(this.factory.action(this.playerId, 'CARD_FLIPPED', {
      cardIndex: card.index,
      symbol: card.symbol,
    }));

    if (first === null) {
      this.firstCard = card.index;
      this.status = 'WAITING_FOR_SECOND';
      this.emit();
      return accepted;
    }

    this.secondCard = card.index;
    this.attempts++;
    const matched = this.cards[first].symbol === card.symbol;
    this.events.publish(this.factory.action(this.playerId, 'PAIR_ATTEMPTED', {
      firstCard: first,
      secondCard: card.index,
      matched,
      attempt: this.attempts,
    }));

    if (matched) {
      this.cards[first].matched = true;
      card.matched = true;
      this.pairsFound++;
      this.firstCard = null;
      this.secondCard = null;
      this.status = 'WAITING_FOR_FIRST';
      if (this.pairsFound === MEMORY_PAIRS) {
        this.finish('COMPLETED');
      } else {
        this.emit();
      }
      return accepted;
    }

    this.status = 'RESOLVING';
    this.emit();
    this.mismatchTimer = setTimeout(() => {
      this.cards[first].faceUp = false;
      card.faceUp = false;
      this.firstCard = null;
      this.secondCard = null;
      this.mismatchTimer = null;
      if (this.status === 'RESOLVING') {
        this.status = 'WAITING_FOR_FIRST';
        this.emit();
      }
    }, this.mismatchDelayMs);
    return accepted;
  }

  getState(): MemoryState {
    return {
      matchId: this.matchId,
      status: this.status,
      cards: this.cards.map((card) => ({ ...card })),
      firstCard: this.firstCard,
      secondCard: this.secondCard,
      attempts: this.attempts,
      pairsFound: this.pairsFound,
      finishReason: this.finishReason,
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
    this.finish('ABANDONED');
  }

  subscribe(listener: (state: MemoryState) => void): () => void {
    return this.listeners.add(listener);
  }

  private finish(reason: FinishReason): void {
    if (this.mismatchTimer !== null) {
      clearTimeout(this.mismatchTimer);
      this.mismatchTimer = null;
    }
    this.status = 'FINISHED';
    this.finishReason = reason;
    this.events.publish(this.factory.matchFinished(reason, reason === 'COMPLETED' ? this.playerId : undefined));
    this.emit();
  }

  private emit(): void {
    this.listeners.notify(this.getState());
  }
}

function shuffle(values: string[], random: () => number): string[] {
  for (let index = values.length - 1; index > 0; index--) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new Error('La función aleatoria debe devolver un número entre 0 y 1');
    }
    const other = Math.floor(sample * (index + 1));
    [values[index], values[other]] = [values[other], values[index]];
  }
  return values;
}
