import "./config.mjs";
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";
import {
  cleanupSessions,
  createId,
  createSessionToken,
  db,
  getPublicUser,
  hashPassword,
  hashToken,
  isoNow,
  seeded,
  verifyPassword
} from "./db.mjs";
import { generateTeachingReply, getAIStatus, newConversationTitle } from "./ai.mjs";
import { openRealtimeStream, publishRealtime } from "./realtime.mjs";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(serverDir, "..");
const distDir = path.join(projectRoot, "dist");
const sessionCookie = "zhilan_session";
const maxBodyBytes = 1_000_000;
const loginAttempts = new Map();
const loginRateLimitWindowMs = 5_000;
const loginRateLimitMaxAttempts = 12;

class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function now() {
  return isoNow();
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) {
    throw new HttpError(400, "请输入有效邮箱地址");
  }
  return email;
}

function validateName(value) {
  const name = String(value || "").trim();
  if (name.length < 2 || name.length > 24) {
    throw new HttpError(400, "姓名长度需为 2-24 个字符");
  }
  return name;
}

function validateIdentifier(value) {
  const identifier = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{4,24}$/.test(identifier)) {
    throw new HttpError(400, "账号需为 4-24 位字母、数字、下划线或连字符");
  }
  return identifier;
}

function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new HttpError(400, "密码需为 8-72 位，并同时包含字母和数字");
  }
  return password;
}

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    ...extra
  };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(
    status,
    securityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": body.length,
      "Cache-Control": "no-store",
      ...extraHeaders
    })
  );
  res.end(body);
}

function sendError(res, error) {
  const status = error instanceof HttpError ? error.status : 500;
  if (status >= 500) {
    console.error("[API]", error);
  }
  sendJson(res, status, {
    error: status === 500 ? "服务器暂时无法处理该请求" : error.message,
    ...(error instanceof HttpError && error.details ? { details: error.details } : {})
  });
}

function redirect(res, location) {
  res.writeHead(302, securityHeaders({ Location: location, "Cache-Control": "no-store" }));
  res.end();
}

async function readJson(req) {
  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.includes("application/json")) {
    throw new HttpError(415, "请求内容必须为 JSON");
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      throw new HttpError(413, "请求内容过大");
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON 格式无效");
  }
}

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function checkOrigin(req) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return;
  const origin = req.headers.origin;
  if (!origin) return;
  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new HttpError(403, "请求来源无效");
  }
  const requestHost = String(req.headers.host || "");
  if (originUrl.host !== requestHost && !config.devOrigins.has(originUrl.origin)) {
    throw new HttpError(403, "跨站请求已被拒绝");
  }
}

function authenticate(req) {
  const token = parseCookies(req)[sessionCookie];
  if (!token) return null;
  const user = db
    .prepare(`
      SELECT u.*, s.token_hash
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `)
    .get(hashToken(token), now());
  return user || null;
}

function requireAuth(req) {
  const user = authenticate(req);
  if (!user) throw new HttpError(401, "登录状态已失效，请重新登录");
  return user;
}

function requireRole(user, ...roles) {
  if (!roles.includes(user.role)) {
    throw new HttpError(403, "当前角色无权执行此操作");
  }
}

function issueSession(req, res, user) {
  const token = createSessionToken();
  const expires = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000);
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    user.id,
    now(),
    expires.toISOString()
  );
  const secure = String(req.headers["x-forwarded-proto"] || "").includes("https") ? "; Secure" : "";
  const maxAge = Math.floor((expires.getTime() - Date.now()) / 1000);
  return `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearSession(req, res) {
  const token = parseCookies(req)[sessionCookie];
  if (token) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }
  const secure = String(req.headers["x-forwarded-proto"] || "").includes("https") ? "; Secure" : "";
  return `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function rateLimitLogin(req) {
  const key = clientIp(req);
  const current = Date.now();
  const existing = loginAttempts.get(key);
  if (!existing || existing.resetAt <= current) {
    loginAttempts.set(key, { count: 1, resetAt: current + loginRateLimitWindowMs });
    return;
  }
  existing.count += 1;
  if (existing.count > loginRateLimitMaxAttempts) {
    throw new HttpError(429, "登录尝试过于频繁，请 5 秒后再试");
  }
}

function mapCourse(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    term: row.term,
    description: row.description,
    schedule: row.schedule,
    room: row.room,
    credits: row.credits,
    cover: row.cover,
    color: row.color,
    progress: row.progress == null ? null : Number(row.progress),
    grade: row.grade == null ? null : Number(row.grade),
    studentCount: Number(row.student_count || 0),
    averageProgress: row.average_progress == null ? null : Number(row.average_progress),
    averageGrade: row.average_grade == null ? null : Number(row.average_grade)
  };
}

function mapAssignment(row) {
  return {
    id: row.id,
    courseId: row.course_id,
    courseName: row.course_name,
    courseCode: row.course_code,
    title: row.title,
    description: row.description,
    type: row.type,
    dueAt: row.due_at,
    maxScore: Number(row.max_score),
    createdAt: row.created_at,
    submissionId: row.submission_id || null,
    submittedAt: row.submitted_at || null,
    submissionContent: row.submission_content || null,
    score: row.score == null ? null : Number(row.score),
    feedback: row.feedback || null,
    gradedAt: row.graded_at || null,
    submissionCount: row.submission_count == null ? null : Number(row.submission_count),
    gradedCount: row.graded_count == null ? null : Number(row.graded_count),
    studentCount: row.student_count == null ? null : Number(row.student_count)
  };
}

function mapTask(row) {
  return {
    id: row.id,
    courseId: row.course_id,
    courseName: row.course_name || null,
    title: row.title,
    dueAt: row.due_at,
    priority: row.priority,
    completed: Boolean(row.completed)
  };
}

function mapNotification(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    kind: row.kind,
    view: row.link_view,
    read: Boolean(row.read_at),
    createdAt: row.created_at
  };
}

function mapAnnouncement(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    scope: row.scope,
    priority: row.priority,
    courseId: row.course_id,
    courseName: row.course_name || null,
    authorName: row.author_name,
    publishedAt: row.published_at
  };
}

function listCoursesForUser(user) {
  if (user.role === "teacher") {
    return db
      .prepare(`
        SELECT c.*, u.name AS teacher_name,
          (SELECT COUNT(*) FROM enrollments e2 WHERE e2.course_id = c.id) AS student_count,
          (SELECT ROUND(AVG(e2.progress), 0) FROM enrollments e2 WHERE e2.course_id = c.id) AS average_progress,
          (SELECT ROUND(AVG(e2.grade), 1) FROM enrollments e2 WHERE e2.course_id = c.id AND e2.grade IS NOT NULL) AS average_grade
        FROM courses c
        JOIN users u ON u.id = c.teacher_id
        WHERE c.teacher_id = ?
        ORDER BY c.created_at ASC
      `)
      .all(user.id)
      .map(mapCourse);
  }

  return db
    .prepare(`
      SELECT c.*, u.name AS teacher_name, e.progress, e.grade,
        (SELECT COUNT(*) FROM enrollments e2 WHERE e2.course_id = c.id) AS student_count,
        NULL AS average_progress, NULL AS average_grade
      FROM courses c
      JOIN users u ON u.id = c.teacher_id
      JOIN enrollments e ON e.course_id = c.id AND e.student_id = ?
      ORDER BY e.joined_at ASC
    `)
    .all(user.id)
    .map(mapCourse);
}

