import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  Eye,
  EyeOff,
  GraduationCap,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound
} from "lucide-react";
import { api, ApiError } from "../api";
import type { Role, User } from "../types";
import { FormError } from "./ui";

type AuthMode = "login" | "register";

export default function AuthPage({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [role, setRole] = useState<Role>("student");
  const [mode, setMode] = useState<AuthMode>("login");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autofillKey] = useState(() => Math.random().toString(36).slice(2));
  const [form, setForm] = useState({
    identifier: "",
    password: "",
    name: "",
    email: "",
    department: "",
    className: "",
    inviteCode: ""
  });

  const setField = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const switchRole = (nextRole: Role) => {
    setRole(nextRole);
    setError(null);
  };

  const fillDemo = () => {
    setMode("login");
    setField("identifier", role === "student" ? "2024001" : "T1001");
    setField("password", role === "student" ? "Campus@2026" : "Teacher@2026");
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result =
        mode === "login"
          ? await api.login({ identifier: form.identifier, password: form.password, role })
          : await api.register({
              role,
              identifier: form.identifier,
              password: form.password,
              name: form.name,
              email: form.email,
              department: form.department,
              className: form.className,
              inviteCode: form.inviteCode
            });
      onAuthenticated(result.user);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "登录服务暂时不可用，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="知澜智慧校园介绍">
        <img src="/assets/course-statistics.jpg" alt="大学生在图书馆协作学习" />
        <div className="auth-story-shade" />
        <div className="auth-brand">
          <span className="brand-mark">
            <GraduationCap size={24} />
          </span>
          <div>
            <strong>知澜校园</strong>
            <span>ZHILAN SMART CAMPUS</span>
          </div>
        </div>
        <div className="auth-story-copy">
          <p className="eyebrow">AI + 教育 · 智慧校园学习中枢</p>
          <h1>让每一次学习，<br />都有数据与 AI 同行。</h1>
          <p>连接课程、作业、考勤与学情分析，为学生提供清晰路径，为教师提供可执行的班级洞察。</p>
          <div className="auth-feature-row">
            <span><Sparkles size={16} /> AI 学习助教</span>
            <span><BookOpenCheck size={16} /> 自适应学习路径</span>
            <span><ShieldCheck size={16} /> 角色权限隔离</span>
          </div>
        </div>
        <footer className="auth-story-footer">
          <span>2026 AI WEB 网页开发挑战赛</span>
          <span>学生 · 教师 · 教务协同</span>
        </footer>
      </section>

      <section className="auth-panel">
        <div className="auth-panel-inner">
          <div className="auth-mobile-brand">
            <span className="brand-mark"><GraduationCap size={22} /></span>
            <strong>知澜校园</strong>
          </div>
          <div className="auth-heading">
            <span className="auth-kicker">{mode === "login" ? "欢迎回来" : "创建校园账号"}</span>
            <h2>{mode === "login" ? "登录你的学习空间" : "加入知澜智慧校园"}</h2>
            <p>{mode === "login" ? "请选择身份并使用学校账号登录。" : "学生可自助注册，教师注册需邀请码。"}</p>
          </div>

          <div className="role-tabs" role="tablist" aria-label="选择登录身份">
            <button
              type="button"
              className={role === "student" ? "active" : ""}
              onClick={() => switchRole("student")}
              role="tab"
              aria-selected={role === "student"}
            >
              <UsersRound size={17} /> 学生
            </button>
            <button
              type="button"
              className={role === "teacher" ? "active" : ""}
              onClick={() => switchRole("teacher")}
              role="tab"
              aria-selected={role === "teacher"}
            >
              <UserRound size={17} /> 教师
            </button>
          </div>

          <form className="auth-form" onSubmit={submit} autoComplete="off">
            {mode === "register" && (
              <div className="form-row form-row-two">
                <label>
                  <span>姓名</span>
                  <div className="input-shell">
                    <UserRound size={17} />
                    <input
                      value={form.name}
                      onChange={(event) => setField("name", event.target.value)}
                      placeholder="请输入真实姓名"
                      autoComplete="name"
                      required
                    />
                  </div>
                </label>
                <label>
                  <span>院系</span>
                  <div className="input-shell">
                    <BookOpenCheck size={17} />
                    <input
                      value={form.department}
                      onChange={(event) => setField("department", event.target.value)}
                      placeholder={role === "student" ? "数字媒体学院" : "所属院系"}
                      required
                    />
                  </div>
                </label>
              </div>
            )}

            <label>
              <span>{role === "student" ? "学号" : "教师工号"}</span>
              <div className="input-shell">
                <UserRound size={17} />
                <input
                  name={`${autofillKey}-${mode}-identifier`}
                  value={form.identifier}
                  onChange={(event) => setField("identifier", event.target.value)}
                  placeholder={role === "student" ? "例如 2024001" : "例如 T1001"}
                  autoComplete={mode === "login" ? "off" : "username"}
                  required
                />
              </div>
            </label>

            {mode === "register" && (
              <label>
                <span>学校邮箱</span>
                <div className="input-shell">
                  <Mail size={17} />
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) => setField("email", event.target.value)}
                    placeholder="name@zhilan.edu.cn"
                    autoComplete="email"
                    required
                  />
                </div>
              </label>
            )}

            <label>
              <span>密码</span>
              <div className="input-shell">
                <LockKeyhole size={17} />
                <input
                  name={`${autofillKey}-${mode}-password`}
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(event) => setField("password", event.target.value)}
                  placeholder="至少 8 位，包含字母和数字"
                  autoComplete={mode === "login" ? "off" : "new-password"}
                  required
                />
                <button
                  className="password-toggle"
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>

            {mode === "register" && role === "student" && (
              <label>
                <span>班级</span>
                <div className="input-shell">
                  <UsersRound size={17} />
                  <input
                    value={form.className}
                    onChange={(event) => setField("className", event.target.value)}
                    placeholder="例如 数字媒体技术 2401"
                    required
                  />
                </div>
              </label>
            )}

            {mode === "register" && role === "teacher" && (
              <label>
                <span>教师邀请码</span>
                <div className="input-shell">
                  <ShieldCheck size={17} />
                  <input
                    value={form.inviteCode}
                    onChange={(event) => setField("inviteCode", event.target.value)}
                    placeholder="由管理员提供"
                    required
                  />
                </div>
              </label>
            )}

            <FormError message={error} />

            <button className="button primary auth-submit" type="submit" disabled={loading}>
              {loading ? <LoaderCircle className="spin" size={18} /> : null}
              {loading ? "正在验证…" : mode === "login" ? "进入学习空间" : "创建账号并登录"}
              {!loading && <ArrowRight size={17} />}
            </button>
          </form>

          {mode === "login" && (
            <div className="demo-account">
              <div>
                <span>演示账号</span>
                <strong>{role === "student" ? "2024001 / Campus@2026" : "T1001 / Teacher@2026"}</strong>
              </div>
              <button type="button" onClick={fillDemo}>一键填入</button>
            </div>
          )}

          <p className="auth-switch">
            {mode === "login" ? "还没有账号？" : "已经有账号？"}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError(null);
              }}
            >
              {mode === "login" ? "立即注册" : "返回登录"}
            </button>
          </p>

          <div className="auth-security">
            <ShieldCheck size={15} />
            <span>密码经 scrypt 加盐哈希存储，会话使用 HttpOnly 安全 Cookie。</span>
          </div>
        </div>
      </section>
    </main>
  );
}
