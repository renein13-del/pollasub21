import { Router } from "express";
import { z } from "zod";
import { query, queryOne } from "../db";
import { requireAuth, AuthedRequest } from "../auth";

export const specialRouter = Router();

// GET /special/categories -> categorías, sus puntos y si ya se resolvieron (público)
specialRouter.get("/categories", async (_req, res) => {
  const rows = await query(
    "SELECT category, points, settled, correct_answer FROM special_categories ORDER BY category"
  );
  res.json(rows);
});

// GET /special/mine -> mis pronósticos especiales
specialRouter.get("/mine", requireAuth, async (req: AuthedRequest, res) => {
  const rows = await query("SELECT * FROM special_predictions WHERE user_id = $1", [req.userId]);
  res.json(rows);
});

const submitSchema = z.object({
  category: z.enum(["CAMPEON", "VICECAMPEON", "GOLEADOR"]),
  answer: z.string().trim().min(1).max(60),
});

// POST /special -> cargar o corregir mi pronóstico para una categoría (mientras no esté resuelta)
specialRouter.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Ingresá tu pronóstico" });
  }
  const { category, answer } = parsed.data;

  const cat = await queryOne<{ settled: boolean }>(
    "SELECT settled FROM special_categories WHERE category = $1",
    [category]
  );
  if (!cat) return res.status(404).json({ error: "Categoría no encontrada" });
  if (cat.settled) {
    return res.status(409).json({ error: "Esta categoría ya se resolvió, no se puede cambiar" });
  }

  const existing = await queryOne(
    "SELECT id FROM special_predictions WHERE user_id = $1 AND category = $2",
    [req.userId, category]
  );

  if (existing) {
    await query("UPDATE special_predictions SET answer = $1 WHERE id = $2", [answer, existing.id]);
  } else {
    await query(
      "INSERT INTO special_predictions (user_id, category, answer) VALUES ($1, $2, $3)",
      [req.userId, category, answer]
    );
  }

  const row = await queryOne(
    "SELECT * FROM special_predictions WHERE user_id = $1 AND category = $2",
    [req.userId, category]
  );
  res.status(existing ? 200 : 201).json(row);
});
