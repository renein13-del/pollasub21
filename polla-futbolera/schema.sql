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

-- Grupos de amigos: cada uno tiene su propia tabla de posiciones,
-- calculada sobre los mismos partidos y pronósticos globales.
CREATE TABLE IF NOT EXISTS groups (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    code        TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_members (
    group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);

-- Horario límite para votar, UNO por fecha/jornada (no por partido individual).
-- Se carga a mano en el panel de administrador (ya con los 5 minutos de
-- margen descontados): a partir de ese horario, nadie puede pronosticar
-- ningún partido de esa fecha.
CREATE TABLE IF NOT EXISTS matchday_deadlines (
    matchday       INTEGER PRIMARY KEY,
    vote_deadline  TIMESTAMPTZ NOT NULL
);

-- Pronósticos especiales de fin de torneo (no son por partido).
-- correct_answer y settled los carga el administrador cuando se sabe el resultado.
CREATE TABLE IF NOT EXISTS special_categories (
    category        TEXT PRIMARY KEY, -- 'CAMPEON' | 'VICECAMPEON' | 'GOLEADOR'
    points          INTEGER NOT NULL,
    correct_answer  TEXT,
    settled         BOOLEAN NOT NULL DEFAULT false
);

INSERT INTO special_categories (category, points) VALUES
  ('CAMPEON', 10),
  ('VICECAMPEON', 5),
  ('GOLEADOR', 5)
ON CONFLICT (category) DO NOTHING;

-- Pronóstico de cada usuario para cada categoría especial (texto libre:
-- nombre de equipo o de jugador). UNIQUE por usuario+categoría.
CREATE TABLE IF NOT EXISTS special_predictions (
    id             SERIAL PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category       TEXT NOT NULL REFERENCES special_categories(category),
    answer         TEXT NOT NULL,
    points_earned  INTEGER,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, category)
);

-- Horario límite único para los pronósticos especiales (Campeón/Vicecampeón/Goleador),
-- separado del de cada fecha de partidos. Fila única (id siempre 1).
CREATE TABLE IF NOT EXISTS special_deadline (
    id        INTEGER PRIMARY KEY DEFAULT 1,
    deadline  TIMESTAMPTZ NOT NULL,
    CHECK (id = 1)
);
