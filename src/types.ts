export type Role = "student" | "teacher";
export type ViewName =
  | "dashboard"
  | "courses"
  | "assignments"
  | "ai"
  | "attendance"
  | "analytics"
  | "announcements";

export interface User {
  id: string;
  role: Role;
  identifier: string;
  name: string;
  email: string;
  department: string;
  title: string | null;
  className: string | null;
  avatarColor: string;
}

export interface AIStatus {
  mode: "remote" | "local";
  configured: boolean;
  provider: string;
  model: string;
  notice: string;
}

export interface Course {
  id: string;
  code: string;
  name: string;
  teacherId: string;
  teacherName: string;
  term: string;
  description: string;
  schedule: string;
  room: string;
  credits: number;
  cover: string;
  color: "teal" | "coral" | "gold";
  progress: number | null;
  grade: number | null;
  studentCount: number;
  averageProgress: number | null;
  averageGrade: number | null;
}

export interface Assignment {
  id: string;
  courseId: string;
  courseName: string;
  courseCode: string;
  title: string;
  description: string;
  type: string;
  dueAt: string;
  maxScore: number;
  createdAt: string;
  submissionId?: string | null;
  submissionContent?: string | null;
  submittedAt?: string | null;
  score?: number | null;
  feedback?: string | null;
  gradedAt?: string | null;
  submissionCount?: number | null;
  gradedCount?: number | null;
  studentCount?: number | null;
}

export interface Task {
  id: string;
  courseId: string | null;
  courseName: string | null;
  title: string;
  dueAt: string | null;
  priority: "high" | "normal" | "low";
  completed: boolean;
}

export interface Notification {
  id: string;
  title: string;
  content: string;
  kind: string;
  view: string | null;
  read: boolean;
  createdAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  scope: "campus" | "course";
  priority: "normal" | "important";
  courseId: string | null;
  courseName: string | null;
  authorName: string;
  publishedAt: string;
}

export interface StudyPoint {
  date: string;
  minutes: number;
  score: number | null;
}

export interface OpenAttendance {
  id: string;
  courseId: string;
  courseName: string;
  courseCode: string;
  topic: string;
  closesAt: string;
}

export interface UngradedSubmission {
  id: string;
  assignmentId: string;
  studentId: string;
  studentName: string;
  courseId: string;
  courseName: string;
  title: string;
  maxScore: number;
  submittedAt: string;
  content: string;
}

export interface TeacherSession {
  id: string;
  courseId: string;
  courseName: string;
  courseCode: string;
  topic: string;
  checkInCode: string;
  closesAt: string;
  checkedIn: number;
  studentCount: number;
}

export interface StudentDashboard {
  role: "student";
  stats: {
    studyMinutes: number;
    pendingAssignments: number;
    averageGrade: number | null;
    attendanceRate: number;
    streak: number;
  };
  courses: Course[];
  assignments: Assignment[];
  tasks: Task[];
  notifications: Notification[];
  announcements: Announcement[];
  studySeries: StudyPoint[];
  openAttendance: OpenAttendance | null;
}

export interface StudentOverview {
  id: string;
  name: string;
  identifier: string;
  avatarColor: string;
  progress: number;
  grade: number | null;
  attendanceRate: number;
  submittedCount: number;
}

export interface GradeBand {
  label: string;
  count: number;
}

export interface TeacherAnalytics {
  course: Course;
  metrics: {
    studentCount: number;
    averageGrade: number | null;
    averageProgress: number;
    attendanceRate: number;
    atRiskCount: number;
  };
  students: StudentOverview[];
  assignments: Array<{
    id: string;
    title: string;
    submissions: number;
    averageScore: number | null;
    maxScore: number;
  }>;
  gradeBands: GradeBand[];
}

export interface TeacherDashboard {
  role: "teacher";
  stats: {
    courseCount: number;
    studentCount: number;
    ungradedCount: number;
    averageProgress: number;
    averageGrade: number | null;
  };
  courses: Course[];
  assignments: Assignment[];
  ungraded: UngradedSubmission[];
  openSessions: TeacherSession[];
  notifications: Notification[];
  announcements: Announcement[];
  analytics: TeacherAnalytics | null;
}

export type DashboardData = StudentDashboard | TeacherDashboard;

export interface AttendanceSession {
  id: string;
  courseId: string;
  courseName: string;
  courseCode: string;
  date: string;
  topic: string;
  status: "open" | "closed";
  closesAt: string;
  checkInCode?: string;
  checkedIn?: number;
  studentCount?: number;
  recordStatus?: "present" | "late" | "leave" | "absent" | null;
  ownStatus?: "present" | "late" | "leave" | "absent" | null;
  checkedAt?: string | null;
  note?: string | null;
}

export interface AttendanceRosterEntry {
  id: string;
  name: string;
  identifier: string;
  avatarColor: string;
  status: "present" | "late" | "leave" | "absent";
  checkedAt: string | null;
  note: string | null;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  provider?: string;
  model?: string | null;
  createdAt?: string;
}

export interface Conversation {
  id: string;
  courseId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
}

export interface SubmissionRecord {
  id: string;
  studentId: string;
  studentName: string;
  identifier: string;
  avatarColor: string;
  content: string;
  submittedAt: string;
  score: number | null;
  feedback: string | null;
  gradedAt: string | null;
}

export interface CourseDetail {
  course: Course;
  assignments: Assignment[];
  announcements: Announcement[];
  attendanceSessions: AttendanceSession[];
  roster: Array<{
    id: string;
    name: string;
    identifier: string;
    avatarColor: string;
    progress: number;
    grade: number | null;
  }>;
}

export interface StudentAnalytics {
  metrics: {
    studyMinutes: number;
    averageGrade: number | null;
    courseCount: number;
    attendanceRate: number;
    completedAssignments: number;
  };
  courseMastery: Array<{
    id: string;
    name: string;
    code: string;
    progress: number;
    grade: number | null;
    color: string;
  }>;
  studySeries: StudyPoint[];
  submissions: Array<{
    score: number;
    maxScore: number;
    title: string;
    courseName: string;
  }>;
  attendance: {
    total: number;
    present: number;
    leave: number;
    absent: number;
  };
}

export interface ToastState {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
}
