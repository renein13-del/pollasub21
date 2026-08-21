const API = ""; // mismo origen (Express sirve la web y la API)

const params = new URLSearchParams(location.search);
const token = params.get("token");

const resetForm = document.getElementById("resetForm");
const resetError = document.getElementById("resetError");
const resetSuccess = document.getElementById("resetSuccess");
const resetNoToken = document.getElementById("resetNoToken");

if (!token) {
  resetForm.hidden = true;
  resetNoToken.hidden = false;
} else {
  resetForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    resetError.hidden = true;

    const formData = new FormData(resetForm);
    const password = formData.get("password").toString();
    const passwordConfirm = formData.get("password_confirm").toString();

    if (password !== passwordConfirm) {
      resetError.textContent = "Las contraseñas no coinciden.";
      resetError.hidden = false;
      return;
    }

    const submitBtn = resetForm.querySelector("button[type=submit]");
    submitBtn.disabled = true;

    try {
      const res = await fetch(`${API}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        resetError.textContent = data.error || "No se pudo restablecer la contraseña.";
        resetError.hidden = false;
        return;
      }

      resetForm.hidden = true;
      resetSuccess.hidden = false;
    } catch {
      resetError.textContent = "No se pudo conectar con el servidor. Probá de nuevo en unos minutos.";
      resetError.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
