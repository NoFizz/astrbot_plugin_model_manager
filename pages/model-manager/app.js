// Model Manager v1.4.0 — follows official Plugin Pages docs exactly
// NO localStorage (sandboxed iframe forbids it)
// Theme managed by bridge SDK automatically
// i18n via official bridge.t() + onContext() API

const bridge = window.AstrBotPluginPage;

// Wait for bridge ready (official pattern)
const context = await bridge.ready();

// 当前语言标识（桥接 SDK 的 locale，如 zh-CN / en-US；缺省 zh-CN）
let currentLocale = (context && context.locale) || "zh-CN";

/** 将 AstrBot locale（如 zh-CN / en / zh_hans）映射为 BCP47；未知或缺失时回退 zh-CN */
function toBCP47(locale) {
  const raw = String(locale || "").trim().toLowerCase();
  if (!raw) return "zh-CN";
  if (raw === "zh-hans") return "zh-CN";
  if (raw === "zh-hant") return "zh-TW";
  const parts = raw.split(/[-_]/);
  if (parts.length >= 2 && parts[1].length === 2) {
    return parts[0] + "-" + parts[1].toUpperCase();
  }
  const known = { zh: "zh-CN", en: "en-US", ja: "ja-JP", ko: "ko-KR" };
  return known[parts[0]] || parts[0];
}

// i18n — English fallbacks; translations loaded from .astrbot-plugin/i18n/*.json
const enFallback = {
  title: "Model Manager",
  refresh: "Refresh",
  quickSwitch: "Single Replace",
  setAll: "Set All",
  save: "Save",
  scanning: "Scanning plugin configs...",
  retry: "Retry",
  noPlugins: "No plugins with model configuration found",
  quickSwitchTitle: "Single Replace Model",
  currentModel: "Current model (to replace)",
  selectCurrent: "-- Select current model --",
  newModel: "New model",
  selectNew: "-- Select new model --",
  cancel: "Cancel",
  switchAll: "Replace All",
  setAllTitle: "Set All Models",
  targetModel: "Target model",
  selectModel: "-- Select model --",
  setAllConfirm: "Set All",
  configured: " (configured)",
  clearOrNotSet: "-- Clear --",
  notSet: "-- Not set --",
  saved: "Saved ",
  changes: " changes",
  failed: ", failed ",
  switchPreview: 'Will replace all fields using "',
  switchPreview2: '" with "',
  switchPreview3: '", total ',
  switchPreview4: " fields",
  setAllPreview: "Will set all ",
  setAllPreview2: " fields to ",
  switchSuccess: "Replaced ",
  switchSuccess2: " fields from ",
  switchSuccess3: " to ",
  setAllSuccess: "Set all ",
  setAllSuccess2: " fields to ",
  noFields: "No fields to update",
  saveFailed: "Save failed: ",
  switchFailed: "Switch failed: ",
  setAllFailed: "Set failed: ",
  sortSaved: "Sort order saved",
  sortFailed: "Save sort order failed: ",
  moveUp: "Move up",
  moveDown: "Move down",
  noPluginsHint: "Make sure other plugins use select_provider fields in their _conf_schema.json",
  unsetValue: "(unset)",
  clearedValue: "(cleared)",
  sidebarTitle: "Model Config Plugins",
  sidebarToggle: "Sidebar",
  sidebarClose: "Close",
  hidePlugin: "Hide plugin",
  showPlugin: "Show plugin",
  dragHint: "Drag to reorder",
  danglingProvider: "Saved provider no longer exists — please reselect",
};

/** 使用官方 bridge.t() 获取翻译，缺失时回退到英文 */
function t(key) {
  return bridge.t("pages.model-manager." + key, enFallback[key] || key);
}

