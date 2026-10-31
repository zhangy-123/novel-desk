import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { countWords } from "../lib/wordcount";

/**
 * 自动保存 + 快照 hook —— 本项目的"防丢稿"核心。
 *
 * 三层保护：
 *  1. 防抖保存：停止输入 800ms 后写库（避免每个按键都打一次 SQLite）
 *  2. 快照：保存时若 Rust 侧判定需要（间隔/字数变化阈值），自动留一份旧版快照
 *  3. 强制 flush：切后台 / 关闭窗口 / 组件卸载前立即保存，不丢最后一个字
 *
 * 返回 saveState 让 UI 显示"已保存 / 保存中…"状态。
 */
export function useAutosave(chapterId: number | null, title: string) {
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saved" | "error">(
    "idle",
  );
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [sessionWords, setSessionWords] = useState(0);

  // 用 ref 持有最新内容，避免闭包过期
  const contentRef = useRef<string>("");
  const sessionBaseWordsRef = useRef<number>(0);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSave = useCallback(async () => {
    if (chapterId == null || !dirtyRef.current) return;
    dirtyRef.current = false;
    setSaveState("pending");
    try {
      await api.updateChapter(chapterId, title, contentRef.current);
      setSaveState("saved");
      setLastSavedAt(new Date());
      setSessionWords(
        Math.max(0, countWords(contentRef.current) - sessionBaseWordsRef.current),
      );
    } catch (e) {
      // 保存失败时恢复脏标记，下次重试
      dirtyRef.current = true;
      setSaveState("error");
      console.error("[autosave] 保存失败", e);
    }
  }, [chapterId, title]);

  /** 编辑器 onUpdate 调用：记录内容并安排防抖保存 */
  const scheduleSave = useCallback(
    (content: string) => {
      contentRef.current = content;
      dirtyRef.current = true;
      setSaveState("pending");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void doSave();
      }, 800);
    },
    [doSave],
  );

  /** 切换章节时重置会话统计基准 */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (chapterId == null) return;
      const ch = await api.getChapter(chapterId);
      if (cancelled) return;
      contentRef.current = ch.content;
      sessionBaseWordsRef.current = countWords(ch.content);
      setSessionWords(0);
      setSaveState("idle");
    })();
    return () => {
      cancelled = true;
    };
  }, [chapterId]);

  /** 强制 flush：页面隐藏、关闭、卸载时同步保存 */
  useEffect(() => {
    const flush = () => {
      if (!dirtyRef.current || chapterId == null) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      // 页面即将隐藏时只能用同步方式尽力保存（浏览器 fetch 异步），
      // Tauri 环境下 invoke 也可能被中断，因此 Rust 侧另有快照兜底
      dirtyRef.current = false;
      void api
        .updateChapter(chapterId, title, contentRef.current)
        .catch((e) => console.error("[autosave] flush 失败", e));
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("beforeunload", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [chapterId, title]);

  return { scheduleSave, saveState, lastSavedAt, sessionWords };
}
