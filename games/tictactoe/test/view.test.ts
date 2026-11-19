// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { GameEvent } from '../../shared/GameEvent';
import { Board, Mark } from '../src/Board';
import { MoveAdvisor, PrologDecision, PrologError } from '../src/PrologClient';
import { TicTacToeSession } from '../src/TicTacToeSession';
import { TicTacToeView } from '../src/TicTacToeView';

class Scripted implements MoveAdvisor {
  private i = 0;
  constructor(private readonly moves: number[], private readonly fail = false) {}
  async decide(_b: Board, turn: Mark): Promise<PrologDecision> {
    if (this.fail) throw new PrologError('servicio caído', 'UNAVAILABLE');
    const position = this.moves[this.i++];
    return { position, ...Board.toRowCol(position), symbol: turn, algorithm: 'minimax-alphabeta', kind: 'BLOCK', score: 0, durationMs: 2 };
  }
}

function setup(advisor: MoveAdvisor, onNewGame?: () => void) {
  const events: GameEvent[] = [];
  const session = new TicTacToeSession({ humanPlayerId: 'ana', advisor, events: { publish: (e) => events.push(e) } });
  const container = document.createElement('div');
  document.body.append(container);
  const view = new TicTacToeView(session, { onNewGame });
  view.mount(container);
  session.start();
  const cells = () => [...container.querySelectorAll<HTMLButtonElement>('.ttt__cell')];
  const status = () => container.querySelector('.ttt__status')!.textContent;
  const buttonNamed = (text: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('.ttt__btn')].find((b) => b.textContent === text)!;
  return { session, view, container, cells, status, buttonNamed, events };
}

describe('TicTacToeView', () => {
  it('dibuja 9 casillas y el turno del jugador', () => {
    const { cells, status, container, session } = setup(new Scripted([]));
    expect(cells()).toHaveLength(9);
    expect(status()).toBe('Tu turno (X)');
    expect(container.querySelector<HTMLElement>('.ttt')!.dataset.matchId).toBe(session.matchId);
  });

  it('un clic juega, bloquea el tablero mientras Prolog piensa y muestra su decisión', async () => {
    const { cells, status, session, container } = setup(new Scripted([4]));
    cells()[0].click();
    expect(status()).toBe('Prolog está pensando…');
    expect(cells().every((c) => c.disabled)).toBe(true);
    await session.whenIdle();
    expect(cells()[0].textContent).toBe('X');
    expect(cells()[4].textContent).toBe('O');
    expect(cells()[4].disabled).toBe(true);
    expect(cells()[1].disabled).toBe(false);
    expect(container.querySelector('.ttt__ai')!.textContent).toContain('fila 2, columna 2 para bloquear');
  });

  it('resalta la línea ganadora y anuncia la victoria', async () => {
    const { cells, status, session } = setup(new Scripted([3, 4]));
    for (const p of [0, 1, 2]) {
      cells()[p].click();
      await session.whenIdle();
    }
    expect(status()).toBe('¡Ganaste!');
    expect(cells().filter((c) => c.classList.contains('ttt__cell--win')).map((c) => c.dataset.position)).toEqual(['0', '1', '2']);
    expect(cells().every((c) => c.disabled)).toBe(true);
  });

  it('muestra el error de Prolog con botón de reintento', async () => {
    const { cells, status, session, buttonNamed } = setup(new Scripted([], true));
    expect(buttonNamed('Reintentar IA').hidden).toBe(true);
    cells()[0].click();
    await session.whenIdle();
    expect(status()).toContain('servicio caído');
    expect(buttonNamed('Reintentar IA').hidden).toBe(false);
  });

  it('abandonar cierra la partida; nueva partida llama a la consola', () => {
    let asked = 0;
    const { status, buttonNamed, events } = setup(new Scripted([]), () => asked++);
    buttonNamed('Abandonar').click();
    expect(status()).toBe('Partida abandonada');
    expect(events.at(-1)!.data).toEqual({ reason: 'ABANDONED' });
    buttonNamed('Nueva partida').click();
    expect(asked).toBe(1);
  });

  it('dos vistas en la misma página no se mezclan y unmount las retira', async () => {
    const a = setup(new Scripted([4]));
    const b = setup(new Scripted([4]));
    a.cells()[0].click();
    await a.session.whenIdle();
    expect(b.cells().every((c) => c.textContent === '')).toBe(true);
    a.view.unmount();
    expect(a.container.querySelector('.ttt')).toBeNull();
    expect(document.querySelectorAll('#ttt-styles')).toHaveLength(1);
  });
});
