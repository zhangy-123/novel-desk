import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

interface Props {
  content: string;
  onUpdate: (text: string) => void;
}

/**
 * Tiptap 编辑器封装。
 * - 父组件用 key={chapterId} 控制重挂载：切章节 = 全新编辑器实例，
 *   避免 setContent 与光标状态打架（比 effect 里 setContent 更稳）
 * - StarterKit 自带标题/加粗/列表等基础格式
 * - onUpdate 里取 editor.getText() 传给自动保存 hook
 */
export function NovelEditor({ content, onUpdate }: Props) {
  const editor = useEditor({
    extensions: [StarterKit],
    content,
    editorProps: {
      attributes: {
        class: "novel-editor",
        "data-placeholder": "开始码字…",
      },
    },
    onUpdate: ({ editor }) => {
      onUpdate(editor.getText());
    },
  });

  return <EditorContent editor={editor} className="editor-container" />;
}
