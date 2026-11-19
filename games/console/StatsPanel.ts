type JsonObject = Record<string, unknown>;

const GAME_IDS = ['TIC_TAC_TOE', 'MEMORY', 'BATTLESHIP'] as const;
const POLL_INTERVAL_MS = 2000;

interface ApiResult {
  value: unknown | null;
  error: string | null;
}

export class StatsPanel {
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly goUrl: string,
    private readonly scalaUrl: string,
  ) {}

  start(): void {
    if (this.timer !== null) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    const urls = [
      `${this.goUrl}/stats/instances`,
      `${this.scalaUrl}/stats/overview`,
      ...GAME_IDS.map((gameId) => `${this.scalaUrl}/stats/games/${gameId}`),
      `${this.scalaUrl}/results`,
      `${this.scalaUrl}/partial`,
    ];
    try {
      const results = await Promise.all(urls.map(fetchJson));
      this.render(results);
    } finally {
      this.refreshing = false;
    }
  }

  private render(results: ApiResult[]): void {
    const doc = this.container.ownerDocument;
    const updated = doc.createElement('p');
    updated.className = 'refresh-note';
    updated.textContent = `Última consulta: ${new Date().toLocaleTimeString()}. Los datos son calculados por Go y Scala.`;
    const sections: HTMLElement[] = [updated];

    sections.push(
      this.renderResult(
        'Partidas recibidas por Go',
        results[0],
        (value) => this.renderInstanceStats(value),
      ),
      this.renderResult('Resumen general de Scala', results[1], (value) => this.renderOverview(value)),
    );
    GAME_IDS.forEach((gameId, index) => {
      sections.push(this.renderResult(`Estadísticas de ${gameLabel(gameId)}`, results[index + 2], (value) => this.renderGame(value)));
    });
    sections.push(
      this.renderResult('Resultados finales', results[5], (value) => this.renderList(value, 'results')),
      this.renderResult('Partidas en curso', results[6], (value) => this.renderList(value, 'partials')),
    );
    this.container.replaceChildren(...sections);
  }

  private renderResult(
    title: string,
    result: ApiResult,
    content: (value: unknown) => HTMLElement,
  ): HTMLElement {
    const section = this.container.ownerDocument.createElement('section');
    section.className = 'stats-section';
    const heading = this.container.ownerDocument.createElement('h3');
    heading.textContent = title;
    section.append(heading);
    if (result.error) {
      const error = this.container.ownerDocument.createElement('p');
      error.className = 'error-text';
      error.textContent = result.error;
      section.append(error);
    } else {
      section.append(content(result.value));
    }
    return section;
  }

  private renderInstanceStats(value: unknown): HTMLElement {
    const object = asObject(value);
    const root = this.container.ownerDocument.createElement('div');
    root.append(this.renderMetrics(object.totals));
    root.append(this.renderObjectRows(object.byGame));
    return root;
  }

  private renderOverview(value: unknown): HTMLElement {
    const object = asObject(value);
    const root = this.container.ownerDocument.createElement('div');
    root.append(this.renderMetrics(object.totals));
    root.append(this.renderObjectRows(object.byGame));
    root.append(this.renderObjectRows(object.topPlayers, 'Jugador'));
    return root;
  }

  private renderGame(value: unknown): HTMLElement {
    const object = asObject(value);
    const root = this.container.ownerDocument.createElement('div');
    root.append(this.renderMetrics(object.final, 'Finales'));
    root.append(this.renderMetrics(object.live, 'En curso'));
    const final = asObject(object.final);
    root.append(this.renderMetrics(final.matchStatsAverages, 'Promedios de partida'));
    const liveMatches = Array.isArray(object.liveMatches) ? object.liveMatches : [];
    if (liveMatches.length > 0) {
      root.append(this.renderObjectRows(liveMatches, 'Snapshot en curso'));
    }
    return root;
  }

  private renderList(value: unknown, key: string): HTMLElement {
    const object = asObject(value);
    const list = Array.isArray(object[key]) ? object[key] : [];
    return this.renderObjectRows(list);
  }

  private renderMetrics(value: unknown, title?: string): HTMLElement {
    const doc = this.container.ownerDocument;
    const object = asObject(value);
    const root = doc.createElement('div');
    const entries = Object.entries(object).filter(([, item]) => isScalar(item));
    if (title) {
      const heading = doc.createElement('h4');
      heading.textContent = title;
      root.append(heading);
    }
    if (entries.length === 0) {
      const empty = doc.createElement('p');
      empty.className = 'refresh-note';
      empty.textContent = 'Sin datos.';
      root.append(empty);
      return root;
    }
    const grid = doc.createElement('dl');
    grid.className = 'metric-grid';
    for (const [key, item] of entries) {
      const metric = doc.createElement('div');
      metric.className = 'metric';
      const label = doc.createElement('dt');
      label.textContent = humanize(key);
      const number = doc.createElement('dd');
      number.textContent = formatScalar(item);
      metric.append(label, number);
      grid.append(metric);
    }
    root.append(grid);
    return root;
  }

  private renderObjectRows(value: unknown, fallbackTitle = 'Registro'): HTMLElement {
    const doc = this.container.ownerDocument;
    const root = doc.createElement('div');
    root.className = 'data-list';
    const rows = Array.isArray(value)
      ? value
      : Object.entries(asObject(value)).map(([gameId, details]) => ({ gameId, ...asObject(details) }));
    rows.forEach((item, index) => {
      const object = asObject(item);
      const row = doc.createElement('article');
      row.className = 'data-row';
      const heading = doc.createElement('p');
      heading.className = 'data-row__title';
      heading.textContent = String(object.gameId ?? object.matchId ?? object.playerId ?? `${fallbackTitle} ${index + 1}`);
      const body = doc.createElement('p');
      body.className = 'data-row__body';
      body.textContent = Object.entries(object)
        .filter(([key, itemValue]) => key !== 'gameId' && key !== 'matchId' && key !== 'playerId' && isScalar(itemValue))
        .map(([key, itemValue]) => `${humanize(key)}: ${formatScalar(itemValue)}`)
        .join(' · ');
      row.append(heading, body);
      const details = Object.fromEntries(
        Object.entries(object).filter(([, itemValue]) => itemValue !== null && typeof itemValue === 'object'),
      );
      if (Object.keys(details).length > 0) {
        const disclosure = doc.createElement('details');
        const summary = doc.createElement('summary');
        summary.textContent = 'Ver detalles';
        const pre = doc.createElement('pre');
        pre.className = 'data-row__body';
        pre.textContent = JSON.stringify(details, null, 2);
        disclosure.append(summary, pre);
        row.append(disclosure);
      }
      root.append(row);
    });
    if (rows.length === 0) {
      const empty = doc.createElement('p');
      empty.className = 'refresh-note';
      empty.textContent = 'Sin registros.';
      root.append(empty);
    }
    return root;
  }
}

