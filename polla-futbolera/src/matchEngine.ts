import { pool, queryOne } from "./db";
import { Match, Pick1X2, Prediction } from "./types";

const POINTS_PER_HIT = 1;

export class MatchEngineError extends Error {}

/**
 * Registra el resultado oficial de un partido y dispara la calificación
 * automática de todos los pronósticos asociados.
 *
 * Es idempotente a nivel de partido: si el partido ya está FINISHED,
 * no se vuelve a calificar (evita duplicar puntos si se llama dos veces).
 */
export async function settleMatch(
  matchId: number,
  result: Pick1X2
): Promise<{ match: Match; gradedPredictions: number; winners: number }> {
  const match = await queryOne<Match>("SELECT * FROM matches WHERE id = $1", [matchId]);

  if (!match) {
    throw new MatchEngineError(`El partido ${matchId} no existe`);
  }

  if (match.status === "FINISHED") {
    throw new MatchEngineError(
      `El partido ${matchId} ya fue calificado (resultado: ${match.result})`
    );
  }

  const client = await pool.connect();
  let gradedPredictions = 0;
  let winners = 0;

  try {
    await client.query("BEGIN");

    // 1) Registrar el resultado oficial y cerrar el partido
    await client.query(
      "UPDATE matches SET status = 'FINISHED', result = $1 WHERE id = $2",
      [result, matchId]
    );

    // 2) Traer todos los pronósticos cargados para este partido
    const { rows: predictions } = await client.query<Prediction>(
      "SELECT * FROM predictions WHERE match_id = $1",
      [matchId]
    );

    for (const prediction of predictions) {
      const hit = prediction.user_pick === result;
      const points = hit ? POINTS_PER_HIT : 0;

      await client.query("UPDATE predictions SET points_earned = $1 WHERE id = $2", [
        points,
        prediction.id,
      ]);

      if (hit) {
        await client.query(
          "UPDATE users SET total_points = total_points + $1 WHERE id = $2",
          [POINTS_PER_HIT, prediction.user_id]
        );
        winners += 1;
      }
    }

    gradedPredictions = predictions.length;

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const updatedMatch = await queryOne<Match>("SELECT * FROM matches WHERE id = $1", [matchId]);

  return {
    match: updatedMatch!,
    gradedPredictions,
    winners,
  };
}
