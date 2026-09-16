import { readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const extension = resolve(root, "extension");
const dist = resolve(extension, "dist");
const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));
const archive = resolve(extension, `tubitle-v${manifest.version}.zip`);

await rm(archive, { force: true });

await new Promise((resolvePromise, reject) => {
  const process = spawn("zip", ["-q", "-r", archive, ".", "-x", "*.DS_Store"], {
    cwd: dist,
    stdio: "inherit"
  });
  process.on("error", (error) => reject(new Error(`无法启动 zip 命令：${error.message}`)));
  process.on("exit", (code) => {
    if (code === 0) resolvePromise();
    else reject(new Error(`zip 打包失败，退出码：${code ?? "未知"}`));
  });
});

console.log(`扩展安装包已生成：${archive}`);
