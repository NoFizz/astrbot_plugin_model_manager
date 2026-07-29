"""astrbot_plugin_model_manager v1.2.3 - Unified Model Manager

Follows official Plugin Pages docs exactly:
  - Route: /{PLUGIN_NAME}/{endpoint}
  - Frontend: bridge.apiGet("{endpoint}")
  - Response: json_response({"status":"ok","data":...}) -> bridge unwraps to data
"""

from __future__ import annotations

import asyncio
import json
import os
import pathlib
import re
import threading
import time

from astrbot.api import AstrBotConfig, logger
from astrbot.api.star import Context, Star, register
from astrbot.api.web import error_response, json_response, request

try:
    from astrbot.core.utils.astrbot_path import get_astrbot_config_path
except ImportError:
    def get_astrbot_config_path() -> str:
        return ""

PLUGIN_NAME = "astrbot_plugin_model_manager"
PLUGIN_VERSION = "1.2.3"
MAX_FIELD_PATH_LENGTH = 500
MAX_SCHEMA_DEPTH = 10
MAX_BATCH_SIZE = 100
MAX_FIELDS_PER_PLUGIN = 200
SCAN_CACHE_TTL = 30.0
EXCLUDED_DIRS = {"__pycache__", "node_modules", ".git", ".vscode"}
_MISSING = object()
MAX_VALUE_LENGTH = 4096

_FIELD_PATH_RE = re.compile(r'^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*$')
_TPL_NAME_RE = re.compile(r'^[a-zA-Z0-9_-]+$')
_SCHEMA_KEY_RE = re.compile(r'^[^\x00-\x1f/]+$')
_PLUGIN_NAME_RE = re.compile(r'^[a-zA-Z0-9_-]+$')


def _sanitize_plugin_name(name: str, cfg_dir: pathlib.Path | None) -> str | None:
    """校验插件名是否合法。cfg_dir 必须非 None，否则返回 None。"""
    if not name or not _PLUGIN_NAME_RE.match(name):
        return None
    if not cfg_dir:
        logger.warning(f"[{PLUGIN_NAME}] _sanitize_plugin_name called with cfg_dir=None")
        return None
    try:
        (cfg_dir / f"{name}_config.json").resolve().relative_to(cfg_dir.resolve())
    except ValueError:
        return None
    return name


def _sanitize_field_path(fp: str) -> str | None:
    """校验字段路径格式，防止路径遍历。合法则原样返回，否则返回 None。"""
    if not fp or len(fp) > MAX_FIELD_PATH_LENGTH:
        return None
    if not _FIELD_PATH_RE.match(fp):
        return None
    return fp


def _sanitize_value(val) -> str | None:
    """校验并规范化用户提交的值。返回字符串或 None（表示非法）。"""
    if val is None:
        return ""
    if isinstance(val, (int, float, bool)):
        return str(val)
    if not isinstance(val, str):
        return None
    if len(val) > MAX_VALUE_LENGTH:
        return None
    if any(ord(c) < 0x20 and c not in "\n\r\t" for c in val):
        return None
    return val


