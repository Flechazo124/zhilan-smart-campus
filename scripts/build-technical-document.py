from __future__ import annotations

import hashlib
import re
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    Image,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "pdf"
OUTPUT_PATH = OUTPUT_DIR / "zhilan-smart-campus-technical-document.pdf"
SCREENSHOT_DIR = ROOT / "artifacts" / "screenshots"

NAVY = colors.HexColor("#112A34")
TEAL = colors.HexColor("#087F72")
TEAL_LIGHT = colors.HexColor("#E9F6F3")
ORANGE = colors.HexColor("#D96B35")
ORANGE_LIGHT = colors.HexColor("#FFF2E9")
INK = colors.HexColor("#1B292E")
MUTED = colors.HexColor("#5C6E73")
LINE = colors.HexColor("#D8E2E0")
PAPER = colors.HexColor("#F7FAF9")
WHITE = colors.white

FONT_NAME = "MicrosoftYaHei"
FONT_BOLD = "MicrosoftYaHei-Bold"


def register_fonts() -> None:
    regular_candidates = [
        Path(r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\simhei.ttf"),
        Path(r"C:\Windows\Fonts\simsun.ttc"),
    ]
    bold_candidates = [
        Path(r"C:\Windows\Fonts\msyhbd.ttc"),
        Path(r"C:\Windows\Fonts\simhei.ttf"),
        Path(r"C:\Windows\Fonts\simsun.ttc"),
    ]
    regular = next((path for path in regular_candidates if path.exists()), None)
    bold = next((path for path in bold_candidates if path.exists()), None)
    if not regular or not bold:
        raise RuntimeError("No Chinese font found. Install Microsoft YaHei or SimHei.")

    pdfmetrics.registerFont(TTFont(FONT_NAME, str(regular), subfontIndex=0))
    pdfmetrics.registerFont(TTFont(FONT_BOLD, str(bold), subfontIndex=0))
    pdfmetrics.registerFontFamily(
        FONT_NAME,
        normal=FONT_NAME,
        bold=FONT_BOLD,
        italic=FONT_NAME,
        boldItalic=FONT_BOLD,
    )


def clean(value: str) -> str:
    value = value.replace("\u2014", "-").replace("\u2013", "-").replace("\u2011", "-")
    return value.replace("\u00a0", " ")


def p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(clean(text), style)


def make_styles() -> dict[str, ParagraphStyle]:
    sample = getSampleStyleSheet()
    styles = {
        "cover_kicker": ParagraphStyle(
            "CoverKicker",
            parent=sample["Normal"],
            fontName=FONT_BOLD,
            fontSize=10,
            leading=14,
            textColor=TEAL,
            alignment=TA_LEFT,
            spaceAfter=10,
        ),
        "cover_title": ParagraphStyle(
            "CoverTitle",
            parent=sample["Title"],
            fontName=FONT_BOLD,
            fontSize=30,
            leading=40,
            textColor=NAVY,
            alignment=TA_LEFT,
            spaceAfter=12,
        ),
        "cover_subtitle": ParagraphStyle(
            "CoverSubtitle",
            parent=sample["Normal"],
            fontName=FONT_NAME,
            fontSize=14,
            leading=24,
            textColor=MUTED,
            alignment=TA_LEFT,
            spaceAfter=22,
        ),
        "cover_meta": ParagraphStyle(
            "CoverMeta",
            parent=sample["Normal"],
            fontName=FONT_NAME,
            fontSize=10,
            leading=17,
            textColor=INK,
            alignment=TA_LEFT,
        ),
        "body": ParagraphStyle(
            "BodyCN",
            parent=sample["BodyText"],
            fontName=FONT_NAME,
            fontSize=9.5,
            leading=16.5,
            textColor=INK,
            alignment=TA_LEFT,
            spaceAfter=7,
            wordWrap="CJK",
        ),
        "small": ParagraphStyle(
            "SmallCN",
            parent=sample["BodyText"],
            fontName=FONT_NAME,
            fontSize=8,
            leading=12,
            textColor=MUTED,
            wordWrap="CJK",
        ),
        "h1": ParagraphStyle(
            "H1",
            parent=sample["Heading1"],
            fontName=FONT_BOLD,
            fontSize=19,
            leading=27,
            textColor=NAVY,
            spaceBefore=4,
            spaceAfter=12,
            wordWrap="CJK",
        ),
        "h2": ParagraphStyle(
            "H2",
            parent=sample["Heading2"],
            fontName=FONT_BOLD,
            fontSize=13,
            leading=20,
            textColor=TEAL,
            spaceBefore=9,
            spaceAfter=7,
            wordWrap="CJK",
        ),
        "h3": ParagraphStyle(
            "H3",
            parent=sample["Heading3"],
            fontName=FONT_BOLD,
            fontSize=10.5,
            leading=17,
            textColor=NAVY,
            spaceBefore=5,
            spaceAfter=4,
            wordWrap="CJK",
        ),
        "bullet": ParagraphStyle(
            "BulletCN",
            parent=sample["BodyText"],
            fontName=FONT_NAME,
            fontSize=9.5,
            leading=15.5,
            textColor=INK,
            leftIndent=12,
            firstLineIndent=-8,
            spaceAfter=4,
            wordWrap="CJK",
        ),
        "table": ParagraphStyle(
            "TableCN",
            parent=sample["BodyText"],
            fontName=FONT_NAME,
            fontSize=8.2,
            leading=12,
            textColor=INK,
            wordWrap="CJK",
        ),
        "table_head": ParagraphStyle(
            "TableHeadCN",
            parent=sample["BodyText"],
            fontName=FONT_BOLD,
            fontSize=8.4,
            leading=12,
            textColor=WHITE,
            alignment=TA_LEFT,
            wordWrap="CJK",
        ),
        "caption": ParagraphStyle(
            "CaptionCN",
            parent=sample["BodyText"],
            fontName=FONT_NAME,
            fontSize=7.6,
            leading=11,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceBefore=4,
            spaceAfter=8,
            wordWrap="CJK",
        ),
        "code": ParagraphStyle(
            "CodeCN",
            parent=sample["Code"],
            fontName="Courier",
            fontSize=7.7,
            leading=11.5,
            textColor=NAVY,
            leftIndent=8,
            rightIndent=8,
            spaceBefore=5,
            spaceAfter=8,
        ),
        "toc1": ParagraphStyle(
            "TOC1",
            parent=sample["Normal"],
            fontName=FONT_BOLD,
            fontSize=10.5,
            leading=19,
            textColor=NAVY,
            leftIndent=0,
        ),
        "toc2": ParagraphStyle(
            "TOC2",
            parent=sample["Normal"],
            fontName=FONT_NAME,
            fontSize=9,
            leading=16,
            textColor=MUTED,
            leftIndent=16,
        ),
    }
    return styles


class SubmissionDocument(BaseDocTemplate):
    def __init__(self, filename: str, styles: dict[str, ParagraphStyle]):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=20 * mm,
            rightMargin=20 * mm,
            topMargin=22 * mm,
            bottomMargin=19 * mm,
            title="知澜智慧校园技术文档",
            author="微光胡闹队",
            subject="传智杯 Web 网页开发赛技术文档",
        )
        self.styles_by_name = styles
        self.toc = TableOfContents()
        self.toc.levelStyles = [styles["toc1"], styles["toc2"]]
        self.toc.dotsMinLevel = 0
        self.toc.tableStyle = TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )

        cover_frame = Frame(
            22 * mm,
            20 * mm,
            A4[0] - 44 * mm,
            A4[1] - 40 * mm,
            id="cover-frame",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        body_frame = Frame(
            20 * mm,
            19 * mm,
            A4[0] - 40 * mm,
            A4[1] - 41 * mm,
            id="body-frame",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates(
            [
                PageTemplate(id="cover", frames=[cover_frame], onPage=self.draw_cover),
                PageTemplate(id="body", frames=[body_frame], onPage=self.draw_body),
            ]
        )

    def afterFlowable(self, flowable: Flowable) -> None:
        if not isinstance(flowable, Paragraph):
            return
        style_name = flowable.style.name
        if style_name not in {"H1", "H2"}:
            return
        level = 0 if style_name == "H1" else 1
        text = flowable.getPlainText()
        key = f"heading-{self.seq.nextf('heading')}"
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(text, key, level=level, closed=False)
        self.notify("TOCEntry", (level, text, self.page, key))

    def draw_cover(self, canvas, doc) -> None:
        width, height = A4
        canvas.saveState()
        canvas.setFillColor(NAVY)
        canvas.rect(0, height - 34 * mm, width, 34 * mm, fill=1, stroke=0)
        canvas.setFillColor(TEAL)
        canvas.rect(0, height - 36 * mm, width, 2 * mm, fill=1, stroke=0)
        canvas.setFillColor(TEAL_LIGHT)
        canvas.circle(width - 30 * mm, 45 * mm, 38 * mm, fill=1, stroke=0)
        canvas.setFillColor(ORANGE_LIGHT)
        canvas.circle(width - 50 * mm, 76 * mm, 22 * mm, fill=1, stroke=0)
        canvas.setFillColor(TEAL)
        canvas.roundRect(22 * mm, 22 * mm, 29 * mm, 8 * mm, 2 * mm, fill=1, stroke=0)
        canvas.setFillColor(WHITE)
        canvas.setFont(FONT_BOLD, 9)
        canvas.drawCentredString(36.5 * mm, 24.7 * mm, "ZHILAN CAMPUS")
        canvas.setFillColor(WHITE)
        canvas.setFont(FONT_BOLD, 11)
        canvas.drawString(22 * mm, height - 21 * mm, "传智杯 Web 网页开发赛")
        canvas.setFont(FONT_NAME, 8.5)
        canvas.drawRightString(width - 22 * mm, height - 21 * mm, "作品技术文档")
        canvas.restoreState()

    def draw_body(self, canvas, doc) -> None:
        width, height = A4
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.6)
        canvas.line(20 * mm, height - 14 * mm, width - 20 * mm, height - 14 * mm)
        canvas.setFont(FONT_BOLD, 8)
        canvas.setFillColor(NAVY)
        canvas.drawString(20 * mm, height - 10.5 * mm, "知澜智慧校园")
        canvas.setFont(FONT_NAME, 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(width - 20 * mm, height - 10.5 * mm, "技术文档 | 2026.10")
        canvas.line(20 * mm, 14 * mm, width - 20 * mm, 14 * mm)
        canvas.setFont(FONT_NAME, 7.5)
        canvas.drawString(20 * mm, 9.5 * mm, "AI 驱动的学生与教师一体化学习平台")
        canvas.drawRightString(width - 20 * mm, 9.5 * mm, f"{doc.page:02d}")
        canvas.restoreState()


class ArchitectureDiagram(Flowable):
    def __init__(self, width=165 * mm, height=78 * mm):
        super().__init__()
        self.width = width
        self.height = height

    def wrap(self, availWidth, availHeight):
        self.width = min(self.width, availWidth)
        return self.width, self.height

    def box(self, canvas, x, y, w, h, title, subtitle, fill, border):
        canvas.setFillColor(fill)
        canvas.setStrokeColor(border)
        canvas.setLineWidth(0.7)
        canvas.roundRect(x, y, w, h, 2.2 * mm, fill=1, stroke=1)
        canvas.setFillColor(NAVY)
        canvas.setFont(FONT_BOLD, 8.3)
        canvas.drawCentredString(x + w / 2, y + h - 6.1 * mm, title)
        canvas.setFillColor(MUTED)
        canvas.setFont(FONT_NAME, 6.7)
        canvas.drawCentredString(x + w / 2, y + 3.3 * mm, subtitle)

    def arrow(self, canvas, x1, y1, x2, y2):
        canvas.setStrokeColor(TEAL)
        canvas.setFillColor(TEAL)
        canvas.setLineWidth(1)
        canvas.line(x1, y1, x2, y2)
        canvas.circle(x2, y2, 1.3, fill=1, stroke=0)

    def draw(self):
        canvas = self.canv
        w = self.width
        h = self.height
        top_y = h - 18 * mm
        mid_y = h - 43 * mm
        bottom_y = 3 * mm
        box_w = (w - 12 * mm) / 3

        self.box(canvas, 0, top_y, box_w, 15 * mm, "学生端", "课程 | 作业 | 签到 | AI", PAPER, LINE)
        self.box(canvas, box_w + 6 * mm, top_y, box_w, 15 * mm, "教师端", "发布 | 批改 | 学情 | 通知", PAPER, LINE)
        self.box(canvas, 2 * (box_w + 6 * mm), top_y, box_w, 15 * mm, "实时通道", "SSE | 自动重连 | 心跳", TEAL_LIGHT, TEAL)

        api_y = mid_y
        canvas.setFillColor(NAVY)
        canvas.roundRect(0, api_y, w, 17 * mm, 2.5 * mm, fill=1, stroke=0)
        canvas.setFillColor(WHITE)
        canvas.setFont(FONT_BOLD, 9)
        canvas.drawCentredString(w / 2, api_y + 10.5 * mm, "Node.js 应用服务")
        canvas.setFont(FONT_NAME, 7)
        canvas.drawCentredString(w / 2, api_y + 4.2 * mm, "认证与权限 | REST API | AI 适配 | 静态资源")

        self.arrow(canvas, box_w / 2, top_y, box_w / 2, api_y + 17 * mm)
        self.arrow(canvas, box_w * 1.5 + 6 * mm, top_y, box_w * 1.5 + 6 * mm, api_y + 17 * mm)
        self.arrow(canvas, box_w * 2.5 + 12 * mm, top_y, box_w * 2.5 + 12 * mm, api_y + 17 * mm)

        service_w = (w - 6 * mm) / 2
        self.box(
            canvas,
            0,
            bottom_y,
            service_w,
            17 * mm,
            "SQLite 持久化",
            "13 张业务表 | WAL | 参数绑定",
            ORANGE_LIGHT,
            ORANGE,
        )
        self.box(
            canvas,
            service_w + 6 * mm,
            bottom_y,
            service_w,
            17 * mm,
            "AI 服务层",
            "远程模型 | 本地教学引擎",
            TEAL_LIGHT,
            TEAL,
        )
        self.arrow(canvas, service_w / 2, api_y, service_w / 2, bottom_y + 17 * mm)
        self.arrow(canvas, service_w * 1.5 + 6 * mm, api_y, service_w * 1.5 + 6 * mm, bottom_y + 17 * mm)


class AIPipelineDiagram(Flowable):
    def __init__(self, width=165 * mm, height=36 * mm):
        super().__init__()
        self.width = width
        self.height = height

    def wrap(self, availWidth, availHeight):
        self.width = min(self.width, availWidth)
        return self.width, self.height

    def draw(self):
        canvas = self.canv
        labels = [
            ("用户问题", "最多 6000 字符"),
            ("权限上下文", "课程 / 作业 / 学情"),
            ("模型路由", "远程或本地"),
            ("回答入库", "会话可追溯"),
        ]
        gap = 4 * mm
        box_w = (self.width - gap * 3) / 4
        y = 4 * mm
        box_h = 24 * mm
        for index, (title, subtitle) in enumerate(labels):
            x = index * (box_w + gap)
            fill = TEAL_LIGHT if index < 2 else ORANGE_LIGHT
            border = TEAL if index < 2 else ORANGE
            canvas.setFillColor(fill)
            canvas.setStrokeColor(border)
            canvas.roundRect(x, y, box_w, box_h, 2 * mm, fill=1, stroke=1)
            canvas.setFillColor(NAVY)
            canvas.setFont(FONT_BOLD, 8)
            canvas.drawCentredString(x + box_w / 2, y + 15 * mm, title)
            canvas.setFillColor(MUTED)
            canvas.setFont(FONT_NAME, 6.6)
            canvas.drawCentredString(x + box_w / 2, y + 8 * mm, subtitle)
            if index < 3:
                x1 = x + box_w + 0.8 * mm
                x2 = x + box_w + gap - 0.8 * mm
                canvas.setStrokeColor(TEAL)
                canvas.line(x1, y + box_h / 2, x2, y + box_h / 2)
                canvas.circle(x2, y + box_h / 2, 1.1, fill=1, stroke=0)


def heading(text: str, style: ParagraphStyle) -> Paragraph:
    return p(text, style)


def bullet(text: str, styles: dict[str, ParagraphStyle]) -> Paragraph:
    return p(f"- {text}", styles["bullet"])


def note_box(title: str, body: str, styles: dict[str, ParagraphStyle], tone="teal") -> Table:
    fill = TEAL_LIGHT if tone == "teal" else ORANGE_LIGHT
    border = TEAL if tone == "teal" else ORANGE
    content = [
        [p(title, ParagraphStyle(
            "NoteTitle",
            parent=styles["table_head"],
            textColor=border,
            fontName=FONT_BOLD,
            fontSize=8.5,
            leading=12,
        ))],
        [p(body, styles["small"])],
    ]
    table = Table(content, colWidths=[165 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), fill),
                ("BOX", (0, 0), (-1, -1), 0.7, border),
                ("LINEBEFORE", (0, 0), (0, -1), 2.5, border),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def data_table(
    rows: list[list[str]],
    widths: list[float],
    styles: dict[str, ParagraphStyle],
    repeat_rows: int = 1,
) -> Table:
    converted: list[list[Paragraph]] = []
    for row_index, row in enumerate(rows):
        style = styles["table_head"] if row_index < repeat_rows else styles["table"]
        converted.append([p(str(value), style) for value in row])
    table = Table(converted, colWidths=widths, repeatRows=repeat_rows, hAlign="LEFT")
    commands = [
        ("BACKGROUND", (0, 0), (-1, repeat_rows - 1), TEAL),
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    for row_index in range(repeat_rows, len(rows)):
        if row_index % 2 == 0:
            commands.append(("BACKGROUND", (0, row_index), (-1, row_index), PAPER))
    table.setStyle(TableStyle(commands))
    return table


def code_block(code: str, styles: dict[str, ParagraphStyle]) -> Table:
    formatted = (
        escape(code)
        .replace("\n", "<br/>")
        .replace(" ", "&nbsp;")
    )
    table = Table([[Paragraph(formatted, styles["code"])]], colWidths=[165 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F1F5F4")),
                ("BOX", (0, 0), (-1, -1), 0.45, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return table


def screenshot(path: Path, width: float = 78 * mm) -> tuple[Image, float]:
    with PILImage.open(path) as image:
        image_width, image_height = image.size
    height = width * image_height / image_width
    return Image(str(path), width=width, height=height), height


def screenshot_pair(
    left: tuple[str, str],
    right: tuple[str, str],
    styles: dict[str, ParagraphStyle],
) -> Table:
    image_width = 77 * mm
    left_image, left_height = screenshot(SCREENSHOT_DIR / left[0], image_width)
    right_image, right_height = screenshot(SCREENSHOT_DIR / right[0], image_width)
    row_height = max(left_height, right_height) + 13 * mm
    header = Table(
        [
            [
                p(f"图：{left[1]}", styles["caption"]),
                p(f"图：{right[1]}", styles["caption"]),
            ]
        ],
        colWidths=[82.5 * mm, 82.5 * mm],
    )
    header.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER")]))
    content = Table(
        [[left_image, right_image]],
        colWidths=[82.5 * mm, 82.5 * mm],
        rowHeights=[row_height],
    )
    content.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 1),
                ("RIGHTPADDING", (0, 0), (-1, -1), 1),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    combined = Table([[header], [content]], colWidths=[165 * mm])
    combined.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return combined


def screenshot_single(
    filename: str,
    caption: str,
    styles: dict[str, ParagraphStyle],
    width: float = 126 * mm,
) -> KeepTogether:
    image, _ = screenshot(SCREENSHOT_DIR / filename, width)
    return KeepTogether([image, p(f"图：{caption}", styles["caption"])])


def build_story(styles: dict[str, ParagraphStyle]) -> list[Flowable]:
    story: list[Flowable] = []

    story.extend(
        [
            Spacer(1, 20 * mm),
            p("传智杯 Web 网页开发赛 | 技术文档", styles["cover_kicker"]),
            p("知澜智慧校园", styles["cover_title"]),
            p("AI 驱动的学生与教师一体化学习平台", styles["cover_subtitle"]),
            Spacer(1, 18 * mm),
            Table(
                [
                    [p("项目关键词", styles["cover_meta"]), p("智慧教育 / AI 助教 / 实时协作 / 学情分析", styles["cover_meta"])],
                    [p("参赛项目", styles["cover_meta"]), p("传智杯 Web 网页开发赛", styles["cover_meta"])],
                    [p("参赛团队", styles["cover_meta"]), p("微光胡闹队", styles["cover_meta"])],
                    [p("参赛学校", styles["cover_meta"]), p("北华航天工业学院", styles["cover_meta"])],
                    [p("团队成员", styles["cover_meta"]), p("袁正、胡开元、屈轶宸", styles["cover_meta"])],
                    [p("指导教师", styles["cover_meta"]), p("牛静", styles["cover_meta"])],
                    [p("文档版本", styles["cover_meta"]), p("V1.0 最终提交版", styles["cover_meta"])],
                    [p("完成日期", styles["cover_meta"]), p("2026 年 10 月", styles["cover_meta"])],
                    [p("运行形态", styles["cover_meta"]), p("React + Node.js + SQLite，单实例可部署", styles["cover_meta"])],
                ],
                colWidths=[35 * mm, 105 * mm],
                style=TableStyle(
                    [
                        ("LINEBELOW", (0, 0), (-1, -1), 0.45, LINE),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                        ("TOPPADDING", (0, 0), (-1, -1), 7),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                    ]
                ),
            ),
            Spacer(1, 35 * mm),
            note_box(
                "文档说明",
                "本文档描述当前可运行版本的真实功能、技术实现与验收结果。所有业务页面均连接 Node.js API 和 SQLite 数据，不使用静态假数据；AI 未配置远程密钥时明确显示本地教学引擎，不伪造模型状态。",
                styles,
            ),
            NextPageTemplate("body"),
            PageBreak(),
        ]
    )

    story.extend(
        [
            heading("目录", styles["h1"]),
            p("目录页码由文档生成器自动计算。正文包含比赛要求中的全部技术章节，并在附录保留可核验的界面截图与配置表。", styles["body"]),
            Spacer(1, 5 * mm),
        ]
    )

    # Replaced with the document-owned TOC before multiBuild.
    story.append("__TOC__")
    story.extend([PageBreak()])

    story.extend(
        [
            heading("1. 项目概述", styles["h1"]),
            heading("1.1 项目背景", styles["h2"]),
            p(
                "高校在线学习通常由课程平台、作业提交、课堂签到、通知系统和通用 AI 工具拼装而成。入口分散导致学生难以形成连续学习节奏，教师也难以在同一处观察作业、出勤和班级风险。知澜智慧校园将 AI 助教放入真实教学业务闭环，围绕学生和教师两类角色统一课程、任务、反馈、签到与学情数据。",
                styles["body"],
            ),
            p(
                "平台不是营销展示页，而是包含注册登录、课程关系、服务端权限、持久化数据库、实时事件和自动化测试的可运行 Web 应用。教师发布的作业和签到会通过 SSE 实时到达对应学生或教师会话，减少手动刷新和跨页面等待。",
                styles["body"],
            ),
            heading("1.2 项目目标", styles["h2"]),
            bullet("构建学生与教师双角色的统一学习工作台，覆盖课程、作业、考勤、通知和学情。", styles),
            bullet("让 AI 回答结合用户有权访问的课程和任务上下文，并保持会话可追溯。", styles),
            bullet("用服务端权限、持久化会话和参数化查询保证真实业务安全，不只依赖前端隐藏按钮。", styles),
            bullet("通过 API、浏览器和双浏览器实时回归证明关键流程可重复运行。", styles),
            heading("1.3 用户与使用场景", styles["h2"]),
            data_table(
                [
                    ["角色", "核心任务", "关键结果"],
                    ["学生", "查看课程与任务，提交作业，签到，向 AI 提问，查看学情", "学习反馈集中呈现，任务状态实时同步"],
                    ["教师", "课程管理，发布作业，评分，发起签到，查看班级学情，发布通知", "教学动作形成闭环，风险学生及时可见"],
                    ["评审", "注册或使用演示账号，按完整流程核验真实交互", "可重复操作并观察数据库持久化与实时反馈"],
                ],
                [27 * mm, 78 * mm, 60 * mm],
                styles,
            ),
            Spacer(1, 4 * mm),
            note_box(
                "当前范围",
                "已实现文本作业、数字签到、学情分析、通知、个人计划与 AI 会话。暂未实现附件上传、视频课程、统一身份认证和真实知识图谱，这些内容在展望章节中给出明确演进路径，不在当前版本中虚报。",
                styles,
                tone="orange",
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            heading("2. 需求分析", styles["h1"]),
            heading("2.1 用户痛点", styles["h2"]),
            data_table(
                [
                    ["痛点", "现状", "平台响应"],
                    ["信息分散", "课程、作业、签到和通知分布在多个入口", "统一工作台与共享课程上下文"],
                    ["反馈滞后", "作业发布、提交和评分后缺少即时提醒", "SSE 实时推送与站内通知"],
                    ["AI 脱离业务", "通用问答不了解课程和任务", "受权限约束的课程、作业和学情上下文"],
                    ["班级洞察困难", "教师依赖人工汇总出勤与成绩", "班级分数结构、风险学生和 CSV 导出"],
                    ["权限边界模糊", "前端隐藏入口不能提供安全保证", "服务端角色检查与课程归属校验"],
                ],
                [31 * mm, 70 * mm, 64 * mm],
                styles,
            ),
            heading("2.2 功能需求", styles["h2"]),
            data_table(
                [
                    ["模块", "学生能力", "教师能力", "验收标准"],
                    ["认证", "学生注册、登录、资料与密码", "邀请码注册、登录、资料与密码", "重复账号、错误邀请码和限流有明确反馈"],
                    ["课程", "查看进度、公告、作业和本人考勤", "创建课程、按学号添加学生", "只能访问已选或本人创建课程"],
                    ["作业", "提交和修改文本作业，查看评分反馈", "发布任务、查看提交、评分并通知", "评分后禁止修改，状态实时更新"],
                    ["签到", "输入限时签到码，查看历史", "创建场次，查看实时名单", "错误码、过期与重复签到由服务端拒绝"],
                    ["AI", "课程答疑、复习建议", "教学诊断与反馈草稿", "显示真实提供方，历史会话可恢复"],
                    ["学情", "学习趋势、掌握度和出勤", "班级分布、风险学生和作业表现", "指标来自同一数据库"],
                    ["通知", "筛选、搜索、标记已读", "发布全校或课程通知", "目标用户和已读状态持久化"],
                ],
                [24 * mm, 46 * mm, 46 * mm, 49 * mm],
                styles,
            ),
            heading("2.3 非功能需求", styles["h2"]),
            data_table(
                [
                    ["维度", "要求", "实现措施"],
                    ["安全性", "密码不可逆、会话可失效、接口有权限边界", "scrypt、HttpOnly Cookie、摘要会话、Origin 校验、参数绑定"],
                    ["可用性", "桌面与手机可完成核心流程", "响应式布局、无障碍标签、错误与空状态"],
                    ["实时性", "教师动作在学生端自动出现", "SSE 按用户投递、2 秒重连、20 秒心跳"],
                    ["可维护性", "结构清晰、类型明确、边界可追踪", "React/TypeScript、模块化服务端、数据契约与测试"],
                    ["可部署性", "无需外部数据库即可演示", "Node.js 单进程与 SQLite 持久化文件"],
                    ["可验证性", "关键流程可自动化回归", "Node Test Runner 与 Playwright 真实浏览器测试"],
                ],
                [28 * mm, 63 * mm, 74 * mm],
                styles,
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            heading("3. 系统架构设计", styles["h1"]),
            heading("3.1 总体架构", styles["h2"]),
            p(
                "系统采用前后端同仓库、开发双端口、生产单进程的结构。React 页面通过类型化 REST 客户端访问 Node.js 服务，认证令牌保存在 HttpOnly Cookie 中。生产服务同时托管 dist 静态资源和 API，SQLite 通过持久化磁盘保存业务数据。",
                styles["body"],
            ),
            ArchitectureDiagram(),
            p("图：知澜智慧校园总体架构", styles["caption"]),
            heading("3.2 分层职责", styles["h2"]),
            data_table(
                [
                    ["层级", "主要文件", "职责"],
                    ["交互层", "src/pages、src/components", "页面流程、表单、筛选、弹窗、反馈与响应式布局"],
                    ["数据接入层", "src/api.ts、src/useRealtime.ts", "类型化 HTTP 请求、错误转换、SSE 自动连接与事件分发"],
                    ["应用服务层", "server/index.mjs", "认证、路由、角色与课程权限、业务事务、静态资源"],
                    ["领域与数据层", "server/db.mjs、server/realtime.mjs", "SQLite 表结构、WAL、索引、会话和用户定向事件"],
                    ["AI 服务层", "server/ai.mjs", "远程模型适配、上下文构建、超时回退与本地教学引擎"],
                ],
                [30 * mm, 54 * mm, 81 * mm],
                styles,
            ),
            heading("3.3 运行环境与部署形态", styles["h2"]),
            p(
                "开发模式由 scripts/dev.mjs 同时启动 Vite 5174 和 API 5175；生产模式执行 pnpm build 后由 Node.js 在 5175 提供统一入口。该结构适合比赛演示和中小规模课程试点。若扩展为多实例，需要将 SQLite 替换为 PostgreSQL，并用 Redis 或消息队列传递实时事件。",
                styles["body"],
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            heading("4. 数据模型与权限设计", styles["h1"]),
            heading("4.1 核心实体", styles["h2"]),
            data_table(
                [
                    ["实体组", "数据表", "关系与用途"],
                    ["用户与会话", "users、sessions", "账号、角色、scrypt 密码哈希、会话摘要与过期时间"],
                    ["课程", "courses、enrollments", "教师建课、学生选课、进度、成绩与课程归属"],
                    ["作业", "assignments、submissions", "任务要求、截止时间、学生提交、评分与反馈"],
                    ["考勤", "attendance_sessions、attendance_records", "限时签到码、场次状态与唯一出勤记录"],
                    ["通知", "announcements、notifications", "全校或课程公告、按用户站内提醒、已读状态"],
                    ["学习与 AI", "tasks、study_records、ai_conversations、ai_messages", "个人计划、学习趋势、会话与消息历史"],
                ],
                [30 * mm, 63 * mm, 72 * mm],
                styles,
            ),
            heading("4.2 数据一致性", styles["h2"]),
            bullet("启用 PRAGMA foreign_keys = ON，关联记录由外键约束。", styles),
            bullet("启用 WAL 和 5000 毫秒 busy timeout，提高单实例读写稳定性。", styles),
            bullet("为会话、作业、提交、考勤、通知、学习记录和 AI 会话建立索引。", styles),
            bullet("写操作使用参数绑定，避免拼接 SQL 引发的注入风险。", styles),
            heading("4.3 权限模型", styles["h2"]),
            data_table(
                [
                    ["检查层级", "规则", "失败结果"],
                    ["身份", "除健康检查和认证接口外，业务 API 必须存在有效会话", "401"],
                    ["角色", "学生不能调用教师发布、批改、创建签到或发布通知接口", "403"],
                    ["课程归属", "教师只能操作本人创建课程下的数据", "403 或 404"],
                    ["选课关系", "学生只能查看和提交已选课程内容，只能对该课程签到", "403"],
                    ["业务状态", "已评分作业禁止修改，重复签到与过期签到被拒绝", "409 或业务错误"],
                ],
                [31 * mm, 96 * mm, 38 * mm],
                styles,
            ),
            Spacer(1, 3 * mm),
            note_box(
                "安全边界",
                "前端按钮显隐只用于体验，服务端才是权限边界。每个教师写接口都从课程归属重新校验，每个学生写操作都从所选课程和提交状态重新校验。",
                styles,
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            heading("5. AI 技术方案", styles["h1"]),
            heading("5.1 技术选型与理由", styles["h2"]),
            data_table(
                [
                    ["方案", "选择", "理由", "风险控制"],
                    ["模型接口", "OpenAI-compatible Chat Completions", "兼容多家国内外服务，降低供应商锁定", "通过 Base URL、Model、Key 环境变量切换"],
                    ["上下文", "服务端业务上下文注入", "只使用当前用户有权访问的数据，比浏览器直连更安全", "课程、作业、学情由服务端再次筛选"],
                    ["回退", "本地教学规则引擎", "无密钥或网络故障时仍可完整演示", "界面和返回数据明确 provider 与 fallback"],
                    ["持久化", "SQLite 会话与消息", "无需额外数据库即可保留历史", "会话按用户隔离，支持删除"],
                    ["调用策略", "低温度、限长、超时", "教学建议稳定，控制延迟与成本", "temperature 0.35、max_tokens 900、30 秒超时"],
                ],
                [26 * mm, 47 * mm, 50 * mm, 42 * mm],
                styles,
            ),
            heading("5.2 集成方式", styles["h2"]),
            AIPipelineDiagram(),
            p("图：AI 请求与回退链路", styles["caption"]),
            p(
                "服务端读取 AI_API_KEY、AI_BASE_URL 和 AI_MODEL。配置密钥时以 Bearer Token 调用远程模型；未配置密钥时进入可解释的本地教学引擎；远程异常时记录错误、返回本地回答，并通过 warning 字段通知前端。系统不会把本地引擎输出伪装成远程大模型结果。",
                styles["body"],
            ),
            heading("5.3 上下文与提示词策略", styles["h2"]),
            bullet("只拼接当前用户可访问的课程名称、简介、近期任务和汇总学情。", styles),
            bullet("历史消息只取最近 10 条，单条最多 6000 字符；用户当前问题最多 6000 字符。", styles),
            bullet("系统提示要求简洁中文、启发式引导、不得伪造学生数据和不确定信息。", styles),
            bullet("教师问题优先给出概念准确性、推理完整性和表达清晰度三维批改建议。", styles),
            heading("5.4 优化策略", styles["h2"]),
            data_table(
                [
                    ["优化点", "实现", "收益"],
                    ["上下文裁剪", "最多 6 条近期任务、最近 10 条消息", "减少 token 浪费和无关信息"],
                    ["受限输入", "问题与消息字符上限", "避免超长请求拖慢服务"],
                    ["超时回退", "AbortSignal.timeout(30000)", "远程不可用时快速恢复演示"],
                    ["状态透明", "GET /api/ai/status 返回 provider、model、notice", "用户能判断当前回答来源"],
                    ["结果持久化", "用户与助手消息写入数据库", "刷新后可恢复，支持追踪与删除"],
                    ["可解释回退", "规则覆盖计划、条件概率、贝叶斯、批改与学情", "无密钥时仍能提供真实教学价值"],
                ],
                [31 * mm, 70 * mm, 64 * mm],
                styles,
            ),
            heading("5.5 当前边界", styles["h2"]),
            p(
                "当前 AI 不执行自动改分、工具调用或教务写操作，也不声称具备真实知识图谱推理。这样做避免高风险自动化与虚假能力描述。下一阶段可在教师确认、权限和审计机制完整后，再加入受控工具调用和知识点掌握推荐。",
                styles["body"],
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            heading("6. 核心功能实现", styles["h1"]),
            heading("6.1 认证与会话", styles["h2"]),
            p(
                "学生使用学号自助注册，教师必须提供邀请码。密码通过 scrypt 和随机盐生成不可逆哈希。登录成功后签发随机令牌，浏览器只保存 HttpOnly、SameSite Cookie，数据库保存令牌摘要。修改密码后其他会话全部失效，并重新签发当前会话。",
                styles["body"],
            ),
            code_block(
                "login -> verify scrypt hash -> create random token\n"
                "       -> store SHA-256 token digest and expiry\n"
                "       -> set HttpOnly cookie -> issue role-scoped session",
                styles,
            ),
            heading("6.2 课程、作业与反馈闭环", styles["h2"]),
            p(
                "教师创建课程后可按学号添加学生。作业发布写入 assignments，学生提交写入 submissions；教师评分后更新提交状态、写入反馈并生成通知。SSE 事件同时刷新前端工作台，因此学生端无需手动刷新即可看到新作业、评分和反馈。",
                styles["body"],
            ),
            heading("6.3 实时签到", styles["h2"]),
            p(
                "教师创建场次时生成有格式和有效期的数字签到码，并绑定本人课程。学生签到必须同时满足选课关系、签到码正确、场次有效和未重复签到。成功记录写入 attendance_records，服务端向任课教师发送 checked-in 事件，教师名单实时更新。",
                styles["body"],
            ),
            heading("6.4 学情分析与通知", styles["h2"]),
            p(
                "学生学情聚合课程进度、平均成绩、出勤与近 14 天学习记录；教师学情聚合班级平均、分数分布、作业完成率、出勤率和需关注学生。通知按校园范围或课程范围投递，每个目标账号拥有独立通知记录和已读状态。",
                styles["body"],
            ),
            heading("6.5 SSE 实时协作", styles["h2"]),
            data_table(
                [
                    ["机制", "实现"],
                    ["连接", "GET /api/events 建立 text/event-stream，服务端按已认证用户保存连接"],
                    ["事件", "作业、提交、评分、签到、课程和通知变化生成 campus-update 事件"],
                    ["定向", "publishRealtime 只向相关用户投递，不广播给无关账号"],
                    ["恢复", "浏览器发送 retry: 2000，EventSource 自动重连"],
                    ["保活", "20 秒心跳，关闭或异常连接自动从集合移除"],
                    ["刷新", "前端收到事件后刷新工作台，各业务页面通过 realtimeVersion 重新拉取"],
                ],
                [35 * mm, 130 * mm],
                styles,
            ),
            Spacer(1, 4 * mm),
            note_box(
                "实时验证",
                "双浏览器测试使用独立教师和学生会话：教师发布作业后学生页面自动出现任务；学生签到后教师打开名单自动从未签到变为已签到。该测试不依赖手动刷新。",
                styles,
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            heading("7. 安全与可靠性设计", styles["h1"]),
            data_table(
                [
                    ["风险", "控制措施", "验证方式"],
                    ["密码泄露", "scrypt 随机盐哈希，不保存明文", "API 注册登录测试"],
                    ["会话窃取", "HttpOnly、SameSite Cookie，数据库仅保存令牌摘要", "会话恢复、退出和改密测试"],
                    ["越权访问", "角色检查与课程归属检查", "学生调用教师接口、跨课程访问测试"],
                    ["SQL 注入", "全部参数绑定", "代码审查与真实数据库回归"],
                    ["跨站写请求", "同源 Origin 校验", "服务端写请求保护"],
                    ["登录爆破", "按来源限制高频尝试，5 秒后自动恢复", "专项 API 测试"],
                    ["资源滥用", "请求体大小限制、AI 输入上限与超时", "边界与故障回退测试"],
                    ["实时连接泄漏", "关闭、异常和心跳清理", "双浏览器实时测试"],
                ],
                [31 * mm, 75 * mm, 59 * mm],
                styles,
            ),
            heading("7.1 隐私与合规", styles["h2"]),
            p(
                "平台只收集教学所需的账号、姓名、学号和课程数据。生产环境应使用 HTTPS、强邀请码和独立持久盘，并对真实学生信息设置最小访问权限。公开仓库不得包含数据库、密钥、运行日志或真实学生数据。AI 仅提供教学建议，不直接修改成绩、考勤和处分记录。",
                styles["body"],
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            heading("8. 测试与部署", styles["h1"]),
            heading("8.1 测试策略", styles["h2"]),
            data_table(
                [
                    ["测试层级", "工具", "覆盖范围", "验收结果"],
                    ["构建", "TypeScript + Vite", "类型检查与生产构建", "通过"],
                    ["API 回归", "Node Test Runner", "8 组认证、权限和业务写流程", "通过"],
                    ["浏览器 E2E", "Playwright + Microsoft Edge", "学生和教师核心页面与交互", "通过，19 张截图"],
                    ["认证专项", "独立双端口与浏览器", "注册、邀请码、重复账号、退出与重登", "通过，7 张截图"],
                    ["实时专项", "双浏览器会话", "作业发布与签到状态跨会话同步", "通过，2 张截图"],
                ],
                [28 * mm, 43 * mm, 66 * mm, 28 * mm],
                styles,
            ),
            heading("8.2 关键验收流程", styles["h2"]),
            bullet("登录限流在实际 5 秒等待后自动恢复，不再使用 15 分钟长锁定。", styles),
            bullet("学生注册、教师邀请码注册、重复账号提示与重新登录均经过真实浏览器验证。", styles),
            bullet("教师发布作业后学生端实时出现；学生提交后教师端待批改数据刷新。", styles),
            bullet("教师创建签到后学生可签到；学生签到后教师名单实时变化。", styles),
            bullet("桌面 1440 x 1000 与手机 390 x 844 视口完成视觉验收。", styles),
            heading("8.3 部署流程", styles["h2"]),
            code_block(
                "corepack enable\n"
                "pnpm install --frozen-lockfile\n"
                "cp .env.example .env\n"
                "pnpm seed\n"
                "pnpm build\n"
                "pnpm start\n\n"
                "# Production requirements\n"
                "HTTPS reverse proxy + persistent disk + strong teacher invite code",
                styles,
            ),
            p(
                "部署平台必须支持常驻 Node.js 进程和持久化磁盘。纯静态托管无法执行认证、SQLite、SSE 和业务 API。反向代理需要关闭 /api/events 的响应缓冲，并为 SQLite、WAL 和 SHM 文件制定一致备份策略。",
                styles["body"],
            ),
            heading("8.4 运维能力", styles["h2"]),
            p(
                "/api/health 用于服务健康检查；数据库每日备份并记录 SHA-256；每周清理过期会话；每月更新依赖并复核模型成本和安全配置。生产环境需将日志写入受控位置并配置轮转。",
                styles["body"],
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            heading("9. 创新点说明", styles["h1"]),
            heading("9.1 技术创新点", styles["h2"]),
            data_table(
                [
                    ["创新点", "具体实现", "对比传统方案的价值"],
                    ["权限感知 AI 上下文", "服务端根据当前用户、课程和角色裁剪上下文", "避免浏览器直连模型和数据越权"],
                    ["透明双引擎回退", "远程模型失败或未配置时明确切换本地引擎", "演示可离线运行，不伪造 AI 状态"],
                    ["用户定向 SSE", "事件按 userId 集合投递并支持重连与心跳", "作业、评分和签到实时同步，减少轮询"],
                    ["业务状态强校验", "服务端同时检查角色、课程、截止、评分与重复签到", "前端隐藏不是安全边界，状态不可绕过"],
                    ["单仓库可验证交付", "构建、API、E2E、认证、实时与截图共用真实数据链", "关键结论有自动化证据，不是静态演示"],
                ],
                [39 * mm, 70 * mm, 56 * mm],
                styles,
            ),
            heading("9.2 应用创新点", styles["h2"]),
            data_table(
                [
                    ["应用创新", "用户价值"],
                    ["AI 助教进入课程作业闭环", "回答围绕当前课程和任务，教师可生成批改建议"],
                    ["学生与教师共享同一数据源", "作业、反馈、出勤和通知状态一致，减少重复录入"],
                    ["实时课堂签到反馈", "教师无需刷新即可看到学生签到进度，及时处理异常"],
                    ["学情风险前置", "在班级平均分之外突出持续下降和低完成率学生"],
                    ["公开可复现的测试证据", "评审可按 README 命令重复验证主要流程与界面"],
                ],
                [58 * mm, 107 * mm],
                styles,
            ),
            heading("9.3 原创性说明", styles["h2"]),
            p(
                "项目代码为独立实现。需求调研参考了学习平台常见的课程、作业、考勤、通知和角色隔离模式，但数据模型、接口、认证流程、实时机制、AI 适配和界面均由本项目完成。未直接复制第三方智慧校园仓库代码。",
                styles["body"],
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            heading("10. 总结与展望", styles["h1"]),
            heading("10.1 项目总结", styles["h2"]),
            p(
                "知澜智慧校园已经形成从身份认证到课程学习、作业反馈、课堂签到、通知和学情分析的完整业务链。平台以真实数据库、服务端权限和跨角色实时更新为技术基础，以 AI 上下文助教和透明回退为教育智能化能力，以自动化测试和截图验收为交付证明。",
                styles["body"],
            ),
            heading("10.2 后续演进", styles["h2"]),
            data_table(
                [
                    ["阶段", "演进方向", "前置条件"],
                    ["近期", "作业附件、对象存储、内容安全审核", "文件存储与杀毒扫描"],
                    ["近期", "统一身份认证与教务系统同步", "学校接口授权与隐私评审"],
                    ["中期", "知识点、先修关系和掌握度图谱", "课程知识建模与教师确认"],
                    ["中期", "个性化学习路径推荐", "足够学习行为与可解释推荐策略"],
                    ["长期", "PostgreSQL、Redis、水平扩容与多租户", "多实例部署和运维体系"],
                    ["长期", "受控 AI 工具调用与人工审批", "审计、回滚和高风险动作二次确认"],
                ],
                [26 * mm, 79 * mm, 60 * mm],
                styles,
            ),
            heading("10.3 可持续运营", styles["h2"]),
            p(
                "平台可先从 1 至 2 门课程的四周试点开始，以签到率、作业完成率、反馈周期和教师节省时间作为核心指标。试点稳定后扩展到专业和学院，并逐步接入统一身份认证、教务数据、私有化模型与校级运营看板。SQLite 版本适合单实例试点，扩展前必须完成数据库和实时消息基础设施迁移。",
                styles["body"],
            ),
            Spacer(1, 8 * mm),
            note_box(
                "提交结论",
                "当前版本具备可运行、可操作、可持久化、可实时反馈和可自动化回归的比赛作品基础。项目仓库已公开发布，团队信息已按参赛团队提供的内容填写；公网演示入口为 http://weigxh.cn:5555，最终演示视频链接可在录制完成后补充。",
                styles,
                tone="orange",
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            heading("附录 A. 核心界面验收", styles["h1"]),
            p("以下截图来自真实浏览器会话，页面数据和交互均连接独立测试数据库。完整 28 张截图位于 artifacts/screenshots。", styles["body"]),
            screenshot_pair(
                ("01-login-desktop.png", "双角色登录"),
                ("02-student-dashboard.png", "学生工作台"),
                styles,
            ),
            Spacer(1, 5 * mm),
            screenshot_pair(
                ("07-student-ai.png", "AI 助教"),
                ("10-student-analytics.png", "学生学情"),
                styles,
            ),
            PageBreak(),
            screenshot_pair(
                ("13-teacher-dashboard.png", "教师工作台"),
                ("15-teacher-analytics.png", "班级学情"),
                styles,
            ),
            Spacer(1, 5 * mm),
            screenshot_pair(
                ("17-teacher-grading.png", "教师批改"),
                ("27-realtime-assignment-student.png", "实时作业同步"),
                styles,
            ),
            PageBreak(),
            screenshot_pair(
                ("22-auth-student-registered.png", "学生注册成功"),
                ("24-auth-teacher-registered.png", "教师注册成功"),
                styles,
            ),
            Spacer(1, 5 * mm),
            screenshot_single("19-teacher-mobile-dashboard.png", "移动端教师工作台", styles, width=50 * mm),
            PageBreak(),
        ]
    )

    story.extend(
        [
            heading("附录 B. 环境变量与测试命令", styles["h1"]),
            data_table(
                [
                    ["变量", "默认值", "生产建议"],
                    ["PORT", "5175", "按平台端口配置"],
                    ["SESSION_DAYS", "7", "1 至 30 天内按安全策略设置"],
                    ["TEACHER_INVITE_CODE", "ZHILAN-TEACHER-2026", "必须替换为高强度随机值"],
                    ["DATABASE_PATH", "./data/zhilan.db", "使用持久盘绝对路径"],
                    ["AI_API_KEY", "空", "评审期可配置兼容服务密钥"],
                    ["AI_BASE_URL", "https://api.openai.com/v1", "替换为实际兼容服务地址"],
                    ["AI_MODEL", "gpt-4o-mini", "填写实际部署模型"],
                    ["SEED_STUDENT_PASSWORD", "Campus@2026", "生产环境不得使用默认值"],
                    ["SEED_TEACHER_PASSWORD", "Teacher@2026", "生产环境不得使用默认值"],
                ],
                [47 * mm, 56 * mm, 62 * mm],
                styles,
            ),
            Spacer(1, 5 * mm),
            heading("B.1 本地运行", styles["h2"]),
            code_block(
                "corepack enable\n"
                "pnpm install --frozen-lockfile\n"
                "Copy-Item .env.example .env\n"
                "pnpm seed\n"
                "pnpm dev",
                styles,
            ),
            heading("B.2 自动化验收", styles["h2"]),
            code_block(
                "pnpm build\n"
                "pnpm test:all\n\n"
                "# Individual suites\n"
                "pnpm test:api\n"
                "pnpm test:e2e\n"
                "pnpm test:auth\n"
                "pnpm test:realtime",
                styles,
            ),
            heading("B.3 演示账号", styles["h2"]),
            data_table(
                [
                    ["角色", "账号", "演示密码"],
                    ["学生", "2024001", "Campus@2026"],
                    ["教师", "T1001", "Teacher@2026"],
                ],
                [35 * mm, 55 * mm, 75 * mm],
                styles,
            ),
            Spacer(1, 5 * mm),
            note_box(
                "生产安全提醒",
                "演示账号、邀请码和默认密码只用于本地验收。正式部署前必须更换，且不得把 .env、SQLite 数据库、测试日志或真实学生数据推送到公开仓库。",
                styles,
                tone="orange",
            ),
        ]
    )

    return story


def build() -> Path:
    register_fonts()
    styles = make_styles()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    document = SubmissionDocument(str(OUTPUT_PATH), styles)
    story = build_story(styles)
    # Install the document-owned TableOfContents at the placeholder position.
    for index, flowable in enumerate(story):
        if isinstance(flowable, str) and flowable == "__TOC__":
            story[index] = document.toc
            break
    document.multiBuild(story, maxPasses=5)
    if not OUTPUT_PATH.exists():
        raise RuntimeError("PDF was not created")
    digest = hashlib.sha256(OUTPUT_PATH.read_bytes()).hexdigest().upper()
    print(f"PDF={OUTPUT_PATH}")
    print(f"BYTES={OUTPUT_PATH.stat().st_size}")
    print(f"SHA256={digest}")
    return OUTPUT_PATH


if __name__ == "__main__":
    build()
