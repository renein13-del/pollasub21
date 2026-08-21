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
import { sendPasswordResetEmail } from "../mailer";

export const authRouter = Router();

// Convierte "" (campo vacío del formulario) en undefined, para que el
// email siga siendo opcional sin que zod lo rechace por no ser un email válido.
const optionalEmail = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().toLowerCase().email().max(255).optional()
);

/* ============================================================
   Registro y login de usuarios
   ============================================================ */
const registerSchema = z.object({
  first_name: z.string().trim().min(1).max(40),
  last_name: z.string().trim().min(1).max(40),
  nickname: z.string().trim().min(2).max(20),
  password: z.string().min(6).max(72),
  group_code: z.string().trim().min(1),
  email: optionalEmail,
});

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { first_name, last_name, nickname, password, group_code, email } = parsed.data;

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
      `INSERT INTO users (first_name, last_name, nickname, password_hash, email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, first_name, last_name, nickname, total_points, email`,
      [first_name, last_name, nickname, password_hash, email ?? null]
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
      if (err.constraint === "users_email_key") {
        return res.status(409).json({ error: "Ese correo ya está en uso por otro carnet" });
      }
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
      email: string | null;
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
        email: user.email,
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
    "SELECT id, first_name, last_name, nickname, total_points, email FROM users WHERE id = $1",
    [req.userId]
  );
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  res.json(user);
});

/* ============================================================
   Email de contacto (para poder recuperar la contraseña más
   adelante) — el usuario ya logueado lo carga o actualiza.
   ============================================================ */
const setEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
});

authRouter.patch("/email", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = setEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Ingresá un correo válido" });
  }

  try {
    const user = await queryOne(
      `UPDATE users SET email = $1 WHERE id = $2
       RETURNING id, first_name, last_name, nickname, total_points, email`,
      [parsed.data.email, req.userId]
    );
    res.json(user);
  } catch (err: any) {
    if (String(err.message).includes("duplicate key")) {
      return res.status(409).json({ error: "Ese correo ya está en uso por otro carnet" });
    }
    res.status(500).json({ error: "Error al guardar el correo" });
  }
});

/* ============================================================
   Olvidé mi contraseña
   ============================================================ */
const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

const GENERIC_FORGOT_MSG =
  "Si ese correo está registrado en un carnet, te enviamos un enlace para restablecer tu contraseña. Revisá tu bandeja de entrada (y spam).";

authRouter.post("/forgot-password", async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Ingresá un correo válido" });
  }

  try {
    const user = await queryOne<{ id: number; nickname: string }>(
      "SELECT id, nickname FROM users WHERE email = $1",
      [parsed.data.email]
    );

    // Respuesta genérica siempre: no revelamos si el correo está registrado.
    if (user) {
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
      await query(
        "INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)",
        [user.id, token, expiresAt]
      );

      const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
      const resetUrl = `${baseUrl}/reset-password.html?token=${token}`;

      sendPasswordResetEmail(parsed.data.email, user.nickname, resetUrl).catch((err) => {
        console.error("Error al enviar el correo de recuperación:", err);
      });
    }

    res.json({ message: GENERIC_FORGOT_MSG });
  } catch {
    res.status(500).json({ error: "Error al procesar el pedido de recuperación" });
  }
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6).max(72),
});

authRouter.post("/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Faltan datos o la contraseña es muy corta (mínimo 6 caracteres)" });
  }

  const { token, password } = parsed.data;

  try {
    const reset = await queryOne<{ id: number; user_id: number }>(
      `SELECT id, user_id FROM password_resets
       WHERE token = $1 AND used_at IS NULL AND expires_at > now()`,
      [token]
    );

    if (!reset) {
      return res.status(400).json({
        error: "Ese enlace no es válido o ya venció. Pedí uno nuevo desde \"¿Olvidaste tu contraseña?\".",
      });
    }

    const password_hash = await hashPassword(password);

    await query("UPDATE users SET password_hash = $1 WHERE id = $2", [
      password_hash,
      reset.user_id,
    ]);
    await query("UPDATE password_resets SET used_at = now() WHERE id = $1", [reset.id]);
    // Cierra cualquier sesión abierta en otros dispositivos, por seguridad.
    await query("DELETE FROM sessions WHERE user_id = $1", [reset.user_id]);

    res.json({ message: "Contraseña actualizada. Ya podés iniciar sesión con tu nueva contraseña." });
  } catch {
    res.status(500).json({ error: "Error al restablecer la contraseña" });
  }
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