function listAssignmentsForUser(user) {
  if (user.role === "teacher") {
    return db
      .prepare(`
        SELECT a.*, c.name AS course_name, c.code AS course_code,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS submission_count,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.score IS NOT NULL) AS graded_count,
          (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS student_count
        FROM assignments a
        JOIN courses c ON c.id = a.course_id
        WHERE c.teacher_id = ?
        ORDER BY a.due_at ASC
      `)
      .all(user.id)
      .map(mapAssignment);
  }

  return db
    .prepare(`
      SELECT a.*, c.name AS course_name, c.code AS course_code,
        s.id AS submission_id, s.content AS submission_content, s.submitted_at, s.score, s.feedback, s.graded_at
      FROM assignments a
      JOIN enrollments e ON e.course_id = a.course_id AND e.student_id = ?
      JOIN courses c ON c.id = a.course_id
      LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = e.student_id
      ORDER BY a.due_at ASC
    `)
    .all(user.id)
    .map(mapAssignment);
}

function listTasks(userId) {
  return db
    .prepare(`
      SELECT t.*, c.name AS course_name
      FROM tasks t
      LEFT JOIN courses c ON c.id = t.course_id
      WHERE t.user_id = ?
      ORDER BY t.completed ASC, t.due_at ASC
    `)
    .all(userId)
    .map(mapTask);
}

function listNotifications(userId, limit = 20) {
  return db
    .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(userId, limit)
    .map(mapNotification);
}

function listAnnouncementsForUser(user, limit = 20) {
  if (user.role === "teacher") {
    return db
      .prepare(`
        SELECT a.*, u.name AS author_name, c.name AS course_name
        FROM announcements a
        JOIN users u ON u.id = a.author_id
        LEFT JOIN courses c ON c.id = a.course_id
        WHERE a.scope = 'campus'
          OR c.teacher_id = ?
          OR a.author_id = ?
        ORDER BY a.published_at DESC
        LIMIT ?
      `)
      .all(user.id, user.id, limit)
      .map(mapAnnouncement);
  }

  return db
    .prepare(`
      SELECT a.*, u.name AS author_name, c.name AS course_name
      FROM announcements a
      JOIN users u ON u.id = a.author_id
      LEFT JOIN courses c ON c.id = a.course_id
      WHERE a.scope = 'campus'
        OR a.course_id IN (SELECT course_id FROM enrollments WHERE student_id = ?)
      ORDER BY a.published_at DESC
      LIMIT ?
    `)
    .all(user.id, limit)
    .map(mapAnnouncement);
}

function courseRealtimeUsers(courseId) {
  return db
    .prepare(`
      SELECT student_id AS id FROM enrollments WHERE course_id = ?
      UNION
      SELECT teacher_id AS id FROM courses WHERE id = ?
    `)
    .all(courseId, courseId)
    .map((row) => row.id);
}

function publishCourseRealtime(courseId, event) {
  return publishRealtime(courseRealtimeUsers(courseId), { ...event, courseId });
}

function studentAttendanceStats(studentId) {
  return db
    .prepare(`
      SELECT
        COUNT(s.id) AS total,
        SUM(CASE WHEN ar.status IN ('present', 'late') THEN 1 ELSE 0 END) AS attended,
        SUM(CASE WHEN ar.status = 'leave' THEN 1 ELSE 0 END) AS leave_count,
        SUM(CASE WHEN ar.status = 'absent' OR ar.student_id IS NULL THEN 1 ELSE 0 END) AS absent_count
      FROM attendance_sessions s
      JOIN enrollments e ON e.course_id = s.course_id AND e.student_id = ?
      LEFT JOIN attendance_records ar ON ar.session_id = s.id AND ar.student_id = e.student_id
      WHERE s.status = 'closed' OR s.closes_at <= ? OR ar.student_id IS NOT NULL
    `)
    .get(studentId, now());
}

function buildStudentDashboard(user) {
  const courses = listCoursesForUser(user);
  const assignments = listAssignmentsForUser(user);
  const attendance = studentAttendanceStats(user.id);
  const study = db
    .prepare(`
      SELECT studied_on, SUM(minutes) AS minutes, ROUND(AVG(score), 1) AS score
      FROM study_records
      WHERE student_id = ? AND date(studied_on) >= date('now', '-13 day')
      GROUP BY studied_on
      ORDER BY studied_on ASC
    `)
    .all(user.id);
  const openAttendance = db
    .prepare(`
      SELECT s.*, c.name AS course_name, c.code AS course_code
      FROM attendance_sessions s
      JOIN courses c ON c.id = s.course_id
      JOIN enrollments e ON e.course_id = s.course_id AND e.student_id = ?
      LEFT JOIN attendance_records ar ON ar.session_id = s.id AND ar.student_id = e.student_id
      WHERE s.status = 'open' AND s.closes_at > ? AND ar.student_id IS NULL
      ORDER BY s.closes_at ASC
      LIMIT 1
    `)
    .get(user.id, now());
  const pendingAssignments = assignments.filter((item) => !item.submissionId);
  const averageGrade = courses.filter((item) => item.grade != null).length
    ? Number((courses.filter((item) => item.grade != null).reduce((sum, item) => sum + item.grade, 0) / courses.filter((item) => item.grade != null).length).toFixed(1))
    : null;
  const attendanceRate = attendance.total ? Math.round((attendance.attended / attendance.total) * 100) : 100;

  return {
    role: user.role,
    stats: {
      studyMinutes: study.slice(-7).reduce((sum, item) => sum + Number(item.minutes), 0),
      pendingAssignments: pendingAssignments.length,
      averageGrade,
      attendanceRate,
      streak: 12
    },
    courses,
    assignments,
    tasks: listTasks(user.id),
    notifications: listNotifications(user.id, 8),
    announcements: listAnnouncementsForUser(user, 6),
    studySeries: study.map((item) => ({
      date: item.studied_on,
      minutes: Number(item.minutes),
      score: item.score == null ? null : Number(item.score)
    })),
    openAttendance: openAttendance
      ? {
          id: openAttendance.id,
          courseId: openAttendance.course_id,
          courseName: openAttendance.course_name,
          courseCode: openAttendance.course_code,
          topic: openAttendance.topic,
          closesAt: openAttendance.closes_at
        }
      : null
  };
}

