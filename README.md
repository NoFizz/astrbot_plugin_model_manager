# astrbot_plugin_model_manager

**统一模型管理器** — 一站式管理 AstrBot 所有插件的 LLM 模型配置。

## 功能

- **扫描**：自动扫描所有已安装插件的 `_conf_schema.json`，识别 `select_provider` 类型的配置项
- **展示**：在一个页面集中列出所有插件的模型选择配置及其当前值
- **修改**：直接在下拉框中切换模型，支持批量保存
- **零侵入**：无需修改任何其他插件代码，通过读写配置文件实现

## 安装

### 通过 AstrBot 插件市场

在 WebUI 插件市场搜索"模型管理器"直接安装。

### 手动安装

```bash
cd AstrBot/data/plugins
git clone https://github.com/NoFizz/astrbot_plugin_model_manager.git
```

然后在 WebUI 插件管理页面刷新并启用即可。

## 使用方法

1. 在插件详情页打开 **Model Manager** 页面
2. 页面自动扫描并列出所有插件的模型配置项
3. 在每个下拉框中选择想要分配的模型
4. 点击 **Save** 批量保存修改

## 技术栈

- Python / AstrBot Star API
- 前端：原生 JavaScript Module + CSS
- 遵循 AstrBot Plugin Pages 官方规范

## 版本

**当前版本**：v1.1.0

## 作者

NoFizz

## 许可证

MIT
