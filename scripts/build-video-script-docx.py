from __future__ import annotations

import re
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "docx"
OUTPUT_PATH = OUTPUT_DIR / "知澜智慧校园-视频讲解稿.docx"

BLACK = RGBColor(0, 0, 0)
INK = RGBColor(31, 41, 45)
MUTED = RGBColor(92, 110, 117)
HEADER_FILL = "163A43"
ALT_FILL = "F2F6F5"
BORDER = "D9D9D9"
FONT_CN = "微软雅黑"
FONT_LATIN = "Aptos"

TITLE = "知澜智慧校园视频讲解稿"
SUBTITLE = "5 至 8 分钟作品演示录制脚本"

SPOKEN_BLOCKS: list[str] = []


def set_run_font(run, name: str = FONT_CN, size: float | None = None, bold: bool | None = None):
    run.font.name = name
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), FONT_LATIN)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), FONT_LATIN)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    run.font.color.rgb = BLACK


def set_style_font(style, name: str = FONT_CN):
    r_pr = style._element.get_or_add_rPr()
    r_fonts = r_pr.rFonts
    if r_fonts is None:
        r_fonts = OxmlElement("w:rFonts")
        r_pr.append(r_fonts)
    r_fonts.set(qn("w:eastAsia"), name)
    r_fonts.set(qn("w:ascii"), FONT_LATIN)
    r_fonts.set(qn("w:hAnsi"), FONT_LATIN)


def set_cell_shading(cell, fill: str):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=110, start=110, bottom=110, end=110):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for margin, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{margin}"))
        if node is None:
            node = OxmlElement(f"w:{margin}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table):
    tbl_pr = table._tbl.tblPr
    borders = tbl_pr.first_child_found_in("w:tblBorders")
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = f"w:{edge}"
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), "4")
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), BORDER)


def prevent_row_split(row):
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement("w:cantSplit")
    tr_pr.append(cant_split)


def keep_table_together(table):
    for row in table.rows[:-1]:
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                paragraph.paragraph_format.keep_with_next = True


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_cell_text(cell, text: str, *, bold=False, color=BLACK, size=10.2, align=WD_ALIGN_PARAGRAPH.LEFT):
    cell.text = ""
    paragraph = cell.paragraphs[0]
    paragraph.alignment = align
    paragraph.paragraph_format.space_after = Pt(0)
    paragraph.paragraph_format.line_spacing = 1.2
    run = paragraph.add_run(text)
    set_run_font(run, size=size, bold=bold)
    run.font.color.rgb = color
    cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
    set_cell_margins(cell)


def add_table(doc: Document, headers: list[str], rows: list[list[str]], widths: list[float]):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_borders(table)
    header_row = table.rows[0]
    set_repeat_table_header(header_row)
    prevent_row_split(header_row)
    for index, text in enumerate(headers):
        cell = header_row.cells[index]
        cell.width = Cm(widths[index])
        set_cell_shading(cell, HEADER_FILL)
        set_cell_text(cell, text, bold=True, color=RGBColor(255, 255, 255), size=9.6)
    for row_index, values in enumerate(rows):
        row = table.add_row()
        prevent_row_split(row)
        for column_index, text in enumerate(values):
            cell = row.cells[column_index]
            cell.width = Cm(widths[column_index])
            if row_index % 2 == 1:
                set_cell_shading(cell, ALT_FILL)
            alignment = WD_ALIGN_PARAGRAPH.CENTER if column_index == 0 else WD_ALIGN_PARAGRAPH.LEFT
            set_cell_text(cell, text, size=9.4, align=alignment)
    return table