function applyLanguage() {
  // C1: 动态同步 <html lang>（BCP47），index.html 中的静态属性仅作回退
  document.documentElement.lang = toBCP47(currentLocale);
  document.title = t("title");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  });

  // Update select options with data-i18n
  document.querySelectorAll("option[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  });

  // 图标按钮 title（无文本节点，data-i18n 机制覆盖不到）
  const toggleBtn = document.querySelector("#sidebarToggleBtn");
  if (toggleBtn) toggleBtn.title = t("sidebarToggle");
  const closeBtn = document.querySelector("#sidebarCloseBtn");
  if (closeBtn) closeBtn.title = t("sidebarClose");
  const refreshBtn = document.querySelector("#refreshBtn");
  if (refreshBtn) {
    refreshBtn.title = t("refresh");
    refreshBtn.setAttribute("aria-label", t("refresh"));
  }
}

// State
let allSettings = [];
let providers = [];
let sortOrder = [];
const changes = new Map();
// 侧栏隐藏的插件集合（仅会话内有效：沙箱 iframe 禁用 localStorage，且后端无对应持久化端点）
const hiddenPlugins = new Set();
let sidebarOpen = false;

// DOM helpers
const $ = (s) => document.querySelector(s);

/** 按插件名分组 allSettings */
function groupByPlugin() {
  const groups = new Map();
  for (const s of allSettings) {
    if (!groups.has(s.plugin_name)) groups.set(s.plugin_name, []);
    groups.get(s.plugin_name).push(s);
  }
  return groups;
}

/** 根据 sortOrder 对插件名列表排序 */
function getSortedPluginKeys(groups) {
  const sortedKeys = [];
  const remaining = new Set(groups.keys());
  for (const key of sortOrder) {
    if (remaining.has(key)) {
      sortedKeys.push(key);
      remaining.delete(key);
    }
  }
  for (const key of groups.keys()) {
    if (remaining.has(key)) {
      sortedKeys.push(key);
      remaining.delete(key);
    }
  }
  return sortedKeys;
}

/** 填充 provider 下拉列表（占位项与选项一律用 DOM API 构建，避免 t() 输出/插件数据进入 innerHTML） */
function populateProviderSelect(selectEl, placeholderKey) {
  selectEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = t(placeholderKey);
  selectEl.appendChild(placeholder);
  for (const p of providers) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.id + (p.model ? " [" + p.model + "]" : "");
    selectEl.appendChild(opt);
  }
}

// Show/hide views
function showState(s) {
  $("#loadingView").style.display = s === "loading" ? "flex" : "none";
  $("#errorView").style.display = s === "error" ? "flex" : "none";
  $("#emptyView").style.display = s === "empty" ? "flex" : "none";
  $("#contentView").style.display = s === "content" ? "block" : "none";
}

// Toast
let toastTimer = null;
function showToast(msg, type) {
  const toastEl = $("#toast");
  toastEl.innerHTML = "";
  if (type) {
    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.textContent = type === "success" ? "\u2713" : "\u2715";
    toastEl.appendChild(icon);
  }
  toastEl.appendChild(document.createTextNode(msg));
  // 显式切换类型 class，避免拼接动态类名
  toastEl.className = "toast show";
  toastEl.classList.remove("toast-success", "toast-error");
  if (type) toastEl.classList.add(type === "success" ? "toast-success" : "toast-error");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = "toast"; }, 3000);
}

/** 切换按钮 loading 状态（loading=false 时恢复可用） */
function setBtnLoading(btn, loading) {
  btn.classList.toggle("loading", loading);
  btn.disabled = loading;
}

