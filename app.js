const SOS_CONFIG = window.SOS_CONFIG || {};
const API = SOS_CONFIG.API_BASE || "https://sos.vsti.cl";
const TOKEN_KEY = "sos_superadmin_token";
const USER_KEY = "sos_superadmin_user";
const API_TIMEOUT_MS = Number(SOS_CONFIG.API_TIMEOUT_MS || 20000);


const $ = (id) => document.getElementById(id);
let centers = [];

function token() { return localStorage.getItem(TOKEN_KEY) || ""; }
function user() { try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch { return null; } }
function setSession(tokenValue, userValue) { localStorage.setItem(TOKEN_KEY, tokenValue); localStorage.setItem(USER_KEY, JSON.stringify(userValue || {})); }
function clearSession() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
function headers(extra = {}) { return { "Content-Type": "application/json", ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...extra }; }
function toast(message) { const el = $("toast"); if (!el) return; el.textContent = message; el.hidden = false; setTimeout(() => el.hidden = true, 3500); }
function setMsg(id, message, ok = true) { const el = $(id); if (!el) return; el.textContent = message || ""; el.style.color = ok ? "#16a34a" : "#b91c1c"; }
function ccCode() { return ($("ccCode").value || "").trim().toUpperCase(); }

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const url = `${API}${path}`;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...options,
      signal: controller.signal,
      headers: { ...headers(), ...(options.headers || {}) }
    });

    const raw = await res.text();
    let data = {};
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (_) {
        data = { status: "error", message: raw.slice(0, 300) };
      }
    }

    if (!res.ok || data.status === "error") {
      throw new Error(data.message || `HTTP ${res.status}`);
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`La API no respondió en ${Math.round(API_TIMEOUT_MS / 1000)} segundos. Revisa si API-TEST está despierta/redeployada.`);
    }
    if (error instanceof TypeError) {
      throw new Error(`No fue posible conectar con la API (${API}). Revisa CORS, URL o estado de Render.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function login() {
  const phone = $("loginPhone").value.trim();
  if (!phone) return setMsg("loginMsg", "Ingresa el teléfono SUPER_ADMIN", false);
  $("loginBtn").disabled = true;
  setMsg("loginMsg", `Validando contra ${API}...`, true);
  try {
    const data = await api("/auth/panel-login", { method: "POST", body: JSON.stringify({ phone, panel_type: "SUPER_ADMIN" }) });
    if (data.user?.role !== "SUPER_ADMIN") throw new Error("Este acceso requiere rol SUPER_ADMIN");
    setSession(data.token, data.user);
    showApp(data.user);
    setMsg("loginMsg", "", true);
    await loadCenters().catch((error) => toast(`Sesión OK, pero no pude cargar centros: ${error.message}`));
  } catch (error) {
    clearSession();
    setMsg("loginMsg", error.message, false);
  } finally {
    $("loginBtn").disabled = false;
  }
}

async function checkSession() {
  if (!token()) return showLogin();
  try {
    const data = await api("/auth/session");
    if (data.user?.role !== "SUPER_ADMIN") throw new Error("Este acceso requiere rol SUPER_ADMIN");
    setSession(token(), data.user);
    showApp(data.user);
    setMsg("loginMsg", "", true);
    await loadCenters().catch((error) => toast(`Sesión OK, pero no pude cargar centros: ${error.message}`));
  } catch (error) {
    clearSession();
    showLogin(error.message);
  }
}

function showLogin(message = "") {
  $("loginView").hidden = false;
  $("appView").hidden = true;
  $("sessionLabel").hidden = true;
  $("logoutBtn").hidden = true;
  setMsg("loginMsg", message, false);
}

function showApp(currentUser) {
  $("loginView").hidden = true;
  $("appView").hidden = false;
  $("sessionLabel").hidden = false;
  $("logoutBtn").hidden = false;
  $("sessionLabel").textContent = `${currentUser?.full_name || "SUPER_ADMIN"} · ${currentUser?.phone || ""}`;
}

function logout() { clearSession(); showLogin("Sesión cerrada."); }

function fillFromCenter(center) {
  $("ccCode").value = center.code || "";
  $("ccName").value = center.name || "";
  $("ccMunicipality").value = center.municipality || "";
  $("ccRegion").value = center.region || "";
  $("ccLat").value = center.map_center_lat || center.latitude || "";
  $("ccLon").value = center.map_center_lon || center.longitude || "";
  $("ccZoom").value = center.map_zoom || 13;
  $("ccBuffer").value = center.geofence_buffer_meters || 100;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderCenters() {
  $("centersCount").textContent = `${centers.length} centros`;
  $("centersList").innerHTML = centers.map((cc) => `
    <div class="center-row">
      <div>
        <div class="center-code">${escapeHtml(cc.code)}</div>
        <div>${escapeHtml(cc.name || "-")}</div>
        <small>${escapeHtml(cc.municipality || "-")} · ${escapeHtml(cc.region || "-")}</small>
      </div>
      <div class="badges">
        <span class="badge ${cc.boundary_type ? "green" : "amber"}">${cc.boundary_type ? "Boundary OK" : "Sin boundary"}</span>
        <span class="badge">${cc.admins_count || 0} admin</span>
      </div>
      <div class="badges">
        <span class="badge">${cc.operators_count || 0} op</span>
        <span class="badge">${cc.resolvers_count || 0} resolv</span>
        <span class="badge">${cc.neighbors_count || 0} vec</span>
      </div>
      <button class="secondary" data-code="${escapeHtml(cc.code)}">Editar</button>
    </div>
  `).join("") || `<p>No hay centros cargados.</p>`;
  document.querySelectorAll("button[data-code]").forEach((btn) => btn.addEventListener("click", () => {
    const center = centers.find((item) => item.code === btn.dataset.code);
    if (center) fillFromCenter(center);
  }));
}

async function loadCenters() {
  const data = await api("/superadmin/control-centers");
  centers = data.control_centers || [];
  renderCenters();
}

async function saveCenter() {
  const payload = {
    code: ccCode(),
    name: $("ccName").value.trim(),
    municipality: $("ccMunicipality").value.trim(),
    region: $("ccRegion").value.trim(),
    latitude: $("ccLat").value === "" ? null : Number($("ccLat").value),
    longitude: $("ccLon").value === "" ? null : Number($("ccLon").value),
    map_zoom: Number($("ccZoom").value || 13),
    geofence_buffer_meters: Number($("ccBuffer").value || 100)
  };
  if (!payload.code || !payload.name) return setMsg("centerMsg", "Código y nombre son obligatorios", false);
  try {
    const data = await api("/superadmin/control-centers", { method: "POST", body: JSON.stringify(payload) });
    setMsg("centerMsg", `Centro guardado: ${data.control_center.code}`, true);
    toast("Centro guardado");
    await loadCenters();
  } catch (error) { setMsg("centerMsg", error.message, false); }
}

async function saveAdmin() {
  const code = ccCode();
  if (!code) return setMsg("adminMsg", "Primero indica el código del centro", false);
  const payload = {
    full_name: $("adminName").value.trim(),
    phone: $("adminPhone").value.trim(),
    email: $("adminEmail").value.trim(),
    declared_address: $("adminAddress").value.trim()
  };
  if (!payload.full_name || !payload.phone) return setMsg("adminMsg", "Nombre y teléfono son obligatorios", false);
  try {
    const data = await api(`/superadmin/control-centers/${encodeURIComponent(code)}/admin`, { method: "POST", body: JSON.stringify(payload) });
    setMsg("adminMsg", `ADMIN ${data.operation}: ${data.user.full_name}`, true);
    toast("Administrador municipal listo");
    await loadCenters();
  } catch (error) { setMsg("adminMsg", error.message, false); }
}

function readJsonFile(input) {
  const file = input.files?.[0];
  if (!file) throw new Error("Selecciona un archivo GeoJSON");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(reader.result)); } catch (error) { reject(new Error("El archivo no es JSON válido")); }
    };
    reader.onerror = () => reject(new Error("No fue posible leer el archivo"));
    reader.readAsText(file);
  });
}

async function uploadBoundary() {
  const code = ccCode();
  if (!code) return setMsg("boundaryMsg", "Primero indica el código del centro", false);
  try {
    const geojson = await readJsonFile($("boundaryFile"));
    const payload = { geojson, map_zoom: Number($("boundaryZoom").value || 13), geofence_buffer_meters: Number($("ccBuffer").value || 100) };
    const data = await api(`/superadmin/control-centers/${encodeURIComponent(code)}/boundary`, { method: "POST", body: JSON.stringify(payload) });
    setMsg("boundaryMsg", `Boundary cargado: ${data.control_center.boundary_type}`, true);
    toast("Boundary cargado");
    await loadCenters();
  } catch (error) { setMsg("boundaryMsg", error.message, false); }
}

async function uploadSectors() {
  const code = ccCode();
  if (!code) return setMsg("sectorsMsg", "Primero indica el código del centro", false);
  try {
    const geojson = await readJsonFile($("sectorsFile"));
    const data = await api(`/admin/control-centers/${encodeURIComponent(code)}/sectors/bulk`, { method: "POST", body: JSON.stringify(geojson) });
    let msg = `Sectores cargados: ${data.inserted}, omitidos: ${data.skipped}`;
    if ($("reclassifyAfter").value === "true") {
      const rec = await api(`/admin/control-centers/${encodeURIComponent(code)}/sectors/reclassify-tickets`, { method: "POST", body: JSON.stringify({ limit: 5000 }) });
      msg += ` · tickets reclasificados: ${rec.updated}`;
    }
    setMsg("sectorsMsg", msg, true);
    toast("Unidades Vecinales cargadas");
  } catch (error) { setMsg("sectorsMsg", error.message, false); }
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

window.addEventListener("error", (event) => {
  setMsg("loginMsg", event.message || "Error JavaScript inesperado", false);
});

window.addEventListener("unhandledrejection", (event) => {
  const message = event.reason?.message || String(event.reason || "Error de promesa no controlado");
  setMsg("loginMsg", message, false);
});

window.addEventListener("DOMContentLoaded", () => {
  $("loginBtn").addEventListener("click", login);
  $("loginPhone").addEventListener("keydown", (ev) => { if (ev.key === "Enter") login(); });
  $("logoutBtn").addEventListener("click", logout);
  $("reloadCentersBtn").addEventListener("click", () => loadCenters().catch((e) => toast(e.message)));
  $("saveCenterBtn").addEventListener("click", saveCenter);
  $("saveAdminBtn").addEventListener("click", saveAdmin);
  $("uploadBoundaryBtn").addEventListener("click", uploadBoundary);
  $("uploadSectorsBtn").addEventListener("click", uploadSectors);
  checkSession();
});
