import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Bell,
  BookOpen,
  Bot,
  CalendarCheck2,
  ChartNoAxesCombined,
  ChevronDown,
  ClipboardCheck,
  Command,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Megaphone,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
  UsersRound,
  X
} from "lucide-react";
import { api, ApiError } from "../api";
import type {
  Assignment,
  Course,
  DashboardData,
  Notification,
  User,
  ViewName
} from "../types";
import { Avatar, FormError, Modal } from "./ui";

const navItems = [
  { id: "dashboard", label: "学习工作台", teacherLabel: "教学工作台", icon: LayoutDashboard },
  { id: "courses", label: "我的课程", teacherLabel: "课程管理", icon: BookOpen },
  { id: "assignments", label: "作业中心", teacherLabel: "作业与批改", icon: ClipboardCheck },
  { id: "ai", label: "AI 学习助理", teacherLabel: "AI 教学助理", icon: Bot },
  { id: "attendance", label: "考勤签到", teacherLabel: "课堂考勤", icon: CalendarCheck2 },
  { id: "analytics", label: "学情分析", teacherLabel: "班级学情", icon: ChartNoAxesCombined },
  { id: "announcements", label: "校园通知", teacherLabel: "通知管理", icon: Megaphone }
] as const;

const viewNames: Record<ViewName, string> = {
  dashboard: "学习工作台",
  courses: "我的课程",
  assignments: "作业中心",
  ai: "AI 学习助理",
  attendance: "考勤签到",
  analytics: "学情分析",
  announcements: "校园通知"
};

interface NavigateOptions {
  courseId?: string;
}

