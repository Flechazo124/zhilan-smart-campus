import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const require = createRequire(import.meta.url);
const runId = `${Date.now()}-${process.pid}`;
const apiPort = 5187;
const webPort = 5188;
const baseUrl = `http://127.0.0.1:${webPort}`;
const databasePath = path.join(projectRoot, "data", "test-runs", `zhilan-auth-${runId}.db`);
const screenshotDir = path.join(projectRoot, "artifacts", "screenshots");
const studentIdentifier = `AUTH${String(Date.now()).slice(-6)}`;
const teacherIdentifier = `TAUTH${String(Date.now()).slice(-6)}`;

mkdirSync(path.dirname(databasePath), { recursive: true });
mkdirSync(screenshotDir, { recursive: true });

const playwrightCandidates = [
  process.env.PLAYWRIGHT_MODULE,
  "playwright-core",
  "playwright",
  "C:/Users/Fleachazo/AppData/Local/OpenAI/Codex/runtimes/cua_node/b2c4f0c90eadfac4/bin/node_modules/playwright"
].filter(Boolean);

function loadPlaywright() {
  for (const candidate of playwrightCandidates) {
    try {
      return require(candidate);
    } catch {
      // Try the next available local runtime.
    }
  }
  throw new Error("未找到 Playwright，请设置 PLAYWRIGHT_MODULE");
}

const edgeCandidates = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
];
const edgePath = edgeCandidates.find((candidate) => existsSync(candidate));
if (!edgePath) throw new Error("未找到 Microsoft Edge 可执行文件");

async function waitForService() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        const payload = await response.json();
        assert.equal(payload.database, "connected");
        return;
      }
    } catch {
      // Both Vite and the API need a short startup window.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("认证测试服务未能在预期时间内启动");
}

async function screenshot(page, name) {
  await page.screenshot({
    path: path.join(screenshotDir, name),
    fullPage: true,
    animations: "disabled"
  });
}

async function openRegistration(page, role) {
  await page.getByRole("tab", { name: role }).click();
  await page.getByRole("button", { name: "立即注册", exact: true }).click();
  await page.getByRole("heading", { name: "加入知澜智慧校园", exact: true }).waitFor();
}

async function fillStudentRegistration(page, overrides = {}) {
  await page.getByLabel("姓名").fill(overrides.name || "浏览器测试学生");
  await page.getByLabel("院系").fill(overrides.department || "数字媒体学院");
  await page.getByLabel("学号").fill(overrides.identifier || studentIdentifier);
  await page.getByLabel("学校邮箱").fill(overrides.email || `${studentIdentifier.toLowerCase()}@zhilan.edu.cn`);
  await page.getByLabel("密码", { exact: true }).fill(overrides.password || "Student2026");
  await page.getByLabel("班级").fill(overrides.className || "数字媒体技术 2602");
}

const devServer = spawn(process.execPath, ["scripts/dev.mjs"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    PORT: String(apiPort),
    VITE_PORT: String(webPort),
    VITE_API_TARGET: `http://127.0.0.1:${apiPort}`,
    DATABASE_PATH: databasePath,
    TEACHER_INVITE_CODE: "AUTH-E2E-INVITE"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
devServer.stdout.on("data", (chunk) => {
  if (process.env.DEBUG_AUTH_E2E) process.stdout.write(chunk);
});
devServer.stderr.on("data", (chunk) => {
  if (process.env.DEBUG_AUTH_E2E) process.stderr.write(chunk);
});

let browser;
const browserErrors = [];

try {
  await waitForService();
  const { chromium } = loadPlaywright();
  browser = await chromium.launch({
    executablePath: edgePath,
    headless: true,
    args: ["--disable-gpu", "--no-first-run"]
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai"
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location();
    const url = String(location.url || "");
    const text = message.text();
    const isExpectedAuthStatus =
      url.includes("/api/auth/") &&
      ["400", "401", "403", "409"].some((status) => text.includes(status));
    if (!isExpectedAuthStatus) {
      browserErrors.push(`console: ${text} (${url || "unknown"})`);
    }
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "登录你的学习空间", exact: true }).waitFor();
  await screenshot(page, "20-auth-login.png");

  await page.getByRole("button", { name: "立即注册", exact: true }).click();
  await page.getByRole("heading", { name: "加入知澜智慧校园", exact: true }).waitFor();
  await fillStudentRegistration(page, { password: "12345678" });
  await page.getByRole("button", { name: "创建账号并登录", exact: true }).click();
  await page.getByText("密码需为 8-72 位，并同时包含字母和数字", { exact: true }).waitFor();
  await screenshot(page, "21-auth-student-validation.png");

  await page.getByLabel("密码", { exact: true }).fill("Student2026");
  await page.getByRole("button", { name: "创建账号并登录", exact: true }).click();
  await page.locator(".main-nav").waitFor();
  await page.getByText("浏览器测试学生", { exact: true }).first().waitFor();
  await screenshot(page, "22-auth-student-registered.png");

  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("heading", { name: "登录你的学习空间", exact: true }).waitFor();
  await openRegistration(page, "教师");
  await page.getByLabel("姓名").fill("浏览器测试教师");
  await page.getByLabel("院系").fill("人工智能学院");
  await page.getByLabel("教师工号").fill(teacherIdentifier);
  await page.getByLabel("学校邮箱").fill(`${teacherIdentifier.toLowerCase()}@zhilan.edu.cn`);
  await page.getByLabel("密码", { exact: true }).fill("Teacher2026");
  await page.getByLabel("教师邀请码").fill("INVALID-INVITE");
  await page.getByRole("button", { name: "创建账号并登录", exact: true }).click();
  await page.getByText("教师邀请码无效", { exact: true }).waitFor();
  await screenshot(page, "23-auth-teacher-invalid-invite.png");

  await page.getByLabel("教师邀请码").fill("AUTH-E2E-INVITE");
  await page.getByRole("button", { name: "创建账号并登录", exact: true }).click();
  await page.locator(".main-nav").waitFor();
  await page.getByText("浏览器测试教师", { exact: true }).first().waitFor();
  await screenshot(page, "24-auth-teacher-registered.png");

  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("heading", { name: "登录你的学习空间", exact: true }).waitFor();
  await page.getByRole("button", { name: "立即注册", exact: true }).click();
  await fillStudentRegistration(page, {
    name: "重复账号学生",
    identifier: studentIdentifier,
    email: `repeat-${studentIdentifier.toLowerCase()}@zhilan.edu.cn`
  });
  await page.getByRole("button", { name: "创建账号并登录", exact: true }).click();
  await page.getByText("该账号已被注册", { exact: true }).waitFor();
  await screenshot(page, "25-auth-duplicate-account.png");

  await page.getByRole("button", { name: "返回登录", exact: true }).click();
  await page.getByLabel("学号").fill(studentIdentifier);
  await page.getByLabel("密码", { exact: true }).fill("Student2026");
  await page.getByRole("button", { name: "进入学习空间", exact: true }).click();
  await page.locator(".main-nav").waitFor();
  await page.getByText("浏览器测试学生", { exact: true }).first().waitFor();
  await screenshot(page, "26-auth-student-relogin.png");

  assert.equal(browserErrors.length, 0, `浏览器控制台错误：\n${browserErrors.join("\n")}`);
  console.log(`认证 E2E 通过：真实注册、校验、重复账号和重新登录均通过；截图已保存到 ${screenshotDir}`);
} finally {
  if (browser) await browser.close();
  if (devServer.exitCode == null) {
    devServer.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      devServer.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
