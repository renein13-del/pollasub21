const API = ""; // mismo origen (Express sirve la web y la API)
const SESSION_KEY = "polla_session"; // { token, user }

/* ============================================================
   Diagnóstico de conexión con el servidor
   ============================================================ */
const connBanner = document.getElementById("connBanner");

function showConnBanner(html) {
  connBanner.innerHTML = html;
  connBanner.hidden = false;
}
function hideConnBanner() {
  connBanner.hidden = true;
}

async function checkServerConnection() {
  if (location.protocol === "file:") {
    showConnBanner(
      "Esta página se abrió directamente como archivo y no a través del servidor. " +
      "Corré <code>npm run dev</code> en la carpeta del proyecto y entrá por " +
      "<code>http://localhost:3000</code>."
    );
    return false;
  }
  try {
    const res = await fetch(`${API}/health`);
    if (!res.ok) throw new Error("health check failed");
    hideConnBanner();
    return true;
  } catch {
    showConnBanner(
      "No se pudo conectar con el servidor. Revisá que esté corriendo " +
      "(<code>npm run dev</code>) y que estés entrando por la misma dirección " +
      "que muestra la terminal (ej: <code>http://localhost:3000</code>)."
    );
    return false;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ============================================================
   Sesión (token + datos del usuario, guardados en localStorage)
   ============================================================ */
function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function setSession(token, user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token, user }));
  renderSession();
  loadMatches();
}

async function clearSession() {
  const session = getSession();
  localStorage.removeItem(SESSION_KEY);
  if (session?.token) {
    try {
      await fetch(`${API}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.token}` },
      });
    } catch {
      /* no importa si falla, ya borramos la sesión localmente */
    }
  }
  renderSession();
  loadMatches();
}

function authHeaders() {
  const session = getSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
}

function renderSession() {
  const pill = document.getElementById("sessionPill");
  const hint = document.getElementById("partidosHint");
  const registroSection = document.getElementById("registroSection");
  const session = getSession();

  if (session) {
    pill.classList.add("is-active");
    pill.innerHTML = `<span>Jugando como <strong>${escapeHtml(session.user.nickname)}</strong></span>`;
    const logout = document.createElement("button");
    logout.className = "session-logout";
    logout.textContent = "Salir";
    logout.addEventListener("click", clearSession);
    pill.appendChild(logout);
    hint.textContent = "Elegí LOCAL, EMPATE o VISITA en cada partido.";
    registroSection.hidden = true;
  } else {
    pill.classList.remove("is-active");
    pill.innerHTML = `<span class="topbar__session-text">Sin carnet todavía</span>`;
    hint.textContent = "Creá tu carnet o iniciá sesión arriba para poder pronosticar.";
    registroSection.hidden = false;
  }
}

/* ============================================================
   Registro (nombre, apellido, sobrenombre, contraseña)
   ============================================================ */
const registroForm = document.getElementById("registroForm");
const registroError = document.getElementById("registroError");

registroForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  registroError.hidden = true;

  const formData = new FormData(registroForm);
  const payload = {
    first_name: formData.get("first_name").toString().trim(),
    last_name: formData.get("last_name").toString().trim(),
    nickname: formData.get("nickname").toString().trim(),
    password: formData.get("password").toString(),
  };

  const submitBtn = registroForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  try {
    const res = await fetch(`${API}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      registroError.textContent = data.error?.fieldErrors
        ? "Revisá los datos: nombre, apellido, sobrenombre y una contraseña de al menos 6 caracteres."
        : data.error || "No se pudo crear el usuario.";
      registroError.hidden = false;
      return;
    }

    hideConnBanner();
    registroForm.reset();
    setSession(data.token, data.user);
    loadLeaderboard();
  } catch {
    registroError.textContent = "No se pudo conectar con el servidor.";
    registroError.hidden = false;
    checkServerConnection();
  } finally {
    submitBtn.disabled = false;
  }
});

/* ============================================================
   Login (sobrenombre + contraseña)
   ============================================================ */
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.hidden = true;

  const formData = new FormData(loginForm);
  const payload = {
    nickname: formData.get("nickname").toString().trim(),
    password: formData.get("password").toString(),
  };

  const submitBtn = loginForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  try {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      loginError.textContent = data.error || "No se pudo iniciar sesión.";
      loginError.hidden = false;
      return;
    }

    hideConnBanner();
    loginForm.reset();
    setSession(data.token, data.user);
  } catch {
    loginError.textContent = "No se pudo conectar con el servidor.";
    loginError.hidden = false;
    checkServerConnection();
  } finally {
    submitBtn.disabled = false;
  }
});

/* ============================================================
   Partidos y pronósticos
   ============================================================ */
const matchesList = document.getElementById("matchesList");

async function loadMatches() {
  matchesList.innerHTML = `<p class="empty-state">Cargando partidos…</p>`;

  try {
    const res = await fetch(`${API}/matches`);
    const matches = await res.json();
    hideConnBanner();

    if (!Array.isArray(matches) || matches.length === 0) {
      matchesList.innerHTML = `<p class="empty-state">Todavía no hay partidos cargados.</p>`;
      return;
    }

    const session = getSession();
    let predictionsByMatch = {};

    if (session) {
      const predRes = await fetch(`${API}/predictions/mine`, { headers: authHeaders() });
      if (predRes.ok) {
        const preds = await predRes.json();
        if (Array.isArray(preds)) {
          preds.forEach((p) => (predictionsByMatch[p.match_id] = p.user_pick));
        }
      }
    }

    matchesList.innerHTML = "";
    matches.forEach((match) => {
      matchesList.appendChild(renderMatchCard(match, predictionsByMatch[match.id], session));
    });
  } catch {
    matchesList.innerHTML = `<p class="empty-state">No se pudieron cargar los partidos.</p>`;
    checkServerConnection();
  }
}

function renderMatchCard(match, currentPick, session) {
  const card = document.createElement("div");
  card.className = "match-card";

  const isFinished = match.status === "FINISHED";

  card.innerHTML = `
    <p class="match-card__meta">${match.matchday ? `Fecha ${match.matchday} · ` : ""}${isFinished ? "Finalizado" : "Programado"}</p>
    <div class="match-card__teams">
      <span>${escapeHtml(match.local_team)}</span>
      <span class="match-card__vs">vs</span>
      <span>${escapeHtml(match.away_team)}</span>
    </div>
    <div class="picks">
      <button class="pick-btn" data-pick="LOCAL" type="button">Local</button>
      <button class="pick-btn" data-pick="EMPATE" type="button">Empate</button>
      <button class="pick-btn" data-pick="VISITA" type="button">Visita</button>
    </div>
    ${isFinished ? `<p class="match-card__result">Resultado: ${match.result}</p>` : ""}
  `;

  const buttons = card.querySelectorAll(".pick-btn");
  buttons.forEach((btn) => {
    if (btn.dataset.pick === currentPick) btn.classList.add("is-selected");

    if (isFinished || !session) {
      btn.disabled = true;
    } else {
      btn.addEventListener("click", () => submitPrediction(match.id, btn.dataset.pick, buttons, btn));
    }
  });

  return card;
}

async function submitPrediction(matchId, pick, buttons, clickedBtn) {
  const session = getSession();
  if (!session) return;

  buttons.forEach((b) => (b.disabled = true));

  try {
    const res = await fetch(`${API}/predictions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ match_id: matchId, user_pick: pick }),
    });

    if (res.ok) {
      buttons.forEach((b) => b.classList.remove("is-selected"));
      clickedBtn.classList.add("is-selected");
    } else if (res.status === 401) {
      clearSession();
    }
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

/* ============================================================
   Tabla de posiciones
   ============================================================ */
const leaderboardTable = document.getElementById("leaderboardTable");

async function loadLeaderboard() {
  try {
    const res = await fetch(`${API}/leaderboard`);
    const rows = await res.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      leaderboardTable.innerHTML = `<p class="empty-state">Todavía no hay usuarios en la tabla.</p>`;
      return;
    }

    const head = `
      <div class="board__row board__row--head">
        <span>#</span>
        <span>Jugador</span>
        <span>Puntos</span>
      </div>`;

    const body = rows
      .map((row, i) => `
        <div class="board__row">
          <span class="board__pos">${i + 1}</span>
          <span>
            <span class="board__name-nick">${escapeHtml(row.nickname)}</span><br>
            <span class="board__name-full">${escapeHtml(row.first_name)} ${escapeHtml(row.last_name)}</span>
          </span>
          <span class="board__pts">
            ${row.total_points} pts
            <span class="board__pts-sub">${row.aciertos}/${row.pronosticos_totales} aciertos</span>
          </span>
        </div>`)
      .join("");

    leaderboardTable.innerHTML = head + body;
  } catch {
    leaderboardTable.innerHTML = `<p class="empty-state">No se pudo cargar la tabla de posiciones.</p>`;
  }
}

/* ============================================================
   Init
   ============================================================ */
checkServerConnection();
renderSession();
loadMatches();
loadLeaderboard();
