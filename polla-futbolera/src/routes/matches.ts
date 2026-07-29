import { Router } from "express";
import { z } from "zod";
import { query, queryOne } from "../db";
import { settleMatch, MatchEngineError } from "../matchEngine";
import { requireAdmin } from "../auth";
import { Match } from "../types";

export const matchesRouter = Router();

const createMatchSchema = z.object({
  local_team: z.string().min(1),
  away_team: z.string().min(1),
  matchday: z.number().int().optional(),
  kickoff_at: z.string().datetime().optional().or(z.string().min(1).optional()),
});

const updateMatchSchema = createMatchSchema.partial();

const resultSchema = z.object({
  result: z.enum(["LOCAL", "EMPATE", "VISITA"]),
  // force=true se usa para CORREGIR un resultado ya cargado (revierte los
  // puntos viejos antes de aplicar los nuevos). Sin esto, un partido ya
  // finalizado no se puede volver a calificar (evita duplicar puntos).
  force: z.boolean().optional(),
});

// POST /matches -> crear un partido. Requiere admin.
matchesRouter.post("/", requireAdmin, async (req, res) => {
  const parsed = createMatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { local_team, away_team, matchday, kickoff_at } = parsed.data;

  const match = await queryOne(
    `INSERT INTO matches (local_team, away_team, matchday, kickoff_at)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [local_team, away_team, matchday ?? null, kickoff_at ?? null]
  );

  res.status(201).json(match);
});

// POST /matches/bulk -> crear varios partidos de una sola vez. Requiere admin.
// Body: { matches: [{ local_team, away_team, matchday? }, ...] }
const bulkMatchSchema = z.object({
  matches: z.array(createMatchSchema).min(1).max(200),
});

matchesRouter.post("/bulk", requireAdmin, async (req, res) => {
  const parsed = bulkMatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const created = [];
  for (const m of parsed.data.matches) {
    const match = await queryOne(
      `INSERT INTO matches (local_team, away_team, matchday, kickoff_at)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [m.local_team, m.away_team, m.matchday ?? null, m.kickoff_at ?? null]
    );
    created.push(match);
  }

  res.status(201).json({ message: `${created.length} partidos creados`, matches: created });
});

// GET /matches -> listar partidos (?status=SCHEDULED|FINISHED opcional)
matchesRouter.get("/", async (req, res) => {
  const { status } = req.query;
  const matches =
    status === "SCHEDULED" || status === "FINISHED"
      ? await query("SELECT * FROM matches WHERE status = $1 ORDER BY matchday, id", [status])
      : await query("SELECT * FROM matches ORDER BY matchday, id");
  res.json(matches);
});

// GET /matches/deadlines -> horarios límite de votación por fecha (público, lo usa la web)
matchesRouter.get("/deadlines", async (_req, res) => {
  const rows = await query("SELECT * FROM matchday_deadlines ORDER BY matchday");
  res.json(rows);
});

// GET /matches/:id -> detalle de un partido
matchesRouter.get("/:id", async (req, res) => {
  const match = await queryOne<Match>("SELECT * FROM matches WHERE id = $1", [req.params.id]);
  if (!match) return res.status(404).json({ error: "Partido no encontrado" });
  res.json(match);
});

// PUT /matches/:id -> actualizar datos de un partido (solo si no finalizó). Requiere admin.
matchesRouter.put("/:id", requireAdmin, async (req, res) => {
  const parsed = updateMatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const match = await queryOne<Match>("SELECT * FROM matches WHERE id = $1", [req.params.id]);
  if (!match) return res.status(404).json({ error: "Partido no encontrado" });
  if (match.status === "FINISHED") {
    return res.status(409).json({ error: "No se puede editar un partido ya finalizado" });
  }

  const updated = { ...match, ...parsed.data };
  const result = await queryOne(
    `UPDATE matches SET local_team = $1, away_team = $2, matchday = $3, kickoff_at = $4
     WHERE id = $5 RETURNING *`,
    [updated.local_team, updated.away_team, updated.matchday ?? null, updated.kickoff_at ?? null, match.id]
  );

  res.json(result);
});

// POST /matches/:id/result -> registrar (o corregir, con force:true) el resultado oficial.
// Requiere admin. Dispara el Match Engine.
matchesRouter.post("/:id/result", requireAdmin, async (req, res) => {
  const parsed = resultSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const outcome = await settleMatch(Number(req.params.id), parsed.data.result, {
      force: parsed.data.force,
    });
    res.json({
      message: outcome.wasCorrection ? "Resultado corregido correctamente" : "Partido calificado correctamente",
      ...outcome,
    });
  } catch (err) {
    if (err instanceof MatchEngineError) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: "Error al calificar el partido" });
  }
});