@register(
    "astrbot_plugin_model_manager",
    "NoFizz",
    "Unified LLM model configuration manager",
    "1.2.3",
)
class ModelManagerPlugin(Star):

    def __init__(self, context: Context, config: AstrBotConfig | None = None):
        super().__init__(context)
        self.config = config or {}
        self._scan_cache: tuple[list[dict], list[dict]] | None = None
        self._scan_cache_time: float = 0.0
        self._config_dir_cache: pathlib.Path | None = None
        self._config_dir_resolved: bool = False
        self._scan_lock = asyncio.Lock()
        self._write_lock = asyncio.Lock()  # 保护配置文件 read-modify-write 操作
        self._terminated = False

        context.register_web_api(
            f"/{PLUGIN_NAME}/settings",
            self.api_get_all,
            ["GET"],
            "Get all provider settings",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/providers",
            self.api_available_providers,
            ["GET"],
            "List available providers",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/update",
            self.api_update_provider,
            ["POST"],
            "Update single provider",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/batch",
            self.api_batch_update,
            ["POST"],
            "Batch update providers",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/sort-order",
            self.api_get_sort_order,
            ["GET"],
            "Get plugin sort order",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/save-sort-order",
            self.api_save_sort_order,
            ["POST"],
            "Save plugin sort order",
        )
        logger.info(f"[{PLUGIN_NAME}] v1.2.3 loaded")

    async def terminate(self):
        """插件卸载/停用时清理资源。"""
        self._terminated = True
        self._scan_cache = None
        self._scan_cache_time = 0.0
        self._config_dir_resolved = False
        self._config_dir_cache = None
        logger.info(f"[{PLUGIN_NAME}] unloaded")

    def _get_config_dir(self) -> pathlib.Path | None:
        """获取 AstrBot 配置目录（带缓存）。"""
        if self._config_dir_resolved and self._config_dir_cache is not None:
            return self._config_dir_cache
        try:
            raw = get_astrbot_config_path()
            if not raw:
                return None
            p = pathlib.Path(raw)
            if not p.exists():
                return None
            if p.is_file() or p.suffix == ".json":
                self._config_dir_cache = p.parent
                self._config_dir_resolved = True
                return self._config_dir_cache
            if p.is_dir():
                self._config_dir_cache = p
                self._config_dir_resolved = True
                return self._config_dir_cache
        except Exception as e:
            logger.warning(f"[{PLUGIN_NAME}] Failed to get config dir: {e}")
        return None

    def _get_plugins_dir(self) -> pathlib.Path | None:
        """推断插件目录位置。"""
        cfg_dir = self._get_config_dir()
        if not cfg_dir:
            return None
        candidates = [cfg_dir / "plugins", cfg_dir.parent / "plugins"]
        for d in candidates:
            if d.is_dir():
                return d
        return None

    def _parse_yaml_top_level_string_field(self, path: pathlib.Path, key: str) -> str:
        """轻量级 YAML 顶层字段解析（仅适用于简单 key: value 场景）。"""
        if not path.exists():
            return ""
        try:
            for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
                if raw_line.startswith(f"{key}:") and not raw_line.startswith((" ", "\t")):
                    val = raw_line.split(":", 1)[1].strip()
                    if val.startswith("#"):
                        return ""
                    quoted = False
                    for ch in ("'", '"'):
                        if val.startswith(ch) and val.endswith(ch) and len(val) >= 2:
                            val = val[1:-1]
                            quoted = True
                            break
                    if not quoted and "#" in val:
                        val = val.split("#", 1)[0].strip()
                    return val.strip()
        except Exception:
            pass
        return ""

    def _read_plugin_display_name(self, plugin_dir: pathlib.Path) -> str:
        dir_name = plugin_dir.name
        dn = self._parse_yaml_top_level_string_field(plugin_dir / "metadata.yaml", "display_name")
        return dn if dn and dn != dir_name else ""

    def _find_provider_fields(self, schema: dict, prefix: str = "", depth: int = 0) -> list[dict]:
        """递归扫描 _conf_schema.json，提取含 _special=select_provider* 的字段。"""
        if depth > MAX_SCHEMA_DEPTH:
            return []
        results = []
        for key, value in schema.items():
            if not isinstance(value, dict):
                continue
            if not _SCHEMA_KEY_RE.match(key):
                logger.warning(f"[{PLUGIN_NAME}] Invalid schema key '{key}', skipping")
                continue
            path = f"{prefix}.{key}" if prefix else key
            special = value.get("_special", "")
            if special in ("select_provider", "select_provider_tts", "select_provider_stt"):
                results.append({
                    "field_path": path,
                    "special_type": special,
                    "description": value.get("description", key),
                    "hint": value.get("hint", ""),
                    "depth": depth,
                })
            if value.get("type") == "object":
                items = value.get("items", {})
                if isinstance(items, dict):
                    results.extend(self._find_provider_fields(items, path, depth + 1))
            if value.get("type") == "template_list":
                templates = value.get("templates")
                if not isinstance(templates, dict):
                    templates = value.get("items")
                if isinstance(templates, list):
                    templates = {str(i): t for i, t in enumerate(templates) if isinstance(t, dict)}
                if not isinstance(templates, dict):
                    continue
                for tpl_name, tpl_def in templates.items():
                    if not isinstance(tpl_def, dict):
                        continue
                    if not _TPL_NAME_RE.match(tpl_name):
                        logger.warning(f"[{PLUGIN_NAME}] Invalid template name '{tpl_name}', skipping")
                        continue
                    items = tpl_def.get("items", {})
                    if isinstance(items, dict):
                        results.extend(
                            self._find_provider_fields(items, f"{path}.__tpl__{tpl_name}", depth + 1)
                        )
        return results

    def _read_json_file(self, path: pathlib.Path) -> dict | list | None:
        """读取 JSON 文件，返回解析后的 dict/list 或 None。"""
        if not path.exists():
            return None
        try:
            text = path.read_text(encoding="utf-8-sig").strip()
            if not text:
                return None
            data = json.loads(text)
            if isinstance(data, (dict, list)):
                return data
            return None
        except (json.JSONDecodeError, UnicodeDecodeError, OSError) as e:
            logger.warning(f"[{PLUGIN_NAME}] Failed to read {path}: {e}")
            return None

    def _write_json_file(self, path: pathlib.Path, data: dict | list) -> None:
        """原子写入 JSON 文件（先写临时文件再 rename，防止写入中断导致损坏）。"""
        content = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        tmp = path.with_suffix(f".tmp.{os.getpid()}.{threading.get_ident()}")
        tmp.write_text(content, encoding="utf-8")
        try:
            tmp.replace(path)
        except OSError as e:
            logger.warning(f"[{PLUGIN_NAME}] Atomic write failed, falling back to direct write: {e}")
            try:
                path.write_text(content, encoding="utf-8")
            except OSError as e2:
                logger.error(f"[{PLUGIN_NAME}] Direct write also failed: {e2}")
                raise
            finally:
                try:
                    tmp.unlink(missing_ok=True)
                except OSError:
                    pass

    def _get_nested_value(self, data: dict, field_path: str):
        """根据点分隔路径获取嵌套值，支持 __tpl__ 模板匹配。找不到时返回 _MISSING。"""
        parts = field_path.split(".")
        current = data
        for part in parts:
            if part.startswith("__tpl__"):
                tpl_name = part[len("__tpl__"):]
                if isinstance(current, list):
                    matched = None
                    for item in current:
                        if isinstance(item, dict) and item.get("__template_key") == tpl_name:
                            matched = item
                            break
                    if matched is None:
                        logger.debug(f"[{PLUGIN_NAME}] Template '{tpl_name}' not found in list")
                        return _MISSING
                    current = matched
                else:
                    return _MISSING
            elif isinstance(current, dict):
                current = current.get(part, _MISSING)
                if current is _MISSING:
                    return _MISSING
            elif isinstance(current, list):
                found_any = False
                for item in current:
                    if isinstance(item, dict) and part in item:
                        current = item[part]
                        found_any = True
                        break
                if not found_any:
                    return _MISSING
            else:
                return _MISSING
        return current

    def _set_nested_value(self, data: dict, field_path: str, value) -> bool:
        """根据点分隔路径设置嵌套值。成功返回 True，路径不可达返回 False。"""
        parts = field_path.split(".")
        return self._set_recursive(data, parts, 0, value)

    def _set_recursive(self, current, parts, idx, value) -> bool:
        if idx >= len(parts):
            return True
        part = parts[idx]
        is_last = idx == len(parts) - 1
        if part.startswith("__tpl__"):
            tpl_name = part[len("__tpl__"):]
            if isinstance(current, list):
                matched = False
                for item in current:
                    if isinstance(item, dict) and item.get("__template_key") == tpl_name:
                        if self._set_recursive(item, parts, idx + 1, value):
                            matched = True
                        else:
                            return False
                if not matched:
                    logger.warning(f"[{PLUGIN_NAME}] Template '{tpl_name}' not found in list")
                return matched
            logger.warning(f"[{PLUGIN_NAME}] Cannot set __tpl__ field: expected list, got {type(current).__name__}")
            return False
        if isinstance(current, dict):
            if is_last:
                current[part] = value
                return True
            else:
                nxt = current.get(part)
                if isinstance(nxt, list):
                    matched = False
                    for item in nxt:
                        if isinstance(item, dict):
                            if self._set_recursive(item, parts, idx + 1, value):
                                matched = True
                            else:
                                return False
                    if not matched:
                        logger.warning(f"[{PLUGIN_NAME}] No valid dict items found in list at '{part}'")
                    return matched
                elif isinstance(nxt, dict):
                    return self._set_recursive(nxt, parts, idx + 1, value)
                else:
                    if nxt is None:
                        current[part] = {}
                        return self._set_recursive(current[part], parts, idx + 1, value)
                    else:
                        logger.warning(
                            f"[{PLUGIN_NAME}] Cannot descend into '{part}': "
                            f"existing value of type {type(nxt).__name__} would be overwritten"
                        )
                        return False
        return False

    async def _scan_all_plugins(self) -> tuple[list[dict], list[dict]]:
        """扫描所有插件的 provider 配置字段（带 TTL 缓存）。返回 (settings, errors)。"""
        now = time.time()
        if self._scan_cache is not None and (now - self._scan_cache_time) < SCAN_CACHE_TTL:
            results, scan_errors = self._scan_cache
        else:
            async with self._scan_lock:
                now = time.time()
                if self._scan_cache is not None and (now - self._scan_cache_time) < SCAN_CACHE_TTL:
                    results, scan_errors = self._scan_cache
                else:
                    plugins_dir = self._get_plugins_dir()
                    cfg_dir = self._get_config_dir()
                    if not plugins_dir:
                        return [], []
                    results = []
                    scan_errors = []
                    with os.scandir(plugins_dir) as entries:
                        plugin_dirs = sorted(
                            (e for e in entries if e.is_dir() and not e.name.startswith(".") and e.name not in EXCLUDED_DIRS),
                            key=lambda e: e.name
                        )
                        for entry in plugin_dirs:
                            plugin_dir = pathlib.Path(entry.path)
                            schema_file = plugin_dir / "_conf_schema.json"
                            if not schema_file.exists():
                                continue
                            plugin_name = plugin_dir.name
                            if plugin_name == PLUGIN_NAME:
                                continue
                            try:
                                schema = self._read_json_file(schema_file)
                                if not schema or not isinstance(schema, dict):
                                    continue
                                fields = self._find_provider_fields(schema)
                                if not fields:
                                    continue
                                if len(fields) > MAX_FIELDS_PER_PLUGIN:
                                    logger.warning(f"[{PLUGIN_NAME}] Plugin '{plugin_name}' has too many fields ({len(fields)}), truncating")
                                    fields = fields[:MAX_FIELDS_PER_PLUGIN]
                                display_name = self._read_plugin_display_name(plugin_dir)
                                plugin_config = {}
                                if cfg_dir:
                                    cf = cfg_dir / f"{plugin_name}_config.json"
                                    if cf.exists():
                                        raw_cfg = self._read_json_file(cf)
                                        if isinstance(raw_cfg, dict):
                                            plugin_config = raw_cfg
                                for field in fields:
                                    cv = self._get_nested_value(plugin_config, field["field_path"])
                                    if cv is _MISSING:
                                        cv = ""
                                    results.append({
                                        "plugin_name": plugin_name,
                                        "display_name": display_name,
                                        "field_path": field["field_path"],
                                        "special_type": field["special_type"],
                                        "description": field["description"],
                                        "hint": (field.get("hint") or "")[:200],
                                        "current_value": cv if cv is not None else "",
                                    })
                            except Exception as e:
                                logger.warning(f"[{PLUGIN_NAME}] Failed to scan plugin '{plugin_name}': {e}")
                                scan_errors.append({"plugin": plugin_name, "error": str(e)})
                                continue

                    self._scan_cache = (results, scan_errors)
                    self._scan_cache_time = now

        sort_order = self._read_sort_order()
        if sort_order:
            order_map = {name: i for i, name in enumerate(sort_order)}
            results = sorted(results, key=lambda x: order_map.get(x["plugin_name"], 9999))
        return results, scan_errors

    def _get_all_providers(self) -> list[dict]:
        """获取所有可用的 LLM 提供商列表。

        采用 3 层降级策略（均非官方公开 API，可能随版本变动）：
          1. context.get_all_providers() — 较新版本提供的便捷方法
          2. context.provider_manager.chat_providers — 内部管理器属性
          3. 直接读取 abconf_*.json 配置文件 — 最底层 fallback
        """
        try:
            providers = self.context.get_all_providers()
            if not providers:
                raise ValueError("No providers returned")
            result = []
            for p in providers:
                pc = getattr(p, "provider_config", None)
                if pc is None:
                    continue
                if hasattr(pc, "__dict__"):
                    pc = {k: v for k, v in vars(pc).items() if not k.startswith("_")}
                elif not isinstance(pc, dict):
                    continue
                pid = pc.get("id", "")
                if not pid:
                    continue
                ptype = pc.get("type", "") or ""
                if hasattr(ptype, "value"):
                    ptype = ptype.value
                result.append({
                    "id": pid,
                    "model": pc.get("model", "") or (getattr(p, "model", "") or ""),
                    "type": str(ptype),
                })
            if result:
                return result
        except Exception as e:
            logger.debug(f"[{PLUGIN_NAME}] get_all_providers failed: {e}")
        try:
            pmgr = self.context.provider_manager
            if pmgr and hasattr(pmgr, "chat_providers"):
                return [
                    {"id": pid, "model": getattr(prov, "model", "") or "", "type": getattr(prov, "provider_type", "") or ""}
                    for pid, prov in pmgr.chat_providers.items()
                ]
        except Exception:
            pass
        cfg_dir = self._get_config_dir()
        if cfg_dir:
            all_p, seen = [], set()
            for cf in sorted(cfg_dir.glob("abconf_*.json")):
                data = self._read_json_file(cf)
                if not data or not isinstance(data, dict):
                    continue
                for p in data.get("provider", []):
                    pid = p.get("id", "")
                    if pid and p.get("enable", True) and pid not in seen:
                        seen.add(pid)
                        all_p.append({"id": pid, "model": p.get("model", "") or "", "type": p.get("provider_source_id", "") or ""})
            if all_p:
                return all_p
        return []

    def _update_plugin_config(self, plugin_name: str, field_path: str, new_value: str) -> bool:
        """读取→修改→写回单个插件配置文件。"""
        cfg_dir = self._get_config_dir()
        if not cfg_dir:
            return False
        cf = cfg_dir / f"{plugin_name}_config.json"
        pc = self._read_json_file(cf)
        if not isinstance(pc, dict):
            pc = {}
        if not self._set_nested_value(pc, field_path, new_value):
            return False
        self._write_json_file(cf, pc)
        return True

    async def api_get_all(self):
        if self._terminated:
            return error_response("Plugin unloaded", status_code=503)
        try:
            settings, scan_errors = await self._scan_all_plugins()
            providers = self._get_all_providers()
            return json_response({
                "status": "ok",
                "data": {
                    "version": PLUGIN_VERSION,
                    "settings": settings,
                    "providers": providers,
                    "total": len(settings),
                    "errors": scan_errors,
                }
            })
        except Exception as e:
            logger.error(f"[{PLUGIN_NAME}] api_get_all: {e}", exc_info=True)
            return error_response(str(e))

    async def api_available_providers(self):
        if self._terminated:
            return error_response("Plugin unloaded", status_code=503)
        try:
            providers = self._get_all_providers()
            return json_response({"status": "ok", "data": {"providers": providers}})
        except Exception as e:
            logger.error(f"[{PLUGIN_NAME}] api_available_providers: {e}", exc_info=True)
            return error_response(str(e))

    async def api_update_provider(self):
        if self._terminated:
            return error_response("Plugin unloaded", status_code=503)
        payload = await request.json(default={})
        cfg_dir = self._get_config_dir()
        if not cfg_dir:
            return error_response("Config directory not available", status_code=500)
        pn = _sanitize_plugin_name(payload.get("plugin_name", ""), cfg_dir)
        fp = _sanitize_field_path(payload.get("field_path", ""))
        val = _sanitize_value(payload.get("value", ""))
        if not pn or not fp or val is None:
            return error_response("Invalid plugin_name, field_path, or value", status_code=400)
        logger.debug(f"[{PLUGIN_NAME}] Update: {pn}/{fp}")
        try:
            async with self._write_lock:
                if self._update_plugin_config(pn, fp, val):
                    self._scan_cache = None  # 写入后使缓存失效
                    return json_response({"status": "ok", "data": {"updated": True}})
            return error_response("Write failed", status_code=500)
        except Exception as e:
            logger.error(f"[{PLUGIN_NAME}] api_update_provider: {e}", exc_info=True)
            return error_response(str(e), status_code=500)

    async def api_batch_update(self):
        if self._terminated:
            return error_response("Plugin unloaded", status_code=503)
        payload = await request.json(default={})
        updates = payload.get("updates", [])
        if not isinstance(updates, list):
            return error_response("updates must be a list", status_code=400)
        if len(updates) > MAX_BATCH_SIZE:
            return error_response(f"Too many updates (max {MAX_BATCH_SIZE})", status_code=400)

        cfg_dir = self._get_config_dir()
        if not cfg_dir:
            return error_response("Config directory not available", status_code=500)

        grouped: dict[str, list[tuple[str, str]]] = {}
        for item in updates:
            if not isinstance(item, dict):
                continue
            pn = _sanitize_plugin_name(item.get("plugin_name", ""), cfg_dir)
            fp = _sanitize_field_path(item.get("field_path", ""))
            val = _sanitize_value(item.get("value", ""))
            if not pn or not fp or val is None:
                continue
            grouped.setdefault(pn, []).append((fp, val))

        logger.debug(f"[{PLUGIN_NAME}] Batch update: {sum(len(v) for v in grouped.values())} fields across {len(grouped)} plugins")
        ok_count, fails = 0, []
        written = False
        async with self._write_lock:
            for pn, fields in grouped.items():
                cf = cfg_dir / f"{pn}_config.json"
                raw = self._read_json_file(cf)
                pc = raw if isinstance(raw, dict) else {}
                write_needed = False
                for fp, val in fields:
                    try:
                        if self._set_nested_value(pc, fp, val):
                            ok_count += 1
                            write_needed = True
                        else:
                            fails.append(f"{pn}/{fp}: path not reachable")
                    except Exception as e:
                        fails.append(f"{pn}/{fp}: {e}")
                if write_needed:
                    try:
                        self._write_json_file(cf, pc)
                        written = True
                    except Exception as e:
                        logger.error(f"[{PLUGIN_NAME}] Batch write failed for {pn}: {e}", exc_info=True)
                        ok_count -= len([fp for fp, _ in fields])
                        fails.extend(f"{pn}/{fp}: write error ({type(e).__name__})" for fp, _ in fields)
            if written:
                self._scan_cache = None  # 写入后使缓存失效

        return json_response({"status": "ok", "data": {"success": ok_count, "failures": fails}})

    def _get_sort_order_file(self) -> pathlib.Path | None:
        cfg_dir = self._get_config_dir()
        if cfg_dir:
            return cfg_dir / f"{PLUGIN_NAME}_sort_order.json"
        return None

    def _read_sort_order(self) -> list[str]:
        """读取插件排序列表（去重、去空）。"""
        f = self._get_sort_order_file()
        if f and f.exists():
            data = self._read_json_file(f)
            if isinstance(data, list):
                seen: set[str] = set()
                result: list[str] = []
                for x in data:
                    s = str(x).strip()
                    if s and s not in seen:
                        seen.add(s)
                        result.append(s)
                return result
        return []

    def _write_sort_order(self, order: list[str]) -> None:
        """持久化插件排序列表。"""
        f = self._get_sort_order_file()
        if f:
            self._write_json_file(f, order)

    async def api_get_sort_order(self):
        if self._terminated:
            return error_response("Plugin unloaded", status_code=503)
        try:
            order = self._read_sort_order()
            return json_response({"status": "ok", "data": {"order": order}})
        except Exception as e:
            logger.error(f"[{PLUGIN_NAME}] api_get_sort_order: {e}", exc_info=True)
            return error_response(str(e))

    async def api_save_sort_order(self):
        if self._terminated:
            return error_response("Plugin unloaded", status_code=503)
        payload = await request.json(default={})
        order = payload.get("order", [])
        if not isinstance(order, list):
            return error_response("order must be a list", status_code=400)
        # 去重并保持顺序
        seen: set[str] = set()
        deduped: list[str] = []
        for x in order:
            if isinstance(x, str) and x.strip() and x not in seen:
                seen.add(x)
                deduped.append(x)
        order = deduped
        try:
            self._write_sort_order(order)
            return json_response({"status": "ok", "data": {"saved": True}})
        except Exception as e:
            logger.error(f"[{PLUGIN_NAME}] api_save_sort_order: {e}", exc_info=True)
            return error_response(str(e))
