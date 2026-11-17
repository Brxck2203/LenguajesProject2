# Contratos de GameConsole

Acuerdos entre los módulos para trabajar en paralelo. Si algo cambia, se actualiza aquí primero y se avisa al otro.

## 1. Decisiones

| Tema | Decisión |
|---|---|
| Consola | Vite + TypeScript con clases, sin framework pesado |
| Prolog | SWI-Prolog como servicio HTTP; el navegador lo llama directamente (CORS abierto) |
| Juegos | Gato (Gabriel), memoria y Battleship (Brack) |
| Abandono | Al cerrar, reiniciar o salir de una partida abierta se envía `MATCH_FINISHED` con `reason=ABANDONED`. Si no alcanza a enviarse, la partida queda activa en GameStats |
| Eventos | Sobre de 8 campos de GameStats, sin `gameVersion`; los datos propios van en `data` |

## 2. Servicios y puertos

| Servicio | Puerto | Dueño |
|---|---|---|
| `scala-analytics` | 8080 | Gabriel |
| `go-service` (GameStats + panel) | 8081 | Brack |
| `prolog-service` | 8082 | Gabriel |
| `console` (Vite) | 5173 | Brack |

Scala y Go conservan los puertos que ya tenían en el `docker-compose.yml` del proyecto 1.

## 3. Interfaz común de los juegos

Cada partida es un objeto independiente con su propio `matchId`; no hay singleton de partida. La consola crea una instancia por partida y monta su vista.

```ts
interface GameSession<State, Action> {
  readonly gameId: string;        // "TIC_TAC_TOE" | "MEMORY" | "BATTLESHIP"
  readonly matchId: string;       // nuevo por partida (crypto.randomUUID())
  start(): void;                  // envía MATCH_STARTED
  applyAction(action: Action): ActionResult;   // rechaza acciones inválidas sin lanzar
  getState(): State;              // copia inmutable para la vista
  abandon(): void;                // envía MATCH_FINISHED con reason=ABANDONED si seguía abierta
  subscribe(listener: (state: State) => void): () => void;
}

type ActionResult = { ok: true } | { ok: false; reason: string };

interface EventSink {             // lo implementa el EventPublisher de la consola
  publish(event: GameEvent): void;
}
```

Las definiciones están en `games/shared/`. Cada sesión recibe por constructor un `EventSink` y el `playerId` del humano. La consola decide si ese id es fijo por navegador.

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

### Gato — `TIC_TAC_TOE`

IDs de jugador: el del humano y `PROLOG_AI` para la computadora.

| action | Requeridos en `data` | Opcionales |
|---|---|---|
| `MATCH_STARTED` | — | `mode`=`VS_COMPUTER`, `humanPlayerId`, `aiPlayerId`, `firstPlayerId` (string) |
| `MOVE_PLAYED` | `position`, `row`, `col` (nonNegativeInteger), `symbol` (string), `turn` (positiveInteger, número de jugada) | — |
| `AI_DECISION` | `position` (nonNegativeInteger), `algorithm` (string), `durationMs` (nonNegativeInteger) | `kind` (`WIN`/`BLOCK`/`SEARCH`), `score` (entero, puede ser negativo), `latencyMs` (nonNegativeInteger, ida y vuelta medida en la consola) |

La jugada de la computadora genera `AI_DECISION` y después `MOVE_PLAYED`. Scala cuenta las jugadas solo con `MOVE_PLAYED`, nunca con `AI_DECISION`.

### Memoria — `MEMORY`

| action | Requeridos en `data` | Opcionales |
|---|---|---|
| `MATCH_STARTED` | — | `mode`=`SOLO`, `pairs` (positiveInteger) |
| `CARD_FLIPPED` | `cardIndex` (nonNegativeInteger), `symbol` (string) | — |
| `PAIR_ATTEMPTED` | `firstCard`, `secondCard` (nonNegativeInteger), `matched` (boolean), `attempt` (positiveInteger) | — |

`MATCH_FINISHED` usa `reason=COMPLETED` y `winnerPlayerId` igual al jugador. No se inventa un rival.

### Battleship — `BATTLESHIP`

IDs de jugador: el del humano y `CPU`.

| action | Requeridos en `data` | Opcionales |
|---|---|---|
| `MATCH_STARTED` | — | `mode`=`VS_COMPUTER`, `boardSize` (positiveInteger) |
| `SHOT_FIRED` | `targetPlayerId` (string), `row`, `col` (nonNegativeInteger), `hit` (boolean) | `shipId` (string) |
| `SHIP_SUNK` | `targetPlayerId`, `shipId` (string), `shipSize` (positiveInteger) | — |

El disparo que hunde un barco envía `SHOT_FIRED` con `hit=true` y después `SHIP_SUNK`. Scala no cuenta el `SHIP_SUNK` como un acierto adicional.

**Pendiente (Brack):** agregar `TIC_TAC_TOE`, `MEMORY` y `BATTLESHIP` con estas acciones a `go_service/internal/validation/event_catalog.json`.

## 5. Prolog

Ver [`prolog_service/README.md`](../prolog_service/README.md): `POST /move` con `{ board, turn }` responde la posición o un error. El servicio nunca devuelve jugadas aleatorias.

## 6. Panel (por cerrar)

- Go: conteos de partidas iniciadas, activas y cerradas, globales y por juego.
- Scala: estadísticas finales por juego y una ruta separada para métricas parciales (snapshots por `matchId` con revisión creciente) que no se mezclan con las finales.
- Falta definir si el panel consulta Go y Scala por separado o si Go reúne todo.
