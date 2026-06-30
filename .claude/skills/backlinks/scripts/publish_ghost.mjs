#!/usr/bin/env node
// Publish drafted TCBlogs press releases to Ghost via the Admin API.
//
// Usage:
//   GHOST_KEY="id:secret" node publish_ghost.mjs posts.json
//
// posts.json: [{ "client": "...", "postId": "<ghost post id>",
//                "month": "Jun 2026", "notion": "<notion page id>" }, ...]
//   - postId is the last path segment of the Ghost editor link found in the
//     Notion "{Month} Link" column.
//   - month / notion / client are passed through to stdout so the caller can
//     update the Notion control sheet afterwards.
//
// Env:
//   GHOST_KEY  (required)  Ghost Admin API key, form "id:secret"
//   GHOST_URL  (optional)  defaults to https://tcblogs.ghost.io
//   ONLY       (optional)  comma-separated client names to restrict to
//
// Output: JSON array on stdout, one entry per post, with status one of
//   published | already-published | ERROR, plus the live url (or error message).

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const GHOST_URL = (process.env.GHOST_URL || 'https://tcblogs.ghost.io').replace(/\/+$/, '');
const GHOST_KEY = process.env.GHOST_KEY || '';
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);

const file = process.argv[2];
if (!file) {
  console.error('Usage: GHOST_KEY="id:secret" node publish_ghost.mjs posts.json');
  process.exit(2);
}
if (!GHOST_KEY) {
  console.error('GHOST_KEY env var is required (Ghost Admin API key, form id:secret).');
  process.exit(2);
}

let posts;
try {
  posts = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(posts)) throw new Error('top level must be an array');
} catch (e) {
  console.error(`Could not read ${file}: ${e.message}`);
  process.exit(2);
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Short-lived HS256 JWT for the Ghost Admin API from an "id:secret" key.
function ghostJWT(key) {
  const [id, secretHex] = (key || '').split(':');
  if (!id || !secretHex) throw new Error('Admin API key must be in the form id:secret');
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id }));
  const body = b64url(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' }));
  const data = `${head}.${body}`;
  const sig = crypto.createHmac('sha256', Buffer.from(secretHex, 'hex')).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

async function ghost(path, method, token, body) {
  const res = await fetch(`${GHOST_URL}/ghost/api/admin${path}`, {
    method,
    headers: {
      Authorization: `Ghost ${token}`,
      'Content-Type': 'application/json',
      'Accept-Version': 'v5.0',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = json?.errors?.[0];
    const ctx = err?.context ? ` (${err.context})` : '';
    throw new Error((err?.message || `HTTP ${res.status}`) + ctx);
  }
  return json;
}

const results = [];
for (const p of posts) {
  if (ONLY.length && !ONLY.includes(p.client)) continue;
  const base = { client: p.client, notion: p.notion, month: p.month, postId: p.postId };
  try {
    if (!p.postId) throw new Error('missing postId');
    const token = ghostJWT(GHOST_KEY);
    const cur = (await ghost(`/posts/${p.postId}/`, 'GET', token)).posts[0];
    if (cur.status === 'published') {
      results.push({ ...base, status: 'already-published', url: cur.url, title: cur.title });
      continue;
    }
    const upd = (await ghost(`/posts/${p.postId}/`, 'PUT', token, {
      posts: [{ updated_at: cur.updated_at, status: 'published' }],
    })).posts[0];
    results.push({ ...base, status: 'published', url: upd.url, title: upd.title });
  } catch (e) {
    results.push({ ...base, status: 'ERROR', error: e.message });
  }
}

console.log(JSON.stringify(results, null, 2));
