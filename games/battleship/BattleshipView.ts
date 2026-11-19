import { BattleshipSession, BattleshipState } from './BattleshipSession';

const STYLE_ID = 'battleship-styles';
const CSS = `
.battleship { color: var(--console-fg, #1f2328); background: var(--console-surface, #fff);
  border: 1px solid var(--console-border, #d0d7de); border-radius: 12px; padding: 16px;
  font-family: system-ui, sans-serif; }
.battleship__head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.battleship__title { margin: 0; font-size: 1.05rem; }
.battleship__match { color: var(--console-muted, #59636e); font: 12px ui-monospace, monospace; }
.battleship__boards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 20px; margin-top: 16px; }
.battleship__board-title { margin: 0 0 8px; font-size: .9rem; }
.battleship__grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 3px; }
.battleship__cell { aspect-ratio: 1; min-width: 0; padding: 0; border: 1px solid var(--console-border, #d0d7de);
  border-radius: 4px; background: var(--console-surface-2, #f3f4f6); color: var(--console-fg, #1f2328);
  font-size: clamp(.65rem, 2vw, 1rem); cursor: pointer; }
.battleship__cell--ship { background: #64748b; color: #fff; }
.battleship__cell--hit { background: var(--console-danger, #dc2626); color: #fff; }
.battleship__cell--miss { background: #bfdbfe; color: #1e3a8a; }
.battleship__cell:disabled { cursor: default; }
.battleship__status { min-height: 1.4em; margin: 14px 0 0; font-weight: 600; }
.battleship__meta { margin: 4px 0 0; color: var(--console-muted, #59636e); font-size: .9rem; }
`;

export class BattleshipView {
  private root: HTMLElement | null = null;
  private ownCells: HTMLButtonElement[] = [];
  private opponentCells: HTMLButtonElement[] = [];
  private status!: HTMLElement;
  private meta!: HTMLElement;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly session: BattleshipSession) {}

  mount(container: HTMLElement): void {
    if (this.root) throw new Error('La vista ya está montada');
    injectStyles(container.ownerDocument);
    const doc = container.ownerDocument;
    const root = doc.createElement('section');
    root.className = 'battleship';
    root.dataset.matchId = this.session.matchId;

    const head = doc.createElement('header');
    head.className = 'battleship__head';
    const title = doc.createElement('h2');
    title.className = 'battleship__title';
    title.textContent = 'Battleship';
    const match = doc.createElement('span');
    match.className = 'battleship__match';
    match.textContent = `#${this.session.matchId.slice(0, 8)}`;
    match.title = this.session.matchId;
    head.append(title, match);

    const boards = doc.createElement('div');
    boards.className = 'battleship__boards';
    const ownSection = makeBoardSection(doc, 'Tu flota');
    const opponentSection = makeBoardSection(doc, 'Flota rival');
    this.ownCells = makeCells(doc, ownSection.grid, null);
    this.opponentCells = makeCells(doc, opponentSection.grid, (position) =>
      this.session.applyAction({ type: 'FIRE', position }),
    );
    boards.append(ownSection.section, opponentSection.section);

    this.status = doc.createElement('p');
    this.status.className = 'battleship__status';
    this.status.setAttribute('role', 'status');
    this.meta = doc.createElement('p');
    this.meta.className = 'battleship__meta';
    root.append(head, boards, this.status, this.meta);
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

  private render(state: BattleshipState): void {
    state.humanBoard.forEach((cell, index) => {
      renderCell(this.ownCells[index], cell.ship, cell.fired, cell.hit);
      this.ownCells[index].disabled = true;
    });
    state.opponentBoard.forEach((cell, index) => {
      renderCell(this.opponentCells[index], false, cell.fired, cell.hit);
      this.opponentCells[index].disabled = state.status !== 'HUMAN_TURN' || cell.fired;
    });
    this.status.textContent = statusText(state);
    this.meta.textContent =
      `Disparos: ${state.humanShotsFired} · Barcos rivales: ${state.opponentShipsRemaining}/3`;
  }
}

function makeBoardSection(doc: Document, titleText: string): { section: HTMLElement; grid: HTMLElement } {
  const section = doc.createElement('section');
  const title = doc.createElement('h3');
  title.className = 'battleship__board-title';
  title.textContent = titleText;
  const grid = doc.createElement('div');
  grid.className = 'battleship__grid';
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', titleText);
  section.append(title, grid);
  return { section, grid };
}

function makeCells(
  doc: Document,
  grid: HTMLElement,
  onFire: ((position: number) => void) | null,
): HTMLButtonElement[] {
  return Array.from({ length: 36 }, (_, position) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'battleship__cell';
    button.dataset.position = String(position);
    button.setAttribute('aria-label', `Fila ${Math.floor(position / 6) + 1}, columna ${(position % 6) + 1}`);
    button.addEventListener('click', () => onFire?.(position));
    grid.append(button);
    return button;
  });
}

function renderCell(button: HTMLButtonElement, ship: boolean, fired: boolean, hit: boolean): void {
  button.textContent = fired ? (hit ? '×' : '·') : '';
  button.classList.toggle('battleship__cell--ship', ship && !hit);
  button.classList.toggle('battleship__cell--hit', fired && hit);
  button.classList.toggle('battleship__cell--miss', fired && !hit);
  const position = Number(button.dataset.position);
  const coordinate = `Fila ${Math.floor(position / 6) + 1}, columna ${(position % 6) + 1}`;
  const description = fired ? (hit ? 'impacto' : 'fallo') : ship ? 'barco' : 'sin disparar';
  button.setAttribute('aria-label', `${coordinate}, ${description}`);
}

function statusText(state: BattleshipState): string {
  switch (state.status) {
    case 'NOT_STARTED':
      return 'Partida sin iniciar';
    case 'HUMAN_TURN':
      return 'Tu turno: elige una casilla rival';
    case 'CPU_THINKING':
      return 'La computadora está disparando…';
    case 'FINISHED':
      if (state.finishReason === 'ABANDONED') return 'Partida abandonada';
      return state.winnerPlayerId === 'CPU' ? 'La computadora ganó' : '¡Ganaste!';
  }
}

function injectStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}
