import crypto from "crypto";
import bcrypt from "bcryptjs";
import { Request, Response, NextFunction } from "express";
import { queryOne } from "./db";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

export interface AuthedRequest extends Request {
  userId?: number;
}

/**
 * Protege rutas que requieren un usuario logueado (cargar pronósticos, etc).
 * Espera el header: Authorization: Bearer <token>
 */
export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Necesitás iniciar sesión" });
  }

  try {
    const session = await queryOne<{ user_id: number }>(
      "SELECT user_id FROM sessions WHERE token = $1",
      [token]
    );

    if (!session) {
      return res.status(401).json({ error: "Sesión inválida o vencida, iniciá sesión de nuevo" });
    }

    req.userId = session.user_id;
    next();
  } catch {
    res.status(500).json({ error: "Error al verificar la sesión" });
  }
}

/**
 * Protege rutas de administrador (crear partidos, cargar resultados).
 * Usa una contraseña única definida en ADMIN_PASSWORD (.env), no un usuario normal.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Necesitás iniciar sesión como administrador" });
  }

  try {
    const session = await queryOne("SELECT id FROM admin_sessions WHERE token = $1", [token]);

    if (!session) {
      return res.status(401).json({ error: "Sesión de administrador inválida o vencida" });
    }

    next();
  } catch {
    res.status(500).json({ error: "Error al verificar la sesión de administrador" });
  }
}
