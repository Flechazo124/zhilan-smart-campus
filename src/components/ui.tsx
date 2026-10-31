import { useEffect, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, LoaderCircle, X } from "lucide-react";
import type { ToastState } from "../types";

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = "medium"
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "small" | "medium" | "large";
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭弹窗">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>
  );
}

export function LoadingBlock({ label = "正在加载数据…" }: { label?: string }) {
  return (
    <div className="loading-block" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Avatar({
  name,
  color = "#0d746d",
  size = "medium"
}: {
  name: string;
  color?: string;
  size?: "small" | "medium" | "large";
}) {
  return (
    <span className={`avatar avatar-${size}`} style={{ "--avatar-color": color } as React.CSSProperties} aria-hidden="true">
      {name.slice(-2)}
    </span>
  );
}

export function ToastStack({ toasts, onDismiss }: { toasts: ToastState[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = toast.tone === "success" ? CheckCircle2 : toast.tone === "error" ? AlertCircle : Info;
        return (
          <div className={`toast toast-${toast.tone}`} key={toast.id}>
            <Icon size={17} />
            <span>{toast.message}</span>
            <button type="button" onClick={() => onDismiss(toast.id)} aria-label="关闭提示">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function StatusBadge({
  children,
  tone = "neutral"
}: {
  children: ReactNode;
  tone?: "teal" | "coral" | "gold" | "neutral" | "blue";
}) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

export function PageHeading({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </header>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="form-error" role="alert">
      <AlertCircle size={16} />
      <span>{message}</span>
    </div>
  );
}

export function formatDate(value: string | null | undefined, withTime = true) {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日期无效";
  return date.toLocaleString("zh-CN", {
    month: "long",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {})
  });
}

export function formatShortDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

export function dueMeta(value: string) {
  const delta = new Date(value).getTime() - Date.now();
  const hours = Math.ceil(delta / (60 * 60 * 1000));
  if (delta < 0) return { label: "已截止", tone: "coral" as const, urgent: true };
  if (hours <= 24) return { label: `剩余 ${Math.max(1, hours)} 小时`, tone: "coral" as const, urgent: true };
  if (hours <= 72) return { label: `剩余 ${Math.ceil(hours / 24)} 天`, tone: "gold" as const, urgent: false };
  return { label: `剩余 ${Math.ceil(hours / 24)} 天`, tone: "teal" as const, urgent: false };
}

export function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 16);
}
