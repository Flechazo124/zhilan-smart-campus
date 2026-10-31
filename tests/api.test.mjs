import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const runId = `${Date.now()}-${process.pid}`;
const testDataDir = path.join(projectRoot, "data", "test-runs");
mkdirSync(testDataDir, { recursive: true });
const databasePath = path.join(testDataDir, `zhilan-api-${runId}.db`);
const port = 5185;
const baseUrl = `http://127.0.0.1:${port}`;

let server;
let studentCookie = "";
let teacherCookie = "";

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The service needs a short startup window.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("测试服务未能在预期时间内启动");
}

async function request(pathname, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  return { response, payload };
}

async function login(identifier, password, role) {
  const result = await request("/api/auth/login", {
    method: "POST",
    body: { identifier, password, role }
  });
  assert.equal(result.response.status, 200, `登录失败：${JSON.stringify(result.payload)}`);
  const cookie = result.response.headers.get("set-cookie")?.match(/zhilan_session=([^;]+)/)?.[0];
  assert.ok(cookie, "登录响应应写入会话 Cookie");
  return cookie;
}

test.before(async () => {
  server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: databasePath,
      TEACHER_INVITE_CODE: "TEST-TEACHER-INVITE"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", () => {});
  server.stderr.on("data", (chunk) => {
    if (process.env.DEBUG_API_TEST) process.stderr.write(chunk);
  });
  await waitForServer();
});

test.after(async () => {
  if (!server || server.exitCode != null) return;
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    server.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
});

test("健康检查与未认证访问保护", async () => {
  const health = await request("/api/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.ok, true);
  assert.equal(health.payload.database, "connected");
  assert.equal(health.payload.ai.mode, "local");

  const protectedRequest = await request("/api/dashboard");
  assert.equal(protectedRequest.response.status, 401);
  assert.match(protectedRequest.payload.error, /登录/);
});

test("登录限流在 5 秒后自动恢复", async () => {
  const testIp = "198.51.100.25";
  const headers = { "x-forwarded-for": testIp };

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const failed = await request("/api/auth/login", {
      method: "POST",
      headers,
      body: { identifier: "2024001", password: "WrongPassword2026", role: "student" }
    });
    assert.equal(failed.response.status, 401);
  }

  const limited = await request("/api/auth/login", {
    method: "POST",
    headers,
    body: { identifier: "2024001", password: "WrongPassword2026", role: "student" }
  });
  assert.equal(limited.response.status, 429);
  assert.equal(limited.payload.error, "登录尝试过于频繁，请 5 秒后再试");

  await new Promise((resolve) => setTimeout(resolve, 5_200));

  const recovered = await request("/api/auth/login", {
    method: "POST",
    headers,
    body: { identifier: "2024001", password: "Campus@2026", role: "student" }
  });
  assert.equal(recovered.response.status, 200);
});

test("学生注册、教师邀请码注册与重复账号校验", async () => {
  const suffix = String(Date.now()).slice(-8);
  const studentIdentifier = `S${suffix}`;
  const teacherIdentifier = `T${suffix}`;

  const studentRegistration = await request("/api/auth/register", {
    method: "POST",
    body: {
      role: "student",
      identifier: studentIdentifier,
      name: "测试学生",
      email: `${studentIdentifier.toLowerCase()}@zhilan.edu.cn`,
      password: "Student2026",
      department: "数字媒体学院",
      className: "数字媒体技术 2601"
    }
  });
  assert.equal(studentRegistration.response.status, 201);
  assert.equal(studentRegistration.payload.user.role, "student");
  assert.equal(studentRegistration.payload.user.identifier, studentIdentifier);

  const duplicateRegistration = await request("/api/auth/register", {
    method: "POST",
    body: {
      role: "student",
      identifier: studentIdentifier,
      name: "重复学生",
      email: `repeat-${studentIdentifier.toLowerCase()}@zhilan.edu.cn`,
      password: "Student2026",
      department: "数字媒体学院",
      className: "数字媒体技术 2601"
    }
  });
  assert.equal(duplicateRegistration.response.status, 409);

  const invalidTeacherInvite = await request("/api/auth/register", {
    method: "POST",
    body: {
      role: "teacher",
      identifier: teacherIdentifier,
      name: "测试教师",
      email: `${teacherIdentifier.toLowerCase()}@zhilan.edu.cn`,
      password: "Teacher2026",
      department: "人工智能学院",
      inviteCode: "INVALID-INVITE"
    }
  });
  assert.equal(invalidTeacherInvite.response.status, 403);

  const teacherRegistration = await request("/api/auth/register", {
    method: "POST",
    body: {
      role: "teacher",
      identifier: teacherIdentifier,
      name: "测试教师",
      email: `${teacherIdentifier.toLowerCase()}@zhilan.edu.cn`,
      password: "Teacher2026",
      department: "人工智能学院",
      inviteCode: "TEST-TEACHER-INVITE"
    }
  });
  assert.equal(teacherRegistration.response.status, 201);
  assert.equal(teacherRegistration.payload.user.role, "teacher");
});

