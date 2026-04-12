---
name: feishu-wiki
description: 管理飞书知识库、Docx 文档、普通表格、嵌入式 Sheet、嵌入式 Bitable 的通用技能。用户一旦提到飞书 wiki、云文档、文档里的表格、多维表格、嵌入表格、知识库目录整理、Bitable 字段/记录迁移，就应优先使用本技能，并严格执行“先 read，再看 block_types，再决定是否 list_blocks / bitable API / spreadsheet API”的分流流程。
required_permissions:
  - wiki:wiki
  - docx:document
  - docx:document:readonly
  - docx:document.block:convert
  - drive:drive
  - base:app:readonly
  - base:table:readonly
  - base:field:readonly
  - base:record:readonly
---

# 飞书知识库与表格操作

你负责通过 Wiki、Docx、Bitable 相关 API 与工具完成知识库和表格操作。

## 先做分型

遇到“飞书文档里有个表格 / sheet / 多维表格”的请求，先区分对象类型：

| 对象类型 | 能否读取数据 | 正确路径 |
|---|---|---|
| 文档正文 / 标题 / 列表 | ✅ | `read` |
| 文档里的普通表格 | ✅ | `read` → `list_blocks` |
| 独立 Spreadsheet | ✅ | Spreadsheet 专用 API / 工具 |
| 独立 Bitable | ✅ | Bitable API / 工具 |
| 文档里嵌入的 Spreadsheet | ⚠️ 取决于部署是否有 spreadsheet 能力 | `list_blocks` → 提取 token / metadata → spreadsheet 路径 |
| 文档里嵌入的 Bitable | ✅，但要多一步 | `list_blocks` → 提取 `app_token` → Bitable API |

## 核心规则

1. 读取 Docx 时先做 `read`。
2. 检查返回结果中的 `hint` / `block_types`。
3. 只要存在结构化内容提示，就继续 `list_blocks`。
4. 看到 `Table`，解析普通文档表格。
5. 看到 `Sheet`，切换到 spreadsheet 专用读取路径。
6. 看到 `Bitable`，提取 `app_token` 再调用 bitable API。
7. 不要只做第一步文本读取就说“读不了”。

## Wiki → Docx 工作流

1. 知识库和 Docx 相关操作默认优先走 user token。
2. 先用 wiki 工具定位节点。
3. 获取 `obj_token`，不要把 `node_token` 当成文档 token。
4. 用 Docx 工具读写正文。
5. 若文档包含结构化块，继续 `list_blocks`。
6. 改标题走 Docx Page Block PATCH，不走 Wiki 标题接口。

## Docx 表格工作流

较新的 OpenClaw 版本已经支持专门的表格动作：
- `create_table`
- `write_table_cells`
- `create_table_with_values`

优先用这些 action 创建和写入表格，不要依赖 markdown table 作为主方案。

## Bitable 工作流

1. 优先使用 `tenant_access_token`。
2. 先拿 `app_token`，再列出 `table_id`。
3. 批量写入时控制批次和节流。
4. URL 字段和文本字段要区分格式。
5. 更新记录时保留已有 URL 字段，避免被清空。

## 嵌入式表格案例处理

当用户质疑“明明都是表格，为什么有的能读有的不能读”时，直接解释：

- 普通 Docx 表格是文档正文 block 的一部分，可以通过 `list_blocks` 直接拿到。
- 嵌入式 Spreadsheet / Bitable 是“文档里挂了一个外部对象”，文档 API 负责告诉你“这里有这个对象”，真正数据要去对应表格 API 拿。
- 如果当前部署没有 spreadsheet 专用工具，就让用户打开“原表格”或“在新标签页打开”，提供独立 URL / token 后再继续。

## 额外规则

1. 创建 wiki 节点时，`node_type: "origin"` 必传。
2. 现有云文档移入知识库时，先签入知识库，再移动到目标节点。
3. 删除节点、删除知识库、修改知识库名称等动作，遇到 API 不支持或权限不足时必须直接说明，不要假装可做。
4. Bitable 是例外场景：知识库 / Docx 默认优先 user token，但真正的 Bitable 表、字段、记录 API 仍应优先按技能主文档里的 token 规则执行。

## 参考

详细说明见仓库根目录：
- `../SKILL.md`
- `../references/block-api.md`
- `../references/bitable-api.md`
- `../references/openclaw-feishu-best-practices.md`
