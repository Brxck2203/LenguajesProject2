# Estadísticas de GameConsole (Scala)

Cómo calcula Scala las métricas de gato, memoria y Battleship, y cómo las expone para el panel. Los analizadores de los juegos del proyecto 1 (MMA, fútbol, motociclismo y Free Fire) siguen registrados.

## 1. Principios

- **Toda métrica se calcula en Scala.** La consola y el panel solo muestran lo que devuelve la API.
- **Se reconstruye el estado a partir de los eventos.** El tablero del gato, las cartas vistas en memoria y los disparos de Battleship se rehacen desde los eventos, así que las métricas no dependen de lo que el productor diga que pasó.
- **Final y parcial no se mezclan.** Un snapshot parcial nunca cuenta como partida analizada. Cuando llega el cierre, el resultado final reemplaza al parcial.
- **División por cero:** todo porcentaje con denominador 0 vale `0`, y todo promedio sin datos vale `null`.
- **Redondeo:** dos decimales.
- **Ganador:** el `winnerPlayerId` declarado en `MATCH_FINISHED` tiene prioridad. Si no viene, se infiere del juego. Una partida sin `MATCH_FINISHED` nunca tiene ganador.

Todas las partidas reciben además las métricas genéricas del proyecto 1: `durationSeconds`, `eventCount`, `actionsPerMinute`, `mostActivePlayer` y `activity` por jugador. También se agregan `finished` y `finishReason` en `matchStats`.

## 2. Gato — `TIC_TAC_TOE`

Las jugadas se cuentan solo con `MOVE_PLAYED`. `AI_DECISION` aporta los tiempos de la IA y **no** cuenta como una segunda jugada. Una jugada en una casilla ocupada o fuera de rango se descarta y se cuenta en `invalidMoves`.

**Por jugador**

| Métrica | Cálculo |
|---|---|
| `movesPlayed` | `MOVE_PLAYED` válidos del jugador |
| `symbol`, `isComputer` | Marca de su primera jugada; `isComputer` = tiene eventos `AI_DECISION` |
| `averageMoveSeconds` | Promedio del tiempo entre la jugada anterior (o el inicio) y la propia |
| `winningMoves` | Jugadas que completan una línea |
| `threatsBlocked` | Jugadas en la casilla donde el rival ganaba en su siguiente turno |
| `forksCreated` | Jugadas que dejan dos o más amenazas propias a la vez |
| `missedWins` | Jugadas hechas cuando había una victoria inmediata disponible y no se tomó |
| `result` | `WIN`, `LOSS`, `DRAW`, `ABANDONED` o `IN_PROGRESS` |
| Solo IA: `aiDecisions`, `averageDecisionMs`, `maxDecisionMs`, `averageLatencyMs`, `decisionKinds`, `algorithms` | Desde `AI_DECISION` (`durationMs` es el tiempo de Prolog; `latencyMs`, la ida y vuelta medida en la consola) |

**Por partida:** `totalMoves`, `invalidMoves`, `outcome` (`WIN`/`DRAW`/`ABANDONED`/`IN_PROGRESS`), `firstPlayer`, `openingPosition`, `winningLine`, `finalBoard`, `aiDecisionCount` y `aiAverageDecisionMs`.

**Ganador inferido:** el jugador cuya marca completa una línea en el tablero reconstruido.

**Patrones:** `WINNING_MOVE`, `BLOCKED_THREAT`, `FORK` y `MISSED_WIN`.

## 3. Memoria — `MEMORY`

`matched` lo decide la consola según la regla del juego. Scala lo compara con los símbolos de los `CARD_FLIPPED` y cuenta las contradicciones en `inconsistentAttempts`.

**Por jugador**

| Métrica | Cálculo |
|---|---|
| `attempts`, `pairsFound`, `misses` | `PAIR_ATTEMPTED` totales, con `matched=true` y con `matched=false` |
| `accuracyPct` | `pairsFound / attempts × 100` |
| `longestMatchStreak` | Máximo de aciertos consecutivos |
| `forgottenPairs` | Fallos en los que la pareja de la primera carta ya se había visto y seguía en la mesa |
| `luckyMatches` | Aciertos con dos cartas que no se habían visto nunca |
| `averageSecondsPerAttempt` | `durationSeconds / attempts` |
| `cardsFlipped`, `completed` | `CARD_FLIPPED` del jugador; `reason=COMPLETED` y todas las parejas encontradas |

**Por partida:** `pairs` (desde `MATCH_STARTED`), `pairsFound`, `attempts`, `accuracyPct`, `efficiencyPct` (`pairs / attempts × 100`, donde 100 es memoria perfecta), `inconsistentAttempts`, `completed` y `outcome`.

**Ganador inferido:** el único jugador, si completó el tablero. No se inventa un rival.

**Patrones:** `MATCH_STREAK` (3 o más aciertos seguidos) y `PERFECT_GAME` (sin fallos).

## 4. Battleship — `BATTLESHIP`

Los aciertos salen solo de `SHOT_FIRED` con `hit=true`. `SHIP_SUNK` suma barcos hundidos, nunca un acierto adicional.

