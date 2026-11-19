# Integración de Brack

Este documento conserva la distribución de trabajo y el estado de la implementación. La nota anterior sobre paquetes Go ausentes ya no aplica: `origin/main` contiene `internal/processing`, `dashboard`, `inbox`, `match` y `scala`; esta rama amplía la base existente sin copiar ni reemplazar esos paquetes.

| Bloque | Entrega | Estado |
|---|---|---|
| B1 | Consola web Vite/TypeScript, sesiones independientes y panel | Implementado |
| B2 | Memoria: 12 cartas, 6 parejas, un jugador | Implementado |
| B3 | Battleship: tablero 6 × 6, barcos 3/2/2 y CPU | Implementado |
| B4 | Publicación ordenada por partida, reintentos y conciliación de 409 | Implementado |
| B5 | Catálogo de juegos, conteos Go y snapshots parciales hacia Scala | Implementado |
| B6 | Panel de conteos Go y métricas Scala finales/en curso | Implementado |
| B7 | Compose, instalación, smoke test y CI de los cuatro servicios | Implementado; validar con el pipeline del PR |

## Decisiones de integración

- Los juegos implementan `GameSession` y comparten el sobre de ocho campos de `docs/contratos.md`.
- El `EventPublisher` conserva el mismo `eventId` en reintentos. Un `409` solo se considera éxito si `GET /matches/{matchId}/events/{eventId}` confirma el evento original.
- Go envía a Scala snapshots completos con revisión creciente, como máximo una vez por segundo y partida. Los fallos quedan en logs y se vuelve a intentar con el siguiente evento; los `409 stale` y `finalized` son respuestas esperadas.
- Go es dueño de los conteos de instancias. Scala es dueño de las métricas de juego; la UI solo presenta respuestas de ambas APIs.
- El Compose de desarrollo levanta consola, Prolog, Go y Scala. El instalador realiza el smoke test de consola, IA Prolog, conteos y ciclo de snapshot parcial/final.

## Verificación local

```sh
cd games
npm ci
npm run typecheck
npm test
npm run build

cd ../go_service
go vet ./...
go test -race -count=1 ./...
go build ./...

cd ../scala_service
sbt -batch test

cd ..
docker compose up -d --build --wait
bash scripts/smoke-test.sh
```

Los conteos guardados por Go se reinician al reiniciar el proceso. Los resultados finales de Scala se guardan en `data/results`; los snapshots parciales corresponden solo a partidas en curso.
