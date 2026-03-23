---
name: feishu-wiki-manager
description: Manage Feishu (Lark) wiki knowledge bases programmatically — create wiki nodes, write rich document content via Block API, configure Bitable (multi-dimensional tables) with fields and records, migrate data between tables, and generate progress reports. Use when the user asks to create, update, or organize Feishu wiki documents, build knowledge base structures, set up tracking tables (多维表格), migrate Bitable data, scan for empty/broken wiki nodes, or generate statistics from Feishu knowledge base content.
---

# Feishu Wiki Manager

Programmatic management of Feishu (Lark) wiki knowledge bases: node CRUD, document content writing, Bitable table configuration, data migration, and progress reporting.

Built from real production experience managing a 100+ node knowledge base with 10 department Bitable tracking tables and 1000+ person records.

## Prerequisites

- A Feishu/Lark app with credentials (appId, appSecret) stored in a config file
- A FeishuClient or equivalent HTTP wrapper that can call `https://open.feishu.cn/open-apis/`
- Required Feishu app permissions: `wiki:wiki`, `docx:document`, `base:app:*`, `base:table:*`, `base:field:*`, `base:record:*`

## Core Operations

### 1. Wiki Node CRUD

Create nodes under a parent in a wiki space:

```javascript
const resp = await client.request('POST', `/wiki/v2/spaces/${SPACE_ID}/nodes`, {
  obj_type: 'docx',  // or 'bitable', 'sheet'
  parent_node_token: parentToken,
  node_type: 'origin',
  title: 'My Document'
});
const { node_token, obj_token } = resp.node;
// node_token = wiki tree ID, obj_token = document/bitable app ID
```

Rename a document (wiki API has no rename endpoint — update the page block instead):

```javascript
await client.request('PATCH',
  `/docx/v1/documents/${docId}/blocks/${docId}`,
  { update_text_elements: { elements: [{ text_run: { content: 'New Title' } }] } },
  { document_revision_id: -1 }
);
```

List children of a node:

```javascript
const children = await client.request('GET',
  `/wiki/v2/spaces/${SPACE_ID}/nodes`, null,
  { parent_node_token: parentToken, page_size: 50 }
);
```

### 2. Writing Document Content (Block API)

See [references/block-api.md](references/block-api.md) for full block type reference.

Key patterns:

```javascript
const S = { bold: false, inline_code: false, italic: false, strikethrough: false, underline: false };
const B = { ...S, bold: true };
const linkStyle = (url) => ({ ...B, link: { url } });

const el = (text, style = S) => ({ text_run: { content: text, text_element_style: style } });
const textBlock = (...elements) => ({ block_type: 2, text: { elements } });
const h2Block = (...elements) => ({ block_type: 4, heading2: { elements } });
const bulletBlock = (...elements) => ({ block_type: 12, bullet: { elements } });

// Write blocks in batches of 15 with 1.5s delays to avoid error 1770024
async function writeBlocks(docId, blocks) {
  for (let i = 0; i < blocks.length; i += 15) {
    if (i > 0) await new Promise(r => setTimeout(r, 1500));
    await client.request('POST',
      `/docx/v1/documents/${docId}/blocks/${docId}/children`,
      { children: blocks.slice(i, i + 15), index: i },
      { document_revision_id: -1 });
  }
}
```

Rewrite a document (delete all children, then write new ones):

```javascript
async function rewriteDoc(docId, blocks) {
  const resp = await client.getBlocks(docId);
  const root = (resp.items || []).find(b => b.block_id === docId);
  const childCount = root?.children?.length || 0;
  if (childCount > 0) {
    await client.request('DELETE',
      `/docx/v1/documents/${docId}/blocks/${docId}/children/batch_delete`,
      { start_index: 0, end_index: childCount },
      { document_revision_id: -1 });
  }
  await writeBlocks(docId, blocks);
}
```

### 3. Bitable Operations

See [references/bitable-api.md](references/bitable-api.md) for field types and record formats.

