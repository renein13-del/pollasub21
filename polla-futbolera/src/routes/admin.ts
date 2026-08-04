import { Router } from "express";
import { z } from "zod";
import { query, queryOne, pool } from "../db";
import { requireAdmin } from "../auth";
import { searchFixturesByDate, isApiFootballConfigured } from "../apiFootball";
import { syncLiveScores } from "../liveScores";

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// GET /admin/users -> listar usuarios para buscar a quién ajustarle puntos
adminRouter.get("/users", async (_req, res) => {
  const users = await query(
    "SELECT id, first_name, last_name, nickname, total_points, extra_hits, extra_matches FROM users ORDER BY nickname"
  );
  res.json(users);
});

// POST /admin/users/:id/points -> sumar (o restar, con número negativo) puntos manuales
// Sirve para cargar los puntajes que los usuarios ya tenían antes de usar el sistema.
const adjustPointsSchema = z.object({
  points: z.number().int(),
});

adminRouter.post("/users/:id/points", async (req, res) => {
  const parsed = adjustPointsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Mandá un número entero de puntos (puede ser negativo)" });
  }

  const user = await queryOne(
    "UPDATE users SET total_points = total_points + $1 WHERE id = $2 RETURNING id, first_name, last_name, nickname, total_points",
    [parsed.data.points, req.params.id]
  );

  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  res.json(user);
});

// POST /admin/users/:id/extra-stats -> fija (no suma) los aciertos y partidos jugados
// ANTES de usar el sistema, para que la tabla de posiciones muestre el conteo real
// de aciertos (ej: "5/18") en vez de solo los partidos cargados como registro individual.
const extraStatsSchema = z.object({
  extra_hits: z.number().int().min(0),
  extra_matches: z.number().int().min(0),
});

adminRouter.post("/users/:id/extra-stats", async (req, res) => {
  const parsed = extraStatsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Ingresá números enteros (0 o más) para aciertos y partidos previos" });
  }
  if (parsed.data.extra_hits > parsed.data.extra_matches) {
    return res.status(400).json({ error: "Los aciertos previos no pueden ser más que los partidos previos" });
  }

  const user = await queryOne(
    `UPDATE users SET extra_hits = $1, extra_matches = $2
     WHERE id = $3
     RETURNING id, first_name, last_name, nickname, total_points, extra_hits, extra_matches`,
    [parsed.data.extra_hits, parsed.data.extra_matches, req.params.id]
  );

  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  res.json(user);
});

// GET /admin/predictions?match_id=X -> ver quién ya tiene pronóstico cargado para ese partido
adminRouter.get("/predictions", async (req, res) => {
  const { match_id } = req.query;
  if (!match_id) return res.status(400).json({ error: "Falta match_id" });

  const rows = await query(
    `SELECT p.user_id, p.user_pick
     FROM predictions p
     WHERE p.match_id = $1`,
    [match_id]
  );
  res.json(rows);
});

// POST /admin/predictions -> cargar (o corregir) el pronóstico de un usuario a mano.
// Pensado para volcar los pronósticos que la gente ya había hecho por fuera del
// sistema, en un torneo que ya arrancó. No respeta el horario límite ni el estado
// del partido (a diferencia de POST /predictions, que es el que usan los propios
// usuarios) — es una carga manual del administrador.
const adminPredictionSchema = z.object({
  user_id: z.number().int(),
  match_id: z.number().int(),
  user_pick: z.enum(["LOCAL", "EMPATE", "VISITA"]),
});

adminRouter.post("/predictions", async (req, res) => {
  const parsed = adminPredictionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos" });
  }
  const { user_id, match_id, user_pick } = parsed.data;

  const match = await queryOne<{ status: string; result: string | null }>(
    "SELECT status, result FROM matches WHERE id = $1",
    [match_id]
  );
  if (!match) return res.status(404).json({ error: "Partido no encontrado" });

  const user = await queryOne("SELECT id FROM users WHERE id = $1", [user_id]);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existingRows } = await client.query(
      "SELECT * FROM predictions WHERE user_id = $1 AND match_id = $2",
      [user_id, match_id]
    );
    const existing = existingRows[0];

    // Si ya tenía puntos otorgados (se está corrigiendo un pronóstico cargado
    // mal en un partido ya finalizado), revertirlos antes de aplicar el nuevo.
    if (existing?.points_earned) {
      await client.query("UPDATE users SET total_points = total_points - $1 WHERE id = $2", [
        existing.points_earned,
        user_id,
      ]);
    }

    // Si el partido ya está finalizado, calificar el pronóstico al toque;
    // si todavía no, queda pendiente (se calificará cuando se cargue el resultado).
    const points_earned = match.status === "FINISHED" ? (match.result === user_pick ? 1 : 0) : null;

    if (existing) {
      await client.query("UPDATE predictions SET user_pick = $1, points_earned = $2 WHERE id = $3", [
        user_pick,
        points_earned,
        existing.id,
      ]);
    } else {
      await client.query(
        "INSERT INTO predictions (user_id, match_id, user_pick, points_earned) VALUES ($1, $2, $3, $4)",
        [user_id, match_id, user_pick, points_earned]
      );
    }

    if (points_earned) {
      await client.query("UPDATE users SET total_points = total_points + $1 WHERE id = $2", [
        points_earned,
        user_id,
      ]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const prediction = await queryOne(
    "SELECT * FROM predictions WHERE user_id = $1 AND match_id = $2",
    [user_id, match_id]
  );
  res.status(201).json(prediction);
});