async function fetchJson(url: string): Promise<ApiResult> {
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return { value: null, error: `${url}: HTTP ${response.status}` };
    return { value: await response.json(), error: null };
  } catch (error) {
    return { value: null, error: `${url}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function isScalar(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function formatScalar(value: unknown): string {
  return String(value);
}

function humanize(value: string): string {
  const labels: Record<string, string> = {
    started: 'Partidas iniciadas',
    active: 'Partidas activas',
    finished: 'Partidas cerradas',
    abandoned: 'Abandonadas',
    matchesAnalyzed: 'Partidas analizadas',
    matchesInProgress: 'Partidas en curso',
    totalEvents: 'Eventos totales',
    distinctPlayers: 'Jugadores distintos',
    averageDurationSeconds: 'Duración promedio (s)',
    eventCount: 'Eventos',
    totalMoves: 'Jugadas totales',
    accuracyPct: 'Precisión (%)',
    revision: 'Revisión',
    updatedAt: 'Actualizado',
    wins: 'Victorias',
  };
  if (labels[value]) return labels[value];
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

function gameLabel(gameId: (typeof GAME_IDS)[number]): string {
  switch (gameId) {
    case 'TIC_TAC_TOE':
      return 'Gato';
    case 'MEMORY':
      return 'Memoria';
    case 'BATTLESHIP':
      return 'Battleship';
  }
}
