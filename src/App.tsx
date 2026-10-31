import { useCallback, useEffect, useRef, useState } from "react";
import { GraduationCap, LoaderCircle, RefreshCcw } from "lucide-react";
import { api, ApiError } from "./api";
import AppShell from "./components/AppShell";
import AuthPage from "./components/AuthPage";
import { ToastStack } from "./components/ui";
import AITutor from "./pages/AITutor";
import Analytics from "./pages/Analytics";
import Announcements from "./pages/Announcements";
import Assignments from "./pages/Assignments";
import Attendance from "./pages/Attendance";
import Courses from "./pages/Courses";
import Dashboard from "./pages/Dashboard";
import type { DashboardData, ToastState, User, ViewName } from "./types";
import { useRealtime, type RealtimeEvent } from "./useRealtime";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [view, setView] = useState<ViewName>("dashboard");
  const [courseId, setCourseId] = useState<string | undefined>();
  const [authLoading, setAuthLoading] = useState(true);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const toastId = useRef(0);

  const notify = useCallback(
    (message: string, tone: "success" | "error" | "info" = "success") => {
      const id = ++toastId.current;
      setToasts((current) => [...current.slice(-2), { id, message, tone }]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 4200);
    },
    []
  );

  const dismissToast = (id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const refreshDashboard = useCallback(async () => {
    if (!user) return;
    setDashboardLoading(true);
    try {
      const next = await api.dashboard();
      setDashboard(next);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setDashboard(null);
        notify("登录状态已失效，请重新登录", "error");
        return;
      }
      notify(error instanceof ApiError ? error.message : "校园数据刷新失败", "error");
      throw error;
    } finally {
      setDashboardLoading(false);
    }
  }, [notify, user]);

  const handleRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      void refreshDashboard().catch(() => undefined);
      if (!user || event.actorId === user.id) return;

      if (event.type === "assignment" && event.action === "created") {
        notify(`实时收到新作业：${event.title}`, "info");
      } else if (event.type === "assignment" && event.action === "submitted" && user.role === "teacher") {
        notify(`${event.actorName} 已提交作业`, "info");
      } else if (event.type === "assignment" && event.action === "graded" && user.role === "student") {
        notify("作业已批改，评分与反馈已同步", "success");
      } else if (event.type === "attendance" && event.action === "created" && user.role === "student") {
        notify(`课堂签到已开始：${event.courseName}`, "info");
      } else if (event.type === "attendance" && event.action === "checked-in" && user.role === "teacher") {
        notify(`${event.actorName} 已完成签到`, "success");
      } else if (event.type === "announcement" && event.action === "created") {
        notify(`收到新通知：${event.title}`, "info");
      } else if (event.type === "course" && event.action === "enrolled" && user.role === "student") {
        notify(`已加入课程：${event.courseName}`, "info");
      }
    },
    [notify, refreshDashboard, user]
  );

  const { realtimeVersion, realtimeConnected } = useRealtime(user, handleRealtimeEvent);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      try {
        const session = await api.me();
        if (cancelled) return;
        setUser(session.user);
        setBootError(null);
        const nextDashboard = await api.dashboard();
        if (!cancelled) setDashboard(nextDashboard);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status !== 401) {
          setBootError(error.message);
        }
        setUser(null);
        setDashboard(null);
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAuthenticated = async (nextUser: User) => {
    setUser(nextUser);
    setView("dashboard");
    setCourseId(undefined);
    setDashboardLoading(true);
    try {
      const nextDashboard = await api.dashboard();
      setDashboard(nextDashboard);
      setBootError(null);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "工作台加载失败", "error");
    } finally {
      setDashboardLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setDashboard(null);
      setView("dashboard");
      setCourseId(undefined);
      setToasts([]);
    }
  };

  const navigate = (nextView: ViewName, options?: { courseId?: string }) => {
    setView(nextView);
    setCourseId(options?.courseId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (authLoading) {
    return (
      <main className="boot-screen">
        <span className="brand-mark"><GraduationCap size={28} /></span>
        <h1>知澜智慧校园</h1>
        <p>正在恢复安全会话与校园数据</p>
        <LoaderCircle className="spin" size={22} />
      </main>
    );
  }

  if (!user) {
    return (
      <>
        {bootError && (
          <div className="boot-warning" role="alert">
            <span>{bootError}</span>
            <button type="button" onClick={() => window.location.reload()}>
              <RefreshCcw size={14} /> 重新连接
            </button>
          </div>
        )}
        <AuthPage onAuthenticated={(nextUser) => void handleAuthenticated(nextUser)} />
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  const courses = dashboard?.courses || [];

  return (
    <>
      <AppShell
        user={user}
        view={view}
        dashboard={dashboard}
        realtimeVersion={realtimeVersion}
        realtimeConnected={realtimeConnected}
        onNavigate={navigate}
        onLogout={handleLogout}
        onUserUpdated={(nextUser) => {
          setUser(nextUser);
          notify("个人资料已同步");
        }}
        onDashboardRefresh={refreshDashboard}
      >
        {dashboardLoading && !dashboard ? (
          <div className="page-loading">
            <div className="loading-orbit"><span /></div>
            <p>正在同步校园数据…</p>
          </div>
        ) : (
          <>
            {view === "dashboard" && (
              <Dashboard
                user={user}
                data={dashboard}
                onNavigate={navigate}
                onRefresh={refreshDashboard}
                notify={notify}
              />
            )}
            {view === "courses" && (
              <Courses
                user={user}
                initialCourseId={courseId}
                onNavigate={navigate}
                onRefresh={refreshDashboard}
                realtimeVersion={realtimeVersion}
                notify={notify}
              />
            )}
            {view === "assignments" && (
              <Assignments
                user={user}
                courses={courses}
                onRefresh={refreshDashboard}
                realtimeVersion={realtimeVersion}
                notify={notify}
              />
            )}
            {view === "ai" && (
              <AITutor user={user} courses={courses} notify={notify} />
            )}
            {view === "attendance" && (
              <Attendance
                user={user}
                courses={courses}
                onRefresh={refreshDashboard}
                realtimeVersion={realtimeVersion}
                notify={notify}
              />
            )}
            {view === "analytics" && (
              <Analytics
                user={user}
                courses={courses}
                realtimeVersion={realtimeVersion}
                notify={notify}
              />
            )}
            {view === "announcements" && (
              <Announcements
                user={user}
                courses={courses}
                onRefresh={refreshDashboard}
                realtimeVersion={realtimeVersion}
                notify={notify}
              />
            )}
          </>
        )}
      </AppShell>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
