# Feishu Bitable API Reference

## Authentication

**Always use tenant_access_token for Bitable operations.**

User tokens obtained via OAuth often lack bitable scopes even when the app has `base:table:*` permissions configured. The tenant token works reliably.

```javascript
async function getTenantToken(config) {
  const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret })
  });
  return (await r.json()).tenant_access_token;
}
```

## Field Types

| type | Name | Create Example | Notes |
|------|------|---------------|-------|
| 1 | Text | `{ field_name: 'Name', type: 1 }` | Stores as rich text array internally |
| 2 | Number | `{ field_name: 'Count', type: 2 }` | |
| 3 | Single Select | `{ field_name: 'Status', type: 3, property: { options: [{ name: 'A' }, { name: 'B' }] } }` | |
| 4 | Multi Select | Same as 3 but allows multiple | |
| 5 | Date | `{ field_name: 'Date', type: 5 }` | Value: Unix timestamp in ms |
| 7 | Checkbox | `{ field_name: 'Done', type: 7 }` | Value: true/false |
| 11 | Person | `{ field_name: 'Owner', type: 11 }` | |
| 13 | Phone | | |
| 15 | URL | `{ field_name: 'Link', type: 15 }` | Value: `{ link: 'url', text: 'display' }` |
| 17 | Attachment | `{ field_name: 'Files', type: 17 }` | |
| 18 | Link (relation) | | Links to another table |
| 20 | Formula | | Read-only computed |
| 22 | Created Time | | Auto-populated |
| 23 | Modified Time | | Auto-populated |

## Record Value Formats

### Text fields (type 1)
Written as plain string, returned as rich text array:
```javascript
// Write
{ 'Name': '张三' }

// Read
{ 'Name': [{ "text": "张三", "type": "text" }] }

// Parse helper
function parseTextField(field) {
  if (Array.isArray(field)) return field[0]?.text || '';
  return field || '';
}
```

### Single Select (type 3)
```javascript
// Write - just the option name string
{ 'Status': '已完成' }

// Read
{ 'Status': '已完成' }
```

### URL (type 15)
```javascript
// Write — MUST use array format (not bare object!)
{ 'Link': [{ link: 'https://example.com', text: 'Example' }] }

// Read
{ 'Link': { link: 'https://example.com', text: 'Example' } }
// or (multi-value):
{ 'Link': [{ link: 'https://a.com', text: 'A' }, { link: 'https://b.com', text: 'B' }] }
```

**CRITICAL**: Writing a bare `{ link, text }` object works, but writing a plain string to a URL field
causes `URLFieldConvFail` (error 1254068). Always use `[{text, link}]` array format for URL writes.

Conversely, writing `[{text, link}]` array to a **Text** field causes `TextFieldConvFail` (error 1254060).
Since you may not know the field type in advance, use the `safeUpdateBitableRecord` pattern (see main SKILL.md).

### Date (type 5)
```javascript
// Write - Unix timestamp in milliseconds
{ 'Date': 1709654400000 }  // or Date.now()

// Read
{ 'Date': 1709654400000 }
```

### Checkbox (type 7)
```javascript
{ 'Done': true }
```

## API Endpoints

### List tables
```
GET /bitable/v1/apps/{app_token}/tables
```

### List fields
```
GET /bitable/v1/apps/{app_token}/tables/{table_id}/fields?page_size=100
```

### Create field
```
POST /bitable/v1/apps/{app_token}/tables/{table_id}/fields
Body: { field_name: 'Name', type: 1 }
```

### Delete field
```
DELETE /bitable/v1/apps/{app_token}/tables/{table_id}/fields/{field_id}
```
Note: primary field (first text column) cannot be deleted.

### Search records (with filter)
```
POST /bitable/v1/apps/{app_token}/tables/{table_id}/records/search
Body: {
  page_size: 200,
  filter: {
    conjunction: 'and',
    conditions: [{
      field_name: 'Department',
      operator: 'is',       // is, isNot, contains, isEmpty, isNotEmpty
      value: ['Sales']       // array of values
    }]
  }
}
```

Pagination: check `has_more` and pass `page_token` in next request body.

### Batch create records
```
POST /bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_create
Body: { records: [{ fields: { 'Name': 'A' } }, { fields: { 'Name': 'B' } }] }
```
Max **10** records per batch (larger batches cause intermittent failures). Add 300ms delay between batches.

### Batch update records
```
POST /bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_update
Body: { records: [{ record_id: 'recXxx', fields: { 'Status': 'Done' } }] }
```
Max 10 records per batch.

### Single record update (PUT)
```
PUT /bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}
Body: { fields: { 'Status': 'Done', '当前等级': 'P1 Demo实战' } }
```
**WARNING**: Omitted fields may be cleared. Always re-send existing URL field values (see `preserveUrlFields` pattern in main SKILL.md).

### Batch delete records
```
POST /bitable/v1/apps/{app_token}/tables/{table_id}/records/batch_delete
Body: { records: ['recXxx', 'recYyy'] }
```
Max 500 record IDs per call.

### Single record create
```
POST /bitable/v1/apps/{app_token}/tables/{table_id}/records
Body: { fields: { 'Name': 'A', 'Status': 'Todo' } }
```

## Rich Text Parsing (Deliverables)

Source bitable fields with mentions/links store content as JSON arrays:

```json
[
  {"link": "https://mi.feishu.cn/wiki/xxx", "mentionType": "Wiki", "text": "Doc Title", "type": "mention"},
  {"text": " ", "type": "text"}
]
```

Parse into readable format:

```javascript
function parseRichText(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  if (!Array.isArray(field)) return String(field);
  return field.map(item => {
    if (item.link) return `${item.text || 'Link'}: ${item.link}`;
    return item.text?.trim() || '';
  }).filter(Boolean).join('\n');
}
```

## Wrapper Function

```javascript
async function btApi(tenantToken, method, path, body) {
  const opts = { method, headers: { 'Authorization': `Bearer ${tenantToken}` } };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await (await fetch(`https://open.feishu.cn/open-apis${path}`, opts)).json();
  if (r.code !== 0) {
    throw new Error(`API ${path}: ${r.code} ${(r.msg || '').substring(0, 120)}`);
  }
  return r.data;
}
```
