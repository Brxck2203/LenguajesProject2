# GameConsole: juegos TypeScript

Las sesiones de juego son clases independientes que implementan `GameSession`. La interfaz usa TypeScript + Vite, sin framework pesado; los servicios Go, Scala y Prolog se pueden levantar juntos con Docker Compose desde la raíz.

| Carpeta | Contenido |
|---|---|
| `shared/` | Contratos `GameSession`/`GameEvent`, fábrica de eventos y `EventPublisher` |
| `tictactoe/` | Gato contra Prolog |
| `memory/` | Memoria de 12 cartas y 6 parejas |
| `battleship/` | Battleship 6 × 6 contra CPU, con barcos 3/2/2 |
| `console/` | Consola web y panel que consume Go y Scala |

Cada partida tiene su propio `matchId`, estado y vista. Al cerrar una partida se envía `MATCH_FINISHED`; los eventos se ordenan por partida, se reintentan con el mismo `eventId` y los errores de entrega aparecen en la consola.

## Ejecutar

Desde la raíz del proyecto:

```sh
docker compose up -d --build --wait
```

Abre <http://localhost:5173>. La consola obtiene los eventos en Go, el análisis en Scala y las jugadas del Gato en Prolog.

Para ejecutar solo el frontend durante el desarrollo, con los servicios disponibles:

```sh
cd games
npm ci
npm run console
```

La consola usa `VITE_GO_URL`, `VITE_SCALA_URL` y `VITE_PROLOG_URL`, con valores predeterminados `http://localhost:8081`, `http://localhost:8080` y `http://localhost:8082`. Docker configura estas direcciones en tiempo de ejecución para que también funcionen con puertos personalizados.

## Pruebas y compilación

```sh
cd games
npm ci
npm run typecheck
npm test
npm run build
```

Las pruebas cubren reglas, estado aislado, eventos, reintentos y conciliación del `EventPublisher`, vistas y el panel. Para probar además el cliente real de Prolog, levanta los servicios con Compose y ejecuta:

```sh
PROLOG_URL=http://localhost:8082 npm test
```

> **Nota:** Vite y Vitest fallan si la ruta del repositorio contiene `#`; trabaja en una ruta sin ese carácter.
