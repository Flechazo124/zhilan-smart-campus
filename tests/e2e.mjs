import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const require = createRequire(import.meta.url);
const runId = `${Date.now()}-${process.pid}`;
const port = 5186;
const baseUrl = `http://127.0.0.1:${port}`;
const testDataDir = path.join(projectRoot, "data", "test-runs");
const screenshotDir = path.join(projectRoot, "artifacts", "screenshots");
mkdirSync(testDataDir, { recursive: true });
mkdirSync(screenshotDir, { recursive: true });
const databasePath = path.join(testDataDir, `zhilan-e2e-${runId}.db`);

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
      // Try the next local runtime path.
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

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Allow a short startup period.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("E2E 测试服务启动超时");
}

async function screenshot(page, name, options = {}) {
  await page.screenshot({
    path: path.join(screenshotDir, name),
    fullPage: options.fullPage ?? true,
    animations: "disabled"
  });
}

async function closeTopDialog(page) {
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    await dialog.getByRole("button", { name: "关闭弹窗" }).click();
  }
}

const server = spawn(process.execPath, ["server/index.mjs"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    PORT: String(port),
    DATABASE_PATH: databasePath
  },
  stdio: ["ignore", "pipe", "pipe"]
});
server.stdout.on("data", () => {});
server.stderr.on("data", (chunk) => {
  if (process.env.DEBUG_E2E) process.stderr.write(chunk);
});

let browser;
const browserErrors = [];

