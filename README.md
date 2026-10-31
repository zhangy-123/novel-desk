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
- ✅ **纯浏览器调试模式**：不装 Rust 也能 `npm run dev` 开发 UI（自动降级 localStorage mock）

## 运行

### 方式一：纯前端调试（无需 Rust）

```bash
npm install
npm run dev        # 打开 http://localhost:1420，数据存 localStorage
```

### 方式二：完整桌面 App（需先安装 Rust）

```bash
# 1. 安装 Rust（Windows 需再装 Visual Studio C++ Build Tools）
#    https://rustup.rs

# 2. 启动开发模式（首次编译约 3-10 分钟）
npm run tauri dev

# 3. 打包安装包（.msi / .exe / .dmg / .deb）
npm run tauri build
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
