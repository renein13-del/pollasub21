import { pool, queryOne } from "./db";
import { Match, Pick1X2, Prediction } from "./types";

const POINTS_PER_HIT = 1;

export class MatchEngineError extends Error {}

/**
 * Registra el resultado oficial de un partido y califica los pronósticos.
 *
 * - Si el partido está SCHEDULED: lo califica por primera vez.
 * - Si el partido ya está FINISHED y `force` es true: es una CORRECCIÓN —
 *   primero revierte los puntos que ya se habían otorgado con el resultado
 *   viejo, y recién ahí aplica el resultado nuevo. Así nunca queda un
 *   usuario con puntos de más por un resultado cargado mal.
 * - Si ya está FINISHED y `force` es false: rechaza (evita duplicar puntos
 *   por error, por ejemplo un doble clic).
 */
export async function settleMatch(
  matchId: number,
  result: Pick1X2,
  options: { force?: boolean } = {}
): Promise<{ match: Match; gradedPredictions: number; winners: number; wasCorrection: boolean }> {
  const match = await queryOne<Match>("SELECT * FROM matches WHERE id = $1", [matchId]);

  if (!match) {
    throw new MatchEngineError(`El partido ${matchId} no existe`);
  }

  const wasCorrection = match.status === "FINISHED";

  if (wasCorrection && !options.force) {
    throw new MatchEngineError(
      `El partido ${matchId} ya fue calificado (resultado: ${match.result}). ` +
      `Si te equivocaste, usá la opción de corregir resultado.`
    );
  }

  const client = await pool.connect();
  let gradedPredictions = 0;
  let winners = 0;

  try {
    await client.query("BEGIN");

    if (wasCorrection) {
      // Revertir los puntos que ya se habían otorgado con el resultado anterior
      const { rows: previousPredictions } = await client.query<Prediction>(
        "SELECT * FROM predictions WHERE match_id = $1",
        [matchId]
      );
      for (const p of previousPredictions) {
        if (p.points_earned) {
          await client.query("UPDATE users SET total_points = total_points - $1 WHERE id = $2", [
            p.points_earned,
            p.user_id,
          ]);
        }
      }
    }

    // Registrar el (nuevo) resultado oficial y cerrar el partido
    await client.query(
      "UPDATE matches SET status = 'FINISHED', result = $1 WHERE id = $2",
      [result, matchId]
    );

    // Recalcular todos los pronósticos de este partido contra el resultado actual
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
    wasCorrection,
  };
}
