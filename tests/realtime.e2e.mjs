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
const apiPort = 5192;
const webPort = 5193;
const baseUrl = `http://127.0.0.1:${webPort}`;
const databasePath = path.join(projectRoot, "data", "test-runs", `zhilan-realtime-${runId}.db`);
const screenshotDir = path.join(projectRoot, "artifacts", "screenshots");
const assignmentTitle = `实时作业 ${String(Date.now()).slice(-7)}`;
const attendanceTopic = `实时签到 ${String(Date.now()).slice(-7)}`;
const checkInCode = "9735";

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
      // Vite and the API need a short startup window.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("实时测试服务未能在预期时间内启动");
}

async function login(page, role) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "登录你的学习空间", exact: true }).waitFor();
  if (role === "teacher") {
    await page.getByRole("tab", { name: "教师" }).click();
  }
  await page.getByRole("button", { name: "一键填入" }).click();
  await page.getByRole("button", { name: "进入学习空间" }).click();
  await page.locator(".main-nav").waitFor();
  await page.getByText("实时同步", { exact: true }).waitFor();
}

async function screenshot(page, name) {
  await page.screenshot({
    path: path.join(screenshotDir, name),
    fullPage: true,
    animations: "disabled"
  });
}

const devServer = spawn(process.execPath, ["scripts/dev.mjs"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    PORT: String(apiPort),
    VITE_PORT: String(webPort),
    VITE_API_TARGET: `http://127.0.0.1:${apiPort}`,
    DATABASE_PATH: databasePath
  },
  stdio: ["ignore", "pipe", "pipe"]
});
devServer.stdout.on("data", (chunk) => {
  if (process.env.DEBUG_REALTIME_E2E) process.stdout.write(chunk);
});
devServer.stderr.on("data", (chunk) => {
  if (process.env.DEBUG_REALTIME_E2E) process.stderr.write(chunk);
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

  const teacherContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai"
  });
  const studentContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai"
  });
  const teacherPage = await teacherContext.newPage();
  const studentPage = await studentContext.newPage();

  for (const [label, page] of [["teacher", teacherPage], ["student", studentPage]]) {
    page.on("pageerror", (error) => browserErrors.push(`${label} pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const location = message.location();
      const url = String(location.url || "");
      const text = message.text();
      const isExpectedSessionProbe =
        url.includes("/api/auth/me") &&
        text.includes("401");
      if (!isExpectedSessionProbe) {
        browserErrors.push(`${label} console: ${text} (${url || "unknown"})`);
      }
    });
  }

  await login(teacherPage, "teacher");
  await login(studentPage, "student");

  await studentPage.getByRole("button", { name: "作业中心", exact: true }).click();
  await studentPage.getByRole("heading", { name: "作业中心", exact: true }).waitFor();
  assert.equal(await studentPage.getByText(assignmentTitle, { exact: true }).count(), 0);

  await teacherPage.getByRole("button", { name: /^作业与批改/ }).click();
  await teacherPage.getByRole("heading", { name: "作业与批改", exact: true }).waitFor();
  await teacherPage.getByRole("button", { name: "发布新作业", exact: true }).click();
  const assignmentDialog = teacherPage.getByRole("dialog");
  await assignmentDialog.getByLabel("作业标题").fill(assignmentTitle);
  await assignmentDialog
    .getByLabel("任务说明")
    .fill("这是实时推送测试作业，发布后学生页面应当立即出现当前任务，无需手动刷新。");
  await assignmentDialog.getByRole("button", { name: "发布并通知学生", exact: true }).click();
  await teacherPage.getByText("作业已发布，学生已收到通知", { exact: true }).waitFor();

  await studentPage.getByText(assignmentTitle, { exact: true }).waitFor({ timeout: 10_000 });
  await studentPage.getByText(`实时收到新作业：${assignmentTitle}`, { exact: true }).waitFor();
  await screenshot(studentPage, "27-realtime-assignment-student.png");

  await studentPage.getByRole("button", { name: "考勤签到", exact: true }).click();
  await studentPage.getByRole("heading", { name: "考勤签到", exact: true }).waitFor();
  await studentPage.locator(".attendance-overview").waitFor();
  assert.equal(await studentPage.getByText(attendanceTopic, { exact: true }).count(), 0);

  await teacherPage.getByRole("button", { name: "课堂考勤", exact: true }).click();
  await teacherPage.locator(".teacher-attendance-band").waitFor();
  await teacherPage.getByRole("button", { name: "发起课堂签到", exact: true }).first().click();
  const attendanceDialog = teacherPage.getByRole("dialog");
  await attendanceDialog.getByLabel("本节课堂主题").fill(attendanceTopic);
  await attendanceDialog.getByRole("textbox", { name: /签到码/ }).fill(checkInCode);
  await attendanceDialog.getByRole("button", { name: "开启签到", exact: true }).click();
  await teacherPage.getByText("课堂签到已开启，学生端会立即看到", { exact: true }).waitFor();

  await studentPage.getByText(attendanceTopic, { exact: true }).waitFor({ timeout: 10_000 });
  const sessionRow = teacherPage.locator(".teacher-attendance-list article").filter({ hasText: attendanceTopic });
  await sessionRow.getByRole("button", { name: "查看名单", exact: true }).click();
  const rosterDialog = teacherPage.getByRole("dialog");
  await rosterDialog.waitFor();
  const studentRosterRow = rosterDialog.locator("article").filter({ hasText: "2024001" });
  await studentRosterRow.getByText("未签到", { exact: true }).waitFor();

  const liveCard = studentPage.locator(".attendance-live-card").filter({ hasText: attendanceTopic });
  await liveCard.getByRole("button", { name: "输入签到码", exact: true }).click();
  await studentPage.locator(".check-in-code-input").fill(checkInCode);
  await studentPage.getByRole("button", { name: "确认签到", exact: true }).click();
  await studentPage.getByText("签到成功，出勤记录已保存", { exact: true }).waitFor();

  await studentRosterRow.getByText("已签到", { exact: true }).waitFor({ timeout: 10_000 });
  await screenshot(teacherPage, "28-realtime-attendance-teacher.png");

  await teacherPage.getByText("实时同步", { exact: true }).waitFor();
  await studentPage.getByText("实时同步", { exact: true }).waitFor();
  assert.equal(browserErrors.length, 0, `浏览器控制台错误：\n${browserErrors.join("\n")}`);
  console.log(`实时 E2E 通过：作业发布和学生签到均实现跨会话自动更新；截图已保存到 ${screenshotDir}`);
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
