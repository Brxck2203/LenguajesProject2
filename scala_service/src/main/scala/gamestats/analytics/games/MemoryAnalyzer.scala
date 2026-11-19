package gamestats.analytics.games

import gamestats.analytics.{GameAnalyzer, Stats}
import gamestats.model.*
import gamestats.model.Actions.*

/** Memoria de parejas para un jugador (GameConsole).
  *
  * Cada intento envía dos `CARD_FLIPPED` y un `PAIR_ATTEMPTED`. El porcentaje de acierto se calcula aquí, no en la
  * consola. Además se sigue qué cartas ya había visto el jugador para distinguir aciertos por memoria, aciertos por
  * suerte y parejas que olvidó.
  */
object MemoryAnalyzer extends GameAnalyzer:
  val gameId: String = Games.Memory

  val StreakMinMatches = 3

  /** Un intento con lo que el jugador sabía justo antes de voltear sus dos cartas. */
  final case class Attempt(
      event: GameEvent,
      player: String,
      first: Int,
      second: Int,
      matched: Boolean,
      /** La pareja de la primera carta ya se había visto y seguía en la mesa. */
      partnerKnown: Boolean,
      /** Ninguna de las dos cartas se había visto antes. */
      bothUnseen: Boolean,
      /** `matched` no coincide con los símbolos reportados en `CARD_FLIPPED`. */
      inconsistent: Boolean
  ):
    def forgotten: Boolean = !matched && partnerKnown
    def lucky: Boolean = matched && bothUnseen

  private final case class Knowledge(seen: Map[Int, String], removed: Set[Int], pending: Map[Int, String])

  def attempts(ctx: MatchContext): List[Attempt] =
    val start = Knowledge(Map.empty, Set.empty, Map.empty)
    ctx.ofAction(CardFlipped, PairAttempted)
      .foldLeft((Vector.empty[Attempt], start)) { case ((acc, k), event) =>
        if event.is(CardFlipped) then
          val flipped = for card <- event.int("cardIndex"); symbol <- event.str("symbol") yield card -> symbol
          (acc, flipped.fold(k)(f => k.copy(pending = k.pending + f)))
        else
          val attempt = for
            player <- event.actor
            first <- event.int("firstCard")
            second <- event.int("secondCard")
            matched <- event.bool("matched")
          yield
            val symbols = k.seen ++ k.pending
            val partnerKnown = symbols.get(first).exists { symbol =>
              k.seen.exists((card, s) => s == symbol && card != first && !k.removed.contains(card))
            }
            val inconsistent = (symbols.get(first), symbols.get(second)) match
              case (Some(a), Some(b)) => (a == b) != matched
              case _                  => false
            Attempt(event, player, first, second, matched, partnerKnown,
              !k.seen.contains(first) && !k.seen.contains(second), inconsistent)
          val removed = attempt.filter(_.matched).fold(k.removed)(a => k.removed + a.first + a.second)
          val next = Knowledge(k.seen ++ k.pending, removed, Map.empty)
          (attempt.fold(acc)(acc :+ _), next)
      }
      ._1
      .toList

  private def pairsDeclared(ctx: MatchContext): Option[Int] =
    ctx.events.find(_.is(EventTypes.MatchStarted)).flatMap(_.int("pairs"))

  private def completed(ctx: MatchContext, found: Int): Boolean =
    ctx.finishReason.contains(FinishReasons.Completed) && pairsDeclared(ctx).forall(_ == found)

  def playerStats(ctx: MatchContext): Map[String, ujson.Obj] =
    val all = attempts(ctx)
    val flips = Stats.countBy(ctx.ofAction(CardFlipped))(_.actor)
    val players = (ctx.participants ++ all.map(_.player)).distinct
    players.map { player =>
      val own = all.filter(_.player == player)
      val found = own.count(_.matched)
      player -> ujson.Obj(
        "cardsFlipped" -> flips.getOrElse(player, 0),
        "attempts" -> own.size,
        "pairsFound" -> found,
        "misses" -> (own.size - found),
        "accuracyPct" -> Stats.pct(found, own.size),
        "longestMatchStreak" -> Stats.longestRun(own)(_.matched),
        "forgottenPairs" -> own.count(_.forgotten),
        "luckyMatches" -> own.count(_.lucky),
        "averageSecondsPerAttempt" ->
          (if own.isEmpty then ujson.Null else ujson.Num(Stats.round2(ctx.durationSeconds / own.size))),
        "completed" -> completed(ctx, found)
      )
    }.toMap

  def matchStats(ctx: MatchContext): ujson.Obj =
    val all = attempts(ctx)
    val found = all.count(_.matched)
    val pairs = pairsDeclared(ctx)
    ujson.Obj(
      "pairs" -> Stats.optional(pairs)(ujson.Num(_)),
      "pairsFound" -> found,
      "attempts" -> all.size,
      "accuracyPct" -> Stats.pct(found, all.size),
      // Con memoria perfecta se necesita un intento por pareja: 100 % es el óptimo.
      "efficiencyPct" -> Stats.optional(pairs)(p => ujson.Num(Stats.pct(p, math.max(all.size, p)))),
      "inconsistentAttempts" -> all.count(_.inconsistent),
      "completed" -> completed(ctx, found),
      "outcome" -> (ctx.finishReason match
        case Some(FinishReasons.Abandoned)    => "ABANDONED"
        case _ if completed(ctx, found)        => "COMPLETED"
        case _ if ctx.isFinished               => "FINISHED"
        case _                                 => "IN_PROGRESS"
      )
    )

  /** Un solo jugador: gana si completó el tablero. No se inventa un rival. */
  def inferredWinner(ctx: MatchContext): Option[String] =
    val all = attempts(ctx)
    Option.when(completed(ctx, all.count(_.matched)))(all.map(_.player).distinct).collect { case List(p) => p }

  def patterns(ctx: MatchContext): List[Pattern] =
    val all = attempts(ctx)
    val streaks = all.groupBy(_.player).toList.sortBy(_._1).flatMap { (player, own) =>
      Stats.runs(own)(_.matched).filter(_.size >= StreakMinMatches).map { run =>
        Pattern(
          name = "MATCH_STREAK",
          description = s"$player encontró ${run.size} parejas seguidas",
          players = List(player),
          eventIds = run.map(_.event.eventId),
          startSecond = ctx.second(run.head.event),
          endSecond = ctx.second(run.last.event),
          details = ujson.Obj("length" -> run.size)
        )
      }
    }
    val found = all.count(_.matched)
    val perfect = Option.when(completed(ctx, found) && all.nonEmpty && all.forall(_.matched)) {
      Pattern(
        name = "PERFECT_GAME",
        description = s"Completó el tablero sin fallar ningún intento",
        players = all.map(_.player).distinct,
        eventIds = Nil,
        startSecond = 0,
        endSecond = ctx.durationSeconds,
        details = ujson.Obj("attempts" -> all.size)
      )
    }
    streaks ++ perfect.toList
