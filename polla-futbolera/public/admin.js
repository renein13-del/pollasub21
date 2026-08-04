const API = "";
const ADMIN_TOKEN_KEY = "polla_admin_token";

/* ============================================================
   Diagnóstico de conexión
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
    showConnBanner("Esta página se abrió como archivo, no por el servidor.");
    return;
  }
  try {
    const res = await fetch(`${API}/health`);
    if (!res.ok) throw new Error();
    hideConnBanner();
  } catch {
    showConnBanner("No se pudo conectar con el servidor.");
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ============================================================
   Sesión de administrador
   ============================================================ */
function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}
function setAdminToken(token) {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}
function clearAdminToken() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}
function adminHeaders() {
  const token = getAdminToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const adminLoginSection = document.getElementById("adminLoginSection");
const adminPanel = document.getElementById("adminPanel");
const adminSessionPill = document.getElementById("adminSessionPill");

function showPanel() {
  adminLoginSection.hidden = true;
  adminPanel.hidden = false;
  adminSessionPill.hidden = false;
  loadMatches();
  loadUsersForPoints();
  loadUsersForExtraStats();
  loadGroups();
  loadDeadlines();
  loadSpecialAdmin();
  loadSpecialDeadline();
  loadLiveScoresStatus();
  checkOrphanedPredictions();
  loadMatchdaysForMatrix();
}

function showLogin() {
  adminLoginSection.hidden = false;
  adminPanel.hidden = true;
  adminSessionPill.hidden = true;
}

document.getElementById("adminLogoutBtn").addEventListener("click", () => {
  clearAdminToken();
  showLogin();
});

/* ============================================================
   Login de administrador
   ============================================================ */
const adminLoginForm = document.getElementById("adminLoginForm");
const adminLoginError = document.getElementById("adminLoginError");

adminLoginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  adminLoginError.hidden = true;

  const password = new FormData(adminLoginForm).get("password").toString();

  try {
    const res = await fetch(`${API}/auth/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();

    if (!res.ok) {
      adminLoginError.textContent = data.error || "No se pudo iniciar sesión.";
      adminLoginError.hidden = false;
      return;
    }

    hideConnBanner();
    setAdminToken(data.token);
    adminLoginForm.reset();
    showPanel();
  } catch {
    adminLoginError.textContent = "No se pudo conectar con el servidor.";
    adminLoginError.hidden = false;
    checkServerConnection();
  }
});

/* ============================================================
   Carga masiva de partidos
   ============================================================ */
const bulkForm = document.getElementById("bulkForm");
const bulkError = document.getElementById("bulkError");
const bulkSuccess = document.getElementById("bulkSuccess");

function parseBulkText(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [local_team, away_team, matchday] = line.split(";").map((s) => s?.trim());
      const parsed = { local_team, away_team };
      if (matchday) parsed.matchday = Number(matchday);
      return parsed;
    });
}

bulkForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  bulkError.hidden = true;
  bulkSuccess.hidden = true;

  const text = new FormData(bulkForm).get("bulk").toString();
  const matches = parseBulkText(text);

  const invalid = matches.some((m) => !m.local_team || !m.away_team);
  if (matches.length === 0 || invalid) {
    bulkError.textContent = "Revisá el formato: cada línea debe ser Local;Visitante;Fecha (fecha opcional).";
    bulkError.hidden = false;
    return;
  }

  try {
    const res = await fetch(`${API}/matches/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ matches }),
    });

    if (res.status === 401) return showLogin();
    const data = await res.json();

    if (!res.ok) {
      bulkError.textContent = data.error || "No se pudieron crear los partidos.";
      bulkError.hidden = false;
      return;
    }

    bulkSuccess.textContent = data.message;
    bulkSuccess.hidden = false;
    bulkForm.reset();
    loadMatches();
  } catch {
    bulkError.textContent = "No se pudo conectar con el servidor.";
    bulkError.hidden = false;
    checkServerConnection();
  }
});

/* ============================================================
   Crear un partido suelto
   ============================================================ */
const crearForm = document.getElementById("crearForm");
const crearError = document.getElementById("crearError");

crearForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  crearError.hidden = true;

  const formData = new FormData(crearForm);
  const matchday = formData.get("matchday");

  const payload = {
    local_team: formData.get("local_team").toString().trim(),
    away_team: formData.get("away_team").toString().trim(),
    ...(matchday ? { matchday: Number(matchday) } : {}),
  };

  try {
    const res = await fetch(`${API}/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.status === 401) return showLogin();

    if (!res.ok) {
      crearError.textContent = data.error?.fieldErrors
        ? "Revisá los datos: local y visitante son obligatorios."
        : data.error || "No se pudo crear el partido.";
      crearError.hidden = false;
      return;
    }

    hideConnBanner();
    crearForm.reset();
    loadMatches();
  } catch {
    crearError.textContent = "No se pudo conectar con el servidor.";
    crearError.hidden = false;
    checkServerConnection();
  }
});

/* ============================================================
   Listar partidos programados / finalizados
   ============================================================ */
const scheduledList = document.getElementById("scheduledList");
const finishedList = document.getElementById("finishedList");
let allMatchesAdmin = [];

async function loadMatches() {
  try {
    const res = await fetch(`${API}/matches`);
    const matches = await res.json();
    hideConnBanner();
    allMatchesAdmin = matches;

    const scheduled = matches.filter((m) => m.status === "SCHEDULED");
    const finished = matches.filter((m) => m.status === "FINISHED");

    scheduledList.innerHTML = scheduled.length
      ? ""
      : `<p class="empty-state">No hay partidos programados. Creá uno arriba.</p>`;
    scheduled.forEach((m) => scheduledList.appendChild(renderMatchResultCard(m, false)));

    finishedList.innerHTML = finished.length
      ? ""
      : `<p class="empty-state">Todavía no hay partidos finalizados.</p>`;
    finished.forEach((m) => finishedList.appendChild(renderMatchResultCard(m, true)));

    populateManualMatchSelect(matches);
  } catch {
    scheduledList.innerHTML = `<p class="empty-state">No se pudieron cargar los partidos.</p>`;
    finishedList.innerHTML = "";
    checkServerConnection();
  }
}

// isFinished=true -> tarjeta de "corregir resultado" (colapsada por defecto)
function renderMatchResultCard(match, isFinished) {
  const card = document.createElement("div");
  card.className = "match-card";

  const metaLine = match.matchday ? `Fecha ${match.matchday}` : "Sin fecha asignada";

  card.innerHTML = `
    <p class="match-card__meta">${metaLine}</p>
    <div class="match-card__teams">
      <span>${escapeHtml(match.local_team)}</span>
      <span class="match-card__vs">vs</span>
      <span>${escapeHtml(match.away_team)}</span>
    </div>
    ${isFinished ? `<p class="match-card__result">Resultado actual: ${match.result}</p>` : ""}
    ${isFinished ? `<button class="btn btn--ghost btn--corregir" type="button" style="justify-self:center;">Corregir resultado</button>` : ""}
    <div class="picks" ${isFinished ? "hidden" : ""}>
      <button class="pick-btn" data-result="LOCAL" type="button">Ganó Local</button>
      <button class="pick-btn" data-result="EMPATE" type="button">Empate</button>
      <button class="pick-btn" data-result="VISITA" type="button">Ganó Visita</button>
    </div>
    <p class="field__error" hidden></p>
    ${!isFinished ? renderFixtureLinkHtml(match) : ""}
  `;

  if (!isFinished) {
    setupFixtureLinkUI(card, match);
  }

  const picksDiv = card.querySelector(".picks");
  const buttons = card.querySelectorAll(".pick-btn");
  const errorEl = card.querySelector(".field__error");
  const corregirBtn = card.querySelector(".btn--corregir");

  if (corregirBtn) {
    corregirBtn.addEventListener("click", () => {
      picksDiv.hidden = !picksDiv.hidden;
    });
  }

  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const accionTexto = isFinished ? "corregir el resultado a" : "confirmar el resultado";
      const confirmed = confirm(
        `¿Confirmás ${accionTexto} "${btn.textContent}" para ${match.local_team} vs ${match.away_team}? ` +
        `Esto recalcula los puntos de todos los que pronosticaron este partido.`
      );
      if (!confirmed) return;

      buttons.forEach((b) => (b.disabled = true));
      errorEl.hidden = true;

      try {
        const res = await fetch(`${API}/matches/${match.id}/result`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...adminHeaders() },
          body: JSON.stringify({ result: btn.dataset.result, force: isFinished }),
        });

        if (res.status === 401) return showLogin();

        const data = await res.json();

        if (!res.ok) {
          errorEl.textContent = data.error || "No se pudo registrar el resultado.";
          errorEl.hidden = false;
          buttons.forEach((b) => (b.disabled = false));
          return;
        }

        loadMatches();
      } catch {
        errorEl.textContent = "No se pudo conectar con el servidor.";
        errorEl.hidden = false;
        buttons.forEach((b) => (b.disabled = false));
        checkServerConnection();
      }
    });
  });

  return card;
}

/* ============================================================
   Vincular un partido con un fixture de API-Football
   ============================================================ */
function renderFixtureLinkHtml(match) {
  if (match.api_fixture_id) {
    const marcador =
      match.live_home_score != null && match.live_away_score != null
        ? ` · ${match.live_home_score} - ${match.live_away_score} (${match.live_status || "?"})`
        : "";
    return `
      <div class="fixture-link fixture-link--linked">
        <p class="section__hint">Vinculado a fixture #${match.api_fixture_id}${marcador} — se actualiza solo.</p>
        <button class="session-logout unlink-fixture-btn" type="button">Desvincular</button>
      </div>`;
  }

  return `
    <div class="fixture-link">
      <button class="btn btn--ghost link-fixture-toggle" type="button">Vincular con API-Football</button>
      <div class="fixture-link__panel" hidden>
        <label class="field field--compact">
          <span class="field__label">Fecha del partido (para buscar)</span>
          <input class="field__input" type="date">
        </label>
        <button class="btn btn--ghost search-fixtures-btn" type="button">Buscar</button>
        <div class="fixture-results"></div>
      </div>
    </div>`;
}

function setupFixtureLinkUI(card, match) {
  const unlinkBtn = card.querySelector(".unlink-fixture-btn");
  if (unlinkBtn) {
    unlinkBtn.addEventListener("click", async () => {
      const confirmed = confirm(`¿Desvincular ${match.local_team} vs ${match.away_team} de API-Football?`);
      if (!confirmed) return;
      try {
        const res = await fetch(`${API}/admin/matches/${match.id}/link-fixture`, {
          method: "DELETE",
          headers: adminHeaders(),
        });
        if (res.status === 401) return showLogin();
        loadMatches();
      } catch {
        checkServerConnection();
      }
    });
    return;
  }

  const toggleBtn = card.querySelector(".link-fixture-toggle");
  const panel = card.querySelector(".fixture-link__panel");
  const dateInput = card.querySelector(".fixture-link__panel input[type=date]");
  const searchBtn = card.querySelector(".search-fixtures-btn");
  const resultsDiv = card.querySelector(".fixture-results");

  if (!toggleBtn) return;

  toggleBtn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });

  searchBtn.addEventListener("click", async () => {
    if (!dateInput.value) return;
    resultsDiv.innerHTML = `<p class="empty-state">Buscando…</p>`;

    try {
      const res = await fetch(
        `${API}/admin/matches/${match.id}/search-fixtures?date=${dateInput.value}`,
        { headers: adminHeaders() }
      );
      if (res.status === 401) return showLogin();
      const data = await res.json();

      if (!res.ok) {
        resultsDiv.innerHTML = `<p class="field__error">${escapeHtml(data.error || "No se pudo buscar.")}</p>`;
        return;
      }
      if (!data.length) {
        resultsDiv.innerHTML = `<p class="empty-state">No hay partidos de la liga configurada en esa fecha.</p>`;
        return;
      }

      resultsDiv.innerHTML = data
        .map(
          (f) => `
          <div class="fixture-option">
            <span>${escapeHtml(f.home_team)} vs ${escapeHtml(f.away_team)} — ${f.status_short}</span>
            <button class="pick-btn link-this-fixture" type="button" data-fixture-id="${f.fixture_id}">Vincular</button>
          </div>`
        )
        .join("");

      resultsDiv.querySelectorAll(".link-this-fixture").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            const linkRes = await fetch(`${API}/admin/matches/${match.id}/link-fixture`, {
              method: "POST",
              headers: { "Content-Type": "application/json", ...adminHeaders() },
              body: JSON.stringify({ api_fixture_id: Number(btn.dataset.fixtureId) }),
            });
            if (linkRes.status === 401) return showLogin();
            loadMatches();
          } catch {
            checkServerConnection();
          }
        });
      });
    } catch {
      resultsDiv.innerHTML = `<p class="empty-state">No se pudo conectar con el servidor.</p>`;
    }
  });
}

/* ============================================================
   Matriz de votos por fecha (usuarios x partidos)
   ============================================================ */
const matrixMatchdaySelect = document.getElementById("matrixMatchdaySelect");
const votesMatrixWrap = document.getElementById("votesMatrixWrap");

async function loadMatchdaysForMatrix() {
  try {
    const res = await fetch(`${API}/admin/matchdays-list`, { headers: adminHeaders() });
    if (res.status === 401) return showLogin();
    const matchdays = await res.json();

    const current = matrixMatchdaySelect.value;
    matrixMatchdaySelect.innerHTML =
      `<option value="">Elegí una fecha…</option>` +
      matchdays.map((d) => `<option value="${d}">Fecha ${d}</option>`).join("");
    matrixMatchdaySelect.value = current;
  } catch {
    matrixMatchdaySelect.innerHTML = `<option value="">No se pudieron cargar las fechas</option>`;
  }
}

matrixMatchdaySelect.addEventListener("change", loadVotesMatrix);

async function loadVotesMatrix() {
  const matchday = matrixMatchdaySelect.value;
  if (!matchday) {
    votesMatrixWrap.innerHTML = `<p class="empty-state">Elegí una fecha arriba para ver los votos.</p>`;
    return;
  }

  votesMatrixWrap.innerHTML = `<p class="empty-state">Cargando…</p>`;

  try {
    const res = await fetch(`${API}/admin/votes-matrix?matchday=${matchday}`, {
      headers: adminHeaders(),
    });
    if (res.status === 401) return showLogin();
    const { matches, users, predictions } = await res.json();

    if (!matches.length) {
      votesMatrixWrap.innerHTML = `<p class="empty-state">No hay partidos cargados en esa fecha.</p>`;
      return;
    }

    // pickByUserAndMatch[userId][matchId] = "LOCAL" | "EMPATE" | "VISITA"
    // pointsByUser[userId] = suma de points_earned de esta fecha (0 si no calificado/no votó)
    const pickByUserAndMatch = {};
    const pointsByUser = {};
    predictions.forEach((p) => {
      pickByUserAndMatch[p.user_id] = pickByUserAndMatch[p.user_id] || {};
      pickByUserAndMatch[p.user_id][p.match_id] = p.user_pick;
      pointsByUser[p.user_id] = (pointsByUser[p.user_id] || 0) + (p.points_earned || 0);
    });

    const pickShort = { LOCAL: "L", EMPATE: "E", VISITA: "V" };
    const pickClass = { LOCAL: "pick-local", EMPATE: "pick-empate", VISITA: "pick-visita" };

    const headerCells = matches
      .map((m) => `<th>${escapeHtml(m.local_team)}<br>vs<br>${escapeHtml(m.away_team)}${m.status === "FINISHED" ? `<br><span style="color:var(--gold);">${m.result}</span>` : ""}</th>`)
      .join("");

    const bodyRows = users
      .map((u) => {
        const cells = matches
          .map((m) => {
            const pick = pickByUserAndMatch[u.id]?.[m.id];
            if (!pick) return `<td class="pick-empty">—</td>`;
            const isHit = m.status === "FINISHED" && m.result === pick;
            const isMiss = m.status === "FINISHED" && m.result !== pick;
            const cellClass = isHit ? "pick-hit" : isMiss ? "pick-miss" : pickClass[pick];
            return `<td class="${cellClass}">${pickShort[pick]}</td>`;
          })
          .join("");
        const puntosFecha = pointsByUser[u.id] || 0;
        return `<tr><th>${escapeHtml(u.nickname)}</th>${cells}<td class="votes-matrix__points">${puntosFecha}</td><td class="votes-matrix__points">${u.total_points}</td></tr>`;
      })
      .join("");

    votesMatrixWrap.innerHTML = `
      <table class="votes-matrix">
        <thead><tr><th>Usuario</th>${headerCells}<th>Puntos<br>fecha</th><th>Puntos<br>total</th></tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>`;
  } catch {
    votesMatrixWrap.innerHTML = `<p class="empty-state">No se pudo cargar la matriz de votos.</p>`;
  }
}

/* ============================================================
   Reparar pronósticos sin calificar (condición de carrera)
   ============================================================ */
const orphanedCount = document.getElementById("orphanedCount");
const repairBtn = document.getElementById("repairBtn");
const repairError = document.getElementById("repairError");
const repairResult = document.getElementById("repairResult");

async function checkOrphanedPredictions() {
  try {
    const res = await fetch(`${API}/admin/orphaned-predictions`, { headers: adminHeaders() });
    if (res.status === 401) return showLogin();
    const rows = await res.json();

    if (!rows.length) {
      orphanedCount.textContent = "Ninguno por ahora — todo está calificado correctamente.";
      repairBtn.hidden = true;
      return;
    }

    const detalle = rows
      .map((r) => `${escapeHtml(r.nickname)} (${escapeHtml(r.local_team)} vs ${escapeHtml(r.away_team)})`)
      .join(", ");
    orphanedCount.textContent = `Encontrados ${rows.length}: ${detalle}`;
    repairBtn.hidden = false;
  } catch {
    orphanedCount.textContent = "No se pudo revisar.";
  }
}

repairBtn.addEventListener("click", async () => {
  repairError.hidden = true;
  repairResult.hidden = true;
  repairBtn.disabled = true;

  try {
    const res = await fetch(`${API}/admin/orphaned-predictions/repair`, {
      method: "POST",
      headers: adminHeaders(),
    });
    if (res.status === 401) return showLogin();
    const data = await res.json();

    if (!res.ok) {
      repairError.textContent = data.error || "No se pudo reparar.";
      repairError.hidden = false;
      return;
    }

    repairResult.textContent = `Listo: se calificaron ${data.repaired} pronósticos, se sumaron ${data.pointsAwarded} puntos en total.`;
    repairResult.hidden = false;
    checkOrphanedPredictions();
  } catch {
    repairError.textContent = "No se pudo conectar con el servidor.";
    repairError.hidden = false;
    checkServerConnection();
  } finally {
    repairBtn.disabled = false;
  }
});

/* ============================================================
   Estado y sincronización manual de resultados en vivo
   ============================================================ */
const liveScoresStatus = document.getElementById("liveScoresStatus");
const syncNowBtn = document.getElementById("syncNowBtn");
const syncError = document.getElementById("syncError");
const syncResult = document.getElementById("syncResult");

async function loadLiveScoresStatus() {
  try {
    const res = await fetch(`${API}/admin/live-scores/status`, { headers: adminHeaders() });
    if (res.status === 401) return showLogin();
    const data = await res.json();
    liveScoresStatus.textContent = data.configured
      ? "API-Football configurada — los partidos vinculados se actualizan solos."
      : "API-Football todavía no está configurada (faltan variables de entorno). Podés seguir cargando resultados a mano.";
  } catch {
    liveScoresStatus.textContent = "No se pudo consultar el estado.";
  }
}

syncNowBtn.addEventListener("click", async () => {
  syncError.hidden = true;
  syncResult.hidden = true;
  syncNowBtn.disabled = true;

  try {
    const res = await fetch(`${API}/admin/live-scores/sync`, {
      method: "POST",
      headers: adminHeaders(),
    });
    if (res.status === 401) return showLogin();
    const data = await res.json();

    if (!res.ok) {
      syncError.textContent = data.error || "No se pudo sincronizar.";
      syncError.hidden = false;
      return;
    }

    syncResult.textContent = `Revisados: ${data.checked} · Calificados automáticamente: ${data.settled}`;
    syncResult.hidden = false;
    loadMatches();
  } catch {
    syncError.textContent = "No se pudo conectar con el servidor.";
    syncError.hidden = false;
    checkServerConnection();
  } finally {
    syncNowBtn.disabled = false;
  }
});

/* ============================================================
   Puntos extra (Campeón / Vicecampeón / Goleador)
   ============================================================ */
const specialAdminList = document.getElementById("specialAdminList");
const specialLabels = { CAMPEON: "Campeón", VICECAMPEON: "Vicecampeón", GOLEADOR: "Goleador" };
const specialDeadlineForm = document.getElementById("specialDeadlineForm");
const specialDeadlineError = document.getElementById("specialDeadlineError");
const specialDeadlineStatus = document.getElementById("specialDeadlineStatus");

async function loadSpecialDeadline() {
  try {
    const res = await fetch(`${API}/special/deadline`);
    const row = await res.json();
    specialDeadlineStatus.textContent = row
      ? `Horario actual: se puede votar hasta ${formatDeadline(row.deadline)}`
      : "Todavía no cargaste un horario límite (por ahora no hay restricción).";
  } catch {
    specialDeadlineStatus.textContent = "";
  }
}

specialDeadlineForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  specialDeadlineError.hidden = true;

  const deadline = new FormData(specialDeadlineForm).get("deadline");
  if (!deadline) return;

  try {
    const res = await fetch(`${API}/admin/special/deadline`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ deadline }),
    });
    if (res.status === 401) return showLogin();
    const data = await res.json();

    if (!res.ok) {
      specialDeadlineError.textContent = data.error || "No se pudo guardar el horario.";
      specialDeadlineError.hidden = false;
      return;
    }

    loadSpecialDeadline();
  } catch {
    specialDeadlineError.textContent = "No se pudo conectar con el servidor.";
    specialDeadlineError.hidden = false;
    checkServerConnection();
  }
});


async function loadSpecialAdmin() {
  try {
    const res = await fetch(`${API}/admin/special`, { headers: adminHeaders() });
    if (res.status === 401) return showLogin();
    const { categories, predictions } = await res.json();

    specialAdminList.innerHTML = "";
    categories.forEach((cat) => {
      const picks = predictions.filter((p) => p.category === cat.category);
      specialAdminList.appendChild(renderSpecialAdminCard(cat, picks));
    });
  } catch {
    specialAdminList.innerHTML = `<p class="empty-state">No se pudieron cargar.</p>`;
  }
}

function renderSpecialAdminCard(cat, picks) {
  const card = document.createElement("div");
  card.className = "match-card";

  const picksSummary = picks.length
    ? picks.map((p) => `${escapeHtml(p.nickname)}: ${escapeHtml(p.answer)}`).join(" · ")
    : "Nadie cargó pronóstico todavía";

  card.innerHTML = `
    <p class="match-card__meta">${specialLabels[cat.category] || cat.category} · ${cat.points} pts</p>
    <p class="section__hint">${picksSummary}</p>
    <form class="ticket__form" style="gap:8px;">
      <input class="field__input" type="text" name="correct_answer" maxlength="60"
        placeholder="Respuesta correcta" value="${cat.correct_answer ? escapeHtml(cat.correct_answer) : ""}">
      <button class="btn ${cat.settled ? "btn--ghost" : "btn--primary"}" type="submit">
        ${cat.settled ? "Corregir respuesta" : "Calificar"}
      </button>
      <p class="field__error" hidden></p>
    </form>
    ${cat.settled ? `<p class="match-card__result">Ya calificada — respuesta actual: ${escapeHtml(cat.correct_answer)}</p>` : ""}
  `;

  const form = card.querySelector("form");
  const errorEl = card.querySelector(".field__error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const correct_answer = new FormData(form).get("correct_answer").toString().trim();
    if (!correct_answer) return;

    const confirmed = confirm(
      `¿Confirmás "${correct_answer}" como respuesta correcta de ${specialLabels[cat.category]}? Esto reparte los puntos a quienes acertaron.`
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`${API}/admin/special/${cat.category}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ correct_answer }),
      });
      if (res.status === 401) return showLogin();
      const data = await res.json();

      if (!res.ok) {
        errorEl.textContent = data.error || "No se pudo calificar.";
        errorEl.hidden = false;
        return;
      }

      loadSpecialAdmin();
    } catch {
      errorEl.textContent = "No se pudo conectar con el servidor.";
      errorEl.hidden = false;
      checkServerConnection();
    }
  });

  return card;
}

