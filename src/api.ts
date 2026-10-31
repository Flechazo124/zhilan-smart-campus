import type {
  AIStatus,
  Announcement,
  Assignment,
  AttendanceRosterEntry,
  AttendanceSession,
  Conversation,
  Course,
  CourseDetail,
  DashboardData,
  Notification,
  Role,
  StudentAnalytics,
  SubmissionRecord,
  Task,
  TeacherAnalytics,
  User
} from "./types";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const sessionVaultKey = "zhilan.auth.vault";
const sessionTabRoleKey = "zhilan.auth.tabRole";
export const SESSION_VAULT_STORAGE_KEY = sessionVaultKey;
export const SESSION_ACTIVITY_EVENT = "zhilan-session-activity";
export const SESSION_IDLE_TIMEOUT_MS = 20 * 60 * 1000;

type SessionEntry = { lastActivity: number };
type SessionVault = { activeRole: Role | null; sessions: Partial<Record<Role, SessionEntry>> };

const emptyVault = (): SessionVault => ({ activeRole: null, sessions: {} });

function readVault(): SessionVault {
  if (typeof window === "undefined") return emptyVault();
  try {
    const payload = JSON.parse(window.localStorage.getItem(sessionVaultKey) || "null") as SessionVault | null;
    if (!payload || typeof payload !== "object" || typeof payload.sessions !== "object") return emptyVault();
    const sessions: SessionVault["sessions"] = {};
    for (const role of ["student", "teacher"] as const) {
      const candidate = (payload.sessions as Record<string, unknown>)[role];
      if (!candidate || typeof candidate !== "object") continue;
      const lastActivity = Number((candidate as { lastActivity?: unknown }).lastActivity);
      if (Number.isFinite(lastActivity)) sessions[role] = { lastActivity };
    }
    return {
      activeRole: payload.activeRole === "student" || payload.activeRole === "teacher" ? payload.activeRole : null,
      sessions
    };
  } catch {
    return emptyVault();
  }
}

function writeVault(vault: SessionVault) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(sessionVaultKey, JSON.stringify(vault));
  } catch {
    // The active role still works in memory when storage is unavailable.
  }
}

function persistCurrentSession(activateRole: boolean) {
  if (!activeSessionRole || typeof window === "undefined") return;
  const vault = readVault();
  if (activateRole) vault.activeRole = activeSessionRole;
  vault.sessions[activeSessionRole] = { lastActivity: lastSessionActivity };
  try {
    writeVault(vault);
    window.sessionStorage.setItem(sessionTabRoleKey, activeSessionRole);
  } catch {
    // The active role still works in memory when storage is unavailable.
  }
  window.dispatchEvent(new Event(SESSION_ACTIVITY_EVENT));
}

function readSessionCache() {
  if (typeof window === "undefined") return { role: null, lastActivity: 0 };
  try {
    window.sessionStorage.removeItem("zhilan.auth.token");
    window.sessionStorage.removeItem("zhilan.auth.lastActivity");
    window.localStorage.removeItem("zhilan.auth.token");
    const vault = readVault();
    const storedTabRole = window.sessionStorage.getItem(sessionTabRoleKey);
    const tabRole = storedTabRole === "student" || storedTabRole === "teacher" ? storedTabRole : null;
    for (const role of ["student", "teacher"] as const) {
      const entry = vault.sessions[role];
      if (entry && (!Number.isFinite(entry.lastActivity) || Date.now() - entry.lastActivity >= SESSION_IDLE_TIMEOUT_MS)) {
        delete vault.sessions[role];
        if (vault.activeRole === role) vault.activeRole = null;
      }
    }
    // Persist the sanitized vault so legacy token fields are removed immediately.
    writeVault(vault);
    const preferredRole = tabRole || vault.activeRole;
    const entry = preferredRole ? vault.sessions[preferredRole] : null;
    if (preferredRole && entry) {
      return { role: preferredRole, lastActivity: entry.lastActivity };
    }
    return { role: null, lastActivity: 0 };
  } catch {
    return { role: null, lastActivity: 0 };
  }
}

