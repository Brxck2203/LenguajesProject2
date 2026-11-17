:- encoding(utf8).
/*  Reglas del gato (tic-tac-toe) y decisión de la computadora.

    Representación del tablero: lista de 9 casillas indexadas de 0 a 8,
    por filas (fila = Pos // 3, columna = Pos mod 3). Cada casilla es
    x, o o e (vacía).

    La jugada se elige con minimax en forma negamax con poda alfa-beta.
    Puntaje desde el punto de vista de quien mueve:
        ganar en la profundidad D  ->  10 - D   (ganar antes vale más)
        perder en la profundidad D ->  D - 10   (perder después es menos malo)
        empate                     ->  0
    Como se explora el árbol completo, la computadora gana si puede,
    bloquea toda amenaza y nunca pierde. Ante varias jugadas con el mismo
    puntaje se prefiere el orden centro, esquinas y lados, lo que hace la
    decisión determinista y fácil de explicar.
*/
:- module(tictactoe,
          [ validate_state/3,   % +Board, +Turn, -Result
            best_move/4,        % +Board, +Player, -Pos, -Score
            decision_kind/4,    % +Board, +Player, +Pos, -Kind
            winner/2,           % +Board, ?Player
            full/1,             % +Board
            legal_moves/2,      % +Board, -Moves
            apply_move/4,       % +Board, +Pos, +Player, -NewBoard
            opponent/2          % ?Player, ?Opponent
          ]).

:- use_module(library(lists)).
:- use_module(library(apply)).

%!  line(?A, ?B, ?C) is nondet.
%   Las ocho líneas ganadoras: tres filas, tres columnas y dos diagonales.
line(0, 1, 2).
line(3, 4, 5).
line(6, 7, 8).
line(0, 3, 6).
line(1, 4, 7).
line(2, 5, 8).
line(0, 4, 8).
line(2, 4, 6).

opponent(x, o).
opponent(o, x).

symbol(x).
symbol(o).

cell(x).
cell(o).
cell(e).

%!  winner(+Board, ?Player) is semidet.
winner(Board, Player) :-
    line(A, B, C),
    nth0(A, Board, Player),
    Player \== e,
    nth0(B, Board, Player),
    nth0(C, Board, Player),
    !.

%!  full(+Board) is semidet.
full(Board) :-
    \+ memberchk(e, Board).

%   Orden de exploración: centro, esquinas y lados.
preferred_order([4, 0, 2, 6, 8, 1, 3, 5, 7]).

%!  legal_moves(+Board, -Moves) is det.
legal_moves(Board, Moves) :-
    preferred_order(Order),
    include(empty_at(Board), Order, Moves).

empty_at(Board, Pos) :-
    nth0(Pos, Board, e).

%!  apply_move(+Board, +Pos, +Player, -NewBoard) is semidet.
%   Falla si la casilla no está vacía.
apply_move(Board, Pos, Player, NewBoard) :-
    nth0(Pos, Board, e, Rest),
    nth0(Pos, NewBoard, Player, Rest).

count(Board, Symbol, N) :-
    include(==(Symbol), Board, Matches),
    length(Matches, N).

%!  validate_state(+Board, +Turn, -Result) is det.
%   Result es ok o error(Code). Los códigos son:
%     INVALID_BOARD  forma o contenido imposible
%     INVALID_TURN   el turno no corresponde a la cantidad de marcas
%     GAME_OVER      ya hay ganador o el tablero está lleno
validate_state(Board, _, error('INVALID_BOARD')) :-
    \+ well_formed(Board), !.
validate_state(_, Turn, error('INVALID_TURN')) :-
    \+ symbol(Turn), !.
validate_state(Board, _, error('INVALID_BOARD')) :-
    count(Board, x, X), count(Board, o, O),
    abs(X - O) > 1, !.
validate_state(Board, _, error('GAME_OVER')) :-
    ( winner(Board, _) ; full(Board) ), !.
validate_state(Board, Turn, error('INVALID_TURN')) :-
    count(Board, x, X), count(Board, o, O),
    \+ turn_matches(X, O, Turn), !.
validate_state(_, _, ok).

well_formed(Board) :-
    is_list(Board),
    length(Board, 9),
    maplist(cell, Board).

%   Cualquiera de los dos puede abrir la partida; después se alternan.
turn_matches(N, N, _).
turn_matches(X, O, o) :- X =:= O + 1.
turn_matches(X, O, x) :- O =:= X + 1.

%!  best_move(+Board, +Player, -Pos, -Score) is semidet.
%   Requiere un estado validado con al menos una casilla libre.
best_move(Board, Player, Pos, Score) :-
    legal_moves(Board, Moves),
    Moves \== [],
    root(Moves, Board, Player, -1000, 1000, none, -1001, Pos, Score).

root([], _, _, _, _, Pos, Score, Pos, Score).
root([M|Ms], Board, Player, Alpha, Beta, Pos0, Score0, Pos, Score) :-
    apply_move(Board, M, Player, Next),
    opponent(Player, Opp),
    NAlpha is -Beta,
    NBeta is -Alpha,
    negamax(Next, Opp, 1, NAlpha, NBeta, S0),
    S is -S0,
    (   S > Score0
    ->  Pos1 = M, Score1 = S
    ;   Pos1 = Pos0, Score1 = Score0
    ),
    Alpha1 is max(Alpha, S),
    root(Ms, Board, Player, Alpha1, Beta, Pos1, Score1, Pos, Score).

%!  negamax(+Board, +Player, +Depth, +Alpha, +Beta, -Score) is det.
%   Score es el valor de Board para Player, que tiene el turno.
negamax(Board, Player, Depth, Alpha, Beta, Score) :-
    opponent(Player, Opp),
    (   winner(Board, Opp)
    ->  Score is Depth - 10
    ;   full(Board)
    ->  Score = 0
    ;   legal_moves(Board, Moves),
        Depth1 is Depth + 1,
        search(Moves, Board, Player, Depth1, Alpha, Beta, -1000, Score)
    ).

search([], _, _, _, _, _, Best, Best).
search([M|Ms], Board, Player, Depth, Alpha, Beta, Best0, Best) :-
    apply_move(Board, M, Player, Next),
    opponent(Player, Opp),
    NAlpha is -Beta,
    NBeta is -Alpha,
    negamax(Next, Opp, Depth, NAlpha, NBeta, S0),
    S is -S0,
    Best1 is max(Best0, S),
    Alpha1 is max(Alpha, S),
    (   Alpha1 >= Beta
    ->  Best = Best1                     % poda: el rival no permitiría esta rama
    ;   search(Ms, Board, Player, Depth, Alpha1, Beta, Best1, Best)
    ).

%!  decision_kind(+Board, +Player, +Pos, -Kind) is det.
%   Explica la jugada elegida para la demostración y el evento AI_DECISION:
%     WIN    la jugada gana de inmediato
%     BLOCK  impide que el rival gane en su siguiente turno
%     SEARCH elegida por la búsqueda sin amenaza inmediata
decision_kind(Board, Player, Pos, 'WIN') :-
    apply_move(Board, Pos, Player, Next),
    winner(Next, Player), !.
decision_kind(Board, Player, Pos, 'BLOCK') :-
    opponent(Player, Opp),
    apply_move(Board, Pos, Opp, Next),
    winner(Next, Opp), !.
decision_kind(_, _, _, 'SEARCH').