/* ============================================================
   Cargar pronósticos ya hechos (fuera del sistema, a mano)
   ============================================================ */
const manualMatchSelect = document.getElementById("manualMatchSelect");
const manualPredictionsList = document.getElementById("manualPredictionsList");
const manualGroupFilter = document.getElementById("manualGroupFilter");

manualGroupFilter.addEventListener("change", loadManualPredictions);

function populateManualMatchSelect(matches) {
  const current = manualMatchSelect.value;
  manualMatchSelect.innerHTML =
    `<option value="">Seleccioná un partido…</option>` +
    matches
      .map(
        (m) =>
          `<option value="${m.id}">${m.matchday ? `Fecha ${m.matchday} — ` : ""}${escapeHtml(m.local_team)} vs ${escapeHtml(m.away_team)} (${m.status === "FINISHED" ? "finalizado" : "programado"})</option>`
      )
      .join("");
  manualMatchSelect.value = current;
}

manualMatchSelect.addEventListener("change", loadManualPredictions);

async function loadManualPredictions() {
  const matchId = manualMatchSelect.value;
  if (!matchId) {
    manualPredictionsList.innerHTML = `<p class="empty-state">Elegí un partido arriba para ver a los usuarios.</p>`;
    return;
  }

  manualPredictionsList.innerHTML = `<p class="empty-state">Cargando…</p>`;

  try {
    const groupId = manualGroupFilter.value;
    const usersUrl = groupId ? `${API}/admin/groups/${groupId}/members` : `${API}/admin/users`;

    const usersRes = await fetch(usersUrl, { headers: adminHeaders() });
    if (usersRes.status === 401) return showLogin();
    const usersForManualPredictions = await usersRes.json();

    const predRes = await fetch(`${API}/admin/predictions?match_id=${matchId}`, {
      headers: adminHeaders(),
    });
    if (predRes.status === 401) return showLogin();
    const predictions = await predRes.json();
    const pickByUser = {};
    predictions.forEach((p) => (pickByUser[p.user_id] = p.user_pick));

    if (!usersForManualPredictions.length) {
      manualPredictionsList.innerHTML = `<p class="empty-state">Todavía no hay usuarios registrados.</p>`;
      return;
    }

    manualPredictionsList.innerHTML = usersForManualPredictions
      .map((u) => {
        const currentPick = pickByUser[u.id];
        const btn = (pick, label) =>
          `<button class="pick-btn manual-pick-btn${currentPick === pick ? " is-selected" : ""}" data-user="${u.id}" data-pick="${pick}" type="button">${label}</button>`;
        return `
          <div class="board__row" style="grid-template-columns: 1fr auto;">
            <span>${escapeHtml(u.nickname)}</span>
            <div class="picks" style="grid-template-columns: repeat(3, 40px); max-width:none; margin:0;">
              ${btn("LOCAL", "L")}${btn("EMPATE", "E")}${btn("VISITA", "V")}
            </div>
          </div>`;
      })
      .join("");

    manualPredictionsList.querySelectorAll(".manual-pick-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const userId = btn.dataset.user;
        const pick = btn.dataset.pick;

        try {
          const res = await fetch(`${API}/admin/predictions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...adminHeaders() },
            body: JSON.stringify({ user_id: Number(userId), match_id: Number(matchId), user_pick: pick }),
          });
          if (res.status === 401) return showLogin();
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || "No se pudo cargar el pronóstico.");
            return;
          }

          // Actualizar visualmente sin recargar todo
          const row = btn.closest(".board__row");
          row.querySelectorAll(".manual-pick-btn").forEach((b) => b.classList.remove("is-selected"));
          btn.classList.add("is-selected");
        } catch {
          checkServerConnection();
        }
      });
    });
  } catch {
    manualPredictionsList.innerHTML = `<p class="empty-state">No se pudo cargar la información.</p>`;
    checkServerConnection();
  }
}

/* ============================================================
   Cargar puntos que los usuarios ya tenían
   ============================================================ */
const pointsForm = document.getElementById("pointsForm");
const pointsError = document.getElementById("pointsError");
const pointsSuccess = document.getElementById("pointsSuccess");
const pointsUserSelect = document.getElementById("pointsUserSelect");
const pointsGroupFilter = document.getElementById("pointsGroupFilter");

pointsGroupFilter.addEventListener("change", () => loadUsersForPoints());

async function loadUsersForPoints() {
  const groupId = pointsGroupFilter.value;
  const url = groupId ? `${API}/admin/groups/${groupId}/members` : `${API}/admin/users`;

  try {
    const res = await fetch(url, { headers: adminHeaders() });
    if (res.status === 401) return showLogin();
    const users = await res.json();

    pointsUserSelect.innerHTML = users.length
      ? users
          .map(
            (u) =>
              `<option value="${u.id}">${escapeHtml(u.nickname)} — ${escapeHtml(u.first_name)} ${escapeHtml(u.last_name)} (${u.total_points} pts)</option>`
          )
          .join("")
      : `<option value="">No hay usuarios en este grupo</option>`;
  } catch {
    pointsUserSelect.innerHTML = `<option value="">No se pudo cargar</option>`;
  }
}

pointsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  pointsError.hidden = true;
  pointsSuccess.hidden = true;

  const formData = new FormData(pointsForm);
  const userId = formData.get("user_id");
  const points = Number(formData.get("points"));

  if (!userId || Number.isNaN(points)) {
    pointsError.textContent = "Elegí un usuario e ingresá un número de puntos válido.";
    pointsError.hidden = false;
    return;
  }

  try {
    const res = await fetch(`${API}/admin/users/${userId}/points`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ points }),
    });

    if (res.status === 401) return showLogin();
    const data = await res.json();

    if (!res.ok) {
      pointsError.textContent = data.error || "No se pudieron aplicar los puntos.";
      pointsError.hidden = false;
      return;
    }

    pointsSuccess.textContent = `Listo: ${data.nickname} ahora tiene ${data.total_points} puntos.`;
    pointsSuccess.hidden = false;
    pointsForm.reset();
    loadUsersForPoints();
  } catch {
    pointsError.textContent = "No se pudo conectar con el servidor.";
    pointsError.hidden = false;
    checkServerConnection();
  }
});

/* ============================================================
   Aciertos y partidos jugados antes del sistema
   ============================================================ */
const extraStatsForm = document.getElementById("extraStatsForm");
const extraStatsError = document.getElementById("extraStatsError");
const extraStatsSuccess = document.getElementById("extraStatsSuccess");
const extraStatsUserSelect = document.getElementById("extraStatsUserSelect");

async function loadUsersForExtraStats() {
  try {
    const res = await fetch(`${API}/admin/users`, { headers: adminHeaders() });
    if (res.status === 401) return showLogin();
    const users = await res.json();

    extraStatsUserSelect.innerHTML = users.length
      ? users
          .map(
            (u) =>
              `<option value="${u.id}">${escapeHtml(u.nickname)} — ${escapeHtml(u.first_name)} ${escapeHtml(u.last_name)} (previo: ${u.extra_hits}/${u.extra_matches})</option>`
          )
          .join("")
      : `<option value="">No hay usuarios registrados</option>`;
  } catch {
    extraStatsUserSelect.innerHTML = `<option value="">No se pudo cargar</option>`;
  }
}

extraStatsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  extraStatsError.hidden = true;
  extraStatsSuccess.hidden = true;

  const formData = new FormData(extraStatsForm);
  const userId = formData.get("user_id");
  const extra_matches = Number(formData.get("extra_matches"));
  const extra_hits = Number(formData.get("extra_hits"));

  if (!userId || Number.isNaN(extra_matches) || Number.isNaN(extra_hits)) {
    extraStatsError.textContent = "Elegí un usuario y completá ambos números.";
    extraStatsError.hidden = false;
    return;
  }

  try {
    const res = await fetch(`${API}/admin/users/${userId}/extra-stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ extra_hits, extra_matches }),
    });

    if (res.status === 401) return showLogin();
    const data = await res.json();

    if (!res.ok) {
      extraStatsError.textContent = data.error || "No se pudo guardar.";
      extraStatsError.hidden = false;
      return;
    }

    extraStatsSuccess.textContent = `Listo: ${data.nickname} ahora suma ${data.extra_hits}/${data.extra_matches} de antes del sistema.`;
    extraStatsSuccess.hidden = false;
    extraStatsForm.reset();
    loadUsersForExtraStats();
  } catch {
    extraStatsError.textContent = "No se pudo conectar con el servidor.";
    extraStatsError.hidden = false;
    checkServerConnection();
  }
});