const cachedSession = readSessionCache();
let activeSessionRole: Role | null = cachedSession.role;
let lastSessionActivity = cachedSession.lastActivity;

export function touchSession() {
  if (!activeSessionRole || typeof window === "undefined") return;
  lastSessionActivity = Date.now();
  persistCurrentSession(false);
}

export function hasCachedSession() {
  if (!activeSessionRole) return false;
  const entry = readVault().sessions[activeSessionRole];
  if (!entry) return false;
  lastSessionActivity = entry.lastActivity;
  return Date.now() - lastSessionActivity < SESSION_IDLE_TIMEOUT_MS;
}

export function sessionRemainingMs() {
  if (!activeSessionRole) return 0;
  const entry = readVault().sessions[activeSessionRole];
  if (!entry) return 0;
  lastSessionActivity = entry.lastActivity;
  return Math.max(0, SESSION_IDLE_TIMEOUT_MS - (Date.now() - lastSessionActivity));
}

export function clearSessionCache() {
  if (typeof window !== "undefined") {
    try {
      const vault = readVault();
      if (activeSessionRole) delete vault.sessions[activeSessionRole];
      if (vault.activeRole === activeSessionRole) vault.activeRole = null;
      writeVault(vault);
      window.sessionStorage.removeItem(sessionTabRoleKey);
    } catch {
      // Ignore storage cleanup failures.
    }
  }
  activeSessionRole = null;
  lastSessionActivity = 0;
}

function saveSessionRole<T>(payload: T, role: Role): T {
  activeSessionRole = role;
  lastSessionActivity = Date.now();
  persistCurrentSession(true);
  return payload;
}

