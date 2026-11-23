// The curator: gathers raw work (GitHub, Notion roadmap, your Claude Code sessions) for free,
// then makes ONE lean Claude call (no tools, no MCP, short system prompt) that turns it into feed cards.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

// ---------- Notion (REST API, needs NOTION_TOKEN) ----------
const NV = '2025-09-03';
async function notion(token, method, url, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch('https://api.notion.com/v1/' + url, { method, headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NV, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    if (r.status === 429) { await new Promise(s => setTimeout(s, 1000 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`Notion ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  throw new Error('Notion rate limit');
}
function plain(rt) { return (rt || []).map(t => t.plain_text).join(''); }
function propText(v) {
  switch (v.type) {
    case 'title': return plain(v.title);
    case 'rich_text': return plain(v.rich_text);
    case 'status': return v.status?.name;
    case 'select': return v.select?.name;
    case 'multi_select': return v.multi_select?.map(s => s.name).join(', ');
    case 'people': return v.people?.map(p => p.name).filter(Boolean).join(', ');
    case 'date': return v.date?.start;
    case 'url': return v.url;
    case 'checkbox': return v.checkbox ? 'yes' : '';
    case 'number': return v.number;
    default: return '';
  }
}
async function pageText(token, id, limit) {
  const out = []; let cursor;
  do {
    const r = await notion(token, 'GET', `blocks/${id}/children?page_size=100${cursor ? '&start_cursor=' + cursor : ''}`);
    for (const b of r.results) {
      const rt = b[b.type]?.rich_text; if (!rt) continue;
      const t = plain(rt).trim(); if (!t) continue;
      out.push(b.type.startsWith('heading') ? `## ${t}` : b.type === 'to_do' ? `[${b.to_do.checked ? 'x' : ' '}] ${t}` : t);
    }
    cursor = r.has_more && out.join('\n').length < limit ? r.next_cursor : null;
  } while (cursor);
  const s = out.join('\n');
  // the newest dated notes usually sit at the bottom of a roadmap page: keep head and tail
  return s.length <= limit ? s : s.slice(0, limit * 0.45) + '\n…\n' + s.slice(-limit * 0.55);
}
export async function readNotion({ token, dataSource, cache, textLimit = 900 }) {
  const rows = []; let cursor;
  do {
    const r = await notion(token, 'POST', `data_sources/${dataSource}/query`, { page_size: 100, start_cursor: cursor, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] });
    rows.push(...r.results); cursor = r.has_more ? r.next_cursor : null;
  } while (cursor && rows.length < 300);
  const open = rows.map(p => {
    const props = {}; let title = 'Untitled';
    for (const [k, v] of Object.entries(p.properties || {})) { const t = propText(v); if (v.type === 'title') title = t || title; else if (t) props[k] = t; }
    return { id: p.id, title, url: p.url, edited: p.last_edited_time, props };
  }).filter(r => !/^(shipped|archived|done)$/i.test(r.props.Status || ''));
  // page bodies: refetch only what changed since last time
  const queue = [...open];
  await Promise.all([0, 1, 2].map(async () => {
    for (let r; (r = queue.shift());) {
      const c = cache[r.id];
      if (c && c.edited === r.edited) { r.text = c.text; continue; }
      r.text = await pageText(token, r.id, textLimit).catch(() => '');
      cache[r.id] = { edited: r.edited, text: r.text };
    }
  }));
  return open;
}

// ---------- Claude Code sessions (transcripts on disk) ----------
function tail(file, bytes) {
  const fd = fs.openSync(file, 'r'); const size = fs.fstatSync(fd).size; const len = Math.min(bytes, size);
  const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd);
  return buf.toString('utf8').split('\n').slice(size > len ? 1 : 0);
}
function textOf(content) {
  if (typeof content === 'string') return content;
  return (content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
}
export function readSessions({ hours = 48, max = 25, exclude = new Set(), excludeCwd = [] }) {
  const root = path.join(os.homedir(), '.claude', 'projects');
  const since = Date.now() - hours * 36e5; const files = [];
  for (const d of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const dir = path.join(root, d); let ents; try { ents = fs.readdirSync(dir); } catch { continue; }
    for (const f of ents) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(dir, f); const st = fs.statSync(p);
      if (st.mtimeMs > since && !exclude.has(f.slice(0, -6))) files.push({ p, m: st.mtimeMs });
    }
  }
  files.sort((a, b) => b.m - a.m);
  const out = [];
  for (const { p, m } of files) {
    if (out.length >= max) break;
    let title = '', cwd = '', branch = '', lastUser = '', lastAssistant = '', lastRole = '', entry = '';
    for (const line of tail(p, 600_000)) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.type === 'custom-title') title = e.customTitle || title;
      else if ((e.type === 'ai-title' || e.type === 'summary') && !title) title = e.aiTitle || e.title || e.summary || '';
      if (e.isSidechain) continue;
      if (e.cwd) cwd = e.cwd; if (e.gitBranch) branch = e.gitBranch; if (e.entrypoint) entry = e.entrypoint;
      if (e.type === 'user' && !e.isMeta) {
        const t = textOf(e.message?.content).trim();
        if (t && !t.startsWith('<') && !t.startsWith('[Request interrupted')) { lastUser = t; lastRole = 'user'; }
      }
      if (e.type === 'assistant') { const t = textOf(e.message?.content).trim(); if (t) { lastAssistant = t; lastRole = 'assistant'; } }
    }
    if (!lastAssistant && !lastUser) continue;
    if (excludeCwd.some(x => cwd.startsWith(x))) continue;
    if (entry === 'sdk-cli' && !title) continue; // one-off scripted runs, not real work sessions
    out.push({ id: path.basename(p, '.jsonl'), title: title || '(untitled)', cwd: cwd.replace(os.homedir(), '~'), branch,
      lastActive: new Date(m).toISOString(), headless: entry === 'sdk-cli',
      waitingOnHuman: lastRole === 'assistant', lastHuman: lastUser.slice(0, 300), lastClaude: lastAssistant.slice(-700) });
  }
  return out;
}

