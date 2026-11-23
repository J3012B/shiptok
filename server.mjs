// ShipTok — a scrollable feed of your work. Swipe through GitHub + Notion,
// send Claude agents at items, and answer agents when they need you.
// Zero dependencies: node server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readNotion, readSessions, curate, inputHash } from './curator.mjs';
import { createVisuals } from './visuals.mjs';
import { seed as demoSeed, script as demoScript } from './demo/seed.mjs';

const run = promisify(execFile);
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const DEMO = process.argv.includes('--demo') || process.env.DEMO === '1';
// Your settings and data live outside the code, so plugin updates never touch them.
// A .env next to the code (a dev checkout) still wins, for backwards compatibility.
const HOME = process.env.SHIPTOK_HOME || (fs.existsSync(path.join(ROOT, '.env')) ? ROOT : path.join(os.homedir(), '.shiptok'));
if (!DEMO) loadEnv(path.join(HOME, '.env'));

const CFG = {
  port: Number(process.env.PORT || (DEMO ? 4778 : 4777)),
  host: process.env.HOST || '127.0.0.1',
  codeRoots: (process.env.CODE_ROOTS || path.join(os.homedir(), 'Coding')).split(',').map(s => s.trim().replace(/^~/, os.homedir())),
  maxAgents: Number(process.env.MAX_AGENTS || 3),
  permissionMode: process.env.AGENT_PERMISSION_MODE || 'acceptEdits',
  allowedTools: (process.env.AGENT_ALLOWED_TOOLS ||
    'Read,Edit,Write,Glob,Grep,Bash(git:*),Bash(gh:*),Bash(ls:*),Bash(cat:*),Bash(npm test:*),Bash(npm run:*),Bash(npx tsc:*)'
  ).split(',').map(s => s.trim()).filter(Boolean),
  model: process.env.AGENT_MODEL || '',
  notionToken: process.env.NOTION_TOKEN || '',
  notionDataSource: (process.env.NOTION_DATA_SOURCE || '').replace(/^collection:\/\//, ''),
  curatorModel: process.env.CURATOR_MODEL || 'sonnet',
  curateEveryMin: Number(process.env.CURATE_EVERY_MIN || 120),
  curatorContext: process.env.CURATOR_CONTEXT || '',
  sessionHours: Number(process.env.SESSION_HOURS || 48),
  userName: process.env.SHIPTOK_NAME || os.userInfo().username,
  dailyGoal: Number(process.env.DAILY_GOAL || 10),
  worktreeDir: process.env.WORKTREE_DIR || path.join(os.homedir(), '.shiptok', 'worktrees'),
};

// ---------- state ----------
const DATA = path.join(HOME, DEMO ? 'data-demo' : 'data');
fs.mkdirSync(DATA, { recursive: true });
const STATE_FILE = path.join(DATA, 'state.json');
const state = Object.assign({
  items: {},        // id -> feed item
  agents: {},       // id -> agent run
  hidden: {},       // item id -> { until, reason }
  game: { xp: 0, streak: 0, lastDay: '', today: 0, todayDay: '', combo: 0, lastActionAt: 0, badges: [] },
  repoPaths: {},    // "owner/name" -> local path
  syncedAt: {},
  notionCache: {},  // page id -> { edited, text }
  visualCache: {}, // source -> { sig, v }
  slides: {},      // item id -> [slide]
  curator: { lastAt: 0, lastCost: 0, totalCost: 0, runs: 0, lastError: '', hash: '', sessionIds: [] },
}, DEMO ? {} : readJson(STATE_FILE, {}));
function resetDemo() { const d = demoSeed(); Object.assign(state, { items: d.items, slides: d.slides, agents: d.agents, game: d.game, hidden: {} }); for (const a of Object.values(state.agents)) if (a.status === 'running') simulate(a, '', false); }
let saveTimer;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1)), 200); }

const visuals = createVisuals({ dataDir: DATA, notionToken: CFG.notionToken, cache: state.visualCache, log: m => console.log('  visuals: ' + m) });

