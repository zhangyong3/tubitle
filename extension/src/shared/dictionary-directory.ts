export interface DictionaryDirectoryBundle {
  directoryName: string;
  mdx: File;
  css?: File;
  mddFiles: File[];
}

export function selectDictionaryDirectoryFiles(files: File[]): DictionaryDirectoryBundle {
  const mdxFiles = files.filter((file) => file.name.toLowerCase().endsWith(".mdx"));
  if (mdxFiles.length === 0) throw new Error("所选目录中没有找到 MDX 文件");
  const mdx = [...mdxFiles].sort((left, right) => right.size - left.size)[0]!;
  const css = selectMatchingCss(mdx, files.filter((file) => file.name.toLowerCase().endsWith(".css")));
  const mddFiles = files
    .filter((file) => file.name.toLowerCase().endsWith(".mdd"))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
  const allSelected = [mdx, ...(css ? [css] : []), ...mddFiles];
  if (allSelected.some((file) => file.size === 0)) throw new Error("词典目录中包含空文件");
  const relativePath = (mdx as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
  return {
    directoryName: relativePath.split("/")[0] || "已选择的词典目录",
    mdx,
    css,
    mddFiles
  };
}

function selectMatchingCss(mdx: File, cssFiles: File[]): File | undefined {
  if (cssFiles.length <= 1) return cssFiles[0];
  const dictionaryName = comparableFileName(mdx.name);
  return [...cssFiles].sort((left, right) => {
    const leftName = comparableFileName(left.name);
    const rightName = comparableFileName(right.name);
    return commonPrefixLength(dictionaryName, rightName) - commonPrefixLength(dictionaryName, leftName)
      || right.size - left.size;
  })[0];
}

function comparableFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "").normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

function commonPrefixLength(left: string, right: string): number {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) length += 1;
  return length;
}