// Load data
/** 加载数据；force=true 时绕过后端 30s 扫描缓存（F1 手动刷新路径），否则走缓存路径 */
async function loadAll(force) {
  showState("loading");
  const refreshBtn = $("#refreshBtn");
  setBtnLoading(refreshBtn, true); // 忙碌状态：禁用 + loading
  refreshBtn.classList.add("spinning");
  try {
    applyLanguage();

    // bridge.apiGet resolves to the "data" field automatically
    // 注意：endpoint 内不能带 "?"（bridge SDK 校验会拒绝），query 参数走第二个参数 params
    const settingsData = await bridge.apiGet("settings", force ? { force: 1 } : undefined);
    allSettings = settingsData.settings || [];
    providers = settingsData.providers || [];

    try {
      const sortData = await bridge.apiGet("sort-order");
      if (Array.isArray(sortData)) {
        // 兼容旧版裸数组响应
        sortOrder = sortData;
      } else {
        sortOrder = sortData.order || [];
        // F4: 用服务端持久化的隐藏插件列表初始化/合并会话状态
        for (const name of sortData.hidden || []) hiddenPlugins.add(name);
      }
    } catch (e) {
      sortOrder = [];
    }

    changes.clear();
    updateSaveBtn();

    // 清理已不存在插件的隐藏标记
    const pluginNames = new Set(allSettings.map((s) => s.plugin_name));
    for (const name of [...hiddenPlugins]) {
      if (!pluginNames.has(name)) hiddenPlugins.delete(name);
    }

    if (allSettings.length === 0) {
      renderSidebar();
      showState("empty");
      return;
    }
    render();
    showState("content");
  } catch (err) {
    $("#errorMsg").textContent = err.message || "Failed to load";
    showState("error");
  } finally {
    refreshBtn.classList.remove("spinning");
    setBtnLoading(refreshBtn, false);
  }
}

// Render
function render() {
  const groups = groupByPlugin();
  const sortedKeys = getSortedPluginKeys(groups);
  // 主视图跳过被侧栏隐藏的插件
  const visibleKeys = sortedKeys.filter((k) => !hiddenPlugins.has(k));

  const container = $("#pluginGroups");
  container.innerHTML = "";

  visibleKeys.forEach((pluginName, index) => {
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
    downBtn.disabled = index === visibleKeys.length - 1;
    downBtn.addEventListener("click", () => movePlugin(pluginName, 1));

    sortBtns.append(upBtn, downBtn);

    // 卡片标题两行：第一行 display name（或去前缀短名），第二行完整插件名
    const title = document.createElement("div");
    title.className = "plugin-card-title";

    const titleText = document.createElement("div");
    titleText.className = "plugin-card-title-text";

    const nameEl = document.createElement("span");
    nameEl.className = "plugin-card-name";
    const first = settings[0];
    const display = first.display_name;
    if (display && display !== pluginName) {
      nameEl.textContent = display;
      nameEl.title = display;
    } else {
      // 无 display_name 或与插件名相同时显示去前缀短名
      const short = pluginName.startsWith("astrbot_plugin_")
        ? pluginName.slice("astrbot_plugin_".length)
        : pluginName;
      nameEl.textContent = short;
      nameEl.title = short;
    }

    const idEl = document.createElement("span");
    idEl.className = "plugin-card-id";
    idEl.textContent = pluginName;
    idEl.title = pluginName;

    titleText.append(nameEl, idEl);
    title.appendChild(titleText);

    header.append(sortBtns, title);

    const body = document.createElement("div");
    body.className = "plugin-card-body";
    for (const s of settings) body.appendChild(buildRow(s));

    card.append(header, body);
    container.appendChild(card);
  });

  // 侧栏与主视图共享同一数据源，主视图重绘时同步重绘侧栏
  renderSidebar();
}

async function movePlugin(pluginName, direction) {
  const groups = groupByPlugin();
  const currentOrder = getSortedPluginKeys(groups);

  // 在"可见插件"序列中寻找相邻目标，避免与隐藏插件交换导致视觉上无变化
  const visible = currentOrder.filter((k) => !hiddenPlugins.has(k));
  const vIndex = visible.indexOf(pluginName);
  const vTarget = vIndex + direction;
  if (vIndex < 0 || vTarget < 0 || vTarget >= visible.length) return;

  const i = currentOrder.indexOf(pluginName);
  const j = currentOrder.indexOf(visible[vTarget]);

  // 保存旧顺序用于失败回滚
  const prevOrder = [...sortOrder];

  // Swap
  [currentOrder[i], currentOrder[j]] = [currentOrder[j], currentOrder[i]];

  sortOrder = currentOrder;
  render();

  // Save sort order
  try {
    await bridge.apiPost("save-sort-order", { order: sortOrder });
    showToast(t("sortSaved"), "success");
  } catch (err) {
    // 保存失败，回滚到之前的顺序
    sortOrder = prevOrder;
    render();
    showToast(t("sortFailed") + err.message, "error");
  }
}

