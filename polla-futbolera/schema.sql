-- ============================================================
-- Esquema: Polla Futbolera 1X2 (Liga de Fútbol Paraguayo)
-- PostgreSQL (pensado para desplegarse en Render)
-- ============================================================

-- Usuarios que participan de la polla
-- El sobrenombre (nickname) es el identificador público único que se
-- muestra en la tabla de posiciones. password_hash nunca se envía al cliente.
CREATE TABLE IF NOT EXISTS users (
    id             SERIAL PRIMARY KEY,
    first_name     TEXT NOT NULL,
    last_name      TEXT NOT NULL,
    nickname       TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    total_points   INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sesiones de usuarios logueados (token simple tipo "bearer")
CREATE TABLE IF NOT EXISTS sessions (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sesiones de administrador (una sola contraseña compartida, definida en .env)
CREATE TABLE IF NOT EXISTS admin_sessions (
    id          SERIAL PRIMARY KEY,
    token       TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partidos del torneo
-- status:  SCHEDULED  -> aún no se jugó / no se cargó resultado
--          FINISHED   -> ya tiene resultado oficial y fue calificado
-- result:  LOCAL | EMPATE | VISITA  (NULL hasta que termina el partido)
CREATE TABLE IF NOT EXISTS matches (
    id          SERIAL PRIMARY KEY,
    local_team  TEXT NOT NULL,
    away_team   TEXT NOT NULL,
    matchday    INTEGER,                 -- fecha/jornada del torneo (opcional)
    kickoff_at  TEXT,                    -- fecha/hora ISO del partido (opcional)
    status      TEXT NOT NULL DEFAULT 'SCHEDULED'
                CHECK (status IN ('SCHEDULED', 'FINISHED')),
    result      TEXT
                CHECK (result IN ('LOCAL', 'EMPATE', 'VISITA')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pronósticos de cada usuario para cada partido
-- Un usuario solo puede tener UN pronóstico por partido (UNIQUE)
-- points_earned queda NULL hasta que el Match Engine califica el partido
CREATE TABLE IF NOT EXISTS predictions (
    id             SERIAL PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    match_id       INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_pick      TEXT NOT NULL CHECK (user_pick IN ('LOCAL', 'EMPATE', 'VISITA')),
    points_earned  INTEGER,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id);
CREATE INDEX IF NOT EXISTS idx_predictions_user ON predictions(user_id);
