# Polla Futbolera — Liga de Fútbol Paraguayo

Backend simplificado estilo Polla.ya, con pronósticos 1X2 (LOCAL / EMPATE / VISITA)
y calificación automática por partido. Pensado para desplegarse en internet
(Render) con dominio propio.

## Stack

- Node.js + TypeScript + Express
- PostgreSQL (vía `pg`) — para que los datos no se pierdan en hostings gratuitos
- Validación de entrada con `zod`
- Contraseñas hasheadas con `bcryptjs`

## Estructura

```
polla-futbolera/
├── schema.sql                # Definición de tablas (PostgreSQL)
├── public/                   # Web (servida por Express en /)
│   ├── index.html             # Registro/login, partidos, tabla de posiciones
│   ├── admin.html              # Panel de administrador (con su propio login)
│   ├── styles.css
│   ├── app.js
│   └── admin.js
├── src/
│   ├── index.ts               # Bootstrap del servidor Express (sirve /public)
│   ├── auth.ts                 # Hash de contraseñas, tokens, middlewares de sesión
│   ├── types.ts               # Tipos de dominio compartidos
│   ├── matchEngine.ts          # Motor de Calificación Automático
│   ├── db/
│   │   ├── index.ts            # Conexión a PostgreSQL + creación de tablas
│   │   └── seed.ts             # Datos de ejemplo (opcional)
│   └── routes/
│       ├── auth.ts             # Registro / login de usuarios y de admin
│       ├── matches.ts
│       ├── predictions.ts
│       └── leaderboard.ts
```

## La web

Entrando al dominio (o a `http://localhost:3000` en local):

1. **Crear carnet** — cada persona carga su **nombre**, **apellido**, un **sobrenombre** único y una **contraseña** (mínimo 6 caracteres).
2. **Ya tengo carnet** — con el sobrenombre y la contraseña, cualquiera inicia sesión desde cualquier dispositivo.
3. La sesión queda guardada en el navegador; desde ahí ya puede pronosticar tocando **Local / Empate / Visita** en cada partido.
4. La tabla de posiciones se actualiza sola apenas se carga el resultado oficial de un partido.

## Panel de administrador

Entrando a `/admin.html` (hay un link discreto al pie de la web principal) se pide la **contraseña de administrador** (variable `ADMIN_PASSWORD`). Desde ahí:

1. **Cargar partidos de todas las fechas de una vez** — una caja de texto donde pegás una línea por partido con el formato `Local;Visitante;Fecha` (la fecha es opcional). Sirve para cargar, por ejemplo, las fechas 1 a 22 en un solo paso.
2. **Agregar un partido suelto** — para cuando querés cargar uno solo.
3. **Cargar el resultado final** de cada partido programado — dispara el Match Engine y califica todos los pronósticos.
4. **Corregir un resultado ya cargado** — en "Ya finalizados", tocando "Corregir resultado" volvés a elegir Local/Empate/Visita. El sistema primero revierte los puntos que se habían otorgado con el resultado viejo y recién ahí aplica el nuevo, así nadie queda con puntos de más.
5. **Cargar puntos que los usuarios ya tenían** — buscás al usuario (ya registrado) y le sumás (o restás, con un número negativo) puntos manuales. Útil para arrancar el sistema a mitad de torneo sin perder lo que ya habían acumulado.
6. **Grupos de amigos** — creás un grupo (le ponés nombre) y el sistema genera un código de invitación. Compartís ese código con tus amigos; cada uno lo carga en la web para unirse. Cada grupo tiene su propia tabla de posiciones, calculada sobre los mismos partidos y pronósticos.

Es una sola contraseña compartida (no un usuario más), pensada para quien organiza la polla.

## Grupos de amigos (mini-ligas)

Un usuario puede pertenecer a varios grupos a la vez. En la web, una vez logueado, aparece una barra con "Tabla general" y una pestaña por cada grupo al que pertenece, más un campo para unirse a uno nuevo con el código que le compartió el administrador. Los puntos son los mismos en todos lados (son los mismos partidos) — lo que cambia es contra quién te comparás en la tabla.

---

## Instalación en local

Necesitás una base PostgreSQL para desarrollar en tu computadora. La forma más simple sin instalar nada es usar la misma base que vas a crear en Render (ver más abajo) — o instalar Postgres local si preferís.

```bash
npm install
cp .env.example .env      # completá ADMIN_PASSWORD y DATABASE_URL
npm run dev                # http://localhost:3000
```

Cargar datos de ejemplo (usuarios con contraseña `demo1234`):

```bash
npm run seed
```

Las tablas se crean solas al levantar el servidor — no hace falta migraciones a mano.

---

## Desplegar en Render (para tener www.tudominio.com)

