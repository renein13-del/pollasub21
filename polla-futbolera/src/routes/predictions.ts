import { Router } from "express";
import { z } from "zod";
import { pool, query, queryOne } from "../db";
import { requireAuth, AuthedRequest } from "../auth";
import { Match, Prediction } from "../types";

export const predictionsRouter = Router();

const createPredictionSchema = z.object({
  match_id: z.number().int(),
  user_pick: z.enum(["LOCAL", "EMPATE", "VISITA"]),
});

// POST /predictions -> registrar (o corregir) el pronóstico del usuario logueado
// Requiere estar autenticado (Authorization: Bearer <token>).
// Solo se permite mientras el partido esté SCHEDULED (antes del inicio).
//
// Usa "SELECT ... FOR UPDATE" sobre el partido para evitar una condición de
// carrera: si el administrador está calificando este mismo partido justo en
// este momento, una de las dos operaciones espera a la otra en vez de que el
// pronóstico quede guardado sin compararse nunca contra el resultado.
predictionsRouter.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = createPredictionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { match_id, user_pick } = parsed.data;
  const user_id = req.userId!;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: matchRows } = await client.query<Match>(
      "SELECT * FROM matches WHERE id = $1 FOR UPDATE",
      [match_id]
    );
    const match = matchRows[0];

    if (!match) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Partido no encontrado" });
    }

    if (match.status !== "SCHEDULED") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "No se pueden cargar/editar pronósticos de un partido ya finalizado",
      });
    }

    if (match.matchday != null) {
      const { rows: deadlineRows } = await client.query<{ vote_deadline: string }>(
        "SELECT vote_deadline FROM matchday_deadlines WHERE matchday = $1",
        [match.matchday]
      );
      const deadline = deadlineRows[0];
      if (deadline && new Date() >= new Date(deadline.vote_deadline)) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: `Ya pasó el horario límite para votar en la fecha ${match.matchday}.`,
        });
      }
    }

    // Upsert: si el usuario ya pronosticó este partido, se actualiza su pick
    const { rows: existingRows } = await client.query<Prediction>(
      "SELECT * FROM predictions WHERE user_id = $1 AND match_id = $2",
      [user_id, match_id]
    );
    const existing = existingRows[0];

    if (existing) {
      await client.query("UPDATE predictions SET user_pick = $1 WHERE id = $2", [
        user_pick,
        existing.id,
      ]);
    } else {
      await client.query(
        "INSERT INTO predictions (user_id, match_id, user_pick) VALUES ($1, $2, $3)",
        [user_id, match_id, user_pick]
      );
    }

    await client.query("COMMIT");

    const prediction = await queryOne(
      "SELECT * FROM predictions WHERE user_id = $1 AND match_id = $2",
      [user_id, match_id]
    );
    res.status(existing ? 200 : 201).json(prediction);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// GET /predictions/mine -> historial de pronósticos del usuario logueado
predictionsRouter.get("/mine", requireAuth, async (req: AuthedRequest, res) => {
  const predictions = await query(
    `SELECT p.*, m.local_team, m.away_team, m.status as match_status, m.result as match_result
     FROM predictions p
     JOIN matches m ON m.id = p.match_id
     WHERE p.user_id = $1
     ORDER BY p.id DESC`,
    [req.userId]
  );
  res.json(predictions);
});

// GET /predictions/match/:matchId -> todos los pronósticos de un partido (requiere sesión)
predictionsRouter.get("/match/:matchId", requireAuth, async (req, res) => {
  const predictions = await query("SELECT * FROM predictions WHERE match_id = $1", [
    req.params.matchId,
  ]);
  res.json(predictions);
});

// GET /predictions/matchday/:matchday -> comparar los pronósticos de todos para una fecha.
// Se habilita recién cuando "arranca la fecha": venció el horario límite de esa
// fecha, o al menos uno de sus partidos ya está en curso/finalizado. Antes de eso,
// nadie puede ver lo que votaron los demás (para no influenciar el propio voto).
predictionsRouter.get("/matchday/:matchday", requireAuth, async (req, res) => {
  const matchday = Number(req.params.matchday);
  if (!Number.isInteger(matchday)) {
    return res.status(400).json({ error: "Fecha inválida" });
  }

  const matches = await query<{ id: number; status: string }>(
    "SELECT id, status FROM matches WHERE matchday = $1",
    [matchday]
  );
  if (!matches.length) {
    return res.status(404).json({ error: "No hay partidos cargados en esa fecha" });
  }

  const deadline = await queryOne<{ vote_deadline: string }>(
    "SELECT vote_deadline FROM matchday_deadlines WHERE matchday = $1",
    [matchday]
  );
  const deadlinePassed = deadline ? new Date() >= new Date(deadline.vote_deadline) : false;
  const anyStartedOrFinished = matches.some((m) => m.status === "FINISHED");

  if (!deadlinePassed && !anyStartedOrFinished) {
    return res.status(403).json({
      error: "La comparación se habilita recién cuando arranca la fecha (o vence el horario límite de votación).",
    });
  }

  const rows = await query(
    `SELECT p.match_id, p.user_pick, u.nickname
     FROM predictions p
     JOIN users u ON u.id = p.user_id
     JOIN matches m ON m.id = p.match_id
     WHERE m.matchday = $1
     ORDER BY u.nickname`,
    [matchday]
  );

  res.json(rows);
});
