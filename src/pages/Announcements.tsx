import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  Filter,
  Megaphone,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound
} from "lucide-react";
import { api, ApiError } from "../api";
import type { Announcement, Course, User } from "../types";
import {
  EmptyState,
  formatDate,
  FormError,
  LoadingBlock,
  Modal,
  PageHeading,
  StatusBadge
} from "../components/ui";

type Notify = (message: string, tone?: "success" | "error" | "info") => void;
type NoticeFilter = "all" | "important" | "campus" | "course";

export default function Announcements({
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
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<NoticeFilter>("all");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<Announcement | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const isTeacher = user.role === "teacher";

  const loadAnnouncements = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const result = await api.announcements();
      setAnnouncements(result.announcements);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "校园通知加载失败", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAnnouncements();
  }, []);

  useEffect(() => {
    if (realtimeVersion > 0) void loadAnnouncements(false);
  }, [realtimeVersion]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return announcements.filter((announcement) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "important" && announcement.priority === "important") ||
        (filter === "campus" && announcement.scope === "campus") ||
        (filter === "course" && announcement.scope === "course");
      const matchesSearch =
        !query ||
        `${announcement.title} ${announcement.content} ${announcement.authorName} ${announcement.courseName || ""}`
          .toLowerCase()
          .includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [announcements, filter, search]);

  const important = announcements.filter((announcement) => announcement.priority === "important");
  const latest = announcements[0];

  return (
    <>
      <PageHeading
        eyebrow={isTeacher ? "校园信息发布" : "校园动态与课程提醒"}
        title={isTeacher ? "通知管理" : "校园通知"}
        description={
          isTeacher
            ? "发布校园或课程范围的重要信息，通知会实时送达对应账号。"
            : "集中查看校园安排与课程公告，不错过重要时间节点。"
        }
        actions={
          isTeacher ? (
            <button className="button primary" type="button" onClick={() => setCreateOpen(true)}>
              <Plus size={16} /> 发布通知
            </button>
          ) : undefined
        }
      />

      <section className="announcement-feature">
        <div className="announcement-feature-icon"><Megaphone size={25} /></div>
        <div>
          <div className="announcement-feature-meta">
            <StatusBadge tone="coral"><Sparkles size={12} /> 最新动态</StatusBadge>
            {latest && <span>{formatDate(latest.publishedAt)}</span>}
          </div>
          <h2>{latest?.title || "校园信息中心"}</h2>
          <p>{latest?.content || "重要校园安排、课程调整和教学通知会集中展示在这里。"}</p>
          {latest && (
            <button className="text-button" type="button" onClick={() => setActive(latest)}>
              阅读完整通知 <ChevronRight size={14} />
            </button>
          )}
        </div>
        <div className="announcement-feature-stats">
          <div><strong>{announcements.length}</strong><span>全部通知</span></div>
          <div><strong>{important.length}</strong><span>重要提醒</span></div>
        </div>
      </section>

      <div className="announcement-toolbar">
        <div className="segmented-control">
          <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
            <Filter size={14} /> 全部
          </button>
          <button type="button" className={filter === "important" ? "active" : ""} onClick={() => setFilter("important")}>
            重要
          </button>
          <button type="button" className={filter === "campus" ? "active" : ""} onClick={() => setFilter("campus")}>
            校园
          </button>
          <button type="button" className={filter === "course" ? "active" : ""} onClick={() => setFilter("course")}>
            课程
          </button>
        </div>
        <label className="notice-search">
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索通知内容" />
        </label>
        <span className="filter-count">显示 {filtered.length} 条</span>
      </div>

      {loading ? (
        <section className="panel"><LoadingBlock label="正在同步校园通知…" /></section>
      ) : filtered.length ? (
        <div className="announcement-grid">
          {filtered.map((announcement) => (
            <button
              type="button"
              className={`announcement-card ${announcement.priority === "important" ? "important" : ""}`}
              key={announcement.id}
              onClick={() => setActive(announcement)}
            >
              <header>
                <span className={`announcement-icon scope-${announcement.scope}`}>
                  {announcement.scope === "campus" ? <Megaphone size={17} /> : <BookOpen size={17} />}
                </span>
                <span>
                  <StatusBadge tone={announcement.priority === "important" ? "coral" : announcement.scope === "course" ? "blue" : "teal"}>
                    {announcement.priority === "important" ? "重要" : announcement.scope === "course" ? "课程通知" : "校园公告"}
                  </StatusBadge>
                  <small>{announcement.courseName || "全校范围"}</small>
                </span>
                <ChevronRight size={16} />
              </header>
              <h2>{announcement.title}</h2>
              <p>{announcement.content}</p>
              <footer>
                <span><UserRound size={13} /> {announcement.authorName}</span>
                <span><CalendarDays size={13} /> {formatDate(announcement.publishedAt, false)}</span>
              </footer>
            </button>
          ))}
        </div>
      ) : (
        <section className="panel">
          <EmptyState
            icon={<Megaphone />}
            title="没有匹配的通知"
            description="调整筛选条件或搜索关键词后重试。"
          />
        </section>
      )}

      <AnnouncementDetail announcement={active} onClose={() => setActive(null)} />
      <CreateAnnouncementModal
        open={createOpen}
        courses={courses}
        onClose={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false);
          await loadAnnouncements();
          await onRefresh();
          notify("通知已发布并送达对应账号");
        }}
      />
    </>
  );
}