// ---------- the one Claude call ----------
const SYSTEM = `You are the curator of ShipTok, a TikTok-style feed of a founder's work. They scroll it on their phone and act on each card in a tap or two: send an AI agent at it, answer it, or dismiss it.
You get raw data from GitHub, the Notion product roadmap and their recent Claude Code sessions. Turn it into the cards most worth their attention right now.
Rules:
- One card per decision or piece of work. Merge sources about the same thing (a roadmap row, its PR, the Claude session working on it) into ONE card and list every raw id it covers.
- Rank by what is blocked on the human first (a roadmap row whose "Waiting on" names them, a Claude session waiting for an answer, a review someone asked for), then by impact. Rows waiting on someone else are only worth a card if the human should nudge them.
- Write in plain words for a busy founder: a punchy title (max ~10 words), a one-line hook saying why now, and a body of 2–5 short sentences with the concrete facts (numbers, names, PR numbers). No filler, no jargon they'd have to decode.
- Every card gets 2–4 actions. Each action is an instruction an autonomous coding agent can carry out alone, written out in full with the specifics (repo, PR/issue number, roadmap page). Agents never merge, never touch production, and draft rather than post anything public.
- Every card gets a "visual": one graphic that makes it graspable in a glance. A "stat" when one number tells the story (value short, e.g. "2", "€0", "13 files"), a "countdown" when there is a deadline, "options" (2–3, each with a short trade-off) when the human must choose, "flow" (3–5 short steps) for builds and fixes. Keep every text in it under 6 words.
- Skip stale or finished things. 12–25 cards. Output ONLY JSON, no prose, no code fences.`;

const SCHEMA = `{"cards":[{"key":"stable slug from the main source, e.g. gh-owner-repo-123, notion-<page id>, session-<id>",
"title":"","hook":"","body":"","kind":"decide|review|unblock|build|followup|fyi","priority":0-100,"effort":"2 min|15 min|1 h|half day",
"repo":"owner/name or null","links":[{"label":"","url":""}],"covers":["raw ids from the input"],
"session":{"id":"","cwd":""} or null,
"visual":{"type":"stat","value":"","label":"","sub":""} | {"type":"countdown","date":"YYYY-MM-DD","label":""} | {"type":"options","options":[{"label":"","detail":""}]} | {"type":"flow","steps":[""]},
"actions":[{"label":"2–3 words","sub":"what will happen, 3–6 words","instruction":"full agent instruction"}]}]}`;

export async function curate({ cwd, model, context, github, notion, sessions, log }) {
  const input = { now: new Date().toISOString(), about: context || undefined, github, notionRoadmap: notion, claudeSessions: sessions };
  const prompt = `Here is the raw data.\n\n${JSON.stringify(input)}\n\nReturn JSON in exactly this shape:\n${SCHEMA}`;
  fs.mkdirSync(cwd, { recursive: true });
  const sessionId = crypto.randomUUID();
  const args = ['-p', prompt, '--output-format', 'json', '--model', model, '--tools', '', '--strict-mcp-config',
    '--setting-sources', '', '--system-prompt', SYSTEM, '--session-id', sessionId];
  const raw = await new Promise((ok, bad) => {
    const p = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SHIPTOK_AGENT: 'curator' } });
    let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', code => code === 0 ? ok(out) : bad(new Error('curator exited ' + code + ': ' + (err || out).slice(0, 300))));
  });
  let parsed = JSON.parse(raw); parsed = Array.isArray(parsed) ? parsed.find(e => e.type === 'result') : parsed;
  const text = parsed.result || '';
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  log?.(`curated ${json.cards?.length} cards · $${(parsed.total_cost_usd || 0).toFixed(3)} · in ${prompt.length} chars`);
  return { cards: json.cards || [], cost: parsed.total_cost_usd || 0, usage: parsed.usage, sessionId, promptChars: prompt.length };
}

export function inputHash(...parts) { return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex'); }
