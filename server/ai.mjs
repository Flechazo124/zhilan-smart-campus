import { randomUUID } from "node:crypto";
import "./config.mjs";

const providerConfig = {
  apiKey: process.env.AI_API_KEY || "",
  baseUrl: (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
  model: process.env.AI_MODEL || "gpt-4o-mini"
};

export function getAIStatus() {
  return {
    mode: providerConfig.apiKey ? "remote" : "local",
    configured: Boolean(providerConfig.apiKey),
    provider: providerConfig.apiKey ? "OpenAI-compatible" : "知澜本地教学引擎",
    model: providerConfig.apiKey ? providerConfig.model : "pedagogy-rules-1.0",
    notice: providerConfig.apiKey
      ? `正在使用 ${providerConfig.model} 提供 AI 辅导`
      : "未配置远程模型密钥，当前使用可离线运行的本地教学推理引擎"
  };
}

function localTeachingReply(prompt, context) {
  const text = prompt.toLowerCase();
  const role = context.user?.role || "student";
  const upcoming = (context.assignments || [])
    .filter((item) => item.dueAt)
    .slice(0, 3)
    .map((item) => `• ${item.title}：${new Date(item.dueAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`)
    .join("\n");

  if (text.includes("学习计划") || text.includes("复习计划") || text.includes("怎么安排")) {
    return [
      "根据你当前未完成的任务和最近学习记录，我建议按下面顺序推进：",
      upcoming || "• 先完成最近一次课程作业，再做一次 15 分钟错题复盘。",
      "",
      "执行方式：先做 25 分钟主动练习，再用 5 分钟复述“已知条件、目标问题、使用公式”。如果正确率低于 70%，不要立刻刷新题，先回到错题定位概念。",
      "",
      context.notice ? `\n说明：${context.notice}` : ""
    ].join("\n");
  }

  if (text.includes("条件概率") || text.includes("样本空间")) {
    return [
      "条件概率的关键不是记公式，而是识别样本空间何时缩小。",
      "已知事件 B 发生后，只保留 B 范围内的结果；目标事件 A 也发生，就只能落在 A∩B 中。",
      "",
      "P(A|B) = P(A∩B) / P(B)",
      "",
      "检查步骤：",
      "1. 用一句话写清“已知谁已经发生”。",
      "2. 把 B 设为新的全集。",
      "3. 在 B 中圈出 A∩B，再用交集占 B 的比例计算。",
      "",
      "你可以把你正在做的题贴过来，我会先追问事件定义，再给出下一步提示。"
    ].join("\n");
  }

  if (text.includes("贝叶斯") || text.includes("检测")) {
    return [
      "贝叶斯问题最容易忽略的是基础概率。检测结果阳性并不等于患病概率很高。",
      "先把问题拆成：先验 P(患病)、灵敏度 P(阳性|患病)、假阳性 P(阳性|未患病)。",
      "",
      "后验概率 = 真阳性 / 所有阳性",
      "= P(阳性|患病)P(患病) / [P(阳性|患病)P(患病) + P(阳性|未患病)P(未患病)]",
      "",
      "建议画两层树状图再代入数值，这比直接套长公式更不容易混淆。"
    ].join("\n");
  }

  if (text.includes("批改") || text.includes("评分") || role === "teacher") {
    return [
      "教师端批改建议按“概念准确性、推理完整性、表达清晰度”三个维度进行。",
      "这次作业可重点检查：学生是否明确写出事件定义；是否解释了分母为何改变；是否能将结果与真实情境对应。",
      "",
      "如果需要，我可以在你选择具体作答后，根据这三个维度生成反馈草稿，并保存到批改记录。"
    ].join("\n");
  }

  if (text.includes("学情") || text.includes("班级") || text.includes("分析")) {
    return [
      "班级学情分析应同时观察“平均表现”和“掉队风险”，不能只看平均分。",
      "建议优先关注两类学生：进度低于班级平均 15% 的学生，以及最近三次作业分数持续下降的学生。",
      "",
      "下一步可以安排一次 10 分钟概念诊断，并把高频错误整理成课堂讲解案例。"
    ].join("\n");
  }

  return [
    "我已经结合当前课程上下文理解你的问题。为了给出更有用的帮助，请补充你卡住的具体步骤或题面。",
    context.course ? `当前课程：${context.course.name}。` : "",
    "你可以选择：解释概念、分析一道题、生成复习计划，或让教师端根据作答生成批改反馈。",
    "",
    context.notice || ""
  ].filter(Boolean).join("\n");
}

function buildCourseContext(context) {
  const user = context.user || {};
  const course = context.course || {};
  const assignments = (context.assignments || []).slice(0, 6);
  const analytics = context.analytics || {};
  return [
    `当前用户：${user.name || "未知用户"}，角色：${user.role === "teacher" ? "教师" : "学生"}。`,
    course.name ? `当前课程：${course.name}（${course.code || ""}）。` : "",
    course.description ? `课程简介：${course.description}` : "",
    assignments.length ? `近期任务：${assignments.map((item) => item.title).join("、")}。` : "",
    analytics.averageScore != null ? `平均成绩：${analytics.averageScore}。` : "",
    "回答要求：使用简洁中文；优先启发式引导；不得伪造学生数据；不确定时明确说明；涉及具体成绩时只引用提供的上下文。"
  ].filter(Boolean).join("\n");
}

async function remoteTeachingReply(prompt, history, context) {
  const messages = [
    {
      role: "system",
      content: [
        "你是知澜智慧校园中的 AI 教学助理，服务学生与教师。",
        buildCourseContext(context),
        "保持回答准确、可操作，并贴合中国高校课程场景。"
      ].join("\n")
    },
    ...history.slice(-10).map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content).slice(0, 6000)
    })),
    { role: "user", content: prompt }
  ];

  const response = await fetch(`${providerConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerConfig.apiKey}`
    },
    body: JSON.stringify({
      model: providerConfig.model,
      messages,
      temperature: 0.35,
      max_tokens: 900
    }),
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`AI provider returned ${response.status}: ${detail.slice(0, 240)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("AI provider returned an empty response");
  }

  return {
    content,
    provider: "OpenAI-compatible",
    model: providerConfig.model,
    fallback: false
  };
}

export async function generateTeachingReply({ prompt, history = [], context = {} }) {
  const status = getAIStatus();
  const safePrompt = String(prompt || "").trim().slice(0, 6000);
  if (!safePrompt) {
    throw new Error("问题内容不能为空");
  }

  if (status.configured) {
    try {
      return await remoteTeachingReply(safePrompt, history, context);
    } catch (error) {
      console.error("[AI] Remote provider failed, using local engine:", error.message);
      return {
        content: localTeachingReply(safePrompt, { ...context, notice: "远程模型暂时不可用，本次回答由本地教学引擎生成。" }),
        provider: "知澜本地教学引擎",
        model: "pedagogy-rules-1.0",
        fallback: true,
        warning: "远程模型暂时不可用，已自动切换到本地教学引擎。"
      };
    }
  }

  return {
    content: localTeachingReply(safePrompt, context),
    provider: "知澜本地教学引擎",
    model: "pedagogy-rules-1.0",
    fallback: false
  };
}

export function newConversationTitle(prompt) {
  const title = String(prompt || "新的学习对话").replace(/\s+/g, " ").trim();
  return title.length > 26 ? `${title.slice(0, 26)}…` : title || `对话 ${randomUUID().slice(0, 4)}`;
}