**Critical: use tenant_access_token for all Bitable API calls.** User tokens obtained via OAuth often lack bitable scopes even when the app has the permissions configured:

```javascript
async function getTenantToken(appId, appSecret) {
  const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  return (await r.json()).tenant_access_token;
}
```

Create a bitable wiki node + configure fields:

```javascript
// 1. Create bitable node (uses user token via FeishuClient)
const node = await client.request('POST', `/wiki/v2/spaces/${SPACE}/nodes`, {
  obj_type: 'bitable', parent_node_token: parent, node_type: 'origin', title: 'Tracking Table'
});
const appToken = node.node.obj_token;

// 2. Get table ID and configure fields (uses tenant token)
const T = await getTenantToken(appId, appSecret);
const tables = await btApi(T, 'GET', `/bitable/v1/apps/${appToken}/tables`);
const tableId = tables.items[0].table_id;

await btApi(T, 'POST', `/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
  { field_name: 'Status', type: 3, property: { options: [{ name: 'Todo' }, { name: 'Done' }] } });
```

### 4. Data Migration Between Bitables

Pattern: read source → transform → batch write to target.

```javascript
// Read with filter
const data = await btApi(T, 'POST',
  `/bitable/v1/apps/${SRC_APP}/tables/${SRC_TABLE}/records/search`,
  { page_size: 200, filter: { conjunction: 'and', conditions: [
    { field_name: 'Department', operator: 'is', value: ['Sales'] }
  ]}});

// Rich text field parsing (names, deliverables stored as JSON arrays)
function parseRichText(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  if (!Array.isArray(field)) return String(field);
  return field.map(item => {
    if (item.link) return `${item.text || 'Link'}: ${item.link}`;
    return item.text?.trim() || '';
  }).filter(Boolean).join('\n');
}

// Batch write (10 records per batch, 300ms delay)
for (let i = 0; i < records.length; i += 10) {
  await btApi(T, 'POST', `/bitable/v1/apps/${APP}/tables/${TBL}/records/batch_create`,
    { records: records.slice(i, i + 10).map(r => ({ fields: r })) });
  if (i + 10 < records.length) await new Promise(r => setTimeout(r, 300));
}
```

### 5. Scanning for Empty Wiki Nodes

Detect nodes that have children but empty/placeholder document content:

```javascript
const children = await client.request('GET', `/wiki/v2/spaces/${SPACE}/nodes`,
  null, { parent_node_token: nodeToken, page_size: 50 });
const md = await client.getDocxMarkdown(docId);
if (children.items?.length > 0) {
  // Check if parent doc links to all children
  for (const child of children.items) {
    const hasLink = md.includes(child.node_token);
    if (!hasLink) { /* needs fixing */ }
  }
}
```

Fix pattern: append linked bullet list of missing children:

```javascript
const blocks = [];
for (const child of missingChildren) {
  blocks.push(bulletBlock(
    el(child.title, linkStyle(`https://your-domain.feishu.cn/wiki/${child.node_token}`))
  ));
}
// Append at end of existing content
await client.request('POST',
  `/docx/v1/documents/${docId}/blocks/${docId}/children`,
  { children: blocks, index: currentBlockCount },
  { document_revision_id: -1 });
```

### 6. Image Handling (Download, Upload, and Fixing Broken Images)

**Root cause of broken images**: When documents are created by importing markdown, image references like `![Image](image_token:xxx)` get stored as TEXT blocks (block_type=2), NOT as proper image blocks (block_type=27). The page renders these as raw text instead of images.

**Detecting broken images**:

```javascript
for (const block of blocks) {
  const els = block.text?.elements || [];
  const content = els.map(e => e.text_run?.content || '').join('');
  const match = content.match(/^!\[(?:Image|image)?\]\(image_token:([a-zA-Z0-9_-]+)\)$/);
  if (match) {
    brokenImages.push({ blockId: block.block_id, parentId: block.parent_id, imageToken: match[1] });
  }
}
```

**Downloading images** — use direct download (more reliable than batch_get_tmp_download_url):

```javascript
const res = await axios.get(`${BASE}/drive/v1/medias/${imageToken}/download`, {
  headers: { Authorization: `Bearer ${token}` },
  responseType: 'arraybuffer', maxRedirects: 5
});
```

**Fixing broken images** — 3-step process (cannot set token during creation):

```javascript
import FormData from 'form-data';

