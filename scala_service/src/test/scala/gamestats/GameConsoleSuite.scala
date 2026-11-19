package gamestats

import gamestats.TestData.*
import gamestats.analytics.AnalysisEngine
import gamestats.analytics.games.*
import gamestats.model.*
import gamestats.model.Actions.*

/** Casos conocidos de los tres juegos de GameConsole, con los valores esperados calculados a mano. */
class TicTacToeSuite extends munit.FunSuite:
  private val Ai = "PROLOG_AI"

  /** Partida a partir de posiciones alternadas; X es `ana` y abre. La IA envía AI_DECISION antes de cada jugada. */
  private def game(positions: List[Int], finish: Option[Seq[(String, ujson.Value)]], decisionMs: Int = 4) =
    val played = positions.zipWithIndex.foldLeft(MatchBuilder(Games.TicTacToe).start) { case (m, (pos, i)) =>
      val second = (i + 1) * 2.0
      val (player, symbol) = if i % 2 == 0 then ("ana", "X") else (Ai, "O")
      val withDecision =
        if player == Ai then
          m.at(second - 0.5, AiDecision, Ai, "position" -> pos, "algorithm" -> "minimax-alphabeta",
            "durationMs" -> (decisionMs + i), "kind" -> "SEARCH", "score" -> -1)
        else m
      withDecision.at(second, MovePlayed, player, "position" -> pos, "row" -> pos / 3, "col" -> pos % 3,
        "symbol" -> symbol, "turn" -> (i + 1))
    }
    finish.fold(played)(data => played.finish(positions.size * 2.0 + 1, data*)).context

  test("victoria del humano: jugadas sin contar AI_DECISION, línea y tiempos de la IA") {
    val ctx = game(List(0, 4, 1, 8, 2), Some(Seq("reason" -> "COMPLETED")))
    val players = TicTacToeAnalyzer.playerStats(ctx)
    assertEquals(num(players("ana"), "movesPlayed"), 3.0)
    assertEquals(num(players(Ai), "movesPlayed"), 2.0)
    assertEquals(num(players(Ai), "aiDecisions"), 2.0)
    // durationMs: 4 + 1 y 4 + 3
    assertEquals(num(players(Ai), "averageDecisionMs"), 6.0)
    assertEquals(num(players(Ai), "maxDecisionMs"), 7.0)
    assertEquals(players(Ai)("isComputer").bool, true)
    assertEquals(players("ana")("isComputer").bool, false)
    assertEquals(str(players("ana"), "result"), "WIN")
    assertEquals(str(players(Ai), "result"), "LOSS")
    assertEquals(num(players("ana"), "averageMoveSeconds"), 2.0)

    val stats = TicTacToeAnalyzer.matchStats(ctx)
    assertEquals(num(stats, "totalMoves"), 5.0)
    assertEquals(str(stats, "outcome"), "WIN")
    assertEquals(stats("winningLine").arr.map(_.num).toList, List(0.0, 1.0, 2.0))
    assertEquals(TicTacToeAnalyzer.winner(ctx), Some("ana")) // inferido del tablero
    assertEquals(names(TicTacToeAnalyzer.patterns(ctx)), List("WINNING_MOVE"))
  }

  test("empate con cuatro bloqueos") {
    // X0 O4 X1 O2* X6* O3* X5* O7 X8   (* bloquea una línea del rival)
    val ctx = game(List(0, 4, 1, 2, 6, 3, 5, 7, 8), Some(Seq("reason" -> "DRAW")))
    val players = TicTacToeAnalyzer.playerStats(ctx)
    assertEquals(num(players("ana"), "threatsBlocked"), 2.0)
    assertEquals(num(players(Ai), "threatsBlocked"), 2.0)
    assertEquals(str(players("ana"), "result"), "DRAW")
    assertEquals(str(TicTacToeAnalyzer.matchStats(ctx), "outcome"), "DRAW")
    assertEquals(TicTacToeAnalyzer.winner(ctx), None)
    assertEquals(names(TicTacToeAnalyzer.patterns(ctx)), List.fill(4)("BLOCKED_THREAT"))
  }

  test("victoria desaprovechada y victoria de la computadora") {
    // X0 O3 X1 O4 X8 (podía ganar en 2) O5 gana
    val ctx = game(List(0, 3, 1, 4, 8, 5), Some(Seq("reason" -> "COMPLETED", "winnerPlayerId" -> Ai)))
    val patterns = TicTacToeAnalyzer.patterns(ctx)
    assertEquals(names(patterns), List("MISSED_WIN", "WINNING_MOVE"))
    assertEquals(patterns.head.details("winningPositions").arr.map(_.num).toList, List(2.0))
    assertEquals(num(TicTacToeAnalyzer.playerStats(ctx)("ana"), "missedWins"), 1.0)
    assertEquals(TicTacToeAnalyzer.winner(ctx), Some(Ai))
  }

  test("bifurcación: dos amenazas a la vez") {
    // X0 O1 X4 O8* X6 -> amenazas en 2 y 3
    val ctx = game(List(0, 1, 4, 8, 6), None)
    val fork = TicTacToeAnalyzer.patterns(ctx).filter(_.name == "FORK")
    assertEquals(fork.map(_.players), List(List("ana")))
    assertEquals(fork.head.details("threats").arr.map(_.num).toList, List(2.0, 3.0))
  }

  test("descarta jugadas en casillas ocupadas") {
    val ctx = MatchBuilder(Games.TicTacToe).start
      .at(1, MovePlayed, "ana", "position" -> 4, "symbol" -> "X")
      .at(2, MovePlayed, Ai, "position" -> 4, "symbol" -> "O")
      .finish(3, "reason" -> "ABANDONED")
      .context
    val stats = TicTacToeAnalyzer.matchStats(ctx)
    assertEquals(num(stats, "totalMoves"), 1.0)
    assertEquals(num(stats, "invalidMoves"), 1.0)
    assertEquals(str(stats, "outcome"), "ABANDONED")
    assertEquals(str(TicTacToeAnalyzer.playerStats(ctx)("ana"), "result"), "ABANDONED")
  }