test("学生与教师登录、工作台及角色隔离", async () => {
  studentCookie = await login("2024001", "Campus@2026", "student");
  teacherCookie = await login("T1001", "Teacher@2026", "teacher");

  const studentDashboard = await request("/api/dashboard", { cookie: studentCookie });
  assert.equal(studentDashboard.response.status, 200);
  assert.equal(studentDashboard.payload.role, "student");
  assert.ok(studentDashboard.payload.courses.length >= 1);
  assert.ok(studentDashboard.payload.assignments.length >= 1);
  assert.ok(studentDashboard.payload.studySeries.length >= 1);

  const teacherDashboard = await request("/api/dashboard", { cookie: teacherCookie });
  assert.equal(teacherDashboard.response.status, 200);
  assert.equal(teacherDashboard.payload.role, "teacher");
  assert.ok(teacherDashboard.payload.courses.length >= 1);

  const forbiddenCourse = await request("/api/courses", {
    method: "POST",
    cookie: studentCookie,
    body: {
      name: "越权课程",
      code: "NOAUTH101",
      term: "2026 秋季学期",
      description: "学生不应创建课程",
      schedule: "周一",
      room: "A101",
      credits: 2,
      color: "teal"
    }
  });
  assert.equal(forbiddenCourse.response.status, 403);

  const forbiddenRoster = await request("/api/attendance/attendance-math-today", {
    cookie: studentCookie
  });
  assert.equal(forbiddenRoster.response.status, 403);
});

test("课程详情返回学生本人考勤状态与提交正文", async () => {
  const courses = await request("/api/courses", { cookie: studentCookie });
  const course = courses.payload.courses.find((item) => item.code === "MATH204");
  assert.ok(course, "学生应已加入数学课程");
  const courseId = course.id;
  const detail = await request(`/api/courses/${encodeURIComponent(courseId)}`, {
    cookie: studentCookie
  });
  assert.equal(detail.response.status, 200);
  assert.ok(Array.isArray(detail.payload.attendanceSessions));
  assert.ok(detail.payload.attendanceSessions.length >= 1);
  assert.ok(
    detail.payload.attendanceSessions.some((session) => Object.hasOwn(session, "ownStatus")),
    "课程考勤必须返回当前学生自己的签到状态"
  );

});

test("教师发布作业、学生提交、教师批改并通知学生", async () => {
  const teacherCourses = await request("/api/courses", { cookie: teacherCookie });
  const course = teacherCourses.payload.courses.find((item) => item.code === "MATH204");
  assert.ok(course);

  const assignmentResult = await request("/api/assignments", {
    method: "POST",
    cookie: teacherCookie,
    body: {
      courseId: course.id,
      title: `API 回归作业 ${runId}`,
      description: "请完整写出事件定义、计算公式与最终结论。",
      type: "homework",
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      maxScore: 100
    }
  });
  assert.equal(assignmentResult.response.status, 201);
  const assignmentId = assignmentResult.payload.assignment.id;

  const submitResult = await request(`/api/assignments/${assignmentId}/submit`, {
    method: "POST",
    cookie: studentCookie,
    body: { content: "第一次提交：事件 A 与事件 B 的定义清晰，计算过程完整。" }
  });
  assert.equal(submitResult.response.status, 200);

  const updateResult = await request(`/api/assignments/${assignmentId}/submit`, {
    method: "POST",
    cookie: studentCookie,
    body: { content: "第二次提交：补充了条件概率分母变化的解释，并完成结果校验。" }
  });
  assert.equal(updateResult.response.status, 200);

  const studentAssignments = await request("/api/assignments", { cookie: studentCookie });
  const updated = studentAssignments.payload.assignments.find((item) => item.id === assignmentId);
  assert.match(updated.submissionContent, /第二次提交/);

  const submissionsResult = await request(`/api/assignments/${assignmentId}/submissions`, {
    cookie: teacherCookie
  });
  assert.equal(submissionsResult.response.status, 200);
  const submission = submissionsResult.payload.submissions.find((item) => item.studentId === "u-student-1");
  assert.ok(submission);

  const gradeResult = await request(`/api/submissions/${submission.id}/grade`, {
    method: "PATCH",
    cookie: teacherCookie,
    body: { score: 92, feedback: "概念准确，推导完整；建议补充对分母变化的文字解释。" }
  });
  assert.equal(gradeResult.response.status, 200);
  assert.equal(gradeResult.payload.score, 92);

  const gradedAssignments = await request("/api/assignments", { cookie: studentCookie });
  const graded = gradedAssignments.payload.assignments.find((item) => item.id === assignmentId);
  assert.equal(graded.score, 92);
  assert.match(graded.feedback, /推导完整/);

  const notifications = await request("/api/notifications", { cookie: studentCookie });
  assert.ok(notifications.payload.notifications.some((item) => item.title === "作业已批改"));
});

