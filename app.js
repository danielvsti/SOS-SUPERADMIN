const SOS_CONFIG = window.SOS_CONFIG || {};
const API = SOS_CONFIG.API_BASE || "https://sos.vsti.cl";
const TOKEN_KEY = "sos_superadmin_token";
const USER_KEY = "sos_superadmin_user";
const API_TIMEOUT_MS = Number(SOS_CONFIG.API_TIMEOUT_MS || 20000);
const APP_VERSION = "superadmin-v4-safe-login-20260703";

const $ = (id) => document.getElementById(id);
let centers = [];
let emergencyCategories = [];

function token() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function user() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

function setSession(tokenValue, userValue) {
  localStorage.setItem(TOKEN_KEY, tokenValue);
  localStorage.setItem(USER_KEY, JSON.stringify(userValue || {}));
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function headers(extra = {}) {
  return {
    "Content-Type": "application/json",
    ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
    ...extra
  };
}

function toast(message) {
  const el = $("toast");
  if (!el) {
    console.log("[SOS-SUPERADMIN][toast]", message);
    return;
  }
  el.textContent = message;
  el.hidden = false;
  setTimeout(() => {
    el.hidden = true;
  }, 3500);
}

function setMsg(id, message, ok = true) {
  const el = $(id);
  if (!el) {
    console.log("[SOS-SUPERADMIN][msg]", id, message);
    return;
  }
  el.textContent = message || "";
  el.style.color = ok ? "#16a34a" : "#b91c1c";
}

function logDebug(...args) {
  try {
    console.log("[SOS-SUPERADMIN]", APP_VERSION, ...args);
  } catch (_) {}
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function ccCode() {
  const el = $("ccCode");
  return (el?.value || "").trim().toUpperCase();
}

function setValue(id, value) {
  const el = $(id);
  if (el) el.value = value ?? "";
}

function getValue(id) {
  return ($(id)?.value || "").trim();
}

function on(id, eventName, handler) {
  const el = $(id);
  if (!el) {
    logDebug(`Elemento no encontrado: #${id}`);
    return;
  }
  el.addEventListener(eventName, handler);
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const url = `${API}${path}`;

  try {
    logDebug("api request", url);

    const res = await fetch(url, {
      cache: "no-store",
      ...options,
      signal: controller.signal,
      headers: {
        ...headers(),
        ...(options.headers || {})
      }
    });

    const raw = await res.text();
    let data = {};

    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (_) {
        data = {
          status: "error",
          message: raw.slice(0, 500)
        };
      }
    }

    logDebug("api response", path, res.status, data);

    if (!res.ok || data.status === "error") {
      throw new Error(data.message || `HTTP ${res.status}`);
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`La API no respondió en ${Math.round(API_TIMEOUT_MS / 1000)} segundos. Revisa API-TEST/Render.`);
    }

    if (error instanceof TypeError) {
      throw new Error(`No fue posible conectar con la API (${API}). Revisa CORS, URL o estado de Render.`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function showLogin(message = "") {
  const loginView = $("loginView");
  const appView = $("appView");
  const sessionLabel = $("sessionLabel");
  const logoutBtn = $("logoutBtn");

  if (loginView) {
    loginView.hidden = false;
    loginView.style.display = "";
  }

  if (appView) {
    appView.hidden = true;
    appView.style.display = "none";
  }

  if (sessionLabel) sessionLabel.hidden = true;
  if (logoutBtn) logoutBtn.hidden = true;

  setMsg("loginMsg", message, false);
}

function showApp(currentUser) {
  logDebug("showApp", currentUser);

  const loginView = $("loginView");
  const appView = $("appView");
  const sessionLabel = $("sessionLabel");
  const logoutBtn = $("logoutBtn");

  if (!loginView || !appView) {
    throw new Error("No encontré #loginView o #appView. Revisa que index.html y app.js sean de la misma versión.");
  }

  loginView.hidden = true;
  loginView.style.display = "none";

  appView.hidden = false;
  appView.style.display = "";

  if (sessionLabel) {
    sessionLabel.hidden = false;
    sessionLabel.textContent = `${currentUser?.full_name || "SUPER_ADMIN"} · ${currentUser?.phone || ""} · ${currentUser?.control_center_code || ""}`;
  }

  if (logoutBtn) logoutBtn.hidden = false;
}

async function login() {
  const phone = getValue("loginPhone");

  if (!phone) {
    setMsg("loginMsg", "Ingresa el teléfono SUPER_ADMIN", false);
    return;
  }

  const loginBtn = $("loginBtn");
  if (loginBtn) loginBtn.disabled = true;

  setMsg("loginMsg", `Conectando a ${API}...`, true);

  try {
    logDebug("login start", phone);

    const data = await api("/auth/panel-login", {
      method: "POST",
      body: JSON.stringify({
        phone,
        panel_type: "SUPER_ADMIN"
      })
    });

    if (!data.token) {
      throw new Error("La API respondió login OK, pero no devolvió token.");
    }

    if (data.user?.role !== "SUPER_ADMIN") {
      throw new Error(`Este acceso requiere rol SUPER_ADMIN. Rol recibido: ${data.user?.role || "sin rol"}`);
    }

    setSession(data.token, data.user);
    showApp(data.user);
    setMsg("loginMsg", "Sesión SUPER_ADMIN iniciada.", true);

    Promise.allSettled([loadCenters(), loadEmergencyCategories()]).then((results) => {
      const failed = results.find((result) => result.status === "rejected");
      if (!failed) return;
      const error = failed.reason;
      logDebug("initial load error", error);
      toast(`Sesión OK, pero no pude cargar centros: ${error.message}`);
      const list = $("centersList");
      if (list) {
        list.innerHTML = `<p>Sesión iniciada, pero no se pudo cargar el listado de centros: ${escapeHtml(error.message)}</p>`;
      }
    });
  } catch (error) {
    logDebug("login error", error);
    clearSession();
    setMsg("loginMsg", error.message || String(error), false);
  } finally {
    if (loginBtn) loginBtn.disabled = false;
  }
}

async function checkSession() {
  if (!token()) {
    showLogin();
    return;
  }

  try {
    const data = await api("/auth/session");

    if (data.user?.role !== "SUPER_ADMIN") {
      throw new Error("Este acceso requiere rol SUPER_ADMIN");
    }

    setSession(token(), data.user);
    showApp(data.user);

    Promise.allSettled([loadCenters(), loadEmergencyCategories()]).then((results) => {
      const failed = results.find((result) => result.status === "rejected");
      if (failed) toast(`Sesión OK, pero no pude cargar todo: ${failed.reason.message}`);
    });
  } catch (error) {
    clearSession();
    showLogin(error.message);
  }
}

function logout() {
  clearSession();
  showLogin("Sesión cerrada.");
}


function adminsForCenter(center) {
  if (!center) return [];
  const raw = center.admins;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function primaryAdminForCenter(center) {
  const admins = adminsForCenter(center).filter((admin) => admin && admin.is_active !== false);
  return admins[0] || adminsForCenter(center)[0] || null;
}

function clearAdminForm() {
  setValue("adminName", "");
  setValue("adminPhone", "");
  setValue("adminEmail", "");
  setValue("adminAddress", "");
  setMsg("adminMsg", "Formulario listo para crear un nuevo ADMIN municipal.", true);
}

function fillAdminForm(admin) {
  if (!admin) {
    clearAdminForm();
    return;
  }
  setValue("adminName", admin.full_name || "");
  setValue("adminPhone", admin.phone || "");
  setValue("adminEmail", admin.email || "");
  setValue("adminAddress", admin.declared_address || "");
}

function renderCurrentAdmins(center) {
  const title = $("currentAdminsTitle");
  const count = $("currentAdminsCount");
  const list = $("currentAdminsList");
  if (!list) return;

  const admins = adminsForCenter(center);
  const centerLabel = center?.code ? `${center.code} · ${center.municipality || center.name || ""}` : "centro seleccionado";

  if (title) title.textContent = `Administradores actuales · ${center?.code || "sin centro"}`;
  if (count) count.textContent = `${admins.length} admin${admins.length === 1 ? "" : "s"}`;

  if (!center) {
    list.className = "admin-list empty-admins";
    list.textContent = "Selecciona un centro para ver sus administradores.";
    return;
  }

  if (!admins.length) {
    list.className = "admin-list empty-admins";
    list.innerHTML = `No hay ADMIN municipal registrado para <strong>${escapeHtml(centerLabel)}</strong>. Puedes crearlo con el formulario superior.`;
    return;
  }

  list.className = "admin-list";
  list.innerHTML = admins.map((admin, index) => `
    <div class="admin-row">
      <div>
        <div class="admin-name">${escapeHtml(admin.full_name || "Administrador sin nombre")}</div>
        <div class="admin-meta">${escapeHtml(admin.phone || "sin teléfono")} · ${escapeHtml(admin.email || "sin email")}</div>
        <small>${escapeHtml(admin.declared_address || "sin dirección")} · ${escapeHtml(admin.validation_status || "-")} · ${admin.is_active === false ? "inactivo" : "activo"}</small>
      </div>
      <button class="secondary small-btn" type="button" data-admin-center="${escapeHtml(center.code)}" data-admin-index="${index}">Usar / editar</button>
    </div>
  `).join("");

  list.querySelectorAll("button[data-admin-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const selected = admins[Number(btn.dataset.adminIndex)];
      fillAdminForm(selected);
      setMsg("adminMsg", `ADMIN cargado para edición: ${selected?.full_name || selected?.phone || "sin nombre"}`, true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function fillFromCenter(center) {
  setValue("ccCode", center.code || "");
  setValue("ccName", center.name || "");
  setValue("ccMunicipality", center.municipality || "");
  setValue("ccRegion", center.region || "");
  setValue("ccLat", center.map_center_lat || center.latitude || "");
  setValue("ccLon", center.map_center_lon || center.longitude || "");
  setValue("ccZoom", center.map_zoom || 13);
  setValue("ccBuffer", center.geofence_buffer_meters || 100);

  const primaryAdmin = primaryAdminForCenter(center);
  if (primaryAdmin) {
    fillAdminForm(primaryAdmin);
    setMsg("adminMsg", `ADMIN actual cargado: ${primaryAdmin.full_name || primaryAdmin.phone}`, true);
  } else {
    clearAdminForm();
    setMsg("adminMsg", `No hay ADMIN registrado para ${center.code}. Puedes crearlo ahora.`, false);
  }

  renderCurrentAdmins(center);

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function renderCenters() {
  const countEl = $("centersCount");
  const listEl = $("centersList");

  if (countEl) {
    countEl.textContent = `${centers.length} centros`;
  }

  if (!listEl) return;

  listEl.innerHTML = centers.map((cc) => {
    const admins = adminsForCenter(cc);
    const primaryAdmin = primaryAdminForCenter(cc);
    const adminLabel = primaryAdmin
      ? `${primaryAdmin.full_name || "ADMIN"} · ${primaryAdmin.phone || "sin teléfono"}`
      : "Sin ADMIN municipal";

    return `
      <div class="center-row ${primaryAdmin ? "" : "center-row-warning"}">
        <div>
          <div class="center-code">${escapeHtml(cc.code)}</div>
          <div>${escapeHtml(cc.name || "-")}</div>
          <small>${escapeHtml(cc.municipality || "-")} · ${escapeHtml(cc.region || "-")}</small>
          <div class="center-admin-summary ${primaryAdmin ? "" : "missing"}">
            <strong>ADMIN:</strong> ${escapeHtml(adminLabel)}
          </div>
        </div>

        <div class="badges">
          <span class="badge ${cc.boundary_type ? "green" : "amber"}">${cc.boundary_type ? "Boundary OK" : "Sin boundary"}</span>
          <span class="badge ${admins.length ? "green" : "amber"}">${admins.length || 0} admin</span>
        </div>

        <div class="badges">
          <span class="badge">${cc.operators_count || 0} op</span>
          <span class="badge">${cc.resolvers_count || 0} resolv</span>
          <span class="badge">${cc.neighbors_count || 0} vec</span>
        </div>

        <div class="center-actions">
          <button class="secondary" data-code="${escapeHtml(cc.code)}">Ver / editar</button>
        </div>
      </div>
    `;
  }).join("") || `<p>No hay centros cargados.</p>`;

  document.querySelectorAll("button[data-code]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const center = centers.find((item) => item.code === btn.dataset.code);
      if (center) fillFromCenter(center);
    });
  });
}

async function loadCenters() {
  const data = await api("/superadmin/control-centers");
  centers = data.control_centers || [];
  renderCenters();

  const selectedCode = ccCode();
  const selectedCenter = centers.find((item) => item.code === selectedCode);
  if (selectedCenter) renderCurrentAdmins(selectedCenter);
}

async function saveCenter() {
  const payload = {
    code: ccCode(),
    name: getValue("ccName"),
    municipality: getValue("ccMunicipality"),
    region: getValue("ccRegion"),
    latitude: getValue("ccLat") === "" ? null : Number(getValue("ccLat")),
    longitude: getValue("ccLon") === "" ? null : Number(getValue("ccLon")),
    map_zoom: Number(getValue("ccZoom") || 13),
    geofence_buffer_meters: Number(getValue("ccBuffer") || 100)
  };

  if (!payload.code || !payload.name) {
    setMsg("centerMsg", "Código y nombre son obligatorios", false);
    return;
  }

  try {
    const data = await api("/superadmin/control-centers", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    setMsg("centerMsg", `Centro guardado: ${data.control_center.code}`, true);
    toast("Centro guardado");
    await loadCenters();
  } catch (error) {
    setMsg("centerMsg", error.message, false);
  }
}

async function saveAdmin() {
  const code = ccCode();

  if (!code) {
    setMsg("adminMsg", "Primero indica el código del centro", false);
    return;
  }

  const payload = {
    full_name: getValue("adminName"),
    phone: getValue("adminPhone"),
    email: getValue("adminEmail"),
    declared_address: getValue("adminAddress")
  };

  if (!payload.full_name || !payload.phone) {
    setMsg("adminMsg", "Nombre y teléfono son obligatorios", false);
    return;
  }

  try {
    const data = await api(`/superadmin/control-centers/${encodeURIComponent(code)}/admin`, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    setMsg("adminMsg", `ADMIN ${data.operation}: ${data.user.full_name} · ${data.user.phone}`, true);
    toast("Administrador municipal listo");
    await loadCenters();
    const updatedCenter = centers.find((item) => item.code === code);
    if (updatedCenter) fillFromCenter(updatedCenter);
  } catch (error) {
    setMsg("adminMsg", error.message, false);
  }
}

function readJsonFile(input) {
  const file = input?.files?.[0];

  if (!file) {
    throw new Error("Selecciona un archivo GeoJSON");
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (_) {
        reject(new Error("El archivo no es JSON válido"));
      }
    };

    reader.onerror = () => {
      reject(new Error("No fue posible leer el archivo"));
    };

    reader.readAsText(file);
  });
}

async function uploadBoundary() {
  const code = ccCode();

  if (!code) {
    setMsg("boundaryMsg", "Primero indica el código del centro", false);
    return;
  }

  try {
    const geojson = await readJsonFile($("boundaryFile"));

    const payload = {
      geojson,
      map_zoom: Number(getValue("boundaryZoom") || 13),
      geofence_buffer_meters: Number(getValue("ccBuffer") || 100)
    };

    const data = await api(`/superadmin/control-centers/${encodeURIComponent(code)}/boundary`, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    setMsg("boundaryMsg", `Boundary cargado: ${data.control_center.boundary_type}`, true);
    toast("Boundary cargado");
    await loadCenters();
  } catch (error) {
    setMsg("boundaryMsg", error.message, false);
  }
}

async function uploadSectors() {
  const code = ccCode();

  if (!code) {
    setMsg("sectorsMsg", "Primero indica el código del centro", false);
    return;
  }

  try {
    const geojson = await readJsonFile($("sectorsFile"));

    const data = await api(`/admin/control-centers/${encodeURIComponent(code)}/sectors/bulk`, {
      method: "POST",
      body: JSON.stringify(geojson)
    });

    let msg = `Sectores cargados: ${data.inserted}, omitidos: ${data.skipped}`;

    if (getValue("reclassifyAfter") === "true") {
      const rec = await api(`/admin/control-centers/${encodeURIComponent(code)}/sectors/reclassify-tickets`, {
        method: "POST",
        body: JSON.stringify({
          limit: 5000
        })
      });

      msg += ` · tickets reclasificados: ${rec.updated}`;
    }

    setMsg("sectorsMsg", msg, true);
    toast("Unidades Vecinales cargadas");
  } catch (error) {
    setMsg("sectorsMsg", error.message, false);
  }
}


function normalizeEmergencyCategory(raw = {}, index = 0) {
  const type = String(raw.type || raw.category_type || raw.code || "").trim().toUpperCase();
  return {
    type: type || `NEW_CATEGORY_${Date.now() % 100000}_${index}`,
    title: String(raw.title || raw.label || "Nueva categoría").trim(),
    icon: String(raw.icon || "🆘").trim(),
    color: String(raw.color || "#2563eb").trim(),
    priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 3,
    enabled: raw.enabled !== false,
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : ((index + 1) * 10),
    sensitive: raw.sensitive === true,
    allow_voice: raw.allow_voice !== false,
    allow_evidence: raw.allow_evidence !== false,
    allow_nearby_notifications: raw.allow_nearby_notifications === true,
    allow_sirens: raw.allow_sirens === true
  };
}

function renderEmergencyCategories() {
  const list = $("emergencyCategoriesList");
  if (!list) return;

  if (!emergencyCategories.length) {
    list.innerHTML = `<p class="empty-admins">No hay categorías cargadas todavía.</p>`;
    return;
  }

  list.innerHTML = emergencyCategories.map((category, index) => `
    <div class="category-catalog-row" data-category-row="${index}">
      <div class="category-main-fields">
        <label>Código técnico
          <input data-category-field="type" value="${escapeHtml(category.type)}" placeholder="MEDICAL" />
        </label>
        <label>Nombre
          <input data-category-field="title" value="${escapeHtml(category.title)}" placeholder="Médica" />
        </label>
        <label>Icono
          <input data-category-field="icon" value="${escapeHtml(category.icon)}" placeholder="🚑" />
        </label>
        <label>Color
          <input data-category-field="color" type="color" value="${escapeHtml(category.color || "#2563eb")}" />
        </label>
        <label>Prioridad
          <input data-category-field="priority" type="number" min="1" max="9" value="${Number(category.priority || 3)}" />
        </label>
        <label>Orden
          <input data-category-field="order" type="number" min="1" max="999" value="${Number(category.order || ((index + 1) * 10))}" />
        </label>
      </div>
      <div class="category-flags">
        <label><input data-category-field="enabled" type="checkbox" ${category.enabled !== false ? "checked" : ""}> Disponible</label>
        <label><input data-category-field="sensitive" type="checkbox" ${category.sensitive ? "checked" : ""}> Sensible</label>
        <label><input data-category-field="allow_voice" type="checkbox" ${category.allow_voice !== false ? "checked" : ""}> Voz</label>
        <label><input data-category-field="allow_evidence" type="checkbox" ${category.allow_evidence !== false ? "checked" : ""}> Evidencia</label>
        <label><input data-category-field="allow_nearby_notifications" type="checkbox" ${category.allow_nearby_notifications ? "checked" : ""}> Avisar vecinos</label>
        <label><input data-category-field="allow_sirens" type="checkbox" ${category.allow_sirens ? "checked" : ""}> Sirenas</label>
      </div>
      <button class="secondary small-btn" type="button" data-remove-category="${index}">Ocultar del catálogo</button>
    </div>
  `).join("");

  list.querySelectorAll("[data-remove-category]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.removeCategory);
      if (emergencyCategories[index]) emergencyCategories[index].enabled = false;
      renderEmergencyCategories();
      setMsg("categoryMsg", "La categoría quedó marcada como no disponible. Guarda para aplicar.", true);
    });
  });
}

function collectEmergencyCategories() {
  const list = $("emergencyCategoriesList");
  if (!list) return emergencyCategories;

  return Array.from(list.querySelectorAll("[data-category-row]")).map((row, index) => {
    const get = (field) => row.querySelector(`[data-category-field="${field}"]`);
    return normalizeEmergencyCategory({
      type: get("type")?.value,
      title: get("title")?.value,
      icon: get("icon")?.value,
      color: get("color")?.value,
      priority: Number(get("priority")?.value),
      order: Number(get("order")?.value),
      enabled: Boolean(get("enabled")?.checked),
      sensitive: Boolean(get("sensitive")?.checked),
      allow_voice: Boolean(get("allow_voice")?.checked),
      allow_evidence: Boolean(get("allow_evidence")?.checked),
      allow_nearby_notifications: Boolean(get("allow_nearby_notifications")?.checked),
      allow_sirens: Boolean(get("allow_sirens")?.checked)
    }, index);
  }).sort((a, b) => Number(a.order || 999) - Number(b.order || 999));
}

async function loadEmergencyCategories() {
  try {
    setMsg("categoryMsg", "Cargando catálogo...", true);
    const data = await api("/superadmin/emergency-categories");
    emergencyCategories = (data.categories || []).map(normalizeEmergencyCategory);
    renderEmergencyCategories();
    setMsg("categoryMsg", `Catálogo cargado: ${emergencyCategories.length} categorías`, true);
  } catch (error) {
    setMsg("categoryMsg", error.message, false);
  }
}

async function saveEmergencyCategories() {
  try {
    const categories = collectEmergencyCategories();
    if (!categories.some((category) => category.enabled !== false)) {
      throw new Error("Debe quedar al menos una categoría disponible.");
    }
    const data = await api("/superadmin/emergency-categories", {
      method: "PUT",
      body: JSON.stringify({ categories })
    });
    emergencyCategories = (data.categories || categories).map(normalizeEmergencyCategory);
    renderEmergencyCategories();
    setMsg("categoryMsg", "Catálogo maestro guardado.", true);
    toast("Catálogo maestro actualizado");
  } catch (error) {
    setMsg("categoryMsg", error.message, false);
  }
}

function addEmergencyCategory() {
  emergencyCategories = collectEmergencyCategories();
  emergencyCategories.push(normalizeEmergencyCategory({
    type: `CUSTOM_${Date.now() % 100000}`,
    title: "Nueva categoría",
    icon: "🆘",
    color: "#2563eb",
    priority: 3,
    enabled: true,
    order: (emergencyCategories.length + 1) * 10
  }, emergencyCategories.length));
  renderEmergencyCategories();
}


window.addEventListener("error", (event) => {
  logDebug("window error", event.message);
  setMsg("loginMsg", event.message || "Error JavaScript inesperado", false);
});

window.addEventListener("unhandledrejection", (event) => {
  const message = event.reason?.message || String(event.reason || "Error de promesa no controlado");
  logDebug("unhandled rejection", message);
  setMsg("loginMsg", message, false);
});

window.addEventListener("DOMContentLoaded", () => {
  logDebug("DOMContentLoaded", {
    API,
    APP_VERSION
  });

  on("loginBtn", "click", login);
  on("loginPhone", "keydown", (ev) => {
    if (ev.key === "Enter") login();
  });
  on("logoutBtn", "click", logout);
  on("reloadCentersBtn", "click", () => {
    loadCenters().catch((error) => toast(error.message));
  });
  on("saveCenterBtn", "click", saveCenter);
  on("saveAdminBtn", "click", saveAdmin);
  on("clearAdminFormBtn", "click", clearAdminForm);
  on("uploadBoundaryBtn", "click", uploadBoundary);
  on("uploadSectorsBtn", "click", uploadSectors);
  on("reloadCategoriesBtn", "click", loadEmergencyCategories);
  on("addCategoryBtn", "click", addEmergencyCategory);
  on("saveCategoriesBtn", "click", saveEmergencyCategories);

  checkSession();
});
