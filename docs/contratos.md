# Contratos de GameConsole

Contratos entre módulos y estado de integración.

## 1. Decisiones

| Tema | Decisión | Estado |
|---|---|---|
| Consola | Vite + TypeScript con clases, sin framework pesado | Acordado |
| Prolog | SWI-Prolog como servicio HTTP; el navegador lo llama directamente (CORS abierto) | Acordado |
| Juegos | Gato (Gabriel), memoria y Battleship (Brack) | Acordado |
| Interfaz de juegos | `GameSession` (sección 3) | Implementada en los tres juegos |
| Eventos | Sobre de 8 campos de GameStats, sin `gameVersion`; los datos propios van en `data` (sección 4) | Implementado en productor, Go y Scala |
| Abandono | Se envía `MATCH_FINISHED` con `reason=ABANDONED` al cerrar una partida activa | Implementado |
| Panel | Conteos operativos en Go y métricas finales/parciales en Scala (sección 6) | Integrado en la consola web |

## 2. Servicios y puertos

| Servicio | Puerto | Dueño | Estado |
|---|---|---|---|
| `scala-analytics` | 8080 | Gabriel | Listo |
| `go-service` (GameStats) | 8081 | Brack | Catálogo, conteos y snapshots parciales integrados |
| `prolog-service` | 8082 | Gabriel | Listo, con Dockerfile |
| `console` (Vite) | 5173 | Brack | Implementada |

Scala y Go conservan los puertos que ya tenían en el `docker-compose.yml` del proyecto 1.

> **Ojo:** Vite y Vitest no funcionan si la ruta del repo contiene `#`. Hay que clonar en una carpeta sin ese carácter.

## 3. Interfaz común de los juegos

Cada partida es un objeto independiente con su propio `matchId`; no hay singleton de partida. La consola crea una instancia por partida y monta su vista. Las definiciones están en `games/shared/`.

```ts
interface GameSession<State, Action> {
  readonly gameId: string;        // "TIC_TAC_TOE" | "MEMORY" | "BATTLESHIP"
  readonly matchId: string;       // nuevo por partida (crypto.randomUUID())
  start(): void;                  // envía MATCH_STARTED
  applyAction(action: Action): ActionResult;   // rechaza acciones inválidas sin lanzar
  getState(): State;              // copia para la vista
  abandon(): void;                // envía MATCH_FINISHED con reason=ABANDONED si seguía abierta
  subscribe(listener: (state: State) => void): () => void;
}

type ActionResult = { ok: true } | { ok: false; reason: string };

interface EventSink {             // lo implementa el EventPublisher de la consola
  publish(event: GameEvent): void;
}
```

- **Eventos:** `MatchEventFactory` (en `games/shared/GameEvent.ts`) arma el sobre con `eventId`, `timestamp`, `gameId` y `matchId`. Memoria y Battleship pueden reutilizarla.
- **Vistas:** cada juego tiene una clase con `mount(container: HTMLElement)` y `unmount()`. `unmount()` no abandona la partida; eso lo decide la consola.
- **Tema visual:** la vista del gato toma los colores de estas variables CSS si la consola las define: `--console-fg`, `--console-muted`, `--console-surface`, `--console-surface-2`, `--console-accent`, `--console-success`, `--console-danger` y `--console-border`.

### Gato: cómo montarlo en la consola

```ts
import { PrologClient, TicTacToeSession, TicTacToeView } from '../games/tictactoe/src';

const session = new TicTacToeSession({
  humanPlayerId,                                   // id estable del jugador
  advisor: new PrologClient(import.meta.env.VITE_PROLOG_URL ?? 'http://localhost:8082'),
  events: eventPublisher,                          // EventSink de la consola
});
const view = new TicTacToeView(session, { onNewGame: () => { /* nueva sesión y nueva vista */ } });
view.mount(container);
session.start();
```

`games/tictactoe/demo/` es una página que hace exactamente esto sin la consola (`npm run demo` dentro de `games/`).

## 4. Eventos

Sobre común (igual que GameStats):

```json
{
  "eventId": "uuid único, se mantiene en los reintentos",
  "timestamp": "2026-11-17T18:00:00.000Z",
  "gameId": "TIC_TAC_TOE",
  "matchId": "uuid de la partida",
  "playerId": "id del actor, o SYSTEM en MATCH_*",
  "type": "MATCH | ACTION",
  "action": "…",
  "data": { }
}
```

