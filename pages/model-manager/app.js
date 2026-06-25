// Model Manager v1.1 — follows official Plugin Pages docs exactly
// NO localStorage (sandboxed iframe forbids it)
// Theme managed by bridge SDK automatically

const bridge = window.AstrBotPluginPage;

// Wait for bridge ready (official pattern)
const context = await bridge.ready();

// State
let allSettings = [];
let providers = [];
const changes = new Map();

// DOM helpers
const $ = (s) => document.querySelector(s);

// Show/hide views
function showState(s) {
  $("#loadingView").style.display = s === "loading" ? "flex" : "none";
  $("#errorView").style.display = s === "error" ? "flex" : "none";
  $("#emptyView").style.display = s === "empty" ? "flex" : "none";
  $("#contentView").style.display = s === "content" ? "block" : "none";
  $("#statsBar").style.display = s === "content" ? "flex" : "none";
}

// Toast
let toastTimer = null;
function showToast(msg, type) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (type ? " toast-" + type : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = "toast"; }, 3000);
}

// Load data
async function loadAll() {
  showState("loading");
  try {
    // bridge.apiGet resolves to the "data" field automatically
    const settingsData = await bridge.apiGet("settings");
    allSettings = settingsData.settings || [];

    try {
      const provData = await bridge.apiGet("providers");
      providers = provData.providers || [];
    } catch (e) {
      providers = [];
    }

    changes.clear();
    updateSaveBtn();

    if (allSettings.length === 0) {
      showState("empty");
      return;
    }
    render();
    updateStats();
    showState("content");
  } catch (err) {
    $("#errorMsg").textContent = err.message || "Failed to load";
    showState("error");
  }
}

// Render
function getDisplayName(s) {
  if (s.display_name && s.display_name !== s.plugin_name) {
    return s.plugin_name + " / " + s.display_name;
  }
  return s.plugin_name;
}

function render() {
  const groups = new Map();
  for (const s of allSettings) {
    if (!groups.has(s.plugin_name)) groups.set(s.plugin_name, []);
    groups.get(s.plugin_name).push(s);
  }

  const container = $("#pluginGroups");
  container.innerHTML = "";

  for (const [, settings] of groups) {
    const card = document.createElement("div");
    card.className = "plugin-card";

    const header = document.createElement("div");
    header.className = "plugin-card-header";

    const title = document.createElement("div");
    title.className = "plugin-card-title";
    title.textContent = getDisplayName(settings[0]);

    const badge = document.createElement("div");
    badge.className = "plugin-card-badge";
    badge.textContent = settings.length + (settings.length === 1 ? " item" : " items");

    header.append(title, badge);

    const body = document.createElement("div");
    body.className = "plugin-card-body";
    for (const s of settings) body.appendChild(buildRow(s));

    card.append(header, body);
    container.appendChild(card);
  }
}

function buildRow(s) {
  const row = document.createElement("div");
  row.className = "field-row";

  const info = document.createElement("div");
  info.className = "field-info";

  const label = document.createElement("div");
  label.className = "field-label";
  label.textContent = s.description || s.field_path.split(".").pop();

  const pathEl = document.createElement("div");
  pathEl.className = "field-path";
  pathEl.textContent = s.field_path;

  info.append(label, pathEl);

  if (s.hint) {
    const hint = document.createElement("div");
    hint.className = "field-hint";
    hint.textContent = s.hint;
    info.appendChild(hint);
  }

  const wrap = document.createElement("div");
  wrap.className = "field-select-wrap";
  const sel = document.createElement("select");
  sel.className = "field-select";

  const key = s.plugin_name + "|" + s.field_path;
  const cur = s.current_value || "";

  const emptyOpt = document.createElement("option");
  emptyOpt.value = "";
  emptyOpt.textContent = cur ? "-- clear --" : "-- not set --";
  sel.appendChild(emptyOpt);

  if (cur && !providers.some((p) => p.id === cur)) {
    const opt = document.createElement("option");
    opt.value = cur;
    opt.textContent = cur + " (configured)";
    opt.selected = true;
    sel.appendChild(opt);
  }

  for (const p of providers) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.id + (p.model ? " [" + p.model + "]" : "");
    if (p.id === cur) opt.selected = true;
    sel.appendChild(opt);
  }

  sel.addEventListener("change", () => {
    const v = sel.value;
    if (v !== cur) {
      changes.set(key, { plugin_name: s.plugin_name, field_path: s.field_path, value: v });
      sel.classList.add("changed");
    } else {
      changes.delete(key);
      sel.classList.remove("changed");
    }
    updateSaveBtn();
    updateStats();
  });

  wrap.appendChild(sel);
  row.append(info, wrap);
  return row;
}

