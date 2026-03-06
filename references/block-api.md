# Feishu Docx Block API Reference

## Block Types

| block_type | Field Name | Description | Notes |
|-----------|------------|-------------|-------|
| 1 | page | Page (root block) | Document ID = block ID; title in page.elements |
| 2 | text | Text paragraph | Most common block type |
| 3 | heading1 | Heading 1 | |
| 4 | heading2 | Heading 2 | |
| 5 | heading3 | Heading 3 | |
| 6 | heading4 | Heading 4 | |
| 7 | heading5 | Heading 5 | |
| 8 | heading6 | Heading 6 | |
| 9 | heading7 | Heading 7 | |
| 10 | heading8 | Heading 8 | |
| 11 | heading9 | Heading 9 | CAUTION: NOT bullet list! |
| 12 | bullet | Bullet list item | Common mistake: using 11 |
| 13 | ordered | Ordered list item | |
| 14 | code | Code block | style.language: 0=plain, 12=markdown, 26=yaml |
| 15 | quote | Quote block | |
| 16 | todo | Todo/checkbox | style.done: true/false |
| 17 | divider | Divider line | Does NOT work via create API — use empty text block |
| 27 | image | Image | 3-step creation: create empty → upload media → PATCH replace_image |
| 22 | view | Embedded view | |

## Text Element Styles

Every `text_run` must include `text_element_style` with ALL boolean fields:

```json
{
  "text_run": {
    "content": "Hello World",
    "text_element_style": {
      "bold": false,
      "inline_code": false,
      "italic": false,
      "strikethrough": false,
      "underline": false
    }
  }
}
```

For links, add `link` to the style:

```json
{
  "text_element_style": {
    "bold": true,
    "inline_code": false,
    "italic": false,
    "strikethrough": false,
    "underline": false,
    "link": { "url": "https://mi.feishu.cn/wiki/xxxxx" }
  }
}
```

## Block Construction Helpers

```javascript
const S = { bold: false, inline_code: false, italic: false, strikethrough: false, underline: false };
const B = { ...S, bold: true };
const linkStyle = (url) => ({ ...B, link: { url } });
const codeStyle = { ...S, inline_code: true };

const el = (text, style = S) => ({ text_run: { content: text, text_element_style: style } });

const textBlock  = (...els) => ({ block_type: 2, text: { elements: els } });
const h2Block    = (...els) => ({ block_type: 4, heading2: { elements: els } });
const h3Block    = (...els) => ({ block_type: 5, heading3: { elements: els } });
const bulletBlock = (...els) => ({ block_type: 12, bullet: { elements: els } });
const orderedBlock = (...els) => ({ block_type: 13, ordered: { elements: els } });
const codeBlock  = (lang, code) => ({
  block_type: 14,
  code: {
    style: { language: lang === 'markdown' ? 12 : lang === 'yaml' ? 26 : 0 },
    elements: [el(code)]
  }
});
```

## API Endpoints

### Create children blocks

```
POST /docx/v1/documents/{doc_id}/blocks/{block_id}/children
Query: document_revision_id=-1
Body: { children: [...blocks], index: 0 }
```

Batch limit: 15-20 blocks per call. Wait 1.5-3s between calls to avoid error 1770024.

### Delete children blocks

```
DELETE /docx/v1/documents/{doc_id}/blocks/{block_id}/children/batch_delete
Query: document_revision_id=-1
Body: { start_index: 0, end_index: N }
```

### Update page title

```
PATCH /docx/v1/documents/{doc_id}/blocks/{doc_id}
Query: document_revision_id=-1
Body: { update_text_elements: { elements: [{ text_run: { content: "New Title" } }] } }
```

### Read blocks

```
GET /docx/v1/documents/{doc_id}/blocks
Query: page_size=500
```

Returns paginated. Root block (block_type=1) has same ID as document.

## Image Operations

### Download image (direct — preferred)

```
GET /drive/v1/medias/{file_token}/download
Auth: tenant_access_token or user_access_token
Response: binary stream (arraybuffer)
Rate limit: 5 QPS
```

### Upload image to document

```
POST /drive/v1/medias/upload_all
Content-Type: multipart/form-data
Fields:
  file_name: "image.png"
  parent_type: "docx_image"        # for new docs; "doc_image" for old docs
  parent_node: "{image_block_id}"  # MUST be the image block ID, NOT the document ID
  size: "12345"
  file: <binary>
Rate limit: 5 QPS, max 20MB per file
```

### Update image block token

```
PATCH /docx/v1/documents/{doc_id}/blocks/{image_block_id}
Query: document_revision_id=-1
Body: { "replace_image": { "token": "{file_token}" } }
```

### Complete image block creation flow

1. Create empty: `POST .../children` with `{ block_type: 27, image: {} }`
2. Upload: `POST /drive/v1/medias/upload_all` with `parent_node = imageBlockId`
3. Bind: `PATCH .../blocks/{imageBlockId}` with `{ replace_image: { token } }`

**Why 3 steps?** `{ block_type: 27, image: { token: "xxx" } }` returns error 1770001. Tokens can only be set via PATCH after creation.
