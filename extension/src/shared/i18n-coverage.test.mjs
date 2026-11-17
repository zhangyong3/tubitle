import { expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import ts from "typescript";
import en from "./locales/en.json";
const catalogs = { en };
  it("has translations for every statically referenced interface message", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const missing = [];
    function inspect(folder) {
      for (const item of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, item.name);
        if (item.isDirectory()) { if (item.name !== "locales") inspect(path); continue; }
        if (!/\.tsx?$/.test(path) || /\.test\./.test(path)) continue;
        const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
        function visit(node) {
          if (ts.isCallExpression(node) && node.expression.getText(source) === "t") {
            const key = node.arguments[0];
            if (key && ts.isStringLiteral(key) && !catalogs.en[key.text]) missing.push(`${item.name}: ${key.text}`);
          }
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
    inspect(root);
    expect(missing).toEqual([]);
  });