### 1. Subir el proyecto a GitHub
Render despliega desde un repositorio. Si no tenés uno: creá una cuenta en [github.com](https://github.com), un repositorio nuevo, y subí esta carpeta (`git init`, `git add .`, `git commit`, `git push`, o usando GitHub Desktop si preferís no usar comandos).

### 2. Crear la base de datos en Render
1. En [render.com](https://render.com), creá tu cuenta.
2. **New +** → **PostgreSQL** → elegí el plan gratuito → **Create Database**.
3. Cuando esté lista, copiá el valor de **"Internal Database URL"**.

### 3. Crear el servicio web
1. **New +** → **Web Service** → conectá tu repositorio de GitHub.
2. Configurá:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
3. En **Environment**, agregá las variables:
   - `ADMIN_PASSWORD` → tu contraseña de administrador
   - `DATABASE_URL` → el "Internal Database URL" que copiaste en el paso 2
4. **Create Web Service**. Render te va a dar una URL tipo `polla-futbolera.onrender.com` — probá que funcione ahí antes de seguir.

### 4. Conectar tu dominio (pollasub21.com)
1. Comprá el dominio en cualquier registrador (Namecheap, GoDaddy, etc.) si todavía no lo tenés.
2. En Render, dentro de tu Web Service, andá a **Settings → Custom Domain → Add Custom Domain** y escribí `www.pollasub21.com` (y opcionalmente `pollasub21.com`).
3. Render te va a mostrar un registro DNS (tipo `CNAME` o `A`) para agregar.
4. Vas al panel de tu registrador de dominios (donde lo compraste), a la sección de DNS, y agregás ese registro exactamente como te lo indica Render.
5. Puede tardar de minutos a un par de horas en propagarse. Una vez listo, entrando a `www.pollasub21.com` se abre tu web directamente — sin terminal, sin nada.

### Cargar datos de ejemplo en producción (opcional)
Desde Render podés abrir una "Shell" del servicio (pestaña **Shell** en el dashboard) y correr `npm run seed` ahí, apuntando ya a la base de producción.

---

## Modelo de datos

- **users**: `id, first_name, last_name, nickname (único), password_hash, total_points`
- **sessions**: tokens de usuarios logueados
- **admin_sessions**: tokens de sesión de administrador
- **matches**: `id, local_team, away_team, matchday, kickoff_at, status (SCHEDULED|FINISHED), result (LOCAL|EMPATE|VISITA)`
- **predictions**: `id, user_id, match_id, user_pick, points_earned` — `UNIQUE(user_id, match_id)`: un solo pronóstico por usuario y partido (se puede corregir mientras el partido siga `SCHEDULED`).

## Endpoints

### Autenticación (usuarios)
- `POST /auth/register` — `{ first_name, last_name, nickname, password }` → `{ user, token }`
- `POST /auth/login` — `{ nickname, password }` → `{ user, token }`
- `GET /auth/me` — requiere `Authorization: Bearer <token>`
- `POST /auth/logout` — requiere `Authorization: Bearer <token>`

### Autenticación (administrador)
- `POST /auth/admin/login` — `{ password }` → `{ token }` (la contraseña es `ADMIN_PASSWORD`)
- `POST /auth/admin/logout`

### Partidos
- `GET /matches` (público, filtro opcional `?status=SCHEDULED`) / `GET /matches/:id`
- `POST /matches` — requiere admin
- `POST /matches/bulk` — requiere admin: `{ "matches": [{ "local_team", "away_team", "matchday" }, ...] }`
- `PUT /matches/:id` — requiere admin, mientras no esté finalizado
- `POST /matches/:id/result` — requiere admin, **dispara el Match Engine**: `{ "result": "LOCAL", "force": false }` (`force: true` para corregir un resultado ya cargado)

### Administración (requieren admin)
- `GET /admin/users` — lista de usuarios para buscar a quién ajustarle puntos
- `POST /admin/users/:id/points` — `{ "points": 12 }` (puede ser negativo) suma puntos manuales
- `POST /admin/groups` — `{ "name": "Los del barrio" }` → crea un grupo y devuelve su código
- `GET /admin/groups` — lista de grupos con cantidad de miembros

### Grupos (requieren `Authorization: Bearer <token>` de usuario)
- `GET /groups/mine` — grupos a los que pertenece el usuario logueado
- `POST /groups/join` — `{ "code": "ABC123" }`
- `GET /groups/:id/leaderboard` — tabla de posiciones del grupo (solo si sos miembro)

### Pronósticos (requieren `Authorization: Bearer <token>` de usuario)
- `POST /predictions` — `{ match_id, user_pick }`
- `GET /predictions/mine`
- `GET /predictions/match/:matchId`

### Tabla de posiciones
- `GET /leaderboard` (público, tabla general con todos los usuarios)

## Motor de Calificación (Match Engine)

`src/matchEngine.ts`, función `settleMatch(matchId, result)`:

1. Verifica que el partido exista y no esté ya `FINISHED` (evita calificar dos veces).
2. Marca el partido como `FINISHED` con el resultado oficial.
3. Dentro de una transacción de PostgreSQL, recorre todos los pronósticos del partido: si acertó suma 1 punto a la predicción y al total del usuario; si no, queda en 0.
4. Devuelve un resumen: pronósticos calificados y cantidad de acertantes.

## Solución de problemas

**El panel de administrador dice "no configurada"**
- Faltó definir `ADMIN_PASSWORD` (en `.env` local, o en Environment en Render).

**"No se pudo conectar con el servidor" en la web**
- En local: abriste `index.html` con doble clic en vez de entrar por `http://localhost:3000`.
- En producción: revisá en Render que el servicio esté "Live" (no "Failed") y que `DATABASE_URL` esté bien configurada.

**Error al desplegar: "DATABASE_URL no está definida"**
- Te faltó agregar la variable de entorno en Render (paso 3 de la guía de despliegue), o pegaste el connection string incorrecto.

**El puerto ya está en uso (local)**
- Corré con otro puerto: `PORT=3001 npm run dev`.

## Próximos pasos sugeridos (no incluidos aún)

- Validación de que el pronóstico se cargue antes de `kickoff_at`.
- Integración con una fuente de datos real de la Liga Paraguaya para autocompletar partidos.
- Paginación en `GET /matches` y `GET /predictions/mine`.
- Pagos (entrada para jugar o premio) y conexión con otras apps — a definir según lo que necesites.
