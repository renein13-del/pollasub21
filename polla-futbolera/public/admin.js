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
    showConnBanner(
      "Esta página se abrió como archivo, no por el servidor. Corré <code>npm run dev</code> " +
      "y entrá por <code>http://localhost:3000/admin.html</code>."
    );
    return;
  }
  try {
    const res = await fetch(`${API}/health`);
    if (!res.ok) throw new Error();
    hideConnBanner();
  } catch {
    showConnBanner("No se pudo conectar con el servidor. Revisá que esté corriendo con <code>npm run dev</code>.");
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

  const formData = new FormData(adminLoginForm);
  const password = formData.get("password").toString();

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
   Crear partido
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
    scheduled.forEach((m) => scheduledList.appendChild(renderScheduledCard(m)));

    finishedList.innerHTML = finished.length
      ? ""
      : `<p class="empty-state">Todavía no hay partidos finalizados.</p>`;
    finished.forEach((m) => finishedList.appendChild(renderFinishedCard(m)));
  } catch {
    scheduledList.innerHTML = `<p class="empty-state">No se pudieron cargar los partidos.</p>`;
    finishedList.innerHTML = "";
    checkServerConnection();
  }
}

function renderScheduledCard(match) {
  const card = document.createElement("div");
  card.className = "match-card";

  card.innerHTML = `
    <p class="match-card__meta">${match.matchday ? `Fecha ${match.matchday}` : "Sin fecha asignada"}</p>
    <div class="match-card__teams">
      <span>${escapeHtml(match.local_team)}</span>
      <span class="match-card__vs">vs</span>
      <span>${escapeHtml(match.away_team)}</span>
    </div>
    <p class="section__hint" style="text-align:center;">Tocá el resultado final para calificar los pronósticos</p>
    <div class="picks">
      <button class="pick-btn" data-result="LOCAL" type="button">Ganó Local</button>
      <button class="pick-btn" data-result="EMPATE" type="button">Empate</button>
      <button class="pick-btn" data-result="VISITA" type="button">Ganó Visita</button>
    </div>
    <p class="field__error" hidden></p>
  `;

  const buttons = card.querySelectorAll(".pick-btn");
  const errorEl = card.querySelector(".field__error");

  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const confirmed = confirm(
        `¿Confirmás el resultado "${btn.textContent}" para ${match.local_team} vs ${match.away_team}? ` +
        `Esto califica todos los pronósticos y no se puede deshacer.`
      );
      if (!confirmed) return;

      buttons.forEach((b) => (b.disabled = true));
      errorEl.hidden = true;

      try {
        const res = await fetch(`${API}/matches/${match.id}/result`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...adminHeaders() },
          body: JSON.stringify({ result: btn.dataset.result }),
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

function renderFinishedCard(match) {
  const card = document.createElement("div");
  card.className = "match-card";
  card.innerHTML = `
    <p class="match-card__meta">${match.matchday ? `Fecha ${match.matchday}` : ""}</p>
    <div class="match-card__teams">
      <span>${escapeHtml(match.local_team)}</span>
      <span class="match-card__vs">vs</span>
      <span>${escapeHtml(match.away_team)}</span>
    </div>
    <p class="match-card__result">Resultado: ${match.result}</p>
  `;
  return card;
}

/* ============================================================
   Init
   ============================================================ */
checkServerConnection();
if (getAdminToken()) {
  showPanel();
} else {
  showLogin();
}
