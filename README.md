# feishu-wiki-manager

An AI skill for programmatic management of Feishu (Lark) wiki knowledge bases.

## What it does

- **Wiki Node CRUD** — Create, read, rename, and organize wiki documents and Bitable tables
- **Rich Document Writing** — Write structured content (headings, bullets, links, code blocks) via Block API with proper rate limiting
- **Bitable Configuration** — Create fields, batch-create/update records, search with filters
- **Data Migration** — Move records between Bitable tables with field mapping and rich text parsing
- **Node Health Scanning** — Detect empty parent nodes that should link to their children, and auto-fix them
- **IM Image & File Sending** — Upload and send images/files via Feishu messages (screenshot → upload → send two-step flow)

## Installation

### For Cursor IDE

Copy the skill folder to your Cursor skills directory:

```bash
cp -r feishu-wiki-manager ~/.cursor/skills/
```

### For Claude Code

Copy to your skills directory:

```bash
cp -r feishu-wiki-manager ~/.claude/skills/
```

### For any AI IDE

The skill is a standard markdown-based skill. Place `SKILL.md` where your IDE reads skill files.

## Prerequisites

1. A Feishu/Lark custom app with these permissions:
   - `wiki:wiki` (wiki read/write)
   - `docx:document` (document read/write)
   - `base:app:*`, `base:table:*`, `base:field:*`, `base:record:*` (bitable operations)
   - `im:message:send_as_bot` (send messages as bot)
   - `im:image` (upload images for chat)
   - `im:file` (upload files for chat)

2. App credentials (appId + appSecret) accessible to your scripts

## Key Insights from Production

- **Use tenant_access_token for Bitable** — user tokens often lack bitable scopes even when permissions are configured
- **Bullet list = block_type 12** (not 11, which is Heading 9)
- **Divider blocks (type 17) don't work via API** — use empty text blocks instead
- **Batch 15 blocks max per write** with 1.5s delays to avoid error 1770024
- **Wiki node rename** requires PATCH on the page block, not PUT on the wiki node
- **Bitable text fields return JSON arrays** `[{"text":"value","type":"text"}]`, not plain strings
- **IM images ≠ document images** — use `/im/v1/images` (returns `image_key`) NOT `/drive/v1/medias/upload_all` (returns `file_token`)

## File Structure

```
feishu-wiki-manager/
├── SKILL.md                     — Core instructions
├── references/
│   ├── block-api.md             — Block type reference (types, styles, API endpoints)
│   └── bitable-api.md           — Bitable field types, record formats, auth guide
└── scripts/
    └── wiki-helpers.mjs         — Reusable helper functions (createNode, writeBlocks, etc.)
```

## License

MIT
