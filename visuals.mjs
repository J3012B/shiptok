// Visuals: turns each card's sources into "slides" for the 9:16 frame.
// Screenshots Claude took in your sessions, images in PRs/issues, a live shot of the
// PR's preview build, the diff as a chart, Notion images + checklists, session activity.
// Everything is cached under data/media and keyed by what it was made from.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

export function createVisuals({ dataDir, notionToken, cache, log = () => {} }) {
  const media = path.join(dataDir, 'media'); fs.mkdirSync(media, { recursive: true });
  const chrome = findChrome();
  const put = (buf, ext) => { const f = sha(buf) + '.' + ext; const p = path.join(media, f); if (!fs.existsSync(p)) fs.writeFileSync(p, buf); return '/media/' + f; };
  const memo = async (key, sig, fn) => { const c = cache[key]; if (c && c.sig === sig) return c.v; const v = await fn(); cache[key] = { sig, v, at: Date.now() }; return v; };

  // ---------- Claude Code sessions ----------
  function sessionFile(id) {
    const root = path.join(os.homedir(), '.claude', 'projects');
    for (const d of fs.readdirSync(root)) { const p = path.join(root, d, id + '.jsonl'); if (fs.existsSync(p)) return p; }
  }
  function session(id) {
    const file = sessionFile(id); if (!file) return null;
    const st = fs.statSync(file);
    return memo('s:' + id, st.mtimeMs, async () => {
      const len = Math.min(st.size, 14e6); const buf = Buffer.alloc(len);
      const fd = fs.openSync(file, 'r'); fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd);
      const shots = [], times = [], tools = {};
      for (const line of buf.toString('utf8').split('\n')) {
        if (!line.startsWith('{')) continue;
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.isSidechain) continue;
        if ((e.type === 'user' || e.type === 'assistant') && e.timestamp) times.push(Date.parse(e.timestamp));
        const content = e.message?.content; if (!Array.isArray(content)) continue;
        for (const c of content) {
          if (c.type === 'tool_use') tools[c.name] = (tools[c.name] || 0) + 1;
          const pasted = c.type === 'image';
          const imgs = pasted ? [c] : Array.isArray(c.content) ? c.content.filter(x => x.type === 'image') : [];
          for (const im of imgs) if (im.source?.type === 'base64' && im.source.data?.length > 20000) shots.push({ data: im.source.data, mt: im.source.media_type, at: e.timestamp, by: pasted ? 'user' : 'claude' });
        }
      }
      // keep the last few distinct screenshots
      const seen = new Set(), keep = [];
      for (const s of shots.reverse()) { const h = sha(s.data.slice(0, 4000)); if (seen.has(h)) continue; seen.add(h); keep.push(s); if (keep.length >= 4) break; }
      const images = keep.reverse().map(s => ({ type: 'image', src: put(Buffer.from(s.data, 'base64'), s.mt.includes('png') ? 'png' : 'jpg'), at: s.at,
        label: s.by === 'user' ? 'You pasted this' : 'Claude saw this' }));
      // activity: messages per hour over the last 24 hours, and which tools it used
      const now = Date.now(), buckets = Array(24).fill(0);
      for (const t of times) { const h = Math.floor((now - t) / 36e5); if (h >= 0 && h < 24) buckets[23 - h]++; }
      const top = Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => ({ name: name.replace(/^mcp__[^_]+(__)?/, '').replace(/^.*__/, ''), n }));
      const activity = times.length > 4 ? { type: 'activity', buckets, tools: top, messages: times.length, since: times[0] && new Date(times[0]).toISOString() } : null;
      return { images, activity };
    });
  }

  // ---------- GitHub ----------
  async function ghJson(args) { const { stdout } = await run('gh', args, { maxBuffer: 30e6 }); return JSON.parse(stdout); }
  function github(repo, number, updatedAt) {
    return memo(`gh:${repo}#${number}`, updatedAt || '', async () => {
      const out = { images: [], diff: null, preview: null };
      let issue; try { issue = await ghJson(['api', `repos/${repo}/issues/${number}`, '-H', 'Accept: application/vnd.github.full+json']); } catch { return out; }
      const isPr = !!issue.pull_request;
      let comments = []; try { comments = await ghJson(['api', `repos/${repo}/issues/${number}/comments?per_page=50`, '-H', 'Accept: application/vnd.github.full+json']); } catch {}
      const html = [issue.body_html || '', ...comments.map(c => c.body_html || '')].join('\n');
      // images people put in the description/comments (signed URLs: download now, they expire)
      const srcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'))
        .filter(u => /user-attachments|private-user-images|user-images\.githubusercontent/.test(u) && !/23264\//.test(u));
      for (const u of [...new Set(srcs)].slice(0, 4)) {
        try { const r = await fetch(u); if (!r.ok) continue; const ct = r.headers.get('content-type') || ''; if (!/image\/(png|jpe?g|gif|webp)/.test(ct)) continue;
          out.images.push({ type: 'image', src: put(Buffer.from(await r.arrayBuffer()), ct.split('/')[1].replace('jpeg', 'jpg')), label: `From #${number}` }); } catch {}
      }
      // preview deployment link (Cloudflare Pages / Vercel / Netlify bots)
      const text = [issue.body || '', ...comments.map(c => c.body || '')].join('\n');
      const links = [...text.matchAll(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:pages\.dev|vercel\.app|netlify\.app)\b[^\s)"'<]*/gi)].map(m => m[0]);
      out.preview = links.find(l => !/^https:\/\/[0-9a-f]{8}\./.test(l)) || links[0] || null;
      if (isPr) {
        try {
          const pr = await ghJson(['api', `repos/${repo}/pulls/${number}`]);
          const files = await ghJson(['api', `repos/${repo}/pulls/${number}/files?per_page=100`]);
          out.diff = { type: 'diff', add: pr.additions, del: pr.deletions, count: pr.changed_files, state: pr.merged ? 'merged' : pr.draft ? 'draft' : pr.state,
            files: files.sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions)).slice(0, 9).map(f => ({ path: f.filename, add: f.additions, del: f.deletions })) };
        } catch {}
      }
      return out;
    });
  }

  // ---------- live screenshot of a URL ----------
  let shooting = Promise.resolve();
  function site(url) {
    if (!chrome || !url) return null;
    const hour = Math.floor(Date.now() / (6 * 36e5)); // refresh every 6 hours
    return memo('w:' + url, hour, () => (shooting = shooting.then(async () => {
      const out = path.join(media, 'w-' + sha(url + hour) + '.png');
      const prof = path.join(dataDir, 'chrome-profile');
      try {
        await run(chrome, ['--headless', '--hide-scrollbars', '--mute-audio', '--window-size=430,1600', '--force-device-scale-factor=2',
          '--virtual-time-budget=7000', '--user-data-dir=' + prof, '--screenshot=' + out, url], { timeout: 45000 });
        return fs.existsSync(out) ? { type: 'site', src: '/media/' + path.basename(out), url, label: 'Live preview' } : null;
      } catch (e) { log('screenshot failed ' + url + ': ' + e.message.slice(0, 80)); return null; }
    })));
  }

  // ---------- Notion ----------
  async function notionGet(url) {
    const r = await fetch('https://api.notion.com/v1/' + url, { headers: { Authorization: `Bearer ${notionToken}`, 'Notion-Version': '2025-09-03' } });
    if (!r.ok) throw new Error('Notion ' + r.status); return r.json();
  }
  function notion(pageId, edited) {
    if (!notionToken) return null;
    return memo('n:' + pageId, edited || '', async () => {
      const out = { images: [], checklist: null };
      try {
        const page = await notionGet('pages/' + pageId);
        const blocks = []; let cursor;
        do { const r = await notionGet(`blocks/${pageId}/children?page_size=100${cursor ? '&start_cursor=' + cursor : ''}`); blocks.push(...r.results); cursor = r.has_more && blocks.length < 400 ? r.next_cursor : null; } while (cursor);
        const urls = [page.cover && (page.cover.file?.url || page.cover.external?.url),
          ...blocks.filter(b => b.type === 'image').map(b => b.image.file?.url || b.image.external?.url)].filter(Boolean);
        for (const u of urls.slice(0, 4)) {
          try { const r = await fetch(u); const ct = r.headers.get('content-type') || ''; if (!r.ok || !/image\/(png|jpe?g|gif|webp)/.test(ct)) continue;
            out.images.push({ type: 'image', src: put(Buffer.from(await r.arrayBuffer()), ct.split('/')[1].replace('jpeg', 'jpg')), label: 'From the roadmap page' }); } catch {}
        }
        const todos = blocks.filter(b => b.type === 'to_do').map(b => ({ t: (b.to_do.rich_text || []).map(x => x.plain_text).join('').slice(0, 90), done: b.to_do.checked })).filter(x => x.t);
        if (todos.length >= 2) out.checklist = { type: 'checklist', done: todos.filter(x => x.done).length, total: todos.length,
          items: [...todos.filter(x => !x.done), ...todos.filter(x => x.done)].slice(0, 7) };
      } catch (e) { log('notion visual ' + pageId + ': ' + e.message); }
      return out;
    });
  }

  // ---------- one card → slides ----------
  async function slidesFor(item, items) {
    const covers = item.source === 'curator' ? item.covers || [] : [item.id];
    const sessions = new Set(covers.filter(c => c.startsWith('session:')).map(c => c.slice(8)));
    if (item.session?.id) sessions.add(item.session.id);
    const shots = [], sites = [], diffs = [], lists = [], acts = [];
    for (const c of covers) {
      const m = c.match(/^gh:(.+)#(\d+)$/);
      if (m) { const g = await github(m[1], m[2], items[c]?.updatedAt).catch(() => null); if (!g) continue;
        shots.push(...g.images); if (g.diff) diffs.push(g.diff);
        if (g.preview && sites.length < 1) { const s = await site(g.preview); if (s) sites.push(s); } }
      if (c.startsWith('notion:')) { const n = await notion(c.slice(7), items[c]?.updatedAt).catch(() => null); if (n) { shots.push(...n.images); if (n.checklist) lists.push(n.checklist); } }
    }
    for (const id of [...sessions].slice(0, 3)) { const s = await (session(id) || Promise.resolve(null)).catch(() => null); if (!s) continue; shots.push(...s.images); if (s.activity && !acts.length) acts.push({ ...s.activity, session: id }); }
    const graphic = item.visual && typeof item.visual === 'object' && item.visual.type ? [item.visual] : [];
    // the most telling picture first: what Claude/you actually looked at, then the live app, then the shapes
    const ordered = [...shots.slice(-3).reverse(), ...sites, ...graphic, ...diffs.slice(0, 1), ...lists.slice(0, 1), ...acts];
    if (!ordered.length) ordered.push(...fallback(item));
    return ordered.slice(0, 6);
  }

  // Cards with nothing to show still get a picture made from their own data.
  function fallback(it) {
    const days = Math.max(0, Math.round((Date.now() - new Date(it.createdAt || it.updatedAt).getTime()) / 864e5));
    if (it.source === 'notion') {
      const p = it.props || {};
      const chips = [p.Priority && 'Priority ' + p.Priority, p['Waiting on'] && p['Waiting on'], p.Owner && p.Owner, p.Area && p.Area].filter(Boolean);
      const usual = ['New', 'Building', 'In Review', 'Shipped'];
      const st = it.status || 'New';
      const stages = usual.some(u => u.toLowerCase() === st.toLowerCase()) ? usual : ['Backlog', st, 'Done'];
      const out = [{ type: 'pipeline', stages, at: st, chips }];
      if (it.outline?.length >= 2) out.push({ type: 'outline', items: it.outline });
      return out;
    }
    if (it.source === 'github') return [{ type: 'thread', repo: it.repo, number: it.number, kind: it.kind, labels: it.labels || [], comments: it.comments || 0, author: it.author, days, draft: !!it.draft }];
    return [{ type: 'stat', value: days ? days + 'd' : 'new', label: 'on your list', sub: it.repo || '' }];
  }

  return { slidesFor, mediaDir: media, hasChrome: !!chrome };
}

function findChrome() {
  const pw = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  try {
    const dirs = fs.readdirSync(pw).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse();
    for (const d of dirs) for (const sub of fs.readdirSync(path.join(pw, d))) {
      const p = path.join(pw, d, sub, 'chrome-headless-shell'); if (fs.existsSync(p)) return p;
    }
  } catch {}
  for (const p of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome']) if (fs.existsSync(p)) return p;
  return null;
}
