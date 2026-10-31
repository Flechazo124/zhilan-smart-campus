import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CalendarCheck2,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  KeyRound,
  LoaderCircle,
  MapPin,
  Plus,
  Radio,
  ShieldCheck,
  UserRound,
  UsersRound
} from "lucide-react";
import { api, ApiError } from "../api";
import type {
  AttendanceRosterEntry,
  AttendanceSession,
  Course,
  User
} from "../types";
import {
  Avatar,
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
type AttendanceStats = { total: number; attended: number; leave_count: number; absent_count: number };

const statusLabels: Record<NonNullable<AttendanceSession["ownStatus"]>, string> = {
  present: "已签到",
  late: "迟到",
  leave: "请假",
  absent: "缺勤"
};

const rosterStatusLabels: Record<AttendanceRosterEntry["status"], string> = {
  present: "已签到",
  late: "迟到",
  leave: "请假",
  absent: "未签到"
};

export default function Attendance({
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
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [stats, setStats] = useState<AttendanceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkInTarget, setCheckInTarget] = useState<AttendanceSession | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [rosterTarget, setRosterTarget] = useState<AttendanceSession | null>(null);
  const [now, setNow] = useState(Date.now());
  const isTeacher = user.role === "teacher";

  const loadSessions = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const result = await api.attendance();
      setSessions(result.sessions);
      setStats(result.stats || null);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "考勤数据加载失败", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSessions();
  }, []);

  useEffect(() => {
    if (realtimeVersion > 0) void loadSessions(false);
  }, [realtimeVersion]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const openSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          session.status === "open" &&
          new Date(session.closesAt).getTime() > now &&
          (!session.ownStatus || session.ownStatus === "absent")
      ),
    [now, sessions]
  );

  const studentHistory = sessions.filter((session) => !openSessions.some((item) => item.id === session.id));
  const activeSessions = sessions.filter((session) => session.status === "open" && new Date(session.closesAt).getTime() > now);

  const attendanceRate = stats?.total ? Math.round((stats.attended / stats.total) * 100) : 0;

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      notify("签到码已复制");
    } catch {
      notify(`签到码：${code}`, "info");
    }
  };

  return (
    <>
      <PageHeading
        eyebrow={isTeacher ? "课堂参与 · 实时记录" : "课堂参与 · 到场确认"}
        title={isTeacher ? "课堂考勤" : "考勤签到"}
        description={
          isTeacher
            ? "发起限时签到，实时查看学生到场情况与历史出勤数据。"
            : "输入教师公布的签到码完成签到，所有记录实时写入课程考勤。"
        }
        actions={
          isTeacher ? (
            <button className="button primary" type="button" onClick={() => setCreateOpen(true)}>
              <Plus size={16} /> 发起课堂签到
            </button>
          ) : (
            <button
              className="button primary"
              type="button"
              disabled={!openSessions.length}
              onClick={() => openSessions[0] && setCheckInTarget(openSessions[0])}
            >
              <KeyRound size={16} /> {openSessions.length ? "立即签到" : "暂无待签到"}
            </button>
          )
        }
      />

      {isTeacher ? (
        <TeacherAttendance
          sessions={sessions}
          activeCount={activeSessions.length}
          loading={loading}
          now={now}
          onCreate={() => setCreateOpen(true)}
          onRoster={setRosterTarget}
          copyCode={copyCode}
        />
      ) : (
        <StudentAttendance
          sessions={studentHistory}
          openSessions={openSessions}
          stats={stats}
          attendanceRate={attendanceRate}
          loading={loading}
          now={now}
          onCheckIn={setCheckInTarget}
        />
      )}

      <CheckInModal
        session={checkInTarget}
        onClose={() => setCheckInTarget(null)}
        onChecked={async () => {
          setCheckInTarget(null);
          await loadSessions();
          await onRefresh();
          notify("签到成功，出勤记录已保存");
        }}
      />
      <CreateAttendanceModal
        open={createOpen}
        courses={courses}
        onClose={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false);
          await loadSessions();
          await onRefresh();
          notify("课堂签到已开启，学生端会立即看到");
        }}
      />
      <AttendanceRosterModal
        session={rosterTarget}
        realtimeVersion={realtimeVersion}
        onClose={() => setRosterTarget(null)}
        notify={notify}
      />
    </>
  );
}