/* ============================================================
   Horario límite para votar, por fecha
   ============================================================ */
const deadlineForm = document.getElementById("deadlineForm");
const deadlineError = document.getElementById("deadlineError");
const deadlinesList = document.getElementById("deadlinesList");

function formatDeadline(iso) {
  return new Date(iso).toLocaleString("es-PY", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadDeadlines() {
  try {
    const res = await fetch(`${API}/admin/matchdays`, { headers: adminHeaders() });
    if (res.status === 401) return showLogin();
    const rows = await res.json();

    if (!rows.length) {
      deadlinesList.innerHTML = `<p class="empty-state">Todavía no cargaste ningún horario límite.</p>`;
      return;
    }

    const head = `
      <div class="board__row board__row--head" style="grid-template-columns: 1fr 2fr auto;">
        <span>Fecha</span>
        <span>Se puede votar hasta</span>
        <span></span>
      </div>`;

    const body = rows
      .map(
        (r) => `
        <div class="board__row" style="grid-template-columns: 1fr 2fr auto;">
          <span>Fecha ${r.matchday}</span>
          <span>${formatDeadline(r.vote_deadline)}</span>
          <button class="session-logout" data-matchday="${r.matchday}" type="button">Quitar</button>
        </div>`
      )
      .join("");

    deadlinesList.innerHTML = head + body;

    deadlinesList.querySelectorAll("button[data-matchday]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const confirmed = confirm(`¿Quitar el horario límite de la fecha ${btn.dataset.matchday}?`);
        if (!confirmed) return;
        try {
          const res = await fetch(`${API}/admin/matchdays/${btn.dataset.matchday}/deadline`, {
            method: "DELETE",
            headers: adminHeaders(),
          });
          if (res.status === 401) return showLogin();
          loadDeadlines();
        } catch {
          checkServerConnection();
        }
      });
    });
  } catch {
    deadlinesList.innerHTML = `<p class="empty-state">No se pudieron cargar los horarios.</p>`;
  }
}

deadlineForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  deadlineError.hidden = true;

  const formData = new FormData(deadlineForm);
  const matchday = formData.get("matchday");
  const voteDeadline = formData.get("vote_deadline");

  if (!matchday || !voteDeadline) {
    deadlineError.textContent = "Completá la fecha y el horario.";
    deadlineError.hidden = false;
    return;
  }

  try {
    const res = await fetch(`${API}/admin/matchdays/${matchday}/deadline`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ vote_deadline: voteDeadline }),
    });

    if (res.status === 401) return showLogin();
    const data = await res.json();

    if (!res.ok) {
      deadlineError.textContent = data.error || "No se pudo guardar el horario.";
      deadlineError.hidden = false;
      return;
    }

    deadlineForm.reset();
    loadDeadlines();
  } catch {
    deadlineError.textContent = "No se pudo conectar con el servidor.";
    deadlineError.hidden = false;
    checkServerConnection();
  }
});

/* ============================================================
   Grupos de amigos
   ============================================================ */
function populateGroupFilterSelect(select, groups) {
  const current = select.value;
  select.innerHTML =
    `<option value="">Todos los grupos</option>` +
    groups.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
  select.value = current;
}

const createGroupForm = document.getElementById("createGroupForm");
const groupError = document.getElementById("groupError");
const groupsList = document.getElementById("groupsList");

