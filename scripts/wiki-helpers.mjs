/**
 * Feishu Wiki Manager — Reusable Helper Functions
 *
 * Usage:
 *   import { createWikiManager } from './wiki-helpers.mjs';
 *   const wm = await createWikiManager({
 *     spaceId: 'your-space-id',
 *     appId: 'cli_xxx',
 *     appSecret: 'xxx',
 *     feishuDomain: 'your-company.feishu.cn',
 *     getAccessToken: async () => 'u-xxx', // return a valid user_access_token
 *   });
 *   const node = await wm.createNode(parentToken, 'Title');
 *   await wm.writeBlocks(node.docId, [wm.textBlock(wm.el('Hello'))]);
 */

// --- Text Element Styles ---

export const S = { bold: false, inline_code: false, italic: false, strikethrough: false, underline: false };
export const B = { ...S, bold: true };
export const linkStyle = (url) => ({ ...B, link: { url } });
export const codeStyle = { ...S, inline_code: true };

// --- Element & Block Constructors ---

export const el = (text, style = S) => ({ text_run: { content: text, text_element_style: style } });

export const textBlock    = (...elements) => ({ block_type: 2, text: { elements } });
export const h2Block      = (...elements) => ({ block_type: 4, heading2: { elements } });
export const h3Block      = (...elements) => ({ block_type: 5, heading3: { elements } });
export const bulletBlock  = (...elements) => ({ block_type: 12, bullet: { elements } });
export const orderedBlock = (...elements) => ({ block_type: 13, ordered: { elements } });
export const codeBlock    = (lang, code) => ({
  block_type: 14,
  code: {
    style: { language: lang === 'markdown' ? 12 : lang === 'yaml' ? 26 : lang === 'javascript' ? 18 : 0 },
    elements: [el(code)]
  }
});

// --- Rich Text Parsing ---

export function parseRichText(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  if (!Array.isArray(field)) return String(field);
  return field.map(item => {
    if (item.link) return `${item.text || 'Link'}: ${item.link}`;
    return item.text?.trim() || '';
  }).filter(Boolean).join('\n');
}

export function parseTextField(field) {
  if (Array.isArray(field)) return field[0]?.text || '';
  return field || '';
}

export function extractUrl(text) {
  if (!text) return null;
  const m = String(text).match(/https?:\/\/[^\s)>\]]+/);
  return m ? m[0] : null;
}

// --- Wiki Manager Factory ---

/**
 * @param {object} opts
 * @param {string} opts.spaceId - Wiki space ID
 * @param {string} opts.appId - Feishu app ID
 * @param {string} opts.appSecret - Feishu app secret
 * @param {string} [opts.feishuDomain='open.feishu.cn'] - API domain
 * @param {() => Promise<string>} opts.getAccessToken - Returns a valid user_access_token
 */