function StudentAttendance({
  openSessions,
  sessions,
  stats,
  attendanceRate,
  loading,
  now,
  onCheckIn
}: {
  openSessions: AttendanceSession[];
  sessions: AttendanceSession[];
  stats: AttendanceStats | null;
  attendanceRate: number;
  loading: boolean;
  now: number;
  onCheckIn: (session: AttendanceSession) => void;
}) {
  return (
    <>
      <div className="attendance-overview">
        <section className="attendance-rate-card">
          <div className="attendance-ring" style={{ "--rate": `${attendanceRate * 3.6}deg` } as React.CSSProperties}>
            <span><strong>{attendanceRate}%</strong><small>出勤率</small></span>
          </div>
          <div>
            <p className="eyebrow">本学期出勤</p>
            <h2>{stats?.attended ?? 0} / {stats?.total ?? 0} 次课程到场</h2>
            <p>请假 {stats?.leave_count ?? 0} 次 · 缺勤 {stats?.absent_count ?? 0} 次</p>
          </div>
        </section>
        <section className="attendance-callout">
          <span><Radio size={21} /></span>
          <div>
            <strong>{openSessions.length ? `${openSessions.length} 场签到正在进行` : "当前没有待签到课堂"}</strong>
            <p>{openSessions.length ? "请向教师获取课堂签到码，并在关闭前完成签到。" : "教师发起签到后，这里会立即出现入口。"}</p>
          </div>
        </section>
      </div>

      {openSessions.length > 0 && (
        <section className="attendance-live-grid">
          {openSessions.map((session) => {
            const minutes = Math.max(0, Math.ceil((new Date(session.closesAt).getTime() - now) / 60000));
            return (
              <article className="attendance-live-card" key={session.id}>
                <span className="live-dot" />
                <div>
                  <span className="eyebrow">{session.courseCode} · 实时签到</span>
                  <h2>{session.courseName}</h2>
                  <p>{session.topic}</p>
                  <div><Clock3 size={14} /> 剩余约 {minutes} 分钟</div>
                </div>
                <button className="button primary" type="button" onClick={() => onCheckIn(session)}>
                  <KeyRound size={16} /> 输入签到码
                </button>
              </article>
            );
          })}
        </section>
      )}

      <section className="panel attendance-history-panel">
        <header className="panel-header">
          <div>
            <span className="eyebrow">出勤明细</span>
            <h2>课程考勤记录</h2>
          </div>
          <StatusBadge tone="teal"><ShieldCheck size={13} /> 数据实时同步</StatusBadge>
        </header>
        {loading ? (
          <LoadingBlock label="正在加载考勤记录…" />
        ) : sessions.length ? (
          <div className="attendance-history-list">
            {sessions.map((session) => (
              <div key={session.id}>
                <span className={`attendance-history-icon ${session.ownStatus || "none"}`}>
                  {session.ownStatus === "present" ? <CheckCircle2 size={17} /> : <CalendarCheck2 size={17} />}
                </span>
                <span>
                  <strong>{session.courseName} · {session.topic}</strong>
                  <small>{session.date} · {session.courseCode}</small>
                </span>
                <StatusBadge
                  tone={
                    session.ownStatus === "present"
                      ? "teal"
                      : session.ownStatus === "late"
                        ? "gold"
                        : session.ownStatus === "leave"
                          ? "blue"
                          : "neutral"
                  }
                >
                  {session.ownStatus ? statusLabels[session.ownStatus] : "未签到"}
                </StatusBadge>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<CalendarCheck2 />}
            title="还没有考勤记录"
            description="加入课程后，教师发起的每一次课堂签到都会显示在这里。"
          />
        )}
      </section>
    </>
  );
}

function TeacherAttendance({
  sessions,
  activeCount,
  loading,
  now,
  onCreate,
  onRoster,
  copyCode
}: {
  sessions: AttendanceSession[];
  activeCount: number;
  loading: boolean;
  now: number;
  onCreate: () => void;
  onRoster: (session: AttendanceSession) => void;
  copyCode: (code: string) => Promise<void>;
}) {
  return (
    <>
      <div className="teacher-attendance-band">
        <div><span>考勤场次</span><strong>{sessions.length}</strong><small>全部历史记录</small></div>
        <div><span>进行中</span><strong>{activeCount}</strong><small>学生可实时签到</small></div>
        <div>
          <span>累计签到</span>
          <strong>{sessions.reduce((sum, item) => sum + (item.checkedIn || 0), 0)}</strong>
          <small>真实出勤记录</small>
        </div>
        <button type="button" onClick={onCreate}>
          <span><Radio size={21} /></span>
          <div><strong>发起课堂签到</strong><small>生成 4-8 位数字签到码</small></div>
          <Plus size={17} />
        </button>
      </div>

      <section className="panel attendance-history-panel">
        <header className="panel-header">
          <div>
            <span className="eyebrow">课堂记录</span>
            <h2>签到场次与到场率</h2>
          </div>
          <StatusBadge tone="teal"><UsersRound size={13} /> 按课程名单统计</StatusBadge>
        </header>
        {loading ? (
          <LoadingBlock label="正在加载考勤场次…" />
        ) : sessions.length ? (
          <div className="teacher-attendance-list">
            {sessions.map((session) => {
              const isLive = session.status === "open" && new Date(session.closesAt).getTime() > now;
              const rate = session.studentCount ? Math.round(((session.checkedIn || 0) / session.studentCount) * 100) : 0;
              return (
                <article key={session.id}>
                  <div className="teacher-attendance-date">
                    <strong>{new Date(session.date).getDate()}</strong>
                    <small>{new Date(session.date).toLocaleDateString("zh-CN", { month: "short" })}</small>
                  </div>
                  <div className="teacher-attendance-main">
                    <div>
                      <StatusBadge tone={isLive ? "teal" : "neutral"}>{isLive ? "签到进行中" : "已结束"}</StatusBadge>
                      <span>{session.courseCode}</span>
                    </div>
                    <h3>{session.topic}</h3>
                    <p>{session.courseName} · {formatDate(session.closesAt)} 关闭</p>
                  </div>
                  {isLive && session.checkInCode && (
                    <button className="attendance-code-box" type="button" onClick={() => void copyCode(session.checkInCode!)}>
                      <span>签到码</span>
                      <strong>{session.checkInCode}</strong>
                      <small><Copy size={12} /> 点击复制</small>
                    </button>
                  )}
                  <div className="teacher-attendance-progress">
                    <span><strong>{session.checkedIn || 0}</strong> / {session.studentCount || 0} 人</span>
                    <div className="progress-track"><span style={{ width: `${rate}%` }} /></div>
                    <small>到场率 {rate}%</small>
                  </div>
                  <button className="button ghost small" type="button" onClick={() => onRoster(session)}>
                    <UsersRound size={14} /> 查看名单
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<CalendarCheck2 />}
            title="还没有发起考勤"
            description="创建课堂签到后，学生端会立即出现签到入口。"
            action={<button className="button primary" type="button" onClick={onCreate}><Plus size={15} /> 发起签到</button>}
          />
        )}
      </section>
    </>
  );
}

function CheckInModal({
  session,
  onClose,
  onChecked
}: {
  session: AttendanceSession | null;
  onClose: () => void;
  onChecked: () => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) {
      setCode("");
      setError(null);
    }
  }, [session]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      await api.checkIn(session.id, code);
      await onChecked();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "签到失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(session)}
      title="课堂签到"
      description={session ? `${session.courseName} · ${session.topic}` : undefined}
      onClose={onClose}
      size="small"
      footer={
        <>
          <button className="button ghost" type="button" onClick={onClose}>取消</button>
          <button className="button primary" type="submit" form="attendance-check-in-form" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
            {busy ? "正在核验…" : "确认签到"}
          </button>
        </>
      }
    >
      <form className="stack-form check-in-form" id="attendance-check-in-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="check-in-session-note">
          <MapPin size={16} />
          <span><strong>{session?.courseCode}</strong><small>{session ? `${formatDate(session.closesAt)} 前有效` : ""}</small></span>
        </div>
        <label>
          <span>教师公布的签到码</span>
          <input
            className="check-in-code-input"
            inputMode="numeric"
            pattern="[0-9]{4,8}"
            maxLength={8}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            placeholder="输入 4-8 位数字"
            autoFocus
            required
          />
        </label>
        <p className="form-hint">签到码由授课教师现场公布。系统会校验课程归属、关闭时间和重复签到。</p>
      </form>
    </Modal>
  );
}

function CreateAttendanceModal({
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
  const defaultClose = toLocalInputValue(new Date(Date.now() + 30 * 60 * 1000));
  const [form, setForm] = useState({
    courseId: courses[0]?.id || "",
    topic: "",
    checkInCode: String(Math.floor(1000 + Math.random() * 9000)),
    closesAt: defaultClose
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm((current) => ({
        ...current,
        courseId: current.courseId || courses[0]?.id || "",
        closesAt: toLocalInputValue(new Date(Date.now() + 30 * 60 * 1000))
      }));
      setError(null);
    }
  }, [open, courses]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createAttendanceSession({
        courseId: form.courseId,
        topic: form.topic,
        checkInCode: form.checkInCode,
        closesAt: new Date(form.closesAt).toISOString()
      });
      setForm((current) => ({
        ...current,
        topic: "",
        checkInCode: String(Math.floor(1000 + Math.random() * 9000))
      }));
      await onCreated();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "签到发起失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="发起课堂签到"
      description="签到码和关闭时间会实时同步到学生端。"
      onClose={onClose}
      footer={
        <>
          <button className="button ghost" type="button" onClick={onClose}>取消</button>
          <button className="button primary" type="submit" form="create-attendance-form" disabled={busy}>
            {busy ? "正在开启…" : "开启签到"}
          </button>
        </>
      }
    >
      <form className="stack-form" id="create-attendance-form" onSubmit={submit}>
        <FormError message={error} />
        <label>
          <span>授课课程</span>
          <select value={form.courseId} onChange={(event) => setForm({ ...form, courseId: event.target.value })} required>
            <option value="">请选择课程</option>
            {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
          </select>
        </label>
        <label>
          <span>本节课堂主题</span>
          <input value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })} placeholder="例如 条件概率与贝叶斯公式" required />
        </label>
        <div className="form-row form-row-two">
          <label>
            <span>签到码</span>
            <div className="input-with-action">
              <input
                inputMode="numeric"
                pattern="[0-9]{4,8}"
                maxLength={8}
                value={form.checkInCode}
                onChange={(event) => setForm({ ...form, checkInCode: event.target.value.replace(/\D/g, "") })}
                required
              />
              <button
                type="button"
                onClick={() => setForm({ ...form, checkInCode: String(Math.floor(1000 + Math.random() * 9000)) })}
                aria-label="重新生成签到码"
              >
                换一个
              </button>
            </div>
          </label>
          <label>
            <span>关闭时间</span>
            <input type="datetime-local" value={form.closesAt} onChange={(event) => setForm({ ...form, closesAt: event.target.value })} required />
          </label>
        </div>
        <p className="form-hint">签到码必须为 4-8 位数字，关闭时间必须晚于当前时间。</p>
      </form>
    </Modal>
  );
}

function AttendanceRosterModal({
  session,
  realtimeVersion,
  onClose,
  notify
}: {
  session: AttendanceSession | null;
  realtimeVersion: number;
  onClose: () => void;
  notify: Notify;
}) {
  const [roster, setRoster] = useState<AttendanceRosterEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedSessionId = useRef<string | null>(null);

  useEffect(() => {
    if (!session) {
      setRoster([]);
      loadedSessionId.current = null;
      return;
    }
    const isSameSession = loadedSessionId.current === session.id;
    loadedSessionId.current = session.id;
    if (!isSameSession) {
      setRoster([]);
      setLoading(true);
    }
    setError(null);
    api.attendanceRoster(session.id)
      .then((result) => setRoster(result.roster))
      .catch((caught) => {
        const message = caught instanceof ApiError ? caught.message : "签到名单加载失败";
        setError(message);
        notify(message, "error");
      })
      .finally(() => setLoading(false));
  }, [session?.id, realtimeVersion]);

  const attended = roster.filter((entry) => entry.status !== "absent").length;

  return (
    <Modal
      open={Boolean(session)}
      title="课堂签到名单"
      description={session ? `${session.courseName} · ${session.topic} · ${attended}/${roster.length} 人已到场` : undefined}
      onClose={onClose}
      size="large"
    >
      <FormError message={error} />
      {loading ? (
        <LoadingBlock label="正在读取课堂名单…" />
      ) : roster.length ? (
        <div className="attendance-roster">
          <div className="attendance-roster-summary">
            <span><CheckCircle2 size={16} /> 已签到 <strong>{roster.filter((entry) => entry.status === "present").length}</strong></span>
            <span><Clock3 size={16} /> 迟到 <strong>{roster.filter((entry) => entry.status === "late").length}</strong></span>
            <span><UserRound size={16} /> 请假 <strong>{roster.filter((entry) => entry.status === "leave").length}</strong></span>
            <span><CalendarCheck2 size={16} /> 未签到 <strong>{roster.filter((entry) => entry.status === "absent").length}</strong></span>
          </div>
          <div className="attendance-roster-grid">
            {roster.map((entry) => (
              <article key={entry.id}>
                <Avatar name={entry.name} color={entry.avatarColor} size="small" />
                <span><strong>{entry.name}</strong><small>{entry.identifier}</small></span>
                <StatusBadge tone={entry.status === "present" ? "teal" : entry.status === "late" ? "gold" : entry.status === "leave" ? "blue" : "neutral"}>
                  {rosterStatusLabels[entry.status]}
                </StatusBadge>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState icon={<UsersRound />} title="课程暂无学生" description="在课程管理中把学生加入课程后，签到名单会自动生成。" />
      )}
    </Modal>
  );
}
