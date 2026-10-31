import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import "./config.mjs";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(serverDir, "..");
const dataDir = path.join(projectRoot, "data");
mkdirSync(dataDir, { recursive: true });

export const dbPath = process.env.DATABASE_PATH || path.join(dataDir, "zhilan.db");
export const db = new DatabaseSync(dbPath);

db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [salt, expectedHex] = String(storedHash).split(":");
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSessionToken() {
  return randomBytes(32).toString("hex");
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function offsetIso(days, hour = 23, minute = 59) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function dateOnly(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function initializeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('student', 'teacher')),
      identifier TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT NOT NULL,
      department TEXT NOT NULL,
      title TEXT,
      class_name TEXT,
      avatar_color TEXT NOT NULL DEFAULT '#0d746d',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      teacher_id TEXT NOT NULL REFERENCES users(id),
      term TEXT NOT NULL,
      description TEXT NOT NULL,
      schedule TEXT NOT NULL,
      room TEXT NOT NULL,
      credits REAL NOT NULL,
      cover TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS enrollments (
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
      grade REAL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (student_id, course_id)
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'assignment',
      due_at TEXT NOT NULL,
      max_score REAL NOT NULL DEFAULT 100,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      score REAL,
      feedback TEXT,
      graded_at TEXT,
      graded_by TEXT REFERENCES users(id),
      UNIQUE (assignment_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS attendance_sessions (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      teacher_id TEXT NOT NULL REFERENCES users(id),
      session_date TEXT NOT NULL,
      topic TEXT NOT NULL,
      check_in_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      opened_at TEXT NOT NULL,
      closes_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('present', 'late', 'leave', 'absent')),
      checked_at TEXT NOT NULL,
      note TEXT,
      PRIMARY KEY (session_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL REFERENCES users(id),
      scope TEXT NOT NULL CHECK (scope IN ('campus', 'course')),
      course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'important')),
      published_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      kind TEXT NOT NULL,
      link_view TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      due_at TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS study_records (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      studied_on TEXT NOT NULL,
      minutes INTEGER NOT NULL,
      score REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_course ON assignments(course_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_course ON attendance_sessions(course_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_study_student_date ON study_records(student_id, studied_on);
    CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations(user_id, updated_at);
  `);
}

function seedDatabase() {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM users").get();
  if (existing.count > 0) return false;

  const studentPassword = process.env.SEED_STUDENT_PASSWORD || "Campus@2026";
  const teacherPassword = process.env.SEED_TEACHER_PASSWORD || "Teacher@2026";
  const createdAt = nowIso();

  const users = [
    ["u-teacher-1", "teacher", "T1001", "张明远", teacherPassword, "zhang.mingyuan@zhilan.edu.cn", "人工智能学院", "副教授", null, "#2c6e7f"],
    ["u-teacher-2", "teacher", "T1002", "陈晓岚", teacherPassword, "chen.xiaolan@zhilan.edu.cn", "数字媒体学院", "讲师", null, "#b15f56"],
    ["u-student-1", "student", "2024001", "林以安", studentPassword, "lin.yian@zhilan.edu.cn", "数字媒体技术", null, "数字媒体技术 2401", "#0d746d"],
    ["u-student-2", "student", "2024002", "周明", studentPassword, "zhou.ming@zhilan.edu.cn", "数字媒体技术", null, "数字媒体技术 2401", "#476f83"],
    ["u-student-3", "student", "2024003", "陈语", studentPassword, "chen.yu@zhilan.edu.cn", "数字媒体技术", null, "数字媒体技术 2401", "#c47a42"],
    ["u-student-4", "student", "2024004", "许知远", studentPassword, "xu.zhiyuan@zhilan.edu.cn", "数字媒体技术", null, "数字媒体技术 2401", "#6a6f9d"],
    ["u-student-5", "student", "2024005", "周一鸣", studentPassword, "zhou.yiming@zhilan.edu.cn", "数字媒体技术", null, "数字媒体技术 2401", "#57816d"],
    ["u-student-6", "student", "2024006", "宋清禾", studentPassword, "song.qinghe@zhilan.edu.cn", "数字媒体技术", null, "数字媒体技术 2401", "#a26f87"]
  ];

  const insertUser = db.prepare(`
    INSERT INTO users (id, role, identifier, name, password_hash, email, department, title, class_name, avatar_color, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [id, role, identifier, name, password, email, department, title, className, color] of users) {
    insertUser.run(id, role, identifier, name, hashPassword(password), email, department, title, className, color, createdAt);
  }

  const insertCourse = db.prepare(`
    INSERT INTO courses (id, code, name, teacher_id, term, description, schedule, room, credits, cover, color, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const courses = [
    ["course-math", "MATH204", "概率论与数理统计", "u-teacher-1", "2026 秋季学期", "从随机事件与条件概率出发，建立数据分析、贝叶斯推断与统计决策的基础。", "周一 08:00-09:40", "博学楼 A302", 3, "/assets/course-statistics.jpg", "teal"],
    ["course-robotics", "AI301", "机器人感知基础", "u-teacher-2", "2026 秋季学期", "学习视觉、雷达与多传感器融合，完成机器人环境感知和标定实验。", "周三 14:00-15:40", "工程中心 B207", 3.5, "/assets/course-robotics.jpg", "coral"],
    ["course-english", "ENG206", "学术英语表达", "u-teacher-2", "2026 秋季学期", "训练学术阅读、论证写作与研究成果口头表达，强调逻辑与证据。", "周四 10:00-11:40", "文汇楼 C108", 2, "/assets/course-language.jpg", "gold"]
  ];
  for (const course of courses) insertCourse.run(...course, createdAt);

  const enrollments = [
    ["u-student-1", "course-math", 38, 86],
    ["u-student-1", "course-robotics", 62, 73],
    ["u-student-1", "course-english", 71, 75],
    ["u-student-2", "course-math", 65, 82],
    ["u-student-3", "course-math", 72, 89],
    ["u-student-4", "course-math", 55, 76],
    ["u-student-5", "course-math", 81, 92],
    ["u-student-6", "course-math", 47, 79],
    ["u-student-2", "course-robotics", 69, 84],
    ["u-student-3", "course-robotics", 58, 78],
    ["u-student-4", "course-robotics", 44, 70],
    ["u-student-2", "course-english", 77, 88],
    ["u-student-3", "course-english", 68, 81],
    ["u-student-6", "course-english", 53, 77]
  ];
  const insertEnrollment = db.prepare(`
    INSERT INTO enrollments (student_id, course_id, progress, grade, joined_at) VALUES (?, ?, ?, ?, ?)
  `);
  for (const row of enrollments) insertEnrollment.run(...row, createdAt);

  const assignments = [
    ["assignment-math-1", "course-math", "条件概率情境判断", "完成 2 道情境判断题，并说明你如何划分已知事件与目标事件。答案需体现推理过程。", "homework", offsetIso(1, 22), 100, "u-teacher-1"],
    ["assignment-math-2", "course-math", "贝叶斯检测案例分析", "基于医学检测案例，使用树状图计算后验概率，并解释基础患病率对结果的影响。", "analysis", offsetIso(4, 23), 100, "u-teacher-1"],
    ["assignment-robot-1", "course-robotics", "相机标定实验报告", "提交相机内参标定流程、误差分析与至少一次复现实验记录。", "report", offsetIso(3, 20), 100, "u-teacher-2"],
    ["assignment-english-1", "course-english", "Research Argument Rewrite", "Rewrite the introduction of your research summary with a clear claim, evidence, and counterargument.", "writing", offsetIso(6, 18), 100, "u-teacher-2"]
  ];
  const insertAssignment = db.prepare(`
    INSERT INTO assignments (id, course_id, title, description, type, due_at, max_score, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of assignments) insertAssignment.run(...row, createdAt);

  const submissions = [
    ["submission-math-1", "assignment-math-1", "u-student-2", "我先将“已知检测对象属于高风险人群”设为事件 B，再以“后续检测为阳性”为目标事件 A。根据条件概率定义，P(A|B)=P(A∩B)/P(B)。第二题使用同样方法，并用样本空间缩小来解释。", offsetIso(-1, 19), null, null, null, null],
    ["submission-math-2", "assignment-math-2", "u-student-3", "树状图第一层区分患病与未患病，第二层区分阳性与阴性。最终将真阳性结果除以全部阳性结果，得到约 9% 的后验概率。", offsetIso(-1, 20), null, null, null, null],
    ["submission-math-3", "assignment-math-1", "u-student-3", "已知事件是抽到选修物理的学生，新的样本空间为物理学生集合。交集是同时选修数学与物理的学生，所以用交集人数除以物理学生人数。", offsetIso(-2, 18), 88, "推理清楚，但第二题还应写出事件定义。", offsetIso(-1, 9), "u-teacher-1"]
  ];
  const insertSubmission = db.prepare(`
    INSERT INTO submissions (id, assignment_id, student_id, content, submitted_at, score, feedback, graded_at, graded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of submissions) insertSubmission.run(...row);

  const sessionId = "attendance-math-today";
  db.prepare(`
    INSERT INTO attendance_sessions (id, course_id, teacher_id, session_date, topic, check_in_code, status, opened_at, closes_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(sessionId, "course-math", "u-teacher-1", dateOnly(0), "条件概率与全概率公式", "8246", nowIso(), offsetIso(0, 23, 59));

  const attendanceRecords = [
    [sessionId, "u-student-2", "present", offsetIso(0, 7, 54), null],
    [sessionId, "u-student-3", "present", offsetIso(0, 7, 57), null],
    [sessionId, "u-student-4", "late", offsetIso(0, 8, 12), "交通延误"],
    [sessionId, "u-student-5", "present", offsetIso(0, 7, 50), null],
    [sessionId, "u-student-6", "leave", offsetIso(0, 7, 30), "已提交病假"]
  ];
  const insertAttendance = db.prepare(`
    INSERT INTO attendance_records (session_id, student_id, status, checked_at, note) VALUES (?, ?, ?, ?, ?)
  `);
  for (const row of attendanceRecords) insertAttendance.run(...row);

  const historicalStudents = ["u-student-1", "u-student-2", "u-student-3", "u-student-4", "u-student-5", "u-student-6"];
  for (let index = 1; index <= 4; index += 1) {
    const historicalSessionId = `attendance-math-history-${index}`;
    db.prepare(`
      INSERT INTO attendance_sessions (id, course_id, teacher_id, session_date, topic, check_in_code, status, opened_at, closes_at)
      VALUES (?, ?, ?, ?, ?, ?, 'closed', ?, ?)
    `).run(
      historicalSessionId,
      "course-math",
      "u-teacher-1",
      dateOnly(-2 * index),
      index === 1 ? "随机事件与样本空间" : index === 2 ? "概率公理与性质" : index === 3 ? "古典概型" : "条件概率初步",
      String(8170 + index),
      offsetIso(-2 * index, 7, 40),
      offsetIso(-2 * index, 9, 50)
    );
    historicalStudents.forEach((studentId, studentIndex) => {
      let status = "present";
      let note = null;
      if ((studentIndex + index) % 9 === 0) {
        status = "leave";
        note = "已提交请假";
      } else if ((studentIndex + index) % 7 === 0) {
        status = "late";
        note = "迟到 8 分钟";
      }
      insertAttendance.run(
        historicalSessionId,
        studentId,
        status,
        offsetIso(-2 * index, 7, 45 + studentIndex),
        note
      );
    });
  }

  const announcements = [
    ["announcement-1", "u-teacher-1", "campus", null, "本周智慧教室直播安排", "本周三 19:00 将在智慧教室进行“贝叶斯思维”公开课，可在课堂互动页预约并查看回放。", "important", offsetIso(-1, 9)],
    ["announcement-2", "u-teacher-1", "course", "course-math", "条件概率作业说明", "本次作业重点是写清已知事件与目标事件。系统会在提交后保存版本，截止前可重复修改。", "normal", offsetIso(-2, 10)],
    ["announcement-3", "u-teacher-2", "course", "course-robotics", "实验设备预约", "工程中心 B207 的设备预约已开放，请以小组为单位完成标定实验。", "normal", offsetIso(-3, 15)]
  ];
  const insertAnnouncement = db.prepare(`
    INSERT INTO announcements (id, author_id, scope, course_id, title, content, priority, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of announcements) insertAnnouncement.run(...row);

  const notifications = [
    ["notification-1", "u-student-1", "概率论作业将在明天截止", "“条件概率情境判断”还剩 1 天截止，建议预留 18 分钟完成。", "assignment", "assignments", offsetIso(0, 8)],
    ["notification-2", "u-student-1", "今天的课堂签到已开放", "概率论与数理统计签到码为 8246，请在课程考勤页完成签到。", "attendance", "attendance", offsetIso(0, 7)],
    ["notification-3", "u-teacher-1", "有 2 份作业等待批改", "学生已提交条件概率与贝叶斯案例作业，请及时给出反馈。", "grading", "assignments", offsetIso(0, 8)],
    ["notification-4", "u-teacher-2", "机器人实验报告待查看", "已有 3 个小组上传实验记录。", "assignment", "assignments", offsetIso(-1, 16)]
  ];
  const insertNotification = db.prepare(`
    INSERT INTO notifications (id, user_id, title, content, kind, link_view, read_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
  `);
  for (const row of notifications) insertNotification.run(...row);

  const tasks = [
    ["task-1", "u-student-1", "course-math", "复习条件概率定义", offsetIso(0, 11), "high", 1],
    ["task-2", "u-student-1", "course-math", "完成条件概率情境判断题", offsetIso(0, 18), "high", 0],
    ["task-3", "u-student-1", "course-robotics", "整理相机标定实验数据", offsetIso(1, 20), "normal", 0],
    ["task-4", "u-student-1", "course-english", "阅读两篇论证结构范文", offsetIso(2, 20), "normal", 0]
  ];
  const insertTask = db.prepare(`
    INSERT INTO tasks (id, user_id, course_id, title, due_at, priority, completed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of tasks) insertTask.run(...row, createdAt);

  const studyScores = [74, 80, 68, 86, 82, 91, 88, 79, 84, 90, 87, 93, 89, 95];
  const studyMinutes = [42, 68, 35, 82, 54, 96, 73, 48, 75, 39, 88, 64, 102, 71];
  const insertStudy = db.prepare(`
    INSERT INTO study_records (id, student_id, course_id, studied_on, minutes, score, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (let index = 0; index < 14; index += 1) {
    insertStudy.run(
      `study-${index + 1}`,
      "u-student-1",
      index % 3 === 0 ? "course-math" : index % 3 === 1 ? "course-robotics" : "course-english",
      dateOnly(index - 13),
      studyMinutes[index],
      studyScores[index],
      createdAt
    );
  }

  return true;
}

initializeSchema();
export const seeded = seedDatabase();

export function cleanupSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowIso());
}

export function isoNow() {
  return nowIso();
}

export function getPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    role: user.role,
    identifier: user.identifier,
    name: user.name,
    email: user.email,
    department: user.department,
    title: user.title || null,
    className: user.class_name || null,
    avatarColor: user.avatar_color
  };
}