**Por jugador:** `shotsFired`, `hits`, `misses`, `accuracyPct` (`hits / shotsFired × 100`), `longestHitStreak`, `shotsToFirstHit`, `shipsSunk`, `shipsLost`, `hitsReceived` y `repeatedShots` (disparos a una casilla ya atacada; debería ser 0).

**Por partida:** `boardSize`, `turns`, `totalShots`, `totalHits`, `overallAccuracyPct`, `shipsSunk`, `outOfTurnShots` (dos disparos seguidos del mismo jugador; debería ser 0), `repeatedShots` y `outcome`.

**Ganador inferido:** quien hundió más barcos, si la partida terminó, no fue abandonada y no hay empate.

**Patrones:** `HIT_STREAK` (3 o más aciertos seguidos) y `FLAWLESS_VICTORY` (el ganador no perdió barcos).

## 5. API (puerto 8080, CORS abierto)

| Ruta | Uso |
|---|---|
| `POST /analyze` | Lote de una partida cerrada (Go, igual que en el proyecto 1). Borra el snapshot parcial de esa partida |
| `POST /analyze/partial` | Snapshot de una partida en curso (Go) |
| `GET /stats/overview` | **Panel, estadísticas generales** |
| `GET /stats/games/{gameId}` | **Panel, estadísticas por juego:** finales y en curso por separado |
| `GET /stats/games` | Resumen de todos los juegos (solo finales) |
| `GET /stats/games/{gameId}/players` | Historial por jugador |
| `GET /results`, `GET /results/{matchId}` | Resultados finales |
| `GET /partial`, `GET /partial/{matchId}` | Snapshots en curso |

### `POST /analyze/partial`

Mismo cuerpo que `/analyze` (`matchId`, `gameId` y `events` acumulados desde `MATCH_STARTED`), más un campo `revision` opcional.

- Exige `MATCH_STARTED` y **rechaza** `MATCH_FINISHED` con un 400: la partida cerrada va a `/analyze`.
- `revision` es un entero positivo. Si no se manda, se usa la cantidad de eventos, que crece porque Go envía el acumulado.
- Una revisión mayor que la guardada responde **200** y reemplaza el snapshot.
- La misma revisión responde **200** con `Idempotent-Replay: true`, sin recalcular.
- Una revisión menor responde **409** con `{ "stale": true, "currentRevision": n }`, así un snapshot viejo nunca sobrescribe uno nuevo.
- Si la partida ya tiene resultado final responde **409** con `{ "finalized": true }`.

Respuesta 200:

```json
{ "matchId": "…", "gameId": "MEMORY", "revision": 7, "updatedAt": "…", "partial": true,
  "result": { "playerStats": { … }, "matchStats": { "finished": false, "winner": null, … }, "patterns": [ … ] } }
```

### `GET /stats/overview`

```json
{
  "totals": { "matchesAnalyzed": 12, "matchesInProgress": 2, "totalEvents": 340,
              "averageDurationSeconds": 48.5, "distinctPlayers": 4 },
  "byGame": [
    { "gameId": "TIC_TAC_TOE", "supported": true, "matchesAnalyzed": 5, "matchesInProgress": 1,
      "totalEvents": 120, "averageDurationSeconds": 30.2, "outcomes": { "WIN": 2, "DRAW": 3 } },
    { "gameId": "MEMORY", … }, { "gameId": "BATTLESHIP", … }
  ],
  "topPlayers": [ { "playerId": "PROLOG_AI", "wins": 2 } ]
}
```

Los tres juegos de la consola aparecen siempre en `byGame`, aunque todavía no tengan partidas.

### `GET /stats/games/{gameId}`

```json
{
  "gameId": "TIC_TAC_TOE",
  "final": { "matchesAnalyzed": 5, "averageDurationSeconds": 30.2, "outcomes": { … },
             "patternCounts": { "BLOCKED_THREAT": 9 }, "topWinners": [ … ],
             "matchStatsAverages": { "totalMoves": 7.4, "aiAverageDecisionMs": 6.1, … } },
  "live": { "matchesInProgress": 1, "matchStatsTotals": { … }, "matchStatsAverages": { … } },
  "liveMatches": [ { "matchId": "…", "revision": 4, "updatedAt": "…", "matchStats": { … } } ]
}
```

`matchStatsAverages` promedia **todos** los campos numéricos de `matchStats` de ese juego, sin conocer sus nombres. Por eso el panel puede mostrar, por ejemplo, el `accuracyPct` promedio de memoria o el `aiAverageDecisionMs` del gato sin calcular nada.

## 6. Conteo de instancias

Las partidas **iniciadas, activas y cerradas** las cuenta **Go**, porque es quien recibe todos los eventos, incluidos los de partidas que nunca se cierran. Scala solo conoce las partidas que analizó: finales y snapshots en curso.

## 7. Pruebas

```sh
cd scala_service
sbt test     # 51 pruebas: las del proyecto 1 + GameConsoleSuite + LiveApiSuite
```

`GameConsoleSuite` usa partidas armadas a mano con los valores esperados calculados de antemano: victoria, empate con cuatro bloqueos, victoria desaprovechada, bifurcación, parejas olvidadas, aciertos por suerte, disparos repetidos y fuera de turno, y división por cero. `LiveApiSuite` cubre revisiones viejas, idempotencia, el reemplazo del parcial por el final y la separación entre finales y en curso.