export async function createWikiManager(opts) {
  const { spaceId, appId, appSecret, feishuDomain = 'open.feishu.cn', getAccessToken } = opts;
  const BASE = `https://${feishuDomain}/open-apis`;

  async function userRequest(method, path, data, params) {
    const token = await getAccessToken();
    const url = new URL(`${BASE}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const fetchOpts = { method, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' } };
    if (data) fetchOpts.body = JSON.stringify(data);
    const r = await (await fetch(url, fetchOpts)).json();
    if (r.code !== 0) throw new Error(`API ${path}: ${r.code} ${(r.msg || '').substring(0, 120)}`);
    return r.data;
  }

  async function getTenantToken() {
    const r = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret })
    });
    return (await r.json()).tenant_access_token;
  }

  async function btApi(method, path, body) {
    const T = await getTenantToken();
    const fetchOpts = { method, headers: { 'Authorization': `Bearer ${T}` } };
    if (body) { fetchOpts.headers['Content-Type'] = 'application/json'; fetchOpts.body = JSON.stringify(body); }
    const r = await (await fetch(`${BASE}${path}`, fetchOpts)).json();
    if (r.code !== 0) throw new Error(`API ${path}: ${r.code} ${(r.msg || '').substring(0, 120)}`);
    return r.data;
  }

  // --- Wiki node operations ---

  async function createNode(parentToken, title, objType = 'docx') {
    const resp = await userRequest('POST', `/wiki/v2/spaces/${spaceId}/nodes`, {
      obj_type: objType, parent_node_token: parentToken, node_type: 'origin', title
    });
    return { nodeToken: resp.node.node_token, docId: resp.node.obj_token };
  }

  async function listChildren(parentToken) {
    const resp = await userRequest('GET', `/wiki/v2/spaces/${spaceId}/nodes`, null,
      { parent_node_token: parentToken, page_size: 50 });
    return resp.items || [];
  }

  // --- Document block operations ---

  async function getBlocks(docId) {
    return userRequest('GET', `/docx/v1/documents/${docId}/blocks`, null, { page_size: 500 });
  }

  async function writeBlocks(docId, blocks) {
    for (let i = 0; i < blocks.length; i += 15) {
      if (i > 0) await new Promise(r => setTimeout(r, 1500));
      await userRequest('POST',
        `/docx/v1/documents/${docId}/blocks/${docId}/children`,
        { children: blocks.slice(i, i + 15), index: i },
        { document_revision_id: -1 });
    }
  }

  async function rewriteDoc(docId, blocks) {
    const resp = await getBlocks(docId);
    const root = (resp.items || []).find(b => b.block_id === docId);
    const cc = root?.children?.length || 0;
    if (cc > 0) {
      await userRequest('DELETE',
        `/docx/v1/documents/${docId}/blocks/${docId}/children/batch_delete`,
        { start_index: 0, end_index: cc },
        { document_revision_id: -1 });
    }
    await writeBlocks(docId, blocks);
  }

  async function renameDoc(docId, newTitle) {
    await userRequest('PATCH',
      `/docx/v1/documents/${docId}/blocks/${docId}`,
      { update_text_elements: { elements: [{ text_run: { content: newTitle } }] } },
      { document_revision_id: -1 });
  }

  // --- Bitable operations (use tenant token) ---

  async function getTableId(appToken) {
    const data = await btApi('GET', `/bitable/v1/apps/${appToken}/tables`);
    return data.items?.[0]?.table_id;
  }

  async function configureBitableFields(appToken, fields) {
    const tableId = await getTableId(appToken);
    const existing = await btApi('GET', `/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`);
    const existingNames = new Set((existing.items || []).map(f => f.field_name));
    let created = 0;
    for (const f of fields) {
      if (!existingNames.has(f.field_name)) {
        await btApi('POST', `/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, f);
        created++;
      }
    }
    return created;
  }

  async function searchRecords(appToken, tableId, filter, pageSize = 200) {
    let all = [], pt = '';
    while (true) {
      const body = { page_size: pageSize };
      if (filter) body.filter = filter;
      if (pt) body.page_token = pt;
      const data = await btApi('POST', `/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`, body);
      all.push(...(data.items || []));
      if (!data.has_more) break;
      pt = data.page_token;
    }
    return all;
  }

  async function batchCreateRecords(appToken, tableId, records) {
    let written = 0;
    for (let i = 0; i < records.length; i += 10) {
      const batch = records.slice(i, i + 10).map(r => ({ fields: r }));
      await btApi('POST', `/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`, { records: batch });
      written += batch.length;
      if (i + 10 < records.length) await new Promise(r => setTimeout(r, 300));
    }
    return written;
  }

  async function batchUpdateRecords(appToken, tableId, updates) {
    let updated = 0;
    for (let i = 0; i < updates.length; i += 10) {
      const batch = updates.slice(i, i + 10);
      await btApi('POST', `/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_update`, { records: batch });
      updated += batch.length;
      if (i + 10 < updates.length) await new Promise(r => setTimeout(r, 300));
    }
    return updated;
  }

  // --- IM Image & File operations (use tenant token) ---

  async function uploadChatImage(filePath) {
    const T = await getTenantToken();
    const { default: FormData } = await import('form-data');
    const { createReadStream } = await import('fs');
    const form = new FormData();
    form.append('image_type', 'message');
    form.append('image', createReadStream(filePath));
    const r = await fetch(`${BASE}/im/v1/images`, {
      method: 'POST',
      headers: { ...form.getHeaders(), Authorization: `Bearer ${T}` },
      body: form
    });
    const data = await r.json();
    if (data.code !== 0) throw new Error(`Upload chat image: ${data.code} ${data.msg}`);
    return data.data.image_key;
  }

  async function sendImageMessage(receiveId, imageKey, receiveIdType = 'open_id') {
    const T = await getTenantToken();
    const r = await fetch(`${BASE}/im/v1/messages?receive_id_type=${receiveIdType}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ receive_id: receiveId, msg_type: 'image', content: JSON.stringify({ image_key: imageKey }) })
    });
    const data = await r.json();
    if (data.code !== 0) throw new Error(`Send image: ${data.code} ${data.msg}`);
    return data.data;
  }

  async function sendImageFile(receiveId, filePath, receiveIdType = 'open_id') {
    const imageKey = await uploadChatImage(filePath);
    return sendImageMessage(receiveId, imageKey, receiveIdType);
  }

  async function replyWithImage(messageId, imageKey) {
    const T = await getTenantToken();
    const r = await fetch(`${BASE}/im/v1/messages/${messageId}/reply`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'image', content: JSON.stringify({ image_key: imageKey }) })
    });
    const data = await r.json();
    if (data.code !== 0) throw new Error(`Reply image: ${data.code} ${data.msg}`);
    return data.data;
  }

  async function uploadChatFile(filePath, fileName) {
    const T = await getTenantToken();
    const { default: FormData } = await import('form-data');
    const { createReadStream } = await import('fs');
    const form = new FormData();
    form.append('file_type', 'stream');
    form.append('file_name', fileName || filePath.split('/').pop());
    form.append('file', createReadStream(filePath));
    const r = await fetch(`${BASE}/im/v1/files`, {
      method: 'POST',
      headers: { ...form.getHeaders(), Authorization: `Bearer ${T}` },
      body: form
    });
    const data = await r.json();
    if (data.code !== 0) throw new Error(`Upload chat file: ${data.code} ${data.msg}`);
    return data.data.file_key;
  }

  async function sendFileMessage(receiveId, fileKey, receiveIdType = 'open_id') {
    const T = await getTenantToken();
    const r = await fetch(`${BASE}/im/v1/messages?receive_id_type=${receiveIdType}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ receive_id: receiveId, msg_type: 'file', content: JSON.stringify({ file_key: fileKey }) })
    });
    const data = await r.json();
    if (data.code !== 0) throw new Error(`Send file: ${data.code} ${data.msg}`);
    return data.data;
  }

  return {
    spaceId,
    // Wiki
    createNode, listChildren,
    // Document
    getBlocks, writeBlocks, rewriteDoc, renameDoc,
    // Bitable
    btApi, getTableId, configureBitableFields,
    searchRecords, batchCreateRecords, batchUpdateRecords,
    // IM Images & Files
    uploadChatImage, sendImageMessage, sendImageFile,
    replyWithImage, uploadChatFile, sendFileMessage,
    // Block constructors
    el, textBlock, h2Block, h3Block, bulletBlock, orderedBlock, codeBlock,
    // Styles
    S, B, linkStyle, codeStyle,
    // Parsers
    parseRichText, parseTextField, extractUrl,
  };
}