function buildTeacherDashboard(user) {
  const courses = listCoursesForUser(user);
  const assignments = listAssignmentsForUser(user);
  const students = db
    .prepare(`
      SELECT COUNT(DISTINCT e.student_id) AS count
      FROM enrollments e
      JOIN courses c ON c.id = e.course_id
      WHERE c.teacher_id = ?
    `)
    .get(user.id);
  const ungraded = db
    .prepare(`
      SELECT s.id, s.assignment_id, s.student_id, s.submitted_at, s.content,
        a.title, a.max_score, c.id AS course_id, c.name AS course_name, u.name AS student_name
      FROM submissions s
      JOIN assignments a ON a.id = s.assignment_id
      JOIN courses c ON c.id = a.course_id
      JOIN users u ON u.id = s.student_id
      WHERE c.teacher_id = ? AND s.score IS NULL
      ORDER BY s.submitted_at ASC
    `)
    .all(user.id)
    .map((row) => ({
      id: row.id,
      assignmentId: row.assignment_id,
      studentId: row.student_id,
      studentName: row.student_name,
      courseId: row.course_id,
      courseName: row.course_name,
      title: row.title,
      maxScore: Number(row.max_score),
      submittedAt: row.submitted_at,
      content: row.content
    }));
  const openSessions = db
    .prepare(`
      SELECT s.*, c.name AS course_name, c.code AS course_code,
        (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = s.id) AS checked_in,
        (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = s.course_id) AS student_count
      FROM attendance_sessions s
      JOIN courses c ON c.id = s.course_id
      WHERE s.teacher_id = ? AND s.status = 'open'
      ORDER BY s.closes_at ASC
    `)
    .all(user.id)
    .map((row) => ({
      id: row.id,
      courseId: row.course_id,
      courseName: row.course_name,
      courseCode: row.course_code,
      topic: row.topic,
      checkInCode: row.check_in_code,
      closesAt: row.closes_at,
      checkedIn: Number(row.checked_in),
      studentCount: Number(row.student_count)
    }));
  const currentCourse = courses[0] || null;
  const analytics = currentCourse ? buildTeacherAnalytics(user, currentCourse.id) : null;

  return {
    role: user.role,
    stats: {
      courseCount: courses.length,
      studentCount: Number(students.count || 0),
      ungradedCount: ungraded.length,
      averageProgress: courses.length
        ? Math.round(courses.reduce((sum, course) => sum + Number(course.averageProgress || 0), 0) / courses.length)
        : 0,
      averageGrade: courses.filter((course) => course.averageGrade != null).length
        ? Number((courses.filter((course) => course.averageGrade != null).reduce((sum, course) => sum + course.averageGrade, 0) / courses.filter((course) => course.averageGrade != null).length).toFixed(1))
        : null
    },
    courses,
    assignments,
    ungraded,
    openSessions,
    notifications: listNotifications(user.id, 8),
    announcements: listAnnouncementsForUser(user, 6),
    analytics
  };
}

function getCourseAccess(user, courseId) {
  const row = db
    .prepare(`
      SELECT c.*, u.name AS teacher_name,
        (SELECT COUNT(*) FROM enrollments e2 WHERE e2.course_id = c.id) AS student_count,
        (SELECT ROUND(AVG(e2.progress), 0) FROM enrollments e2 WHERE e2.course_id = c.id) AS average_progress,
        (SELECT ROUND(AVG(e2.grade), 1) FROM enrollments e2 WHERE e2.course_id = c.id AND e2.grade IS NOT NULL) AS average_grade
      FROM courses c
      JOIN users u ON u.id = c.teacher_id
      WHERE c.id = ?
    `)
    .get(courseId);
  if (!row) throw new HttpError(404, "课程不存在");
  if (user.role === "teacher" && row.teacher_id !== user.id) {
    throw new HttpError(403, "你未教授该课程");
  }
  if (user.role === "student") {
    const enrollment = db
      .prepare("SELECT * FROM enrollments WHERE student_id = ? AND course_id = ?")
      .get(user.id, courseId);
    if (!enrollment) throw new HttpError(403, "你尚未加入该课程");
    row.progress = enrollment.progress;
    row.grade = enrollment.grade;
  }
  return mapCourse(row);
}

function buildTeacherAnalytics(user, courseId) {
  const course = db
    .prepare("SELECT * FROM courses WHERE id = ? AND teacher_id = ?")
    .get(courseId, user.id);
  if (!course) throw new HttpError(404, "课程不存在");
  const students = db
    .prepare(`
      SELECT u.id, u.name, u.identifier, u.avatar_color,
        e.progress, e.grade,
        (SELECT COUNT(*) FROM submissions s JOIN assignments a ON a.id = s.assignment_id
          WHERE s.student_id = u.id AND a.course_id = c.id) AS submitted_count,
        (SELECT COUNT(*) FROM attendance_records ar JOIN attendance_sessions ats ON ats.id = ar.session_id
          WHERE ar.student_id = u.id AND ats.course_id = c.id) AS attendance_total,
        (SELECT COUNT(*) FROM attendance_records ar JOIN attendance_sessions ats ON ats.id = ar.session_id
          WHERE ar.student_id = u.id AND ats.course_id = c.id AND ar.status IN ('present', 'late')) AS attendance_present
      FROM enrollments e
      JOIN users u ON u.id = e.student_id
      JOIN courses c ON c.id = e.course_id
      WHERE e.course_id = ?
      ORDER BY e.grade DESC
    `)
    .all(courseId)
    .map((row) => ({
      id: row.id,
      name: row.name,
      identifier: row.identifier,
      avatarColor: row.avatar_color,
      progress: Number(row.progress),
      grade: row.grade == null ? null : Number(row.grade),
      attendanceRate: row.attendance_total
        ? Math.round((row.attendance_present / row.attendance_total) * 100)
        : 100,
      submittedCount: Number(row.submitted_count)
    }));
  const assignments = db
    .prepare(`
      SELECT a.id, a.title, a.max_score,
        COUNT(s.id) AS submissions,
        AVG(s.score) AS average_score
      FROM assignments a
      LEFT JOIN submissions s ON s.assignment_id = a.id
      WHERE a.course_id = ?
      GROUP BY a.id
      ORDER BY a.created_at ASC
    `)
    .all(courseId)
    .map((row) => ({
      id: row.id,
      title: row.title,
      submissions: Number(row.submissions),
      averageScore: row.average_score == null ? null : Number(Number(row.average_score).toFixed(1)),
      maxScore: Number(row.max_score)
    }));
  const gradeBands = [
    { label: "90-100", min: 90, max: 100 },
    { label: "80-89", min: 80, max: 89.99 },
    { label: "70-79", min: 70, max: 79.99 },
    { label: "60-69", min: 60, max: 69.99 },
    { label: "<60", min: -1, max: 59.99 }
  ].map((band) => ({
    label: band.label,
    count: students.filter((student) => student.grade != null && student.grade > band.min && student.grade <= band.max).length
  }));
  const graded = students.filter((student) => student.grade != null);
  return {
    course: mapCourse({
      ...course,
      teacher_name: user.name,
      student_count: students.length,
      average_progress: students.length ? students.reduce((sum, student) => sum + student.progress, 0) / students.length : 0,
      average_grade: graded.length ? graded.reduce((sum, student) => sum + student.grade, 0) / graded.length : null
    }),
    metrics: {
      studentCount: students.length,
      averageGrade: graded.length ? Number((graded.reduce((sum, student) => sum + student.grade, 0) / graded.length).toFixed(1)) : null,
      averageProgress: students.length ? Math.round(students.reduce((sum, student) => sum + student.progress, 0) / students.length) : 0,
      attendanceRate: students.length ? Math.round(students.reduce((sum, student) => sum + student.attendanceRate, 0) / students.length) : 0,
      atRiskCount: students.filter((student) => student.progress < 55 || (student.grade != null && student.grade < 70)).length
    },
    students,
    assignments,
    gradeBands
  };
}

