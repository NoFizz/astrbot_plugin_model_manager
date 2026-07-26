# astrbot_plugin_model_manager

<p align="center">
  <img src="logo.png" width="128" height="128" alt="astrbot_plugin_model_manager logo">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.2.2-blue" alt="version">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-green" alt="license">
  <img src="https://img.shields.io/badge/AstrBot->=4.26.0-orange" alt="AstrBot version">
</p>

统一管理所有插件的 LLM 模型配置，支持快速替换、全部设置、插件排序、中英文切换。

## 功能特性

- **集中展示**：自动扫描所有已安装插件的模型配置项，在一个页面全部列出，并显示当前分配的模型
- **直接修改**：在每个下拉框里选择模型，批量保存
- **快速替换**：把所有正在使用"旧模型"的配置项，一键换成"新模型"
- **全部设置**：一键把所有配置项都设为同一个模型
- **插件排序**：自定义插件的显示顺序，并自动记住
- **跟随语言**：界面语言自动跟随 AstrBot WebUI 的语言设置（中文 / English）

## 安装

### 方法一：通过 AstrBot WebUI 安装（推荐）

1. 打开 AstrBot WebUI → 插件管理 → 新增插件。
2. 选择 **从 GitHub 安装**。
3. 填入仓库地址：
   ```
   https://github.com/NoFizz/astrbot_plugin_model_manager
   ```
4. 等待安装完成，确认插件已启用。

### 方法二：手动安装

1. 将本仓库克隆或下载到 AstrBot 的插件目录：
   ```bash
   cd AstrBot/data/plugins
   git clone https://github.com/NoFizz/astrbot_plugin_model_manager.git
   ```
2. 在 AstrBot WebUI 中重载插件，或重启 AstrBot。

### 安装后检查

- 在 WebUI 插件管理中确认插件状态为"已启用"且无报错。
- 进入插件详情页，确认 Model Manager 页面可正常打开。

## 配置说明

本插件无需额外配置，安装即用。所有操作通过 WebUI Page 完成。

**工作原理**：插件会自动扫描所有已安装插件的 `_conf_schema.json`，找出带有 `_special: select_provider*` 标记的配置项（即模型选择器），将它们集中展示在 Model Manager 页面中。修改后直接写入对应插件的配置文件，无需改动任何插件代码。

## 使用示例

1. 进入本插件的详情页，打开 **Model Manager** 页面
2. 页面会自动扫描并列出所有插件的模型配置项
3. 在每个下拉框中选择想分配的模型
4. 点击右上角 **保存**，一次性保存所有修改

### 快速替换

点击 **快速替换**：先选「当前模型」，再选「新模型」，即可把所有使用当前模型的配置项一次性替换为新模型。适合整体迁移到某个新模型的场景。

### 全部设置

点击 **全部设置**：选择一个目标模型，即可把所有配置项统一设为该模型。

### 插件排序

点击插件卡片左侧的 **▲ / ▼** 按钮调整显示顺序，排序会自动保存。

### 语言

界面语言跟随 AstrBot WebUI 的全局语言设置。在 WebUI **设置** 中切换语言后，本页面会自动切换，无需刷新。

## 许可证

本项目基于 [AGPL-3.0](LICENSE) 许可证开源。

## 作者

**NoFizz** · [GitHub](https://github.com/NoFizz)

如遇问题或有功能建议，欢迎提交 [Issue](https://github.com/NoFizz/astrbot_plugin_model_manager/issues)。
