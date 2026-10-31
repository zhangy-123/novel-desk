import { useMemo } from "react";
import { countWords } from "../lib/wordcount";

interface Props {
  content: string;
  sessionWords: number;
  saveState: "idle" | "pending" | "saved" | "error";
  lastSavedAt: Date | null;
}

/** 底部状态栏：实时字数 / 本次会话码字量 / 保存状态 */
export function StatsBar({ content, sessionWords, saveState, lastSavedAt }: Props) {
  const total = useMemo(() => countWords(content), [content]);

  const saveText = {
    idle: "就绪",
    pending: "保存中…",
    saved: `已保存 ${lastSavedAt ? lastSavedAt.toLocaleTimeString() : ""}`,
    error: "保存失败，将在下次输入时重试",
  }[saveState];

  return (
    <footer className="stats-bar">
      <span>全文 {total} 字</span>
      <span className="sep">|</span>
      <span>本次会话 +{sessionWords} 字</span>
      <span className="sep">|</span>
      <span className={saveState === "error" ? "error" : "muted"}>{saveText}</span>
    </footer>
  );
}
