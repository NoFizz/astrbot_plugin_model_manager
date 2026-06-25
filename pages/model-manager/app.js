// Model Manager v1.1 — follows official Plugin Pages docs exactly
// NO localStorage (sandboxed iframe forbids it)
// Theme managed by bridge SDK automatically

const bridge = window.AstrBotPluginPage;

// Wait for bridge ready (official pattern)
const context = await bridge.ready();

// State
let allSettings = [];
let providers = [];
let sortOrder = [];
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

    try {
      const sortData = await bridge.apiGet("sort-order");
      sortOrder = sortData.order || [];
    } catch (e) {
      sortOrder = [];
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

  // Apply sort order
  const sortedKeys = [];
  const remaining = new Set(groups.keys());

  // Add plugins from sort order first
  for (const key of sortOrder) {
    if (remaining.has(key)) {
      sortedKeys.push(key);
      remaining.delete(key);
    }
  }

  // Add remaining plugins in original order
  for (const key of groups.keys()) {
    if (remaining.has(key)) {
      sortedKeys.push(key);
      remaining.delete(key);
    }
  }

  const container = $("#pluginGroups");
  container.innerHTML = "";

  sortedKeys.forEach((pluginName, index) => {
    const settings = groups.get(pluginName);
    const card = document.createElement("div");
    card.className = "plugin-card";
    card.dataset.plugin = pluginName;

    const header = document.createElement("div");
    header.className = "plugin-card-header";

    const sortBtns = document.createElement("div");
    sortBtns.className = "plugin-card-sort";

    const upBtn = document.createElement("button");
    upBtn.className = "sort-btn";
    upBtn.innerHTML = "&#9650;";
    upBtn.title = "Move up";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", () => movePlugin(pluginName, -1));

    const downBtn = document.createElement("button");
    downBtn.className = "sort-btn";
    downBtn.innerHTML = "&#9660;";
    downBtn.title = "Move down";
    downBtn.disabled = index === sortedKeys.length - 1;
    downBtn.addEventListener("click", () => movePlugin(pluginName, 1));

    sortBtns.append(upBtn, downBtn);

    const title = document.createElement("div");
    title.className = "plugin-card-title";
    title.textContent = getDisplayName(settings[0]);

    const badge = document.createElement("div");
    badge.className = "plugin-card-badge";
    badge.textContent = settings.length + (settings.length === 1 ? " item" : " items");

    header.append(sortBtns, title, badge);

    const body = document.createElement("div");
    body.className = "plugin-card-body";
    for (const s of settings) body.appendChild(buildRow(s));

    card.append(header, body);
    container.appendChild(card);
  });
}

async function movePlugin(pluginName, direction) {
  const groups = new Map();
  for (const s of allSettings) {
    if (!groups.has(s.plugin_name)) groups.set(s.plugin_name, []);
    groups.get(s.plugin_name).push(s);
  }

  const currentOrder = [];
  const remaining = new Set(groups.keys());

  for (const key of sortOrder) {
    if (remaining.has(key)) {
      currentOrder.push(key);
      remaining.delete(key);
    }
  }

  for (const key of groups.keys()) {
    if (remaining.has(key)) {
      currentOrder.push(key);
      remaining.delete(key);
    }
  }

  const currentIndex = currentOrder.indexOf(pluginName);
  const newIndex = currentIndex + direction;

  if (newIndex < 0 || newIndex >= currentOrder.length) return;

  // Swap
  [currentOrder[currentIndex], currentOrder[newIndex]] = [currentOrder[newIndex], currentOrder[currentIndex]];

  sortOrder = currentOrder;
  render();

  // Save sort order
  try {
    await bridge.apiPost("save-sort-order", { order: sortOrder });
    showToast("Sort order saved", "success");
  } catch (err) {
    showToast("Failed to save sort order: " + err.message, "error");
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

// Set All Dialog
const setAllDialog = $("#setAllDialog");
const setAllModelSelect = $("#setAllModelSelect");
const setAllPreview = $("#setAllPreview");
const setAllConfirmBtn = $("#setAllConfirmBtn");

function openSetAll() {
  // Populate model select with available providers
  setAllModelSelect.innerHTML = '<option value="">-- Select model --</option>';
  for (const p of providers) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.id + (p.model ? " [" + p.model + "]" : "");
    setAllModelSelect.appendChild(opt);
  }

  setAllPreview.style.display = "none";
  setAllConfirmBtn.disabled = true;
  setAllDialog.style.display = "flex";
}

function closeSetAll() {
  setAllDialog.style.display = "none";
}

function updateSetAllPreview() {
  const model = setAllModelSelect.value;

  if (!model) {
    setAllPreview.style.display = "none";
    setAllConfirmBtn.disabled = true;
    return;
  }

  setAllPreview.style.display = "block";
  setAllPreview.querySelector(".dialog-preview-text").textContent =
    `Will set ALL ${allSettings.length} field(s) to "${model}"`;
  setAllConfirmBtn.disabled = false;
}

async function confirmSetAll() {
  const model = setAllModelSelect.value;

  if (!model) return;

  if (allSettings.length === 0) {
    showToast("No fields to update", "error");
    return;
  }

  const updates = allSettings.map((s) => ({
    plugin_name: s.plugin_name,
    field_path: s.field_path,
    value: model,
  }));

  setAllConfirmBtn.disabled = true;
  try {
    const res = await bridge.apiPost("batch", { updates });
    const ok = res.success || 0;
    const fails = res.failures || [];
    showToast(
      fails.length === 0
        ? `Set all ${ok} field(s) to "${model}"`
        : `Set ${ok}, failed ${fails.length}`,
      fails.length === 0 ? "success" : "error"
    );
    closeSetAll();
    await loadAll();
  } catch (err) {
    showToast("Set all failed: " + err.message, "error");
    setAllConfirmBtn.disabled = false;
  }
}

$("#setAllBtn").addEventListener("click", openSetAll);
$("#setAllCloseBtn").addEventListener("click", closeSetAll);
$("#setAllCancelBtn").addEventListener("click", closeSetAll);
setAllModelSelect.addEventListener("change", updateSetAllPreview);
setAllConfirmBtn.addEventListener("click", confirmSetAll);

// Start
await loadAll();
