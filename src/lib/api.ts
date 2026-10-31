/**
 * 与 Tauri 后端 (Rust) 通信的封装层。
 *
 * 关键设计：双模式运行
 *  - 在 Tauri App 内：走 invoke 调用 Rust 侧的 SQLite + 快照逻辑
 *  - 在纯浏览器 (npm run dev 调试) 中：自动降级为 localStorage mock，
 *    保证不装 Rust 也能开发调试 UI
 */

interface ChapterMeta {
  id: number;
  book_id: number;
  title: string;
  word_count: number;
  status: string;
  sort_order: number;
}

interface Chapter extends ChapterMeta {
  content: string;
}

interface Snapshot {
  id: number;
  chapter_id: number;
  content: string;
  created_at: string;
}

interface DailyStat {
  day: string;
  total: number;
}

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }
  return browserMock<T>(cmd, args);
}

/* ------------------------------------------------------------------ */
/* 浏览器降级 mock：用 localStorage 模拟同一套接口                      */
/* ------------------------------------------------------------------ */

const LS_KEY = "noveldesk_mock_db";

interface MockDB {
  chapters: Chapter[];
  snapshots: Snapshot[];
  nextId: number;
}

function loadMock(): MockDB {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as MockDB;
  } catch {
    /* fallthrough */
  }
  return {
    nextId: 2,
    chapters: [
      {
        id: 1,
        book_id: 1,
        title: "第一章 初雪",
        content: "",
        word_count: 0,
        status: "draft",
        sort_order: 0,
      },
    ],
    snapshots: [],
  };
}

function saveMock(db: MockDB): void {
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

function browserMock<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const db = loadMock();
  switch (cmd) {
    case "list_chapters":
      return Promise.resolve(
        db.chapters
          .filter((c) => c.book_id === (args?.book_id ?? 1))
          .map(({ content: _c, ...meta }) => meta) as T,
      );
    case "get_chapter": {
      const c = db.chapters.find((x) => x.id === args?.chapter_id);
      return c ? Promise.resolve(c as T) : Promise.reject("chapter not found");
    }
    case "create_chapter": {
      const c: Chapter = {
        id: db.nextId++,
        book_id: 1,
        title: (args?.title as string) ?? "未命名章节",
        content: "",
        word_count: 0,
        status: "draft",
        sort_order: db.chapters.length,
      };
      db.chapters.push(c);
      saveMock(db);
      return Promise.resolve(c as T);
    }
    case "update_chapter": {
      const c = db.chapters.find((x) => x.id === args?.chapter_id);
      if (!c) return Promise.reject("chapter not found");
      const oldContent = c.content;
      c.title = (args?.title as string) ?? c.title;
      c.content = (args?.content as string) ?? c.content;
      c.word_count = c.content.length;
      // 简化版快照：内容变化超过 200 字或距离上次快照超过 5 分钟
      const last = db.snapshots
        .filter((s) => s.chapter_id === c.id)
        .sort((a, b) => b.id - a.id)[0];
      const now = Date.now();
      const needSnapshot =
        !last ||
        Math.abs(c.content.length - last.content.length) > 200 ||
        now - new Date(last.created_at).getTime() > 5 * 60 * 1000;
      if (needSnapshot && oldContent !== c.content) {
        db.snapshots.push({
          id: db.snapshots.length + 1,
          chapter_id: c.id,
          content: oldContent,
          created_at: new Date().toISOString(),
        });
        if (db.snapshots.length > 200) db.snapshots = db.snapshots.slice(-200);
      }
      saveMock(db);
      return Promise.resolve({ ok: true, snapshotted: needSnapshot } as T);
    }
    case "list_snapshots":
      return Promise.resolve(
        db.snapshots
          .filter((s) => s.chapter_id === args?.chapter_id)
          .sort((a, b) => b.id - a.id)
          .slice(0, 20) as T,
      );
    case "get_stats":
      return Promise.resolve([] as T);
    default:
      return Promise.reject(`unknown command: ${cmd}`);
  }
}

/* ------------------------------------------------------------------ */
/* 导出的类型化 API                                                    */
/* ------------------------------------------------------------------ */

export type { ChapterMeta, Chapter, Snapshot, DailyStat };

export const api = {
  listChapters: (bookId: number) =>
    invoke<ChapterMeta[]>("list_chapters", { book_id: bookId }),

  getChapter: (chapterId: number) =>
    invoke<Chapter>("get_chapter", { chapter_id: chapterId }),

  createChapter: (title: string) =>
    invoke<Chapter>("create_chapter", { title }),

  /** 保存章节内容；Rust 侧自动判断是否写快照 */
  updateChapter: (chapterId: number, title: string, content: string) =>
    invoke<{ ok: boolean; snapshotted: boolean }>("update_chapter", {
      chapter_id: chapterId,
      title,
      content,
    }),

  listSnapshots: (chapterId: number) =>
    invoke<Snapshot[]>("list_snapshots", { chapter_id: chapterId }),

  getStats: (days: number) => invoke<DailyStat[]>("get_stats", { days }),
};
