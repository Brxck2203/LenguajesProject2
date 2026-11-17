package gamestats

import gamestats.TestData.*
import gamestats.model.*
import gamestats.model.Actions.*
import gamestats.server.*

/** Rutas de GameConsole: análisis parcial, resumen general y resumen por juego. */
class LiveApiSuite extends munit.FunSuite:
  private val json = Map("Content-Type" -> "application/json")

  private def post(api: Api, path: String, body: String) = api.handle(HttpRequest("POST", path, json, body))
  private def get(api: Api, path: String) = api.handle(HttpRequest("GET", path, Map.empty, ""))

  /** Gato en curso con `moves` jugadas (sin MATCH_FINISHED). */
  private def open(moves: Int, matchId: String = "t1") =
    (0 until moves).foldLeft(MatchBuilder(Games.TicTacToe, matchId).start) { (m, i) =>
      val (player, symbol) = if i % 2 == 0 then ("ana", "X") else ("PROLOG_AI", "O")
      m.at(i + 1.0, MovePlayed, player, "position" -> List(0, 4, 1, 8, 2)(i), "symbol" -> symbol, "turn" -> (i + 1))
    }

  private def withRevision(body: String, revision: Int) =
    ujson.write(ujson.read(body).obj.addOne("revision" -> ujson.Num(revision)))

  test("el snapshot parcial se guarda aparte y no cuenta como partida analizada") {
    val api = Api(ResultStore(None))
    val response = post(api, "/analyze/partial", toJson(open(2).request))
    assertEquals(response.status, 200)
    assertEquals(response.body("partial").bool, true)
    assertEquals(response.body("revision").num, 3.0) // 3 eventos: inicio y dos jugadas
    assertEquals(response.body("result")("matchStats")("finished").bool, false)
    assertEquals(response.body("result")("matchStats")("winner"), ujson.Null)

    assertEquals(get(api, "/partial").body("count").num, 1.0)
    assertEquals(get(api, "/results").body("count").num, 0.0)
    val overview = get(api, "/stats/overview").body
    assertEquals(overview("totals")("matchesAnalyzed").num, 0.0)
    assertEquals(overview("totals")("matchesInProgress").num, 1.0)
  }

  test("una revisión vieja no sobrescribe la nueva y la misma revisión es idempotente") {
    val api = Api(ResultStore(None))
    val newer = toJson(open(4).request)
    val older = toJson(open(2).request)
    assertEquals(post(api, "/analyze/partial", newer).status, 200)
    val stale = post(api, "/analyze/partial", older)
    assertEquals(stale.status, 409)
    assertEquals(stale.body("currentRevision").num, 5.0)
    val replay = post(api, "/analyze/partial", newer)
    assertEquals(replay.status, 200)
    assertEquals(replay.headers.get("Idempotent-Replay"), Some("true"))
    assertEquals(get(api, "/partial/t1").body("result")("matchStats")("totalMoves").num, 4.0)
  }

  test("la revisión explícita tiene prioridad sobre la cantidad de eventos") {
    val api = Api(ResultStore(None))
    assertEquals(post(api, "/analyze/partial", withRevision(toJson(open(4).request), 1)).status, 200)
    assertEquals(post(api, "/analyze/partial", withRevision(toJson(open(2).request), 2)).status, 200)
    assertEquals(get(api, "/partial/t1").body("revision").num, 2.0)
    assertEquals(post(api, "/analyze/partial", withRevision(toJson(open(2).request), 0)).status, 400)
  }

  test("el resultado final reemplaza al parcial y luego se rechazan snapshots de esa partida") {
    val api = Api(ResultStore(None))
    post(api, "/analyze/partial", toJson(open(2).request))
    val finished = open(5).finish(10, "reason" -> "COMPLETED").request
    assertEquals(post(api, "/analyze", toJson(finished)).status, 200)
    assertEquals(get(api, "/partial").body("count").num, 0.0)
    assertEquals(get(api, "/partial/t1").status, 404)
    val late = post(api, "/analyze/partial", toJson(open(3).request))
    assertEquals(late.status, 409)
    assertEquals(late.body("finalized").bool, true)
  }

  test("un lote parcial con MATCH_FINISHED se rechaza") {
    val api = Api(ResultStore(None))
    val body = toJson(open(1).finish(3).request)
    val response = post(api, "/analyze/partial", body)
    assertEquals(response.status, 400)
    assert(response.body("error").str.contains("/analyze"))
  }

  test("resumen general y por juego con finales y en curso separados") {
    val api = Api(ResultStore(None))
    val win = open(5, "t1").finish(10, "reason" -> "COMPLETED").request
    post(api, "/analyze", toJson(win))
    post(api, "/analyze/partial", toJson(open(2, "t2").request))

    val overview = get(api, "/stats/overview").body
    assertEquals(overview("totals")("matchesAnalyzed").num, 1.0)
    val byGame = overview("byGame").arr.map(g => g("gameId").str -> g).toMap
    assertEquals(byGame.keySet, Set(Games.TicTacToe, Games.Memory, Games.Battleship))
    assertEquals(byGame(Games.TicTacToe)("matchesAnalyzed").num, 1.0)
    assertEquals(byGame(Games.TicTacToe)("matchesInProgress").num, 1.0)
    assertEquals(byGame(Games.TicTacToe)("outcomes")("WIN").num, 1.0)
    assertEquals(byGame(Games.Memory)("matchesAnalyzed").num, 0.0)
    assertEquals(overview("topPlayers").arr.head("playerId").str, "ana")

    val game = get(api, "/stats/games/TIC_TAC_TOE").body
    assertEquals(game("final")("matchesAnalyzed").num, 1.0)
    assertEquals(game("final")("matchStatsAverages")("totalMoves").num, 5.0)
    assertEquals(game("live")("matchesInProgress").num, 1.0)
    assertEquals(game("liveMatches").arr.head("matchId").str, "t2")

    val empty = get(api, "/stats/games/MEMORY").body
    assertEquals(empty("final")("matchesAnalyzed").num, 0.0)
  }

  test("responde OPTIONS para el preflight CORS") {
    assertEquals(Api(ResultStore(None)).handle(HttpRequest("OPTIONS", "/stats/overview", Map.empty, "")).status, 204)
  }