export default function AppShell({
  user,
  view,
  dashboard,
  realtimeVersion,
  realtimeConnected,
  children,
  onNavigate,
  onLogout,
  onUserUpdated,
  onDashboardRefresh
}: {
  user: User;
  view: ViewName;
  dashboard: DashboardData | null;
  realtimeVersion: number;
  realtimeConnected: boolean;
  children: ReactNode;
  onNavigate: (view: ViewName, options?: NavigateOptions) => void;
  onLogout: () => Promise<void>;
  onUserUpdated: (user: User) => void;
  onDashboardRefresh: () => Promise<void>;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  const unreadCount = notifications.filter((item) => !item.read).length;
  const currentNav = navItems.find((item) => item.id === view);
  const pageTitle = user.role === "teacher" && currentNav ? currentNav.teacherLabel : viewNames[view];
  const courses = dashboard?.courses || [];
  const assignments = dashboard?.assignments || [];

  const loadNotifications = async () => {
    setNotificationsLoading(true);
    try {
      const result = await api.notifications();
      setNotifications(result.notifications);
    } catch {
      setNotifications([]);
    } finally {
      setNotificationsLoading(false);
    }
  };

  useEffect(() => {
    void loadNotifications();
  }, [user.id, realtimeVersion]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setNotificationsOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const navigateFromShell = (nextView: ViewName, options?: NavigateOptions) => {
    onNavigate(nextView, options);
    setMobileOpen(false);
    setSearchOpen(false);
  };

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const result: Array<{ id: string; label: string; detail: string; view: ViewName; courseId?: string; type: string }> = [];
    for (const item of navItems) {
      const label = user.role === "teacher" ? item.teacherLabel : item.label;
      if (!query || label.toLowerCase().includes(query)) {
        result.push({ id: `nav-${item.id}`, label, detail: "页面", view: item.id, type: "页面" });
      }
    }
    for (const course of courses as Course[]) {
      if (!query || `${course.name} ${course.code} ${course.teacherName}`.toLowerCase().includes(query)) {
        result.push({
          id: `course-${course.id}`,
          label: course.name,
          detail: `${course.code} · ${course.teacherName}`,
          view: "courses",
          courseId: course.id,
          type: "课程"
        });
      }
    }
    for (const assignment of assignments as Assignment[]) {
      if (!query || `${assignment.title} ${assignment.courseName}`.toLowerCase().includes(query)) {
        result.push({
          id: `assignment-${assignment.id}`,
          label: assignment.title,
          detail: `${assignment.courseName} · 截止 ${new Date(assignment.dueAt).toLocaleDateString("zh-CN")}`,
          view: "assignments",
          type: "作业"
        });
      }
    }
    return result.slice(0, 10);
  }, [searchQuery, courses, assignments, user.role]);

  const readOne = async (notification: Notification) => {
    if (!notification.read) {
      await api.readNotification(notification.id);
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read: true } : item));
    }
    setNotificationsOpen(false);
    const target = (notification.view || "dashboard") as ViewName;
    if (viewNames[target]) navigateFromShell(target);
    void onDashboardRefresh();
  };

  const readAll = async () => {
    await api.readAllNotifications();
    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
    void onDashboardRefresh();
  };

  const logout = async () => {
    setLogoutBusy(true);
    try {
      await onLogout();
    } finally {
      setLogoutBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <div className={`mobile-scrim ${mobileOpen ? "visible" : ""}`} onClick={() => setMobileOpen(false)} />
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-mark"><GraduationCap size={24} /></span>
          <div>
            <strong>知澜校园</strong>
            <span>SMART CAMPUS</span>
          </div>
          <button className="icon-button sidebar-close" type="button" onClick={() => setMobileOpen(false)} aria-label="关闭导航">
            <X size={18} />
          </button>
        </div>

        <div className="workspace-badge">
          <span>{user.role === "teacher" ? <ShieldCheck size={15} /> : <GraduationCap size={15} />}</span>
          <div>
            <strong>{user.department}</strong>
            <small>{user.role === "teacher" ? `${user.title || "教师"} · ${user.identifier}` : user.className}</small>
          </div>
          <ChevronDown size={14} />
        </div>

        <nav className="main-nav" aria-label="主导航">
          <span className="nav-label">校园空间</span>
          {navItems.map((item) => {
            const Icon = item.icon;
            const label = user.role === "teacher" ? item.teacherLabel : item.label;
            return (
              <button
                type="button"
                key={item.id}
                className={`nav-item ${view === item.id ? "active" : ""}`}
                onClick={() => navigateFromShell(item.id)}
                aria-current={view === item.id ? "page" : undefined}
              >
                <Icon size={18} />
                <span>{label}</span>
                {item.id === "assignments" && dashboard && "ungradedCount" in dashboard.stats && dashboard.stats.ungradedCount > 0 && (
                  <span className="nav-badge">{dashboard.stats.ungradedCount}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-note">
          <span><ShieldCheck size={15} /> 校园安全连接</span>
          <p>身份权限已隔离，所有提交与批改均记录在数据库。</p>
        </div>

        <div className="sidebar-footer">
          <button type="button" className="profile-row" onClick={() => setProfileOpen(true)}>
            <Avatar name={user.name} color={user.avatarColor} size="small" />
            <span>
              <strong>{user.name}</strong>
              <small>{user.role === "student" ? "学生账号" : "教师账号"}</small>
            </span>
            <Settings size={15} />
          </button>
          <button type="button" className="logout-button" onClick={logout} disabled={logoutBusy}>
            <LogOut size={15} /> {logoutBusy ? "正在退出…" : "退出登录"}
          </button>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" type="button" onClick={() => setMobileOpen(true)} aria-label="打开导航">
              <Menu size={20} />
            </button>
            <div className="breadcrumb">
              <span>知澜智慧校园</span>
              <span className="breadcrumb-divider">/</span>
              <strong>{pageTitle}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <span
              className={`realtime-status ${realtimeConnected ? "connected" : "reconnecting"}`}
              role="status"
              aria-live="polite"
              title={realtimeConnected ? "校园数据实时推送已连接" : "实时连接中断，正在自动重连"}
            >
              <span className="realtime-indicator" />
              <span>{realtimeConnected ? "实时同步" : "正在重连"}</span>
            </span>
            <button className="search-trigger" type="button" onClick={() => setSearchOpen(true)}>
              <Search size={17} />
              <span>搜索课程、作业或页面</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button
              className="icon-button notification-button"
              type="button"
              onClick={() => {
                setNotificationsOpen(true);
                void loadNotifications();
              }}
              aria-label={`通知中心，${unreadCount} 条未读`}
            >
              <Bell size={18} />
              {unreadCount > 0 && <span className="notification-dot">{unreadCount > 9 ? "9+" : unreadCount}</span>}
            </button>
            <button className="top-profile" type="button" onClick={() => setProfileOpen(true)}>
              <Avatar name={user.name} color={user.avatarColor} size="small" />
              <span>{user.name}</span>
              <ChevronDown size={13} />
            </button>
          </div>
        </header>

        <main className="main-content">{children}</main>
      </div>

      <Modal open={searchOpen} title="全局搜索" description="搜索页面、课程或作业，选择后直接进入。" onClose={() => setSearchOpen(false)}>
        <div className="global-search">
          <Search size={18} />
          <input
            autoFocus
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="输入课程、作业名称或页面…"
            aria-label="全局搜索关键词"
          />
          <Command size={15} />
        </div>
        <div className="search-result-list">
          {searchResults.length ? (
            searchResults.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => navigateFromShell(item.view, { courseId: item.courseId })}
              >
                <span className="search-type">{item.type}</span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
              </button>
            ))
          ) : (
            <p className="search-no-result">没有找到匹配内容</p>
          )}
        </div>
      </Modal>

      <aside className={`notification-drawer ${notificationsOpen ? "open" : ""}`} aria-hidden={!notificationsOpen}>
        <header>
          <div>
            <span className="eyebrow">通知中心</span>
            <h2>校园动态</h2>
          </div>
          <button className="icon-button" type="button" onClick={() => setNotificationsOpen(false)} aria-label="关闭通知">
            <X size={18} />
          </button>
        </header>
        <div className="notification-toolbar">
          <span>{unreadCount} 条未读</span>
          <button type="button" onClick={readAll} disabled={!unreadCount}>全部标为已读</button>
        </div>
        <div className="notification-list">
          {notificationsLoading ? (
            <p className="notification-empty">正在加载通知…</p>
          ) : notifications.length ? (
            notifications.map((notification) => (
              <button
                type="button"
                key={notification.id}
                className={`notification-item ${notification.read ? "read" : ""}`}
                onClick={() => void readOne(notification)}
              >
                <span className={`notification-kind kind-${notification.kind}`}>
                  {notification.kind === "assignment" ? <ClipboardCheck size={15} /> : notification.kind === "attendance" ? <CalendarCheck2 size={15} /> : <Bell size={15} />}
                </span>
                <span>
                  <strong>{notification.title}</strong>
                  <p>{notification.content}</p>
                  <small>{new Date(notification.createdAt).toLocaleString("zh-CN")}</small>
                </span>
              </button>
            ))
          ) : (
            <p className="notification-empty">暂无通知</p>
          )}
        </div>
      </aside>

      <ProfileModal
        open={profileOpen}
        user={user}
        onClose={() => setProfileOpen(false)}
        onUpdated={onUserUpdated}
      />
    </div>
  );
}

function ProfileModal({
  open,
  user,
  onClose,
  onUpdated
}: {
  open: boolean;
  user: User;
  onClose: () => void;
  onUpdated: (user: User) => void;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(user.name);
      setEmail(user.email);
      setCurrentPassword("");
      setNewPassword("");
      setError(null);
      setSuccess(null);
    }
  }, [open, user]);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await api.updateProfile({ name, email });
      onUpdated(result.user);
      setSuccess("个人资料已更新");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "资料更新失败");
    } finally {
      setBusy(false);
    }
  };

  const updatePassword = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setSuccess("密码已更新，其它设备上的会话已失效");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "密码更新失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="账号与安全" description="更新个人资料或修改登录密码。" onClose={onClose}>
      <div className="profile-summary">
        <Avatar name={user.name} color={user.avatarColor} size="large" />
        <div>
          <h3>{user.name}</h3>
          <p>{user.role === "student" ? "学生" : "教师"} · {user.identifier} · {user.department}</p>
        </div>
      </div>
      <FormError message={error} />
      {success && <div className="form-success"><ShieldCheck size={16} /> {success}</div>}
      <form className="stack-form" onSubmit={saveProfile}>
        <div className="form-row form-row-two">
          <label>
            <span>姓名</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            <span>邮箱</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
        </div>
        <button className="button primary" type="submit" disabled={busy}>保存个人资料</button>
      </form>
      <div className="modal-divider" />
      <form className="stack-form" onSubmit={updatePassword}>
        <div className="form-row form-row-two">
          <label>
            <span>当前密码</span>
            <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
          </label>
          <label>
            <span>新密码</span>
            <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" placeholder="至少 8 位字母和数字" required />
          </label>
        </div>
        <button className="button ghost" type="submit" disabled={busy}>更新密码</button>
      </form>
    </Modal>
  );
}