test("教师发起签到、学生签到、重复签到被拒绝、名单可核验", async () => {
  const courses = await request("/api/courses", { cookie: teacherCookie });
  const course = courses.payload.courses.find((item) => item.code === "MATH204");
  const code = "7315";
  const createResult = await request("/api/attendance/sessions", {
    method: "POST",
    cookie: teacherCookie,
    body: {
      courseId: course.id,
      topic: `API 回归签到 ${runId}`,
      checkInCode: code,
      closesAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    }
  });
  assert.equal(createResult.response.status, 201);
  const sessionId = createResult.payload.session.id;

  const wrongCode = await request(`/api/attendance/${sessionId}/check-in`, {
    method: "POST",
    cookie: studentCookie,
    body: { code: "0000" }
  });
  assert.equal(wrongCode.response.status, 400);

  const checkIn = await request(`/api/attendance/${sessionId}/check-in`, {
    method: "POST",
    cookie: studentCookie,
    body: { code }
  });
  assert.equal(checkIn.response.status, 200);
  assert.equal(checkIn.payload.status, "present");

  const duplicate = await request(`/api/attendance/${sessionId}/check-in`, {
    method: "POST",
    cookie: studentCookie,
    body: { code }
  });
  assert.equal(duplicate.response.status, 409);
  assert.match(duplicate.payload.error, /已完成/);

  const roster = await request(`/api/attendance/${sessionId}`, { cookie: teacherCookie });
  assert.equal(roster.response.status, 200);
  const studentRecord = roster.payload.roster.find((item) => item.identifier === "2024001");
  assert.equal(studentRecord.status, "present");

  const studentAttendance = await request("/api/attendance", { cookie: studentCookie });
  const studentSession = studentAttendance.payload.sessions.find((item) => item.id === sessionId);
  assert.equal(studentSession.ownStatus, "present");
});

test("任务增删、通知发布、AI 会话持久化与 CSV 导出", async () => {
  const task = await request("/api/tasks", {
    method: "POST",
    cookie: studentCookie,
    body: { title: `回归任务 ${runId}`, priority: "high" }
  });
  assert.equal(task.response.status, 201);

  const completed = await request(`/api/tasks/${task.payload.task.id}`, {
    method: "PATCH",
    cookie: studentCookie,
    body: { completed: true }
  });
  assert.equal(completed.payload.task.completed, true);

  const deleted = await request(`/api/tasks/${task.payload.task.id}`, {
    method: "DELETE",
    cookie: studentCookie
  });
  assert.equal(deleted.response.status, 200);

  const courses = await request("/api/courses", { cookie: teacherCookie });
  const course = courses.payload.courses.find((item) => item.code === "MATH204");
  const announcement = await request("/api/announcements", {
    method: "POST",
    cookie: teacherCookie,
    body: {
      title: `课程通知 ${runId}`,
      content: "这是 API 回归测试生成的课程通知，用于验证发布和送达链路。",
      scope: "course",
      courseId: course.id,
      priority: "important"
    }
  });
  assert.equal(announcement.response.status, 201);
  const studentAnnouncements = await request("/api/announcements", { cookie: studentCookie });
  assert.ok(studentAnnouncements.payload.announcements.some((item) => item.title === `课程通知 ${runId}`));

  const aiReply = await request("/api/ai/chat", {
    method: "POST",
    cookie: studentCookie,
    body: {
      message: "请根据我的近期作业生成复习计划",
      courseId: course.id
    }
  });
  assert.equal(aiReply.response.status, 200);
  assert.ok(aiReply.payload.reply.content.length > 20);
  assert.equal(aiReply.payload.status.mode, "local");

  const conversations = await request("/api/ai/conversations", { cookie: studentCookie });
  const conversation = conversations.payload.conversations.find(
    (item) => item.id === aiReply.payload.conversationId
  );
  assert.ok(conversation);
  assert.equal(conversation.messages.length, 2);

  const deleteConversation = await request(`/api/ai/conversations/${conversation.id}`, {
    method: "DELETE",
    cookie: studentCookie
  });
  assert.equal(deleteConversation.response.status, 200);

  const exportResult = await request("/api/export/courses.csv", { cookie: studentCookie });
  assert.equal(exportResult.response.status, 200);
  assert.match(exportResult.response.headers.get("content-type"), /text\/csv/);
  assert.match(exportResult.payload, /课程代码/);
});
