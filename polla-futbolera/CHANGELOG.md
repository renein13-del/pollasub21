# Changelog

## v1.3.0 — Matriz de votos por fecha

Nueva sección en el panel: **"Votos por fecha (de un vistazo)"**. Elegís una
fecha y aparece una planilla — usuarios en filas (a la izquierda, fija al
desplazar), partidos de esa fecha en columnas. Cada celda muestra L/E/V
según lo que votó esa persona en ese partido, en blanco si no votó. Si el
partido ya tiene resultado, el acierto queda resaltado (subrayado y en
dorado).

- `GET /admin/matchdays-list` — fechas que tienen partidos cargados
- `GET /admin/votes-matrix?matchday=X` — partidos, usuarios y pronósticos de esa fecha

## v1.2.0 — Menús, resultados en vivo (API-Football), y corrección de un bug real de puntos

### 🐛 Bug real encontrado y corregido
Se detectó una **condición de carrera**: si alguien pronosticaba justo en el
instante en que el administrador cargaba el resultado de ese partido, el
pronóstico quedaba guardado pero nunca se comparaba contra el resultado —
`points_earned` quedaba en blanco para siempre y no sumaba ni restaba nada.
Con muchas personas votando cerca del horario límite, esto explica que
"mucha gente no sumó sus puntos".

- `POST /predictions` ahora bloquea la fila del partido (`SELECT ... FOR
  UPDATE`) mientras registra el pronóstico, así nunca se cruza con la carga
  de un resultado — no puede volver a pasar.
- Nuevo panel **"Pronósticos sin calificar"**: muestra cuántos quedaron
  afectados por este bug (de antes de este arreglo) y un botón "Reparar
  ahora" que los califica y suma los puntos correspondientes, una sola vez.
  **Corré esto apenas actualices**, para arreglar lo que ya estaba mal.

### Agregado
- **Menú de secciones** (Votar / Tabla / Especiales): en vez de mostrar todo
  apilado, ahora hay 3 pestañas arriba. "Votar" incluye el filtro por fecha.
- **Resultados en tiempo real (API-Football)**: podés vincular un partido
  programado con un fixture real de `api-football.com` buscándolo por
  fecha desde el panel. Un proceso corre solo cada pocos minutos
  (configurable con `LIVE_SCORES_POLL_MINUTES`) y, cuando el partido
  termina, califica el resultado automáticamente — sin que vos tengas que
  cargarlo a mano. Mientras está en curso, se ve el marcador en vivo tanto
  en el panel como en la web de los usuarios (que se refresca sola cada
  60 segundos).
  - ⚠️ **Tenés que confirmar vos mismo** `API_FOOTBALL_LEAGUE_ID` y
    `API_FOOTBALL_SEASON` contra tu propia cuenta antes de cargarlos — no
    encontré una fuente 100% confiable para el ID exacto de la Liga
    Paraguaya en api-football.com. Sin esas variables configuradas, todo
    sigue funcionando igual que antes (carga manual).

## v1.1.0 — Aciertos y partidos previos al sistema

Corrección sobre v1.0.0: se detectó que la tabla de posiciones no reflejaba
los aciertos de partidos jugados "a mano" antes de usar la web (los que se
cargaban solo como suma de puntos, sin partido asociado). Se agregó:

- Columnas `extra_hits` / `extra_matches` en `users`.
- Nuevo endpoint `POST /admin/users/:id/extra-stats` — fija (no suma) los
  aciertos y partidos jugados antes del sistema.
- Nuevo formulario en el panel: "Aciertos y partidos previos al sistema",
  junto a "Cargar puntos que ya tenían".
- La tabla de posiciones (general y por grupo) ahora suma esos valores al
  conteo de aciertos, así se ve el total real (ej: "5/18") en vez de solo
  los partidos cargados como registro individual en `matches`/`predictions`.

**Importante**: el número de puntos que cargues con "Cargar puntos que ya
tenían" y el de "aciertos previos" acá son independientes — tenés que
cargar los dos por separado para que el total de puntos Y el conteo de
aciertos queden ambos correctos.

## v1.0.0 — Versión en producción (pollasub21.onrender.com)

Esta es la versión que está desplegada ahora mismo. Las correcciones y ajustes
chicos van sobre esta carpeta.

### Incluye
- Registro/login de usuarios con contraseña (nombre, apellido, sobrenombre, código de grupo obligatorio)
- Login de administrador separado (contraseña única en `.env`)
- Gestión de partidos: carga masiva por fecha, carga individual, edición
- Motor de calificación automático (1X2), con corrección de resultados ya cargados
- Carga manual de pronósticos por parte del administrador (para volcar votos hechos fuera del sistema)
- Carga manual de puntos existentes por usuario
- Grupos de amigos (mini-ligas): creados solo por el administrador, gratis, sin límite de miembros
- Filtro de usuarios por grupo en el panel (Cargar puntos / Cargar pronósticos ya hechos)
- Horario límite de votación por fecha de partidos
- Pronósticos especiales (Campeón 10 pts / Vicecampeón 5 pts / Goleador 5 pts) con horario límite propio
- Filtro de partidos por fecha en la web (por defecto, la próxima fecha con partidos programados)
- Botones de pronóstico compactos (L/E/V)
- Paleta gris/negro

### No incluye (ver v2.0.0-beta)
- Grupos creados por usuarios comunes, con niveles de precio
- Sponsors
- Integración de cobro con Bancard