def configure_styles(doc: Document):
    normal = doc.styles["Normal"]
    normal.font.name = FONT_CN
    set_style_font(normal)
    normal.font.size = Pt(11)
    normal.font.color.rgb = BLACK
    normal.paragraph_format.line_spacing = 1.38
    normal.paragraph_format.space_after = Pt(7)

    for style_name, size, before, after in (
        ("Title", 25, 0, 12),
        ("Heading 1", 18, 12, 8),
        ("Heading 2", 14, 10, 6),
        ("Heading 3", 11.5, 8, 4),
    ):
        style = doc.styles[style_name]
        style.font.name = FONT_CN
        set_style_font(style)
        style.font.size = Pt(size)
        style.font.bold = style_name != "Title"
        style.font.color.rgb = BLACK
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True


def add_page_number(paragraph):
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = paragraph.add_run()
    set_run_font(run, size=8.5)
    fld_char1 = OxmlElement("w:fldChar")
    fld_char1.set(qn("w:fldCharType"), "begin")
    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = "PAGE"
    fld_char2 = OxmlElement("w:fldChar")
    fld_char2.set(qn("w:fldCharType"), "end")
    run._r.append(fld_char1)
    run._r.append(instr_text)
    run._r.append(fld_char2)


def add_body(doc: Document, text: str):
    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
    run = paragraph.add_run(text)
    set_run_font(run, size=11)
    run.font.color.rgb = INK
    return paragraph


def add_labeled_paragraph(doc: Document, label: str, text: str, *, spoken=False):
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.keep_together = True
    label_run = paragraph.add_run(f"{label}：")
    set_run_font(label_run, size=11, bold=True)
    body_run = paragraph.add_run(text)
    set_run_font(body_run, size=11)
    body_run.font.color.rgb = INK
    if spoken:
        SPOKEN_BLOCKS.append(text)
    return paragraph


def add_narration(doc: Document, text: str):
    return add_labeled_paragraph(doc, "讲解词", text, spoken=True)


def add_bullet(doc: Document, text: str):
    paragraph = doc.add_paragraph(style="List Bullet")
    paragraph.paragraph_format.left_indent = Cm(0.7)
    paragraph.paragraph_format.first_line_indent = Cm(-0.35)
    paragraph.paragraph_format.space_after = Pt(4)
    run = paragraph.add_run(text)
    set_run_font(run, size=10.6)
    run.font.color.rgb = INK


def add_page_break(doc: Document):
    paragraph = doc.add_paragraph()
    paragraph.add_run().add_break(WD_BREAK.PAGE)


def add_section_heading(doc: Document, title: str, level: int = 1):
    paragraph = doc.add_paragraph(style=f"Heading {level}")
    run = paragraph.add_run(title)
    set_run_font(run, size={1: 18, 2: 14, 3: 11.5}[level], bold=True)
    return paragraph


def add_segment(
    doc: Document,
    number: str,
    time_range: str,
    title: str,
    screen_action: str,
    narration: str,
    tip: str | None = None,
):
    add_section_heading(doc, f"{number} {title}", 2)
    attention = doc.add_paragraph()
    attention.paragraph_format.space_after = Pt(5)
    attention.paragraph_format.keep_with_next = True
    time_run = attention.add_run(f"{time_range}  ")
    set_run_font(time_run, size=10.4, bold=True)
    time_run.font.color.rgb = MUTED
    target_run = attention.add_run("画面重点与讲稿")
    set_run_font(target_run, size=10.4, bold=True)
    screen_paragraph = add_labeled_paragraph(doc, "画面操作", screen_action)
    screen_paragraph.paragraph_format.keep_with_next = True
    narration_paragraph = add_narration(doc, narration)
    if tip:
        narration_paragraph.paragraph_format.keep_with_next = True
        tip_paragraph = add_labeled_paragraph(doc, "录制提示", tip)
        tip_paragraph.paragraph_format.keep_together = True


