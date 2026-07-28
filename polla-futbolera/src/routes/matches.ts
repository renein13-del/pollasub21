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
});

// POST /matches -> crear partido (ej: Olimpia vs Cerro Porteño). Requiere admin.
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

// GET /matches -> listar partidos (?status=SCHEDULED|FINISHED opcional)
matchesRouter.get("/", async (req, res) => {
  const { status } = req.query;
  const matches =
    status === "SCHEDULED" || status === "FINISHED"
      ? await query("SELECT * FROM matches WHERE status = $1 ORDER BY id", [status])
      : await query("SELECT * FROM matches ORDER BY id");
  res.json(matches);
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

// POST /matches/:id/result -> registrar resultado oficial y disparar el Match Engine. Requiere admin.
matchesRouter.post("/:id/result", requireAdmin, async (req, res) => {
  const parsed = resultSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const outcome = await settleMatch(Number(req.params.id), parsed.data.result);
    res.json({ message: "Partido calificado correctamente", ...outcome });
  } catch (err) {
    if (err instanceof MatchEngineError) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: "Error al calificar el partido" });
  }
});
