# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-08-12

### Added

- Auto-reload modified plugins after config write — changes take effect immediately without manual plugin reload or AstrBot restart
- `_reload_plugins` method calls `PluginManager.reload(plugin_name)` via `context._star_manager`; gracefully degrades if unavailable
- `reloaded` field in `update` / `batch` API responses reporting per-plugin reload status
- `reloadPartial` i18n key for reload-failure toast messages
- `buildBatchToast` helper unifying toast message construction across all three batch paths (save / quick-switch / set-all)
- `CHANGELOG.md` with full project history from v1.0.0

### Changed

- Color system fully aligned to Bilibili official color card (v1.4) — light mode `--bg` `#F1F2F3` → `#FFFFFF`, `--primary-hover` `#00A1E9` → `#40C5F1`, brand pink `#FB7299` → `#FF6699`; dark mode uses official independent design values (`--bg` `#1A1A1A` → `#17181A`, `--primary` `#4FB8DE` → `#0087BD`, `--accent` `#FC9EB9` → `#D44E7D`, status colors, borders, shadows, text colors all updated)
- Provider discovery fallback #2: `pmgr.chat_providers` (nonexistent attribute) → `pmgr.provider_insts` (correct `list[Provider]`), with dual-type `provider_config` handling matching tier 1
- `_read_sort_order` merged into `_scan_all_plugins_sync` — single `to_thread` call, cached results are pre-sorted, no redundant file read on cache hit
- `api_update_provider`: `cfg_dir` acquisition moved inside `_write_lock` to eliminate race window
- Backend `error_response` messages unified to English for consistency
- README updated with "instant effect" documentation and auto-reload behavior

### Fixed

- `movePlugin` no longer wipes the persisted hidden-plugins list — was POSTing `{order}` without `hidden`, causing data loss; now routes through `scheduleSidebarPersist` (includes `order + hidden`, debounced, in-flight guarded)
- Concurrent writers to `save-sort-order` race condition resolved — `movePlugin` and `persistSidebar` now share a single debounced persistence path
- Batch write failure no longer double-counts fields that already failed at `_set_nested_value` stage — write-error entries only for fields that actually succeeded
- Dialog error paths now refresh preview via `loadAll()` + `updateSwitchPreview()` / `updateSetAllPreview()` to prevent stale-data re-submission
- Orphaned `.tmp.*` files cleaned before each write (prevents accumulation from process crashes mid-write)

### Removed

- Manual `?v=1.4.1` cache-busting on `app.js` / `style.css` (managed by AstrBot `asset_token`)
- Dead i18n keys `sortSaved` / `sortFailed` (no longer used after `movePlugin` rewrite)
- Dead variable `prevOrder` in `movePlugin` (rollback logic removed with direct-save path)

## [1.4.1] - 2026-08-02

### Changed

- Restructured README per 15-point writing spec with table of contents
- Rewrote README header and features section
- Declared `pyyaml` as an explicit runtime dependency in `requirements.txt`
- Removed `astrbot_version` and `support_platforms` annotations from `metadata.yaml`

### Fixed

- Accent button text stays white in dark mode (was turning black)
- Sidebar toggle button dims to muted pink in dark mode (was glaring bright pink)

## [1.4.0] - 2026-08-02

### Added

- Two-line plugin titles: display name (serif) + full plugin id (muted small text)
- Source Han Serif / Source Han Sans dual-font typography system
- Centered sticky card-style header bar with backdrop blur
- Light/dark mode screenshots in README
- Sidebar navigation with plugin jump, hide/show (eye toggle), and drag-to-reorder
- Plugin sort order + hidden list persistence to `{PLUGIN_NAME}_sort_order.json`
- Dangling-model warning style for fields whose saved provider no longer exists
- Force-refresh button to bypass the 30-second scan cache
- Frontend consistency check script (`tests/check_frontend.mjs`)

### Fixed

- Async-blocking I/O: all filesystem operations now run via `asyncio.to_thread`
- Payload validation: non-dict request bodies now return HTTP 400 instead of 500
- YAML display-name parsing replaced fragile hand-written parser with PyYAML
- Atomic JSON writes (tmp file + rename) to prevent corruption on interruption

## [1.2.4] - 2026-07-31

### Changed

- Unified README per writing convention (flat badges, Python badge, view counter)

## [1.2.3] - 2026-07-30

### Fixed

- Button state management and cache issues

### Changed

- Updated installation instructions to use plugin market source

## [1.2.1] - 2026-07-25

### Changed

- Removed i18n English support and simplified display name lookup
- Cleaned up unnecessary files (`__pycache__`, `en-US.json`)

### Fixed

- Bug fixes and security improvements

## [1.1.0] - 2026-06-25

### Added

- Quick Switch (single replace) feature: replace all fields using one model with another
- Set All feature: set all model fields to a single model in one operation
- Plugin sort order feature with up/down buttons and persistence
- i18n support with Chinese/English toggle
- Info message on settings page

### Changed

- License changed to AGPL-3.0
- Language button uses Unicode globe icon
- Config item labels and status dot colors updated

## [1.0.0] - 2026-06-22

### Added

- Initial release
- Unified model configuration manager WebUI page
- Scans all plugins' `_conf_schema.json` for `select_provider*` fields
- Centralized view and modification of LLM model assignments
- Atomic config file writes with `asyncio.Lock` serialization
- 3-tier provider discovery fallback chain
- Input sanitization with path traversal prevention
