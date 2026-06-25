"""astrbot_plugin_model_manager v1.1 - Unified Model Manager

Follows official Plugin Pages docs exactly:
  - Route: /{PLUGIN_NAME}/{endpoint}
  - Frontend: bridge.apiGet("{endpoint}")
  - Response: json_response({"status":"ok","data":...}) -> bridge unwraps to data
"""

import json
import pathlib

from astrbot.api import AstrBotConfig, logger
from astrbot.api.star import Context, Star, register
from astrbot.api.web import error_response, json_response, request

try:
    from astrbot.core.utils.astrbot_path import get_astrbot_config_path
except ImportError:
    def get_astrbot_config_path() -> str:
        return ""

PLUGIN_NAME = "astrbot_plugin_model_manager"


@register(
    "astrbot_plugin_model_manager",
    "NoFizz",
    "Unified LLM model configuration manager",
    "1.1.0",
)
class ModelManagerPlugin(Star):

    def __init__(self, context: Context, config: AstrBotConfig = None):
        super().__init__(context)
        self.config = config or {}

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
        context.register_web_api(
            f"/{PLUGIN_NAME}/language",
            self.api_get_language,
            ["GET"],
            "Get language setting",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/language",
            self.api_save_language,
            ["POST"],
            "Save language setting",
        )
        logger.info(f"[{PLUGIN_NAME}] v1.1 loaded")

    def _get_config_dir(self) -> pathlib.Path | None:
        try:
            raw = get_astrbot_config_path()
            if not raw:
                return None
            p = pathlib.Path(raw)
            if p.is_file() or p.suffix == ".json":
                return p.parent
            if p.is_dir():
                return p
            if p.parent.is_dir():
                return p.parent
        except Exception:
            pass
        return None

    def _get_plugins_dir(self) -> pathlib.Path | None:
        cfg_dir = self._get_config_dir()
        if cfg_dir:
            d = cfg_dir.parent / "plugins"
            if d.exists():
                return d
        return None

    def _read_plugin_display_name(self, plugin_dir: pathlib.Path) -> str:
        dir_name = plugin_dir.name
        i18n_file = plugin_dir / ".astrbot-plugin" / "i18n" / "zh-CN.json"
        if i18n_file.exists():
            try:
                data = json.loads(i18n_file.read_text(encoding="utf-8-sig"))
                dn = data.get("metadata", {}).get("display_name", "")
                if dn and dn != dir_name:
                    return dn
            except Exception:
                pass
        meta_file = plugin_dir / "metadata.yaml"
        if meta_file.exists():
            try:
                for line in meta_file.read_text(encoding="utf-8-sig").splitlines():
                    line = line.strip()
                    if line.startswith("display_name:"):
                        val = line.split(":", 1)[1].strip()
                        for ch in ("'", '"'):
                            val = val.strip(ch)
                        if val and val != dir_name:
                            return val
                        break
            except Exception:
                pass
        return ""

    def _find_provider_fields(self, schema: dict, prefix: str = "") -> list[dict]:
        results = []
        for key, value in schema.items():
            if not isinstance(value, dict):
                continue
            path = f"{prefix}.{key}" if prefix else key
            special = value.get("_special", "")
            if special in ("select_provider", "select_provider_tts", "select_provider_stt"):
                results.append({
                    "field_path": path,
                    "special_type": special,
                    "description": value.get("description", key),
                    "hint": value.get("hint", ""),
                })
            if value.get("type") == "object":
                results.extend(self._find_provider_fields(value.get("items", {}), path))
            if value.get("type") == "template_list":
                for tpl_name, tpl_def in value.get("templates", {}).items():
                    if isinstance(tpl_def, dict):
                        results.extend(
                            self._find_provider_fields(tpl_def.get("items", {}), f"{path}.__tpl__{tpl_name}")
                        )
        return results

    def _read_json_file(self, path: pathlib.Path) -> dict | None:
        if not path.exists():
            return None
        for enc in ("utf-8-sig", "utf-8"):
            try:
                return json.loads(path.read_text(encoding=enc))
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            except Exception:
                continue
        return None

    def _write_json_file(self, path: pathlib.Path, data: dict):
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def _get_nested_value(self, data: dict, field_path: str):
        parts = [p for p in field_path.split(".") if not p.startswith("__tpl__")]
        current = data
        for part in parts:
            if isinstance(current, dict):
                current = current.get(part)
            elif isinstance(current, list):
                if current and isinstance(current[0], dict):
                    current = current[0].get(part)
                else:
                    return None
            else:
                return None
        return current

    def _set_nested_value(self, data: dict, field_path: str, value):
        parts = field_path.split(".")
        self._set_recursive(data, parts, 0, value)

    def _set_recursive(self, current, parts, idx, value):
        if idx >= len(parts):
            return
        part = parts[idx]
        is_last = idx == len(parts) - 1
        if part.startswith("__tpl__"):
            if isinstance(current, list):
                for item in current:
                    if isinstance(item, dict):
                        self._set_recursive(item, parts, idx + 1, value)
            return
        if isinstance(current, dict):
            if is_last:
                current[part] = value
            else:
                nxt = current.get(part)
                if isinstance(nxt, list):
                    for item in nxt:
                        if isinstance(item, dict):
                            self._set_recursive(item, parts, idx + 1, value)
                elif isinstance(nxt, dict):
                    self._set_recursive(nxt, parts, idx + 1, value)

    def _scan_all_plugins(self) -> list[dict]:
        plugins_dir = self._get_plugins_dir()
        cfg_dir = self._get_config_dir()
        if not plugins_dir:
            return []
        results = []
        for plugin_dir in sorted(plugins_dir.iterdir()):
            if not plugin_dir.is_dir():
                continue
            schema_file = plugin_dir / "_conf_schema.json"
            if not schema_file.exists():
                continue
            schema = self._read_json_file(schema_file)
            if not schema:
                continue
            plugin_name = plugin_dir.name
            if plugin_name == PLUGIN_NAME:
                continue
            fields = self._find_provider_fields(schema)
            if not fields:
                continue
            display_name = self._read_plugin_display_name(plugin_dir)
            plugin_config = {}
            if cfg_dir:
                cf = cfg_dir / f"{plugin_name}_config.json"
                if cf.exists():
                    plugin_config = self._read_json_file(cf) or {}
            for field in fields:
                cv = self._get_nested_value(plugin_config, field["field_path"])
                results.append({
                    "plugin_name": plugin_name,
                    "display_name": display_name,
                    "field_path": field["field_path"],
                    "special_type": field["special_type"],
                    "description": field["description"],
                    "hint": field["hint"],
                    "current_value": cv or "",
                })
        return results

    def _get_all_providers(self) -> list[dict]:
        try:
            providers = self.context.get_all_providers()
            result = []
            for p in providers:
                pc = p.provider_config if hasattr(p, "provider_config") else {}
                pid = pc.get("id", "")
                if not pid:
                    continue
                result.append({
                    "id": pid,
                    "model": pc.get("model", "") or (getattr(p, "model", "") or ""),
                    "type": pc.get("type", "") or "",
                })
            if result:
                return result
        except Exception:
            pass
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
                if not data:
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
        cfg_dir = self._get_config_dir()
        if not cfg_dir:
            return False
        cf = cfg_dir / f"{plugin_name}_config.json"
        pc = self._read_json_file(cf)
        if pc is None:
            pc = {}
        self._set_nested_value(pc, field_path, new_value)
        self._write_json_file(cf, pc)
        return True

    async def api_get_all(self):
        try:
            settings = self._scan_all_plugins()
            return json_response({"status": "ok", "data": {"settings": settings, "total": len(settings)}})
        except Exception as e:
            logger.error(f"[{PLUGIN_NAME}] api_get_all: {e}", exc_info=True)
            return error_response(str(e))

    async def api_available_providers(self):
        try:
            providers = self._get_all_providers()
            return json_response({"status": "ok", "data": {"providers": providers}})
        except Exception as e:
            return error_response(str(e))

    async def api_update_provider(self):
        payload = await request.json(default={})
        pn, fp, val = payload.get("plugin_name", ""), payload.get("field_path", ""), payload.get("value", "")
        if not pn or not fp:
            return error_response("Missing plugin_name or field_path", status_code=400)
        try:
            if self._update_plugin_config(pn, fp, val):
                return json_response({"status": "ok", "data": {"updated": True}})
            return error_response("Write failed", status_code=500)
        except Exception as e:
            return error_response(str(e), status_code=500)

    async def api_batch_update(self):
        payload = await request.json(default={})
        updates = payload.get("updates", [])
        if not isinstance(updates, list):
            return error_response("updates must be a list", status_code=400)
        ok_count, fails = 0, []
        for item in updates:
            pn, fp, val = item.get("plugin_name", ""), item.get("field_path", ""), item.get("value", "")
            if not pn or not fp:
                fails.append("missing fields")
                continue
            try:
                if self._update_plugin_config(pn, fp, val):
                    ok_count += 1
                else:
                    fails.append(f"{pn}/{fp}")
            except Exception as e:
                fails.append(f"{pn}/{fp}: {e}")
        return json_response({"status": "ok", "data": {"success": ok_count, "failures": fails}})

    def _get_sort_order_file(self) -> pathlib.Path | None:
        cfg_dir = self._get_config_dir()
        if cfg_dir:
            return cfg_dir / f"{PLUGIN_NAME}_sort_order.json"
        return None

    def _read_sort_order(self) -> list[str]:
        f = self._get_sort_order_file()
        if f and f.exists():
            data = self._read_json_file(f)
            if isinstance(data, list):
                return data
        return []

    def _write_sort_order(self, order: list[str]):
        f = self._get_sort_order_file()
        if f:
            self._write_json_file(f, order)

    async def api_get_sort_order(self):
        try:
            order = self._read_sort_order()
            return json_response({"status": "ok", "data": {"order": order}})
        except Exception as e:
            return error_response(str(e))

    async def api_save_sort_order(self):
        payload = await request.json(default={})
        order = payload.get("order", [])
        if not isinstance(order, list):
            return error_response("order must be a list", status_code=400)
        try:
            self._write_sort_order(order)
            return json_response({"status": "ok", "data": {"saved": True}})
        except Exception as e:
            return error_response(str(e))

    def _get_language_file(self) -> pathlib.Path | None:
        cfg_dir = self._get_config_dir()
        if cfg_dir:
            return cfg_dir / f"{PLUGIN_NAME}_language.json"
        return None

    def _read_language(self) -> str:
        f = self._get_language_file()
        if f and f.exists():
            data = self._read_json_file(f)
            if isinstance(data, dict) and "lang" in data:
                return data["lang"]
        return "zh"

    def _write_language(self, lang: str):
        f = self._get_language_file()
        if f:
            self._write_json_file(f, {"lang": lang})

    async def api_get_language(self):
        try:
            lang = self._read_language()
            return json_response({"status": "ok", "data": {"lang": lang}})
        except Exception as e:
            return error_response(str(e))

    async def api_save_language(self):
        payload = await request.json(default={})
        lang = payload.get("lang", "zh")
        if lang not in ("zh", "en"):
            lang = "zh"
        try:
            self._write_language(lang)
            return json_response({"status": "ok", "data": {"saved": True}})
        except Exception as e:
            return error_response(str(e))
