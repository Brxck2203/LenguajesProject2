# Lógica de los juegos

Clases TypeScript de cada juego, sin vista ni dependencias del navegador más allá de `fetch` y `crypto.randomUUID`. La consola (Vite) importa desde aquí y monta la vista.

| Carpeta | Contenido |
|---|---|
| `shared/` | `GameSession` (interfaz común), `GameEvent` y `MatchEventFactory` (sobre de GameStats) |
| `tictactoe/` | Gato contra la computadora con IA en Prolog |

## Gato

| Clase | Responsabilidad |
|---|---|
| `Board` | Casillas 0–8; rechaza casillas ocupadas |
| `Rules` | Ocho líneas ganadoras y empate |
| `Player` → `HumanPlayer`, `PrologPlayer` | Id y marca; `PrologPlayer` delega la decisión en un `MoveAdvisor` |
| `PrologClient` | `POST /move` al servicio Prolog, con tiempo de espera y errores tipados |
| `TicTacToeSession` | Una partida: turnos, estados, eventos y cierre único |

Uso desde la consola:

```ts
import { TicTacToeSession, PrologClient } from '../games/tictactoe/src';

const session = new TicTacToeSession({
  humanPlayerId,                                   // id estable del jugador
  advisor: new PrologClient('http://localhost:8082'),
  events: eventPublisher,                          // implementa EventSink.publish(event)
});
session.subscribe(render);                         // se llama en cada cambio de estado
session.start();
session.applyAction({ type: 'PLACE', position: 4 });
session.applyAction({ type: 'RETRY_AI' });         // solo en estado AI_ERROR
session.abandon();                                 // al cerrar o reiniciar
```

Estados: `NOT_STARTED` → `HUMAN_TURN` ⇄ `AI_THINKING` → `FINISHED`. Si Prolog no responde, la partida pasa a `AI_ERROR` con el mensaje en `state.error`, no hace ninguna jugada aleatoria y espera `RETRY_AI`. Solo esa partida queda esperando; las demás siguen normalmente.

## Pruebas

```sh
npm install
npm test                                   # reglas, sesión y cliente (Prolog simulado)
PROLOG_URL=http://localhost:8082 npm test  # además, 20 partidas contra el servicio Prolog real
```

> **Ojo:** Vite y Vitest fallan si la ruta del proyecto contiene `#` (por ejemplo `Proyecto #2`). Hay que clonar el repo en una carpeta sin ese carácter.
