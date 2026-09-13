import type { SentenceAnalysis } from "../shared/types";

export function formatAnalysisForNotes(result: SentenceAnalysis): string {
  const lines = [
    `原句：${result.original}`,
    `翻译：${result.translation}`,
    "",
    "结构：",
    ...result.structure.map((item) => `- ${item}`),
    "",
    "词汇："
  ];
  if (result.vocabulary.length === 0) lines.push("- 本句没有需要特别解释的 B2 及以上词汇");
  result.vocabulary.slice(0, 4).forEach((item, index) => {
    lines.push(`${index + 1}. ${item.word} [${item.level}]：${item.meaning}`);
    lines.push(`   例句：${item.example}`);
  });
  lines.push("", "短语：");
  if (result.phrases.length === 0) lines.push("- 本句没有需要特别解释的重要短语");
  result.phrases.slice(0, 4).forEach((item, index) => {
    lines.push(`${index + 1}. ${item.phrase}：${item.meaning}`);
    lines.push(`   例句：${item.example}`);
  });
  return lines.join("\n");
}
