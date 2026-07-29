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
  loadGroups();
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

async function loadMatches() {
  try {
    const res = await fetch(`${API}/matches`);
    const matches = await res.json();
    hideConnBanner();

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
  `;

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
   Cargar puntos que los usuarios ya tenían
   ============================================================ */
const pointsForm = document.getElementById("pointsForm");
const pointsError = document.getElementById("pointsError");
const pointsSuccess = document.getElementById("pointsSuccess");
const pointsUserSelect = document.getElementById("pointsUserSelect");

async function loadUsersForPoints() {
  try {
    const res = await fetch(`${API}/admin/users`, { headers: adminHeaders() });
    if (res.status === 401) return showLogin();
    const users = await res.json();

    pointsUserSelect.innerHTML = users.length
      ? users
          .map(
            (u) =>
              `<option value="${u.id}">${escapeHtml(u.nickname)} — ${escapeHtml(u.first_name)} ${escapeHtml(u.last_name)} (${u.total_points} pts)</option>`
          )
          .join("")
      : `<option value="">Todavía no hay usuarios registrados</option>`;
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
   Grupos de amigos
   ============================================================ */
const createGroupForm = document.getElementById("createGroupForm");
const groupError = document.getElementById("groupError");
const groupsList = document.getElementById("groupsList");

async function loadGroups() {
  try {
    const res = await fetch(`${API}/admin/groups`, { headers: adminHeaders() });
    if (res.status === 401) return showLogin();
    const groups = await res.json();

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
   Init
   ============================================================ */
checkServerConnection();
if (getAdminToken()) {
  showPanel();
} else {
  showLogin();
}
