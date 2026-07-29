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
}

main().catch((err) => {
  console.error("Error al iniciar el servidor:", err);
  process.exit(1);
});