// Step 1: Delete the text block
await client.request('DELETE',
  `/docx/v1/documents/${docId}/blocks/${parentId}/children/batch_delete`,
  { start_index: idx, end_index: idx + 1 }, { document_revision_id: -1 });

// Step 2: Create EMPTY image block
const createRes = await client.request('POST',
  `/docx/v1/documents/${docId}/blocks/${parentId}/children`,
  { children: [{ block_type: 27, image: {} }], index: idx },
  { document_revision_id: -1 });
const imageBlockId = createRes.children[0].block_id;

// Step 3: Upload image with parent_node = imageBlockId (NOT docId!)
const form = new FormData();
form.append('file_name', `${token}.png`);
form.append('parent_type', 'docx_image');
form.append('parent_node', imageBlockId);
form.append('size', String(imgBuffer.length));
form.append('file', imgBuffer, { filename: `${token}.png`, contentType: 'image/png' });
const upRes = await axios.post(`${BASE}/drive/v1/medias/upload_all`, form, {
  headers: { ...form.getHeaders(), Authorization: `Bearer ${tenantToken}` }
});

// Step 4: PATCH block to bind the uploaded image
await client.request('PATCH',
  `/docx/v1/documents/${docId}/blocks/${imageBlockId}`,
  { replace_image: { token: upRes.data.data.file_token } },
  { document_revision_id: -1 });
```

**CRITICAL**: Process blocks from bottom to top (descending index) to keep indices stable. 403 on download means the image belongs to another user's personal drive — ask author to re-insert.

### Image-Safe Document Workflow

When downloading documents for local backup, always use `imageDir` to capture images. When re-uploading, use the 3-step image flow for each image. **NEVER** import markdown containing `image_token:xxx` references — they become text, not images.

### 7. Sending Images via Feishu Messages (IM API)

**Use case**: Bot takes a screenshot or generates an image, then sends it to a user/group via Feishu chat.

**Two-step flow** (screencapture → upload → send):

```javascript
import FormData from 'form-data';
import fs from 'fs';

// Step 1: Upload image to get image_key
async function uploadChatImage(tenantToken, filePath) {
  const form = new FormData();
  form.append('image_type', 'message');
  form.append('image', fs.createReadStream(filePath));
  const res = await fetch('https://open.feishu.cn/open-apis/im/v1/images', {
    method: 'POST',
    headers: { ...form.getHeaders(), Authorization: `Bearer ${tenantToken}` },
    body: form
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Upload image failed: ${data.code} ${data.msg}`);
  return data.data.image_key;
}

// Step 2: Send image message
async function sendImageMessage(tenantToken, receiveId, imageKey, receiveIdType = 'open_id') {
  const res = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tenantToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: 'image',
      content: JSON.stringify({ image_key: imageKey })
    })
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Send image failed: ${data.code} ${data.msg}`);
  return data.data;
}
```

**One-liner combo** (file path → send):

```javascript
async function sendImageFile(tenantToken, receiveId, filePath, receiveIdType = 'open_id') {
  const imageKey = await uploadChatImage(tenantToken, filePath);
  return sendImageMessage(tenantToken, receiveId, imageKey, receiveIdType);
}
```

**Send image in rich text (post) message** — for mixing text and images:

```javascript
async function sendPostWithImages(tenantToken, receiveId, title, contentParts, receiveIdType = 'open_id') {
  // contentParts: array of arrays, each inner array is a line
  // text part: { tag: 'text', text: '...' }
  // image part: { tag: 'img', image_key: '...' }
  const res = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tenantToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: 'post',
      content: JSON.stringify({ zh_cn: { title, content: contentParts } })
    })
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Send post failed: ${data.code} ${data.msg}`);
  return data.data;
}

// Example: send text + image combo
const imageKey = await uploadChatImage(token, '/tmp/screenshot.png');
await sendPostWithImages(token, openId, '截图报告', [
  [{ tag: 'text', text: '以下是当前页面截图：' }],
  [{ tag: 'img', image_key: imageKey }],
  [{ tag: 'text', text: '请查收 ✅' }]
]);
```

