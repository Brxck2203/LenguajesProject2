// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatsPanel } from './StatsPanel';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StatsPanel', () => {
  it('consulta Go y Scala y muestra sus métricas sin recalcularlas', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      let payload: unknown;
      if (url.endsWith('/stats/instances')) {
        payload = {
          totals: { started: 4, active: 2, finished: 2, abandoned: 1 },
          byGame: { MEMORY: { started: 2, active: 1, finished: 1, abandoned: 0 } },
          updatedAt: '2026-11-19T10:00:00Z',
        };
      } else if (url.endsWith('/stats/overview')) {
        payload = {
          totals: { matchesAnalyzed: 2, matchesInProgress: 1, totalEvents: 15 },
          byGame: [{ gameId: 'MEMORY', matchesAnalyzed: 1, matchesInProgress: 1 }],
          topPlayers: [{ playerId: 'player-1', wins: 1 }],
        };
      } else if (url.endsWith('/stats/games/MEMORY')) {
        payload = {
          gameId: 'MEMORY',
          final: { matchesAnalyzed: 1, matchStatsAverages: { accuracyPct: 75 } },
          live: { matchesInProgress: 1 },
          liveMatches: [{ matchId: 'live-1', revision: 3, updatedAt: '2026-11-19T10:00:00Z' }],
        };
      } else if (url.endsWith('/results')) {
        payload = { count: 0, results: [] };
      } else {
        payload = { count: 0, partials: [] };
      }
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const container = document.createElement('div');
    const panel = new StatsPanel(container, 'http://go.local', 'http://scala.local');

    panel.start();
    await vi.waitFor(() => expect(container.textContent).toContain('Promedios de partida'));
    panel.stop();

    expect(container.textContent).toContain('Partidas recibidas por Go');
    expect(container.textContent).toContain('Partidas iniciadas');
    expect(container.textContent).toContain('75');
    expect(container.textContent).toContain('live-1');
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('http://go.local/stats/instances');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('http://scala.local/stats/games/BATTLESHIP');
  });
});
