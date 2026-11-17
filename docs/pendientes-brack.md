# Pendientes para Brack

Lo de Gabriel ya está hecho y probado. Lo que sigue necesita tus partes (consola, Go, Docker y CI) para integrarse. Están en orden de prioridad: los primeros desbloquean todo lo demás.

Todo lo que se menciona aquí está en el PR **Brxck2203/LenguajesProject2#1** (rama `feature/tictactoe-prolog`). El contrato completo está en [`docs/contratos.md`](contratos.md) y las estadísticas en [`docs/estadisticas.md`](estadisticas.md).

## Lo que ya está listo (Gabriel)

| Pieza | Dónde | Pruebas |
|---|---|---|
| IA del gato en Prolog (minimax + alfa-beta), HTTP con CORS, Dockerfile | `prolog_service/` | 33, incluida una que juega todas las secuencias posibles sin perder |
| Lógica del gato con clases, interfaz `GameSession`, fábrica de eventos | `games/shared/`, `games/tictactoe/src/` | 20, incluidas 20 partidas contra el Prolog real |
| Vista del gato con `mount(container)` y demo sin consola | `TicTacToeView.ts`, `games/tictactoe/demo/` | 6, y probada en el navegador con dos partidas a la vez |
| Analizadores Scala de gato, memoria y Battleship | `scala_service/.../games/` | 15 casos calculados a mano |
| API del panel: `/stats/overview`, `/stats/games/{id}`, `/analyze/partial`, `/partial` | `scala_service/.../server/` | 7, y probada por HTTP |

## 1. Arreglar el Go de `main` · urgente

`go build ./...` falla porque la copia del proyecto 1 quedó incompleta. Faltan estos paquetes:

- `internal/processing`
- `internal/dashboard`
- `internal/inbox`
- `internal/match`
- `internal/scala`

Copialos desde LenguajesProject1. El `go.mod` todavía dice `module github.com/Brxck2203/LenguajesProject1/go_service`; si lo renombrás, actualizá también los imports.

## 2. Catálogo de eventos · urgente

1. Pegá el bloque de la sección 4 de `docs/contratos.md` en `go_service/internal/validation/event_catalog.json`.
2. Agregá `"pairs": "positiveInteger"` y `"boardSize": "positiveInteger"` en `lifecycle.MATCH_STARTED.optional`.
3. Si querés, sacá MMA, fútbol, motos y Free Fire del catálogo. Scala los sigue soportando, así que no se rompe nada.

## 3. Consola (B1)

- **Proyecto:** crear el proyecto Vite + TypeScript, por ejemplo en `console/`, y clonar el repo en una ruta **sin `#`**.
- **Gato:** importar desde `games/tictactoe/src` y montarlo como en la sección 3 de `docs/contratos.md`. La demo en `games/tictactoe/demo/main.ts` es el ejemplo exacto.
- **Prolog:** definir `VITE_PROLOG_URL` (por defecto `http://localhost:8082`).
- **Varias partidas:** cada partida tiene su sesión y su vista, en la misma pestaña o en pestañas distintas.
- **Abandono:** al cerrar la pestaña (`beforeunload`) o al quitar una partida, llamar a `session.abandon()`.
- **Jugador:** un `humanPlayerId` estable por navegador, por ejemplo guardado en `localStorage`.
- **Tema visual (opcional):** definir las variables `--console-*` para que el gato use los colores de la consola.

## 4. EventPublisher (B4)

Implementa `EventSink` de `games/shared/GameEvent.ts`; los juegos solo llaman a `publish(event)`.

- **Envío:** `POST` a Go `/events` o `/events/batch`.
- **Orden y paralelismo:** una cola por `matchId` conserva el orden de cada partida, y las colas de partidas distintas avanzan en paralelo.
- **Reintentos:** con el **mismo `eventId`**. Si llega un 409, conciliar en vez de asumir que fue éxito.
- **Errores:** mostrar los fallos en la consola sin bloquear el juego.

## 5. Memoria y Battleship (B2, B3)

- **Interfaz:** implementar `GameSession` (`games/shared/GameSession.ts`). Podés usar `MatchEventFactory` y `Listeners` igual que `TicTacToeSession`.
- **Eventos:** enviar exactamente los de la sección 4 de `docs/contratos.md`, porque Scala ya los analiza con esos nombres y campos:
  - **Memoria:** `CARD_FLIPPED` ×2 y después `PAIR_ATTEMPTED` (con `matched` según la regla); `pairs` en `MATCH_STARTED`.
  - **Battleship:** `SHOT_FIRED` en cada disparo; si hunde un barco, además `SHIP_SUNK`; `boardSize` en `MATCH_STARTED`; la computadora usa `playerId = "CPU"`.
  - **Cierre:** `MATCH_FINISHED` con `reason` y `winnerPlayerId`, una sola vez.

## 6. Go para el panel (B5)

- **Conteo de instancias:** `GET /stats/instances` con iniciadas, activas, cerradas y abandonadas, globales y por juego. El formato propuesto está en la sección 6 de `docs/contratos.md`.
- **Análisis parcial:** reenviar a Scala `POST /analyze/partial` los snapshots de las partidas abiertas, como máximo uno por segundo por partida, con `revision` = cantidad de eventos. Un 409 se ignora.
- **CORS:** abrir CORS en esas rutas si el panel consulta Go desde `localhost:5173`.

## 7. Panel (B6)

Consulta cada 2 segundos, sin calcular métricas:

| Sección del panel | Ruta |
|---|---|
| Instancias por juego | Go `GET /stats/instances` |
| Estadísticas generales | Scala `GET /stats/overview` |
| Estadísticas por juego (finales / en curso) | Scala `GET /stats/games/{gameId}` |
| Detalle de partida | Scala `GET /results/{matchId}` o `GET /partial/{matchId}` |

Hay que mostrar por separado las finales y las en curso, la hora de la última actualización y los errores de conexión.

## 8. Docker y CI (B7)

Servicio para el `docker-compose.yml`:

```yaml
  prolog-service:
    build:
      context: ./prolog_service
      args:
        SKIP_TESTS: ${SKIP_TESTS:-false}
    container_name: gameconsole-prolog
    ports:
      - "${PROLOG_PORT:-8082}:8082"
    restart: unless-stopped
```

La imagen ya trae `HEALTHCHECK` y corre las pruebas Prolog al construirse.

Pasos para el pipeline:

```sh
# Prolog
docker build prolog_service
# Scala
cd scala_service && sbt test
# Juegos (TypeScript)
cd games && npm ci && npm run typecheck && npm test
```

## 9. Para revisar juntos

- [ ] Aprobar o cambiar las propuestas marcadas en `docs/contratos.md` (interfaz, eventos de memoria y Battleship, `/stats/instances`, snapshots parciales).
- [ ] Prueba conjunta: dos partidas abiertas y una terminada; verificar que el panel cambia antes de cerrarlas.
- [ ] Fusionar el PR #1 cuando lo revises.