try {
  await waitForServer();
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
    const isExpectedSessionProbe =
      message.text().includes("401") &&
      String(location.url || "").includes("/api/auth/me");
    if (!isExpectedSessionProbe) {
      browserErrors.push(`console: ${message.text()} (${location.url || "unknown"})`);
    }
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "登录你的学习空间" }).waitFor();
  await screenshot(page, "01-login-desktop.png");

  await page.getByRole("button", { name: "一键填入" }).click();
  await page.getByRole("button", { name: "进入学习空间" }).click();
  await page.locator(".main-nav").waitFor();
  await page.locator(".stat-band").waitFor();
  await screenshot(page, "02-student-dashboard.png");

  await page.getByRole("button", { name: "我的课程", exact: true }).click();
  await page.getByRole("heading", { name: "我的课程", exact: true }).waitFor();
  await page.locator(".course-detail-hero").waitFor();
  await page.locator(".course-list-item").filter({ hasText: "概率论与数理统计" }).click();
  await page.locator(".course-detail-copy h2").filter({ hasText: "概率论与数理统计" }).waitFor();
  await screenshot(page, "03-student-courses.png");
  await page.locator(".detail-tabs").getByRole("button", { name: /^考勤/ }).click();
  await page.locator(".course-attendance-list").waitFor();
  await screenshot(page, "04-student-course-attendance.png");

  await page.getByRole("button", { name: "作业中心", exact: true }).click();
  await page.locator(".assignment-grid").waitFor();
  await screenshot(page, "05-student-assignments.png");
  const submitButton = page.getByRole("button", { name: "提交作业", exact: true }).first();
  if (await submitButton.count()) {
    await submitButton.click();
    await page.getByRole("dialog").getByRole("textbox").last().fill(
      "根据条件概率定义，我先明确已知事件 B，再在缩小后的样本空间中计算事件 A 与 B 的交集，并核验最终结果是否落在 0 到 1 之间。"
    );
    await page.getByRole("button", { name: "确认提交", exact: true }).click();
    await page.getByText("作业提交成功", { exact: true }).waitFor();
    await screenshot(page, "06-student-submission-success.png");
  }

  await page.getByRole("button", { name: "AI 学习助理", exact: true }).click();
  await page.getByRole("heading", { name: "AI 学习助理", exact: true }).waitFor();
  await page.getByRole("button", { name: /根据我的近期作业生成一份 7 天复习计划/ }).click();
  await page.locator(".assistant-message").first().waitFor({ timeout: 30_000 });
  await page.getByText(/根据你当前未完成的任务/).waitFor();
  await screenshot(page, "07-student-ai.png");

  await page.getByRole("button", { name: "考勤签到", exact: true }).click();
  await page.locator(".attendance-overview").waitFor();
  await screenshot(page, "08-student-attendance.png");
  const checkInButton = page.getByRole("button", { name: "立即签到", exact: true });
  if (await checkInButton.isEnabled()) {
    await checkInButton.click();
    await page.locator(".check-in-code-input").fill("8246");
    await page.getByRole("button", { name: "确认签到", exact: true }).click();
    await page.getByText("签到成功，出勤记录已保存", { exact: true }).waitFor();
    await screenshot(page, "09-student-checked-in.png");
  }

  await page.getByRole("button", { name: "学情分析", exact: true }).click();
  await page.locator(".analytics-stat-grid").waitFor();
  await screenshot(page, "10-student-analytics.png");

  await page.getByRole("button", { name: "校园通知", exact: true }).click();
  await page.locator(".announcement-grid").waitFor();
  await screenshot(page, "11-student-announcements.png");
  await page.locator(".announcement-card").first().click();
  await page.getByRole("dialog").waitFor();
  await screenshot(page, "12-announcement-detail.png");
  await closeTopDialog(page);

  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("heading", { name: "登录你的学习空间" }).waitFor();
  await page.getByRole("tab", { name: "教师" }).click();
  await page.getByRole("button", { name: "一键填入" }).click();
  await page.getByRole("button", { name: "进入学习空间" }).click();
  await page.locator(".main-nav").waitFor();
  await page.locator(".stat-band").waitFor();
  await screenshot(page, "13-teacher-dashboard.png");

  await page.getByRole("button", { name: "课堂考勤", exact: true }).click();
  await page.locator(".teacher-attendance-band").waitFor();
  await page.getByRole("button", { name: "发起课堂签到", exact: true }).first().click();
  const attendanceDialog = page.getByRole("dialog");
  await attendanceDialog.getByPlaceholder("例如 条件概率与贝叶斯公式").fill("E2E 条件概率课堂");
  await attendanceDialog.getByRole("button", { name: "开启签到", exact: true }).click();
  await page.getByText("课堂签到已开启，学生端会立即看到", { exact: true }).waitFor();
  await screenshot(page, "14-teacher-attendance-created.png");

  await page.getByRole("button", { name: "班级学情", exact: true }).click();
  await page.locator(".analytics-stat-grid").waitFor();
  await screenshot(page, "15-teacher-analytics.png");

  await page.getByRole("button", { name: /^作业与批改/ }).click();
  await page.locator(".assignment-grid").waitFor();
  await screenshot(page, "16-teacher-assignments.png");
  const gradeButton = page.getByRole("button", { name: /进入批改/ }).first();
  if (await gradeButton.count()) {
    await gradeButton.click();
    const gradingDialog = page.getByRole("dialog");
    await gradingDialog.locator(".grading-layout").waitFor();
    await screenshot(page, "17-teacher-grading.png", { fullPage: false });
    const scoreInput = gradingDialog.locator('input[type="number"]').first();
    if (await scoreInput.count()) {
      await scoreInput.fill("95");
      await gradingDialog.getByPlaceholder(/说明推理亮点/).fill("概念理解准确，推导完整。建议补充对分母变化的文字说明。");
      await gradingDialog.getByRole("button", { name: /保存评分并通知学生/ }).click();
      await page.getByText("评分与反馈已保存，学生已收到通知", { exact: true }).waitFor();
      await closeTopDialog(page);
    }
  }

  await page.getByRole("button", { name: "通知管理", exact: true }).click();
  await page.locator(".announcement-feature").waitFor();
  await page.getByRole("button", { name: "发布通知", exact: true }).click();
  const noticeDialog = page.getByRole("dialog");
  await noticeDialog.getByPlaceholder("用一句话说明通知重点").fill("E2E 智慧教室开放预约");
  await noticeDialog.getByPlaceholder(/写清时间、地点/).fill("本周五 19:00 在智慧教室开放 AI 学习工作坊，请通过课程任务查看参与说明。");
  await noticeDialog.getByRole("button", { name: "发布并通知", exact: true }).click();
  await page.getByText("通知已发布并送达对应账号", { exact: true }).waitFor();
  await screenshot(page, "18-teacher-announcements.png");

  await page.waitForTimeout(4500);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "教学工作台", exact: true }).click();
  await page.locator(".stat-band").waitFor();
  await screenshot(page, "19-teacher-mobile-dashboard.png");

  assert.equal(browserErrors.length, 0, `浏览器控制台错误：\n${browserErrors.join("\n")}`);
  console.log(`E2E 通过：19 张截图已保存到 ${screenshotDir}`);
} finally {
  if (browser) await browser.close();
  if (server.exitCode == null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000);
      server.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
