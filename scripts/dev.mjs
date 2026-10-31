import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteBin = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const serverEntry = path.join(projectRoot, "server", "index.mjs");
const children = [];
let shuttingDown = false;
let shutdownTimer;

if (!existsSync(viteBin)) {
  console.error("未找到 Vite，请先在项目目录执行 pnpm install。");
  process.exit(1);
}

function stopChildren(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode == null) child.kill("SIGTERM");
  }
  shutdownTimer = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode == null) child.kill("SIGKILL");
    }
  }, 2500);
  shutdownTimer.unref();
}

function start(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);

  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on("error", (error) => {
    console.error(`[${name}] 启动失败：${error.message}`);
    stopChildren(1);
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `信号 ${signal}` : `退出码 ${code}`;
    console.error(`[${name}] 服务已停止（${reason}），正在关闭另一个服务。`);
    stopChildren(code ?? 1);
  });
  return child;
}

process.on("SIGINT", () => stopChildren(0));
process.on("SIGTERM", () => stopChildren(0));
process.on("exit", () => {
  if (shutdownTimer) clearTimeout(shutdownTimer);
});

console.log("正在启动知澜智慧校园开发环境...");
start("api", [serverEntry]);
start("web", [viteBin, "--host", "127.0.0.1", "--strictPort"]);
