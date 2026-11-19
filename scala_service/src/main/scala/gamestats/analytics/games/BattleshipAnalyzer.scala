package gamestats.analytics.games

import gamestats.analytics.{GameAnalyzer, Stats}
import gamestats.model.*
import gamestats.model.Actions.*

/** Battleship simplificado contra la computadora (GameConsole).
  *
  * Los aciertos se cuentan únicamente con `SHOT_FIRED` (`hit = true`). El disparo que hunde un barco envía además
  * `SHIP_SUNK`, que suma barcos hundidos pero nunca un acierto adicional.
  */
object BattleshipAnalyzer extends GameAnalyzer:
  val gameId: String = Games.Battleship

  val StreakMinHits = 3

  final case class Shot(event: GameEvent, shooter: String, target: String, row: Int, col: Int, hit: Boolean)

  def shots(ctx: MatchContext): List[Shot] =
    ctx.ofAction(ShotFired).flatMap { event =>
      for
        shooter <- event.actor
        target <- event.str("targetPlayerId")
        row <- event.int("row")
        col <- event.int("col")
        hit <- event.bool("hit")
      yield Shot(event, shooter, target, row, col, hit)
    }

  /** Disparos de un jugador a una casilla que ya había atacado (las reglas no deberían permitirlo). */
  private def repeated(own: List[Shot]): Int =
    own.size - own.map(s => (s.target, s.row, s.col)).distinct.size

  def playerStats(ctx: MatchContext): Map[String, ujson.Obj] =
    val all = shots(ctx)
    val sunkBy = Stats.countBy(ctx.ofAction(ShipSunk))(_.actor)
    val lost = Stats.countBy(ctx.ofAction(ShipSunk))(_.str("targetPlayerId"))
    val players = (ctx.participants ++ all.map(_.shooter)).distinct
    players.map { player =>
      val own = all.filter(_.shooter == player)
      val hits = own.count(_.hit)
      val firstHit = own.indexWhere(_.hit)
      player -> ujson.Obj(
        "shotsFired" -> own.size,
        "hits" -> hits,
        "misses" -> (own.size - hits),
        "accuracyPct" -> Stats.pct(hits, own.size),
        "longestHitStreak" -> Stats.longestRun(own)(_.hit),
        "shotsToFirstHit" -> (if firstHit >= 0 then ujson.Num(firstHit + 1) else ujson.Null),
        "shipsSunk" -> sunkBy.getOrElse(player, 0),
        "shipsLost" -> lost.getOrElse(player, 0),
        "hitsReceived" -> all.count(s => s.target == player && s.hit),
        "repeatedShots" -> repeated(own)
      )
    }.toMap

  def matchStats(ctx: MatchContext): ujson.Obj =
    val all = shots(ctx)
    val hits = all.count(_.hit)
    // Turnos alternados: un disparo del mismo jugador que el anterior está fuera de turno.
    val outOfTurn = all.zip(all.drop(1)).count((a, b) => a.shooter == b.shooter)
    ujson.Obj(
      "boardSize" -> Stats.optional(ctx.events.find(_.is(EventTypes.MatchStarted)).flatMap(_.int("boardSize")))(ujson.Num(_)),
      "turns" -> all.size,
      "totalShots" -> all.size,
      "totalHits" -> hits,
      "overallAccuracyPct" -> Stats.pct(hits, all.size),
      "shipsSunk" -> ctx.ofAction(ShipSunk).size,
      "outOfTurnShots" -> outOfTurn,
      "repeatedShots" -> all.groupBy(_.shooter).values.map(repeated).sum,
      "outcome" -> (ctx.finishReason match
        case Some(FinishReasons.Abandoned) => "ABANDONED"
        case _ if ctx.isFinished           => "COMPLETED"
        case _                             => "IN_PROGRESS"
      )
    )

  /** Sin ganador declarado: quien hundió más barcos, solo si la partida terminó y no hay empate. */
  def inferredWinner(ctx: MatchContext): Option[String] =
    Option.when(ctx.isFinished && !ctx.finishReason.contains(FinishReasons.Abandoned)) {
      Stats.uniqueMax(Stats.countBy(ctx.ofAction(ShipSunk))(_.actor).view.mapValues(_.toDouble).toMap)
    }.flatten

  def patterns(ctx: MatchContext): List[Pattern] =
    val all = shots(ctx)
    val streaks = all.groupBy(_.shooter).toList.sortBy(_._1).flatMap { (player, own) =>
      Stats.runs(own)(_.hit).filter(_.size >= StreakMinHits).map { run =>
        Pattern(
          name = "HIT_STREAK",
          description = s"$player acertó ${run.size} disparos seguidos",
          players = List(player),
          eventIds = run.map(_.event.eventId),
          startSecond = ctx.second(run.head.event),
          endSecond = ctx.second(run.last.event),
          details = ujson.Obj("length" -> run.size)
        )
      }
    }
    val lost = Stats.countBy(ctx.ofAction(ShipSunk))(_.str("targetPlayerId"))
    val flawless = for
      w <- winner(ctx)
      if ctx.finishReason.forall(_ != FinishReasons.Abandoned) && lost.getOrElse(w, 0) == 0
    yield Pattern(
      name = "FLAWLESS_VICTORY",
      description = s"$w ganó sin perder ningún barco",
      players = List(w),
      eventIds = Nil,
      startSecond = 0,
      endSecond = ctx.durationSeconds,
      details = ujson.Obj("shipsSunk" -> ctx.ofAction(ShipSunk).count(_.actor.contains(w)))
    )
    streaks ++ flawless.toList