// Build slides for every card in the background; cards update as their pictures land.
let painting = false, paintAgain = false;
async function paintAll() {
  if (DEMO) return;
  if (painting) { paintAgain = true; return; } painting = true;
  try {
    const ids = feed().filter(c => c.type === 'item').map(c => c.id); // feed order: what you'll see first gets pictures first
    for (const id of ids) {
      const it = state.items[id]; if (!it) continue;
      const slides = await visuals.slidesFor(it, state.items).catch(e => { console.log('  visuals failed ' + id + ': ' + e.message); return null; });
      if (!slides) continue;
      if (JSON.stringify(slides) !== JSON.stringify(state.slides[id] || [])) { state.slides[id] = slides; save(); push('feed', {}); }
    }
    for (const id of Object.keys(state.slides)) if (!state.items[id]) delete state.slides[id];
  } finally { painting = false; if (paintAgain) { paintAgain = false; paintAll(); } }
}

// ---------- live updates (SSE) ----------
const clients = new Set();
let lastSeenAt = 0; // last time someone had the feed open; auto-curation only runs for an audience
function push(event, data) { const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(msg); }

// ---------- gamification ----------
const XP = { dispatch: 10, reply: 15, approve: 15, done: 8, skip: 1, snooze: 2, review: 20, agentDone: 25 };
function level(xp) { return Math.floor(Math.sqrt(xp / 40)) + 1; }
function award(kind, note) {
  const g = state.game; const now = Date.now(); const day = new Date().toISOString().slice(0, 10);
  if (g.todayDay !== day) { g.today = 0; g.todayDay = day; }
  if (g.lastDay !== day) {
    const yesterday = new Date(now - 864e5).toISOString().slice(0, 10);
    g.streak = g.lastDay === yesterday ? g.streak + 1 : 1; g.lastDay = day;
  }
  g.combo = now - g.lastActionAt < 45_000 ? Math.min(g.combo + 1, 10) : 1;
  g.lastActionAt = now;
  const before = level(g.xp);
  const gained = Math.round((XP[kind] || 0) * (1 + (g.combo - 1) * 0.1) * (g.streak >= 3 ? 1.25 : 1));
  g.xp += gained; if (kind !== 'agentDone') g.today += 1;
  const newBadges = [];
  const want = [
    ['first-blood', 'First agent sent', () => kind === 'dispatch'],
    ['combo-5', '5x combo', () => g.combo >= 5],
    ['goal', 'Daily goal hit', () => g.today >= CFG.dailyGoal],
    ['streak-3', '3-day streak', () => g.streak >= 3],
    ['streak-7', '7-day streak', () => g.streak >= 7],
    ['unblocker', 'Unblocked an agent', () => kind === 'reply' || kind === 'approve'],
  ];
  for (const [id, label, test] of want) if (!g.badges.includes(id) && test()) { g.badges.push(id); newBadges.push(label); }
  save();
  const out = { gained, kind, note, levelUp: level(g.xp) > before, badges: newBadges, game: gameView() };
  push('xp', out); return out;
}
function gameView() { const g = state.game; const lv = level(g.xp); return { ...g, level: lv, nextAt: 40 * lv * lv, prevAt: 40 * (lv - 1) * (lv - 1), dailyGoal: CFG.dailyGoal }; }

// ---------- sources ----------
async function gh(args) { const { stdout } = await run('gh', args, { maxBuffer: 20e6 }); return JSON.parse(stdout || '[]'); }

