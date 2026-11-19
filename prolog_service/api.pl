:- encoding(utf8).
/*  Traducción entre el JSON de /move y las reglas de tictactoe.pl.
    No depende del servidor HTTP, así que se prueba directamente.
*/
:- module(api, [move_response/3, error_reply/3]).

:- use_module(library(lists)).
:- use_module(library(apply)).
:- use_module(tictactoe).

%!  move_response(+In:dict, -Status, -Out:dict) is det.
%   Separado del transporte HTTP para poder probarlo sin servidor.
move_response(In, Status, Out) :-
    (   parse_request(In, Board, Turn)
    ->  validate_state(Board, Turn, Validation),
        (   Validation == ok
        ->  decide(Board, Turn, Out), Status = 200
        ;   Validation = error(Code),
            error_reply(Code, Status, Out)
        )
    ;   error_reply('INVALID_BOARD', Status, Out)
    ).

decide(Board, Turn, Out) :-
    get_time(T0),
    best_move(Board, Turn, Pos, Score),
    decision_kind(Board, Turn, Pos, Kind),
    get_time(T1),
    Duration is round((T1 - T0) * 1000),
    Row is Pos // 3,
    Col is Pos mod 3,
    upcase_atom(Turn, Symbol),
    Out = _{ position: Pos, row: Row, col: Col, symbol: Symbol,
             algorithm: "minimax-alphabeta", kind: Kind,
             score: Score, durationMs: Duration }.

parse_request(In, Board, Turn) :-
    is_dict(In),
    get_dict(board, In, Cells),
    is_list(Cells),
    maplist(json_cell, Cells, Board),
    (   get_dict(turn, In, T), json_symbol(T, Turn)
    ->  true
    ;   Turn = invalid                    % validate_state lo reporta como INVALID_TURN
    ).

json_cell(V, e) :- V == null, !.
json_cell(V, C) :-
    text(V),
    string_upper(V, U),
    (   U == "" -> C = e
    ;   U == "X" -> C = x
    ;   U == "O" -> C = o
    ).

json_symbol(V, S) :-
    text(V),
    string_upper(V, U),
    (   U == "X" -> S = x
    ;   U == "O" -> S = o
    ).

text(V) :- string(V), !.
text(V) :- atom(V), V \== null, V \== true, V \== false.

error_reply(Code, 400, _{error: Code, message: Message}) :-
    error_message(Code, Message).

error_message('INVALID_JSON',  "El cuerpo debe ser JSON válido").
error_message('INVALID_BOARD', "board debe tener 9 casillas con \"X\", \"O\" o \"\" y diferencia de marcas de a lo sumo 1").
error_message('INVALID_TURN',  "turn debe ser \"X\" u \"O\" y corresponder a la cantidad de marcas").
error_message('GAME_OVER',     "La partida ya terminó: hay ganador o el tablero está lleno").
