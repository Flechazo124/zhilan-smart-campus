import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Bot,
  BrainCircuit,
  Check,
  ChevronRight,
  Copy,
  LoaderCircle,
  MessageSquarePlus,
  Send,
  Sparkles,
  Trash2,
  UserRound
} from "lucide-react";
import { api, ApiError } from "../api";
import type { AIStatus, Conversation, Course, User } from "../types";
import {
  Avatar,
  EmptyState,
  FormError,
  LoadingBlock,
  PageHeading,
  StatusBadge
} from "../components/ui";

type Notify = (message: string, tone?: "success" | "error" | "info") => void;

const studentPrompts = [
  "根据我的近期作业生成一份 7 天复习计划",
  "用直观例子解释条件概率为什么分母会改变",
  "我应该怎样复盘这次作业中的错误？"
];

const teacherPrompts = [
  "根据班级学情给出本周教学干预建议",
  "为条件概率作业设计一份评分反馈模板",
  "怎样识别进度落后但平均分暂时正常的学生？"
];

export default function AITutor({
  user,
  courses,
  notify
}: {
  user: User;
  courses: Course[];
  notify: Notify;
}) {
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [courseId, setCourseId] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const isTeacher = user.role === "teacher";
  const active = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) || null,
    [activeId, conversations]
  );

  const loadConversations = async (preferredId?: string | null) => {
    const result = await api.conversations();
    setStatus(result.status);
    setConversations(result.conversations);
    const nextId =
      preferredId && result.conversations.some((item) => item.id === preferredId)
        ? preferredId
        : result.conversations[0]?.id || null;
    setActiveId(nextId);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.conversations()
      .then((result) => {
        if (cancelled) return;
        setStatus(result.status);
        setConversations(result.conversations);
        setActiveId(result.conversations[0]?.id || null);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : "AI 会话加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [active?.messages.length, sending]);

  const selectConversation = (conversation: Conversation) => {
    setActiveId(conversation.id);
    setCourseId(conversation.courseId || "");
    setError(null);
  };

  const startConversation = () => {
    setActiveId(null);
    setMessage("");
    setError(null);
  };

  const sendMessage = async (event?: FormEvent, suggestedText?: string) => {
    event?.preventDefault();
    const content = (suggestedText ?? message).trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    if (!suggestedText) setMessage("");
    try {
      const result = await api.askAI({
        message: content,
        conversationId: active?.id,
        courseId: courseId || active?.courseId || null
      });
      await loadConversations(result.conversationId);
      setStatus(result.status);
      if (result.reply.fallback && result.reply.warning) {
        notify(result.reply.warning, "info");
      }
    } catch (caught) {
      const nextError = caught instanceof ApiError ? caught.message : "AI 回复生成失败";
      setError(nextError);
      notify(nextError, "error");
      if (!suggestedText) setMessage(content);
    } finally {
      setSending(false);
    }
  };

  const removeConversation = async (conversation: Conversation) => {
    if (!window.confirm(`确定删除对话“${conversation.title}”吗？此操作不可撤销。`)) return;
    try {
      await api.deleteConversation(conversation.id);
      await loadConversations();
      notify("对话记录已删除");
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "对话删除失败", "error");
    }
  };

  const copyAnswer = async (content: string, key: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      notify("浏览器未允许复制，请手动选择文本", "error");
    }
  };

  return (
    <>
      <PageHeading
        eyebrow="AI 助教 · 教育场景推理"
        title={isTeacher ? "AI 教学助理" : "AI 学习助理"}
        description={
          isTeacher
            ? "结合课程任务与班级数据生成教学建议、诊断思路和反馈草稿。"
            : "结合你的课程、作业与学情提供启发式答疑，不直接代替独立作答。"
        }
        actions={
          <button className="button primary" type="button" onClick={startConversation}>
            <MessageSquarePlus size={16} /> 新建对话
          </button>
        }
      />

      <div className="ai-workspace">
        <aside className="panel ai-history-panel">
          <div className="ai-history-heading">
            <div>
              <span className="eyebrow">对话记录</span>
              <h2>最近学习</h2>
            </div>
            <StatusBadge tone={status?.configured ? "teal" : "gold"}>
              {status?.configured ? "远程模型" : "本地引擎"}
            </StatusBadge>
          </div>
          <button
            type="button"
            className={`ai-new-chat ${!activeId ? "active" : ""}`}
            onClick={startConversation}
          >
            <span><Sparkles size={16} /></span>
            <span><strong>开启新问题</strong><small>选择课程后直接提问</small></span>
            <ChevronRight size={14} />
          </button>
          <div className="ai-conversation-list">
            {loading ? (
              <LoadingBlock label="读取历史对话…" />
            ) : conversations.length ? (
              conversations.map((conversation) => (
                <div className={`ai-conversation-item ${activeId === conversation.id ? "active" : ""}`} key={conversation.id}>
                  <button type="button" onClick={() => selectConversation(conversation)}>
                    <Bot size={15} />
                    <span>
                      <strong>{conversation.title}</strong>
                      <small>{conversation.messages.length / 2 | 0} 轮 · {new Date(conversation.updatedAt).toLocaleDateString("zh-CN")}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ai-conversation-delete"
                    onClick={() => void removeConversation(conversation)}
                    aria-label={`删除对话 ${conversation.title}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            ) : (
              <p className="list-empty">还没有对话，从右侧提出第一个问题。</p>
            )}
          </div>
          <div className="ai-engine-note">
            <BrainCircuit size={17} />
            <div>
              <strong>{status?.provider || "正在检测 AI 服务"}</strong>
              <p>{status?.notice || "正在读取教学引擎状态。"}</p>
            </div>
          </div>
        </aside>

        <section className="panel ai-chat-panel">
          <header className="ai-chat-header">
            <div>
              <span className="ai-chat-mark"><Sparkles size={18} /></span>
              <div>
                <h2>{active?.title || "新的学习对话"}</h2>
                <p>{active ? "对话内容已持久化到校园数据库" : "提问后将自动创建并保存会话"}</p>
              </div>
            </div>
            <label className="ai-course-select">
              <span>课程上下文</span>
              <select
                value={courseId}
                onChange={(event) => setCourseId(event.target.value)}
                disabled={Boolean(active?.courseId)}
              >
                <option value="">通用学习助手</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>{course.name}</option>
                ))}
              </select>
            </label>
          </header>

          <div className="ai-message-stream" aria-live="polite">
            {active?.messages.length ? (
              active.messages.map((item, index) => {
                const itemKey = `${active.id}-${index}`;
                return item.role === "assistant" ? (
                  <article className="ai-message assistant-message" key={itemKey}>
                    <span className="ai-message-avatar"><Bot size={17} /></span>
                    <div>
                      <header>
                        <strong>知澜 AI 助教</strong>
                        <span>{item.provider || status?.provider || "教学推理引擎"}</span>
                      </header>
                      <p>{item.content}</p>
                      <button type="button" className="message-copy" onClick={() => void copyAnswer(item.content, itemKey)}>
                        {copiedKey === itemKey ? <Check size={13} /> : <Copy size={13} />}
                        {copiedKey === itemKey ? "已复制" : "复制回答"}
                      </button>
                    </div>
                  </article>
                ) : (
                  <article className="ai-message user-message" key={itemKey}>
                    <div>
                      <header><strong>{user.name}</strong><span>{item.createdAt ? new Date(item.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "刚刚"}</span></header>
                      <p>{item.content}</p>
                    </div>
                    <Avatar name={user.name} color={user.avatarColor} size="small" />
                  </article>
                );
              })
            ) : (
              <div className="ai-welcome">
                <span className="ai-welcome-orb"><Sparkles size={25} /></span>
                <p className="eyebrow">教学增强 · 而非替代思考</p>
                <h2>{isTeacher ? "今天想优化哪一段教学？" : "从哪里开始卡住了？"}</h2>
                <p>
                  {isTeacher
                    ? "我可以结合当前课程数据，帮助梳理教学诊断、作业反馈和课堂干预思路。"
                    : "告诉我题面、你的推导步骤或学习目标，我会先定位概念，再给下一步提示。"}
                </p>
                <div className="ai-prompt-grid">
                  {(isTeacher ? teacherPrompts : studentPrompts).map((prompt) => (
                    <button type="button" key={prompt} onClick={() => void sendMessage(undefined, prompt)} disabled={sending}>
                      <Sparkles size={14} />
                      <span>{prompt}</span>
                      <ChevronRight size={14} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {sending && (
              <article className="ai-message assistant-message ai-thinking">
                <span className="ai-message-avatar"><Bot size={17} /></span>
                <div>
                  <header><strong>知澜 AI 助教</strong><span>正在分析课程上下文</span></header>
                  <p><LoaderCircle className="spin" size={16} /> 正在组织可执行的教学回答…</p>
                </div>
              </article>
            )}
            <div ref={endRef} />
          </div>

          <form className="ai-composer" onSubmit={(event) => void sendMessage(event)}>
            <FormError message={error} />
            <div className="ai-composer-box">
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder={isTeacher ? "描述班级情况、题目或需要生成的反馈…" : "粘贴题目，或写出你卡住的具体步骤…"}
                rows={3}
                maxLength={6000}
                disabled={sending}
              />
              <div>
                <span>Ctrl + Enter 发送 · {message.length}/6000</span>
                <button className="button primary" type="submit" disabled={sending || !message.trim()}>
                  {sending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
                  {sending ? "思考中" : "发送问题"}
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