**Reply to a message with image** — attach image to an existing thread:

```javascript
async function replyWithImage(tenantToken, messageId, imageKey) {
  const res = await fetch('https://open.feishu.cn/open-apis/im/v1/messages/' + messageId + '/reply', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tenantToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'image',
      content: JSON.stringify({ image_key: imageKey })
    })
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Reply image failed: ${data.code} ${data.msg}`);
  return data.data;
}
```

**Required permissions**:
- `im:message:send_as_bot` — send messages as bot
- `im:image` — upload images for messaging

**Common errors**:

| Error Code | Meaning | Solution |
|-----------|---------|----------|
| 230001 | Bot not in chat | Bot must be added to group chat first |
| 230002 | No message permission | Add `im:message:send_as_bot` scope |
| 99991668 | Image upload failed | Check file size (max 10MB), format (png/jpg/gif/bmp/webp), and `im:image` scope |
| 99991672 | Permission denied | Missing `im:image` or `im:message` scope |

**Key differences from document images**:
- IM images use `POST /im/v1/images` (NOT `/drive/v1/medias/upload_all`)
- IM images return `image_key` (NOT `file_token`)
- IM images use `image_type: "message"` (NOT `parent_type: "docx_image"`)
- No 3-step flow needed — upload once, send directly

### 8. Sending Files via Feishu Messages

```javascript
// Upload file for chat
async function uploadChatFile(tenantToken, filePath, fileName) {
  const form = new FormData();
  form.append('file_type', 'stream');  // or: opus, mp4, pdf, doc, xls, ppt
  form.append('file_name', fileName || filePath.split('/').pop());
  form.append('file', fs.createReadStream(filePath));
  const res = await fetch('https://open.feishu.cn/open-apis/im/v1/files', {
    method: 'POST',
    headers: { ...form.getHeaders(), Authorization: `Bearer ${tenantToken}` },
    body: form
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Upload file failed: ${data.code} ${data.msg}`);
  return data.data.file_key;
}

// Send file message
async function sendFileMessage(tenantToken, receiveId, fileKey, receiveIdType = 'open_id') {
  const res = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tenantToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: 'file',
      content: JSON.stringify({ file_key: fileKey })
    })
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Send file failed: ${data.code} ${data.msg}`);
  return data.data;
}
```

**Required permission**: `im:file`

## Critical Pitfalls (Learned from Production)

### API Errors

| Error Code | Meaning | Solution |
|-----------|---------|----------|
| 1770001 | Invalid param | Check block_type numbers; bullet=12 not 11. For images: cannot set token during creation — use 3-step flow |
| 1770013 | Resource relation mismatch | Image token not associated with document. Upload with parent_node=imageBlockId, not docId |
| 1770024 | Too many writes | Add 1.5-3s delay between batches; reduce batch size to 10-15 |
| 1254060 | TextFieldConvFail | Writing URL-array `[{text,link}]` to a text-type field. Retry with plain-string format (join with `\n`) |
| 1254068 | URLFieldConvFail | Writing plain string to a URL-type field. Must use `[{text,link}]` array format |
| 10014 / 99991661 / 99991663 | Token expired/invalid | Invalidate token cache and re-authenticate on next request |
| 99991679 | Permission denied | For bitable: use tenant_access_token instead of user token |
| 403 on media download | No access to file | Image belongs to another user's drive; ask author to re-insert |
| 404 on DELETE children | Wrong endpoint | Must use `.../children/batch_delete`, NOT `.../children` |
| 404 on wiki node PUT | No rename API | Use PATCH on page block to change document title |

### Block Type Numbers

Common mistake: using wrong block_type. The correct mapping:

- 2=Text, 4=H2, 5=H3, 12=Bullet, 13=Ordered, 14=Code
- Divider (17) does NOT work via create API — use empty text block instead
- See [references/block-api.md](references/block-api.md) for full list

### Token Selection

- **Wiki API** (create/list/delete nodes): use user_access_token
- **Docx API** (read/write blocks): use user_access_token
- **Bitable API** (tables/fields/records): use **tenant_access_token** — user token often missing bitable scopes even when permissions are granted
- **Token caching**: Cache tenant_access_token with 5-minute early expiry buffer. Auto-invalidate on auth error codes (10014, 99991661, 99991663) so next request re-authenticates
- **Token refresh with retry**: Use exponential backoff (1s → 2s → 8s) with max 3 retries for token acquisition — network blips should not crash the sync

### Rate Limits

- Document block writes: max ~30 blocks before hitting 1770024
- Solution: batch 15 blocks at a time, 1.5s delay between batches
- For large documents (50+ blocks): write in 3-4 batches with 3s delays
- Bitable record writes: **10 per batch** for batch_create (not 50 — larger batches cause intermittent failures), 300ms delay
- Bitable record reads: page_size=100 but actual pages may be tiny (2-3 records) when records have URL fields
- Bitable record deletes: up to 500 IDs per batch_delete call
- Media download/upload: 5 QPS each
- **Rebuild > Incremental update**: For tables with URL/link fields, delete-all + re-insert is 10x faster than read-match-update
- **Pagination safety**: Always set a MAX_PAGES guard (e.g. 100) to prevent infinite loops when `has_more` never becomes false due to API bugs

### Rich Text Field Format

Bitable text fields return JSON arrays, not plain strings:

```json
[{"text": "John Doe", "type": "text"}]
```

Always parse with: `Array.isArray(f) ? f[0]?.text : f`

Deliverable/link fields may contain structured mention objects:

```json
[{"link": "https://...", "text": "Doc Title", "type": "mention"}]
```

### Link Format in Blocks

Wiki links use `https://{your-domain}.feishu.cn/wiki/{node_token}` (not document ID / obj_token).

Links in bullet items need bold + link style in `text_element_style`:

```javascript
{ bold: true, link: { url: 'https://your-domain.feishu.cn/wiki/xxx' } }
```

## Production Patterns (Real-World: 300+ Members, Multi-Department Bitables)

### Bitable URL Field Type Handling (CRITICAL)

Bitable has two field types that look similar but behave differently: **Text (type 1)** and **URL (type 15)**. Different department tables may use different types for the same logical field. You **must** handle both:

```javascript
/**
 * Normalize a Bitable URL-type field value to [{text, link}] array format.
 * Handles: arrays, strings, null/undefined.
 * Prevents URLFieldConvFail (1254068) when writing to URL-type fields.
 */
function normalizeUrlFieldValue(existing, newUrl) {
  const items = [];
  if (Array.isArray(existing)) {
    for (const item of existing) {
      const link = typeof item?.link === 'string' ? item.link : '';
      const text = typeof item?.text === 'string' ? item.text : link;
      if (link) items.push({ text, link });
    }
  } else if (typeof existing === 'string' && existing.trim()) {
    for (const line of existing.split(/[\n\r]+/)) {
      const trimmed = line.trim();
      if (trimmed && /^https?:\/\//i.test(trimmed))
        items.push({ text: trimmed, link: trimmed });
    }
  }
  if (newUrl) items.push({ text: newUrl, link: newUrl });
  return items;
}

/**
 * Defensive wrapper: try [{text,link}] array first; on TextFieldConvFail (1254060),
 * retry with plain-string format for those fields.
 */
async function safeUpdateBitableRecord(client, appToken, tableId, recordId, fields) {
  try {
    await client.updateBitableRecord(appToken, tableId, recordId, fields);
  } catch (err) {
    if (err.message.includes('TextFieldConvFail') || err.message.includes('1254060')) {
      const fallback = {};
      for (const [key, val] of Object.entries(fields)) {
        if (Array.isArray(val) && val[0]?.link) {
          fallback[key] = val.map(i => i.link || i.text || '').filter(Boolean).join('\n');
        } else if (Array.isArray(val) && val.length === 0) {
          fallback[key] = '';  // Empty array → empty string for text fields
        } else {
          fallback[key] = val;
        }
      }
      await client.updateBitableRecord(appToken, tableId, recordId, fallback);
    } else throw err;
  }
}
```

**Key rule**: When updating a record that has URL fields, you MUST re-send all existing URL field values — Bitable **clears omitted fields** during PUT updates:

```javascript
function preserveUrlFields(recordFields, urlFieldNames) {
  const preserved = {};
  for (const field of urlFieldNames) {
    const val = recordFields[field];
    if (val !== undefined && val !== null)
      preserved[field] = Array.isArray(val) ? normalizeUrlFieldValue(val) : val;
  }
  return preserved;
}

// Usage: always spread preserveUrlFields into the update payload
await safeUpdateBitableRecord(client, appToken, tableId, recordId, {
  ...preserveUrlFields(record.fields),
  'Level': 'P1 Beginner',
});
```

### SingleSelect Labels Must Be Exact

When writing to SingleSelect fields (type 3), the value must **exactly match** an option defined in the table. Use long-form labels, not abbreviations:

```javascript
// Example: your table's SingleSelect options
const STAGE_SELECT_LABELS = {
  P1: 'P1 Beginner',       // must match the option text in Bitable exactly
  P2: 'P2 Intermediate',
  P3: 'P3 Advanced',
  P4: 'P4 Expert',
};
```

### Multi-Department Sub-Table Architecture

Pattern for managing N independent Bitable tables (one per department) with a central "main table" (总表):

```
Sub-table (子表) × N ──sync──→ Main table (总表)
    ↑                                ↓
  writeback                     frontend reads
    ↑                                ↓
  Website submit ────────→ Sub-table FIRST, then main table (fire-and-forget)
```

- **Sub-tables are the Single Source of Truth (SSOT)** — never modify main table directly
- **Reconcile pattern**: compare main table against all sub-tables; members in sub-tables but missing from main are added as stubs
- **Cross-department duplicate names**: use `name::department` as composite Map key, not just name — same Chinese name in two departments is common (e.g., 张伟 in both Sales and Engineering)

```javascript
// Two-layer matching for cross-department safety
const byNameDept = new Map();  // Primary: "张伟::Sales"
const byName = new Map();      // Fallback: "张伟" (first occurrence)
for (const d of deliverables) {
  if (d.department) byNameDept.set(`${d.chineseName}::${d.department}`, d);
  if (!byName.has(d.chineseName)) byName.set(d.chineseName, d);
}
// Match: try exact first, then fallback
const match = (member.department
  ? byNameDept.get(`${member.chineseName}::${member.department}`)
  : null) ?? byName.get(member.chineseName);
```

### Field Name Fallback Pattern

Different Bitable tables may use different column names for the same logical field. Always try multiple names:

```javascript
const chineseName = toStringValue(
  fields['姓名'] ?? fields['中文名'] ?? fields['chineseName'] ?? fields['ChineseName']
);
const stage = toStringValue(
  fields['当前阶段'] ?? fields['当前等级'] ?? fields['阶段'] ?? fields['等级'] ??
  fields['currentStage'] ?? fields['stage'] ?? fields['Stage']
);
```

### Rate Limiting with Token Bucket + Adaptive Throttler

For production services making continuous Bitable API calls, a simple `setTimeout` is insufficient. Use a token bucket with adaptive throttling:

```javascript
class TokenBucket {
  constructor(config) { this.tokens = config.maxTokens; this.lastRefill = Date.now(); }
  async acquire() { /* refill tokens based on elapsed time, queue if empty */ }
}
class AdaptiveThrottler {
  recordSuccess() { this.consecutiveErrors = 0; }
  recordError() { this.consecutiveErrors++; }
  getExtraDelay() { return Math.min(this.consecutiveErrors * 500, 5000); }
}
// Combine: acquire token → apply extra delay if recent errors → execute
```

### Credential Resolution Chain

For server-side services, support multiple credential sources with fallback:

```
1. Explicit config (POST /api/feishu/config) — highest priority
2. Environment variables (FEISHU_APP_ID / FEISHU_APP_SECRET) — for Docker/CI
3. ~/.feishu2md/config.json — local dev fallback
```

### `includes('正式')` Pitfall

Chinese substring matching with `.includes()` is treacherous:
- `'非正式'.includes('正式')` → `true` (matches substring!)
- Fix: use `=== '正式员工'` exact match, or add exclusion: `includes('正式') && !includes('非正式')`

## Design Patterns

### Knowledge Base Directory Structure

Organize wiki content in numbered top-level folders for easy navigation:

```
00 Department submission portal (by department)         ← department dimension
01-05 Methodology and standards (by maturity level)     ← stage dimension
06 Practice zone (framework-specific, e.g. VAF)         ← technology dimension
07 Case studies (by scenario: greenfield/legacy/prototype/tooling/sharing) ← scenario dimension
08 FAQ
09 Training and meetings
10 Weekly reports
11 Glossary / terminology
Summary Bitable (consolidated tracking across all departments)
```

**Avoid dimension overlap**: 00 = by department, 07 = by scenario. Same document can exist in multiple places (use link documents if shortcuts are unavailable).

### Department Tracking Table (Human-Machine Shared)

Each department gets a Bitable tracking table where humans and automation coexist:

- **Human-owned fields**: Name, weekly progress notes, blockers
- **Machine-owned fields**: Achievement status, deliverable links, counts
- **Machine-write + human-override fields**: Current level, activity rating
- **System fields**: Update source (manual/auto), auto-detection timestamp, discrepancy flag

Machine writes use field-level PATCH (never overwrites the entire row). When machine-detected values differ from human input, the discrepancy is flagged — not overwritten — awaiting human confirmation.

### Wiki Restructuring Pattern

Move nodes between parents: `POST /wiki/v2/spaces/{space}/nodes/{node}/move` with `{ target_parent_token }`. This preserves all content and images. Update parent documents with new child links after moving. Wiki shortcuts (`node_type: 'shortcut'`) may not work in all spaces — create link documents as fallback.

### Bitable Summary/Aggregation Pattern

Create a consolidated table from multiple department tables:
1. Create bitable node at wiki root
2. Add a "Department" single-select field
3. For each dept: read all records → transform → batch_create to summary
4. **Include ALL fields (especially URLs) on first insert** — updating URL fields later requires reading back all records, which is extremely slow due to tiny page sizes

### Data Migration Pattern

Source table → field mapping → target table:
1. Read source records with department/category filter
2. Parse rich text fields (names stored as JSON arrays, deliverables as mention objects)
3. Extract URLs and infer status (has URL → done, has text → in progress, empty → not started)
4. Batch write to target with proper field names — include URL/link fields in the FIRST write
5. Verify record counts match

## Reusable Scripts

See [scripts/wiki-helpers.mjs](scripts/wiki-helpers.mjs) for production-tested helper functions:
- `getTenantToken()` — get app-level token for bitable operations
- `btApi()` — bitable API wrapper with error handling
- `writeBlocks()` — batch block writing with rate limit handling
- `rewriteDoc()` — clear and rewrite document content
- `createNode()` — create wiki node (docx or bitable)
- `parseRichText()` — convert bitable rich text to readable string
- `configureBitableFields()` — add fields to a bitable table
- `searchRecords()` — paginated record search with filter
- `batchCreateRecords()` — batch record creation with rate limiting
- `batchUpdateRecords()` — batch record updates with rate limiting
