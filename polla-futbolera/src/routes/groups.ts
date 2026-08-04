import { Router } from "express";
import { z } from "zod";
import { query, queryOne } from "../db";
import { requireAuth, AuthedRequest } from "../auth";

export const groupsRouter = Router();

// GET /groups/mine -> grupos a los que pertenece el usuario logueado
groupsRouter.get("/mine", requireAuth, async (req: AuthedRequest, res) => {
  const groups = await query(
    `SELECT g.id, g.name, g.code
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = $1
     ORDER BY g.name`,
    [req.userId]
  );
  res.json(groups);
});

// POST /groups/join -> unirse a un grupo con el código que dio el administrador
const joinSchema = z.object({ code: z.string().trim().min(1) });

groupsRouter.post("/join", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Ingresá el código del grupo" });

  const group = await queryOne<{ id: number; name: string; code: string }>(
    "SELECT * FROM groups WHERE code = $1",
    [parsed.data.code.toUpperCase()]
  );

  if (!group) return res.status(404).json({ error: "No existe ningún grupo con ese código" });

  await query(
    "INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [group.id, req.userId]
  );

  res.status(201).json(group);
});

// GET /groups/:id/leaderboard -> tabla de posiciones solo entre los miembros de ese grupo
// (requiere ser miembro del grupo para verla)
groupsRouter.get("/:id/leaderboard", requireAuth, async (req: AuthedRequest, res) => {
  const membership = await queryOne(
    "SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2",
    [req.params.id, req.userId]
  );
  if (!membership) {
    return res.status(403).json({ error: "No pertenecés a este grupo" });
  }

  const rows = await query(
    `SELECT
       u.id AS user_id,
       u.first_name,
       u.last_name,
       u.nickname,
       u.total_points,
       COUNT(CASE WHEN p.points_earned = 1 THEN 1 END) + u.extra_hits AS aciertos,
       COUNT(CASE WHEN p.points_earned IS NOT NULL THEN 1 END) + u.extra_matches AS pronosticos_totales
     FROM users u
     JOIN group_members gm ON gm.user_id = u.id AND gm.group_id = $1
     LEFT JOIN predictions p ON p.user_id = u.id
     GROUP BY u.id
     ORDER BY u.total_points DESC, aciertos DESC, u.nickname ASC`,
    [req.params.id]
  );

  res.json(rows);
});
