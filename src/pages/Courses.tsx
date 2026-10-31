import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  GraduationCap,
  MapPin,
  Plus,
  Search,
  UserPlus,
  UsersRound
} from "lucide-react";
import { api, ApiError } from "../api";
import type { Course, CourseDetail, User, ViewName } from "../types";
import {
  Avatar,
  EmptyState,
  formatDate,
  FormError,
  LoadingBlock,
  Modal,
  PageHeading,
  StatusBadge
} from "../components/ui";

type Notify = (message: string, tone?: "success" | "error" | "info") => void;
type DetailTab = "overview" | "assignments" | "attendance";

export default function Courses({
  user,
  initialCourseId,
  onNavigate,
  onRefresh,
  realtimeVersion,
  notify
}: {
  user: User;
  initialCourseId?: string;
  onNavigate: (view: ViewName) => void;
  onRefresh: () => Promise<void>;
  realtimeVersion: number;
  notify: Notify;
}) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialCourseId || null);
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [search, setSearch] = useState("");
  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);

  const isTeacher = user.role === "teacher";

  const loadCourses = async (preferredId?: string) => {
    setLoading(true);
    try {
      const result = await api.courses();
      setCourses(result.courses);
      const nextId =
        preferredId ||
        selectedId ||
        result.courses[0]?.id ||
        null;
      setSelectedId(nextId && result.courses.some((course) => course.id === nextId) ? nextId : result.courses[0]?.id || null);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "课程列表加载失败", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCourses(initialCourseId);
  }, [initialCourseId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    api.course(selectedId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((error) => {
        if (!cancelled) notify(error instanceof ApiError ? error.message : "课程详情加载失败", "error");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || realtimeVersion === 0) return;
    let cancelled = false;
    api.course(selectedId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((error) => {
        if (!cancelled) notify(error instanceof ApiError ? error.message : "课程详情实时同步失败", "error");
      });
    return () => {
      cancelled = true;
    };
  }, [realtimeVersion]);

  const filteredCourses = courses.filter((course) =>
    `${course.name} ${course.code} ${course.teacherName}`.toLowerCase().includes(search.toLowerCase())
  );

  const courseCreated = async () => {
    setCourseModalOpen(false);
    await loadCourses();
    await onRefresh();
    notify("新课程已创建");
  };

  const enrolled = async () => {
    setEnrollModalOpen(false);
    if (selectedId) {
      const result = await api.course(selectedId);
      setDetail(result);
    }
    await loadCourses(selectedId || undefined);
    await onRefresh();
  };

  return (
    <>
      <PageHeading
        eyebrow={isTeacher ? "课程建设与班级管理" : "课程学习与进度"}
        title={isTeacher ? "课程管理" : "我的课程"}
        description={
          isTeacher
            ? "维护课程信息、学生名单、教学任务与课堂考勤。"
            : "查看课程安排、学习进度、作业要求与课堂考勤。"
        }
        actions={
          isTeacher ? (
            <button className="button primary" type="button" onClick={() => setCourseModalOpen(true)}>
              <Plus size={16} /> 新建课程
            </button>
          ) : (
            <button className="button ghost" type="button" onClick={() => onNavigate("attendance")}>
              <CalendarClock size={16} /> 查看签到
            </button>
          )
        }
      />

      <div className="courses-layout">
        <aside className="panel course-list-panel">
          <div className="course-list-header">
            <div><span className="eyebrow">课程列表</span><h2>{courses.length} 门课程</h2></div>
            <div className="inline-search">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索课程" aria-label="搜索课程" />
            </div>
          </div>
          {loading ? (
            <LoadingBlock label="正在加载课程…" />
          ) : filteredCourses.length ? (
            <div className="course-list-items">
              {filteredCourses.map((course) => (
                <button
                  key={course.id}
                  type="button"
                  className={`course-list-item ${selectedId === course.id ? "active" : ""}`}
                  onClick={() => {
                    setSelectedId(course.id);
                    setTab("overview");
                  }}
                >
                  <span className={`course-accent ${course.color}`}>{course.code.slice(0, 2)}</span>
                  <span>
                    <strong>{course.name}</strong>
                    <small>{course.code} · {course.teacherName}</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon={<BookOpen />} title="没有匹配课程" description="调整搜索词或创建新课程。" />
          )}
        </aside>

        <section className="course-detail-area">
          {detailLoading ? (
            <div className="panel detail-loading"><LoadingBlock label="正在加载课程详情…" /></div>
          ) : detail ? (
            <>
              <article className="course-detail-hero">
                <div className="course-detail-cover">
                  <img src={detail.course.cover} alt={`${detail.course.name}课程配图`} />
                  <span>{detail.course.code}</span>
                </div>
                <div className="course-detail-copy">
                  <div className="course-meta-row">
                    <StatusBadge tone={detail.course.color}>{detail.course.term}</StatusBadge>
                    <span>{detail.course.credits} 学分</span>
                  </div>
                  <h2>{detail.course.name}</h2>
                  <p>{detail.course.description}</p>
                  <div className="course-detail-meta">
                    <span><CalendarClock size={15} /> {detail.course.schedule}</span>
                    <span><MapPin size={15} /> {detail.course.room}</span>
                    <span><UsersRound size={15} /> {detail.course.studentCount} 名学生</span>
                  </div>
                  <div className="course-detail-actions">
                    {isTeacher ? (
                      <>
                        <button className="button primary" type="button" onClick={() => setEnrollModalOpen(true)}>
                          <UserPlus size={16} /> 添加学生
                        </button>
                        <button className="button ghost" type="button" onClick={() => onNavigate("assignments")}>
                          <ClipboardCheck size={16} /> 发布作业
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="button primary" type="button" onClick={() => onNavigate("assignments")}>
                          <ClipboardCheck size={16} /> 查看作业
                        </button>
                        <button className="button ghost" type="button" onClick={() => onNavigate("ai")}>
                          <GraduationCap size={16} /> 询问 AI
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="course-detail-score">
                  <span>{isTeacher ? "平均成绩" : "当前成绩"}</span>
                  <strong>{isTeacher ? detail.course.averageGrade ?? "—" : detail.course.grade ?? "—"}</strong>
                  <small>{isTeacher ? `平均进度 ${detail.course.averageProgress ?? 0}%` : `进度 ${detail.course.progress ?? 0}%`}</small>
                </div>
              </article>

              <div className="detail-tabs" role="tablist">
                <button type="button" className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
                  <BookOpen size={15} /> 课程概览
                </button>
                <button type="button" className={tab === "assignments" ? "active" : ""} onClick={() => setTab("assignments")}>
                  <ClipboardCheck size={15} /> 作业 {detail.assignments.length}
                </button>
                <button type="button" className={tab === "attendance" ? "active" : ""} onClick={() => setTab("attendance")}>
                  <CalendarClock size={15} /> 考勤 {detail.attendanceSessions.length}
                </button>
              </div>

              {tab === "overview" && (
                <div className="course-overview-grid">
                  <section className="panel">
                    <header className="panel-header"><div><span className="eyebrow">最近任务</span><h2>课程作业</h2></div></header>
                    <div className="assignment-compact-list">
                      {detail.assignments.slice(0, 3).map((assignment) => (
                        <button type="button" key={assignment.id} onClick={() => onNavigate("assignments")}>
                          <span className="assignment-type"><ClipboardCheck size={16} /></span>
                          <span><strong>{assignment.title}</strong><small>截止 {formatDate(assignment.dueAt)}</small></span>
                          <ArrowRight size={15} />
                        </button>
                      ))}
                      {!detail.assignments.length && <p className="list-empty">当前课程暂无作业。</p>}
                    </div>
                  </section>
                  <section className="panel">
                    <header className="panel-header"><div><span className="eyebrow">课程通知</span><h2>最新公告</h2></div></header>
                    <div className="announcement-compact-list">
                      {detail.announcements.slice(0, 3).map((announcement) => (
                        <button type="button" key={announcement.id} onClick={() => onNavigate("announcements")}>
                          <span className="announcement-line" />
                          <span><strong>{announcement.title}</strong><small>{formatDate(announcement.publishedAt, false)}</small></span>
                        </button>
                      ))}
                      {!detail.announcements.length && <p className="list-empty">当前课程暂无公告。</p>}
                    </div>
                  </section>
                  {isTeacher && (
                    <section className="panel roster-panel">
                      <header className="panel-header"><div><span className="eyebrow">学生名册</span><h2>{detail.roster.length} 名学生</h2></div></header>
                      <div className="roster-grid">
                        {detail.roster.map((student) => (
                          <div key={student.id}>
                            <Avatar name={student.name} color={student.avatarColor} size="small" />
                            <span><strong>{student.name}</strong><small>{student.identifier}</small></span>
                            <span className="roster-progress">{student.progress}%</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}

              {tab === "assignments" && (
                <section className="panel course-tab-panel">
                  <header className="panel-header">
                    <div><span className="eyebrow">课程任务</span><h2>全部作业</h2></div>
                    <button className="text-button" type="button" onClick={() => onNavigate("assignments")}>进入作业中心 <ArrowRight size={14} /></button>
                  </header>
                  <div className="detail-assignment-list">
                    {detail.assignments.map((assignment) => (
                      <button type="button" key={assignment.id} onClick={() => onNavigate("assignments")}>
                        <span className="assignment-date">
                          <strong>{new Date(assignment.dueAt).getDate()}</strong>
                          <small>{new Date(assignment.dueAt).toLocaleDateString("zh-CN", { month: "short" })}</small>
                        </span>
                        <span>
                          <strong>{assignment.title}</strong>
                          <p>{assignment.description}</p>
                          <small>{isTeacher ? `${assignment.submissionCount || 0} / ${assignment.studentCount || 0} 人提交` : assignment.submissionId ? "已提交" : "待提交"}</small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {tab === "attendance" && (
                <section className="panel course-tab-panel">
                  <header className="panel-header">
                    <div><span className="eyebrow">课堂记录</span><h2>考勤场次</h2></div>
                    <button className="text-button" type="button" onClick={() => onNavigate("attendance")}>进入考勤中心 <ArrowRight size={14} /></button>
                  </header>
                  <div className="course-attendance-list">
                    {detail.attendanceSessions.map((session) => (
                      <div key={session.id}>
                        <span className="attendance-status-icon"><CheckCircle2 size={16} /></span>
                        <span>
                          <strong>{session.topic}</strong>
                          <small>{session.date} · {session.status === "open" ? "签到进行中" : "签到已关闭"}</small>
                        </span>
                        {isTeacher ? (
                          <StatusBadge tone={session.status === "open" ? "teal" : "neutral"}>
                            {session.checkedIn ?? 0} / {session.studentCount ?? 0} 已签到
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone={session.ownStatus === "present" ? "teal" : session.ownStatus === "late" ? "gold" : session.ownStatus === "leave" ? "blue" : "neutral"}>
                            {session.ownStatus === "present" ? "已签到" : session.ownStatus === "late" ? "迟到" : session.ownStatus === "leave" ? "请假" : session.ownStatus === "absent" ? "缺勤" : "未签到"}
                          </StatusBadge>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <div className="panel detail-loading">
              <EmptyState icon={<BookOpen />} title="选择一门课程" description="从左侧课程列表中选择课程查看详情。" />
            </div>
          )}
        </section>
      </div>

      <CreateCourseModal
        open={courseModalOpen}
        onClose={() => setCourseModalOpen(false)}
        onCreated={courseCreated}
      />
      <EnrollModal
        open={enrollModalOpen}
        course={detail?.course || null}
        onClose={() => setEnrollModalOpen(false)}
        onEnrolled={enrolled}
      />
    </>
  );
}

function CreateCourseModal({
  open,
  onClose,
  onCreated
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: "",
    code: "",
    term: "2026 秋季学期",
    description: "",
    schedule: "",
    room: "",
    credits: "2",
    color: "teal"
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createCourse({ ...form, credits: Number(form.credits) });
      setForm({ name: "", code: "", term: "2026 秋季学期", description: "", schedule: "", room: "", credits: "2", color: "teal" });
      await onCreated();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "课程创建失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="新建课程"
      description="课程创建后会立即出现在你的授课列表中。"
      onClose={onClose}
      footer={
        <>
          <button className="button ghost" type="button" onClick={onClose}>取消</button>
          <button className="button primary" type="submit" form="create-course-form" disabled={busy}>{busy ? "创建中…" : "创建课程"}</button>
        </>
      }
    >
      <form className="stack-form" id="create-course-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-row form-row-two">
          <label><span>课程名称</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如 数据结构与算法" required /></label>
          <label><span>课程代码</span><input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="CS201" required /></label>
        </div>
        <div className="form-row form-row-two">
          <label><span>学期</span><input value={form.term} onChange={(event) => setForm({ ...form, term: event.target.value })} required /></label>
          <label><span>学分</span><input type="number" min="0.5" max="10" step="0.5" value={form.credits} onChange={(event) => setForm({ ...form, credits: event.target.value })} required /></label>
        </div>
        <div className="form-row form-row-two">
          <label><span>授课时间</span><input value={form.schedule} onChange={(event) => setForm({ ...form, schedule: event.target.value })} placeholder="周二 10:00-11:40" required /></label>
          <label><span>上课地点</span><input value={form.room} onChange={(event) => setForm({ ...form, room: event.target.value })} placeholder="信息楼 A201" required /></label>
        </div>
        <label><span>课程简介</span><textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="描述课程目标与主要内容" required /></label>
        <label>
          <span>课程标识色</span>
          <div className="color-choice-row">
            {(["teal", "coral", "gold"] as const).map((color) => (
              <button type="button" key={color} className={`${color} ${form.color === color ? "selected" : ""}`} onClick={() => setForm({ ...form, color })} aria-label={`选择${color}标识色`} />
            ))}
          </div>
        </label>
      </form>
    </Modal>
  );
}

function EnrollModal({
  open,
  course,
  onClose,
  onEnrolled
}: {
  open: boolean;
  course: Course | null;
  onClose: () => void;
  onEnrolled: () => Promise<void>;
}) {
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!course) return;
    setBusy(true);
    setError(null);
    try {
      await api.enroll(course.id, identifier);
      setIdentifier("");
      await onEnrolled();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "添加学生失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="添加学生"
      description={course ? `将学生加入《${course.name}》。` : "请先选择课程。"}
      onClose={onClose}
      footer={
        <>
          <button className="button ghost" type="button" onClick={onClose}>取消</button>
          <button className="button primary" type="submit" form="enroll-student-form" disabled={busy || !course}>{busy ? "添加中…" : "确认添加"}</button>
        </>
      }
    >
      <form id="enroll-student-form" className="stack-form" onSubmit={submit}>
        <FormError message={error} />
        <label><span>学生学号</span><input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="例如 2024002" autoFocus required /></label>
        <p className="form-hint">系统会校验学生账号是否存在，并发送课程加入通知。</p>
      </form>
    </Modal>
  );
}
