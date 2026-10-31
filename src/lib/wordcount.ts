/**
 * 中文字数统计。
 * 规则：CJK 汉字每个算 1 字；连续的英文/数字串算 1 词。
 * 与网文平台的计费口径基本一致。
 */
export function countWords(text: string): number {
  if (!text) return 0;
  // 去掉编辑器节点残留（Tiptap content 传纯文本即可）
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0;
  const latinWords = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  return cjk + latinWords;
}
