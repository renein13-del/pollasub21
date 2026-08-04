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
      "Entrá por la dirección de tu web (ej: <code>http://localhost:3000</code>)."
    );
    return false;
  }
  try {
    const res = await fetch(`${API}/health`);
    if (!res.ok) throw new Error("health check failed");
    hideConnBanner();
    return true;
  } catch {
    showConnBanner("No se pudo conectar con el servidor. Probá recargar la página en unos minutos.");
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
  loadGroups();
  loadSpecial();
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
  renderGroupsUI([]);
  loadSpecial();
}

function authHeaders() {
  const session = getSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
}

function renderSession() {
  const pill = document.getElementById("sessionPill");
  const hint = document.getElementById("partidosHint");
  const registroSection = document.getElementById("registroSection");
  const gruposSection = document.getElementById("gruposSection");
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
    gruposSection.hidden = false;
  } else {
    pill.classList.remove("is-active");
    pill.innerHTML = `<span class="topbar__session-text">Sin carnet todavía</span>`;
    hint.textContent = "Creá tu carnet o iniciá sesión arriba para poder pronosticar.";
    registroSection.hidden = false;
    gruposSection.hidden = true;
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
    group_code: formData.get("group_code").toString().trim(),
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
        ? "Revisá los datos: nombre, apellido, sobrenombre, código de grupo y una contraseña de al menos 6 caracteres."
        : data.error || "No se pudo crear el usuario.";
      registroError.hidden = false;
      return;
    }

    hideConnBanner();
    registroForm.reset();
    setSession(data.token, data.user);
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
   Grupos de amigos (mini-ligas)
   ============================================================ */
let activeGroupId = ""; // "" = tabla general

async function loadGroups() {
  const session = getSession();
  if (!session) return renderGroupsUI([]);

  try {
    const res = await fetch(`${API}/groups/mine`, { headers: authHeaders() });
    if (!res.ok) return renderGroupsUI([]);
    const groups = await res.json();
    renderGroupsUI(groups);
  } catch {
    renderGroupsUI([]);
  }
}

function renderGroupsUI(groups) {
  const tabs = document.getElementById("groupsTabs");
  const titulo = document.getElementById("leaderboardTitulo");
  tabs.innerHTML = "";

  if (!groups || groups.length === 0) {
    // Usuarios de antes de este cambio, que todavía no están en ningún grupo
    activeGroupId = "";
    titulo.textContent = "Tabla de posiciones";
    loadLeaderboard();
    return;
  }

  // Si el grupo activo ya no es válido (o todavía no se eligió ninguno),
  // mostrar directamente el primero — cada usuario ve solo el suyo.
  if (!groups.some((g) => String(g.id) === String(activeGroupId))) {
    activeGroupId = groups[0].id;
  }

  groups.forEach((g) => {
    const tab = document.createElement("button");
    tab.className = "group-tab" + (String(activeGroupId) === String(g.id) ? " is-active" : "");
    tab.textContent = g.name;
    tab.type = "button";
    tab.addEventListener("click", () => selectGroup(g.id, g.name, tabs));
    tabs.appendChild(tab);
  });

  const active = groups.find((g) => String(g.id) === String(activeGroupId));
  titulo.textContent = active ? `Tabla de posiciones · ${active.name}` : "Tabla de posiciones";
  loadLeaderboard();
}

function selectGroup(id, name, tabsContainer) {
  activeGroupId = id;
  tabsContainer.querySelectorAll(".group-tab").forEach((t) => t.classList.remove("is-active"));
  const clicked = [...tabsContainer.querySelectorAll(".group-tab")].find((t) => t.textContent === name);
  if (clicked) clicked.classList.add("is-active");
  document.getElementById("leaderboardTitulo").textContent =
    id === "" ? "Tabla de posiciones" : `Tabla de posiciones · ${name}`;
  loadLeaderboard();
}

const joinGroupForm = document.getElementById("joinGroupForm");
const joinGroupError = document.getElementById("joinGroupError");

joinGroupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  joinGroupError.hidden = true;

  const code = new FormData(joinGroupForm).get("code").toString().trim();
  if (!code) return;

  try {
    const res = await fetch(`${API}/groups/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();

    if (!res.ok) {
      joinGroupError.textContent = data.error || "No se pudo unir al grupo.";
      joinGroupError.hidden = false;
      return;
    }

    joinGroupForm.reset();
    loadGroups();
  } catch {
    joinGroupError.textContent = "No se pudo conectar con el servidor.";
    joinGroupError.hidden = false;
  }
});

/* ============================================================
   Partidos y pronósticos
   ============================================================ */
const matchesList = document.getElementById("matchesList");
const matchdayFilter = document.getElementById("matchdayFilter");
let allMatches = [];
let predictionsByMatch = {};
let deadlinesByMatchday = {};
let userSelectedMatchday = false;

matchdayFilter.addEventListener("change", () => {
  userSelectedMatchday = true;
  renderMatches();
});

async function loadDeadlines() {
  try {
    const res = await fetch(`${API}/matches/deadlines`);
    const rows = await res.json();
    deadlinesByMatchday = {};
    if (Array.isArray(rows)) {
      rows.forEach((r) => (deadlinesByMatchday[r.matchday] = r.vote_deadline));
    }
  } catch {
    deadlinesByMatchday = {};
  }
}

function formatDeadline(iso) {
  return new Date(iso).toLocaleString("es-PY", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadMatches() {
  matchesList.innerHTML = `<p class="empty-state">Cargando partidos…</p>`;

  try {
    const res = await fetch(`${API}/matches`);
    const matches = await res.json();
    hideConnBanner();

    if (!Array.isArray(matches) || matches.length === 0) {
      allMatches = [];
      matchesList.innerHTML = `<p class="empty-state">Todavía no hay partidos cargados.</p>`;
      return;
    }

    allMatches = matches;
    populateMatchdayFilter(matches);
    await loadDeadlines();

    const session = getSession();
    predictionsByMatch = {};

    if (session) {
      const predRes = await fetch(`${API}/predictions/mine`, { headers: authHeaders() });
      if (predRes.ok) {
        const preds = await predRes.json();
        if (Array.isArray(preds)) {
          preds.forEach((p) => (predictionsByMatch[p.match_id] = p.user_pick));
        }
      }
    }

    renderMatches();
  } catch {
    matchesList.innerHTML = `<p class="empty-state">No se pudieron cargar los partidos.</p>`;
    checkServerConnection();
  }
}

function populateMatchdayFilter(matches) {
  const matchdays = [...new Set(matches.map((m) => m.matchday).filter((d) => d != null))].sort(
    (a, b) => a - b
  );
  const current = matchdayFilter.value;
  matchdayFilter.innerHTML = `<option value="">Todas</option>` +
    matchdays.map((d) => `<option value="${d}">Fecha ${d}</option>`).join("");

  if (userSelectedMatchday) {
    matchdayFilter.value = current;
    return;
  }

  // Por defecto: la fecha más próxima que todavía tenga partidos programados
  // (no "todas"), para no mostrar 22 fechas juntas apenas se entra.
  const scheduledMatchdays = matches
    .filter((m) => m.status === "SCHEDULED" && m.matchday != null)
    .map((m) => m.matchday);

  const defaultMatchday = scheduledMatchdays.length
    ? Math.min(...scheduledMatchdays)
    : matchdays.length
    ? matchdays[matchdays.length - 1]
    : "";

  matchdayFilter.value = defaultMatchday;
}

function renderMatches() {
  const session = getSession();
  const selected = matchdayFilter.value;
  const filtered = selected
    ? allMatches.filter((m) => String(m.matchday) === String(selected))
    : allMatches;

  matchesList.innerHTML = "";
  if (filtered.length === 0) {
    matchesList.innerHTML = `<p class="empty-state">No hay partidos para esa fecha.</p>`;
    return;
  }
  filtered.forEach((match) => {
    matchesList.appendChild(renderMatchCard(match, predictionsByMatch[match.id], session));
  });
}

function renderMatchCard(match, currentPick, session) {
  const card = document.createElement("div");
  card.className = "match-card";

  const isFinished = match.status === "FINISHED";
  const deadlineIso = match.matchday != null ? deadlinesByMatchday[match.matchday] : null;
  const votingClosed = deadlineIso ? new Date() >= new Date(deadlineIso) : false;

  let deadlineNote = "";
  if (!isFinished && deadlineIso) {
    deadlineNote = votingClosed
      ? `<p class="match-card__meta" style="color: var(--red);">Votación cerrada</p>`
      : `<p class="match-card__meta">Votá hasta: ${formatDeadline(deadlineIso)}</p>`;
  }

  const isLive = !isFinished && match.live_status && !["NS", "FT", "AET", "PEN"].includes(match.live_status);
  const liveNote = isLive
    ? `<p class="match-card__meta" style="color: var(--gold);">⚽ EN VIVO: ${match.live_home_score ?? 0} - ${match.live_away_score ?? 0}</p>`
    : "";

  card.innerHTML = `
    <p class="match-card__meta">${match.matchday ? `Fecha ${match.matchday} · ` : ""}${isFinished ? "Finalizado" : "Programado"}</p>
    <div class="match-card__teams">
      <span>${escapeHtml(match.local_team)}</span>
      <span class="match-card__vs">vs</span>
      <span>${escapeHtml(match.away_team)}</span>
    </div>
    ${liveNote}
    ${deadlineNote}
    <div class="picks">
      <button class="pick-btn" data-pick="LOCAL" type="button">L</button>
      <button class="pick-btn" data-pick="EMPATE" type="button">E</button>
      <button class="pick-btn" data-pick="VISITA" type="button">V</button>
    </div>
    ${isFinished ? `<p class="match-card__result">Resultado: ${match.result}</p>` : ""}
  `;

  const buttons = card.querySelectorAll(".pick-btn");
  buttons.forEach((btn) => {
    if (btn.dataset.pick === currentPick) btn.classList.add("is-selected");

    if (isFinished || !session || votingClosed) {
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
      predictionsByMatch[matchId] = pick;
      buttons.forEach((b) => b.classList.remove("is-selected"));
      clickedBtn.classList.add("is-selected");
    } else if (res.status === 401) {
      clearSession();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "No se pudo registrar el pronóstico.");
      loadMatches();
    }
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

/* ============================================================
   Tabla de posiciones (general o por grupo)
   ============================================================ */
const leaderboardTable = document.getElementById("leaderboardTable");

async function loadLeaderboard() {
  const url = activeGroupId ? `${API}/groups/${activeGroupId}/leaderboard` : `${API}/leaderboard`;

  try {
    const res = await fetch(url, activeGroupId ? { headers: authHeaders() } : {});
    const rows = await res.json();

    if (!res.ok || !Array.isArray(rows) || rows.length === 0) {
      leaderboardTable.innerHTML = `<p class="empty-state">Todavía no hay usuarios en esta tabla.</p>`;
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
   Pronósticos especiales (Campeón / Vicecampeón / Goleador)
   ============================================================ */
const specialSection = document.getElementById("specialSection");
const specialList = document.getElementById("specialList");
const specialLabels = { CAMPEON: "Campeón", VICECAMPEON: "Vicecampeón", GOLEADOR: "Goleador" };

async function loadSpecial() {
  const session = getSession();
  if (!session) {
    specialList.innerHTML = `<p class="empty-state">Creá tu carnet o iniciá sesión para cargar tus pronósticos especiales.</p>`;
    return;
  }

  try {
    const [catRes, mineRes, deadlineRes] = await Promise.all([
      fetch(`${API}/special/categories`),
      fetch(`${API}/special/mine`, { headers: authHeaders() }),
      fetch(`${API}/special/deadline`),
    ]);
    const categories = await catRes.json();
    const mine = mineRes.ok ? await mineRes.json() : [];
    const deadlineRow = deadlineRes.ok ? await deadlineRes.json() : null;

    const deadlinePassed = deadlineRow ? new Date() >= new Date(deadlineRow.deadline) : false;

    const mineByCategory = {};
    mine.forEach((p) => (mineByCategory[p.category] = p));

    specialList.innerHTML = "";
    if (deadlineRow) {
      const note = document.createElement("p");
      note.className = "section__hint";
      note.style.gridColumn = "1 / -1";
      note.textContent = deadlinePassed
        ? "Ya pasó el horario límite para cargar pronósticos especiales."
        : `Podés cargarlos hasta: ${formatDeadline(deadlineRow.deadline)}`;
      if (deadlinePassed) note.style.color = "var(--red)";
      specialList.appendChild(note);
    }

    categories.forEach((cat) => {
      specialList.appendChild(renderSpecialCard(cat, mineByCategory[cat.category], deadlinePassed));
    });
  } catch {
    specialList.innerHTML = `<p class="empty-state">No se pudieron cargar los pronósticos especiales.</p>`;
  }
}

function renderSpecialCard(cat, mine, deadlinePassed) {
  const card = document.createElement("div");
  card.className = "match-card";

  const hit = mine && cat.settled && mine.points_earned > 0;
  const locked = cat.settled || deadlinePassed;

  card.innerHTML = `
    <p class="match-card__meta">${escapeHtml(specialLabels[cat.category] || cat.category)} · ${cat.points} pts</p>
    <form class="ticket__form" style="gap:8px;">
      <input class="field__input" type="text" name="answer" maxlength="60"
        placeholder="Tu pronóstico" value="${mine ? escapeHtml(mine.answer) : ""}"
        ${locked ? "disabled" : ""}>
      ${locked ? "" : `<button class="btn btn--ghost" type="submit">Guardar</button>`}
      <p class="field__error" hidden></p>
    </form>
    ${cat.settled ? `<p class="match-card__result" style="color:${hit ? "var(--gold)" : "var(--ink-dim)"};">Correcto: ${escapeHtml(cat.correct_answer)}${hit ? " · ¡Acertaste!" : ""}</p>` : ""}
  `;

  const form = card.querySelector("form");
  const errorEl = card.querySelector(".field__error");

  if (!locked) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      const answer = new FormData(form).get("answer").toString().trim();
      if (!answer) return;

      const btn = form.querySelector("button");
      btn.disabled = true;
      try {
        const res = await fetch(`${API}/special`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ category: cat.category, answer }),
        });
        const data = await res.json();
        if (!res.ok) {
          errorEl.textContent = data.error || "No se pudo guardar.";
          errorEl.hidden = false;
        }
      } catch {
        errorEl.textContent = "No se pudo conectar con el servidor.";
        errorEl.hidden = false;
      } finally {
        btn.disabled = false;
      }
    });
  }

  return card;
}

/* ============================================================
   Menú de secciones (Votar / Tabla / Especiales)
   ============================================================ */
const segmentNav = document.getElementById("segmentNav");
const segmentSections = {
  votar: document.getElementById("partidosSection"),
  tabla: document.getElementById("leaderboardSection"),
  especiales: document.getElementById("specialSection"),
};

function switchSegment(name) {
  Object.entries(segmentSections).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
  segmentNav.querySelectorAll(".segment-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.segment === name);
  });
}

segmentNav.addEventListener("click", (e) => {
  const btn = e.target.closest(".segment-btn");
  if (!btn) return;
  switchSegment(btn.dataset.segment);
});

/* ============================================================
   Init
   ============================================================ */
checkServerConnection();
renderSession();
loadMatches();
loadLeaderboard();
loadGroups();
loadSpecial();

// Refresca los partidos cada 60s para que el marcador en vivo se actualice solo
setInterval(loadMatches, 60000);