async function loadGroups() {
  try {
    const res = await fetch(`${API}/admin/groups`, { headers: adminHeaders() });
    if (res.status === 401) return showLogin();
    const groups = await res.json();

    populateGroupFilterSelect(pointsGroupFilter, groups);
    populateGroupFilterSelect(manualGroupFilter, groups);

    if (!groups.length) {
      groupsList.innerHTML = `<p class="empty-state">Todavía no creaste ningún grupo.</p>`;
      return;
    }

    const head = `
      <div class="board__row board__row--head">
        <span>Grupo</span>
        <span>Código</span>
        <span>Miembros</span>
      </div>`;

    const body = groups
      .map(
        (g) => `
        <div class="board__row" style="grid-template-columns: 1fr auto auto;">
          <span>${escapeHtml(g.name)}</span>
          <span class="board__pts" style="font-size:14px;">${escapeHtml(g.code)}</span>
          <span class="board__pts" style="font-size:14px;">${g.miembros}</span>
        </div>`
      )
      .join("");

    groupsList.innerHTML = head + body;
  } catch {
    groupsList.innerHTML = `<p class="empty-state">No se pudieron cargar los grupos.</p>`;
  }
}

createGroupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  groupError.hidden = true;

  const name = new FormData(createGroupForm).get("name").toString().trim();
  if (!name) return;

  try {
    const res = await fetch(`${API}/admin/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ name }),
    });

    if (res.status === 401) return showLogin();
    const data = await res.json();

    if (!res.ok) {
      groupError.textContent = data.error || "No se pudo crear el grupo.";
      groupError.hidden = false;
      return;
    }

    createGroupForm.reset();
    loadGroups();
  } catch {
    groupError.textContent = "No se pudo conectar con el servidor.";
    groupError.hidden = false;
    checkServerConnection();
  }
});

/* ============================================================
   Menú de pestañas del admin
   ============================================================ */
const adminSegmentNav = document.getElementById("adminSegmentNav");
const adminTabs = {
  partidos: document.getElementById("adminTab-partidos"),
  votos: document.getElementById("adminTab-votos"),
  puntos: document.getElementById("adminTab-puntos"),
  especiales: document.getElementById("adminTab-especiales"),
  grupos: document.getElementById("adminTab-grupos"),
};

function switchAdminTab(name) {
  Object.entries(adminTabs).forEach(([key, el]) => {
    if (el) el.hidden = key !== name;
  });
  adminSegmentNav.querySelectorAll(".segment-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.adminTab === name);
  });
}

adminSegmentNav.addEventListener("click", (e) => {
  const btn = e.target.closest(".segment-btn");
  if (!btn) return;
  switchAdminTab(btn.dataset.adminTab);
});