function buildRow(s) {
  const row = document.createElement("div");
  row.className = "field-row";

  // #15: 使用 JSON 元组作为键，避免插件名/路径含分隔符时发生键碰撞
  const key = JSON.stringify([s.plugin_name, s.field_path]);
  const cur = s.current_value || "";

  const info = document.createElement("div");
  info.className = "field-info";

  // 状态点：已配置=绿，未设置=空心，已修改=accent
  const dot = document.createElement("span");
  dot.className = "field-dot" + (cur ? " field-dot--set" : "");

  const text = document.createElement("div");
  text.className = "field-text";

  const label = document.createElement("div");
  label.className = "field-label";
  label.textContent = s.description || s.field_path.split(".").pop();

  const pathEl = document.createElement("div");
  pathEl.className = "field-path";
  pathEl.textContent = s.field_path;

  text.append(label, pathEl);

  if (s.hint) {
    const hint = document.createElement("div");
    hint.className = "field-hint";
    hint.textContent = s.hint;
    text.appendChild(hint);
  }

  // diff 提示：原值 → 新值
  const diff = document.createElement("div");
  diff.className = "field-diff";
  text.appendChild(diff);

  info.append(dot, text);

  const wrap = document.createElement("div");
  wrap.className = "field-select-wrap";
  const sel = document.createElement("select");
  sel.className = "field-select";

  const emptyOpt = document.createElement("option");
  emptyOpt.value = "__CLEAR__";
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

  // F2: 悬空检测 — 已保存的值非空但不在 providers 列表中（如对应 provider 已卸载）
  // 每次 render 都会重建行，因此天然随每次渲染/保存后重算
  if (cur && !providers.some((p) => p.id === cur)) {
    row.classList.add("is-dangling");
    const warn = document.createElement("span");
    warn.className = "mm-dangling-icon";
    warn.title = t("danglingProvider");
    warn.innerHTML = WARN_SVG;
    wrap.appendChild(warn);
  }

  sel.addEventListener("change", () => {
    const v = sel.value;
    const actualValue = v === "__CLEAR__" ? "" : v;
    if (actualValue !== cur) {
      changes.set(key, { plugin_name: s.plugin_name, field_path: s.field_path, value: actualValue });
      sel.classList.add("changed");
      dot.className = "field-dot field-dot--changed";
      // 显示 diff
      const from = cur || t("unsetValue");
      const to = actualValue || t("clearedValue");
      diff.innerHTML = "";
      diff.appendChild(document.createTextNode(from));
      const arrow = document.createElement("span");
      arrow.className = "diff-arrow";
      arrow.textContent = "\u2192";
      diff.appendChild(arrow);
      diff.appendChild(document.createTextNode(to));
      diff.style.display = "block";
    } else {
      changes.delete(key);
      sel.classList.remove("changed");
      dot.className = "field-dot" + (cur ? " field-dot--set" : "");
      diff.style.display = "none";
    }
    updateSaveBtn();
  });

  wrap.appendChild(sel);
  row.append(info, wrap);
  return row;
}

// Save
function updateSaveBtn() {
  const saveBtn = $("#saveBtn");
  saveBtn.disabled = changes.size === 0;
  const badge = $("#saveBadge");
  badge.textContent = changes.size;
  badge.style.display = changes.size > 0 ? "inline-flex" : "none";
  // 触发 pulse 动画
  if (changes.size > 0) {
    badge.classList.remove("pulse");
    void badge.offsetWidth; // 强制 reflow 以重启动画
    badge.classList.add("pulse");
  }
}

