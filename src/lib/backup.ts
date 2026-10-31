import { api, type ChapterMeta } from "./api";

/**
 * 备份 / 导出 / 恢复。
 *
 * 为什么网页版必须有这个：
 * localStorage 模式的数据存在浏览器里，清除浏览数据、换浏览器、换电脑都会丢稿。
 * 这里提供一键全量导出（JSON 备份 + Markdown 全文），以及从备份恢复。
 *
 * 实现上只依赖 api.listChapters / getChapter / createChapter / updateChapter，
 * 因此 Tauri 后端与浏览器 mock 两种模式通用，不需要额外 Rust 命令。
 */

interface BackupItem {
  title: string;
  content: string;
}

/** Tauri 侧 Chapter 用 serde flatten（字段平铺），mock 侧也是平铺，两种形态统一读取 */
interface FlatChapter {
  id?: number;
  title?: string;
  content?: string;
  meta?: { id: number; title: string };
}

function flatId(c: FlatChapter): number {
  return c.meta?.id ?? c.id ?? 0;
}

function flatTitle(c: FlatChapter, fallback: string): string {
  return c.meta?.title ?? c.title ?? fallback;
}

interface BackupFile {
  app: "novel-desk";
  version: 1;
  exported_at: string;
  chapters: BackupItem[];
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // 稍后释放，避免 Safari 下载中断
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 导出全量 JSON 备份（可再导入恢复） */
export async function exportBackup(bookId = 1): Promise<void> {
  const metas: ChapterMeta[] = await api.listChapters(bookId);
  const chapters: BackupItem[] = [];
  for (const m of metas) {
    const full = (await api.getChapter(m.id)) as unknown as FlatChapter;
    chapters.push({ title: flatTitle(full, m.title), content: full.content ?? "" });
  }
  const data: BackupFile = {
    app: "novel-desk",
    version: 1,
    exported_at: new Date().toISOString(),
    chapters,
  };
  download(`novel-desk-backup-${stamp()}.json`, JSON.stringify(data, null, 2), "application/json");
}

/** 导出全书为 Markdown（可直接喂给 Word / 出版社） */
export async function exportMarkdown(bookId = 1): Promise<void> {
  const metas = await api.listChapters(bookId);
  const parts: string[] = [];
  for (const m of metas) {
    const full = (await api.getChapter(m.id)) as unknown as FlatChapter;
    parts.push(`# ${m.title}\n\n${full.content ?? ""}\n`);
  }
  download(`novel-desk-${stamp()}.md`, parts.join("\n---\n\n"), "text/markdown;charset=utf-8");
}

/** 从 JSON 备份恢复：逐章新建后写入内容 */
export async function importBackup(file: File): Promise<number> {
  const text = await file.text();
  const data = JSON.parse(text) as BackupFile;
  if (data.app !== "novel-desk" || !Array.isArray(data.chapters)) {
    throw new Error("不是有效的 NovelDesk 备份文件");
  }
  let count = 0;
  for (const ch of data.chapters) {
    const created = (await api.createChapter(ch.title || "导入章节")) as unknown as FlatChapter;
    await api.updateChapter(flatId(created), ch.title, ch.content ?? "");
    count++;
  }
  return count;
}
