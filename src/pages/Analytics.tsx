import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Download,
  GraduationCap,
  LoaderCircle,
  RefreshCcw,
  Target,
  TrendingUp,
  UsersRound
} from "lucide-react";
import { api, ApiError, downloadFile } from "../api";
import type {
  Course,
  StudentAnalytics,
  TeacherAnalytics,
  User
} from "../types";
import {
  Avatar,
  EmptyState,
  FormError,
  formatDuration,
  LoadingBlock,
  PageHeading,
  StatusBadge
} from "../components/ui";

type Notify = (message: string, tone?: "success" | "error" | "info") => void;

export default function Analytics({
  user,
  courses,
  realtimeVersion,
  notify
}: {
  user: User;
  courses: Course[];
  realtimeVersion: number;
  notify: Notify;
}) {
  const isTeacher = user.role === "teacher";
  const [courseId, setCourseId] = useState(courses[0]?.id || "");
  const [studentData, setStudentData] = useState<StudentAnalytics | null>(null);
  const [teacherData, setTeacherData] = useState<TeacherAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = async (nextCourseId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.analytics(isTeacher ? nextCourseId || courseId || undefined : undefined);
      if (isTeacher) {
        setTeacherData(result as TeacherAnalytics);
      } else {
        setStudentData(result as StudentAnalytics);
      }
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : "学情数据加载失败";
      setError(message);
      if (!(caught instanceof ApiError && caught.status === 404)) notify(message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialCourse = courses[0]?.id || "";
    if (isTeacher && !initialCourse) {
      setLoading(false);
      return;
    }
    setCourseId((current) => current || initialCourse);
    void loadAnalytics(initialCourse);
  }, [isTeacher]);

  useEffect(() => {
    if (realtimeVersion > 0) void loadAnalytics(isTeacher ? courseId : undefined);
  }, [realtimeVersion]);

  const handleCourseChange = (nextCourseId: string) => {
    setCourseId(nextCourseId);
    void loadAnalytics(nextCourseId);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile("/api/export/courses.csv", `知澜智慧校园-${isTeacher ? "课程数据" : "学习数据"}.csv`);
      notify("课程数据 CSV 已导出");
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "数据导出失败", "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeading
        eyebrow={isTeacher ? "教学决策 · 班级诊断" : "数据反馈 · 学习诊断"}
        title={isTeacher ? "班级学情" : "学情分析"}
        description={
          isTeacher
            ? "从成绩、进度、作业与出勤多维识别班级共性问题与需要干预的学生。"
            : "汇总课程掌握度、作业得分、学习投入和课堂出勤，明确下一步行动。"
        }
        actions={
          <>
            <button className="button ghost" type="button" onClick={() => void loadAnalytics()}>
              <RefreshCcw size={15} /> 刷新数据
            </button>
            <button className="button primary" type="button" onClick={() => void exportCsv()} disabled={exporting}>
              {exporting ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
              {exporting ? "正在导出…" : "导出 CSV"}
            </button>
          </>
        }
      />

      {isTeacher && (
        <div className="analytics-course-bar">
          <div>
            <span className="eyebrow">分析范围</span>
            <strong>选择课程查看独立班级数据</strong>
          </div>
          <label>
            <BookOpen size={16} />
            <select value={courseId} onChange={(event) => handleCourseChange(event.target.value)}>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>{course.name} · {course.code}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <FormError message={error} />
      {loading ? (
        <section className="panel"><LoadingBlock label="正在计算学情指标…" /></section>
      ) : isTeacher ? (
        teacherData ? (
          <TeacherAnalyticsView data={teacherData} />
        ) : (
          <section className="panel">
            <EmptyState icon={<BarChart3 />} title="暂无可分析课程" description="创建课程并加入学生后即可查看班级学情。" />
          </section>
        )
      ) : studentData ? (
        <StudentAnalyticsView data={studentData} />
      ) : (
        <section className="panel">
          <EmptyState icon={<BarChart3 />} title="暂无可分析数据" description="加入课程并完成作业后，学情指标会逐步生成。" />
        </section>
      )}
    </>
  );
}

function StudentAnalyticsView({ data }: { data: StudentAnalytics }) {
  const maxMinutes = Math.max(...data.studySeries.map((item) => item.minutes), 60);
  const attendanceTotal = data.attendance.total;
  const attendanceRate = attendanceTotal ? Math.round((data.attendance.present / attendanceTotal) * 100) : 0;
  const submissionAverage = data.submissions.length
    ? Math.round(
        data.submissions.reduce((sum, item) => sum + (item.score / item.maxScore) * 100, 0) /
          data.submissions.length
      )
    : null;

  return (
    <>
      <div className="analytics-stat-grid">
        <AnalyticsStat
          icon={<Target />}
          label="课程平均成绩"
          value={data.metrics.averageGrade == null ? "—" : `${data.metrics.averageGrade}`}
          note="基于课程成绩"
          tone="teal"
        />
        <AnalyticsStat
          icon={<TrendingUp />}
          label="作业得分率"
          value={submissionAverage == null ? "—" : `${submissionAverage}%`}
          note={`${data.submissions.length} 次已评分作业`}
          tone="gold"
        />
        <AnalyticsStat
          icon={<CheckCircle2 />}
          label="课堂出勤率"
          value={`${attendanceRate}%`}
          note={`${data.attendance.present}/${attendanceTotal} 次到场`}
          tone="blue"
        />
        <AnalyticsStat
          icon={<BookOpen />}
          label="近 7 天学习"
          value={formatDuration(data.metrics.studyMinutes)}
          note={`${data.metrics.courseCount} 门课程进行中`}
          tone="coral"
        />
      </div>

      <div className="analytics-main-grid">
        <section className="panel analytics-trend-panel">
          <header className="panel-header">
            <div><span className="eyebrow">学习投入趋势</span><h2>近 14 天专注记录</h2></div>
            <StatusBadge tone="teal"><TrendingUp size={13} /> 数据已汇总</StatusBadge>
          </header>
          {data.studySeries.length ? (
            <div className="study-bar-chart">
              <div className="bar-y-axis">
                <span>{Math.ceil(maxMinutes / 30) * 30}</span>
                <span>{Math.ceil(maxMinutes / 60) * 30}</span>
                <span>0</span>
              </div>
              <div className="bar-columns">
                {data.studySeries.map((item) => (
                  <div className="bar-column" key={item.date} title={`${item.date} · ${item.minutes} 分钟`}>
                    <span className="bar-value">{item.minutes}</span>
                    <span className="bar-fill" style={{ height: `${Math.max(4, (item.minutes / maxMinutes) * 100)}%` }} />
                    <small>{new Date(`${item.date}T00:00:00`).toLocaleDateString("zh-CN", { day: "numeric" })}</small>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState icon={<BarChart3 />} title="暂无学习时长" description="开始学习并记录专注时间后，这里会显示趋势。" />
          )}
        </section>

        <section className="panel mastery-panel">
          <header className="panel-header">
            <div><span className="eyebrow">知识掌握</span><h2>课程进度对照</h2></div>
            <StatusBadge tone="blue">{data.courseMastery.length} 门</StatusBadge>
          </header>
          <div className="mastery-list">
            {data.courseMastery.map((course) => (
              <article key={course.id}>
                <div>
                  <span className={`course-accent ${course.color}`}>{course.code.slice(0, 2)}</span>
                  <span><strong>{course.name}</strong><small>{course.code} · 成绩 {course.grade ?? "—"}</small></span>
                  <strong>{course.progress}%</strong>
                </div>
                <div className="progress-track"><span style={{ width: `${course.progress}%` }} /></div>
              </article>
            ))}
          </div>
        </section>
      </div>

      <div className="analytics-lower-grid">
        <section className="panel recent-grade-panel">
          <header className="panel-header">
            <div><span className="eyebrow">反馈记录</span><h2>近期作业表现</h2></div>
            <StatusBadge tone="gold">{data.metrics.completedAssignments} 项已完成</StatusBadge>
          </header>
          <div className="analytics-grade-list">
            {data.submissions.length ? data.submissions.map((submission, index) => {
              const percent = Math.round((submission.score / submission.maxScore) * 100);
              return (
                <article key={`${submission.title}-${index}`}>
                  <span className={`grade-dot ${percent >= 85 ? "high" : percent >= 70 ? "mid" : "low"}`} />
                  <span><strong>{submission.title}</strong><small>{submission.courseName}</small></span>
                  <div><strong>{submission.score}</strong><span>/{submission.maxScore}</span></div>
                  <StatusBadge tone={percent >= 85 ? "teal" : percent >= 70 ? "gold" : "coral"}>{percent}%</StatusBadge>
                </article>
              );
            }) : <p className="list-empty">暂无已评分作业。</p>}
          </div>
        </section>

        <section className="panel attendance-analysis-panel">
          <header className="panel-header">
            <div><span className="eyebrow">课堂参与</span><h2>出勤构成</h2></div>
          </header>
          <div className="attendance-composition">
            <div className="composition-donut" style={{ "--present": `${attendanceRate}%` } as React.CSSProperties}>
              <span><strong>{attendanceRate}%</strong><small>到场率</small></span>
            </div>
            <div>
              <span><i className="dot teal" /> 正常出勤 <strong>{data.attendance.present}</strong></span>
              <span><i className="dot gold" /> 请假记录 <strong>{data.attendance.leave}</strong></span>
              <span><i className="dot coral" /> 缺勤记录 <strong>{data.attendance.absent}</strong></span>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function TeacherAnalyticsView({ data }: { data: TeacherAnalytics }) {
  const attendanceRate = data.metrics.attendanceRate;
  const atRisk = data.students
    .filter((student) => student.progress < Math.max(40, data.metrics.averageProgress - 15) || (student.grade != null && student.grade < 60))
    .slice(0, 5);

  return (
    <>
      <div className="teacher-class-context">
        <div>
          <span className={`course-accent ${data.course.color}`}>{data.course.code.slice(0, 2)}</span>
          <div><span className="eyebrow">{data.course.code} · {data.course.term}</span><h2>{data.course.name}</h2></div>
        </div>
        <p>{data.course.schedule} · {data.course.room} · 平均进度 {data.metrics.averageProgress}%</p>
      </div>

      <div className="analytics-stat-grid">
        <AnalyticsStat icon={<UsersRound />} label="班级人数" value={`${data.metrics.studentCount}`} note="已选课学生" tone="blue" />
        <AnalyticsStat icon={<Target />} label="班级平均分" value={data.metrics.averageGrade == null ? "—" : `${data.metrics.averageGrade}`} note="全部课程成绩" tone="teal" />
        <AnalyticsStat icon={<TrendingUp />} label="平均课程进度" value={`${data.metrics.averageProgress}%`} note="按学生进度平均" tone="gold" />
        <AnalyticsStat icon={<AlertTriangle />} label="需要关注" value={`${data.metrics.atRiskCount}`} note={`出勤率 ${attendanceRate}%`} tone="coral" />
      </div>

      <div className="analytics-main-grid teacher-analytics-main">
        <section className="panel grade-distribution-panel">
          <header className="panel-header">
            <div><span className="eyebrow">成绩结构</span><h2>班级分数分布</h2></div>
            <StatusBadge tone="teal">平均 {data.metrics.averageGrade ?? "—"} 分</StatusBadge>
          </header>
          <div className="grade-bands">
            {data.gradeBands.map((band) => {
              const max = Math.max(...data.gradeBands.map((item) => item.count), 1);
              return (
                <div key={band.label}>
                  <span>{band.label}</span>
                  <div><i style={{ width: `${(band.count / max) * 100}%` }} /></div>
                  <strong>{band.count} 人</strong>
                </div>
              );
            })}
          </div>
          <div className="analytics-insight">
            <BarChart3 size={17} />
            <p>
              班级平均进度为 <strong>{data.metrics.averageProgress}%</strong>，建议优先关注进度低于{" "}
              <strong>{Math.max(15, data.metrics.averageProgress - 15)}%</strong> 的学生。
            </p>
          </div>
        </section>

        <section className="panel student-risk-panel">
          <header className="panel-header">
            <div><span className="eyebrow">教学干预</span><h2>优先关注学生</h2></div>
            <StatusBadge tone="coral">{atRisk.length} 人</StatusBadge>
          </header>
          <div className="risk-student-list">
            {atRisk.length ? atRisk.map((student) => (
              <article key={student.id}>
                <Avatar name={student.name} color={student.avatarColor} size="small" />
                <span><strong>{student.name}</strong><small>{student.identifier} · 已提交 {student.submittedCount} 次</small></span>
                <div>
                  <span>进度 {student.progress}%</span>
                  <span className={student.grade != null && student.grade < 60 ? "risk" : ""}>成绩 {student.grade ?? "—"}</span>
                </div>
                {student.progress < data.metrics.averageProgress ? <ArrowDownRight size={16} /> : <ArrowUpRight size={16} />}
              </article>
            )) : <p className="list-empty">当前没有明显掉队风险的学生。</p>}
          </div>
        </section>
      </div>

      <div className="analytics-lower-grid teacher-analytics-lower">
        <section className="panel assignment-performance-panel">
          <header className="panel-header">
            <div><span className="eyebrow">作业有效性</span><h2>各项任务提交与得分</h2></div>
          </header>
          <div className="assignment-performance-list">
            {data.assignments.map((assignment) => (
              <article key={assignment.id}>
                <span><strong>{assignment.title}</strong><small>{assignment.submissions} / {data.metrics.studentCount} 人提交</small></span>
                <div className="progress-track">
                  <span style={{ width: `${data.metrics.studentCount ? (assignment.submissions / data.metrics.studentCount) * 100 : 0}%` }} />
                </div>
                <strong>{assignment.averageScore == null ? "—" : assignment.averageScore}<small> / {assignment.maxScore}</small></strong>
              </article>
            ))}
            {!data.assignments.length && <p className="list-empty">当前课程尚未发布作业。</p>}
          </div>
        </section>

        <section className="panel student-overview-panel">
          <header className="panel-header">
            <div><span className="eyebrow">学生明细</span><h2>学习进度概览</h2></div>
            <StatusBadge tone="blue">{data.students.length} 人</StatusBadge>
          </header>
          <div className="student-overview-table">
            <div className="student-overview-head">
              <span>学生</span><span>进度</span><span>成绩</span><span>出勤</span>
            </div>
            {data.students.slice(0, 6).map((student) => (
              <div key={student.id}>
                <span><Avatar name={student.name} color={student.avatarColor} size="small" /><strong>{student.name}</strong></span>
                <span>{student.progress}%</span>
                <span>{student.grade ?? "—"}</span>
                <span>{student.attendanceRate}%</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function AnalyticsStat({
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
    <article className={`analytics-stat tone-${tone}`}>
      <span>{icon}</span>
      <div><small>{label}</small><strong>{value}</strong><p>{note}</p></div>
    </article>
  );
}
