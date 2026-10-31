import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Chapter, type ChapterMeta } from "./lib/api";
import { NovelEditor } from "./editor/NovelEditor";
import { Sidebar, SnapshotPanel } from "./components/Sidebar";
import { StatsBar } from "./components/StatsBar";
import { useAutosave } from "./hooks/useAutosave";
import { exportBackup, exportMarkdown, importBackup } from "./lib/backup";

export default function App() {
  const [chapters, setChapters] = useState<ChapterMeta[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  // 编辑器实时文本（供底栏字数统计）
  const [liveText, setLiveText] = useState("");
  // 快照恢复时强制编辑器重挂载
  const [restoreNonce, setRestoreNonce] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshChapters = useCallback(async () => {
    const list = await api.listChapters(1);
    setChapters(list);
    return list;
  }, []);

  // 初始化：加载章节列表，默认打开第一章
  useEffect(() => {
    (async () => {
      const list = await refreshChapters();
      if (list.length > 0) setActiveId(list[0].id);
    })();
  }, [refreshChapters]);

  // 切章时加载完整内容
  useEffect(() => {
    if (activeId == null) return;
    (async () => {
      setChapter(null); // 先清空避免旧内容闪烁
      setChapter(await api.getChapter(activeId));
    })();
  }, [activeId]);

  const { scheduleSave, saveState, lastSavedAt, sessionWords } = useAutosave(
    activeId,
    chapter?.title ?? "",
  );

  const handleCreate = useCallback(
    async (title: string) => {
      const c = await api.createChapter(title);
      await refreshChapters();
      setActiveId((c as unknown as { id: number }).id);
    },
    [refreshChapters],
  );

  return (
    <div className="app">
      <Sidebar
        chapters={chapters}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={(t) => void handleCreate(t)}
      />
      <main className="main">
        <header className="main-header">
          <h1>{chapter?.title ?? "…"}</h1>
          <div className="toolbar">
            <SnapshotPanel
              chapterId={activeId}
              onRestore={(content) => {
                // 恢复快照 = 用旧内容重挂载编辑器，并立即安排保存
                setChapter((c) => (c ? { ...c, content } : c));
                setRestoreNonce((n) => n + 1);
                setLiveText(content);
                scheduleSave(content);
              }}
            />
            <button onClick={() => void exportMarkdown()}>导出全书 MD</button>
            <button onClick={() => void exportBackup()}>备份 JSON</button>
            <button onClick={() => fileInputRef.current?.click()}>导入备份</button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const n = await importBackup(f);
                  await refreshChapters();
                  alert(`已导入 ${n} 章`);
                } catch (err) {
                  alert(`导入失败：${(err as Error).message}`);
                } finally {
                  e.target.value = "";
                }
              }}
            />
          </div>
        </header>
        {chapter && activeId != null ? (
          <NovelEditor
            key={`${activeId}-${restoreNonce}`}
            content={chapter.content}
            onUpdate={(t) => {
              setLiveText(t);
              scheduleSave(t);
            }}
          />
        ) : (
          <div className="editor-empty">在左侧新建或选择一个章节</div>
        )}
        <StatsBar
          content={liveText || chapter?.content || ""}
          sessionWords={sessionWords}
          saveState={saveState}
          lastSavedAt={lastSavedAt}
        />
      </main>
    </div>
  );
}