/* ============================================================
   Pronósticos especiales (Campeón / Vicecampeón / Goleador)
   ============================================================ */

// GET /admin/special -> categorías + todos los pronósticos cargados, para revisar
adminRouter.get("/special", async (_req, res) => {
  const categories = await query("SELECT * FROM special_categories ORDER BY category");
  const predictions = await query(
    `SELECT sp.*, u.nickname
     FROM special_predictions sp
     JOIN users u ON u.id = sp.user_id
     ORDER BY sp.category, u.nickname`
  );
  res.json({ categories, predictions });
});

const settleSpecialSchema = z.object({
  correct_answer: z.string().trim().min(1).max(60),
});

// POST /admin/special/:category/settle -> cargar (o corregir) la respuesta correcta
// y calificar automáticamente a todos los que pronosticaron esa categoría.
adminRouter.post("/special/:category/settle", async (req, res) => {
  const category = req.params.category.toUpperCase();
  const parsed = settleSpecialSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Ingresá la respuesta correcta" });
  }

  const cat = await queryOne<{ category: string; points: number }>(
    "SELECT * FROM special_categories WHERE category = $1",
    [category]
  );
  if (!cat) return res.status(404).json({ error: "Categoría no encontrada" });

  const normalize = (s: string) => s.trim().toLowerCase();
  const correctAnswer = parsed.data.correct_answer;
  const correctNorm = normalize(correctAnswer);

  const client = await pool.connect();
  let winners = 0;
  let total = 0;

  try {
    await client.query("BEGIN");

    const { rows: predictions } = await client.query(
      "SELECT * FROM special_predictions WHERE category = $1",
      [category]
    );

    // Si ya estaba resuelta antes (se está corrigiendo), revertir los puntos viejos primero
    for (const p of predictions) {
      if (p.points_earned) {
        await client.query("UPDATE users SET total_points = total_points - $1 WHERE id = $2", [
          p.points_earned,
          p.user_id,
        ]);
      }
    }

    await client.query(
      "UPDATE special_categories SET correct_answer = $1, settled = true WHERE category = $2",
      [correctAnswer, category]
    );

    for (const p of predictions) {
      const hit = normalize(p.answer) === correctNorm;
      const points = hit ? cat.points : 0;

      await client.query("UPDATE special_predictions SET points_earned = $1 WHERE id = $2", [
        points,
        p.id,
      ]);

      if (hit) {
        await client.query("UPDATE users SET total_points = total_points + $1 WHERE id = $2", [
          cat.points,
          p.user_id,
        ]);
        winners += 1;
      }
    }

    total = predictions.length;
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  res.json({ message: "Categoría calificada", winners, total });
});

/* ============================================================
   Grupos de amigos (mini-ligas)
   ============================================================ */
function generateGroupCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const createGroupSchema = z.object({
  name: z.string().trim().min(2).max(40),
});

// POST /admin/groups -> crear un grupo de amigos, devuelve el código de invitación
adminRouter.post("/groups", async (req, res) => {
  const parsed = createGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Ingresá un nombre de grupo" });
  }

  let code = generateGroupCode();
  // Reintenta si por casualidad el código ya existe (muy improbable, pero por las dudas)
  for (let i = 0; i < 5; i++) {
    const existing = await queryOne("SELECT id FROM groups WHERE code = $1", [code]);
    if (!existing) break;
    code = generateGroupCode();
  }

  const group = await queryOne(
    "INSERT INTO groups (name, code) VALUES ($1, $2) RETURNING *",
    [parsed.data.name, code]
  );

  res.status(201).json(group);
});