def build_document() -> Path:
    doc = Document()
    configure_styles(doc)
    section = doc.sections[0]
    section.page_width = Cm(21)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.2)
    section.bottom_margin = Cm(2.0)
    section.left_margin = Cm(2.3)
    section.right_margin = Cm(2.3)
    section.footer_distance = Cm(1.0)
    add_page_number(section.footer.paragraphs[0])

    doc.core_properties.title = TITLE
    doc.core_properties.subject = SUBTITLE
    doc.core_properties.author = "微光胡闹队"
    doc.core_properties.keywords = "知澜智慧校园, 视频讲解, AI 助教, 传智杯"

    kicker = doc.add_paragraph()
    kicker.alignment = WD_ALIGN_PARAGRAPH.LEFT
    kicker.paragraph_format.space_before = Pt(52)
    kicker.paragraph_format.space_after = Pt(14)
    kicker_run = kicker.add_run("传智杯 Web 网页开发赛")
    set_run_font(kicker_run, size=11, bold=True)
    kicker_run.font.color.rgb = MUTED

    title = doc.add_paragraph(style="Title")
    title.alignment = WD_ALIGN_PARAGRAPH.LEFT
    title_run = title.add_run(TITLE)
    set_run_font(title_run, size=25, bold=True)

    subtitle = doc.add_paragraph()
    subtitle.paragraph_format.space_after = Pt(54)
    subtitle_run = subtitle.add_run(SUBTITLE)
    set_run_font(subtitle_run, size=13)
    subtitle_run.font.color.rgb = MUTED

    cover_table = doc.add_table(rows=6, cols=2)
    cover_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cover_table.autofit = False
    set_table_borders(cover_table)
    cover_values = [
        ("参赛团队", "微光胡闹队"),
        ("参赛学校", "北华航天工业学院"),
        ("团队成员", "袁正、胡开元、屈轶宸"),
        ("指导教师", "牛静"),
        ("参赛作品", "知澜智慧校园"),
        ("建议时长", "6 分 45 秒，可按扩展段延长至 8 分钟"),
    ]
    for index, (label, value) in enumerate(cover_values):
        row = cover_table.rows[index]
        prevent_row_split(row)
        set_cell_shading(row.cells[0], ALT_FILL)
        set_cell_text(row.cells[0], label, bold=True, size=10.2)
        set_cell_text(row.cells[1], value, size=10.2)
        row.cells[0].width = Cm(4.2)
        row.cells[1].width = Cm(11.8)

    closing = doc.add_paragraph()
    closing.paragraph_format.space_before = Pt(38)
    closing_run = closing.add_run(
        "用途：本稿用于屏幕录制和现场旁白。所有演示步骤均对应现有真实页面、接口和数据库状态。"
    )
    set_run_font(closing_run, size=9.8)
    closing_run.font.color.rgb = MUTED
    preparation_heading = add_section_heading(doc, "录制准备与时间分配", 1)
    preparation_heading.paragraph_format.page_break_before = True
    add_body(
        doc,
        "建议使用 1920 x 1080 分辨率录制 Edge 浏览器，浏览器缩放保持 100%，隐藏书签栏并关闭系统通知。提前启动学生和教师两个窗口，确保页面中的“实时同步”标识可见。正式录制采用一次主流程加少量补录，避免在镜头前处理环境问题。",
    )
    add_table(
        doc,
        ["准备项", "录制建议"],
        [
            ["运行环境", "打开公网演示地址 http://weigxh.cn:5555；本地开发可执行 pnpm seed 和 pnpm dev。"],
            ["学生账号", "2024001 / Campus@2026，使用“一键填入”后登录。"],
            ["教师账号", "T1001 / Teacher@2026，置于第二个窗口，用于展示实时反馈。"],
            ["数据状态", "只使用种子演示数据，不展示真实学生信息、数据库文件或密钥。"],
            ["AI 模式", "未配置密钥时保留“知澜本地教学引擎”标识；配置远程模型时可显示实际模型名称。"],
            ["画面节奏", "每次点击后停留约 1 秒，旁白与页面反馈同步，不追求快速切屏。"],
        ],
        [3.7, 12.3],
    )
    add_section_heading(doc, "建议时间轴", 2)
    add_table(
        doc,
        ["时间", "内容", "录制目标"],
        [
            ["0:00 - 0:35", "开场与项目定位", "说明项目解决的问题与双角色价值"],
            ["0:35 - 1:15", "学生工作台与课程", "展示学习任务、进度和统一入口"],
            ["1:15 - 2:15", "作业发布、提交与批改", "展示跨角色业务闭环和实时更新"],
            ["2:15 - 3:05", "课堂签到与实时名单", "展示签到校验和教师端即时反馈"],
            ["3:05 - 4:15", "AI 助教与技术亮点", "展示上下文、双引擎回退与会话持久化"],
            ["4:15 - 5:10", "学情分析与通知", "展示数据反馈和角色差异化洞察"],
            ["5:10 - 5:55", "响应式界面与技术底座", "展示移动端、权限和真实数据架构"],
            ["5:55 - 6:35", "构建测试与公开仓库", "证明可运行、可验证、可复现"],
            ["6:35 - 6:45", "总结收束", "回到教育智能化的核心价值"],
        ],
        [3.3, 5.2, 7.5],
    )
    script_heading = add_section_heading(doc, "视频讲解脚本", 1)
    script_heading.paragraph_format.page_break_before = True
    add_segment(
        doc,
        "01",
        "0:00 - 0:35",
        "开场与项目定位",
        "画面停留在学生登录页，展示知澜智慧校园品牌、双角色切换和登录区域。讲解时鼠标不快速移动。",
        "大家好，我们是微光胡闹队。我们的作品是知澜智慧校园，一套面向高校课堂的 AI 智慧教育平台。它把 AI 助教、课程学习、作业反馈、课堂签到、学情分析和校园通知放进同一条真实业务流程，让学生少切换入口，让教师更快得到教学反馈。",
    )
    add_segment(
        doc,
        "02",
        "0:35 - 1:15",
        "学生工作台与课程",
        "使用学生账号登录，停留工作台，鼠标依次指向学习节奏、待交作业、签到状态和 AI 建议。随后点击“我的课程”，展示课程进度、作业、公告与考勤标签。",
        "学生进入工作台后，可以看到当前课程、待完成任务和近期学习趋势。课程详情把进度、作业、公告和本人考勤集中在一个页面，数据直接来自数据库，不需要在多个入口之间复制信息。",
        "这一段只展示真实账号数据，不要打开开发者工具或数据库文件。",
    )
    add_segment(
        doc,
        "03",
        "1:15 - 2:15",
        "作业发布、提交与实时批改",
        "切到教师窗口，进入“作业与批改”，点击“发布新作业”，填写标题和说明后点击“发布并通知学生”。再切回学生窗口，展示新作业自动出现和实时提示。学生点击“提交作业”，填写答案并“确认提交”。最后回到教师端进入批改，保存评分与反馈。",
        "现在教师发布一份新作业。学生窗口没有手动刷新，但任务会通过实时通道自动出现。学生提交后，教师端立即收到最新提交；教师完成评分和反馈后，学生端同步收到批改结果。这里展示的是跨角色协作，而不是静态页面演示。",
    )
    add_segment(
        doc,
        "04",
        "2:15 - 3:05",
        "课堂签到与实时名单",
        "教师进入“课堂考勤”，点击“发起课堂签到”，填写课堂主题和签到码后开启签到。学生端实时出现签到卡片，输入同一签到码并点击“确认签到”。教师打开“查看名单”，展示学生状态从“未签到”变为“已签到”。",
        "课堂签到由教师发起，签到码和场次有效期由服务端校验。只有已选课程的学生能够签到，重复签到会被拒绝。学生确认后，教师名单无需刷新就会更新，教师可以立即看到现场出勤情况。",
    )
    add_segment(
        doc,
        "05",
        "3:05 - 4:15",
        "AI 助教与技术亮点",
        "学生进入“AI 学习助理”，选择一个真实建议问题，例如“根据我的近期作业生成一份 7 天复习计划”。回答出现后，指向“知澜本地教学引擎”或实际远程模型标识。随后打开历史会话，展示刷新后仍可恢复。",
        "AI 助教不是独立聊天窗口。回答问题前，服务端会按当前账号和课程权限注入任务、课程和学情上下文。它支持 OpenAI-compatible 远程模型，也内置可离线运行的教学引擎。本次演示如果没有配置远程密钥，页面会明确显示本地教学引擎；远程异常时也会提示回退，不会伪装成远程模型。用户消息和助手回答都会持久化，刷新后仍能继续学习。",
    )
    ai_heading = add_section_heading(doc, "AI 技术亮点口播要点", 2)
    ai_table = add_table(
        doc,
        ["亮点", "可展示内容", "一句讲解"],
        [
            ["权限感知上下文", "AI 只使用当前用户可访问的课程、任务与汇总学情", "安全边界在服务端，不把完整数据库交给浏览器。"],
            ["远程与本地双引擎", "页面显示实际 provider、model 或回退提示", "网络和密钥异常时仍能完成教学演示。"],
            ["会话持久化", "历史消息写入 SQLite，重新登录后仍可查看", "AI 对话属于课程学习过程，而不是一次性页面状态。"],
            ["教学场景分化", "学生得到学习建议，教师得到批改与班级分析建议", "同一个助教根据角色提供不同任务导向。"],
            ["结果透明", "不伪造 AI 来源，不自动修改成绩或考勤", "高风险教学数据始终保留人工确认。"],
        ],
        [3.5, 7.2, 5.3],
    )
    keep_table_together(ai_table)

    add_segment(
        doc,
        "06",
        "4:15 - 5:10",
        "学情分析与通知",
        "学生进入“学情分析”，展示近 14 天学习趋势、课程掌握度、成绩和出勤。切到教师窗口，打开“班级学情”，展示班级平均、分数分布和需关注学生。随后进入“通知管理”，展示已发布通知及送达状态。",
        "学情分析使用同一条业务数据链。学生看到个人趋势和课程掌握情况，教师看到班级分布、作业表现和风险学生。通知发布后，对应账号会收到站内提醒，未读状态也会持久化。这样，作业、评分、考勤和通知形成一个可持续的教学反馈闭环。",
    )
    add_segment(
        doc,
        "07",
        "5:10 - 5:55",
        "响应式界面与技术底座",
        "使用 Edge 设备工具栏切换到 390 x 844 手机视口，打开教师或学生工作台，展示导航、统计和内容重新排版。随后返回桌面视口，快速展示 README 中的技术架构图或公开仓库首页。",
        "前端使用 React 18、TypeScript 和 Vite，后端使用 Node.js 原生 HTTP 与 SQLite。认证采用 scrypt 密码哈希和 HttpOnly Cookie，权限在服务端按角色、课程归属和选课关系校验。实时数据使用按用户定向的 SSE，不向无关账号广播。",
    )
    add_segment(
        doc,
        "08",
        "5:55 - 6:35",
        "构建测试与公开仓库",
        "可切换到终端，展示 pnpm build 与 pnpm test:all 的成功输出；也可打开 GitHub 仓库展示 README、28 张验收截图和 19 页技术文档。",
        "项目已通过生产构建、API 回归、浏览器 E2E、双角色认证和双浏览器实时测试。关键页面已完成桌面与手机截图验收，技术文档和完整 Git 历史也已经公开。所有材料都可以按 README 中的命令重新运行和核验。",
        "如果屏幕录制节奏偏慢，可只展示测试通过示例和技术文档目录，不逐行滚动终端。",
    )
    add_segment(
        doc,
        "09",
        "6:35 - 6:45",
        "总结收束",
        "回到学生工作台或 AI 助教页面，画面保持稳定，最后显示团队名称与公开仓库地址。",
        "知澜智慧校园让 AI 不只回答问题，而是进入真实教学流程，连接课程、任务、反馈和数据分析。我们希望用透明、可验证的智能能力，让每一次学习都有数据与 AI 同行。谢谢大家。",
    )
    extension_heading = add_section_heading(doc, "可选扩展段：延长至 8 分钟", 1)
    add_body(
        doc,
        "如果赛事要求接近 8 分钟，可把以下内容放在“技术底座”之后。主脚本不依赖这一段，剪辑时可按需要取舍。",
    )
    add_segment(
        doc,
        "E1",
        "约 50 秒",
        "安全与真实数据设计",
        "打开 README 的“安全说明”或技术文档架构页，不必展示代码细节。",
        "平台对密码使用 scrypt 随机盐哈希，会话令牌只保存摘要；写请求校验来源，数据库查询使用参数绑定。教师操作会检查课程归属，学生提交和签到会检查选课关系。前端按钮显隐只用于体验，真正的权限边界在服务端。",
    )
    add_segment(
        doc,
        "E2",
        "约 35 秒",
        "测试证据与可复现性",
        "展示 tests 目录、截图画廊和技术文档附录即可。",
        "API 测试覆盖认证、权限、作业、评分、签到、通知、AI 会话和导出；浏览器测试覆盖学生、教师、认证和实时协作。最终 ZIP 还在独立目录中完成过离线安装、构建和回归，保证交付包不是只能在本机运行的演示稿。",
    )

    checklist_heading = add_section_heading(doc, "录制检查清单", 1)
    checklist_heading.paragraph_format.page_break_before = True
    checklist_table = add_table(
        doc,
        ["阶段", "检查项", "完成"],
        [
            ["录制前", "pnpm seed、pnpm dev 已运行，学生和教师均可登录", "□"],
            ["录制前", "两个窗口均显示“实时同步”，通知已静音", "□"],
            ["录制前", "浏览器缩放 100%，书签栏隐藏，画面无真实隐私信息", "□"],
            ["录制中", "每个动作后停留，等待提示出现再继续旁白", "□"],
            ["录制中", "AI 页面明确显示本地教学引擎或实际远程模型", "□"],
            ["录制中", "实时作业和签到状态在另一窗口可见", "□"],
            ["录制后", "总时长在 5 至 8 分钟，开头和结尾声音完整", "□"],
            ["录制后", "课堂主题、学生姓名和课程内容没有不适合公开的信息", "□"],
            ["录制后", "导出 1080p 视频，检查字幕、鼠标和浏览器通知", "□"],
        ],
        [2.5, 11.5, 2.0],
    )
    keep_table_together(checklist_table)
    add_body(
        doc,
        "建议最终视频控制在 6 分 30 秒至 7 分 30 秒。若现场点击等待较多，可删去通知管理或 GitHub 页面展示；若时间不足 5 分钟，优先保留作业实时反馈和课堂签到两段，因为它们最能体现系统的真实协作能力。",
    )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    doc.save(OUTPUT_PATH)

    spoken_text = "".join(SPOKEN_BLOCKS)
    chinese_chars = len(re.findall(r"[\u4e00-\u9fff]", spoken_text))
    punctuation_chars = len(re.findall(r"[，。！？；：]", spoken_text))
    print(f"DOCX={OUTPUT_PATH}")
    print(f"SPOKEN_CHINESE_CHARS={chinese_chars}")
    print(f"SPOKEN_PUNCTUATION={punctuation_chars}")
    print(f"ESTIMATED_MINUTES_AT_220_CHARS_PER_MIN={((chinese_chars + punctuation_chars) / 220):.2f}")
    return OUTPUT_PATH


if __name__ == "__main__":
    build_document()
