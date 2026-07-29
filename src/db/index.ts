import { Pool } from "pg";
import fs from "fs";
import path from "path";

const SCHEMA_PATH = path.join(__dirname, "..", "..", "schema.sql");

// En Render (y la mayoría de los hostings) hay que aceptar el certificado SSL
// que da el proveedor; en localhost normalmente no hace falta.
const isLocal = (process.env.DATABASE_URL || "").includes("localhost");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

/** Ejecuta un SELECT/INSERT/UPDATE y devuelve las filas. */
export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

/** Igual que query, pero devuelve solo la primera fila (o undefined). */
export async function queryOne<T = any>(text: string, params: any[] = []): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

/** Crea las tablas si no existen. Se ejecuta al levantar el servidor. */
export async function initSchema(): Promise<void> {
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  await pool.query(schema);
}
