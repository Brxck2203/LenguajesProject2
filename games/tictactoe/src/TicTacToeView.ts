import { Board } from './Board';
import { TicTacToeSession, TicTacToeState } from './TicTacToeSession';

export interface TicTacToeViewOptions {
  /** Si se indica, se muestra el botón "Nueva partida". La consola crea otra sesión y otra vista. */
  onNewGame?: () => void;
}

const STYLE_ID = 'ttt-styles';

/** Estilos acotados a `.ttt`. Los colores salen de variables CSS para que la consola pueda cambiar el tema. */
const CSS = `
.ttt { --ttt-fg: var(--console-fg, #1f2328); --ttt-muted: var(--console-muted, #59636e);
  --ttt-bg: var(--console-surface, #ffffff); --ttt-cell: var(--console-surface-2, #f3f4f6);
  --ttt-accent: var(--console-accent, #2563eb); --ttt-win: var(--console-success, #16a34a);
  --ttt-error: var(--console-danger, #dc2626); --ttt-border: var(--console-border, #d0d7de);
  font-family: system-ui, sans-serif; color: var(--ttt-fg); background: var(--ttt-bg);
  border: 1px solid var(--ttt-border); border-radius: 12px; padding: 16px; max-width: 340px; }
.ttt__head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 12px; }
.ttt__title { font-size: 1.05rem; font-weight: 600; margin: 0; }
.ttt__match { font: 12px ui-monospace, monospace; color: var(--ttt-muted); }
.ttt__grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.ttt__cell { aspect-ratio: 1; font-size: 2.2rem; font-weight: 700; border: 1px solid var(--ttt-border);
  border-radius: 8px; background: var(--ttt-cell); color: var(--ttt-fg); cursor: pointer; }
.ttt__cell:disabled { cursor: default; }
.ttt__cell:not(:disabled):hover { outline: 2px solid var(--ttt-accent); }
.ttt__cell--o { color: var(--ttt-accent); }
.ttt__cell--win { background: var(--ttt-win); color: #fff; }
.ttt__status { min-height: 1.4em; margin: 12px 0 4px; font-weight: 600; }
.ttt__status--error { color: var(--ttt-error); }
.ttt__ai { min-height: 1.2em; font-size: 0.85rem; color: var(--ttt-muted); }
.ttt__actions { display: flex; gap: 8px; margin-top: 12px; }
.ttt__btn { padding: 6px 12px; border-radius: 6px; border: 1px solid var(--ttt-border);
  background: var(--ttt-cell); color: var(--ttt-fg); cursor: pointer; }
.ttt__btn--primary { background: var(--ttt-accent); border-color: var(--ttt-accent); color: #fff; }
`;

const KIND_TEXT: Record<string, string> = {
  WIN: 'para ganar',
  BLOCK: 'para bloquear',
  SEARCH: 'por búsqueda minimax',
};

/**
 * Vista de una partida de gato. No contiene reglas: dibuja el estado de la sesión
 * y le envía las acciones del jugador. Cada instancia se monta en su propio contenedor,
 * así que varias partidas pueden mostrarse a la vez.
 */
