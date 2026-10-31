import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Copy,
  Flame,
  GraduationCap,
  ListChecks,
  Plus,
  Radio,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  UsersRound
} from "lucide-react";
import { api, ApiError } from "../api";
import type { Course, DashboardData, Task, User, ViewName } from "../types";
import { Avatar, dueMeta, formatDate, formatDuration, FormError, Modal, PageHeading, StatusBadge } from "../components/ui";

type Notify = (message: string, tone?: "success" | "error" | "info") => void;

export default function Dashboard({
  user,
  data,
  onNavigate,
  onRefresh,
  notify
}: {
  user: User;
  data: DashboardData | null;
  onNavigate: (view: ViewName, options?: { courseId?: string }) => void;
  onRefresh: () => Promise<void>;
  notify: Notify;
}) {
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskCourse, setTaskCourse] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskPriority, setTaskPriority] = useState("normal");
  const [taskError, setTaskError] = useState<string | null>(null);
  const [taskBusy, setTaskBusy] = useState(false);

  if (!data) {
    return (
      <div className="page-loading">
        <div className="loading-orbit"><span /></div>
        <p>正在同步校园数据…</p>
      </div>
    );
  }

  const isTeacher = data.role === "teacher";
  const courses = data.courses;
  const featuredCourse = courses[0] as Course | undefined;
  const pendingAssignments = data.assignments.filter((item) => !("submissionId" in item) || !item.submissionId);
  const unreadNotifications = data.notifications.filter((item) => !item.read);
  const completedTasks = !isTeacher ? data.tasks.filter((item) => item.completed).length : 0;

  const toggleTask = async (task: Task) => {
    try {
      await api.updateTask(task.id, !task.completed);
      await onRefresh();
      notify(task.completed ? "任务已恢复为待完成" : "任务已完成");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "任务更新失败", "error");
    }
  };

  const deleteTask = async (task: Task) => {
    if (!window.confirm(`确定删除任务“${task.title}”吗？`)) return;
    try {
      await api.deleteTask(task.id);
      await onRefresh();
      notify("任务已删除");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "任务删除失败", "error");
    }
  };

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    setTaskBusy(true);
    setTaskError(null);
    try {
      await api.createTask({
        title: taskTitle,
        courseId: taskCourse || undefined,
        dueAt: taskDue ? new Date(taskDue).toISOString() : undefined,
        priority: taskPriority
      });
      await onRefresh();
      setTaskModalOpen(false);
      setTaskTitle("");
      setTaskCourse("");
      setTaskDue("");
      notify("新任务已加入今日计划");
    } catch (error) {
      setTaskError(error instanceof ApiError ? error.message : "任务创建失败");
    } finally {
      setTaskBusy(false);
    }
  };

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    notify("签到码已复制");
  };

  return (
    <>
      <PageHeading
        eyebrow={`${new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric" })} · ${isTeacher ? "教学概览" : "学习节奏"}`}
        title={isTeacher ? `${greeting()}，${user.name.replace(/老师$/, "")}老师` : `${greeting()}，${user.name}`}
        description={
          isTeacher
            ? "查看今天需要处理的班级任务、作业反馈与课堂考勤。"
            : "从最近截止的任务开始，再用 AI 助理复盘薄弱知识点。"
        }
        actions={
          isTeacher ? (
            <>
              <button className="button ghost" type="button" onClick={() => onNavigate("attendance")}>
                <Radio size={16} /> 发起课堂签到
              </button>
              <button className="button primary" type="button" onClick={() => onNavigate("assignments")}>
                <Plus size={16} /> 发布作业
              </button>
            </>
          ) : (
            <>
              <button className="button ghost" type="button" onClick={() => onNavigate("analytics")}>
                <TrendingUp size={16} /> 查看学情
              </button>
              <button className="button primary" type="button" onClick={() => onNavigate("ai")}>
                <Sparkles size={16} /> 询问 AI 助理
              </button>
            </>
          )
        }
      />

      {!isTeacher && data.openAttendance && (
        <div className="open-attendance-banner">
          <span className="banner-icon"><CalendarClock size={19} /></span>
          <div>
            <strong>{data.openAttendance.courseName} 正在签到</strong>
            <p>{data.openAttendance.topic} · {formatDate(data.openAttendance.closesAt)} 关闭</p>
          </div>
          <button className="button small" type="button" onClick={() => onNavigate("attendance")}>
            立即签到 <ArrowRight size={14} />
          </button>
        </div>
      )}

      {isTeacher ? (
        <TeacherDashboardContent
          data={data}
          onNavigate={onNavigate}
          copyCode={copyCode}
          notify={notify}
        />
      ) : (
        <>
          <div className="stat-band">
            <StatItem icon={<Clock3 />} label="近 7 天学习" value={formatDuration(data.stats.studyMinutes)} note="专注记录已同步" tone="teal" />
            <StatItem icon={<ClipboardCheck />} label="待完成作业" value={`${data.stats.pendingAssignments} 项`} note={data.stats.pendingAssignments ? "优先处理最近截止" : "全部按时完成"} tone="coral" />
            <StatItem icon={<Target />} label="平均成绩" value={data.stats.averageGrade == null ? "—" : `${data.stats.averageGrade}`} note="按课程成绩计算" tone="gold" />
            <StatItem icon={<CheckCircle2 />} label="课堂出勤率" value={`${data.stats.attendanceRate}%`} note={`连续学习 ${data.stats.streak} 天`} tone="blue" />
          </div>

          <div className="dashboard-grid">
            <section className="panel featured-course">
              {featuredCourse ? (
                <>
                  <div className="featured-course-image">
                    <img src={featuredCourse.cover} alt={`${featuredCourse.name}课程配图`} />
                    <span><GraduationCap size={14} /> 继续学习</span>
                  </div>
                  <div className="featured-course-copy">
                    <div className="course-meta-row">
                      <StatusBadge tone="teal">{featuredCourse.code}</StatusBadge>
                      <span>{featuredCourse.teacherName} · {featuredCourse.credits} 学分</span>
                    </div>
                    <h2>{featuredCourse.name}</h2>
                    <p>{featuredCourse.description}</p>
                    <div className="course-info-row">
                      <span><CalendarClock size={14} /> {featuredCourse.schedule}</span>
                      <span><BookOpen size={14} /> {featuredCourse.room}</span>
                    </div>
                    <div className="progress-row">
                      <div>
                        <span>课程进度</span>
                        <strong>{featuredCourse.progress ?? 0}%</strong>
                      </div>
                      <div className="progress-track"><span style={{ width: `${featuredCourse.progress ?? 0}%` }} /></div>
                    </div>
                    <button className="button primary" type="button" onClick={() => onNavigate("courses", { courseId: featuredCourse.id })}>
                      进入课程 <ArrowRight size={16} />
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty-course">尚未加入课程</div>
              )}
            </section>

            <section className="ai-dashboard-card">
              <div className="ai-card-top">
                <span className="ai-orb"><Sparkles size={18} /></span>
                <StatusBadge tone="teal">AI 助理在线</StatusBadge>
              </div>
              <p className="eyebrow">基于你的真实学习数据</p>
              <h2>今天先完成最近的作业，<br />再用 15 分钟复盘条件概率。</h2>
              <div className="ai-focus-note">
                <ListChecks size={17} />
                <p>
                  你有 <strong>{data.stats.pendingAssignments}</strong> 项待完成作业，最近一项将在{" "}
                  <strong>{pendingAssignments[0] ? dueMeta(pendingAssignments[0].dueAt).label : "稍后"}</strong>截止。
                </p>
              </div>
              <div className="ai-suggestion-chips">
                <button type="button" onClick={() => onNavigate("ai")}>生成学习计划</button>
                <button type="button" onClick={() => onNavigate("ai")}>解释薄弱知识点</button>
              </div>
              <button className="ai-card-link" type="button" onClick={() => onNavigate("ai")}>
                打开 AI 学习助理 <ArrowRight size={15} />
              </button>
            </section>
          </div>

          <div className="dashboard-lower">
            <section className="panel study-chart-card">
              <header className="panel-header">
                <div>
                  <span className="eyebrow">学习投入</span>
                  <h2>近 14 天专注趋势</h2>
                </div>
                <StatusBadge tone="teal"><Flame size={13} /> 连续 {data.stats.streak} 天</StatusBadge>
              </header>
              <MiniStudyChart data={data.studySeries} />
              <div className="chart-summary">
                <span><i className="dot teal" /> 学习分钟</span>
                <span><i className="dot gold" /> 平均正确率</span>
              </div>
            </section>

            <section className="panel task-card">
              <header className="panel-header">
                <div>
                  <span className="eyebrow">今日计划</span>
                  <h2>{completedTasks} / {data.tasks.length} 已完成</h2>
                </div>
                <button className="icon-button bordered" type="button" onClick={() => setTaskModalOpen(true)} aria-label="新增任务">
                  <Plus size={17} />
                </button>
              </header>
              <div className="task-progress">
                <span style={{ width: `${data.tasks.length ? (completedTasks / data.tasks.length) * 100 : 0}%` }} />
              </div>
              <div className="task-list">
                {data.tasks.length ? data.tasks.map((task) => (
                  <div className={`task-row ${task.completed ? "completed" : ""}`} key={task.id}>
                    <button className="task-check" type="button" onClick={() => void toggleTask(task)} aria-label={task.completed ? "标记为未完成" : "标记为完成"}>
                      {task.completed && <Check size={13} />}
                    </button>
                    <div>
                      <strong>{task.title}</strong>
                      <span>{task.courseName || "个人任务"} · {task.dueAt ? formatDate(task.dueAt) : "未设置时间"}</span>
                    </div>
                    <button className="task-delete" type="button" onClick={() => void deleteTask(task)} aria-label={`删除任务 ${task.title}`}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )) : (
                  <p className="list-empty">今天还没有任务，创建一项开始学习。</p>
                )}
              </div>
            </section>
          </div>

          <div className="dashboard-lower">
            <section className="panel compact-list-card">
              <header className="panel-header">
                <div><span className="eyebrow">任务截止</span><h2>近期作业</h2></div>
                <button className="text-button" type="button" onClick={() => onNavigate("assignments")}>全部作业 <ChevronRight size={14} /></button>
              </header>
              <div className="assignment-compact-list">
                {pendingAssignments.slice(0, 3).map((assignment) => {
                  const meta = dueMeta(assignment.dueAt);
                  return (
                    <button type="button" key={assignment.id} onClick={() => onNavigate("assignments")}>
                      <span className={`assignment-type type-${assignment.courseCode.slice(0, 1).toLowerCase()}`}><ClipboardCheck size={16} /></span>
                      <span>
                        <strong>{assignment.title}</strong>
                        <small>{assignment.courseName} · {formatDate(assignment.dueAt)}</small>
                      </span>
                      <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                    </button>
                  );
                })}
                {!pendingAssignments.length && <p className="list-empty">近期作业均已完成。</p>}
              </div>
            </section>
            <section className="panel compact-list-card">
              <header className="panel-header">
                <div><span className="eyebrow">校园动态</span><h2>通知与公告</h2></div>
                <button className="text-button" type="button" onClick={() => onNavigate("announcements")}>查看全部 <ChevronRight size={14} /></button>
              </header>
              <div className="announcement-compact-list">
                {(data.announcements.length ? data.announcements : data.notifications.map((notification) => ({
                  id: notification.id,
                  title: notification.title,
                  content: notification.content,
                  scope: "campus" as const,
                  priority: "normal" as const,
                  courseId: null,
                  courseName: null,
                  authorName: "校园通知",
                  publishedAt: notification.createdAt
                }))).slice(0, 3).map((announcement) => (
                  <button type="button" key={announcement.id} onClick={() => onNavigate("announcements")}>
                    <span className="announcement-line" />
                    <span>
                      <strong>{announcement.title}</strong>
                      <small>{announcement.authorName} · {formatDate(announcement.publishedAt, false)}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </>
      )}

      <Modal
        open={taskModalOpen}
        title="新增学习任务"
        description="任务会保存到你的个人计划中。"
        onClose={() => setTaskModalOpen(false)}
        footer={
          <>
            <button className="button ghost" type="button" onClick={() => setTaskModalOpen(false)}>取消</button>
            <button className="button primary" type="submit" form="create-task-form" disabled={taskBusy}>{taskBusy ? "正在保存…" : "添加任务"}</button>
          </>
        }
      >
        <form className="stack-form" id="create-task-form" onSubmit={createTask}>
          <FormError message={taskError} />
          <label><span>任务名称</span><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="例如 完成条件概率练习" required /></label>
          <div className="form-row form-row-two">
            <label>
              <span>关联课程</span>
              <select value={taskCourse} onChange={(event) => setTaskCourse(event.target.value)}>
                <option value="">个人任务</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
              </select>
            </label>
            <label><span>截止时间</span><input type="datetime-local" value={taskDue} onChange={(event) => setTaskDue(event.target.value)} /></label>
          </div>
          <label>
            <span>优先级</span>
            <select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value)}>
              <option value="high">高</option>
              <option value="normal">普通</option>
              <option value="low">低</option>
            </select>
          </label>
        </form>
      </Modal>
    </>
  );
}

