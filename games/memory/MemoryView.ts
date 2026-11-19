import { MemorySession, MemoryState } from './MemorySession';

const STYLE_ID = 'memory-styles';
const CSS = `
.memory { color: var(--console-fg, #1f2328); background: var(--console-surface, #fff);
  border: 1px solid var(--console-border, #d0d7de); border-radius: 12px; padding: 16px;
  font-family: system-ui, sans-serif; max-width: 440px; }
.memory__head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.memory__title { margin: 0; font-size: 1.05rem; }
.memory__match { color: var(--console-muted, #59636e); font: 12px ui-monospace, monospace; }
.memory__board { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
.memory__card { aspect-ratio: 1; border: 1px solid var(--console-border, #d0d7de); border-radius: 8px;
  background: var(--console-surface-2, #f3f4f6); color: var(--console-fg, #1f2328); cursor: pointer;
  font-size: clamp(1.3rem, 5vw, 2rem); }
.memory__card--shown { background: var(--console-accent, #2563eb); color: #fff; }
.memory__card--matched { background: var(--console-success, #16a34a); color: #fff; }
.memory__card:disabled { cursor: default; }
.memory__status { min-height: 1.4em; margin: 12px 0 0; font-weight: 600; }
.memory__meta { margin: 4px 0 0; color: var(--console-muted, #59636e); font-size: .9rem; }
`;

export class MemoryView {
  private root: HTMLElement | null = null;
  private cards: HTMLButtonElement[] = [];
  private status!: HTMLElement;
  private meta!: HTMLElement;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly session: MemorySession) {}

  mount(container: HTMLElement): void {
    if (this.root) throw new Error('La vista ya está montada');
    injectStyles(container.ownerDocument);
    const doc = container.ownerDocument;
    const root = doc.createElement('section');
    root.className = 'memory';
    root.dataset.matchId = this.session.matchId;

    const head = doc.createElement('header');
    head.className = 'memory__head';
    const title = doc.createElement('h2');
    title.className = 'memory__title';
    title.textContent = 'Memoria';
    const match = doc.createElement('span');
    match.className = 'memory__match';
    match.textContent = `#${this.session.matchId.slice(0, 8)}`;
    match.title = this.session.matchId;
    head.append(title, match);

    const board = doc.createElement('div');
    board.className = 'memory__board';
    board.setAttribute('role', 'group');
    board.setAttribute('aria-label', 'Tablero de memoria');
    this.cards = Array.from({ length: 12 }, (_, index) => {
      const card = doc.createElement('button');
      card.type = 'button';
      card.className = 'memory__card';
      card.setAttribute('aria-label', `Carta ${index + 1}, oculta`);
      card.addEventListener('click', () => this.session.applyAction({ type: 'FLIP', cardIndex: index }));
      board.append(card);
      return card;
    });

    this.status = doc.createElement('p');
    this.status.className = 'memory__status';
    this.status.setAttribute('role', 'status');
    this.meta = doc.createElement('p');
    this.meta.className = 'memory__meta';
    root.append(head, board, this.status, this.meta);
    container.append(root);
    this.root = root;
    this.unsubscribe = this.session.subscribe((state) => this.render(state));
    this.render(this.session.getState());
  }

  unmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.root?.remove();
    this.root = null;
  }

  private render(state: MemoryState): void {
    state.cards.forEach((card, index) => {
      const button = this.cards[index];
      const shown = card.faceUp || card.matched;
      button.textContent = shown ? card.symbol : '?';
      button.disabled = state.status !== 'WAITING_FOR_FIRST' && state.status !== 'WAITING_FOR_SECOND';
      button.classList.toggle('memory__card--shown', shown && !card.matched);
      button.classList.toggle('memory__card--matched', card.matched);
      button.setAttribute('aria-label', shown ? `Carta ${index + 1}, ${card.symbol}` : `Carta ${index + 1}, oculta`);
    });
    this.status.textContent = statusText(state);
    this.meta.textContent = `Intentos: ${state.attempts} · Parejas: ${state.pairsFound}/6`;
  }
}

function statusText(state: MemoryState): string {
  switch (state.status) {
    case 'NOT_STARTED':
      return 'Partida sin iniciar';
    case 'WAITING_FOR_FIRST':
      return 'Selecciona una carta';
    case 'WAITING_FOR_SECOND':
      return 'Encuentra su pareja';
    case 'RESOLVING':
      return 'Memoriza las cartas…';
    case 'FINISHED':
      return state.finishReason === 'ABANDONED' ? 'Partida abandonada' : '¡Encontraste todas las parejas!';
  }
}

function injectStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}