class MemorySuite extends munit.FunSuite:
  private val symbols = Map(0 -> "A", 1 -> "B", 2 -> "A", 3 -> "C", 4 -> "B", 5 -> "C")

  private def play(attempts: List[(Int, Int)], symbolOf: Map[Int, String] = symbols, finish: Boolean = true,
      reportedMatch: (Int, Int) => Boolean = (a, b) => symbols(a) == symbols(b)) =
    val played = attempts.zipWithIndex.foldLeft(MatchBuilder(Games.Memory).start) { case (m, ((a, b), i)) =>
      val t = (i + 1) * 10.0
      m.at(t - 2, CardFlipped, "ana", "cardIndex" -> a, "symbol" -> symbolOf(a))
        .at(t - 1, CardFlipped, "ana", "cardIndex" -> b, "symbol" -> symbolOf(b))
        .at(t, PairAttempted, "ana", "firstCard" -> a, "secondCard" -> b, "matched" -> reportedMatch(a, b),
          "attempt" -> (i + 1))
    }
    val withStart = played.copy(events = played.events.map(e =>
      if e.is(EventTypes.MatchStarted) then e.copy(data = Map("pairs" -> ujson.Num(3))) else e))
    (if finish then withStart.finish(60, "reason" -> "COMPLETED") else withStart).context

  test("intentos, aciertos, porcentaje, racha y parejas olvidadas") {
    // (0,1) falla; (2,0) acierta; (3,4) falla; (1,3) falla aunque ya vio la otra B en 4; (4,1) y (5,3) aciertan
    val ctx = play(List(0 -> 1, 2 -> 0, 3 -> 4, 1 -> 3, 4 -> 1, 5 -> 3))
    val ana = MemoryAnalyzer.playerStats(ctx)("ana")
    assertEquals(num(ana, "attempts"), 6.0)
    assertEquals(num(ana, "cardsFlipped"), 12.0)
    assertEquals(num(ana, "pairsFound"), 3.0)
    assertEquals(num(ana, "misses"), 3.0)
    assertEquals(num(ana, "accuracyPct"), 50.0)
    assertEquals(num(ana, "longestMatchStreak"), 2.0)
    assertEquals(num(ana, "forgottenPairs"), 1.0)
    assertEquals(num(ana, "luckyMatches"), 0.0)
    assertEquals(num(ana, "averageSecondsPerAttempt"), 10.0) // 60 s / 6 intentos
    val stats = MemoryAnalyzer.matchStats(ctx)
    assertEquals(num(stats, "efficiencyPct"), 50.0)
    assertEquals(stats("completed").bool, true)
    assertEquals(str(stats, "outcome"), "COMPLETED")
    assertEquals(MemoryAnalyzer.winner(ctx), Some("ana"))
    assertEquals(MemoryAnalyzer.patterns(ctx), Nil)
  }

  test("partida perfecta: racha de tres aciertos por suerte") {
    val lucky = Map(0 -> "A", 1 -> "A", 2 -> "B", 3 -> "B", 4 -> "C", 5 -> "C")
    val ctx = play(List(0 -> 1, 2 -> 3, 4 -> 5), lucky, reportedMatch = (a, b) => lucky(a) == lucky(b))
    val ana = MemoryAnalyzer.playerStats(ctx)("ana")
    assertEquals(num(ana, "accuracyPct"), 100.0)
    assertEquals(num(ana, "luckyMatches"), 3.0)
    assertEquals(names(MemoryAnalyzer.patterns(ctx)), List("MATCH_STREAK", "PERFECT_GAME"))
  }

  test("sin intentos el porcentaje es 0 y no hay división por cero") {
    val ctx = play(Nil, finish = false)
    val ana = MemoryAnalyzer.matchStats(ctx)
    assertEquals(num(ana, "accuracyPct"), 0.0)
    assertEquals(str(ana, "outcome"), "IN_PROGRESS")
  }

  test("detecta un matched que contradice los símbolos") {
    val ctx = play(List(0 -> 1), finish = false, reportedMatch = (_, _) => true)
    assertEquals(num(MemoryAnalyzer.matchStats(ctx), "inconsistentAttempts"), 1.0)
  }

  test("no se declara ganador si no completó el tablero") {
    val ctx = play(List(0 -> 2))
    assertEquals(MemoryAnalyzer.matchStats(ctx)("completed").bool, false)
    assertEquals(MemoryAnalyzer.winner(ctx), None)
  }

