import "dotenv/config";
import { pool, initSchema, query } from "./index";
import { hashPassword } from "../auth";

async function seed() {
  await initSchema();

  const demoUsers = [
    { first_name: "Juan", last_name: "Benítez", nickname: "Juancho" },
    { first_name: "María", last_name: "Ortiz", nickname: "Mari" },
    { first_name: "Carlos", last_name: "Fernández", nickname: "Carlitos" },
  ];

  for (const u of demoUsers) {
    const password_hash = await hashPassword("demo1234");
    await query(
      `INSERT INTO users (first_name, last_name, nickname, password_hash)
       VALUES ($1, $2, $3, $4) ON CONFLICT (nickname) DO NOTHING`,
      [u.first_name, u.last_name, u.nickname, password_hash]
    );
  }

  await query(
    `INSERT INTO matches (local_team, away_team, matchday) VALUES ($1, $2, $3)`,
    ["Olimpia", "Cerro Porteño", 1]
  );
  await query(
    `INSERT INTO matches (local_team, away_team, matchday) VALUES ($1, $2, $3)`,
    ["Libertad", "Guaraní", 1]
  );
  await query(
    `INSERT INTO matches (local_team, away_team, matchday) VALUES ($1, $2, $3)`,
    ["Nacional", "Sportivo Luqueño", 1]
  );

  console.log("Seed cargado: 3 usuarios (contraseña 'demo1234') y 3 partidos de ejemplo.");
  await pool.end();
}

seed();