function buildStudentAnalytics(user) {
  const courses = listCoursesForUser(user);
  const attendance = studentAttendanceStats(user.id);
  const records = db
    .prepare(`
      SELECT studied_on, minutes, score, course_id
      FROM study_records
      WHERE student_id = ?
      ORDER BY studied_on ASC
    `)
    .all(user.id);
  const submissions = db
    .prepare(`
      SELECT s.score, a.max_score, a.title, c.name AS course_name
      FROM submissions s
      JOIN assignments a ON a.id = s.assignment_id
      JOIN courses c ON c.id = a.course_id
      WHERE s.student_id = ? AND s.score IS NOT NULL
      ORDER BY s.graded_at ASC
    `)
    .all(user.id)
    .map((row) => ({
      score: Number(row.score),
      maxScore: Number(row.max_score),
      title: row.title,
      courseName: row.course_name
    }));
  const averageGrade = courses.filter((course) => course.grade != null).length
    ? Number((courses.filter((course) => course.grade != null).reduce((sum, course) => sum + course.grade, 0) / courses.filter((course) => course.grade != null).length).toFixed(1))
    : null;
  const totalStudyMinutes = records.reduce((sum, item) => sum + Number(item.minutes), 0);
  return {
    metrics: {
      studyMinutes: totalStudyMinutes,
      averageGrade,
      courseCount: courses.length,
      attendanceRate: attendance.total ? Math.round((attendance.attended / attendance.total) * 100) : 100,
      completedAssignments: submissions.length
    },
    courseMastery: courses.map((course) => ({
      id: course.id,
      name: course.name,
      code: course.code,
      progress: course.progress,
      grade: course.grade,
      color: course.color
    })),
    studySeries: records.map((row) => ({
      date: row.studied_on,
      minutes: Number(row.minutes),
      score: row.score == null ? null : Number(row.score)
    })),
    submissions,
    attendance: {
      total: Number(attendance.total || 0),
      present: Number(attendance.attended || 0),
      leave: Number(attendance.leave_count || 0),
      absent: Number(attendance.absent_count || 0)
    }
  };
}

function buildAIContext(user, courseId) {
  const courses = listCoursesForUser(user);
  const course = courseId ? getCourseAccess(user, courseId) : courses[0] || null;
  const assignments = course
    ? (user.role === "student"
        ? db.prepare(`
            SELECT a.*, c.name AS course_name, c.code AS course_code, s.id AS submission_id
            FROM assignments a
            JOIN courses c ON c.id = a.course_id
            LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
            WHERE a.course_id = ?
            ORDER BY a.due_at ASC
          `).all(user.id, course.id)
        : db.prepare(`
            SELECT a.*, c.name AS course_name, c.code AS course_code
            FROM assignments a JOIN courses c ON c.id = a.course_id
            WHERE a.course_id = ? ORDER BY a.due_at ASC
          `).all(course.id)
      ).map(mapAssignment)
    : [];
  return {
    user: getPublicUser(user),
    course,
    assignments,
    notice: getAIStatus().configured ? "" : "当前为本地教学引擎模式。"
  };
}

function courseCsvRows(user) {
  const courses = listCoursesForUser(user);
  const rows = [["课程", "课程代码", "教师", "授课时间", "地点", user.role === "teacher" ? "学生数" : "进度", user.role === "teacher" ? "平均成绩" : "成绩"]];
  for (const course of courses) {
    rows.push([
      course.name,
      course.code,
      course.teacherName,
      course.schedule,
      course.room,
      user.role === "teacher" ? course.studentCount : `${course.progress}%`,
      user.role === "teacher" ? course.averageGrade ?? "" : course.grade ?? ""
    ]);
  }
  return rows;
}