async function syncGitHub() {
  const fields = 'number,title,url,repository,updatedAt,createdAt,labels,body,author,commentsCount';
  const [reviews, issues, myPrs] = await Promise.all([
    gh(['search', 'prs', '--review-requested=@me', '--state=open', '--limit', '30', '--json', fields]).catch(() => []),
    gh(['search', 'issues', '--assignee=@me', '--state=open', '--limit', '50', '--json', fields]).catch(() => []),
    gh(['search', 'prs', '--author=@me', '--state=open', '--limit', '30', '--json', fields + ',isDraft']).catch(() => []),
  ]);
  const seen = new Set();
  const add = (x, kind) => {
    const id = `gh:${x.repository.nameWithOwner}#${x.number}`; seen.add(id);
    const prev = state.items[id];
    state.items[id] = {
      id, source: 'github', kind, title: x.title, url: x.url, repo: x.repository.nameWithOwner, number: x.number,
      body: (x.body || '').slice(0, 1800), labels: (x.labels || []).map(l => l.name), author: x.author?.login,
      updatedAt: x.updatedAt, createdAt: x.createdAt, comments: x.commentsCount || 0, draft: x.isDraft,
      firstSeen: prev?.firstSeen || Date.now(),
    };
  };
  reviews.forEach(x => add(x, 'review'));
  issues.forEach(x => add(x, 'issue'));
  myPrs.forEach(x => add(x, 'my-pr'));
  for (const id of Object.keys(state.items)) if (id.startsWith('gh:') && !seen.has(id)) delete state.items[id];
  state.syncedAt.github = Date.now();
}

function ingestNotion(rows) {
  const seen = new Set();
  for (const n of rows) {
    const id = `notion:${n.id}`; seen.add(id);
    state.items[id] = { id, source: 'notion', kind: 'task', title: n.title, url: n.url, status: n.props.Status, priority: n.props.Priority, props: n.props, outline: (n.text || '').split('\n').filter(l => l.startsWith('## ')).map(l => l.slice(3).trim()).slice(0, 6),
      body: n.text?.slice(0, 600) || '', updatedAt: n.edited, firstSeen: state.items[id]?.firstSeen || Date.now() };
  }
  for (const id of Object.keys(state.items)) if (id.startsWith('notion:') && !seen.has(id)) delete state.items[id];
  state.syncedAt.notion = Date.now();
}