function TeacherDashboardContent({
  data,
  onNavigate,
  copyCode,
  notify
}: {
  data: Extract<DashboardData, { role: "teacher" }>;
  onNavigate: (view: ViewName) => void;
  copyCode: (code: string) => Promise<void>;
  notify: Notify;
}) {
  return (
    <>
      <div className="stat-band">
        <StatItem icon={<BookOpen />} label="授课课程" value={`${data.stats.courseCount} 门`} note="本学期进行中" tone="teal" />
        <StatItem icon={<UsersRound />} label="覆盖学生" value={`${data.stats.studentCount} 人`} note="已加入课程学生" tone="blue" />
        <StatItem icon={<ClipboardCheck />} label="待批改" value={`${data.stats.ungradedCount} 份`} note={data.stats.ungradedCount ? "建议今天完成反馈" : "已全部批改"} tone="coral" />
        <StatItem icon={<TrendingUp />} label="班级平均分" value={data.stats.averageGrade == null ? "—" : `${data.stats.averageGrade}`} note={`平均进度 ${data.stats.averageProgress}%`} tone="gold" />
      </div>

      <div className="dashboard-grid teacher-dashboard-grid">
        <section className="panel teacher-class-panel">
          <header className="panel-header">
            <div><span className="eyebrow">授课班级</span><h2>课程运行概览</h2></div>
            <button className="text-button" type="button" onClick={() => onNavigate("courses")}>课程管理 <ChevronRight size={14} /></button>
          </header>
          <div className="teacher-course-list">
            {data.courses.map((course) => (
              <button type="button" key={course.id} className="teacher-course-row" onClick={() => onNavigate("courses")}>
                <img src={course.cover} alt="" />
                <span className="teacher-course-main">
                  <strong>{course.name}</strong>
                  <small>{course.code} · {course.schedule} · {course.room}</small>
                  <span className="teacher-progress"><i style={{ width: `${course.averageProgress ?? 0}%` }} /></span>
                </span>
                <span className="teacher-course-stats">
                  <strong>{course.studentCount} 人</strong>
                  <small>平均 {course.averageGrade ?? "—"} 分</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </section>

        <section className="panel teacher-task-panel">
          <header className="panel-header">
            <div><span className="eyebrow">教学工作</span><h2>待处理事项</h2></div>
            <StatusBadge tone="coral">{data.ungraded.length} 待批改</StatusBadge>
          </header>
          <div className="teacher-pending-list">
            {data.ungraded.slice(0, 4).map((submission) => (
              <button type="button" key={submission.id} onClick={() => onNavigate("assignments")}>
                <Avatar name={submission.studentName} size="small" />
                <span>
                  <strong>{submission.studentName} · {submission.title}</strong>
                  <small>{submission.courseName} · {formatDate(submission.submittedAt)}</small>
                </span>
                <ArrowRight size={15} />
              </button>
            ))}
            {!data.ungraded.length && (
              <div className="all-clear"><CheckCircle2 size={25} /><strong>作业已全部批改</strong><p>可以开始准备下一节课。</p></div>
            )}
          </div>
        </section>
      </div>

      <div className="dashboard-lower">
        <section className="panel teacher-attendance-panel">
          <header className="panel-header">
            <div><span className="eyebrow">实时课堂</span><h2>进行中的签到</h2></div>
            <button className="button ghost small" type="button" onClick={() => onNavigate("attendance")}><Plus size={14} /> 发起签到</button>
          </header>
          {data.openSessions.length ? data.openSessions.map((session) => (
            <div className="live-session-card" key={session.id}>
              <span className="live-dot" />
              <div>
                <strong>{session.courseName} · {session.topic}</strong>
                <p>{session.checkedIn} / {session.studentCount} 人已签到 · {formatDate(session.closesAt)} 关闭</p>
              </div>
              <button className="code-chip" type="button" onClick={() => void copyCode(session.checkInCode)}>
                {session.checkInCode} <Copy size={13} />
              </button>
              <button className="text-button" type="button" onClick={() => onNavigate("attendance")}>查看名单</button>
            </div>
          )) : (
            <div className="list-empty">当前没有进行中的签到。</div>
          )}
        </section>

        <section className="panel teacher-analytics-preview">
          <header className="panel-header">
            <div><span className="eyebrow">班级学情</span><h2>{data.analytics?.course.name || "暂无课程数据"}</h2></div>
            <button className="text-button" type="button" onClick={() => onNavigate("analytics")}>完整分析 <ChevronRight size={14} /></button>
          </header>
          {data.analytics ? (
            <div className="analytics-preview-body">
              <div className="metric-compact"><span>平均成绩</span><strong>{data.analytics.metrics.averageGrade ?? "—"}</strong></div>
              <div className="metric-compact"><span>平均进度</span><strong>{data.analytics.metrics.averageProgress}%</strong></div>
              <div className="metric-compact"><span>出勤率</span><strong>{data.analytics.metrics.attendanceRate}%</strong></div>
              <div className="metric-compact risk"><span>需关注</span><strong>{data.analytics.metrics.atRiskCount} 人</strong></div>
              <div className="teacher-grade-bars">
                {data.analytics.gradeBands.map((band) => (
                  <div key={band.label}>
                    <span>{band.label}</span>
                    <div><i style={{ width: `${Math.max(4, (band.count / Math.max(1, data.analytics!.students.length)) * 100)}%` }} /></div>
                    <strong>{band.count}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="list-empty">创建课程后即可查看班级分析。</p>
          )}
        </section>
      </div>
    </>
  );
}

function StatItem({
  icon,
  label,
  value,
  note,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
  tone: "teal" | "coral" | "gold" | "blue";
}) {
  return (
    <div className="stat-item">
      <span className={`stat-icon ${tone}`}>{icon}</span>
      <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
    </div>
  );
}

function MiniStudyChart({ data }: { data: Array<{ date: string; minutes: number; score: number | null }> }) {
  const max = Math.max(60, ...data.map((item) => item.minutes));
  const points = data.map((item, index) => {
    const x = data.length === 1 ? 0 : (index / (data.length - 1)) * 640;
    const y = 120 - ((item.score || 70) / 100) * 100;
    return `${x},${y}`;
  }).join(" ");
  return (
    <div className="mini-study-chart" aria-label="近 14 天学习投入图表">
      <div className="study-bars">
        {data.map((item) => (
          <div className="study-bar-group" key={item.date} title={`${item.date}：${item.minutes} 分钟`}>
            <i style={{ height: `${Math.max(6, (item.minutes / max) * 100)}%` }} />
            <span>{new Date(`${item.date}T00:00:00`).getDate()}</span>
          </div>
        ))}
      </div>
      {data.length > 1 && (
        <svg viewBox="0 0 640 120" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={points} />
        </svg>
      )}
    </div>
  );
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 12) return "上午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}