// GET /admin/groups -> listar todos los grupos con cantidad de miembros
adminRouter.get("/groups", async (_req, res) => {
  const groups = await query(
    `SELECT g.id, g.name, g.code, COUNT(gm.user_id) AS miembros
     FROM groups g
     LEFT JOIN group_members gm ON gm.group_id = g.id
     GROUP BY g.id
     ORDER BY g.created_at`
  );
  res.json(groups);
});

// GET /admin/groups/:id/members -> usuarios de un grupo puntual (para filtrar
// "Cargar puntos" y "Cargar pronósticos ya hechos")
adminRouter.get("/groups/:id/members", async (req, res) => {
  const rows = await query(
    `SELECT u.id, u.first_name, u.last_name, u.nickname, u.total_points
     FROM users u
     JOIN group_members gm ON gm.user_id = u.id
     WHERE gm.group_id = $1
     ORDER BY u.nickname`,
    [req.params.id]
  );
  res.json(rows);
});

/* ============================================================
   Horario límite para votar, por fecha/jornada
   ============================================================ */
const deadlineSchema = z.object({
  vote_deadline: z.string().min(1), // viene de un <input type="datetime-local">
});

// POST /admin/matchdays/:matchday/deadline -> crea o actualiza el horario límite de esa fecha
adminRouter.post("/matchdays/:matchday/deadline", async (req, res) => {
  const matchday = Number(req.params.matchday);
  if (!Number.isInteger(matchday) || matchday < 1) {
    return res.status(400).json({ error: "Número de fecha inválido" });
  }

  const parsed = deadlineSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Ingresá una fecha y hora válida" });
  }

  const deadlineDate = new Date(parsed.data.vote_deadline);
  if (Number.isNaN(deadlineDate.getTime())) {
    return res.status(400).json({ error: "Fecha y hora inválida" });
  }

  const row = await queryOne(
    `INSERT INTO matchday_deadlines (matchday, vote_deadline)
     VALUES ($1, $2)
     ON CONFLICT (matchday) DO UPDATE SET vote_deadline = EXCLUDED.vote_deadline
     RETURNING *`,
    [matchday, deadlineDate.toISOString()]
  );

  res.json(row);
});

// GET /admin/matchdays -> listar todos los horarios límite cargados
adminRouter.get("/matchdays", async (_req, res) => {
  const rows = await query("SELECT * FROM matchday_deadlines ORDER BY matchday");
  res.json(rows);
});

// DELETE /admin/matchdays/:matchday/deadline -> quitar el límite de esa fecha (vuelve a estar sin restricción)
adminRouter.delete("/matchdays/:matchday/deadline", async (req, res) => {
  await query("DELETE FROM matchday_deadlines WHERE matchday = $1", [req.params.matchday]);
  res.json({ message: "Horario límite eliminado" });
});

/* ============================================================
   Horario límite para los pronósticos especiales
   ============================================================ */
const specialDeadlineSchema = z.object({ deadline: z.string().min(1) });

adminRouter.post("/special/deadline", async (req, res) => {
  const parsed = specialDeadlineSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Ingresá una fecha y hora válida" });

  const deadlineDate = new Date(parsed.data.deadline);
  if (Number.isNaN(deadlineDate.getTime())) {
    return res.status(400).json({ error: "Fecha y hora inválida" });
  }

  const row = await queryOne(
    `INSERT INTO special_deadline (id, deadline) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET deadline = EXCLUDED.deadline
     RETURNING *`,
    [deadlineDate.toISOString()]
  );
  res.json(row);
});

adminRouter.delete("/special/deadline", async (_req, res) => {
  await query("DELETE FROM special_deadline WHERE id = 1");
  res.json({ message: "Horario límite eliminado" });
});

/* ============================================================
   Resultados en tiempo real (API-Football)
   ============================================================ */

// GET /admin/live-scores/status -> si la integración está configurada
adminRouter.get("/live-scores/status", (_req, res) => {
  res.json({ configured: isApiFootballConfigured() });
});

// GET /admin/matches/:id/search-fixtures?date=YYYY-MM-DD -> buscar partidos
// reales de esa fecha en API-Football, para elegir el fixture correcto sin
// tener que escribir el ID a mano.
adminRouter.get("/matches/:id/search-fixtures", async (req, res) => {
  const { date } = req.query;
  if (!date || typeof date !== "string") {
    return res.status(400).json({ error: "Falta la fecha (YYYY-MM-DD)" });
  }
  if (!isApiFootballConfigured()) {
    return res.status(400).json({ error: "API-Football no está configurada (revisá las variables de entorno)" });
  }

  try {
    const fixtures = await searchFixturesByDate(date);
    res.json(fixtures);
  } catch (err: any) {
    res.status(502).json({ error: `No se pudo consultar la API: ${err.message}` });
  }
});