// The raw material the curator sees: compact, so one call stays cheap.
function curatorInput(notionRows, sessions) {
  const github = Object.values(state.items).filter(i => i.source === 'github').map(i => ({ id: i.id, kind: i.kind, repo: i.repo, number: i.number,
    title: i.title, labels: i.labels?.length ? i.labels : undefined, author: i.author, draft: i.draft || undefined, updated: i.updatedAt?.slice(0, 10),
    comments: i.comments || undefined, url: i.url, body: (i.body || '').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').slice(0, 280) }));
  const notion = notionRows.map(r => ({ id: 'notion:' + r.id, title: r.title, url: r.url, edited: r.edited?.slice(0, 10), ...r.props, text: r.text }));
  return { github, notion, sessions };
}

let syncing = false, curating = false;
async function syncAll(force = false) {
  if (DEMO) { if (force) { resetDemo(); push('curator', { running: false, lastCount: Object.keys(state.items).length }); } push('feed', {}); return; }
  if (syncing) return; syncing = true; push('sync', { running: true });
  const errors = [];
  await syncGitHub().catch(e => errors.push('GitHub: ' + e.message));
  let notionRows = [];
  if (CFG.notionToken && CFG.notionDataSource) {
    notionRows = await readNotion({ token: CFG.notionToken, dataSource: CFG.notionDataSource, cache: state.notionCache }).catch(e => { errors.push(e.message); return []; });
    if (notionRows.length) ingestNotion(notionRows);
  }
  syncing = false; save(); push('sync', { running: false, errors }); push('feed', {}); paintAll();
  const c = state.curator; const watched = clients.size > 0 || Date.now() - lastSeenAt < 2 * 36e5;
  const due = watched && Date.now() - c.lastAt > CFG.curateEveryMin * 60_000;
  if (force || due) await runCurator(notionRows).catch(e => { c.lastError = e.message; push('sync', { errors: ['Curator: ' + e.message] }); });
}

async function runCurator(notionRows) {
  if (curating) return; curating = true; push('curator', { running: true });
  const c = state.curator;
  try {
    const exclude = new Set([...Object.values(state.agents).map(a => a.sessionId).filter(Boolean), ...c.sessionIds]);
    const sessions = readSessions({ hours: CFG.sessionHours, exclude, excludeCwd: [CFG.worktreeDir, DATA, path.join(os.homedir(), '.shipfeed', 'worktrees')] });
    const input = curatorInput(notionRows, sessions);
    // nothing new since last time → don't pay for another call
    const hash = inputHash(input.github.map(g => [g.id, g.updated]), input.notion.map(n => [n.id, n.edited]), sessions.map(s => [s.id, s.lastActive]));
    if (hash === c.hash && Object.keys(state.items).some(k => k.startsWith('ai:'))) { c.lastAt = Date.now(); return; }
    const r = await curate({ cwd: path.join(DATA, 'curator'), model: CFG.curatorModel, context: CFG.curatorContext, ...input, log: m => console.log('  ' + m) });
    c.sessionIds = [r.sessionId, ...c.sessionIds].slice(0, 50);
    for (const id of Object.keys(state.items)) if (id.startsWith('ai:')) delete state.items[id];
    const prev = c.firstSeen || {}; c.firstSeen = {};
    for (const card of r.cards) {
      const id = 'ai:' + String(card.key || card.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80);
      c.firstSeen[id] = prev[id] || Date.now();
      state.items[id] = { id, source: 'curator', kind: card.kind || 'fyi', title: card.title, hook: card.hook, body: card.body, priority: card.priority,
        effort: card.effort, repo: card.repo || null, links: card.links || [], covers: card.covers || [], session: card.session || null,
        actions: card.actions || [], visual: card.visual || null, url: card.links?.[0]?.url, updatedAt: new Date().toISOString(), firstSeen: c.firstSeen[id] };
    }
    Object.assign(c, { lastAt: Date.now(), lastCost: r.cost, totalCost: c.totalCost + r.cost, runs: c.runs + 1, lastError: '', hash, lastCount: r.cards.length, promptChars: r.promptChars });
  } finally { curating = false; save(); push('curator', { running: false, ...state.curator }); push('feed', {}); paintAll(); }
}

// ---------- ranking ----------
function score(it) {
  if (it.source === 'curator') return 60 + (it.priority || 50) * 0.6 +(Date.now() - it.firstSeen < 864e5 ? 5 : 0);
  const ageH = (Date.now() - new Date(it.updatedAt).getTime()) / 36e5;
  let s = { review: 70, issue: 50, 'my-pr': 35, task: 45 }[it.kind] ?? 30;
  if (it.labels?.some(l => /bug|urgent|p0|critical|security/i.test(l))) s += 25;
  if (/p0|high|urgent|critical/i.test(it.priority || '')) s += 25;
  if (/progress|doing/i.test(it.status || '')) s += 10;
  s += Math.max(0, 20 - ageH / 6);            // fresh things float
  if (Date.now() - it.firstSeen < 864e5) s += 8; // new to you
  if (it.draft) s -= 10;
  return s;
}
function feed() {
  const now = Date.now();
  const agentCards = Object.values(state.agents)
    .filter(a => !a.archived)
    .map(a => ({ type: 'agent', ...agentView(a), rank: a.status === 'needs-you' ? 1000 : a.status === 'done' ? 500 : a.status === 'failed' ? 600 : 100 }));
  const busy = new Set(Object.values(state.agents).filter(a => !a.archived).map(a => a.itemId));
  const covered = new Set(Object.values(state.items).filter(i => i.source === 'curator').flatMap(i => i.covers || []));
  const work = Object.values(state.items)
    .filter(it => !(state.hidden[it.id] && state.hidden[it.id].until > now) && !busy.has(it.id) && !covered.has(it.id))
    .map(it => ({ type: 'item', ...it, slides: state.slides[it.id] || [], rank: score(it) }));
  return [...agentCards, ...work].sort((a, b) => b.rank - a.rank);
}

// ---------- local repos ----------
async function discoverRepos() {
  const found = {};
  const walk = async (dir, depth) => {
    if (depth < 0) return; let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (ents.some(e => e.name === '.git' && e.isDirectory())) {
      try {
        const { stdout } = await run('git', ['-C', dir, 'remote', 'get-url', 'origin']);
        const m = stdout.trim().match(/github\.com[:/](.+?)(\.git)?$/);
        if (m) { const k = m[1].toLowerCase(); if (!found[k] || dir.length < found[k].length) found[k] = dir; }
      } catch {}
      return;
    }
    for (const e of ents) if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') await walk(path.join(dir, e.name), depth - 1);
  };
  for (const r of CFG.codeRoots) await walk(r, 3);
  state.repoPaths = { ...found, ...pick(state.repoPaths, k => state.repoPaths[k]?.manual) };
  save();
}
function pick(o, f) { return Object.fromEntries(Object.entries(o).filter(([k]) => f(k))); }
function repoPath(repo) { const r = state.repoPaths[repo?.toLowerCase()]; return typeof r === 'string' ? r : r?.path; }

// ---------- agents ----------
const procs = {};
const SYSTEM = `You were sent from ShipTok, a feed the human scrolls on their phone. They are not watching you work.
- Work only in the current directory (a fresh git worktree on its own branch).
- When you finish code changes: commit, push the branch and open a DRAFT pull request that references the item. Never merge.
- If you need a decision, information or approval from the human, stop and end your final message with one line starting "QUESTION:" followed by a short, self-contained question. Offer the options if there are any.
- Otherwise end with a 2–4 sentence plain-language summary of what you did and what's left. Include the PR URL if you opened one.`;

function agentView(a) {
  return { id: a.id, itemId: a.itemId, title: a.title, repo: a.repo, url: a.url, source: a.source, instruction: a.instruction,
    status: a.status, diff: a.diff, shot: a.shot, question: a.question, summary: a.summary, denials: a.denials, prUrl: a.prUrl, log: a.log.slice(-14),
    cost: a.cost, startedAt: a.startedAt, endedAt: a.endedAt, turns: a.turns, cwd: a.cwd, sessionId: a.sessionId, history: a.history };
}

async function prepareWorktree(a) {
  const base = repoPath(a.repo);
  if (!base) return CFG.codeRoots[0]; // Notion tasks or unknown repos: run in your code root, read-only-ish by default
  const dir = path.join(CFG.worktreeDir, a.id);
  fs.mkdirSync(CFG.worktreeDir, { recursive: true });
  await run('git', ['-C', base, 'fetch', 'origin', '--quiet']).catch(() => {});
  const { stdout } = await run('git', ['-C', base, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => ({ stdout: 'HEAD' }));
  const branch = `${a.kind === 'review' ? 'review' : /bug|fix/i.test(a.title + a.instruction) ? 'fix' : 'feat'}/shiptok-${a.id}`;
  await run('git', ['-C', base, 'worktree', 'add', '-b', branch, dir, stdout.trim()]);
  a.branch = branch; return dir;
}

async function dispatch(itemId, instruction) {
  const it = state.items[itemId]; if (!it) throw new Error('No such item');
  const id = crypto.randomBytes(3).toString('hex');
  const a = state.agents[id] = { id, itemId, title: it.title, repo: it.repo, url: it.url, source: it.source, kind: it.kind,
    instruction, status: 'queued', log: [], history: [{ who: 'you', text: instruction, at: Date.now() }], startedAt: Date.now(),
    sessionId: crypto.randomUUID(), extraTools: [], turns: 0, cost: 0 };
  const context = [
    `Item: ${it.title}`, it.url && `Link: ${it.url}`, it.repo && `Repository: ${it.repo}`,
    it.kind === 'review' && `This is a pull request where your review was requested. Use gh to read the diff and comments.`,
    it.source === 'github' && `Read the full thread with gh before starting.`,
    it.source === 'notion' && `This is a Notion backlog task. Use your Notion tools to read the page.`,
    it.hook && `Why now: ${it.hook}`,
    it.body && `${it.source === 'curator' ? 'Summary' : 'Excerpt'}:\n${it.body}`,
    it.links?.length && `Links:\n${it.links.map(l => `- ${l.label}: ${l.url}`).join('\n')}`,
    it.session && `Related Claude Code session ${it.session.id} in ${it.session.cwd}. Its transcript is in ~/.claude/projects if you need the details.`,
  ].filter(Boolean).join('\n');
  a.prompt = `${context}\n\nWhat the human wants: ${instruction}`;
  save(); pump(); return agentView(a);
}

function running() { return Object.values(state.agents).filter(a => a.status === 'running').length; }
function pump() {
  for (const a of Object.values(state.agents)) {
    if (running() >= CFG.maxAgents) break;
    if (a.status !== 'queued') continue;
    if (a.pendingReply) { const m = a.pendingReply; a.pendingReply = null; start(a, m, true); }
    else start(a, a.prompt, false);
  }
  push('feed', {});
}

// demo mode: a scripted agent that types into the terminal, asks you something, then ships
const timers = {};
function simulate(a, message, resume) {
  clearTimeout(timers[a.id]);
  a.status = 'running'; a.question = null; a.cwd = a.cwd || '~/.shiptok/worktrees/' + a.id; push('agent', agentView(a));
  const sc = demoScript(a, resume); let i = 0;
  const step = () => {
    if (a.status !== 'running') return;
    if (i < sc.lines.length || sc.loop) {
      const [t, s] = sc.lines[i++ % sc.lines.length]; a.log.push({ t, s }); a.log = a.log.slice(-60); a.cost += 0.01;
      push('agent', agentView(a)); timers[a.id] = setTimeout(step, 650 + Math.random() * 900); return;
    }
    Object.assign(a, sc.end, { endedAt: Date.now() });
    a.history.push({ who: 'agent', text: sc.end.question || sc.end.summary, at: Date.now() });
    if (a.status === 'done') award('agentDone', a.title);
    push('agent', agentView(a)); push('feed', {});
  };
  timers[a.id] = setTimeout(step, 500);
}

async function start(a, message, resume) {
  if (DEMO) return simulate(a, message, resume);
  a.status = 'running'; a.question = null; a.denials = null; save(); push('agent', agentView(a));
  try { if (!a.cwd) a.cwd = await prepareWorktree(a); }
  catch (e) { a.status = 'failed'; a.summary = 'Could not create a worktree: ' + e.message; save(); push('agent', agentView(a)); return; }
  const args = ['-p', message, '--output-format', 'stream-json', '--verbose', '--permission-mode', CFG.permissionMode,
    '--append-system-prompt', SYSTEM, '--allowedTools', ...CFG.allowedTools, ...a.extraTools];
  args.push(...(resume ? ['--resume', a.sessionId] : ['--session-id', a.sessionId]));
  if (CFG.model) args.push('--model', CFG.model);
  const p = procs[a.id] = spawn('claude', args, { cwd: a.cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SHIPTOK_AGENT: a.id } });
  let buf = ''; let result = null;
  p.stdout.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'assistant') for (const c of ev.message?.content || []) {
        if (c.type === 'text' && c.text.trim()) a.log.push({ t: 'say', s: c.text.trim().slice(0, 300) });
        if (c.type === 'tool_use') a.log.push({ t: 'tool', s: toolLine(c) });
      }
      if (ev.type === 'result') result = ev;
      if (a.log.length > 200) a.log = a.log.slice(-120);
      push('agent', agentView(a));
    }
  });
  p.stderr.on('data', d => a.log.push({ t: 'err', s: String(d).slice(0, 300) }));
  p.on('close', code => {
    delete procs[a.id]; a.turns += result?.num_turns || 0; a.cost += result?.total_cost_usd || 0; a.endedAt = Date.now();
    if (a.status === 'stopped') { save(); push('agent', agentView(a)); pump(); return; }
    const text = (result?.result || '').trim();
    const q = text.match(/^\s*QUESTION:\s*([\s\S]+)$/m);
    const denials = (result?.permission_denials || []).map(d => ({ tool: d.tool_name, input: d.tool_input }));
    a.prUrl = (text.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/) || [a.prUrl])[0];
    a.history.push({ who: 'agent', text, at: Date.now() });
    if (code !== 0 && !result) { a.status = 'failed'; a.summary = a.log.filter(l => l.t === 'err').map(l => l.s).join('\n').slice(-600) || `exit ${code}`; }
    else if (denials.length) { a.status = 'needs-you'; a.denials = dedupeDenials(denials); a.question = q?.[1] || 'I was blocked by a permission. Allow it?'; a.summary = text.replace(/QUESTION:[\s\S]*$/, '').trim(); }
    else if (q) { a.status = 'needs-you'; a.question = q[1].trim(); a.summary = text.replace(/QUESTION:[\s\S]*$/, '').trim(); }
    else { a.status = 'done'; a.summary = text; award('agentDone', a.title); }
    save(); push('agent', agentView(a)); pump();
    agentDiff(a).then(d => { if (d) { a.diff = d; save(); push('agent', agentView(a)); } });
  });
}
// what the agent changed in its worktree so far (committed or not), for the card's diff chart
async function agentDiff(a) {
  if (!a.branch || !a.cwd) return null;
  try {
    const { stdout: base } = await run('git', ['-C', a.cwd, 'merge-base', 'HEAD', 'origin/HEAD']);
    const { stdout } = await run('git', ['-C', a.cwd, 'diff', '--numstat', base.trim()]);
    const files = stdout.trim().split('\n').filter(Boolean).map(l => { const [ad, de, p] = l.split('\t'); return { path: p, add: +ad || 0, del: +de || 0 }; });
    if (!files.length) return null;
    return { add: files.reduce((n, f) => n + f.add, 0), del: files.reduce((n, f) => n + f.del, 0), count: files.length,
      files: files.sort((x, y) => (y.add + y.del) - (x.add + x.del)).slice(0, 5) };
  } catch { return null; }
}
function toolLine(c) {
  const i = c.input || {};
  const arg = i.command || i.file_path || i.pattern || i.url || i.description || Object.values(i)[0] || '';
  return `${c.name}${arg ? ': ' + String(arg).replace(/\s+/g, ' ').slice(0, 140) : ''}`;
}
function dedupeDenials(ds) { const m = new Map(); for (const d of ds) m.set(denialRule(d), d); return [...m.entries()].map(([rule, d]) => ({ ...d, rule })); }
function denialRule(d) {
  if (d.tool === 'Bash') { const cmd = String(d.input?.command || '').trim().split(/\s+/); return `Bash(${cmd.slice(0, cmd[0] === 'npm' || cmd[0] === 'npx' ? 2 : 1).join(' ')}:*)`; }
  return d.tool;
}