async function saveAll() {
  if (changes.size === 0) return;
  const saveBtn = $("#saveBtn");
  setBtnLoading(saveBtn, true);
  try {
    const res = await bridge.apiPost("batch", { updates: Array.from(changes.values()) });
    const ok = res.success || 0;
    const fails = res.failures || [];
    showToast(
      fails.length === 0 ? t("saved") + ok + t("changes") : t("saved") + ok + t("failed") + fails.length,
      fails.length === 0 ? "success" : "error"
    );
    await loadAll();
    setBtnLoading(saveBtn, false);
    updateSaveBtn();
  } catch (err) {
    showToast(t("saveFailed") + err.message, "error");
    setBtnLoading(saveBtn, false);
    updateSaveBtn();
  }
}

// ── Sidebar（插件导航侧栏：跳转 / 隐藏 / 拖拽排序）─────────────
const EYE_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
// F2: 悬空警告图标（Material Rounded warning，静态常量，仅经 innerHTML 赋给空 span）
const WARN_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>';

// 创建侧栏 DOM（默认隐藏，通过 .open / .show class 控制）
const sidebarBackdrop = document.createElement("div");
sidebarBackdrop.id = "sidebarBackdrop";
sidebarBackdrop.className = "sidebar-backdrop";

const sidebarEl = document.createElement("aside");
sidebarEl.id = "sidebar";
sidebarEl.className = "sidebar";

// C1: 静态侧栏结构改用 DOM API 构建（原先 innerHTML 字符串拼接不涉及动态数据，改为 createElement 更安全一致）
const sidebarHeader = document.createElement("div");
sidebarHeader.className = "sidebar-header";

const sidebarTitle = document.createElement("h2");
sidebarTitle.className = "sidebar-title";
sidebarTitle.dataset.i18n = "sidebarTitle";
sidebarTitle.textContent = "模型配置插件"; // 占位文案，applyLanguage() 会按当前语言覆盖

const sidebarCloseBtn = document.createElement("button");
sidebarCloseBtn.id = "sidebarCloseBtn";
sidebarCloseBtn.className = "dialog-close";
sidebarCloseBtn.textContent = "\u00d7";

sidebarHeader.append(sidebarTitle, sidebarCloseBtn);

const sidebarListEl = document.createElement("div");
sidebarListEl.id = "sidebarList";
sidebarListEl.className = "sidebar-list";

sidebarEl.append(sidebarHeader, sidebarListEl);
document.body.append(sidebarBackdrop, sidebarEl);

function openSidebar() {
  sidebarOpen = true;
  sidebarEl.classList.add("open");
  sidebarBackdrop.classList.add("show");
}

function closeSidebar() {
  sidebarOpen = false;
  sidebarEl.classList.remove("open");
  sidebarBackdrop.classList.remove("show");
}

function toggleSidebar() {
  if (sidebarOpen) closeSidebar();
  else openSidebar();
}

/** 切换插件隐藏状态并同步主视图 + 侧栏 */
function toggleHidden(pluginName) {
  if (hiddenPlugins.has(pluginName)) hiddenPlugins.delete(pluginName);
  else hiddenPlugins.add(pluginName);
  render();
  scheduleSidebarPersist(); // F4: 隐藏状态变化同样持久化
}

/** 点击侧栏项名称：平滑滚动主视图到对应插件卡片 */
function jumpToPlugin(pluginName, item) {
  const card = document.querySelector(
    '.plugin-card[data-plugin="' + CSS.escape(pluginName) + '"]'
  );
  if (!card) return; // 已隐藏的插件在主视图无卡片，不跳转
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  // 短暂高亮被点击的侧栏项
  item.classList.add("sidebar-item--active");
  setTimeout(() => item.classList.remove("sidebar-item--active"), 800);
}

// 拖拽排序状态
let dragSrcEl = null;