// POST /admin/matches/:id/link-fixture -> vincular un partido con un fixture de API-Football
const linkFixtureSchema = z.object({ api_fixture_id: z.number().int() });

adminRouter.post("/matches/:id/link-fixture", async (req, res) => {
  const parsed = linkFixtureSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Falta el ID del fixture" });

  const match = await queryOne(
    "UPDATE matches SET api_fixture_id = $1 WHERE id = $2 RETURNING *",
    [parsed.data.api_fixture_id, req.params.id]
  );
  if (!match) return res.status(404).json({ error: "Partido no encontrado" });
  res.json(match);
});

// DELETE /admin/matches/:id/link-fixture -> desvincular
adminRouter.delete("/matches/:id/link-fixture", async (req, res) => {
  const match = await queryOne(
    "UPDATE matches SET api_fixture_id = NULL, live_home_score = NULL, live_away_score = NULL, live_status = NULL WHERE id = $1 RETURNING *",
    [req.params.id]
  );
  if (!match) return res.status(404).json({ error: "Partido no encontrado" });
  res.json(match);
});

// POST /admin/live-scores/sync -> forzar una sincronización ahora mismo (además
// de la que corre sola cada pocos minutos)
adminRouter.post("/live-scores/sync", async (_req, res) => {
  try {
    const result = await syncLiveScores();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   Reparar pronósticos "huérfanos" (quedaron sin calificar por una
   condición de carrera entre un pronóstico y la carga del resultado)
   ============================================================ */

// GET /admin/orphaned-predictions -> cuántos hay y de quién, antes de reparar
adminRouter.get("/orphaned-predictions", async (_req, res) => {
  const rows = await query(
    `SELECT p.id, u.nickname, m.local_team, m.away_team, m.matchday, p.user_pick, m.result
     FROM predictions p
     JOIN matches m ON m.id = p.match_id
     JOIN users u ON u.id = p.user_id
     WHERE p.points_earned IS NULL AND m.status = 'FINISHED'
     ORDER BY u.nickname`
  );
  res.json(rows);
});

// POST /admin/orphaned-predictions/repair -> califica esos pronósticos y
// suma los puntos que correspondan (una sola vez, no duplica si se corre de nuevo)
adminRouter.post("/orphaned-predictions/repair", async (_req, res) => {
  const client = await pool.connect();
  let repaired = 0;
  let pointsAwarded = 0;

  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{
      id: number;
      user_id: number;
      user_pick: string;
      result: string;
    }>(
      `SELECT p.id, p.user_id, p.user_pick, m.result
       FROM predictions p
       JOIN matches m ON m.id = p.match_id
       WHERE p.points_earned IS NULL AND m.status = 'FINISHED'
       FOR UPDATE OF p`
    );

    for (const p of rows) {
      const points = p.user_pick === p.result ? 1 : 0;
      await client.query("UPDATE predictions SET points_earned = $1 WHERE id = $2", [
        points,
        p.id,
      ]);
      if (points) {
        await client.query("UPDATE users SET total_points = total_points + $1 WHERE id = $2", [
          points,
          p.user_id,
        ]);
        pointsAwarded += points;
      }
      repaired += 1;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  res.json({ repaired, pointsAwarded });
});

/* ============================================================
   Matriz de votos por fecha (usuarios x partidos, para ver todo de un vistazo)
   ============================================================ */

// GET /admin/matchdays-list -> lista de fechas que tienen partidos cargados
adminRouter.get("/matchdays-list", async (_req, res) => {
  const rows = await query<{ matchday: number }>(
    "SELECT DISTINCT matchday FROM matches WHERE matchday IS NOT NULL ORDER BY matchday"
  );
  res.json(rows.map((r) => r.matchday));
});

// GET /admin/votes-matrix?matchday=X -> partidos de esa fecha, todos los usuarios,
// y el pronóstico de cada uno (o nada) para cada partido.
adminRouter.get("/votes-matrix", async (req, res) => {
  const { matchday } = req.query;
  if (!matchday) return res.status(400).json({ error: "Falta la fecha" });

  const matches = await query(
    "SELECT id, local_team, away_team, status, result FROM matches WHERE matchday = $1 ORDER BY id",
    [matchday]
  );

  const users = await query("SELECT id, nickname FROM users ORDER BY nickname");

  const predictions = await query(
    `SELECT p.user_id, p.match_id, p.user_pick
     FROM predictions p
     JOIN matches m ON m.id = p.match_id
     WHERE m.matchday = $1`,
    [matchday]
  );

  res.json({ matches, users, predictions });
});
