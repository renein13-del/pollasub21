import { Router } from "express";
import { query } from "../db";

export const leaderboardRouter = Router();

// GET /leaderboard -> ranking de usuarios por puntos totales (desc)
leaderboardRouter.get("/", async (_req, res) => {
  const rows = await query(
    `SELECT
       u.id AS user_id,
       u.first_name,
       u.last_name,
       u.nickname,
       u.total_points,
       COUNT(CASE WHEN p.points_earned = 1 THEN 1 END) AS aciertos,
       COUNT(CASE WHEN p.points_earned IS NOT NULL THEN 1 END) AS pronosticos_totales
     FROM users u
     LEFT JOIN predictions p ON p.user_id = u.id
     GROUP BY u.id
     ORDER BY u.total_points DESC, aciertos DESC, u.nickname ASC`
  );

  res.json(rows);
});