// F4: 侧栏顺序/隐藏状态持久化（300ms trailing 防抖 + 在途保护，避免并发请求）
let sidebarSaveTimer = null;
let sidebarSaveInFlight = false;
let sidebarSavePending = false;

/** 提交 {order, hidden} 到 save-sort-order；若上次请求仍在途则置 pending，完成后补发一次 */
async function persistSidebar() {
  if (sidebarSaveInFlight) {
    sidebarSavePending = true;
    return;
  }
  sidebarSaveInFlight = true;
  try {
    await bridge.apiPost("save-sort-order", {
      order: getSortedPluginKeys(groupByPlugin()),
      hidden: [...hiddenPlugins],
    });
  } catch (err) {
    // 持久化失败不打断拖拽/隐藏交互：下次变更会再次尝试
    console.error("persistSidebar failed:", err.message);
  } finally {
    sidebarSaveInFlight = false;
    if (sidebarSavePending) {
      sidebarSavePending = false;
      persistSidebar();
    }
  }
}

/** 防抖触发持久化（trailing 300ms） */
function scheduleSidebarPersist() {
  clearTimeout(sidebarSaveTimer);
  sidebarSaveTimer = setTimeout(persistSidebar, 300);
}

/** 拖拽结束后：按侧栏 DOM 顺序提交新的全局排序并持久化 */
function commitSidebarOrder() {
  const list = $("#sidebarList");
  const newOrder = Array.from(list.children).map((el) => el.dataset.plugin);
  const currentOrder = getSortedPluginKeys(groupByPlugin());
  if (newOrder.join("\u0000") === currentOrder.join("\u0000")) return; // 顺序未变化

  sortOrder = newOrder;
  render();
  scheduleSidebarPersist(); // F4: 防抖持久化（含 hidden 列表）
}

/** 重绘侧栏列表（与主视图共享 allSettings + sortOrder + hiddenPlugins） */
function renderSidebar() {
  const list = $("#sidebarList");
  if (!list) return;
  list.innerHTML = "";

  const groups = groupByPlugin();
  const sortedKeys = getSortedPluginKeys(groups);

  for (const pluginName of sortedKeys) {
    const settings = groups.get(pluginName);
    const isHidden = hiddenPlugins.has(pluginName);

    const item = document.createElement("div");
    item.className = "sidebar-item" + (isHidden ? " sidebar-item--hidden" : "");
    item.dataset.plugin = pluginName;
    item.draggable = true;

    const handle = document.createElement("span");
    handle.className = "sidebar-item-handle";
    handle.title = t("dragHint");
    handle.textContent = "\u2261"; // ≡

    // 侧边栏两行名称：第一行 display name（或去前缀短名），第二行完整插件名
    const nameBox = document.createElement("div");
    nameBox.className = "sidebar-item-text";

    const name = document.createElement("span");
    name.className = "sidebar-item-name";
    const display = settings[0].display_name;
    if (display && display !== pluginName) {
      name.textContent = display;
      name.title = display;
    } else {
      // 无 display_name 或与插件名相同时，第一行显示去掉 astrbot_plugin_ 前缀的短名
      const short = pluginName.startsWith("astrbot_plugin_")
        ? pluginName.slice("astrbot_plugin_".length)
        : pluginName;
      name.textContent = short;
      name.title = short;
    }

    const idEl = document.createElement("span");
    idEl.className = "sidebar-item-id";
    idEl.textContent = pluginName;
    idEl.title = pluginName;

    nameBox.append(name, idEl);

    const eyeBtn = document.createElement("button");
    eyeBtn.className = "sidebar-item-eye";
    eyeBtn.title = isHidden ? t("showPlugin") : t("hidePlugin");
    eyeBtn.innerHTML = isHidden ? EYE_OFF_SVG : EYE_SVG;
    eyeBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // 不触发跳转
      toggleHidden(pluginName);
    });

    item.append(handle, nameBox, eyeBtn);

    // 点击名称区域跳转（眼睛/拖拽手柄除外）
    item.addEventListener("click", (e) => {
      if (e.target.closest(".sidebar-item-eye") || e.target.closest(".sidebar-item-handle")) return;
      jumpToPlugin(pluginName, item);
    });

    // 拖拽排序（HTML5 DnD，拖动过程中实时移动 DOM 提供预览）
    item.addEventListener("dragstart", (e) => {
      dragSrcEl = item;
      item.classList.add("sidebar-item--dragging");
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", pluginName);
      } catch (_) {
        /* 某些环境不允许 setData，忽略 */
      }
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!dragSrcEl || dragSrcEl === item) return;
      const rect = item.getBoundingClientRect();
      const insertBefore = e.clientY - rect.top < rect.height / 2;
      if (insertBefore) list.insertBefore(dragSrcEl, item);
      else list.insertBefore(dragSrcEl, item.nextSibling);
    });

    item.addEventListener("drop", (e) => e.preventDefault());

    item.addEventListener("dragend", () => {
      item.classList.remove("sidebar-item--dragging");
      dragSrcEl = null;
      commitSidebarOrder();
    });

    list.appendChild(item);
  }
}

