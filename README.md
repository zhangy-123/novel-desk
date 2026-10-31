# NovelDesk — 本地优先的双端写作工具（MVP 脚手架）

对标橙瓜码字的**本地优先**写作 App 骨架：**Tauri 2 + React + Tiptap + SQLite**，
一套代码覆盖 Windows / macOS / Linux / iOS / Android。

## 已实现

- ✅ **章节管理**：左侧章节树，新建/切换章节（SQLite 存储，数据在系统应用目录 `novel.db`）
- ✅ **Tiptap 富文本编辑器**：StarterKit（标题/加粗/列表），仿纸张居中排版
- ✅ **三层防丢稿**：
  1. 前端 800ms 防抖自动保存（`src/hooks/useAutosave.ts`）
  2. Rust 侧自动快照：字数变化 ≥200 或距上次快照 ≥5 分钟时留旧版，每章滚动保留 50 份
  3. 切后台/关窗强制 flush（`visibilitychange` / `beforeunload`）
- ✅ **历史版本（快照）面板**：查看 + 一键恢复
- ✅ **码字统计**：实时字数（CJK 口径）、本次会话增量、保存状态；`word_count_log` 表已备好日/周曲线数据
- ✅ **移动端样式适配**（侧栏收纳为顶部条，触控友好）
- ✅ **导出与备份**：全书导出 Markdown / 全量 JSON 备份 / 从备份导入恢复（`src/lib/backup.ts`）
- ✅ **纯浏览器调试模式**：不装 Rust 也能 `npm run dev` 开发 UI（自动降级 localStorage mock）
- ✅ **GitHub Actions 云编译**：`.github/workflows/build.yml`，一键出 Win/macOS/Linux 安装包

## 运行

### 方式一：纯前端调试（无需 Rust）

```bash
npm install
npm run dev        # 打开 http://localhost:1420，数据存 localStorage
```

### 方式二：云编译出安装包（当前采用，本地无需 Rust / VS Build Tools）

本地只负责写代码和预览，编译交给 GitHub 的免费服务器：

```bash
# 1. 本地预览（浏览器模式，数据存 localStorage）
npm run dev

# 2. 推到 GitHub（首次）
git remote add origin https://github.com/<你的账号>/<仓库名>.git
git branch -M main
git push -u origin main

# 3. 触发云编译（二选一）
#   a) GitHub 页面：Actions → Build Desktop Apps → Run workflow
#   b) 打 tag 自动触发：
git tag v0.1.0 && git push --tags

# 4. 约 6-10 分钟后：Actions 运行详情页底部 Artifacts 下载
#    novel-desk-windows-latest.zip → 内含 .msi（安装包）/ .exe（绿色版）
#    novel-desk-macos-latest.zip   → 内含 .dmg
#    novel-desk-ubuntu-22.04.zip   → 内含 .deb / .AppImage
```

注意：
- 工作流文件在 `.github/workflows/build.yml`，**仓库根目录必须是 `novel-desk` 这一层**（即 `package.json` 在根）
- 产物**未做代码签名**：Windows 首次运行会被 SmartScreen 拦（点"更多信息 → 仍要运行"）；macOS 需右键 → 打开，并执行 `xattr -dr com.apple.quarantine /Applications/NovelDesk.app`
- 云编译同时充当编译检查：Rust 代码有语法错误会在 Actions 日志里直接看到

### 附：本地编译（需要 Rust，占 6-8 GB，本方案已跳过）

```bash
# 安装 Rust（Windows 需再装 Visual Studio C++ Build Tools）
# https://rustup.rs
npm run tauri dev     # 开发模式
npm run tauri build   # 打包
```

### 方式三：移动端

```bash
npm run tauri android init   # 需 Android Studio + SDK
npm run tauri ios init       # 需 macOS + Xcode
npm run tauri android dev
```

## 项目结构

```
novel-desk/
├── src/                        # 前端 (React + TS)
│   ├── App.tsx                 # 主布局：侧栏 + 编辑器 + 状态栏
│   ├── editor/NovelEditor.tsx  # Tiptap 封装（key 重挂载切章）
│   ├── hooks/useAutosave.ts    # 防抖保存 + 快照 + flush（防丢稿核心）
│   ├── lib/api.ts              # Tauri invoke 封装 + 浏览器 mock 降级
│   ├── lib/wordcount.ts        # 中文字数统计（CJK 口径）
│   └── components/             # Sidebar / SnapshotPanel / StatsBar
└── src-tauri/                  # 后端 (Rust)
    ├── src/lib.rs              # SQLite 表结构 + 全部 Tauri commands + 快照逻辑
    └── tauri.conf.json         # 窗口/打包配置
```

## 数据库表

`books` / `chapters` / `snapshots`（历史版本） / `word_count_log`（码字流水） / `characters`（人物卡，预留）

## 路线图（建议顺序）

1. 卷 → 章两级树、拖拽排序
2. 大纲 / 人物卡 UI（表已建好）
3. 专注模式（桌面全屏 + 移动端 wakelock）
4. 同步：个人用直接 Syncthing 同步数据目录；做产品再上 cr-sqlite (CRDT)
5. 导出 Markdown / TXT / DOCX（Rust 侧或前端生成均可）
6. 敏感词检测（Rust `aho-corasick` + 本地词库）
