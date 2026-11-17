package gamestats.analytics

import gamestats.model.{AnalysisResult, Games}

/** Estadísticas que combinan varias partidas ya analizadas (por juego y por jugador a lo largo del tiempo).
  *
  * Son genéricas: recorren los campos numéricos de `playerStats` de cualquier juego y calculan total y promedio con
  * `foldLeft`, sin conocer los nombres de las métricas.
  */
object CrossMatchStats:

  private def number(value: ujson.Value): Option[Double] = value match
    case ujson.Num(n) => Some(n)
    case _            => None

  private def field(obj: ujson.Obj, name: String): Option[ujson.Value] = obj.value.get(name)

  /** Juegos de la consola que el panel muestra siempre, aunque todavía no tengan partidas. */
  val ConsoleGames: List[String] = List(Games.TicTacToe, Games.Memory, Games.Battleship)

  /** Suma y promedio de cada campo numérico de `matchStats` (genérico: no conoce los nombres de las métricas). */
  def matchStatsAggregates(results: List[AnalysisResult]): (ujson.Obj, ujson.Obj) =
    val totals = results.foldLeft(Map.empty[String, (Double, Int)]) { (acc, r) =>
      r.matchStats.value.foldLeft(acc) { case (inner, (name, value)) =>
        number(value).fold(inner) { n =>
          val (sum, count) = inner.getOrElse(name, (0.0, 0))
          inner.updated(name, (sum + n, count + 1))
        }
      }
    }
    val sorted = totals.toList.sortBy(_._1)
    (
      ujson.Obj.from(sorted.map { case (name, (sum, _)) => name -> ujson.Num(Stats.round2(sum)) }),
      ujson.Obj.from(sorted.map { case (name, (sum, count)) => name -> ujson.Num(Stats.round2(sum / count)) })
    )

  private def outcomes(results: List[AnalysisResult]): ujson.Obj =
    Stats.countsJson(
      results.flatMap(r => field(r.matchStats, "outcome")).collect { case ujson.Str(o) => o }
        .groupMapReduce(identity)(_ => 1)(_ + _)
    )

  val emptyGame: ujson.Obj = ujson.Obj(
    "matchesAnalyzed" -> 0,
    "totalEvents" -> 0,
    "averageDurationSeconds" -> ujson.Null,
    "averageEventsPerMatch" -> 0,
    "patternCounts" -> ujson.Obj(),
    "topWinners" -> ujson.Arr(),
    "outcomes" -> ujson.Obj(),
    "matchStatsAverages" -> ujson.Obj()
  )

  /** Métricas provisionales de partidas en curso. Nunca se mezclan con las finales. */
  def liveSummary(partials: List[AnalysisResult]): ujson.Obj =
    val (totals, averages) = matchStatsAggregates(partials)
    ujson.Obj(
      "matchesInProgress" -> partials.size,
      "matchStatsTotals" -> totals,
      "matchStatsAverages" -> averages
    )

  /** Estadísticas generales: totales de todos los juegos y una fila por juego, finales y en curso por separado. */
  def overview(finals: List[AnalysisResult], partials: List[AnalysisResult], supported: List[String]): ujson.Obj =
    val games = (ConsoleGames ++ (finals ++ partials).map(_.gameId).distinct.sorted).distinct
    val durations = finals.flatMap(r => field(r.matchStats, "durationSeconds").flatMap(number))
    val events = finals.flatMap(r => field(r.matchStats, "eventCount").flatMap(number)).sum
    val wins = finals.flatMap(r => r.playerStats.collect { case (p, s) if field(s, "isWinner").contains(ujson.True) => p })
    ujson.Obj(
      "totals" -> ujson.Obj(
        "matchesAnalyzed" -> finals.size,
        "matchesInProgress" -> partials.size,
        "totalEvents" -> events,
        "averageDurationSeconds" -> Stats.optional(Stats.mean(durations))(v => ujson.Num(Stats.round2(v))),
        "distinctPlayers" -> finals.flatMap(_.playerStats.keys).distinct.size
      ),
      "byGame" -> ujson.Arr.from(games.map { gameId =>
        val own = finals.filter(_.gameId == gameId)
        val gameDurations = own.flatMap(r => field(r.matchStats, "durationSeconds").flatMap(number))
        ujson.Obj(
          "gameId" -> gameId,
          "supported" -> supported.contains(gameId),
          "matchesAnalyzed" -> own.size,
          "matchesInProgress" -> partials.count(_.gameId == gameId),
          "totalEvents" -> own.flatMap(r => field(r.matchStats, "eventCount").flatMap(number)).sum,
          "averageDurationSeconds" -> Stats.optional(Stats.mean(gameDurations))(v => ujson.Num(Stats.round2(v))),
          "outcomes" -> outcomes(own)
        )
      }),
      "topPlayers" -> ujson.Arr.from(
        wins.groupMapReduce(identity)(_ => 1)(_ + _).toList.sortBy((p, n) => (-n, p)).take(5).map((p, n) =>
          ujson.Obj("playerId" -> p, "wins" -> n)
        )
      )
    )

  def gamesSummary(results: List[AnalysisResult]): ujson.Obj =
    ujson.Obj.from(results.groupBy(_.gameId).toList.sortBy(_._1).map { (gameId, games) =>
      val durations = games.flatMap(r => field(r.matchStats, "durationSeconds").flatMap(number))
      val events = games.flatMap(r => field(r.matchStats, "eventCount").flatMap(number)).sum
      val patternCounts = games.flatMap(_.patterns.map(_.name)).groupMapReduce(identity)(_ => 1)(_ + _)
      val winners = games.flatMap(r => field(r.matchStats, "winner")).collect { case ujson.Str(w) => w }
      gameId -> ujson.Obj(
        "matchesAnalyzed" -> games.size,
        "totalEvents" -> events,
        "averageDurationSeconds" -> Stats.optional(Stats.mean(durations))(v => ujson.Num(Stats.round2(v))),
        "averageEventsPerMatch" -> Stats.round2(events / games.size),
        "patternCounts" -> Stats.countsJson(patternCounts),
        "outcomes" -> outcomes(games),
        "matchStatsAverages" -> matchStatsAggregates(games)._2,
        "topWinners" -> ujson.Arr.from(
          winners.groupMapReduce(identity)(_ => 1)(_ + _).toList.sortBy((w, n) => (-n, w)).take(5).map((w, n) =>
            ujson.Obj("winner" -> w, "wins" -> n)
          )
        )
      )
    })

  /** Historial agregado de cada jugador dentro de un juego, ordenado por victorias y partidas. */
  def playersSummary(results: List[AnalysisResult], gameId: String): ujson.Arr =
    val games = results.filter(_.gameId == gameId)
    val appearances = games.flatMap(r => r.playerStats.toList.map((player, stats) => (player, r, stats)))
    val byPlayer = appearances.groupBy(_._1)

    val rows = byPlayer.toList.map { (player, rows) =>
      val stats = rows.map(_._3)
      val wins = stats.count(s => field(s, "isWinner").contains(ujson.True))
      // Suma por nombre de métrica: fold sobre todos los campos numéricos de todas las partidas del jugador.
      val totals = stats.foldLeft(Map.empty[String, (Double, Int)]) { (acc, s) =>
        s.value.foldLeft(acc) { case (inner, (name, value)) =>
          number(value).fold(inner) { n =>
            val (sum, count) = inner.getOrElse(name, (0.0, 0))
            inner.updated(name, (sum + n, count + 1))
          }
        }
      }
      val metrics = ujson.Obj.from(totals.toList.sortBy(_._1).map { case (name, (sum, count)) =>
        name -> ujson.Obj("total" -> Stats.round2(sum), "average" -> Stats.round2(sum / count))
      })
      (player, rows.size, wins, metrics, rows.map(_._2.matchId).sorted)
    }

    ujson.Arr.from(rows.sortBy((player, matches, wins, _, _) => (-wins, -matches, player)).map {
      (player, matches, wins, metrics, matchIds) =>
        ujson.Obj(
          "playerId" -> player,
          "matchesPlayed" -> matches,
          "wins" -> wins,
          "winRatePct" -> Stats.pct(wins, matches),
          "metrics" -> metrics,
          "matchIds" -> ujson.Arr.from(matchIds)
        )
    })
