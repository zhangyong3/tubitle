import { describe, expect, it } from "vitest";
import { selectDictionaryDirectoryFiles } from "./dictionary-directory";

function fixture(name: string, size: number): File {
  return { name, size, lastModified: 1 } as File;
}

describe("dictionary directory import", () => {
  it("selects the main MDX, matching CSS and all ordered MDD volumes", () => {
    const selected = selectDictionaryDirectoryFiles([
      fixture("other.css", 500),
      fixture("牛津高阶第9版.css", 300),
      fixture("牛津高阶第9版.mdx", 5_000),
      fixture("牛津高阶第9版.2.mdd", 2_000),
      fixture("牛津高阶第9版.1.mdd", 2_000)
    ]);
    expect(selected.mdx.name).toBe("牛津高阶第9版.mdx");
    expect(selected.css?.name).toBe("牛津高阶第9版.css");
    expect(selected.mddFiles.map((file) => file.name)).toEqual(["牛津高阶第9版.1.mdd", "牛津高阶第9版.2.mdd"]);
  });
});
