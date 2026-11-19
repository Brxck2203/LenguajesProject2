package gamestats.server

import gamestats.analytics.{AnalysisEngine, CrossMatchStats}
import gamestats.json.JsonCodec

import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.time.Clock

final case class HttpRequest(method: String, path: String, headers: Map[String, String], body: String):
  def header(name: String): Option[String] = headers.collectFirst {
    case (key, value) if key.equalsIgnoreCase(name) => value
  }

final case class HttpResponse(status: Int, body: ujson.Value, headers: Map[String, String] = Map.empty)

/** Rutas HTTP del módulo Scala como una función `HttpRequest => HttpResponse`.
  *
  * No depende del servidor concreto, por lo que se prueba sin abrir puertos. El único efecto es el registro en
  * [[ResultStore]].
  */
final class Api(store: ResultStore, clock: Clock = Clock.systemUTC(), partials: PartialStore = PartialStore()):

  private val routes = List(
    "GET /" -> "Índice de rutas",
    "GET /health" -> "Salud del servicio",
    "POST /analyze" -> "Analiza el lote de una partida cerrada (contrato con Go)",
    "GET /results" -> "Partidas analizadas",
    "GET /results/{matchId}" -> "Resultado completo de una partida",
    "GET /stats/games" -> "Resumen por juego de todas las partidas analizadas",
    "GET /stats/games/{gameId}/players" -> "Historial agregado de cada jugador en un juego",
    "GET /stats/games/{gameId}" -> "Resumen de un juego (finales) y sus partidas en curso",
    "GET /stats/overview" -> "Estadísticas generales de todos los juegos y partidas en curso",
    "POST /analyze/partial" -> "Analiza un snapshot de una partida en curso (no cuenta como partida analizada)",
    "GET /partial" -> "Snapshots de las partidas en curso",
    "GET /partial/{matchId}" -> "Snapshot más reciente de una partida en curso"
  )

  def handle(request: HttpRequest): HttpResponse =
    val segments = request.path.split('/').toList.filter(_.nonEmpty).map(decode)
    (request.method, segments) match
      case ("OPTIONS", _)                                  => HttpResponse(204, ujson.Null)
      case ("GET", Nil)                                    => index
      case ("GET", List("health"))                         => health
      case ("POST", List("analyze"))                       => analyze(request)
      case ("POST", List("analyze", "partial"))            => analyzePartial(request)
      case ("GET", List("partial"))                        => listPartials
      case ("GET", List("partial", matchId))               => partial(matchId)
      case ("GET", List("stats", "overview"))              => overview
      case ("GET", List("stats", "games", game))           => gameSummary(game)
      case ("GET", List("results"))                        => listResults
      case ("GET", List("results", matchId))               => result(matchId)
      case ("GET", List("stats", "games"))                 => gamesSummary
      case ("GET", List("stats", "games", game, "players")) => players(game)
      case (_, path) =>
        allowedMethod(path).fold(error(404, s"ruta no encontrada: ${request.path}"))(methodNotAllowed)

  private def allowedMethod(path: List[String]): Option[String] = path match
    case Nil | List("health") | List("results") | List("results", _) | List("stats", "games") => Some("GET")
    case List("stats", "games", _, "players") | List("stats", "games", _) | List("stats", "overview") => Some("GET")
    case List("partial") | List("partial", _)                                                 => Some("GET")
    case List("analyze") | List("analyze", "partial")                                         => Some("POST")
    case _                                                                                    => None

  private def index = HttpResponse(
    200,
    ujson.Obj(
      "service" -> "gamestats-scala-analytics",
      "supportedGames" -> ujson.Arr.from(AnalysisEngine.supportedGames),
      "routes" -> ujson.Arr.from(routes.map((route, text) => ujson.Obj("route" -> route, "description" -> text)))
    )
  )

  private def health = HttpResponse(
    200,
    ujson.Obj("status" -> "ok", "service" -> "scala-analytics", "analyzedMatches" -> store.all.size)
  )

  private def isJson(request: HttpRequest): Boolean =
    request.header("Content-Type").exists(_.toLowerCase.startsWith("application/json"))

  private def analyze(request: HttpRequest): HttpResponse =
    if !isJson(request) then error(415, "Content-Type debe ser application/json")
    else
      JsonCodec.decodeRequest(request.body) match
        case Left(message) => error(400, message)
        case Right(batch) =>
          val hash = ResultStore.sha256(request.body)
          // Si ya existe un resultado para esta partida no se recalcula (idempotencia).
          val outcome = store.get(batch.matchId) match
            case Some(existing) if existing.bodyHash == hash => RegisterOutcome.AlreadyExists(existing)
            case Some(existing)                              => RegisterOutcome.Conflict(existing)
            case None =>
              store.register(StoredResult(hash, clock.instant(), AnalysisEngine.analyze(batch)))
          // El resultado final reemplaza al snapshot parcial: la partida deja de estar "en curso".
          outcome match
            case RegisterOutcome.Created(_) | RegisterOutcome.AlreadyExists(_) => partials.remove(batch.matchId)
            case RegisterOutcome.Conflict(_)                                   => ()
          outcome match
            case RegisterOutcome.Created(stored)       => withKey(HttpResponse(200, stored.result.toJson), request)
            case RegisterOutcome.AlreadyExists(stored) =>
              withKey(HttpResponse(200, stored.result.toJson, Map("Idempotent-Replay" -> "true")), request)
            case RegisterOutcome.Conflict(_) =>
              error(409, s"la partida ${batch.matchId} ya fue analizada con un lote diferente")

  /** Snapshot de una partida abierta. La revisión por defecto es la cantidad de eventos (Go envía el acumulado). */
  private def analyzePartial(request: HttpRequest): HttpResponse =
    if !isJson(request) then error(415, "Content-Type debe ser application/json")
    else
      JsonCodec.decodePartialRequest(request.body) match
        case Left(message) => error(400, message)
        case Right((batch, _)) if store.get(batch.matchId).isDefined =>
          HttpResponse(
            409,
            ujson.Obj("error" -> s"la partida ${batch.matchId} ya tiene resultado final", "finalized" -> true)
          )
        case Right((batch, revision)) =>
          val rev = revision.getOrElse(batch.events.size)
          partials.offer(batch.matchId, rev, clock.instant())(AnalysisEngine.analyze(batch)) match
            case PartialOutcome.Updated(stored) => HttpResponse(200, stored.toJson)
            case PartialOutcome.Unchanged(stored) =>
              HttpResponse(200, stored.toJson, Map("Idempotent-Replay" -> "true"))
            case PartialOutcome.Stale(current) =>
              HttpResponse(
                409,
                ujson.Obj(
                  "error" -> s"revisión $rev más vieja que la guardada (${current.revision})",
                  "stale" -> true,
                  "currentRevision" -> current.revision
                )
              )

  private def listPartials = HttpResponse(
    200,
    ujson.Obj(
      "count" -> partials.all.size,
      "partials" -> ujson.Arr.from(partials.all.map { p =>
        ujson.Obj(
          "matchId" -> p.result.matchId,
          "gameId" -> p.result.gameId,
          "revision" -> p.revision,
          "updatedAt" -> p.updatedAt.toString,
          "eventCount" -> p.result.matchStats.value.getOrElse("eventCount", ujson.Null),
          "url" -> s"/partial/${p.result.matchId}"
        )
      })
    )
  )

  private def partial(matchId: String) =
    partials.get(matchId).fold(error(404, s"no hay snapshot en curso para $matchId"))(p => HttpResponse(200, p.toJson))

  private def overview = HttpResponse(
    200,
    CrossMatchStats.overview(store.all.map(_.result), partials.all.map(_.result), AnalysisEngine.supportedGames)
  )

  private def gameSummary(gameId: String) =
    val finals = store.all.map(_.result).filter(_.gameId == gameId)
    val live = partials.all.filter(_.result.gameId == gameId)
    HttpResponse(
      200,
      ujson.Obj(
        "gameId" -> gameId,
        "final" -> CrossMatchStats.gamesSummary(finals).value.getOrElse(gameId, CrossMatchStats.emptyGame),
        "live" -> CrossMatchStats.liveSummary(live.map(_.result)),
        "liveMatches" -> ujson.Arr.from(live.map { p =>
          ujson.Obj(
            "matchId" -> p.result.matchId,
            "revision" -> p.revision,
            "updatedAt" -> p.updatedAt.toString,
            "matchStats" -> p.result.matchStats
          )
        })
      )
    )

  private def withKey(response: HttpResponse, request: HttpRequest): HttpResponse =
    request.header("Idempotency-Key").fold(response)(key =>
      response.copy(headers = response.headers + ("Idempotency-Key" -> key))
    )

  private def listResults = HttpResponse(
    200,
    ujson.Obj(
      "count" -> store.all.size,
      "results" -> ujson.Arr.from(store.all.map { stored =>
        ujson.Obj(
          "matchId" -> stored.result.matchId,
          "gameId" -> stored.result.gameId,
          "analyzedAt" -> stored.analyzedAt.toString,
          "winner" -> stored.result.matchStats.value.getOrElse("winner", ujson.Null),
          "patterns" -> ujson.Arr.from(stored.result.patterns.map(_.name)),
          "url" -> s"/results/${stored.result.matchId}"
        )
      })
    )
  )

  private def result(matchId: String) =
    store.get(matchId).fold(error(404, s"no hay resultado para $matchId")) { stored =>
      HttpResponse(200, ujson.Obj("analyzedAt" -> stored.analyzedAt.toString, "result" -> stored.result.toJson))
    }

  private def gamesSummary = HttpResponse(200, CrossMatchStats.gamesSummary(store.all.map(_.result)))

  private def players(gameId: String) =
    HttpResponse(
      200,
      ujson.Obj("gameId" -> gameId, "players" -> CrossMatchStats.playersSummary(store.all.map(_.result), gameId))
    )

  private def methodNotAllowed(allow: String) =
    error(405, "método no permitido").copy(headers = Map("Allow" -> allow))

  private def error(status: Int, message: String) = HttpResponse(status, ujson.Obj("error" -> message))

  private def decode(segment: String): String = URLDecoder.decode(segment, StandardCharsets.UTF_8)