export class TicTacToeView {
  private root: HTMLElement | null = null;
  private cells: HTMLButtonElement[] = [];
  private status!: HTMLElement;
  private ai!: HTMLElement;
  private retry!: HTMLButtonElement;
  private abandon!: HTMLButtonElement;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly session: TicTacToeSession,
    private readonly options: TicTacToeViewOptions = {},
  ) {}

  mount(container: HTMLElement): void {
    if (this.root) throw new Error('La vista ya está montada');
    injectStyles(container.ownerDocument);
    const doc = container.ownerDocument;

    const root = doc.createElement('section');
    root.className = 'ttt';
    root.dataset.matchId = this.session.matchId;

    const head = doc.createElement('header');
    head.className = 'ttt__head';
    const title = doc.createElement('h2');
    title.className = 'ttt__title';
    title.textContent = 'Gato vs Prolog';
    const match = doc.createElement('span');
    match.className = 'ttt__match';
    match.textContent = `#${this.session.matchId.slice(0, 8)}`;
    match.title = this.session.matchId;
    head.append(title, match);

    const grid = doc.createElement('div');
    grid.className = 'ttt__grid';
    grid.setAttribute('role', 'grid');
    this.cells = Array.from({ length: 9 }, (_, position) => {
      const cell = doc.createElement('button');
      cell.type = 'button';
      cell.className = 'ttt__cell';
      cell.dataset.position = String(position);
      const { row, col } = Board.toRowCol(position);
      cell.setAttribute('aria-label', `Fila ${row + 1}, columna ${col + 1}`);
      cell.addEventListener('click', () => this.session.applyAction({ type: 'PLACE', position }));
      grid.append(cell);
      return cell;
    });

    this.status = doc.createElement('p');
    this.status.className = 'ttt__status';
    this.status.setAttribute('role', 'status');
    this.ai = doc.createElement('p');
    this.ai.className = 'ttt__ai';

    const actions = doc.createElement('div');
    actions.className = 'ttt__actions';
    this.retry = button(doc, 'Reintentar IA', 'ttt__btn ttt__btn--primary', () =>
      this.session.applyAction({ type: 'RETRY_AI' }),
    );
    this.abandon = button(doc, 'Abandonar', 'ttt__btn', () => this.session.abandon());
    actions.append(this.retry, this.abandon);
    if (this.options.onNewGame) {
      actions.append(button(doc, 'Nueva partida', 'ttt__btn', this.options.onNewGame));
    }

    root.append(head, grid, this.status, this.ai, actions);
    container.append(root);
    this.root = root;
    this.unsubscribe = this.session.subscribe((state) => this.render(state));
    this.render(this.session.getState());
  }

  /** Quita la vista del DOM. No abandona la partida: eso lo decide la consola. */
  unmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.root?.remove();
    this.root = null;
  }

  private render(state: TicTacToeState): void {
    const winLine = state.outcome.kind === 'WIN' ? new Set(state.outcome.line) : new Set<number>();
    state.board.forEach((mark, i) => {
      const cell = this.cells[i];
      cell.textContent = mark ?? '';
      cell.disabled = state.status !== 'HUMAN_TURN' || mark !== null;
      cell.classList.toggle('ttt__cell--o', mark === 'O');
      cell.classList.toggle('ttt__cell--win', winLine.has(i));
    });

    this.status.textContent = statusText(state);
    this.status.classList.toggle('ttt__status--error', state.status === 'AI_ERROR');
    this.retry.hidden = state.status !== 'AI_ERROR';
    this.abandon.hidden = state.status === 'FINISHED' || state.status === 'NOT_STARTED';

    const d = state.lastAiDecision;
    this.ai.textContent = d
      ? `Prolog jugó en fila ${d.row + 1}, columna ${d.col + 1} ${KIND_TEXT[d.kind] ?? ''} (${d.durationMs} ms)`
      : '';
  }
}

function statusText(state: TicTacToeState): string {
  switch (state.status) {
    case 'NOT_STARTED':
      return 'Partida sin iniciar';
    case 'HUMAN_TURN':
      return `Tu turno (${state.humanMark})`;
    case 'AI_THINKING':
      return 'Prolog está pensando…';
    case 'AI_ERROR':
      return `No se pudo obtener la jugada de Prolog: ${state.error}`;
    case 'FINISHED':
      if (state.finishReason === 'ABANDONED') return 'Partida abandonada';
      if (state.finishReason === 'DRAW') return 'Empate';
      return state.winnerPlayerId && state.outcome.kind === 'WIN' && state.outcome.mark === state.humanMark
        ? '¡Ganaste!'
        : 'Ganó la computadora';
  }
}

function button(doc: Document, text: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function injectStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}