function AnnouncementDetail({
  announcement,
  onClose
}: {
  announcement: Announcement | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={Boolean(announcement)}
      title={announcement?.title || "通知详情"}
      description={announcement ? `${announcement.scope === "campus" ? "校园公告" : announcement.courseName} · ${formatDate(announcement.publishedAt)}` : undefined}
      onClose={onClose}
      size="large"
    >
      {announcement && (
        <article className="announcement-detail">
          <header>
            <StatusBadge tone={announcement.priority === "important" ? "coral" : "teal"}>
              {announcement.priority === "important" ? "重要通知" : "常规通知"}
            </StatusBadge>
            <span><UserRound size={14} /> {announcement.authorName}</span>
            <span><CalendarDays size={14} /> {formatDate(announcement.publishedAt)}</span>
          </header>
          <p>{announcement.content}</p>
          <footer>
            <ShieldCheck size={15} />
            本通知已保存至校园通知数据库，并同步生成账号站内提醒。
          </footer>
        </article>
      )}
    </Modal>
  );
}

function CreateAnnouncementModal({
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
  const [form, setForm] = useState({
    scope: "campus" as "campus" | "course",
    courseId: courses[0]?.id || "",
    title: "",
    content: "",
    priority: "normal" as "normal" | "important"
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm((current) => ({ ...current, courseId: current.courseId || courses[0]?.id || "" }));
      setError(null);
    }
  }, [open, courses]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createAnnouncement({
        title: form.title,
        content: form.content,
        scope: form.scope,
        courseId: form.scope === "course" ? form.courseId : undefined,
        priority: form.priority
      });
      setForm({ ...form, title: "", content: "" });
      await onCreated();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "通知发布失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="发布校园通知"
      description="通知会写入公告列表，并向对应范围账号发送站内提醒。"
      onClose={onClose}
      size="large"
      footer={
        <>
          <button className="button ghost" type="button" onClick={onClose}>取消</button>
          <button className="button primary" type="submit" form="create-announcement-form" disabled={busy}>
            {busy ? "正在发布…" : "发布并通知"}
          </button>
        </>
      }
    >
      <form className="stack-form" id="create-announcement-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-row form-row-two">
          <label>
            <span>通知范围</span>
            <select value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value as "campus" | "course" })}>
              <option value="campus">全校通知</option>
              <option value="course">课程通知</option>
            </select>
          </label>
          <label>
            <span>优先级</span>
            <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as "normal" | "important" })}>
              <option value="normal">常规通知</option>
              <option value="important">重要提醒</option>
            </select>
          </label>
        </div>
        {form.scope === "course" && (
          <label>
            <span>目标课程</span>
            <select value={form.courseId} onChange={(event) => setForm({ ...form, courseId: event.target.value })} required>
              <option value="">请选择课程</option>
              {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
            </select>
          </label>
        )}
        <label>
          <span>通知标题</span>
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="用一句话说明通知重点" required />
        </label>
        <label>
          <span>通知正文</span>
          <textarea
            rows={8}
            value={form.content}
            onChange={(event) => setForm({ ...form, content: event.target.value })}
            placeholder="写清时间、地点、参与对象和需要完成的动作。"
            required
          />
        </label>
        <div className="announcement-recipient-note">
          {form.scope === "campus" ? <UsersRound size={17} /> : <BookOpen size={17} />}
          <span>
            <strong>送达范围</strong>
            <small>{form.scope === "campus" ? "全校学生与教师账号" : "所选课程的全部选课学生"}</small>
          </span>
        </div>
      </form>
    </Modal>
  );
}
