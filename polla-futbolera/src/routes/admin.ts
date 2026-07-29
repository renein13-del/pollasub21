import { Router } from "express";
import { z } from "zod";
import { query, queryOne } from "../db";
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
