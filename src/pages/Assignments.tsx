import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  LoaderCircle,
  MessageSquareText,
  Plus,
  Send,
  Star,
  UserRound
} from "lucide-react";
import { api, ApiError } from "../api";
import type { Assignment, Course, SubmissionRecord, User } from "../types";
import {
  Avatar,
  dueMeta,
  EmptyState,
  formatDate,
  FormError,
  LoadingBlock,
  Modal,
  PageHeading,
  StatusBadge,
  toLocalInputValue
} from "../components/ui";

type Notify = (message: string, tone?: "success" | "error" | "info") => void;
type Filter = "all" | "pending" | "graded";

export default function Assignments({
  user,
  courses,
  onRefresh,
  realtimeVersion,
  notify
}: {
  user: User;
  courses: Course[];
  onRefresh: () => Promise<void>;
  realtimeVersion: number;
  notify: Notify;
}) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [submitTarget, setSubmitTarget] = useState<Assignment | null>(null);
  const [gradeTarget, setGradeTarget] = useState<Assignment | null>(null);
  const isTeacher = user.role === "teacher";

  const loadAssignments = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const result = await api.assignments();
      setAssignments(result.assignments);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "作业数据加载失败", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAssignments();
  }, []);

  useEffect(() => {
    if (realtimeVersion > 0) void loadAssignments(false);
  }, [realtimeVersion]);

  const filtered = useMemo(() => {
    if (filter === "all") return assignments;
    if (isTeacher) {
      return assignments.filter((assignment) =>
        filter === "graded"
          ? (assignment.gradedCount || 0) >= (assignment.submissionCount || 0) && (assignment.submissionCount || 0) > 0
          : (assignment.gradedCount || 0) < (assignment.submissionCount || 0)
      );
    }
    return assignments.filter((assignment) =>
      filter === "graded" ? assignment.score != null : !assignment.submissionId
    );
  }, [assignments, filter, isTeacher]);

  const refresh = async () => {
    await loadAssignments();
    await onRefresh();
  };

  return (
    <>
      <PageHeading
        eyebrow={isTeacher ? "任务发布与反馈闭环" : "提交、反馈与订正"}
        title={isTeacher ? "作业与批改" : "作业中心"}
        description={
          isTeacher
            ? "发布课程任务、查看学生提交，并在评分后自动通知学生。"
            : "按截止时间管理任务，提交内容会自动保存，可查看教师评分与反馈。"
        }
        actions={
          isTeacher ? (
            <button className="button primary" type="button" onClick={() => setCreateOpen(true)}>
              <Plus size={16} /> 发布新作业
            </button>
          ) : (
            <button className="button ghost" type="button" onClick={() => setFilter("pending")}>
              <Clock3 size={16} /> 查看待完成
            </button>
          )
        }
      />

      <div className="assignment-summary-band">
        <div><span>全部任务</span><strong>{assignments.length}</strong></div>
        <div>
          <span>{isTeacher ? "已收作业" : "已提交"}</span>
          <strong>
            {isTeacher
              ? assignments.reduce((sum, item) => sum + (item.submissionCount || 0), 0)
              : assignments.filter((item) => item.submissionId).length}
          </strong>
        </div>
        <div>
          <span>{isTeacher ? "待批改" : "待评分"}</span>
          <strong>
            {isTeacher
              ? assignments.reduce((sum, item) => sum + Math.max(0, (item.submissionCount || 0) - (item.gradedCount || 0)), 0)
              : assignments.filter((item) => item.submissionId && item.score == null).length}
          </strong>
        </div>
        <div>
          <span>{isTeacher ? "完成批改" : "已评分"}</span>
          <strong style={{ color: "var(--teal)" }}>
            {isTeacher
              ? assignments.reduce((sum, item) => sum + (item.gradedCount || 0), 0)
              : assignments.filter((item) => item.score != null).length}
          </strong>
        </div>
      </div>

      <div className="filter-row">
        <div className="segmented-control">
          <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部</button>
          <button type="button" className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")}>{isTeacher ? "待批改" : "待完成"}</button>
          <button type="button" className={filter === "graded" ? "active" : ""} onClick={() => setFilter("graded")}>{isTeacher ? "已批改" : "已评分"}</button>
        </div>
        <span className="filter-count">显示 {filtered.length} 项</span>
      </div>

      {loading ? (
        <div className="panel"><LoadingBlock label="正在加载作业…" /></div>
      ) : filtered.length ? (
        <div className="assignment-grid">
          {filtered.map((assignment) => {
            const meta = dueMeta(assignment.dueAt);
            const studentGraded = assignment.score != null;
            return (
              <article className="assignment-card" key={assignment.id}>
                <header>
                  <span className={`assignment-course-mark ${assignment.courseCode.slice(0, 1).toLowerCase()}`}>
                    {assignment.courseCode.slice(0, 2)}
                  </span>
                  <span>{assignment.courseName}</span>
                  <StatusBadge tone={studentGraded ? "teal" : meta.tone}>
                    {studentGraded ? `得分 ${assignment.score}/${assignment.maxScore}` : meta.label}
                  </StatusBadge>
                </header>
                <h2>{assignment.title}</h2>
                <p>{assignment.description}</p>
                <div className="assignment-meta">
                  <span><Clock3 size={14} /> {formatDate(assignment.dueAt)}</span>
                  <span><FileCheck2 size={14} /> 满分 {assignment.maxScore}</span>
                </div>

                {isTeacher ? (
                  <>
                    <div className="submission-progress">
                      <div>
                        <span>提交进度</span>
                        <strong>{assignment.submissionCount || 0} / {assignment.studentCount || 0}</strong>
                      </div>
                      <div className="progress-track">
                        <span style={{ width: `${assignment.studentCount ? ((assignment.submissionCount || 0) / assignment.studentCount) * 100 : 0}%` }} />
                      </div>
                    </div>
                    <footer>
                      <span><MessageSquareText size={14} /> {assignment.gradedCount || 0} 份已批改</span>
                      <button className="button primary small" type="button" onClick={() => setGradeTarget(assignment)}>
                        {assignment.submissionCount ? "进入批改" : "查看提交"} <ArrowRight size={14} />
                      </button>
                    </footer>
                  </>
                ) : (
                  <>
                    {assignment.score != null && (
                      <div className="grade-feedback-preview">
                        <span><Star size={15} /> 教师反馈</span>
                        <p>{assignment.feedback || "教师已完成评分，未填写额外文字反馈。"}</p>
                      </div>
                    )}
                    <footer>
                      <span className={assignment.submissionId ? "submitted-label" : "pending-label"}>
                        {assignment.submissionId ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                        {assignment.submissionId ? `已提交 ${formatDate(assignment.submittedAt, false)}` : "尚未提交"}
                      </span>
                      <button
                        className={`button ${assignment.submissionId ? "ghost" : "primary"} small`}
                        type="button"
                        disabled={assignment.score != null || meta.label === "已截止"}
                        onClick={() => setSubmitTarget(assignment)}
                      >
                        {assignment.score != null ? "已完成" : assignment.submissionId ? "修改提交" : "提交作业"}
                      </button>
                    </footer>
                  </>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            icon={<ClipboardCheck />}
            title={filter === "all" ? "暂无作业" : "当前筛选下没有作业"}
            description={isTeacher ? "发布一项新作业开始收集学生提交。" : "作业发布后会出现在这里。"}
            action={isTeacher ? <button className="button primary" type="button" onClick={() => setCreateOpen(true)}><Plus size={15} /> 发布作业</button> : undefined}
          />
        </div>
      )}

      <CreateAssignmentModal
        open={createOpen}
        courses={courses}
        onClose={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false);
          await refresh();
          notify("作业已发布，学生已收到通知");
        }}
      />
      <SubmitAssignmentModal
        assignment={submitTarget}
        onClose={() => setSubmitTarget(null)}
        onSubmitted={async () => {
          setSubmitTarget(null);
          await refresh();
          notify("作业提交成功");
        }}
        notify={notify}
      />
      <GradeAssignmentsModal
        assignment={gradeTarget}
        onClose={() => setGradeTarget(null)}
        onGraded={async () => {
          await refresh();
          notify("评分与反馈已保存，学生已收到通知");
        }}
        notify={notify}
      />
    </>
  );
}

function CreateAssignmentModal({
  open,
  courses,
  onClose,
  onCreated
}: {
  open: boolean;
  courses: Course[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const defaultDue = toLocalInputValue(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
  const [form, setForm] = useState({
    courseId: courses[0]?.id || "",
    title: "",
    description: "",
    type: "homework",
    dueAt: defaultDue,
    maxScore: "100"
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && !form.courseId && courses[0]) {
      setForm((current) => ({ ...current, courseId: courses[0].id }));
    }
  }, [open, courses]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createAssignment({
        courseId: form.courseId,
        title: form.title,
        description: form.description,
        type: form.type,
        dueAt: new Date(form.dueAt).toISOString(),
        maxScore: Number(form.maxScore)
      });
      setForm({ ...form, title: "", description: "" });
      await onCreated();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "作业发布失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="发布新作业"
      description="发布后会通知所有已加入该课程的学生。"
      onClose={onClose}
      footer={
        <>
          <button className="button ghost" type="button" onClick={onClose}>取消</button>
          <button className="button primary" type="submit" form="create-assignment-form" disabled={busy}>{busy ? "发布中…" : "发布并通知学生"}</button>
        </>
      }
    >
      <form className="stack-form" id="create-assignment-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-row form-row-two">
          <label>
            <span>所属课程</span>
            <select value={form.courseId} onChange={(event) => setForm({ ...form, courseId: event.target.value })} required>
              <option value="">请选择课程</option>
              {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
            </select>
          </label>
          <label>
            <span>任务类型</span>
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
              <option value="homework">课后作业</option>
              <option value="report">实验报告</option>
              <option value="analysis">案例分析</option>
              <option value="writing">写作任务</option>
            </select>
          </label>
        </div>
        <label><span>作业标题</span><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="清晰描述任务主题" required /></label>
        <label><span>任务说明</span><textarea rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="说明提交要求、评分重点与参考答案格式" required /></label>
        <div className="form-row form-row-two">
          <label><span>截止时间</span><input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} required /></label>
          <label><span>满分</span><input type="number" min="1" max="1000" value={form.maxScore} onChange={(event) => setForm({ ...form, maxScore: event.target.value })} required /></label>
        </div>
      </form>
    </Modal>
  );
}

function SubmitAssignmentModal({
  assignment,
  onClose,
  onSubmitted,
  notify
}: {
  assignment: Assignment | null;
  onClose: () => void;
  onSubmitted: () => Promise<void>;
  notify: Notify;
}) {
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (assignment) {
      setContent(assignment.submissionContent || "");
      setError(null);
    }
  }, [assignment]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!assignment) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitAssignment(assignment.id, content);
      await onSubmitted();
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : "作业提交失败";
      setError(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(assignment)}
      title={assignment?.title || "提交作业"}
      description={assignment ? `${assignment.courseName} · 截止 ${formatDate(assignment.dueAt)} · 满分 ${assignment.maxScore}` : undefined}
      onClose={onClose}
      size="large"
      footer={
        <>
          <button className="button ghost" type="button" onClick={onClose}>取消</button>
          <button className="button primary" type="submit" form="submit-assignment-form" disabled={busy}>{busy ? "正在提交…" : "确认提交"}</button>
        </>
      }
    >
      <form className="stack-form" id="submit-assignment-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="assignment-requirement">
          <span>任务说明</span>
          <p>{assignment?.description}</p>
        </div>
        <label>
          <span>作答内容</span>
          <textarea
            rows={10}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="请写出完整推理过程。截止前可重复提交，系统会保存最新版本。"
            required
          />
        </label>
        <p className="form-hint">当前版本为文本提交，内容会直接写入校园数据库；评分后不可修改。</p>
      </form>
    </Modal>
  );
}

function GradeAssignmentsModal({
  assignment,
  onClose,
  onGraded,
  notify
}: {
  assignment: Assignment | null;
  onClose: () => void;
  onGraded: () => Promise<void>;
  notify: Notify;
}) {
  const [loading, setLoading] = useState(false);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!assignment) {
      setSubmissions([]);
      setActiveId(null);
      return;
    }
    setLoading(true);
    setError(null);
    api.submissions(assignment.id)
      .then((result) => {
        setSubmissions(result.submissions);
        const first = result.submissions.find((item) => item.score == null) || result.submissions[0];
        setActiveId(first?.id || null);
        setScore(first?.score == null ? "" : String(first.score));
        setFeedback(first?.feedback || "");
      })
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : "提交列表加载失败"))
      .finally(() => setLoading(false));
  }, [assignment]);

  const active = submissions.find((item) => item.id === activeId) || null;
  const selectSubmission = (submission: SubmissionRecord) => {
    setActiveId(submission.id);
    setScore(submission.score == null ? "" : String(submission.score));
    setFeedback(submission.feedback || "");
    setError(null);
  };

  const grade = async (event: FormEvent) => {
    event.preventDefault();
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await api.gradeSubmission(active.id, Number(score), feedback);
      const result = await api.submissions(assignment!.id);
      setSubmissions(result.submissions);
      const updated = result.submissions.find((item) => item.id === active.id);
      if (updated) {
        setScore(String(updated.score));
        setFeedback(updated.feedback || "");
      }
      await onGraded();
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : "评分保存失败";
      setError(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(assignment)}
      title={assignment ? `批改：${assignment.title}` : "作业批改"}
      description={assignment ? `${assignment.courseName} · 满分 ${assignment.maxScore} · ${submissions.length} 份提交` : undefined}
      onClose={onClose}
      size="large"
    >
      {loading ? (
        <LoadingBlock label="正在读取学生提交…" />
      ) : submissions.length ? (
        <div className="grading-layout">
          <aside className="submission-student-list">
            {submissions.map((submission) => (
              <button
                type="button"
                key={submission.id}
                className={activeId === submission.id ? "active" : ""}
                onClick={() => selectSubmission(submission)}
              >
                <Avatar name={submission.studentName} color={submission.avatarColor} size="small" />
                <span><strong>{submission.studentName}</strong><small>{submission.identifier} · {formatDate(submission.submittedAt, false)}</small></span>
                <StatusBadge tone={submission.score == null ? "gold" : "teal"}>{submission.score == null ? "待批改" : `${submission.score} 分`}</StatusBadge>
              </button>
            ))}
          </aside>
          {active && (
            <div className="grading-main">
              <div className="submission-content">
                <span className="eyebrow">学生作答 · {active.studentName}</span>
                <p>{active.content}</p>
              </div>
              <form className="grading-form" onSubmit={grade}>
                <FormError message={error} />
                <div className="form-row form-row-two">
                  <label><span>评分（0-{assignment?.maxScore}）</span><input type="number" min="0" max={assignment?.maxScore} step="0.5" value={score} onChange={(event) => setScore(event.target.value)} required /></label>
                  <label><span>评分状态</span><div className="static-field"><Star size={15} /> {active.score == null ? "尚未评分" : `已评分 ${active.score} 分`}</div></label>
                </div>
                <label><span>教师反馈</span><textarea rows={4} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="说明推理亮点、错误原因和下一步建议" required /></label>
                <button className="button primary" type="submit" disabled={busy}>
                  {busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />} {busy ? "正在保存…" : "保存评分并通知学生"}
                </button>
              </form>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon={<UserRound />}
          title="还没有学生提交"
          description="学生提交后会自动出现在这里，可逐份评分并发送反馈。"
        />
      )}
    </Modal>
  );
}