function reply(id, text, allow) {
  const a = state.agents[id]; if (!a) throw new Error('No such agent');
  if (a.status === 'running') throw new Error('Agent is still running');
  if (allow?.length) a.extraTools.push(...allow);
  const msg = allow?.length ? `${text || ''}\n\n(The human allowed: ${allow.join(', ')}. Retry what was blocked and continue.)`.trim() : text;
  a.history.push({ who: 'you', text: msg, at: Date.now() });
  a.status = 'queued'; a.prompt = null; save();
  if (running() < CFG.maxAgents) start(a, msg, true); else { a.pendingReply = msg; }
  return agentView(a);
}

// ---------- outside agents (Claude Code hooks, scripts, anything) ----------
function inbox(body) {
  const id = 'ext-' + crypto.createHash('sha1').update(String(body.session_id || body.title || Math.random())).digest('hex').slice(0, 8);
  const prev = state.agents[id];
  state.agents[id] = { id, itemId: null, external: true, title: body.title || path.basename(body.cwd || '') || 'Agent', repo: body.repo || body.cwd,
    source: 'external', status: body.status || 'needs-you', question: body.question || body.message || 'Needs you', summary: body.summary || '',
    log: prev?.log || [], history: prev?.history || [], startedAt: prev?.startedAt || Date.now(), endedAt: Date.now(), cwd: body.cwd,
    sessionId: body.session_id, url: body.url, extraTools: [], turns: 0, cost: 0 };
  save(); push('agent', agentView(state.agents[id])); push('feed', {});
  return { id };
}

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    if (url.pathname.startsWith('/api/feed') || url.pathname === '/api/events') lastSeenAt = Date.now();
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (url.pathname.startsWith('/api/')) {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const r = url.pathname.slice(5);
      if (r === 'feed') return send(200, { demo: DEMO, me: DEMO ? 'You' : CFG.userName, feed: feed(), game: gameView(), syncing, curating, curator: state.curator, syncedAt: state.syncedAt,
        sources: { github: true, notion: !!(CFG.notionToken && CFG.notionDataSource) }, running: running(), maxAgents: CFG.maxAgents });
      if (r === 'sync') { syncAll(!!body.curate); return send(200, { ok: true }); }
      if (r === 'dispatch') { const a = await dispatch(body.itemId, body.instruction); award('dispatch', a.title); return send(200, a); }
      if (r === 'reply') { const a = reply(body.id, body.text, body.allow); award(body.allow?.length ? 'approve' : 'reply', a.title); return send(200, a); }
      if (r === 'stop') { const a = state.agents[body.id]; if (a) { a.status = 'stopped'; procs[a.id]?.kill('SIGTERM'); save(); push('agent', agentView(a)); } return send(200, {}); }
      if (r === 'archive') { const a = state.agents[body.id]; if (a) { a.archived = true; if (a.itemId && body.hideItem) state.hidden[a.itemId] = { until: Date.now() + 7 * 864e5, reason: 'agent' }; save(); award(a.status === 'done' ? 'review' : 'done', a.title); } push('feed', {}); return send(200, {}); }
      if (r === 'hide') { const days = { skip: 1 / 6, snooze: 1, done: 3650 }[body.how] ?? 1; state.hidden[body.itemId] = { until: Date.now() + days * 864e5, reason: body.how }; save(); return send(200, award(body.how, body.itemId)); }
      if (r === 'inbox') return send(200, inbox(body));
      if (r === 'item') { // capture your own card: { title, body?, repo?, url? }
        const id = 'me:' + crypto.randomBytes(3).toString('hex');
        state.items[id] = { id, source: 'manual', kind: body.repo ? 'issue' : 'task', title: body.title, body: body.body || '', repo: body.repo, url: body.url,
          updatedAt: new Date().toISOString(), firstSeen: Date.now(), labels: ['captured'] };
        save(); push('feed', {}); return send(200, state.items[id]);
      }
      if (r === 'repos') { if (req.method === 'POST') { state.repoPaths[body.repo.toLowerCase()] = { path: body.path, manual: true }; save(); } return send(200, state.repoPaths); }
      return send(404, { error: 'not found' });
    }
    if (url.pathname === '/demo' && !DEMO) { // start the demo server next to this one if it isn't up, then go there
      const up = await fetch('http://127.0.0.1:4778/api/feed').then(r => r.ok).catch(() => false);
      if (!up) { spawn(process.execPath, [path.join(ROOT, 'server.mjs'), '--demo'], { cwd: ROOT, detached: true, stdio: 'ignore' }).unref(); await new Promise(r => setTimeout(r, 900)); }
      res.writeHead(302, { Location: `http://${(req.headers.host || '127.0.0.1').split(':')[0]}:4778/` }); return res.end();
    }
    if (url.pathname.startsWith('/media/')) {
      const f = path.join(DEMO ? path.join(ROOT, 'demo', 'shots') : visuals.mediaDir, path.basename(url.pathname));
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'max-age=31536000, immutable' }); return fs.createReadStream(f).pipe(res);
    }
    const file = path.join(ROOT, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  } catch (e) { send(400, { error: e.message }); }
});

// ---------- utils ----------
function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function readBody(req) { return new Promise((ok, bad) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(e); } }); }); }
function loadEnv(f) { if (!fs.existsSync(f)) return; for (const l of fs.readFileSync(f, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }

// Agents that were mid-run when the server stopped get a "needs you" nudge instead of vanishing.
for (const a of Object.values(state.agents)) if (a.status === 'running' || a.status === 'queued') {
  if (a.status === 'running') { a.status = 'needs-you'; a.question = 'ShipTok restarted while I was working. Continue?'; }
}

fs.mkdirSync(HOME, { recursive: true });
server.listen(CFG.port, CFG.host, () => {
  console.log(`\n  ▶ ShipTok on http://${CFG.host}:${CFG.port}\n`);
  if (DEMO) { resetDemo(); console.log('  DEMO mode: made-up data, scripted agents. Press R in the app to reset.'); }
  else discoverRepos().then(() => console.log(`  found ${Object.keys(state.repoPaths).length} local repos`));
  syncAll(); setInterval(() => syncAll(), 5 * 60_000); pump();
});
