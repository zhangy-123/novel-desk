import { api, type ChapterMeta, type Snapshot } from "../lib/api";
import { countWords } from "../lib/wordcount";
import { useState } from "react";

interface Props {
  chapters: ChapterMeta[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onCreate: (title: string) => void;
}

/** 左侧章节树（MVP 为单卷平铺，后续可扩展 卷 → 章 两级） */
export function Sidebar({ chapters, activeId, onSelect, onCreate }: Props) {
  const [newTitle, setNewTitle] = useState("");

  return (
    <aside className="sidebar">
      <div className="sidebar-header">章节目录</div>
      <div className="chapter-list">
        {chapters.map((c) => (
          <div
            key={c.id}
            className={`chapter-item ${c.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(c.id)}
          >
            <span className="chapter-title">{c.title}</span>
            <span className="chapter-words">{c.word_count} 字</span>
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        <input
          value={newTitle}
          placeholder="新章节标题"
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newTitle.trim()) {
              onCreate(newTitle.trim());
              setNewTitle("");
            }
          }}
        />
        <button
          onClick={() => {
            if (newTitle.trim()) {
              onCreate(newTitle.trim());
              setNewTitle("");
            }
          }}
        >
          ＋ 新建
        </button>
      </div>
    </aside>
  );
}

interface SnapshotProps {
  chapterId: number | null;
  onRestore: (content: string) => void;
}

/** 历史快照面板：查看/一键恢复旧版本（防丢稿的"后悔药"） */
export function SnapshotPanel({ chapterId, onRestore }: SnapshotProps) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (chapterId == null) return;
    setSnapshots(await api.listSnapshots(chapterId));
    setOpen((v) => !v);
  };

  return (
    <div className="snapshot-panel">
      <button onClick={() => void load()} disabled={chapterId == null}>
        {open ? "收起历史版本" : "历史版本（快照）"}
      </button>
      {open && (
        <ul>
          {snapshots.length === 0 && <li className="muted">暂无快照</li>}
          {snapshots.map((s) => (
            <li key={s.id}>
              <span>
                {new Date(s.created_at).toLocaleString()} · {countWords(s.content)} 字
              </span>
              <button onClick={() => onRestore(s.content)}>恢复</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