// Stats & Save
function updateStats() {
  const pn = new Set(allSettings.map((s) => s.plugin_name));
  $("#statPlugins").textContent = pn.size + " plugins";
  $("#statFields").textContent = allSettings.length + " fields";
  $("#statProviders").textContent = providers.length + " models";
  $("#statChanges").textContent = changes.size + " changes";
}

function updateSaveBtn() {
  $("#saveBtn").disabled = changes.size === 0;
}

async function saveAll() {
  if (changes.size === 0) return;
  $("#saveBtn").disabled = true;
  try {
    const res = await bridge.apiPost("batch", { updates: Array.from(changes.values()) });
    const ok = res.success || 0;
    const fails = res.failures || [];
    showToast(
      fails.length === 0 ? "Saved " + ok + " changes" : "Saved " + ok + ", failed " + fails.length,
      fails.length === 0 ? "success" : "error"
    );
    await loadAll();
  } catch (err) {
    showToast("Save failed: " + err.message, "error");
    $("#saveBtn").disabled = false;
  }
}

// Events
$("#refreshBtn").addEventListener("click", loadAll);
$("#retryBtn").addEventListener("click", loadAll);
$("#saveBtn").addEventListener("click", saveAll);

// Quick Switch Dialog
const quickSwitchDialog = $("#quickSwitchDialog");
const currentModelSelect = $("#currentModelSelect");
const newModelSelect = $("#newModelSelect");
const switchPreview = $("#switchPreview");
const dialogConfirmBtn = $("#dialogConfirmBtn");

function openQuickSwitch() {
  // Populate current model select with unique values from settings
  const uniqueModels = new Set();
  for (const s of allSettings) {
    if (s.current_value) uniqueModels.add(s.current_value);
  }

  currentModelSelect.innerHTML = '<option value="">-- Select current model --</option>';
  for (const m of uniqueModels) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    currentModelSelect.appendChild(opt);
  }

  // Populate new model select with available providers
  newModelSelect.innerHTML = '<option value="">-- Select new model --</option>';
  for (const p of providers) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.id + (p.model ? " [" + p.model + "]" : "");
    newModelSelect.appendChild(opt);
  }

  switchPreview.style.display = "none";
  dialogConfirmBtn.disabled = true;
  quickSwitchDialog.style.display = "flex";
}

function closeQuickSwitch() {
  quickSwitchDialog.style.display = "none";
}

function updateSwitchPreview() {
  const current = currentModelSelect.value;
  const newModel = newModelSelect.value;

  if (!current || !newModel) {
    switchPreview.style.display = "none";
    dialogConfirmBtn.disabled = true;
    return;
  }

  const affected = allSettings.filter((s) => s.current_value === current);
  switchPreview.style.display = "block";
  switchPreview.querySelector(".dialog-preview-text").textContent =
    `Will replace "${current}" with "${newModel}" in ${affected.length} field(s)`;
  dialogConfirmBtn.disabled = false;
}

async function confirmQuickSwitch() {
  const current = currentModelSelect.value;
  const newModel = newModelSelect.value;

  if (!current || !newModel) return;

  const affected = allSettings.filter((s) => s.current_value === current);
  if (affected.length === 0) {
    showToast("No fields to update", "error");
    return;
  }

  const updates = affected.map((s) => ({
    plugin_name: s.plugin_name,
    field_path: s.field_path,
    value: newModel,
  }));

  dialogConfirmBtn.disabled = true;
  try {
    const res = await bridge.apiPost("batch", { updates });
    const ok = res.success || 0;
    const fails = res.failures || [];
    showToast(
      fails.length === 0
        ? `Switched ${ok} field(s) from "${current}" to "${newModel}"`
        : `Switched ${ok}, failed ${fails.length}`,
      fails.length === 0 ? "success" : "error"
    );
    closeQuickSwitch();
    await loadAll();
  } catch (err) {
    showToast("Switch failed: " + err.message, "error");
    dialogConfirmBtn.disabled = false;
  }
}

$("#quickSwitchBtn").addEventListener("click", openQuickSwitch);
$("#dialogCloseBtn").addEventListener("click", closeQuickSwitch);
$("#dialogCancelBtn").addEventListener("click", closeQuickSwitch);
currentModelSelect.addEventListener("change", updateSwitchPreview);
newModelSelect.addEventListener("change", updateSwitchPreview);
dialogConfirmBtn.addEventListener("click", confirmQuickSwitch);

// Start
await loadAll();
