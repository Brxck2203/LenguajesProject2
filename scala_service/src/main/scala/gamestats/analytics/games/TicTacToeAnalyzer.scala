package gamestats.analytics.games

import gamestats.analytics.{GameAnalyzer, Stats}
import gamestats.model.*
import gamestats.model.Actions.*

/** Gato humano contra computadora (GameConsole).
  *
  * Las jugadas se cuentan solo con `MOVE_PLAYED`; `AI_DECISION` aporta los tiempos y el tipo de decisión de la
  * computadora, pero nunca se cuenta como una segunda jugada. El tablero se reconstruye a partir de las jugadas, así
  * que el ganador, los bloqueos y las bifurcaciones se calculan de forma independiente a lo que reporte la IA.
  */
object TicTacToeAnalyzer extends GameAnalyzer:
  val gameId: String = Games.TicTacToe

  type Board = Vector[Option[String]]
  val EmptyBoard: Board = Vector.fill(9)(None)

  val Lines: List[List[Int]] = List(
    List(0, 1, 2), List(3, 4, 5), List(6, 7, 8),
    List(0, 3, 6), List(1, 4, 7), List(2, 5, 8),
    List(0, 4, 8), List(2, 4, 6)
  )

  /** Una jugada válida con el tablero anterior y el posterior. */
  final case class Move(event: GameEvent, player: String, symbol: String, position: Int, before: Board, after: Board):
    val opponentSymbol: String = if symbol == "X" then "O" else "X"
    val wins: Boolean = lineOf(after, symbol).isDefined
    val missedWin: Boolean = !wins && threats(before, symbol).nonEmpty
    val blocked: Boolean = !wins && threats(before, opponentSymbol).contains(position)
    val fork: Boolean = !wins && threats(after, symbol).size >= 2

  /** Jugadas válidas en orden y cantidad de jugadas descartadas (casilla ocupada, fuera de rango o sin símbolo). */
  def replay(ctx: MatchContext): (List[Move], Int) =
    val (moves, _, invalid) = ctx.ofAction(MovePlayed).foldLeft((Vector.empty[Move], EmptyBoard, 0)) {
      case ((acc, board, bad), event) =>
        val move = for
          player <- event.actor
          symbol <- event.str("symbol").map(_.toUpperCase).filter(Set("X", "O"))
          position <- event.int("position").filter(p => p >= 0 && p < 9)
          if board(position).isEmpty
        yield Move(event, player, symbol, position, board, board.updated(position, Some(symbol)))
        move.fold((acc, board, bad + 1))(m => (acc :+ m, m.after, bad))
    }
    (moves.toList, invalid)

  def lineOf(board: Board, symbol: String): Option[List[Int]] =
    Lines.find(_.forall(board(_).contains(symbol)))

  /** Casillas libres donde `symbol` ganaría de inmediato. */
  def threats(board: Board, symbol: String): Set[Int] =
    Lines.flatMap { line =>
      val (mine, rest) = line.partition(board(_).contains(symbol))
      if mine.size == 2 && rest.forall(board(_).isEmpty) then rest else Nil
    }.toSet

  private def finalBoard(moves: List[Move]): Board = moves.lastOption.fold(EmptyBoard)(_.after)

  private def computerPlayers(ctx: MatchContext): Set[String] = ctx.ofAction(AiDecision).flatMap(_.actor).toSet

  /** Segundos que tardó cada jugada desde la jugada anterior (o desde el inicio). */
  private def moveSeconds(ctx: MatchContext, moves: List[Move]): List[(Move, Double)] =
    moves.zip(0.0 :: moves.map(m => ctx.second(m.event))).map((m, prev) => m -> (ctx.second(m.event) - prev))

  def playerStats(ctx: MatchContext): Map[String, ujson.Obj] =
    val (moves, _) = replay(ctx)
    val timed = moveSeconds(ctx, moves)
    val computers = computerPlayers(ctx)
    val matchWinner = winner(ctx)
    val players = (ctx.participants ++ moves.map(_.player)).distinct

    players.map { player =>
      val own = moves.filter(_.player == player)
      val times = timed.collect { case (m, s) if m.player == player => s }
      val base = ujson.Obj(
        "symbol" -> Stats.optional(own.headOption)(m => ujson.Str(m.symbol)),
        "isComputer" -> computers.contains(player),
        "movesPlayed" -> own.size,
        "averageMoveSeconds" -> Stats.optional(Stats.mean(times))(v => ujson.Num(Stats.round2(v))),
        "winningMoves" -> own.count(_.wins),
        "threatsBlocked" -> own.count(_.blocked),
        "forksCreated" -> own.count(_.fork),
        "missedWins" -> own.count(_.missedWin),
        "result" -> result(ctx, matchWinner, player)
      )
      val extra = if computers.contains(player) then aiStats(ctx, player) else ujson.Obj()
      player -> Stats.merge(base, extra)
    }.toMap

  private def result(ctx: MatchContext, winner: Option[String], player: String): String =
    ctx.finishReason match
      case Some(FinishReasons.Abandoned)       => "ABANDONED"
      case _ if winner.contains(player)        => "WIN"
      case _ if winner.isDefined               => "LOSS"
      case Some(FinishReasons.Draw)            => "DRAW"
      case _ if ctx.isFinished                 => "DRAW"
      case _                                   => "IN_PROGRESS"

  private def aiStats(ctx: MatchContext, player: String): ujson.Obj =
    val decisions = ctx.ofAction(AiDecision).filter(_.actor.contains(player))
    val durations = decisions.flatMap(_.num("durationMs"))
    val latencies = decisions.flatMap(_.num("latencyMs"))
    ujson.Obj(
      "aiDecisions" -> decisions.size,
      "averageDecisionMs" -> Stats.optional(Stats.mean(durations))(v => ujson.Num(Stats.round2(v))),
      "maxDecisionMs" -> Stats.optional(durations.maxOption)(ujson.Num(_)),
      "averageLatencyMs" -> Stats.optional(Stats.mean(latencies))(v => ujson.Num(Stats.round2(v))),
      "decisionKinds" -> Stats.countsJson(Stats.countBy(decisions)(_.str("kind"))),
      "algorithms" -> ujson.Arr.from(decisions.flatMap(_.str("algorithm")).distinct.sorted)
    )

  def matchStats(ctx: MatchContext): ujson.Obj =
    val (moves, invalid) = replay(ctx)
    val board = finalBoard(moves)
    val line = List("X", "O").flatMap(lineOf(board, _)).headOption
    val durations = ctx.ofAction(AiDecision).flatMap(_.num("durationMs"))
    val firstDeclared = ctx.events.find(_.is(EventTypes.MatchStarted)).flatMap(_.str("firstPlayerId"))
    ujson.Obj(
      "totalMoves" -> moves.size,
      "invalidMoves" -> invalid,
      "outcome" -> outcome(ctx, line.isDefined),
      "firstPlayer" -> Stats.optional(firstDeclared.orElse(moves.headOption.map(_.player)))(ujson.Str(_)),
      "openingPosition" -> Stats.optional(moves.headOption)(m => ujson.Num(m.position)),
      "winningLine" -> Stats.optional(line)(l => ujson.Arr.from(l.map(ujson.Num(_)))),
      "finalBoard" -> ujson.Arr.from(board.map(_.getOrElse(""))),
      "aiDecisionCount" -> ctx.ofAction(AiDecision).size,
      "aiAverageDecisionMs" -> Stats.optional(Stats.mean(durations))(v => ujson.Num(Stats.round2(v)))
    )

  private def outcome(ctx: MatchContext, hasLine: Boolean): String =
    ctx.finishReason match
      case Some(FinishReasons.Abandoned) => "ABANDONED"
      case _ if hasLine                  => "WIN"
      case _ if ctx.isFinished           => "DRAW"
      case _                             => "IN_PROGRESS"

  /** Ganador según el tablero: el jugador cuya marca completa una línea. */
  def inferredWinner(ctx: MatchContext): Option[String] =
    val (moves, _) = replay(ctx)
    val board = finalBoard(moves)
    List("X", "O").find(lineOf(board, _).isDefined).flatMap(sym => moves.find(_.symbol == sym).map(_.player))

  def patterns(ctx: MatchContext): List[Pattern] =
    val (moves, _) = replay(ctx)
    moves.flatMap { m =>
      val second = ctx.second(m.event)
      def pattern(name: String, description: String, details: ujson.Obj = ujson.Obj()) =
        Pattern(name, description, List(m.player), List(m.event.eventId), second, second, details)
      List(
        Option.when(m.wins)(
          pattern("WINNING_MOVE", s"${m.player} completó una línea en la casilla ${m.position}",
            ujson.Obj("line" -> ujson.Arr.from(lineOf(m.after, m.symbol).toList.flatten.map(ujson.Num(_)))))
        ),
        Option.when(m.blocked)(pattern("BLOCKED_THREAT", s"${m.player} bloqueó la línea del rival en la casilla ${m.position}")),
        Option.when(m.fork)(
          pattern("FORK", s"${m.player} creó dos amenazas a la vez",
            ujson.Obj("threats" -> ujson.Arr.from(threats(m.after, m.symbol).toList.sorted.map(ujson.Num(_)))))
        ),
        Option.when(m.missedWin)(
          pattern("MISSED_WIN", s"${m.player} pudo ganar y jugó en otra casilla",
            ujson.Obj("winningPositions" -> ujson.Arr.from(threats(m.before, m.symbol).toList.sorted.map(ujson.Num(_)))))
        )
      ).flatten
    }