export function realtimeUrl(path: string): string {
  if (!activeSessionRole) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}role=${encodeURIComponent(activeSessionRole)}`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (activeSessionRole) {
    headers.set("X-Zhilan-Role", activeSessionRole);
  }
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "include"
  });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { error?: string };
      message = payload.error || message;
    } else if (response.status === 502) {
      message = "后端服务暂时不可用，请确认 API 已启动后重试";
    }
    throw new ApiError(response.status, message);
  }
  touchSession();
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  login: async (payload: { identifier: string; password: string; role: Role }) => {
    activeSessionRole = null;
    const result = await request<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return saveSessionRole(result, payload.role);
  },

  register: async (payload: {
    role: Role;
    identifier: string;
    name: string;
    email: string;
    password: string;
    department: string;
    className?: string;
    inviteCode?: string;
  }) => {
    activeSessionRole = null;
    const result = await request<{ user: User }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return saveSessionRole(result, payload.role);
  },

  logout: async () => {
    try {
      return await request<{ ok: true }>("/api/auth/logout", { method: "POST" });
    } finally {
      clearSessionCache();
    }
  },

  me: () => request<{ user: User; ai: AIStatus }>("/api/auth/me"),

  dashboard: () => request<DashboardData>("/api/dashboard"),

  courses: () => request<{ courses: Course[] }>("/api/courses"),

  course: (id: string) => request<CourseDetail>(`/api/courses/${encodeURIComponent(id)}`),

  createCourse: (payload: {
    name: string;
    code: string;
    term: string;
    description: string;
    schedule: string;
    room: string;
    credits: number;
    color: string;
  }) =>
    request<{ course: Course }>("/api/courses", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  enroll: (courseId: string, identifier: string) =>
    request<{ student: { id: string; name: string; identifier: string } }>(
      `/api/courses/${encodeURIComponent(courseId)}/enroll`,
      { method: "POST", body: JSON.stringify({ identifier }) }
    ),

  assignments: () => request<{ assignments: Assignment[] }>("/api/assignments"),

  createAssignment: (payload: {
    courseId: string;
    title: string;
    description: string;
    type: string;
    dueAt: string;
    maxScore: number;
  }) =>
    request<{ assignment: Assignment }>("/api/assignments", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  submitAssignment: (assignmentId: string, content: string) =>
    request<{ submission: { id: string; submittedAt: string } }>(
      `/api/assignments/${encodeURIComponent(assignmentId)}/submit`,
      { method: "POST", body: JSON.stringify({ content }) }
    ),

  submissions: (assignmentId: string) =>
    request<{
      assignment: { id: string; title: string; description: string; maxScore: number; courseName: string };
      submissions: SubmissionRecord[];
    }>(`/api/assignments/${encodeURIComponent(assignmentId)}/submissions`),

  gradeSubmission: (submissionId: string, score: number, feedback: string) =>
    request<{ ok: true; score: number; feedback: string; gradedAt: string }>(
      `/api/submissions/${encodeURIComponent(submissionId)}/grade`,
      { method: "PATCH", body: JSON.stringify({ score, feedback }) }
    ),

  tasks: () => request<{ tasks: Task[] }>("/api/tasks"),

  createTask: (payload: { title: string; courseId?: string; dueAt?: string; priority: string }) =>
    request<{ task: Task }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  updateTask: (taskId: string, completed: boolean) =>
    request<{ task: Task }>(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      body: JSON.stringify({ completed })
    }),

  deleteTask: (taskId: string) =>
    request<{ ok: true }>(`/api/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" }),

  attendance: () =>
    request<{
      sessions: AttendanceSession[];
      stats?: { total: number; attended: number; leave_count: number; absent_count: number };
    }>("/api/attendance"),

  checkIn: (sessionId: string, code: string) =>
    request<{ ok: true; courseName: string; checkedAt: string; status: string }>(
      `/api/attendance/${encodeURIComponent(sessionId)}/check-in`,
      { method: "POST", body: JSON.stringify({ code }) }
    ),

  createAttendanceSession: (payload: { courseId: string; topic: string; checkInCode: string; closesAt: string }) =>
    request<{ session: AttendanceSession }>("/api/attendance/sessions", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  attendanceRoster: (sessionId: string) =>
    request<{
      session: {
        id: string;
        courseName: string;
        courseCode: string;
        topic: string;
        checkInCode: string;
        status: string;
        closesAt: string;
      };
      roster: AttendanceRosterEntry[];
    }>(`/api/attendance/${encodeURIComponent(sessionId)}`),

  announcements: () => request<{ announcements: Announcement[] }>("/api/announcements"),

  createAnnouncement: (payload: {
    title: string;
    content: string;
    scope: "campus" | "course";
    courseId?: string;
    priority: "normal" | "important";
  }) =>
    request<{ announcement: Announcement }>("/api/announcements", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  notifications: () => request<{ notifications: Notification[] }>("/api/notifications"),

  readNotification: (id: string) =>
    request<{ ok: true }>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" }),

  readAllNotifications: () =>
    request<{ ok: true }>("/api/notifications/read-all", { method: "PATCH" }),

  analytics: (courseId?: string) =>
    request<StudentAnalytics | TeacherAnalytics>(
      courseId ? `/api/analytics?courseId=${encodeURIComponent(courseId)}` : "/api/analytics"
    ),

  aiStatus: () => request<AIStatus>("/api/ai/status"),

  conversations: () =>
    request<{ conversations: Conversation[]; status: AIStatus }>("/api/ai/conversations"),

  askAI: (payload: { message: string; conversationId?: string; courseId?: string | null }) =>
    request<{
      conversationId: string;
      reply: {
        role: "assistant";
        content: string;
        provider: string;
        model: string;
        fallback: boolean;
        warning: string | null;
      };
      status: AIStatus;
    }>("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  deleteConversation: (id: string) =>
    request<{ ok: true }>(`/api/ai/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),

  updateProfile: (payload: { name: string; email: string }) =>
    request<{ user: User }>("/api/profile", {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  changePassword: async (currentPassword: string, newPassword: string) => {
    const result = await request<{ ok: true }>("/api/profile/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword })
    });
    if (!activeSessionRole) throw new ApiError(401, "登录状态已失效，请重新登录");
    return saveSessionRole(result, activeSessionRole);
  }
};

export async function downloadFile(path: string, filename: string): Promise<void> {
  const headers = new Headers();
  if (activeSessionRole) headers.set("X-Zhilan-Role", activeSessionRole);
  const response = await fetch(path, { credentials: "include", headers });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, payload.error || "下载失败");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
