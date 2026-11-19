:- encoding(utf8).
/*  Pruebas del servicio Prolog.

    Ejecutar desde prolog_service/:
        swipl -g run_tests -t halt tests/test_tictactoe.pl
*/
:- use_module(library(plunit)).
:- use_module(library(lists)).
:- use_module(library(apply)).
:- use_module('../tictactoe').
:- use_module('../api').

% Tablero a partir de una cadena de 9 caracteres: x, o o '.' para vacía.
b(String, Board) :-
    string_chars(String, Chars),
    maplist(char_cell, Chars, Board).
char_cell(x, x).
char_cell(o, o).
char_cell('.', e).

:- begin_tests(rules).

test(eight_lines) :-
    findall(A-B-C, tictactoe:line(A, B, C), Lines),
    length(Lines, 8).
test(winner_row) :- b("xxxoo....", B), winner(B, x).
test(winner_column) :- b("ox.ox.o..", B), winner(B, o).
test(winner_diagonal) :- b("x.o.xo..x", B), winner(B, x).
test(winner_anti_diagonal) :- b("xxo.o.o..", B), winner(B, o).
test(no_winner, [fail]) :- b("xo.ox....", B), winner(B, _).
test(occupied_cell_rejected, [fail]) :- b("x........", B), apply_move(B, 0, o, _).
test(draw_is_full) :- b("xoxxoooxx", B), full(B), \+ winner(B, _).

:- end_tests(rules).

:- begin_tests(validation).

test(ok) :- b("x........", B), validate_state(B, o, ok).
test(either_player_may_start) :-
    b(".........", B), validate_state(B, x, ok), validate_state(B, o, ok).
test(wrong_turn) :- b("x........", B), validate_state(B, x, error('INVALID_TURN')).
test(bad_turn_symbol) :- b(".........", B), validate_state(B, z, error('INVALID_TURN')).
test(impossible_counts) :- b("xx.......", B), validate_state(B, o, error('INVALID_BOARD')).
test(short_board) :- validate_state([x, o], x, error('INVALID_BOARD')).
test(game_over_win) :- b("xxxoo....", B), validate_state(B, o, error('GAME_OVER')).
test(game_over_full) :- b("xoxxoooxx", B), validate_state(B, o, error('GAME_OVER')).

:- end_tests(validation).

:- begin_tests(ai).

% Gana si puede, aunque también podría bloquear.
test(takes_win, [true(P-K == 2-'WIN')]) :-
    b("oo.xx....", B), best_move(B, o, P, _), decision_kind(B, o, P, K).
test(win_over_block, [true(P == 5)]) :-
    b("xx.oo...x", B), best_move(B, o, P, _).
% Bloquea la amenaza del rival.
test(blocks, [true(P-K == 2-'BLOCK')]) :-
    b("xx..o....", B), best_move(B, o, P, _), decision_kind(B, o, P, K).
test(blocks_column, [true(P == 6)]) :-
    b("x..xo....", B), best_move(B, o, P, _).
test(blocks_diagonal, [true(P == 8)]) :-
    b("x.o.x....", B), best_move(B, o, P, _).
% Abre en el centro con el tablero vacío.
test(opens_center, [true(P == 4)]) :-
    b(".........", B), best_move(B, x, P, _).
% Contra una esquina responde en el centro (la única respuesta que no pierde).
test(answers_corner_with_center, [true(P == 4)]) :-
    b("x........", B), best_move(B, o, P, _).
test(returns_empty_cell) :-
    b("xoxo.....", B), best_move(B, x, P, _), nth0(P, B, e).

% La IA juega contra todas las secuencias posibles del humano y nunca pierde.
test(never_loses_as_second_player) :-
    b(".........", B), forall(game_outcome(B, x, o, R), R \== lost).
test(never_loses_as_first_player) :-
    b(".........", B), forall(game_outcome(B, o, o, R), R \== lost).
% La IA contra sí misma siempre empata.
test(self_play_draws) :-
    b(".........", B), self_play(B, x, R), R == draw.

:- end_tests(ai).

:- begin_tests(api).

test(move_ok) :-
    move_response(_{board: ["X","X","","","O","","","",""], turn: "O"}, S, Out),
    S == 200, Out.position == 2, Out.row == 0, Out.col == 2,
    Out.symbol == 'O', Out.kind == 'BLOCK'.
test(null_and_lowercase_cells) :-
    move_response(_{board: ["x",null,"","","","","","",""], turn: "o"}, 200, Out),
    Out.position == 4.
test(invalid_board) :-
    move_response(_{board: ["X","Z","","","","","","",""], turn: "O"}, 400, Out),
    Out.error == 'INVALID_BOARD'.
test(missing_board) :-
    move_response(_{turn: "O"}, 400, Out), Out.error == 'INVALID_BOARD'.
test(missing_turn) :-
    move_response(_{board: ["","","","","","","","",""]}, 400, Out),
    Out.error == 'INVALID_TURN'.
test(game_over) :-
    move_response(_{board: ["X","X","X","O","O","","","",""], turn: "O"}, 400, Out),
    Out.error == 'GAME_OVER'.

:- end_tests(api).

%!  game_outcome(+Board, +ToMove, +Ai, -Result) is nondet.
%   Enumera todas las partidas en que el humano prueba cada casilla libre
%   y la IA responde con best_move/4. Result es won, lost o draw para la IA.
game_outcome(Board, _, Ai, Result) :-
    winner(Board, W), !,
    ( W == Ai -> Result = won ; Result = lost ).
game_outcome(Board, _, _, draw) :-
    full(Board), !.
game_outcome(Board, ToMove, Ai, Result) :-
    (   ToMove == Ai
    ->  best_move(Board, Ai, P, _)
    ;   legal_moves(Board, Moves), member(P, Moves)
    ),
    apply_move(Board, P, ToMove, Next),
    opponent(ToMove, Other),
    game_outcome(Next, Other, Ai, Result).

self_play(Board, _, Result) :-
    winner(Board, W), !, Result = won(W).
self_play(Board, _, draw) :-
    full(Board), !.
self_play(Board, P, Result) :-
    best_move(Board, P, Pos, _),
    apply_move(Board, Pos, P, Next),
    opponent(P, O),
    self_play(Next, O, Result).
