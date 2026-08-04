import "dotenv/config";
import express from "express";
import path from "path";
import { initSchema } from "./db";
import { authRouter } from "./routes/auth";
import { matchesRouter } from "./routes/matches";
import { predictionsRouter } from "./routes/predictions";
import { leaderboardRouter } from "./routes/leaderboard";
import { adminRouter } from "./routes/admin";
import { groupsRouter } from "./routes/groups";
import { specialRouter } from "./routes/special";
import { isApiFootballConfigured } from "./apiFootball";
import { syncLiveScores } from "./liveScores";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "❌ Falta la variable de entorno DATABASE_URL (conexión a PostgreSQL). " +
      "Revisá tu archivo .env o las variables de entorno del hosting."
    );
    process.exit(1);
  }

  if (!process.env.ADMIN_PASSWORD) {
    console.warn(
      "⚠️  No configuraste ADMIN_PASSWORD — el panel de administrador no va a poder iniciar sesión."
    );
  }

  const app = express();
  app.use(express.json());

  await initSchema();

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/auth", authRouter);
  app.use("/matches", matchesRouter);
  app.use("/predictions", predictionsRouter);
  app.use("/leaderboard", leaderboardRouter);
  app.use("/admin", adminRouter);
  app.use("/groups", groupsRouter);
  app.use("/special", specialRouter);

  // Web estática (registro/login, partidos, pronósticos, tabla de posiciones, admin)
  app.use(express.static(path.join(__dirname, "..", "public")));

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Polla Futbolera corriendo en http://localhost:${PORT}`);
  });

  // Resultados en tiempo real (API-Football): revisa cada N minutos los
  // partidos vinculados y los califica solo cuando terminan.
  if (isApiFootballConfigured()) {
    const pollMinutes = Number(process.env.LIVE_SCORES_POLL_MINUTES) || 3;
    console.log(`⚽ Sincronización de resultados en vivo activa cada ${pollMinutes} minuto(s).`);
    setInterval(() => {
      syncLiveScores().catch((err) => console.error("Error en sync de resultados en vivo:", err));
    }, pollMinutes * 60 * 1000);
  } else {
    console.log("ℹ️  API-Football no está configurada — los resultados se siguen cargando a mano.");
  }
}

main().catch((err) => {
  console.error("Error al iniciar el servidor:", err);
  process.exit(1);
});
