# Servicio Prolog: IA del gato

Calcula la jugada de la computadora en el gato con **minimax (negamax) y poda alfa-beta**, implementado en SWI-Prolog. La consola web le envía el tablero y el turno, y aplica la posición que recibe.

| Archivo | Contenido |
|---|---|
| `tictactoe.pl` | Reglas (líneas ganadoras, empate, validación) y minimax |
| `api.pl` | Traducción entre el JSON de `/move` y las reglas |
| `server.pl` | Servidor HTTP, CORS y `/health` |
| `tests/test_tictactoe.pl` | Pruebas de reglas, validación, IA y API |

## Ejecutar

Con SWI-Prolog instalado, desde `prolog_service/`:

```sh
swipl server.pl                                  # escucha en el puerto 8082 (variable PORT)
swipl -g run_tests -t halt tests/test_tictactoe.pl
```

Con Docker:

```sh
docker build -t gameconsole/prolog-service prolog_service
docker run --rm -p 8082:8082 gameconsole/prolog-service
```

## Contrato

### `POST /move`

Casillas por filas, índices 0 a 8 (`fila = posición / 3`, `columna = posición % 3`). Cada casilla es `"X"`, `"O"` o `""` (también se acepta `null`). `turn` es el símbolo de la computadora.

```json
{ "board": ["X","X","", "","O","", "","",""], "turn": "O" }
```

Respuesta `200`:

```json
{
  "position": 2, "row": 0, "col": 2, "symbol": "O",
  "algorithm": "minimax-alphabeta",
  "kind": "BLOCK",
  "score": 0,
  "durationMs": 0
}
```

- `kind`: `WIN` (gana con esta jugada), `BLOCK` (impide que el rival gane en su próximo turno) o `SEARCH` (la eligió la búsqueda sin amenaza inmediata).
- `score`: valor minimax para la computadora: `10 - d` si gana en `d` jugadas, `d - 10` si pierde y `0` si es empate con juego perfecto.
- `durationMs`: tiempo de cálculo, para el evento `AI_DECISION`.

Respuesta `400` con `{ "error": "<código>", "message": "..." }`:

| Código | Cuándo |
|---|---|
| `INVALID_JSON` | El cuerpo no es JSON |
| `INVALID_BOARD` | No hay 9 casillas válidas, o la diferencia entre X y O es mayor que 1 |
| `INVALID_TURN` | `turn` no es X/O o no le toca según las marcas (cualquiera puede abrir la partida) |
| `GAME_OVER` | Ya hay ganador o el tablero está lleno |

El servicio nunca responde con una jugada aleatoria. Si falla o no responde, la consola debe mostrar el error en esa partida y permitir reintentar.

### `GET /health`

`{"status":"ok","service":"prolog-tictactoe"}`

## Cómo decide

1. **Validación** (`validate_state/3`): rechaza tableros imposibles, turnos que no corresponden y partidas terminadas.
2. **Búsqueda** (`best_move/4`): prueba cada casilla libre y evalúa la respuesta óptima del rival de forma recursiva hasta el final de la partida. Desde el punto de vista de quien mueve:
   - ganar en la profundidad `d` vale `10 - d`, así que ganar antes vale más;
   - perder vale `d - 10`, así que perder más tarde es menos malo;
   - empatar vale `0`.
3. **Poda alfa-beta**: descarta ramas que el rival nunca permitiría, sin cambiar el resultado. Un tablero vacío se resuelve en unos 40 ms.
4. **Desempate**: entre jugadas con el mismo valor se prefiere centro, esquinas y lados, en ese orden. La decisión es determinista y se puede reproducir en la demostración.

Como el árbol se explora completo, la computadora gana si puede, bloquea toda amenaza y nunca pierde. Las pruebas `never_loses_*` lo comprueban jugando contra **todas** las secuencias posibles del humano, empiece quien empiece.

Cada petición se atiende en un hilo propio del servidor (`workers(8)`), así que una partida que espera a la IA no bloquea a las demás.
