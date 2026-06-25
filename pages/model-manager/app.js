// Model Manager v1.1 — follows official Plugin Pages docs exactly
// NO localStorage (sandboxed iframe forbids it)
// Theme managed by bridge SDK automatically

const bridge = window.AstrBotPluginPage;

// Wait for bridge ready (official pattern)
const context = await bridge.ready();

// i18n
const i18n = {
  zh: {
    title: "模型管理器",
    refresh: "刷新",
    quickSwitch: "快速替换",
    setAll: "全部设置",
    save: "保存",
    scanning: "正在扫描插件配置...",
    retry: "重试",
    noPlugins: "未找到包含模型配置的插件",
    quickSwitchTitle: "快速替换模型",
    currentModel: "当前模型（要替换的）",
    selectCurrent: "-- 选择当前模型 --",
    newModel: "新模型",
    selectNew: "-- 选择新模型 --",
    cancel: "取消",
    switchAll: "替换全部",
    setAllTitle: "设置所有模型",
    targetModel: "目标模型",
    selectModel: "-- 选择模型 --",
    setAllConfirm: "全部设置",
    items: " 个字段",
    item: " 个字段",
    configured: "（已配置）",
    clearOrNotSet: "-- 清除 --",
    notSet: "-- 未设置 --",
    saved: "已保存 ",
    changes: " 个更改",
    failed: "，失败 ",
    switchPreview: '将把所有使用 "',
    switchPreview2: '" 的字段替换为 "',
    switchPreview3: '"，共 ',
    switchPreview4: " 个字段",
    setAllPreview: "将设置所有 ",
    setAllPreview2: " 个字段为 ",

    switchSuccess: "已将 ",
    switchSuccess2: " 个字段从 ",

    switchSuccess3: " 替换为 ",

    setAllSuccess: "已将所有 ",
    setAllSuccess2: " 个字段设置为 ",

    noFields: "没有需要更新的字段",
    saveFailed: "保存失败：",
    switchFailed: "替换失败：",
    setAllFailed: "设置失败：",
    sortSaved: "排序已保存",
    sortFailed: "保存排序失败：",
    plugins: " 个插件",
    fields: " 个字段",
    models: " 个模型",
    changesLabel: " 个更改",
    moveUp: "上移",
    moveDown: "下移",
  },
  en: {
    title: "Model Manager",
    refresh: "Refresh",
    quickSwitch: "Quick Switch",
    setAll: "Set All",
    save: "Save",
    scanning: "Scanning plugin configs...",
    retry: "Retry",
    noPlugins: "No plugins with model configuration found",
    quickSwitchTitle: "Quick Switch Model",
    currentModel: "Current Model (to replace)",
    selectCurrent: "-- Select current model --",
    newModel: "New Model",
    selectNew: "-- Select new model --",
    cancel: "Cancel",
    switchAll: "Switch All",
    setAllTitle: "Set All Models",
    targetModel: "Target Model",
    selectModel: "-- Select model --",
    setAllConfirm: "Set All",
    items: " items",
    item: " item",
    configured: " (configured)",
    clearOrNotSet: "-- clear --",
    notSet: "-- not set --",
    saved: "Saved ",
    changes: " changes",
    failed: ", failed ",
    switchPreview: 'Will replace "',
    switchPreview2: '" with "',
    switchPreview3: '" in ',
    switchPreview4: " field(s)",
    setAllPreview: "Will set ALL ",
    setAllPreview2: " field(s) to ",

    switchSuccess: "Switched ",
    switchSuccess2: " field(s) from ",

    switchSuccess3: " to ",

    setAllSuccess: "Set all ",
    setAllSuccess2: " field(s) to ",

    noFields: "No fields to update",
    saveFailed: "Save failed: ",
    switchFailed: "Switch failed: ",
    setAllFailed: "Set all failed: ",
    sortSaved: "Sort order saved",
    sortFailed: "Failed to save sort order: ",
    plugins: " plugins",
    fields: " fields",
    models: " models",
    changesLabel: " changes",
    moveUp: "Move up",
    moveDown: "Move down",
  },
};

let currentLang = "zh";

function t(key) {
  return i18n[currentLang][key] || key;
}

function applyLanguage() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  });

  // Update select options with data-i18n
  document.querySelectorAll("option[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  });
}

