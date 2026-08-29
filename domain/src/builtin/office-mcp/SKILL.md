---
name: office-mcp
description: "Office 文档操作（Word/Excel/PPT/PDF/OCR 共 39 工具）——首次需 clone+build 并配置 MCP"
---

# Office MCP Server

> 来源：[claude-office-skills/office-mcp](https://github.com/claude-office-skills/skills/tree/main/mcp-servers/office-mcp)（MIT，已过 Socket / Snyk / Gen Agent Trust Hub 安全审计）
> 39 个 MCP 工具处理 Office 文档。未发 npm，需首次获取 + 构建 + 配置 MCP，之后**重启对话**生效。

## 何时使用

用户要操作 Office 文档：读/写 Excel、生成 Word/PPT、PDF 提取/合并/OCR、格式转换等。

## 首次配置（agent 执行 + 用户重启对话生效）

1. 获取并构建（bash，需网络 + Node）：

    ```bash
    git clone --depth 1 https://github.com/claude-office-skills/skills.git ~/.anycode/runtime/office-skills
    cd ~/.anycode/runtime/office-skills/mcp-servers/office-mcp
    npm install && npm run build
    ```

    首次较重（13 个依赖；OCR 首次下载语言模型）。

2. 配置 MCP（写 `~/.anycode/config.yaml` 的 mcp 段，或告知用户经 Settings 配）：

    ```yaml
    mcp:
        office-mcp:
            type: stdio
            command: node
            args:
                [
                    <上面 clone 目录的绝对路径>/mcp-servers/office-mcp/dist/index.js,
                ]
            enabled: true
    ```

3. **重启对话**生效——MCP 在 agent 创建时连接，新配置需下次 run。

## 工具总览（39）

### PDF (10)

| 工具                      | 说明                     |
| ------------------------- | ------------------------ |
| `extract_text_from_pdf`   | 提取文本，支持选页       |
| `extract_tables_from_pdf` | 提取表格                 |
| `merge_pdfs`              | 合并多个 PDF             |
| `split_pdf`               | 按页范围拆分             |
| `compress_pdf`            | 压缩                     |
| `add_watermark_to_pdf`    | 文字/图片水印            |
| `fill_pdf_form`           | 填表单字段               |
| `get_pdf_metadata`        | 元数据                   |
| `ocr_pdf`                 | 扫描 PDF OCR（多语言）   |
| `ocr_image`               | 图片 OCR（PNG/JPG/TIFF） |

### Spreadsheet (7)

| 工具                  | 说明                        |
| --------------------- | --------------------------- |
| `read_xlsx`           | 读 Excel（sheet/范围）      |
| `create_xlsx`         | 建多 sheet Excel            |
| `analyze_spreadsheet` | 统计（min/max/mean/median） |
| `apply_formula`       | 应用公式                    |
| `create_chart`        | 生成图表配置                |
| `pivot_table`         | 透视表                      |
| `xlsx_to_json`        | Excel → JSON                |

### Document (6)

| 工具                         | 说明                      |
| ---------------------------- | ------------------------- |
| `extract_text_from_docx`     | 提取 Word 文本            |
| `create_docx`                | 建 Word（标题/列表/表格） |
| `fill_docx_template`         | 填 `{{占位符}}` 模板      |
| `analyze_document_structure` | 分析结构/字数             |
| `insert_table_to_docx`       | 插入表格                  |
| `merge_docx_files`           | 合并 Word                 |

### Conversion (9)

| 工具                                           | 说明                        |
| ---------------------------------------------- | --------------------------- |
| `xlsx_to_csv` / `csv_to_xlsx` / `json_to_xlsx` | Excel/CSV/JSON 互转         |
| `docx_to_md` / `md_to_docx`                    | Word/Markdown 互转          |
| `pdf_to_docx` / `docx_to_pdf`                  | PDF/Word 互转（需外部工具） |
| `html_to_pdf`                                  | HTML→PDF（需外部工具）      |
| `batch_convert`                                | 批量转换                    |

### Presentation (7)

| 工具                         | 说明              |
| ---------------------------- | ----------------- |
| `create_pptx`                | 建 PPT（主题）    |
| `extract_from_pptx`          | 提取文本/图片     |
| `md_to_pptx`                 | Markdown → 幻灯片 |
| `add_slide` / `update_slide` | 增/改幻灯片       |
| `pptx_to_html`               | 转 reveal.js HTML |
| `get_pptx_outline`           | 大纲              |

## 依赖

pdf-parse / pdf-lib（PDF）、tesseract.js（OCR，纯 JS 无原生二进制）、xlsx（Excel）、mammoth / docx（Word）、docxtemplater / pizzip（模板）、pptxgenjs / jszip（PPT）、turndown / marked（Markdown）。

OCR 语言：eng / chi_sim / chi_tra / jpn / kor / fra / deu / spa。

## 约束

-   仅操作用户指定文件，不擅自扫描目录（隐私）。
-   `docx_to_pdf` / `html_to_pdf` 需外部工具（pandoc / wkhtmltopdf）。
-   OCR 首次下载语言模型（tesseract.js 自动，需网络）。