### Ciclo de vida (los tres juegos)

| action | type | playerId | data |
|---|---|---|---|
| `MATCH_STARTED` | `MATCH` | `SYSTEM` | `mode` (string) y los campos propios del juego (abajo) |
| `MATCH_FINISHED` | `MATCH` | `SYSTEM` | `reason`: `COMPLETED`, `DRAW` o `ABANDONED`; `winnerPlayerId` cuando hay ganador |

### Gato — `TIC_TAC_TOE` (implementado)

IDs de jugador: el del humano y `PROLOG_AI`.

| action | Requeridos en `data` | Opcionales |
|---|---|---|
| `MATCH_STARTED` | — | `mode`=`VS_COMPUTER`, `humanPlayerId`, `aiPlayerId`, `firstPlayerId` (string) |
| `MOVE_PLAYED` | `position`, `row`, `col` (nonNegativeInteger), `symbol` (string), `turn` (positiveInteger) | — |
| `AI_DECISION` | `position` (nonNegativeInteger), `algorithm` (string), `durationMs` (nonNegativeInteger) | `row`, `col`, `kind` (`WIN`/`BLOCK`/`SEARCH`), `score` (entero, puede ser negativo), `latencyMs` |

La jugada de la computadora envía `AI_DECISION` y después `MOVE_PLAYED`. Scala cuenta las jugadas solo con `MOVE_PLAYED`.

### Memoria — `MEMORY`

| action | Requeridos en `data` | Opcionales |
|---|---|---|
| `MATCH_STARTED` | — | `mode`=`SOLO`, `pairs` (positiveInteger) |
| `CARD_FLIPPED` | `cardIndex` (nonNegativeInteger), `symbol` (string) | — |
| `PAIR_ATTEMPTED` | `firstCard`, `secondCard` (nonNegativeInteger), `matched` (boolean), `attempt` (positiveInteger) | — |

- **Reglas:** 12 cartas y 6 parejas; un jugador.
- **Orden de un intento:** `CARD_FLIPPED` (primera carta), `CARD_FLIPPED` (segunda carta) y luego `PAIR_ATTEMPTED`, todos con el `playerId` del jugador.
- **Cierre:** `MATCH_FINISHED` con `reason=COMPLETED` y `winnerPlayerId` igual al jugador. No se inventa un rival.

### Battleship — `BATTLESHIP`

IDs de jugador: el del humano y `CPU`.

| action | Requeridos en `data` | Opcionales |
|---|---|---|
| `MATCH_STARTED` | — | `mode`=`VS_COMPUTER`, `boardSize` (positiveInteger) |
| `SHOT_FIRED` | `targetPlayerId` (string), `row`, `col` (nonNegativeInteger), `hit` (boolean) | `shipId` (string) |
| `SHIP_SUNK` | `targetPlayerId`, `shipId` (string), `shipSize` (positiveInteger) | — |

- **Hundimiento:** el disparo que hunde un barco envía `SHOT_FIRED` con `hit=true` y después `SHIP_SUNK`. Scala no cuenta el `SHIP_SUNK` como un acierto adicional.
- **Reglas:** tablero 6 × 6, barcos de tamaño 3/2/2 colocados automáticamente; la CPU no repite disparos.
- **Cierre:** `MATCH_FINISHED` con `reason=COMPLETED` y `winnerPlayerId`.

### Entradas del catálogo Go

Va dentro de `"games"`, junto a los juegos del proyecto 1:

