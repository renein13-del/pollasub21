import { Router } from "express";
import { z } from "zod";
import { query, queryOne, pool } from "../db";
import { requireAdmin } from "../auth";

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// GET /admin/users -> listar usuarios para buscar a quién ajustarle puntos
adminRouter.get("/users", async (_req, res) => {
  const users = await query(
    "SELECT id, first_name, last_name, nickname, total_points FROM users ORDER BY nickname"
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