class BattleshipSuite extends munit.FunSuite:
  private def shot(m: MatchBuilder, t: Double, shooter: String, target: String, row: Int, col: Int, hit: Boolean) =
    m.at(t, ShotFired, shooter, "targetPlayerId" -> target, "row" -> row, "col" -> col, "hit" -> hit)

  private val battle =
    val m0 = MatchBuilder(Games.Battleship).start
    val m1 = shot(m0, 1, "ana", "CPU", 0, 0, hit = true)
    val m2 = shot(m1, 2, "CPU", "ana", 1, 1, hit = false)
    val m3 = shot(m2, 3, "ana", "CPU", 0, 1, hit = true)
    val m4 = shot(m3, 4, "CPU", "ana", 2, 2, hit = true)
    val m5 = shot(m4, 5, "ana", "CPU", 0, 2, hit = true)
      .at(5.1, ShipSunk, "ana", "targetPlayerId" -> "CPU", "shipId" -> "s3", "shipSize" -> 3)
    val m6 = shot(m5, 6, "CPU", "ana", 2, 3, hit = false)
    shot(m6, 7, "ana", "CPU", 5, 5, hit = false).finish(8, "reason" -> "COMPLETED").context

  test("disparos, precisión y barcos; SHIP_SUNK no suma aciertos") {
    val players = BattleshipAnalyzer.playerStats(battle)
    val ana = players("ana")
    assertEquals(num(ana, "shotsFired"), 4.0)
    assertEquals(num(ana, "hits"), 3.0)
    assertEquals(num(ana, "accuracyPct"), 75.0)
    assertEquals(num(ana, "longestHitStreak"), 3.0)
    assertEquals(num(ana, "shotsToFirstHit"), 1.0)
    assertEquals(num(ana, "shipsSunk"), 1.0)
    assertEquals(num(ana, "hitsReceived"), 1.0)
    val cpu = players("CPU")
    assertEquals(num(cpu, "accuracyPct"), 33.33)
    assertEquals(num(cpu, "shipsLost"), 1.0)
    assertEquals(num(cpu, "hitsReceived"), 3.0)

    val stats = BattleshipAnalyzer.matchStats(battle)
    assertEquals(num(stats, "totalShots"), 7.0)
    assertEquals(num(stats, "totalHits"), 4.0)
    assertEquals(num(stats, "outOfTurnShots"), 0.0)
    assertEquals(BattleshipAnalyzer.winner(battle), Some("ana"))
    assertEquals(names(BattleshipAnalyzer.patterns(battle)), List("HIT_STREAK", "FLAWLESS_VICTORY"))
  }

  test("disparos repetidos y fuera de turno") {
    val m = shot(shot(MatchBuilder(Games.Battleship).start, 1, "ana", "CPU", 0, 0, hit = false), 2, "ana", "CPU", 0, 0, hit = false)
    val ctx = m.finish(3, "reason" -> "ABANDONED").context
    val stats = BattleshipAnalyzer.matchStats(ctx)
    assertEquals(num(stats, "repeatedShots"), 1.0)
    assertEquals(num(stats, "outOfTurnShots"), 1.0)
    assertEquals(str(stats, "outcome"), "ABANDONED")
    assertEquals(BattleshipAnalyzer.winner(ctx), None)
    assertEquals(BattleshipAnalyzer.playerStats(ctx)("ana")("shotsToFirstHit"), ujson.Null)
  }

class GameConsoleEngineSuite extends munit.FunSuite:
  test("los tres juegos tienen analizador registrado") {
    assert(Set(Games.TicTacToe, Games.Memory, Games.Battleship).subsetOf(AnalysisEngine.supportedGames.toSet))
  }

  test("una partida abierta no tiene ganador aunque el tablero lo sugiera") {
    val open = MatchBuilder(Games.Battleship).start
      .at(1, ShipSunk, "ana", "targetPlayerId" -> "CPU", "shipId" -> "s2", "shipSize" -> 2)
      .request
    val result = AnalysisEngine.analyze(open)
    assertEquals(result.matchStats("winner"), ujson.Null)
    assertEquals(result.matchStats("finished").bool, false)
  }

  test("el cierre informa el motivo") {
    val finished = MatchBuilder(Games.Memory).start.finish(5, "reason" -> "ABANDONED").request
    assertEquals(str(AnalysisEngine.analyze(finished).matchStats, "finishReason"), "ABANDONED")
  }
