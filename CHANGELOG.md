# Changelog

## [1.5.0] - 2026-08-12

### Added

- 保存配置后自动热重载被修改的插件，改动即时生效，无需手动重载插件或重启 AstrBot
- 新增 `_reload_plugins` 方法，通过 `context._star_manager` 调用 `PluginManager.reload`；不可用时优雅降级
- `update` / `batch` API 响应新增 `reloaded` 字段，报告每个插件的重载状态
- 新增 `reloadPartial` i18n 键，用于重载失败的 toast 提示
- 新增 `buildBatchToast` 辅助函数，统一三条批量路径（保存 / 单独替换 / 一键设置）的 toast 消息构造
- 创建 `CHANGELOG.md`，记录从 v1.0.0 起的完整变更历史

### Changed

- 配色全量对齐 Bilibili 官方色卡——浅色 `--bg` `#F1F2F3` → `#FFFFFF`、`--primary-hover` `#00A1E9` → `#40C5F1`、品牌粉 `#FB7299` → `#FF6699`；深色使用官方独立设计值（`--bg` `#1A1A1A` → `#17181A`、`--primary` `#4FB8DE` → `#0087BD`、`--accent` `#FC9EB9` → `#D44E7D`，状态色、边框、阴影、文字色全部更新）
- Provider 降级第 2 层从不存在的 `pmgr.chat_providers` 改为正确的 `pmgr.provider_insts`（`list[Provider]`），处理逻辑与第 1 层一致
- `_read_sort_order` 合并进 `_scan_all_plugins_sync`，单次 `to_thread` 调用，缓存结果已排序，缓存命中时不再重复读取排序文件
- `api_update_provider` 的 `cfg_dir` 获取移入 `_write_lock` 内，消除竞态窗口
- 后端 `error_response` 文案统一为英文
- README 新增"即时生效"说明及自动重载机制文档

### Fixed

- 修复 `movePlugin` 清空隐藏列表的数据丢失问题——原仅 POST `{order}` 不含 `hidden`，现统一走 `scheduleSidebarPersist`（含 `order + hidden`，防抖 + 在途保护）
- 修复 `save-sort-order` 并发写入竞态——`movePlugin` 与 `persistSidebar` 现共享单条防抖持久化路径
- 修复批量写入失败时重复报告已失败字段的问题——写入错误仅报告实际成功设置的字段
- 修复对话框错误后预览陈旧导致可基于过期数据重复提交的问题——错误路径增加 `loadAll()` + `updateSwitchPreview()` / `updateSetAllPreview()` 刷新
- 修复进程崩溃遗留的 `.tmp.*` 孤儿文件——写入前自动清理同 stem 的临时文件

### Removed

- 移除 `app.js` / `style.css` 上的手动 `?v=` 缓存破坏（由 AstrBot `asset_token` 管理）
- 移除死键 `sortSaved` / `sortFailed`（`movePlugin` 重写后不再使用）
- 移除 `movePlugin` 中的死变量 `prevOrder`（回滚逻辑已随直存路径移除）

## [1.4.1] - 2026-08-02

### Changed

- 按 15 点规范重写 README 结构并添加目录
- 重写 README 头部与功能介绍
- 在 `requirements.txt` 中显式声明 `pyyaml` 运行时依赖
- 从 `metadata.yaml` 中移除 `astrbot_version` 和 `support_platforms`

### Fixed

- 深色模式下强调色按钮文字保持白色（原会变黑）
- 侧边栏开关按钮在深色模式下使用灰暗色调（原为刺眼亮粉）

## [1.4.0] - 2026-08-02

### Added

- 两行插件标题：显示名（宋体）+ 完整插件 ID（灰色小字）
- 思源宋体 / 思源黑体双字体排版系统
- 居中 sticky 卡片式页头（毛玻璃效果）
- README 中新增浅色 / 深色模式截图
- 侧边栏导航：插件跳转、隐藏 / 显示（眼睛切换）、拖拽排序
- 插件排序 + 隐藏列表持久化到 `{PLUGIN_NAME}_sort_order.json`
- 悬空模型警告样式（保存的值在 provider 列表中不存在时高亮）
- 强制刷新按钮，绕过 30 秒扫描缓存
- 前端一致性检查脚本（`tests/check_frontend.mjs`）

### Fixed

- 异步阻塞 I/O：所有文件系统操作改用 `asyncio.to_thread`
- 请求体验证：非 dict 请求体返回 HTTP 400 而非 500
- YAML 显示名解析改用 PyYAML（替代脆弱的手写解析器）
- 原子 JSON 写入（临时文件 + rename），防止写入中断导致损坏

## [1.2.4] - 2026-07-31

### Changed

- 按书写规范统一 README（扁平徽章、Python 徽章、浏览量统计）

## [1.2.3] - 2026-07-30

### Fixed

- 按钮状态管理与缓存问题

### Changed

- 更新安装方式为插件市场源安装

## [1.2.1] - 2026-07-25

### Changed

- 移除 i18n 英文支持，简化显示名查找
- 清理不必要的文件（`__pycache__`、`en-US.json`）

### Fixed

- Bug 修复与安全改进

## [1.1.0] - 2026-06-25

### Added

- 单独替换功能：把所有使用某模型的配置项一次性替换为新模型
- 一键设置功能：将所有配置项统一设为同一个模型
- 插件排序功能（上移 / 下移按钮 + 持久化）
- 中英文切换的 i18n 支持
- 设置页面信息提示

### Changed

- 许可证改为 AGPL-3.0
- 语言按钮使用 Unicode 地球图标
- 更新配置项标签与状态点颜色

## [1.0.0] - 2026-06-22

### Added

- 初始版本
- 统一模型配置管理 WebUI 页面
- 扫描所有插件的 `_conf_schema.json` 中 `select_provider*` 字段
- 集中查看和修改 LLM 模型分配
- 原子配置文件写入（`asyncio.Lock` 序列化）
- 3 层 provider 发现降级链
- 输入消毒与路径遍历防护