```json
"TIC_TAC_TOE": {
  "description": "Gato humano contra computadora (IA en Prolog).",
  "actions": {
    "MOVE_PLAYED": { "description": "Jugada en el tablero.", "required": { "position": "nonNegativeInteger", "row": "nonNegativeInteger", "col": "nonNegativeInteger", "symbol": "string", "turn": "positiveInteger" } },
    "AI_DECISION": { "description": "Decisión calculada por Prolog; no es una jugada adicional.", "required": { "position": "nonNegativeInteger", "algorithm": "string", "durationMs": "nonNegativeInteger" }, "optional": { "kind": "string", "latencyMs": "nonNegativeInteger" } }
  }
},
"MEMORY": {
  "description": "Memoria de parejas para un jugador.",
  "actions": {
    "CARD_FLIPPED": { "description": "Carta volteada.", "required": { "cardIndex": "nonNegativeInteger", "symbol": "string" } },
    "PAIR_ATTEMPTED": { "description": "Intento de pareja con dos cartas.", "required": { "firstCard": "nonNegativeInteger", "secondCard": "nonNegativeInteger", "matched": "boolean", "attempt": "positiveInteger" } }
  }
},
"BATTLESHIP": {
  "description": "Battleship simplificado contra la computadora.",
  "actions": {
    "SHOT_FIRED": { "description": "Disparo a una casilla del rival.", "required": { "targetPlayerId": "string", "row": "nonNegativeInteger", "col": "nonNegativeInteger", "hit": "boolean" }, "optional": { "shipId": "string" } },
    "SHIP_SUNK": { "description": "Barco hundido; no suma un acierto adicional.", "required": { "targetPlayerId": "string", "shipId": "string", "shipSize": "positiveInteger" } }
  }
}
```

El catálogo ya incluye `"pairs": "positiveInteger"` y `"boardSize": "positiveInteger"` en `lifecycle.MATCH_STARTED.optional`. Los demás campos extra (`humanPlayerId`, `aiPlayerId`, `firstPlayerId`) pasan porque Go solo valida los campos que declara. `score` no se declara porque puede ser negativo y el catálogo no tiene un tipo de entero con signo.

## 5. Prolog (implementado)

Ver [`prolog_service/README.md`](../prolog_service/README.md). `POST /move` recibe `{ board, turn }` y responde la posición o un error. El servicio nunca devuelve jugadas aleatorias. Imagen: `prolog_service/Dockerfile` (puerto 8082; corre las pruebas al construirse).

## 6. Panel

| Dato | Dónde | Estado |
|---|---|---|
| Partidas iniciadas, activas y cerradas, globales y por juego | Go: `GET /stats/instances` | Implementado |
| Estadísticas generales | Scala: `GET /stats/overview` | Listo |
| Estadísticas por juego, finales y en curso por separado | Scala: `GET /stats/games/{gameId}` | Listo |
| Detalle de una partida | Scala: `GET /results/{matchId}` o `GET /partial/{matchId}` | Listo |

El detalle de las rutas de Scala está en [`docs/estadisticas.md`](estadisticas.md). La consola consulta Go y Scala por separado cada 2 segundos, sin calcular métricas por su cuenta. Go y Scala permiten CORS para solicitudes del navegador.

### `GET /stats/instances` en Go

```json
{
  "totals": { "started": 9, "active": 2, "finished": 7, "abandoned": 1 },
  "byGame": {
    "TIC_TAC_TOE": { "started": 4, "active": 1, "finished": 3, "abandoned": 0 },
    "MEMORY":      { "started": 3, "active": 1, "finished": 2, "abandoned": 1 },
    "BATTLESHIP":  { "started": 2, "active": 0, "finished": 2, "abandoned": 0 }
  },
  "updatedAt": "2026-11-17T18:00:00Z"
}
```

- `started` = partidas con `MATCH_STARTED`.
- `finished` = partidas con `MATCH_FINISHED`, incluidas las abandonadas.
- `active` = `started - finished`.
- `abandoned` = cierres con `reason=ABANDONED`.

Si Go guarda las partidas en memoria, los conteos se reinician al reiniciar el servicio; queda documentado así.

### Análisis parcial desde Go

Para que el panel cambie mientras se juega, Go envía a Scala un snapshot de cada partida abierta:

- **Cuándo:** después de aceptar eventos de una partida sin `MATCH_FINISHED`, como máximo una vez por segundo por partida (debounce).
- **Qué:** `POST http://scala-analytics:8080/analyze/partial` con el mismo cuerpo que `/analyze` (todos los eventos acumulados de esa partida) y `revision` = cantidad de eventos.
- **Respuestas:** un 409 con `stale` o con `finalized` se ignora; un error de red se reintenta en el siguiente evento.
- **Al cerrar:** sigue el flujo actual de `/analyze`; Scala borra el snapshot de esa partida.