$("#sidebarToggleBtn").addEventListener("click", toggleSidebar);
$("#sidebarCloseBtn").addEventListener("click", closeSidebar);
sidebarBackdrop.addEventListener("click", closeSidebar);

// Events
$("#refreshBtn").addEventListener("click", () => loadAll(true)); // F1: force=1 绕过后端扫描缓存
$("#retryBtn").addEventListener("click", () => loadAll());
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

  currentModelSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = t("selectCurrent");
  currentModelSelect.appendChild(placeholder);
  for (const m of uniqueModels) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    currentModelSelect.appendChild(opt);
  }

  // Populate new model select with available providers
  populateProviderSelect(newModelSelect, "selectNew");

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
  setBtnLoading(dialogConfirmBtn, true);
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
    setBtnLoading(dialogConfirmBtn, false);
    dialogConfirmBtn.disabled = true;
  } catch (err) {
    showToast(t("switchFailed") + err.message, "error");
    setBtnLoading(dialogConfirmBtn, false);
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
  populateProviderSelect(setAllModelSelect, "selectModel");

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
  setBtnLoading(setAllConfirmBtn, true);
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
    setBtnLoading(setAllConfirmBtn, false);
    setAllConfirmBtn.disabled = true;
  } catch (err) {
    showToast(t("setAllFailed") + err.message, "error");
    setBtnLoading(setAllConfirmBtn, false);
    setAllConfirmBtn.disabled = false;
  }
}

$("#setAllBtn").addEventListener("click", openSetAll);
$("#setAllCloseBtn").addEventListener("click", closeSetAll);
$("#setAllCancelBtn").addEventListener("click", closeSetAll);
setAllModelSelect.addEventListener("change", updateSetAllPreview);
setAllConfirmBtn.addEventListener("click", confirmSetAll);

// 对话框键盘/過罩关闭
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (quickSwitchDialog.style.display !== "none") closeQuickSwitch();
    if (setAllDialog.style.display !== "none") closeSetAll();
    if (sidebarOpen) closeSidebar();
  }
});
quickSwitchDialog.addEventListener("click", (e) => {
  if (e.target === quickSwitchDialog) closeQuickSwitch();
});
setAllDialog.addEventListener("click", (e) => {
  if (e.target === setAllDialog) closeSetAll();
});

// 监听 WebUI 语言/主题切换（官方 onContext 模式；回调会立即触发一次并携带当前 context）
bridge.onContext((ctx) => {
  // C1: 语言变化时同步 <html lang>（BCP47）
  if (ctx && ctx.locale) currentLocale = ctx.locale;
  applyLanguage();
  if (allSettings.length > 0) {
    render(); // render() 内部会同步重绘侧栏
  } else {
    renderSidebar();
  }
});

// Start
await loadAll();