function csvResponse(res, rows, filename) {
  const body = Buffer.from(
    `\ufeff${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n")}`,
    "utf8"
  );
  res.writeHead(
    200,
    securityHeaders({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": body.length,
      "Cache-Control": "no-store"
    })
  );
  res.end(body);
}

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;
  const method = req.method;

  if (method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "知澜智慧校园",
      time: now(),
      database: "connected",
      ai: getAIStatus()
    });
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    rateLimitLogin(req);
    const body = await readJson(req);
    const identifier = validateIdentifier(body.identifier);
    const password = String(body.password || "");
    const role = String(body.role || "");
    if (!["student", "teacher"].includes(role)) throw new HttpError(400, "请选择正确的登录身份");
    const user = db.prepare("SELECT * FROM users WHERE identifier = ?").get(identifier);
    if (!user || user.role !== role || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, "账号、密码或身份不匹配");
    }
    const cookie = issueSession(req, res, user);
    return sendJson(res, 200, { user: getPublicUser(user) }, { "Set-Cookie": cookie });
  }

  if (method === "POST" && pathname === "/api/auth/register") {
    rateLimitLogin(req);
    const body = await readJson(req);
    const role = String(body.role || "");
    if (!["student", "teacher"].includes(role)) throw new HttpError(400, "请选择注册身份");
    if (role === "teacher" && String(body.inviteCode || "") !== config.teacherInviteCode) {
      throw new HttpError(403, "教师邀请码无效");
    }
    const identifier = validateIdentifier(body.identifier);
    const name = validateName(body.name);
    const email = normalizeEmail(body.email);
    const password = validatePassword(body.password);
    const department = String(body.department || "").trim().slice(0, 40) || (role === "teacher" ? "教学部门" : "数字媒体学院");
    const className = role === "student" ? String(body.className || "").trim().slice(0, 40) || "未分班" : null;
    if (db.prepare("SELECT id FROM users WHERE identifier = ?").get(identifier)) {
      throw new HttpError(409, "该账号已被注册");
    }
    const id = createId(role === "teacher" ? "teacher" : "student");
    db.prepare(`
      INSERT INTO users (id, role, identifier, name, password_hash, email, department, title, class_name, avatar_color, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      role,
      identifier,
      name,
      hashPassword(password),
      email,
      department,
      role === "teacher" ? "教师" : null,
      className,
      role === "teacher" ? "#2c6e7f" : "#0d746d",
      now()
    );
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    const cookie = issueSession(req, res, user);
    return sendJson(res, 201, { user: getPublicUser(user) }, { "Set-Cookie": cookie });
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    const cookie = clearSession(req, res);
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": cookie });
  }

  const user = requireAuth(req);

  if (method === "GET" && pathname === "/api/events") {
    openRealtimeStream(req, res, user);
    return;
  }

  if (method === "GET" && pathname === "/api/auth/me") {
    return sendJson(res, 200, { user: getPublicUser(user), ai: getAIStatus() });
  }

  if (method === "GET" && pathname === "/api/dashboard") {
    return sendJson(res, 200, user.role === "teacher" ? buildTeacherDashboard(user) : buildStudentDashboard(user));
  }

  if (method === "GET" && pathname === "/api/courses") {
    return sendJson(res, 200, { courses: listCoursesForUser(user) });
  }

  if (method === "POST" && pathname === "/api/courses") {
    requireRole(user, "teacher");
    const body = await readJson(req);
    const name = String(body.name || "").trim();
    const code = String(body.code || "").trim().toUpperCase();
    if (name.length < 2 || name.length > 50) throw new HttpError(400, "课程名称需为 2-50 个字符");
    if (!/^[A-Z0-9-]{3,16}$/.test(code)) throw new HttpError(400, "课程代码需为 3-16 位大写字母、数字或连字符");
    if (db.prepare("SELECT id FROM courses WHERE code = ?").get(code)) throw new HttpError(409, "课程代码已存在");
    const id = createId("course");
    db.prepare(`
      INSERT INTO courses (id, code, name, teacher_id, term, description, schedule, room, credits, cover, color, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      code,
      name,
      user.id,
      String(body.term || "2026 秋季学期").trim(),
      String(body.description || "由教师创建的新课程").trim().slice(0, 500),
      String(body.schedule || "待安排").trim().slice(0, 80),
      String(body.room || "待安排").trim().slice(0, 80),
      Number(body.credits) || 2,
      "/assets/course-statistics.jpg",
      ["teal", "coral", "gold"].includes(body.color) ? body.color : "teal",
      now()
    );
    return sendJson(res, 201, { course: getCourseAccess(user, id) });
  }

  const courseMatch = pathname.match(/^\/api\/courses\/([^/]+)$/);
  if (courseMatch && method === "GET") {
    const course = getCourseAccess(user, courseMatch[1]);
    const assignments = user.role === "teacher"
      ? db.prepare(`
          SELECT a.*, c.name AS course_name, c.code AS course_code,
            (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS submission_count,
            (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.score IS NOT NULL) AS graded_count,
            (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS student_count
          FROM assignments a JOIN courses c ON c.id = a.course_id
          WHERE a.course_id = ? ORDER BY a.due_at ASC
        `).all(course.id).map(mapAssignment)
      : db.prepare(`
          SELECT a.*, c.name AS course_name, c.code AS course_code,
            s.id AS submission_id, s.content AS submission_content, s.submitted_at, s.score, s.feedback, s.graded_at
          FROM assignments a JOIN courses c ON c.id = a.course_id
          LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
          WHERE a.course_id = ? ORDER BY a.due_at ASC
        `).all(user.id, course.id).map(mapAssignment);
    const announcements = db.prepare(`
      SELECT a.*, u.name AS author_name, c.name AS course_name
      FROM announcements a JOIN users u ON u.id = a.author_id
      LEFT JOIN courses c ON c.id = a.course_id
      WHERE a.course_id = ? ORDER BY a.published_at DESC
    `).all(course.id).map(mapAnnouncement);
    const attendanceSessions = db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = s.id) AS checked_in,
        (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = s.course_id) AS student_count,
        ar.status AS record_status, ar.checked_at, ar.note
      FROM attendance_sessions s
      LEFT JOIN attendance_records ar ON ar.session_id = s.id AND ar.student_id = ?
      WHERE s.course_id = ?
      ORDER BY s.session_date DESC, s.opened_at DESC
    `).all(user.id, course.id).map((row) => ({
      id: row.id,
      courseId: row.course_id,
      courseName: course.name,
      courseCode: course.code,
      date: row.session_date,
      topic: row.topic,
      status: row.status,
      closesAt: row.closes_at,
      checkInCode: user.role === "teacher" ? row.check_in_code : undefined,
      checkedIn: Number(row.checked_in || 0),
      studentCount: Number(row.student_count || 0),
      ownStatus: row.record_status || null,
      checkedAt: row.checked_at || null,
      note: row.note || null
    }));
    const roster = user.role === "teacher"
      ? db.prepare(`
          SELECT u.id, u.name, u.identifier, u.avatar_color, e.progress, e.grade
          FROM enrollments e JOIN users u ON u.id = e.student_id
          WHERE e.course_id = ? ORDER BY u.name
        `).all(course.id)
      : [];
    return sendJson(res, 200, { course, assignments, announcements, attendanceSessions, roster });
  }

  const enrollMatch = pathname.match(/^\/api\/courses\/([^/]+)\/enroll$/);
  if (enrollMatch && method === "POST") {
    requireRole(user, "teacher");
    const course = getCourseAccess(user, enrollMatch[1]);
    const body = await readJson(req);
    const student = db.prepare("SELECT * FROM users WHERE identifier = ? AND role = 'student'").get(validateIdentifier(body.identifier));
    if (!student) throw new HttpError(404, "未找到该学生账号");
    db.prepare(`
      INSERT INTO enrollments (student_id, course_id, progress, grade, joined_at)
      VALUES (?, ?, 0, NULL, ?)
      ON CONFLICT(student_id, course_id) DO NOTHING
    `).run(student.id, course.id, now());
    db.prepare(`
      INSERT INTO notifications (id, user_id, title, content, kind, link_view, read_at, created_at)
      VALUES (?, ?, ?, ?, 'course', 'courses', NULL, ?)
    `).run(createId("notification"), student.id, `你已加入课程：${course.name}`, `${user.name} 已将你加入该课程，请查看课程任务。`, now());
    publishRealtime([student.id, user.id], {
      type: "course",
      action: "enrolled",
      actorId: user.id,
      actorName: user.name,
      courseId: course.id,
      courseName: course.name,
      studentId: student.id,
      studentName: student.name
    });
    return sendJson(res, 200, { student: { id: student.id, name: student.name, identifier: student.identifier } });
  }

  if (method === "GET" && pathname === "/api/assignments") {
    return sendJson(res, 200, { assignments: listAssignmentsForUser(user) });
  }

  if (method === "POST" && pathname === "/api/assignments") {
    requireRole(user, "teacher");
    const body = await readJson(req);
    const course = getCourseAccess(user, String(body.courseId || ""));
    const title = String(body.title || "").trim();
    const description = String(body.description || "").trim();
    if (title.length < 2 || title.length > 80) throw new HttpError(400, "作业标题需为 2-80 个字符");
    if (description.length < 5 || description.length > 3000) throw new HttpError(400, "作业说明需为 5-3000 个字符");
    const dueAt = new Date(body.dueAt);
    if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() <= Date.now()) throw new HttpError(400, "截止时间必须晚于当前时间");
    const id = createId("assignment");
    db.prepare(`
      INSERT INTO assignments (id, course_id, title, description, type, due_at, max_score, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      course.id,
      title,
      description,
      String(body.type || "homework").slice(0, 20),
      dueAt.toISOString(),
      Math.max(1, Math.min(1000, Number(body.maxScore) || 100)),
      user.id,
      now()
    );
    const students = db.prepare("SELECT student_id FROM enrollments WHERE course_id = ?").all(course.id);
    const notify = db.prepare(`
      INSERT INTO notifications (id, user_id, title, content, kind, link_view, read_at, created_at)
      VALUES (?, ?, ?, ?, 'assignment', 'assignments', NULL, ?)
    `);
    for (const student of students) {
      notify.run(createId("notification"), student.student_id, `新作业：${title}`, `${course.name} 发布了新任务，截止时间 ${dueAt.toLocaleString("zh-CN")}。`, now());
    }
    publishCourseRealtime(course.id, {
      type: "assignment",
      action: "created",
      actorId: user.id,
      actorName: user.name,
      assignmentId: id,
      title,
      courseName: course.name
    });
    const row = db.prepare(`
      SELECT a.*, c.name AS course_name, c.code AS course_code,
        (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS student_count
      FROM assignments a JOIN courses c ON c.id = a.course_id WHERE a.id = ?
    `).get(id);
    return sendJson(res, 201, { assignment: mapAssignment(row) });
  }

  const submitMatch = pathname.match(/^\/api\/assignments\/([^/]+)\/submit$/);
  if (submitMatch && method === "POST") {
    requireRole(user, "student");
    const assignment = db.prepare(`
      SELECT a.*, c.name AS course_name, c.code AS course_code, c.teacher_id AS course_teacher_id
      FROM assignments a JOIN courses c ON c.id = a.course_id WHERE a.id = ?
    `).get(submitMatch[1]);
    if (!assignment) throw new HttpError(404, "作业不存在");
    if (!db.prepare("SELECT 1 AS ok FROM enrollments WHERE student_id = ? AND course_id = ?").get(user.id, assignment.course_id)) {
      throw new HttpError(403, "你未加入该课程");
    }
    if (new Date(assignment.due_at).getTime() < Date.now()) throw new HttpError(409, "该作业已截止，无法继续提交");
    const body = await readJson(req);
    const content = String(body.content || "").trim();
    if (content.length < 5 || content.length > 12000) throw new HttpError(400, "作业内容需为 5-12000 个字符");
    const existing = db.prepare("SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?").get(assignment.id, user.id);
    if (existing?.score != null) throw new HttpError(409, "该作业已经评分，不能再次修改");
    const submissionId = existing?.id || createId("submission");
    const submittedAt = now();
    db.prepare(`
      INSERT INTO submissions (id, assignment_id, student_id, content, submitted_at, score, feedback, graded_at, graded_by)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
      ON CONFLICT(assignment_id, student_id) DO UPDATE SET content = excluded.content, submitted_at = excluded.submitted_at
    `).run(submissionId, assignment.id, user.id, content, submittedAt);
    publishRealtime([assignment.course_teacher_id, user.id], {
      type: "assignment",
      action: "submitted",
      actorId: user.id,
      actorName: user.name,
      assignmentId: assignment.id,
      title: assignment.title,
      courseId: assignment.course_id,
      courseName: assignment.course_name,
      submittedAt
    });
    return sendJson(res, 200, {
      submission: { id: submissionId, assignmentId: assignment.id, content, submittedAt }
    });
  }

  const submissionsMatch = pathname.match(/^\/api\/assignments\/([^/]+)\/submissions$/);
  if (submissionsMatch && method === "GET") {
    requireRole(user, "teacher");
    const assignment = db.prepare(`
      SELECT a.*, c.name AS course_name, c.teacher_id
      FROM assignments a JOIN courses c ON c.id = a.course_id WHERE a.id = ?
    `).get(submissionsMatch[1]);
    if (!assignment) throw new HttpError(404, "作业不存在");
    if (assignment.teacher_id !== user.id) throw new HttpError(403, "你无权查看该作业");
    const submissions = db.prepare(`
      SELECT s.*, u.name AS student_name, u.identifier, u.avatar_color
      FROM submissions s JOIN users u ON u.id = s.student_id
      WHERE s.assignment_id = ? ORDER BY s.submitted_at ASC
    `).all(assignment.id).map((row) => ({
      id: row.id,
      studentId: row.student_id,
      studentName: row.student_name,
      identifier: row.identifier,
      avatarColor: row.avatar_color,
      content: row.content,
      submittedAt: row.submitted_at,
      score: row.score == null ? null : Number(row.score),
      feedback: row.feedback,
      gradedAt: row.graded_at
    }));
    return sendJson(res, 200, {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        maxScore: Number(assignment.max_score),
        courseName: assignment.course_name
      },
      submissions
    });
  }

  const gradeMatch = pathname.match(/^\/api\/submissions\/([^/]+)\/grade$/);
  if (gradeMatch && method === "PATCH") {
    requireRole(user, "teacher");
    const submission = db.prepare(`
      SELECT s.*, a.max_score, c.teacher_id
      FROM submissions s
      JOIN assignments a ON a.id = s.assignment_id
      JOIN courses c ON c.id = a.course_id
      WHERE s.id = ?
    `).get(gradeMatch[1]);
    if (!submission) throw new HttpError(404, "提交记录不存在");
    if (submission.teacher_id !== user.id) throw new HttpError(403, "你无权批改该作业");
    const body = await readJson(req);
    const score = Number(body.score);
    const feedback = String(body.feedback || "").trim();
    if (!Number.isFinite(score) || score < 0 || score > submission.max_score) {
      throw new HttpError(400, `分数需在 0-${submission.max_score} 之间`);
    }
    if (feedback.length < 2 || feedback.length > 2000) throw new HttpError(400, "反馈需为 2-2000 个字符");
    const gradedAt = now();
    db.prepare(`
      UPDATE submissions SET score = ?, feedback = ?, graded_at = ?, graded_by = ? WHERE id = ?
    `).run(score, feedback, gradedAt, user.id, submission.id);
    db.prepare(`
      INSERT INTO notifications (id, user_id, title, content, kind, link_view, read_at, created_at)
      VALUES (?, ?, ?, ?, 'grade', 'assignments', NULL, ?)
    `).run(createId("notification"), submission.student_id, "作业已批改", `你的作业获得 ${score} 分，点击查看教师反馈。`, now());
    publishRealtime([submission.student_id, submission.teacher_id], {
      type: "assignment",
      action: "graded",
      actorId: user.id,
      actorName: user.name,
      assignmentId: submission.assignment_id,
      studentId: submission.student_id,
      score,
      gradedAt
    });
    return sendJson(res, 200, { ok: true, score, feedback, gradedAt });
  }

  if (method === "GET" && pathname === "/api/tasks") {
    return sendJson(res, 200, { tasks: listTasks(user.id) });
  }

  if (method === "POST" && pathname === "/api/tasks") {
    const body = await readJson(req);
    const title = String(body.title || "").trim();
    if (title.length < 2 || title.length > 100) throw new HttpError(400, "任务标题需为 2-100 个字符");
    let courseId = body.courseId ? String(body.courseId) : null;
    if (courseId) getCourseAccess(user, courseId);
    const id = createId("task");
    db.prepare(`
      INSERT INTO tasks (id, user_id, course_id, title, due_at, priority, completed, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      id,
      user.id,
      courseId,
      title,
      body.dueAt ? new Date(body.dueAt).toISOString() : null,
      ["high", "normal", "low"].includes(body.priority) ? body.priority : "normal",
      now()
    );
    return sendJson(res, 201, { task: listTasks(user.id).find((task) => task.id === id) });
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && method === "PATCH") {
    const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(taskMatch[1], user.id);
    if (!task) throw new HttpError(404, "任务不存在");
    const body = await readJson(req);
    if (body.completed != null) {
      db.prepare("UPDATE tasks SET completed = ? WHERE id = ?").run(body.completed ? 1 : 0, task.id);
    }
    return sendJson(res, 200, { task: listTasks(user.id).find((item) => item.id === task.id) });
  }

  if (taskMatch && method === "DELETE") {
    const result = db.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").run(taskMatch[1], user.id);
    if (result.changes === 0) throw new HttpError(404, "任务不存在");
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/attendance") {
    if (user.role === "student") {
      const sessions = db.prepare(`
        SELECT s.*, c.name AS course_name, c.code AS course_code,
          ar.status AS record_status, ar.checked_at, ar.note
        FROM attendance_sessions s
        JOIN courses c ON c.id = s.course_id
        JOIN enrollments e ON e.course_id = s.course_id AND e.student_id = ?
        LEFT JOIN attendance_records ar ON ar.session_id = s.id AND ar.student_id = e.student_id
        ORDER BY s.session_date DESC, s.opened_at DESC
      `).all(user.id).map((row) => ({
        id: row.id,
        courseId: row.course_id,
        courseName: row.course_name,
        courseCode: row.course_code,
        date: row.session_date,
        topic: row.topic,
        status: row.status,
        closesAt: row.closes_at,
        recordStatus: row.record_status,
        ownStatus: row.record_status,
        checkedAt: row.checked_at,
        note: row.note
      }));
      return sendJson(res, 200, { sessions, stats: studentAttendanceStats(user.id) });
    }
    const sessions = db.prepare(`
      SELECT s.*, c.name AS course_name, c.code AS course_code,
        (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = s.id) AS checked_in,
        (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = s.course_id) AS student_count
      FROM attendance_sessions s
      JOIN courses c ON c.id = s.course_id
      WHERE s.teacher_id = ?
      ORDER BY s.session_date DESC, s.opened_at DESC
    `).all(user.id).map((row) => ({
      id: row.id,
      courseId: row.course_id,
      courseName: row.course_name,
      courseCode: row.course_code,
      date: row.session_date,
      topic: row.topic,
      checkInCode: row.check_in_code,
      status: row.status,
      closesAt: row.closes_at,
      checkedIn: Number(row.checked_in),
      studentCount: Number(row.student_count)
    }));
    return sendJson(res, 200, { sessions });
  }

  const checkInMatch = pathname.match(/^\/api\/attendance\/([^/]+)\/check-in$/);
  if (checkInMatch && method === "POST") {
    requireRole(user, "student");
    const session = db.prepare(`
      SELECT s.*, c.name AS course_name, c.teacher_id
      FROM attendance_sessions s JOIN courses c ON c.id = s.course_id WHERE s.id = ?
    `).get(checkInMatch[1]);
    if (!session) throw new HttpError(404, "考勤场次不存在");
    if (!db.prepare("SELECT 1 AS ok FROM enrollments WHERE student_id = ? AND course_id = ?").get(user.id, session.course_id)) {
      throw new HttpError(403, "你未加入该课程");
    }
    if (session.status !== "open" || new Date(session.closes_at).getTime() <= Date.now()) {
      throw new HttpError(409, "签到已关闭");
    }
    const body = await readJson(req);
    if (String(body.code || "").trim() !== session.check_in_code) throw new HttpError(400, "签到码不正确");
    const existing = db.prepare("SELECT * FROM attendance_records WHERE session_id = ? AND student_id = ?").get(session.id, user.id);
    if (existing) throw new HttpError(409, "你已完成本次签到");
    const checkedAt = now();
    db.prepare(`
      INSERT INTO attendance_records (session_id, student_id, status, checked_at, note)
      VALUES (?, ?, 'present', ?, NULL)
    `).run(session.id, user.id, checkedAt);
    publishRealtime([session.teacher_id, user.id], {
      type: "attendance",
      action: "checked-in",
      actorId: user.id,
      actorName: user.name,
      sessionId: session.id,
      courseId: session.course_id,
      courseName: session.course_name,
      studentId: user.id,
      studentName: user.name,
      status: "present",
      checkedAt
    });
    return sendJson(res, 200, {
      ok: true,
      courseName: session.course_name,
      checkedAt,
      status: "present"
    });
  }

  if (method === "POST" && pathname === "/api/attendance/sessions") {
    requireRole(user, "teacher");
    const body = await readJson(req);
    const course = getCourseAccess(user, String(body.courseId || ""));
    const topic = String(body.topic || "").trim();
    const code = String(body.checkInCode || "").trim();
    if (topic.length < 2 || topic.length > 100) throw new HttpError(400, "课堂主题需为 2-100 个字符");
    if (!/^\d{4,8}$/.test(code)) throw new HttpError(400, "签到码需为 4-8 位数字");
    const closesAt = new Date(body.closesAt || Date.now() + 30 * 60 * 1000);
    if (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= Date.now()) {
      throw new HttpError(400, "签到关闭时间必须晚于当前时间");
    }
    const id = createId("attendance");
    db.prepare(`
      INSERT INTO attendance_sessions (id, course_id, teacher_id, session_date, topic, check_in_code, status, opened_at, closes_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
    `).run(id, course.id, user.id, new Date().toISOString().slice(0, 10), topic, code, now(), closesAt.toISOString());
    publishCourseRealtime(course.id, {
      type: "attendance",
      action: "created",
      actorId: user.id,
      actorName: user.name,
      sessionId: id,
      topic,
      courseName: course.name,
      closesAt: closesAt.toISOString()
    });
    return sendJson(res, 201, {
      session: {
        id,
        courseId: course.id,
        courseName: course.name,
        topic,
        checkInCode: code,
        closesAt: closesAt.toISOString(),
        status: "open"
      }
    });
  }

  const attendanceDetailMatch = pathname.match(/^\/api\/attendance\/([^/]+)$/);
  if (attendanceDetailMatch && method === "GET") {
    requireRole(user, "teacher");
    const session = db.prepare(`
      SELECT s.*, c.name AS course_name, c.code AS course_code, c.teacher_id
      FROM attendance_sessions s JOIN courses c ON c.id = s.course_id WHERE s.id = ?
    `).get(attendanceDetailMatch[1]);
    if (!session) throw new HttpError(404, "考勤场次不存在");
    if (session.teacher_id !== user.id) throw new HttpError(403, "你无权查看该考勤");
    const roster = db.prepare(`
      SELECT u.id, u.name, u.identifier, u.avatar_color,
        COALESCE(ar.status, 'absent') AS status, ar.checked_at, ar.note
      FROM enrollments e
      JOIN users u ON u.id = e.student_id
      LEFT JOIN attendance_records ar ON ar.session_id = ? AND ar.student_id = e.student_id
      WHERE e.course_id = ?
      ORDER BY u.name
    `).all(session.id, session.course_id).map((row) => ({
      id: row.id,
      name: row.name,
      identifier: row.identifier,
      avatarColor: row.avatar_color,
      status: row.status,
      checkedAt: row.checked_at,
      note: row.note
    }));
    return sendJson(res, 200, {
      session: {
        id: session.id,
        courseName: session.course_name,
        courseCode: session.course_code,
        topic: session.topic,
        checkInCode: session.check_in_code,
        status: session.status,
        closesAt: session.closes_at
      },
      roster
    });
  }

  if (method === "GET" && pathname === "/api/announcements") {
    return sendJson(res, 200, { announcements: listAnnouncementsForUser(user, 50) });
  }

  if (method === "POST" && pathname === "/api/announcements") {
    requireRole(user, "teacher");
    const body = await readJson(req);
    const scope = String(body.scope || "campus");
    const title = String(body.title || "").trim();
    const content = String(body.content || "").trim();
    if (!["campus", "course"].includes(scope)) throw new HttpError(400, "通知范围无效");
    if (title.length < 2 || title.length > 100) throw new HttpError(400, "通知标题需为 2-100 个字符");
    if (content.length < 5 || content.length > 3000) throw new HttpError(400, "通知内容需为 5-3000 个字符");
    let courseId = null;
    if (scope === "course") {
      courseId = String(body.courseId || "");
      getCourseAccess(user, courseId);
    }
    const id = createId("announcement");
    const priority = body.priority === "important" ? "important" : "normal";
    db.prepare(`
      INSERT INTO announcements (id, author_id, scope, course_id, title, content, priority, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, user.id, scope, courseId, title, content, priority, now());

    let recipients = [];
    if (scope === "campus") {
      recipients = db.prepare("SELECT id FROM users").all();
    } else {
      recipients = db.prepare("SELECT student_id AS id FROM enrollments WHERE course_id = ?").all(courseId);
    }
    const insertNotification = db.prepare(`
      INSERT INTO notifications (id, user_id, title, content, kind, link_view, read_at, created_at)
      VALUES (?, ?, ?, ?, 'announcement', 'announcements', NULL, ?)
    `);
    for (const recipient of recipients) {
      if (recipient.id !== user.id) {
        insertNotification.run(createId("notification"), recipient.id, `校园通知：${title}`, content.slice(0, 220), now());
      }
    }
    publishRealtime([...recipients.map((recipient) => recipient.id), user.id], {
      type: "announcement",
      action: "created",
      actorId: user.id,
      actorName: user.name,
      announcementId: id,
      title,
      scope,
      courseId,
      priority
    });
    return sendJson(res, 201, {
      announcement: listAnnouncementsForUser(user, 1)[0]
    });
  }

  if (method === "GET" && pathname === "/api/notifications") {
    return sendJson(res, 200, { notifications: listNotifications(user.id, 50) });
  }

  const notificationMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (notificationMatch && method === "PATCH") {
    const notification = db.prepare("SELECT * FROM notifications WHERE id = ? AND user_id = ?").get(notificationMatch[1], user.id);
    if (!notification) throw new HttpError(404, "通知不存在");
    db.prepare("UPDATE notifications SET read_at = ? WHERE id = ?").run(now(), notification.id);
    return sendJson(res, 200, { ok: true });
  }

  if (method === "PATCH" && pathname === "/api/notifications/read-all") {
    db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").run(now(), user.id);
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/analytics") {
    if (user.role === "teacher") {
      const courseId = searchParams.get("courseId") || listCoursesForUser(user)[0]?.id;
      if (!courseId) throw new HttpError(404, "暂无课程数据");
      return sendJson(res, 200, buildTeacherAnalytics(user, courseId));
    }
    return sendJson(res, 200, buildStudentAnalytics(user));
  }

  if (method === "GET" && pathname === "/api/export/courses.csv") {
    return csvResponse(res, courseCsvRows(user), "知澜智慧校园-课程数据.csv");
  }

  if (method === "GET" && pathname === "/api/ai/status") {
    return sendJson(res, 200, getAIStatus());
  }

  if (method === "GET" && pathname === "/api/ai/conversations") {
    const conversations = db.prepare(`
      SELECT id, course_id, title, created_at, updated_at
      FROM ai_conversations WHERE user_id = ?
      ORDER BY updated_at DESC LIMIT 20
    `).all(user.id).map((row) => {
      const messages = db.prepare(`
        SELECT role, content, provider, model, created_at
        FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC
      `).all(row.id);
      return {
        id: row.id,
        courseId: row.course_id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
          provider: message.provider,
          model: message.model,
          createdAt: message.created_at
        }))
      };
    });
    return sendJson(res, 200, { conversations, status: getAIStatus() });
  }

  if (method === "POST" && pathname === "/api/ai/chat") {
    const body = await readJson(req);
    const prompt = String(body.message || "").trim();
    if (!prompt || prompt.length > 6000) throw new HttpError(400, "问题内容需为 1-6000 个字符");
    let conversation = null;
    if (body.conversationId) {
      conversation = db.prepare("SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?").get(String(body.conversationId), user.id);
      if (!conversation) throw new HttpError(404, "对话不存在");
    }
    let contextCourseId = body.courseId ? String(body.courseId) : conversation?.course_id || null;
    if (contextCourseId) getCourseAccess(user, contextCourseId);
    if (!conversation) {
      const id = createId("conversation");
      db.prepare(`
        INSERT INTO ai_conversations (id, user_id, course_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, user.id, contextCourseId, newConversationTitle(prompt), now(), now());
      conversation = db.prepare("SELECT * FROM ai_conversations WHERE id = ?").get(id);
    }
    const history = db.prepare(`
      SELECT role, content FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC
    `).all(conversation.id);
    db.prepare(`
      INSERT INTO ai_messages (id, conversation_id, role, content, provider, model, created_at)
      VALUES (?, ?, 'user', ?, 'user', NULL, ?)
    `).run(createId("ai-message"), conversation.id, prompt, now());
    const context = buildAIContext(user, contextCourseId);
    const reply = await generateTeachingReply({ prompt, history, context });
    db.prepare(`
      INSERT INTO ai_messages (id, conversation_id, role, content, provider, model, created_at)
      VALUES (?, ?, 'assistant', ?, ?, ?, ?)
    `).run(createId("ai-message"), conversation.id, reply.content, reply.provider, reply.model, now());
    db.prepare("UPDATE ai_conversations SET updated_at = ? WHERE id = ?").run(now(), conversation.id);
    return sendJson(res, 200, {
      conversationId: conversation.id,
      reply: {
        role: "assistant",
        content: reply.content,
        provider: reply.provider,
        model: reply.model,
        fallback: Boolean(reply.fallback),
        warning: reply.warning || null
      },
      status: getAIStatus()
    });
  }

  const conversationMatch = pathname.match(/^\/api\/ai\/conversations\/([^/]+)$/);
  if (conversationMatch && method === "DELETE") {
    const conversation = db.prepare("SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?").get(conversationMatch[1], user.id);
    if (!conversation) throw new HttpError(404, "对话不存在");
    db.prepare("DELETE FROM ai_conversations WHERE id = ?").run(conversation.id);
    return sendJson(res, 200, { ok: true });
  }

  if (method === "PATCH" && pathname === "/api/profile") {
    const body = await readJson(req);
    const name = validateName(body.name ?? user.name);
    const email = normalizeEmail(body.email ?? user.email);
    db.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").run(name, email, user.id);
    return sendJson(res, 200, { user: getPublicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(user.id)) });
  }

  if (method === "POST" && pathname === "/api/profile/password") {
    const body = await readJson(req);
    if (!verifyPassword(String(body.currentPassword || ""), user.password_hash)) {
      throw new HttpError(401, "当前密码不正确");
    }
    const nextPassword = validatePassword(body.newPassword);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(nextPassword), user.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    const cookie = issueSession(req, res, user);
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": cookie });
  }

  throw new HttpError(404, "接口不存在");
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

function serveStatic(req, res, url) {
  if (!existsSync(distDir)) {
    return sendJson(res, 503, {
      error: "前端尚未构建",
      hint: "开发模式请运行 pnpm dev；生产模式请先运行 pnpm build 再运行 pnpm start。"
    });
  }
  if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "请求方法不受支持");
  let relativePath = decodeURIComponent(url.pathname);
  if (relativePath === "/") relativePath = "/index.html";
  const candidate = path.resolve(distDir, `.${relativePath}`);
  if (!candidate.startsWith(`${distDir}${path.sep}`) && candidate !== path.join(distDir, "index.html")) {
    throw new HttpError(403, "路径无效");
  }
  let filePath = candidate;
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = path.join(distDir, "index.html");
  }
  const ext = path.extname(filePath).toLowerCase();
  const stat = statSync(filePath);
  const cacheControl = filePath.includes(`${path.sep}assets${path.sep}`)
    ? "public, max-age=31536000, immutable"
    : "no-cache";
  res.writeHead(
    200,
    securityHeaders({
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": cacheControl,
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    })
  );
  if (req.method === "HEAD") return res.end();
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    checkOrigin(req);
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (error) {
    if (!res.headersSent) sendError(res, error);
    else res.destroy();
  }
});

cleanupSessions();
setInterval(cleanupSessions, 60 * 60 * 1000).unref();

server.listen(config.port, "127.0.0.1", () => {
  console.log(`[知澜智慧校园] Server: http://127.0.0.1:${config.port}`);
  console.log(`[知澜智慧校园] AI mode: ${getAIStatus().mode} (${getAIStatus().model})`);
  if (seeded) console.log("[知澜智慧校园] Database seeded with demo campus data");
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
