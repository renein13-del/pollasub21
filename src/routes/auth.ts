import { Router } from "express";
import { z } from "zod";
import { query, queryOne } from "../db";
import {
  hashPassword,
  verifyPassword,
  generateToken,
  requireAuth,
  AuthedRequest,
} from "../auth";

export const authRouter = Router();

/* ============================================================
   Registro y login de usuarios
   ============================================================ */
const registerSchema = z.object({
  first_name: z.string().trim().min(1).max(40),
  last_name: z.string().trim().min(1).max(40),
  nickname: z.string().trim().min(2).max(20),
  password: z.string().min(6).max(72),
  group_code: z.string().trim().min(1),
});

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { first_name, last_name, nickname, password, group_code } = parsed.data;

  // Verificar el código de grupo ANTES de crear el usuario, para no crear
  // cuentas "huérfanas" si el código está mal escrito.
  const group = await queryOne<{ id: number; name: string }>(
    "SELECT id, name FROM groups WHERE code = $1",
    [group_code.toUpperCase()]
  );
  if (!group) {
    return res.status(404).json({
      error: "Ese código de grupo no existe. Pedile el código correcto a quien organiza tu grupo.",
    });
  }

  try {
    const password_hash = await hashPassword(password);

    const user = await queryOne(
      `INSERT INTO users (first_name, last_name, nickname, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, first_name, last_name, nickname, total_points`,
      [first_name, last_name, nickname, password_hash]
    );

    const token = generateToken();
    await query("INSERT INTO sessions (user_id, token) VALUES ($1, $2)", [
      user!.id,
      token,
    ]);
    await query("INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)", [
      group.id,
      user!.id,
    ]);

    res.status(201).json({ user, token, group });
  } catch (err: any) {
    if (String(err.message).includes("duplicate key")) {
      return res.status(409).json({ error: "Ese sobrenombre ya está en uso" });
    }
    res.status(500).json({ error: "Error al crear usuario" });
  }
});

const loginSchema = z.object({
  nickname: z.string().trim().min(1),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Ingresá sobrenombre y contraseña" });
  }

  const { nickname, password } = parsed.data;

  try {
    const user = await queryOne<{
      id: number;
      first_name: string;
      last_name: string;
      nickname: string;
      password_hash: string;
      total_points: number;
    }>("SELECT * FROM users WHERE nickname = $1", [nickname]);

    // Mensaje genérico a propósito: no revelar si el sobrenombre existe o no.
    const invalidMsg = { error: "Sobrenombre o contraseña incorrectos" };
    if (!user) return res.status(401).json(invalidMsg);

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json(invalidMsg);

    const token = generateToken();
    await query("INSERT INTO sessions (user_id, token) VALUES ($1, $2)", [
      user.id,
      token,
    ]);

    res.json({
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        nickname: user.nickname,
        total_points: user.total_points,
      },
      token,
    });
  } catch {
    res.status(500).json({ error: "Error al iniciar sesión" });
  }
});

// GET /auth/me -> perfil del usuario logueado (a partir del token)
authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await queryOne(
    "SELECT id, first_name, last_name, nickname, total_points FROM users WHERE id = $1",
    [req.userId]
  );
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  res.json(user);
});

authRouter.post("/logout", requireAuth, async (req, res) => {
  const token = req.headers.authorization!.slice("Bearer ".length);
  await query("DELETE FROM sessions WHERE token = $1", [token]);
  res.json({ message: "Sesión cerrada" });
});

/* ============================================================
   Login de administrador (una sola contraseña, definida en .env)
   ============================================================ */
const adminLoginSchema = z.object({ password: z.string().min(1) });

authRouter.post("/admin/login", async (req, res) => {
  const parsed = adminLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Ingresá la contraseña de administrador" });
  }

  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({
      error: "El servidor no tiene configurada ADMIN_PASSWORD (revisá las variables de entorno)",
    });
  }

  if (parsed.data.password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Contraseña de administrador incorrecta" });
  }

  const token = generateToken();
  await query("INSERT INTO admin_sessions (token) VALUES ($1)", [token]);
  res.json({ token });
});

authRouter.post("/admin/logout", async (req, res) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) await query("DELETE FROM admin_sessions WHERE token = $1", [token]);
  res.json({ message: "Sesión de administrador cerrada" });
});
