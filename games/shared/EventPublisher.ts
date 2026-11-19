import { EventSink, GameEvent } from './GameEvent';

export interface EventDeliveryFailure {
  eventId: string;
  matchId: string;
  attempts: number;
  message: string;
}

export interface EventPublisherState {
  matchId: string;
  pending: number;
  failure: EventDeliveryFailure | null;
}

export interface EventPublisherOptions {
  baseUrl: string;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  fetchImpl?: typeof fetch;
}

interface MatchQueue {
  events: GameEvent[];
  processing: boolean;
  failure: EventDeliveryFailure | null;
  waiters: Array<() => void>;
}

class DeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly attempts = 1,
  ) {
    super(message);
    this.name = 'DeliveryError';
  }
}

export class EventPublisher implements EventSink {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly queues = new Map<string, MatchQueue>();
  private readonly listeners = new Set<(state: EventPublisherState) => void>();

  constructor(options: EventPublisherOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 250;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    if (!this.baseUrl || this.timeoutMs <= 0 || this.maxAttempts <= 0 || this.retryBaseMs < 0) {
      throw new Error('Configuración inválida para EventPublisher');
    }
  }

  publish(event: GameEvent): void {
    let queue = this.queues.get(event.matchId);
    if (!queue) {
      queue = { events: [], processing: false, failure: null, waiters: [] };
      this.queues.set(event.matchId, queue);
    }
    if (queue.events.some((queued) => queued.eventId === event.eventId)) {
      return;
    }
    queue.events.push(event);
    this.emit(event.matchId, queue);
    void this.drain(event.matchId, queue);
  }

  subscribe(listener: (state: EventPublisherState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(matchId: string): EventPublisherState {
    const queue = this.queues.get(matchId);
    return {
      matchId,
      pending: queue?.events.length ?? 0,
      failure: queue?.failure ?? null,
    };
  }

  retry(matchId: string): void {
    const queue = this.queues.get(matchId);
    if (!queue || !queue.failure) return;
    queue.failure = null;
    this.emit(matchId, queue);
    void this.drain(matchId, queue);
  }

  whenIdle(matchId: string): Promise<void> {
    const queue = this.queues.get(matchId);
    if (!queue || !queue.processing) return Promise.resolve();
    return new Promise((resolve) => queue.waiters.push(resolve));
  }

  private async drain(matchId: string, queue: MatchQueue): Promise<void> {
    if (queue.processing || queue.failure) return;
    queue.processing = true;
    try {
      while (queue.events.length > 0 && !queue.failure) {
        const event = queue.events[0];
        try {
          await this.deliver(event);
          queue.events.shift();
          this.emit(matchId, queue);
        } catch (error) {
          const failure = error instanceof DeliveryError ? error : new DeliveryError(errorMessage(error), false);
          queue.failure = {
            eventId: event.eventId,
            matchId,
            attempts: failure.attempts,
            message: failure.message,
          };
          this.emit(matchId, queue);
        }
      }
    } finally {
      queue.processing = false;
      for (const resolve of queue.waiters.splice(0)) resolve();
      if (queue.events.length === 0) {
        this.queues.delete(matchId);
        this.emit(matchId, null);
      }
    }
  }

  private async deliver(event: GameEvent): Promise<void> {
    let lastError: DeliveryError | null = null;
    let attempts = 0;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      attempts = attempt;
      try {
        await this.post(event);
        return;
      } catch (error) {
        const failure = error instanceof DeliveryError ? error : new DeliveryError(errorMessage(error), false);
        lastError = failure;
        if (!failure.retryable || attempt === this.maxAttempts) break;
        await delay(this.retryBaseMs * 2 ** (attempt - 1));
      }
    }
    const failure = lastError ?? new DeliveryError('No se pudo enviar el evento', false);
    throw new DeliveryError(`${failure.message} (intentos: ${attempts})`, false, attempts);
  }

  private async post(event: GameEvent): Promise<void> {
    const response = await this.request(`${this.baseUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(event),
    });
    if (response.status === 202) {
      await response.body?.cancel();
      return;
    }
    if (response.status === 409) {
      await response.body?.cancel();
      await this.reconcile(event);
      return;
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      throw new DeliveryError(`GameStats respondió HTTP ${response.status}`, true);
    }
    await response.body?.cancel();
    throw new DeliveryError(`GameStats rechazó el evento (HTTP ${response.status})`, false);
  }

  private async reconcile(expected: GameEvent): Promise<void> {
    const path = `/matches/${encodeURIComponent(expected.matchId)}/events/${encodeURIComponent(expected.eventId)}`;
    const response = await this.request(`${this.baseUrl}${path}`, { headers: { Accept: 'application/json' } });
    if (response.status === 200) {
      const actual = (await response.json()) as GameEvent;
      if (sameEvent(expected, actual)) return;
      throw new DeliveryError(`El eventId ${expected.eventId} ya existe con otro contenido`, false);
    }
    if (response.status === 404) {
      await response.body?.cancel();
      throw new DeliveryError(`GameStats respondió 409, pero no confirmó el evento ${expected.eventId}`, false);
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      throw new DeliveryError(`No se pudo conciliar el evento (HTTP ${response.status})`, true);
    }
    await response.body?.cancel();
    throw new DeliveryError(`No se pudo conciliar el evento (HTTP ${response.status})`, false);
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      const timedOut = controller.signal.aborted;
      throw new DeliveryError(
        timedOut ? 'GameStats agotó el tiempo de respuesta' : `No se pudo contactar GameStats: ${errorMessage(error)}`,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private emit(matchId: string, queue: MatchQueue | null): void {
    const state: EventPublisherState = {
      matchId,
      pending: queue?.events.length ?? 0,
      failure: queue?.failure ?? null,
    };
    for (const listener of this.listeners) listener(state);
  }
}

function sameEvent(expected: GameEvent, actual: GameEvent): boolean {
  return (
    expected.eventId === actual.eventId &&
    Date.parse(expected.timestamp) === Date.parse(actual.timestamp) &&
    expected.gameId === actual.gameId &&
    expected.matchId === actual.matchId &&
    expected.playerId === actual.playerId &&
    expected.type === actual.type &&
    expected.action === actual.action &&
    stableJson(expected.data) === stableJson(actual.data)
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const fields = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
