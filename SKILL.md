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

## Critical Pitfalls (Learned from Production)

### API Errors

| Error Code | Meaning | Solution |
|-----------|---------|----------|
| 1770001 | Invalid param | Check block_type numbers; bullet=12 not 11 |
| 1770024 | Too many writes | Add 1.5-3s delay between batches; reduce batch size to 10-15 |
| 99991679 | Permission denied | For bitable: use tenant_access_token instead of user token |
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

### Rate Limits

- Document block writes: max ~30 blocks before hitting 1770024
- Solution: batch 15 blocks at a time, 1.5s delay between batches
- For large documents (50+ blocks): write in 3-4 batches with 3s delays
- After deleting + rewriting a document, wait 10-15s before the next write operation on the same doc
- Bitable record writes: 10 per batch, 300ms delay is sufficient

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

## Design Patterns

### Knowledge Base Directory Structure

Organize wiki content in numbered top-level folders for easy navigation:

```
00 Department submission portal (low-friction input)
01-05 Methodology and standards (by maturity level)
06 Practice zone (hands-on records)
07 Case studies and experience sharing
08 FAQ
09 Training and meetings
10 Weekly reports
11 Glossary / terminology
```

### Department Tracking Table (Human-Machine Shared)

Each department gets a Bitable tracking table where humans and automation coexist:

- **Human-owned fields**: Name, weekly progress notes, blockers
- **Machine-owned fields**: Achievement status, deliverable links, counts
- **Machine-write + human-override fields**: Current level, activity rating
- **System fields**: Update source (manual/auto), auto-detection timestamp, discrepancy flag

Machine writes use field-level PATCH (never overwrites the entire row). When machine-detected values differ from human input, the discrepancy is flagged — not overwritten — awaiting human confirmation.

### Data Migration Pattern

Source table → field mapping → target table:
1. Read source records with department/category filter
2. Parse rich text fields (names stored as JSON arrays, deliverables as mention objects)
3. Extract URLs and infer status (has URL → done, has text → in progress, empty → not started)
4. Batch write to target with proper field names
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
