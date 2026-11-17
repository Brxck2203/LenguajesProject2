package gamestats.server

import gamestats.model.AnalysisResult

import java.time.Instant
import java.util.concurrent.atomic.AtomicReference

/** Análisis provisional de una partida en curso. `revision` crece con cada snapshot de la misma partida. */
final case class PartialResult(revision: Int, updatedAt: Instant, result: AnalysisResult):
  def toJson: ujson.Obj = ujson.Obj(
    "matchId" -> result.matchId,
    "gameId" -> result.gameId,
    "revision" -> revision,
    "updatedAt" -> updatedAt.toString,
    "partial" -> true,
    "result" -> result.toJson
  )

enum PartialOutcome:
  case Updated(stored: PartialResult)
  case Unchanged(stored: PartialResult)
  /** Llegó un snapshot más viejo que el guardado: no se sobrescribe. */
  case Stale(current: PartialResult)

/** Snapshots parciales por `matchId`, separados de los resultados finales de [[ResultStore]].
  *
  * Un snapshot nunca cuenta como partida analizada: las estadísticas por juego leen solo los resultados finales.
  * Cuando la partida se cierra, su snapshot se elimina y el resultado definitivo lo reemplaza sin doble conteo.
  * Mismo esquema concurrente que [[ResultStore]]: un `Map` inmutable dentro de un `AtomicReference`.
  */
final class PartialStore:
  private val state = AtomicReference(Map.empty[String, PartialResult])

  def get(matchId: String): Option[PartialResult] = state.get().get(matchId)

  def all: List[PartialResult] = state.get().values.toList.sortBy(p => (p.result.gameId, p.result.matchId))

  /** Guarda el snapshot si su revisión es mayor que la actual. El cálculo solo se ejecuta si hace falta. */
  def offer(matchId: String, revision: Int, now: Instant)(analyze: => AnalysisResult): PartialOutcome =
    state.get().get(matchId) match
      case Some(current) if current.revision > revision  => PartialOutcome.Stale(current)
      case Some(current) if current.revision == revision => PartialOutcome.Unchanged(current)
      case _ =>
        val candidate = PartialResult(revision, now, analyze)
        val before = state.getAndUpdate { map =>
          map.get(matchId) match
            case Some(other) if other.revision >= revision => map // otro hilo guardó una revisión igual o mayor
            case _                                         => map.updated(matchId, candidate)
        }
        before.get(matchId) match
          case Some(other) if other.revision > revision  => PartialOutcome.Stale(other)
          case Some(other) if other.revision == revision => PartialOutcome.Unchanged(other)
          case _                                         => PartialOutcome.Updated(candidate)

  def remove(matchId: String): Unit =
    state.updateAndGet(_ - matchId)