async function loadLanguage() {
  try {
    const data = await bridge.apiGet("language");
    currentLang = data.lang || "zh";
  } catch (e) {
    currentLang = "zh";
  }
}

async function saveLanguage(lang) {
  try {
    await bridge.apiPost("language", { lang });
  } catch (e) {
    // ignore
  }
}

function toggleLanguage() {
  currentLang = currentLang === "zh" ? "en" : "zh";
  saveLanguage(currentLang);
  applyLanguage();
  render();
  updateStats();
}

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
    await loadLanguage();
    applyLanguage();

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
    upBtn.title = t("moveUp");
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", () => movePlugin(pluginName, -1));

    const downBtn = document.createElement("button");
    downBtn.className = "sort-btn";
    downBtn.innerHTML = "&#9660;";
    downBtn.title = t("moveDown");
    downBtn.disabled = index === sortedKeys.length - 1;
    downBtn.addEventListener("click", () => movePlugin(pluginName, 1));

    sortBtns.append(upBtn, downBtn);

    const title = document.createElement("div");
    title.className = "plugin-card-title";
    title.textContent = getDisplayName(settings[0]);

    const badge = document.createElement("div");
    badge.className = "plugin-card-badge";
    badge.textContent = settings.length + (settings.length === 1 ? t("item") : t("items"));

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
    showToast(t("sortSaved"), "success");
  } catch (err) {
    showToast(t("sortFailed") + err.message, "error");
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
  emptyOpt.textContent = cur ? t("clearOrNotSet") : t("notSet");
  sel.appendChild(emptyOpt);

  if (cur && !providers.some((p) => p.id === cur)) {
    const opt = document.createElement("option");
    opt.value = cur;
    opt.textContent = cur + t("configured");
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
  $("#statPlugins").textContent = pn.size + t("plugins");
  $("#statFields").textContent = allSettings.length + t("fields");
  $("#statProviders").textContent = providers.length + t("models");
  $("#statChanges").textContent = changes.size + t("changesLabel");
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
      fails.length === 0 ? t("saved") + ok + t("changes") : t("saved") + ok + t("failed") + fails.length,
      fails.length === 0 ? "success" : "error"
    );
    await loadAll();
  } catch (err) {
    showToast(t("saveFailed") + err.message, "error");
    $("#saveBtn").disabled = false;
  }
}

// Events
$("#refreshBtn").addEventListener("click", loadAll);
$("#retryBtn").addEventListener("click", loadAll);
$("#saveBtn").addEventListener("click", saveAll);
$("#langBtn").addEventListener("click", toggleLanguage);

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

  currentModelSelect.innerHTML = `<option value="">${t("selectCurrent")}</option>`;
  for (const m of uniqueModels) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    currentModelSelect.appendChild(opt);
  }

  // Populate new model select with available providers
  newModelSelect.innerHTML = `<option value="">${t("selectNew")}</option>`;
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
    t("switchPreview") + current + t("switchPreview2") + newModel + t("switchPreview3") + affected.length + t("switchPreview4");
  dialogConfirmBtn.disabled = false;
}

async function confirmQuickSwitch() {
  const current = currentModelSelect.value;
  const newModel = newModelSelect.value;

  if (!current || !newModel) return;

  const affected = allSettings.filter((s) => s.current_value === current);
  if (affected.length === 0) {
    showToast(t("noFields"), "error");
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
        ? t("switchSuccess") + ok + t("switchSuccess2") + current + t("switchSuccess3") + newModel
        : t("switchSuccess") + ok + t("failed") + fails.length,
      fails.length === 0 ? "success" : "error"
    );
    closeQuickSwitch();
    await loadAll();
  } catch (err) {
    showToast(t("switchFailed") + err.message, "error");
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
  setAllModelSelect.innerHTML = `<option value="">${t("selectModel")}</option>`;
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
    t("setAllPreview") + allSettings.length + t("setAllPreview2") + model;
  setAllConfirmBtn.disabled = false;
}

async function confirmSetAll() {
  const model = setAllModelSelect.value;

  if (!model) return;

  if (allSettings.length === 0) {
    showToast(t("noFields"), "error");
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
        ? t("setAllSuccess") + ok + t("setAllSuccess2") + model
        : t("setAllSuccess") + ok + t("failed") + fails.length,
      fails.length === 0 ? "success" : "error"
    );
    closeSetAll();
    await loadAll();
  } catch (err) {
    showToast(t("setAllFailed") + err.message, "error");
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
