:- encoding(utf8).
/*  Servicio HTTP de la IA del gato.

    POST /move    calcula la jugada de la computadora (ver README.md)
    GET  /health  estado del servicio

    Puerto: variable de entorno PORT (por defecto 8082).
    CORS abierto para que la consola web lo llame directamente desde el navegador.
    Cada petición se atiende en su propio hilo, así que una partida que espera
    a la IA no bloquea a las demás.
*/
:- use_module(library(http/thread_httpd)).
:- use_module(library(http/http_dispatch)).
:- use_module(library(http/http_json)).
:- use_module(library(http/http_cors)).
:- use_module(library(settings)).
:- use_module(library(lists)).
:- use_module(api).

:- initialization(main, main).

:- set_setting(http:cors, [*]).

:- http_handler(root(move), handle_move, [methods([post, options])]).
:- http_handler(root(health), handle_health, [methods([get, options])]).

main :-
    (   getenv('PORT', P), atom_number(P, Port) -> true ; Port = 8082 ),
    http_server(http_dispatch, [port(Port), workers(8)]),
    format(user_error, "Prolog tic-tac-toe service listening on port ~w~n", [Port]),
    thread_get_message(_).               % mantiene vivo el proceso

handle_health(Request) :-
    preflight(Request), !.
handle_health(_) :-
    cors_enable,
    reply_json_dict(_{status: "ok", service: "prolog-tictactoe"}).

handle_move(Request) :-
    preflight(Request), !.
handle_move(Request) :-
    cors_enable,
    (   catch(http_read_json_dict(Request, In), _, fail)
    ->  move_response(In, Status, Out)
    ;   error_reply('INVALID_JSON', Status, Out)
    ),
    reply_json_dict(Out, [status(Status)]).

preflight(Request) :-
    memberchk(method(options), Request),
    cors_enable(Request, [methods([get, post, options])]),
    format("~n").
