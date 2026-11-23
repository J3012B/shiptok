const $ = s => document.querySelector(s);
const feedEl = $('#feed');
const api = (p, body) => fetch('/api/' + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; });

let data = { feed: [], game: {} };
let tab = 'all';
let order = [];           // stable order of ids on screen
const nodes = new Map();  // id -> { el, sig }

// ---------- icons ----------
const I = {
  robot: '<svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="12" rx="4"/><circle cx="9.5" cy="13" r="1.7" fill="#000" opacity=".55"/><circle cx="14.5" cy="13" r="1.7" fill="#000" opacity=".55"/><rect x="11" y="3" width="2" height="4" rx="1"/><circle cx="12" cy="3" r="1.6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zm4.3 6.2a1.1 1.1 0 0 0-1.6 0l-3.9 4.1-1.6-1.6a1.1 1.1 0 1 0-1.6 1.6l2.4 2.4c.4.4 1.1.4 1.6 0l4.7-4.9c.4-.4.4-1.1 0-1.6z"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><path d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zm0 4a1.1 1.1 0 0 0-1.1 1.1V12c0 .3.1.6.3.8l3 3a1.1 1.1 0 1 0 1.6-1.6l-2.7-2.7V7.6c0-.6-.5-1.1-1.1-1.1z"/></svg>',
  skip: '<svg viewBox="0 0 24 24"><path d="M5.3 4.4 15 11a1.2 1.2 0 0 1 0 2l-9.7 6.6A1.2 1.2 0 0 1 3.4 18.6V5.4a1.2 1.2 0 0 1 1.9-1zM18.5 4a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-3 0v-13A1.5 1.5 0 0 1 18.5 4z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M13.2 3.6a1 1 0 0 1 1.1.2l7.2 7a1 1 0 0 1 0 1.4l-7.2 7a1 1 0 0 1-1.7-.7v-3.4C7.4 15.1 4.3 17 2.6 20c-.3.5-1 .3-1-.3.4-6.4 4.6-10.9 11-11.5V4.5a1 1 0 0 1 .6-.9z"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M12 2.8c5.5 0 9.9 3.7 9.9 8.3 0 4.6-4.4 8.3-9.9 8.3-1 0-2-.1-2.9-.4L4.6 21c-.6.3-1.2-.3-1-.9l1.2-3.7a7.7 7.7 0 0 1-2.7-5.3c0-4.6 4.4-8.3 9.9-8.3zM7.6 9.8a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm4.4 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm4.4 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><path d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zM9.3 8A1.3 1.3 0 0 0 8 9.3v5.4c0 .7.6 1.3 1.3 1.3h5.4c.7 0 1.3-.6 1.3-1.3V9.3c0-.7-.6-1.3-1.3-1.3z"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M20 3v12.5a3.5 3.5 0 1 1-2-3.2V7.4l-9 2v8.1a3.5 3.5 0 1 1-2-3.2V5.8c0-.5.3-.9.8-1l11-2.4c.6-.1 1.2.3 1.2 1z"/></svg>',
};

// ---------- quick instructions per kind ----------
const PRESETS = {
  issue: [
    ['', 'Fix it', 'Fix this issue on a new branch and open a draft PR.', 'branch → fix → draft PR'],
    ['', 'Investigate first', 'Investigate the cause. Do not change code. Report what you found and propose a fix.', 'read-only, comes back with findings'],
    ['', 'Plan it', 'Write an implementation plan as a markdown summary. Ask me anything unclear.', 'no code, a plan'],
    ['', 'Ask me first', 'Read everything, then ask me the questions you need answered before you start.', 'comes straight back to the feed'],
  ],
  review: [
    ['', 'Review it', 'Review this PR carefully. Draft review comments for me but do NOT post them. Tell me your verdict.', 'drafts only, nothing posted'],
    ['', 'Explain the diff', 'Explain what this PR changes and what could break, in plain words.', '2-minute read'],
    ['', 'Run it', 'Check out the PR, run the tests and the build, and report what fails.', 'tests + build'],
  ],
  'my-pr': [
    ['', 'Get it green', "Check this PR's CI. Fix whatever fails and push.", 'fixes CI and pushes'],
    ['', 'Address comments', 'Read the review comments on this PR and address them. Push the changes and summarise what you did.', 'one commit per comment'],
    ['', 'Update from main', 'Merge the latest main into this branch, resolve conflicts, run tests and push.', 'merge + conflicts'],
  ],
  task: [
    ['', 'Do it', 'Do this task. If it needs code, find the right repo, branch, and open a draft PR.', 'end to end'],
    ['', 'Break it down', 'Break this task into small, concrete steps and draft them as GitHub issues (do not create them, show me).', 'drafts issues'],
    ['', 'Plan it', 'Write a short plan for this task and ask me the decisions you need.', 'plan + questions'],
  ],
};
const ACTION_EMOJI = ['', '', '', ''];

// ---------- helpers ----------
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function ago(t) { const s = (Date.now() - new Date(t).getTime()) / 1000; if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; }
function mdLite(s) { return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(https:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">link</a>').replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>').replace(/&lt;!--[\s\S]*?--&gt;/g, ''); }
function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

const AIKIND = { decide: ['', 'Decide', ''], review: ['', 'Review', ''], unblock: ['', 'Waiting on you', 'hot'], build: ['', 'Build', ''], followup: ['', 'Follow up', ''], fyi: ['', 'FYI', ''] };
const KIND = { review: ['', 'Review requested', ''], issue: ['', 'Issue', ''], 'my-pr': ['', 'Your PR', ''], task: ['', 'Roadmap', ''] };
const SRC = { gh: ['GitHub', '#24292f', 'GH'], github: ['GitHub', '#24292f', 'GH'], notion: ['Notion roadmap', '#f5f5f2', 'N', '#111'], session: ['Claude session', '#d97757', 'C'], manual: ['You', '#ff2d6f', 'Y'] };
let ME = 'Y';

function sourcesOf(it) {
  if (it.source !== 'curator') return [it.source === 'manual' ? 'manual' : it.source];
  const s = [...new Set((it.covers || []).map(c => c.split(':')[0]))];
  if (it.session) s.push('session');
  return s.length ? [...new Set(s)] : ['session'];
}
function handleOf(it) {
  const s = sourcesOf(it)[0];
  if (s === 'notion') return 'roadmap';
  if (s === 'session') return 'claude';
  if (it.repo) return it.repo.split('/')[1] || it.repo;
  return s === 'manual' ? 'you' : s;
}
function avatarOf(it) { const [, bg, letter, fg] = SRC[sourcesOf(it)[0]] || ['', '#333', '•']; return `<div class="avatar" style="background:${bg};color:${fg || '#fff'}">${letter}</div>`; }
function why(it) {
  if (it.hook) return it.hook;
  if (it.kind === 'review') return `${it.author} is waiting on your review.`;
  if (it.kind === 'my-pr') return it.draft ? 'Your draft — finish it or hand it off.' : 'Your open PR.';
  if (it.kind === 'task') return [it.status, it.priority].filter(Boolean).join(' · ') || 'From your roadmap.';
  return `Assigned to you${it.comments ? ` · ${it.comments} comments` : ''}.`;
}
function disc() { const g = data.game || {}; const live = g.combo > 1 && Date.now() - g.lastActionAt < 45000; return `<div class="disc" title="Combo"><b>x${live ? g.combo : 1}</b></div>`; }

// ---------- slides: the "video" of each card ----------
const SLIDE_MS = 5200;
function host(u) { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } }
function fmtDate(d) { const t = new Date(d); return isNaN(t) ? d : t.toLocaleDateString([], { day: 'numeric', month: 'short' }); }
function slideHtml(x) {
  switch (x.type) {
    case 'image': return `<img class="blur" src="${esc(x.src)}" alt="" aria-hidden="true"><img class="main" src="${esc(x.src)}" alt="" onload="this.parentNode.classList.toggle('wide', this.naturalWidth > this.naturalHeight * 1.15)"><span class="tag">${esc(x.label || 'Screenshot')}${x.at ? ' · ' + ago(x.at) : ''}</span>`;
    case 'video': return `<img class="blur" src="${esc(x.poster || '')}" alt="" aria-hidden="true"><video class="main" src="${esc(x.src)}" poster="${esc(x.poster || '')}" muted loop playsinline preload="metadata" onloadedmetadata="this.parentNode.classList.toggle('wide', this.videoWidth > this.videoHeight * 1.15)"></video><span class="tag">${esc(x.label || 'Recording')}${x.at ? ' · ' + ago(x.at) : ''}</span>`;
    case 'site': return `<div class="pan"><img src="${esc(x.src)}" alt="" loading="lazy"></div><a class="tag" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label || 'Live')} · ${esc(host(x.url))}</a>`;
    case 'stat': return `<div class="gfx"><div class="big">${esc(x.value)}</div><div class="lbl">${esc(x.label || '')}</div>${x.sub ? `<div class="sub">${esc(x.sub)}</div>` : ''}</div>`;
    case 'countdown': {
      const days = Math.ceil((new Date(x.date + 'T23:59:59') - Date.now()) / 864e5);
      return `<div class="gfx"><div class="big ${days <= 2 ? 'hot' : ''}">${days < 0 ? Math.abs(days) : days}</div><div class="lbl">${days < 0 ? 'days overdue' : days === 1 ? 'day left' : 'days left'}</div><div class="sub">${esc(x.label || '')} · ${esc(fmtDate(x.date))}</div></div>`;
    }
    case 'options': return `<div class="gfx"><div class="kicker">Your call</div><div class="opts">${(x.options || []).slice(0, 3).map((o, i) => `<div class="o" style="--i:${i}"><b>${'ABC'[i]}</b><div><strong>${esc(o.label)}</strong>${o.detail ? `<span>${esc(o.detail)}</span>` : ''}</div></div>`).join('')}</div></div>`;
    case 'flow': return `<div class="gfx"><div class="kicker">The plan</div><ol class="flow">${(x.steps || []).slice(0, 5).map((t, i) => `<li style="--i:${i}"><i>${i + 1}</i><span>${esc(t)}</span></li>`).join('')}</ol></div>`;
    case 'diff': {
      const max = Math.max(1, ...x.files.map(f => f.add + f.del));
      return `<div class="gfx"><div class="dnum"><span class="add">+${x.add}</span><span class="del">−${x.del}</span></div><div class="lbl">${x.count} file${x.count === 1 ? '' : 's'} · ${esc(x.state || '')}</div>
        <div class="files">${x.files.map((f, i) => `<div class="f" style="--i:${i}"><span class="fn" title="${esc(f.path)}">${esc(f.path.split('/').slice(-2).join('/'))}</span><span class="fb"><i class="a" style="width:${(f.add / max * 100).toFixed(1)}%"></i><i class="d" style="width:${(f.del / max * 100).toFixed(1)}%"></i></span></div>`).join('')}</div></div>`;
    }
    case 'checklist': {
      const pct = Math.round(x.done / x.total * 100);
      return `<div class="gfx"><div class="ring" style="--p:${pct}"><b>${x.done}/${x.total}</b></div><div class="lbl">steps done</div>
        <ul class="todo">${x.items.map((t, i) => `<li class="${t.done ? 'x' : ''}" style="--i:${i}"><i></i>${esc(t.t)}</li>`).join('')}</ul></div>`;
    }
    case 'pipeline': {
      const i = Math.max(0, x.stages.findIndex(st => st.toLowerCase() === String(x.at).toLowerCase()));
      return `<div class="gfx"><div class="kicker">Roadmap status</div><ol class="pipe">${x.stages.map((st, j) => `<li class="${j < i ? 'past' : j === i ? 'here' : ''}" style="--i:${j}"><i></i><span>${esc(st)}</span></li>`).join('')}</ol>
        ${x.chips?.length ? `<div class="chips">${x.chips.map(c => `<span>${esc(c)}</span>`).join('')}</div>` : ''}</div>`;
    }
    case 'outline': return `<div class="gfx"><div class="kicker">On the page</div><ol class="outline">${x.items.map((t, i) => `<li style="--i:${i}">${esc(t)}</li>`).join('')}</ol></div>`;
    case 'thread': return `<div class="gfx"><div class="kicker">${esc(x.repo || '')}</div><div class="big">#${esc(x.number)}</div>
        <div class="lbl">${x.kind === 'issue' ? 'Issue' : x.draft ? 'Draft PR' : 'Pull request'} · open ${x.days} day${x.days === 1 ? '' : 's'}</div>
        <div class="bubbles">${Array.from({ length: Math.min(8, x.comments) }, (_, i) => `<i style="--i:${i}"></i>`).join('')}<span>${x.comments} comment${x.comments === 1 ? '' : 's'}${x.author ? ' · by @' + esc(x.author) : ''}</span></div>
        ${x.labels.length ? `<div class="chips">${x.labels.slice(0, 4).map(l => `<span>${esc(l)}</span>`).join('')}</div>` : ''}</div>`;
    case 'activity': {
      const max = Math.max(1, ...x.buckets);
      return `<div class="gfx"><div class="kicker">Claude session · last 24 h</div><div class="spark">${x.buckets.map((b, i) => `<i style="--h:${(b / max * 100).toFixed(0)}%;--i:${i}"></i>`).join('')}</div>
        <div class="lbl">${x.messages} messages</div><div class="chips">${x.tools.map(t => `<span>${esc(t.name)} <b>${t.n}</b></span>`).join('')}</div></div>`;
    }
  }
  return '';
}
function slidesHtml(it) {
  const s = it.slides || []; if (!s.length) return '';
  const n = s.length + 1; // + the text slide (the poster)
  return `<div class="vis">${s.map((x, i) => `<div class="sl sl-${esc(x.type)}${i === 0 ? ' on' : ''}" data-i="${i}">${slideHtml(x)}</div>`).join('')}</div>
    <div class="vbars">${Array.from({ length: n }, (_, i) => `<i data-goto="${i}" class="${i === 0 ? 'now' : ''}"><b></b></i>`).join('')}</div>
    <button class="vnav prev" data-slide="-1" aria-label="Previous slide"></button><button class="vnav next" data-slide="1" aria-label="Next slide"></button>`;
}
function setSlide(card, i, auto) {
  const media = card?.querySelector('.media.has-vis'); if (!media) return;
  const bars = [...media.querySelectorAll('.vbars i')]; const n = bars.length;
  i = Math.max(0, Math.min(n - 1, i)); media.dataset.slide = i;
  media.querySelectorAll('.sl').forEach(s => s.classList.toggle('on', +s.dataset.i === i));
  media.querySelector('.poster').classList.toggle('on', i === n - 1);
  media.classList.toggle('on-text', i === n - 1);
  playVisible();
  bars.forEach((b, j) => { b.className = j < i ? 'past' : ''; });
  void media.offsetWidth; bars[i].className = 'now' + (auto === false ? ' held' : '');
  clearTimeout(slideT);
  if (i < n - 1 && auto !== false) slideT = setTimeout(() => { if ($('#sheet').hidden && !document.hidden && card.classList.contains('current')) setSlide(card, i + 1); }, SLIDE_MS);
}
let slideT;
function playVisible() {
  document.querySelectorAll('#feed video').forEach(v => {
    const on = v.closest('.card')?.classList.contains('current') && (!v.closest('.sl') || v.closest('.sl').classList.contains('on'));
    if (on) { if (v.paused) { v.currentTime = 0; v.play().catch(() => {}); } } else if (!v.paused) v.pause();
  });
}
function stepSlide(card, d) { const m = card?.querySelector('.media.has-vis'); if (m) setSlide(card, (+m.dataset.slide || 0) + d); return !!m; }

// ---------- cards ----------
function itemCard(it) {
  const ai = it.source === 'curator';
  const [ico, label, tone] = (ai ? AIKIND : KIND)[it.kind] || ['', it.kind, ''];
  const srcs = sourcesOf(it).map(s => (SRC[s] || [s])[0]);
  const tags = [it.kind && `#${slug(label)}`, it.effort && `#${slug(it.effort)}`, ...(it.labels || []).slice(0, 2).map(l => '#' + slug(l)), it.repo && `#${slug(it.repo.split('/')[1])}`].filter(Boolean);
  const body = ai ? it.body : it.body;
  const ageFrac = Math.min(1, (Date.now() - new Date(it.updatedAt).getTime()) / (7 * 864e5));
  const chip = it.session?.id ? `<button class="chipline" data-act="copy" data-text="cd ${esc(it.session.cwd)} && claude --resume ${esc(it.session.id)}">Resume session</button><br>`
    : it.links?.[0] ? `<a class="chipline" href="${esc(it.links[0].url)}" target="_blank" rel="noopener">${esc(it.links[0].label)}</a><br>`
    : it.number ? `<a class="chipline" href="${esc(it.url)}" target="_blank" rel="noopener">#${it.number}</a><br>` : '';
  const vis = slidesHtml(it);
  return `<section class="card ${ai ? 'k-ai k-ai-' + esc(it.kind) : 'k-' + esc(it.kind)}" data-id="${esc(it.id)}">
    <div class="slot"><div class="media${vis ? ' has-vis' : ''}" data-slide="0"><div class="bgfx"></div>
    ${vis}${vis ? `<div class="vhead"><span class="sticker ${tone}">${esc(label)}</span><h3>${esc(it.title)}</h3></div>` : ''}
    <div class="poster">
      <span class="sticker ${tone}">${esc(label)}</span>
      <h2>${esc(it.title)}</h2>
      ${body ? `<div class="lede">${mdLite(body)}</div>` : ''}
    </div>
    <div class="caption">
      ${chip}
      <div class="handle">@${esc(handleOf(it))} <small>· ${ago(it.updatedAt)}</small></div>
      <div class="cap-text" data-act="more">${esc(why(it))}</div>
      <div class="tags">${tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>
      <div class="sound">${I.note}<div class="marquee"><span>original sound - ${esc(srcs.join(' + '))}${it.repo ? ' · ' + esc(it.repo) : ''}</span><span>original sound - ${esc(srcs.join(' + '))}${it.repo ? ' · ' + esc(it.repo) : ''}</span></div></div>
    </div>
    <div class="scrub"><i style="width:${(ageFrac * 100).toFixed(0)}%"></i></div>
    </div>
    <div class="rail">
      <button class="av-wrap" data-act="agent" title="Send an agent (A)" aria-label="Send an agent">${avatarOf(it)}<span class="follow">+</span></button>
      <button class="act" data-act="agent" title="Send an agent (A)"><span class="ico">${I.robot}</span><span>Agent</span></button>
      <button class="act" data-act="done" title="Done (D)"><span class="ico">${I.check}</span><span>Done</span></button>
      <button class="act" data-act="snooze" title="Later (Z)"><span class="ico">${I.clock}</span><span>Later</span></button>
      <button class="act" data-act="skip" title="Skip (S)"><span class="ico">${I.skip}</span><span>Skip</span></button>
      ${it.url ? `<a class="act" href="${esc(it.url)}" target="_blank" rel="noopener" title="Open (O)"><span class="ico">${I.share}</span><span>Open</span></a>` : ''}
      ${disc()}
    </div>
    </div>
  </section>`;
}

const STATUS = { 'needs-you': ['Needs you', 'hot'], running: ['Working…', 'violet'], queued: ['Queued', ''], done: ['Done', 'ok'], failed: ['Failed', 'hot'], stopped: ['Stopped', ''] };
function agentCard(a) {
  const [label, tone] = STATUS[a.status] || [a.status, ''];
  const log = (a.log || []).slice(-10).map(l => `<div class="${l.t}">${esc(l.s)}</div>`).join('');
  let poster = '';
  if (a.status === 'needs-you') poster = `<div class="bubble">${mdLite(a.question || 'Needs you')}</div>`;
  else if (a.status === 'done') poster = `<div class="lede">${mdLite(a.summary || 'Finished.')}</div>`;
  else if (a.status === 'failed' || a.status === 'stopped') poster = `<div class="lede">${mdLite(a.summary || '')}</div>`;
  else poster = `<div class="term" data-autoscroll>${log || '<div class="say">Spinning up…</div>'}</div>`;
  const msgs = (a.history || []).length;
  if (a.shot) {
    const m = a.shot.video || /\.mp4$/.test(a.shot.src) ? `<video src="${esc(a.shot.src)}" poster="${esc(a.shot.poster || '')}" muted loop playsinline preload="metadata"></video>` : `<img src="${esc(a.shot.src)}" alt="">`;
    poster = `<figure class="ashot">${m}<figcaption>${esc(a.shot.label || '')}</figcaption></figure>` + poster;
  }
  if (a.diff && a.status !== 'running' && a.status !== 'queued') {
    const max = Math.max(1, ...a.diff.files.map(f => f.add + f.del));
    poster += `<div class="adiff"><div class="dnum"><span class="add">+${a.diff.add}</span><span class="del">−${a.diff.del}</span><small>${a.diff.count} file${a.diff.count === 1 ? '' : 's'}</small></div>
      <div class="files">${a.diff.files.map((f, i) => `<div class="f" style="--i:${i}"><span class="fn" title="${esc(f.path)}">${esc(f.path.split('/').slice(-2).join('/'))}</span><span class="fb"><i class="a" style="width:${(f.add / max * 100).toFixed(1)}%"></i><i class="d" style="width:${(f.del / max * 100).toFixed(1)}%"></i></span></div>`).join('')}</div></div>`;
  }
  return `<section class="card a-${a.status}" data-id="agent:${esc(a.id)}">
    <div class="slot"><div class="media"><div class="bgfx"></div>
    <div class="poster">
      <span class="sticker ${tone} status"><i></i>${label}</span>
      <h2>${esc(a.title)}</h2>
      ${poster}
    </div>
    <div class="caption">
      ${a.denials?.length ? `<button class="chipline" data-act="chat">Wants to run ${esc(a.denials[0].rule)}</button><br>` : a.prUrl ? `<a class="chipline" href="${esc(a.prUrl)}" target="_blank" rel="noopener">Pull request</a><br>` : ''}
      <div class="handle">@agent-${esc(a.id)} <small>· ${ago(a.endedAt || a.startedAt)}${a.cost ? ` · $${a.cost.toFixed(2)}` : ''}</small></div>
      <div class="cap-text" data-act="more">${esc(a.instruction || a.summary || '')}</div>
      <div class="tags">${a.repo ? `<span>#${esc(slug(a.repo.split('/').pop()))}</span>` : ''}<span>#${slug(label)}</span></div>
      <div class="sound">${I.note}<div class="marquee"><span>original sound - agent-${esc(a.id)}${a.repo ? ' · ' + esc(a.repo) : ''}</span><span>original sound - agent-${esc(a.id)}${a.repo ? ' · ' + esc(a.repo) : ''}</span></div></div>
    </div>
    <div class="scrub"><i style="width:${a.status === 'running' ? 60 : 100}%"></i></div>
    </div>
    <div class="rail">
      <button class="av-wrap" data-act="chat" aria-label="Open chat"><div class="avatar bot">${I.robot}</div>${a.status === 'needs-you' ? '<span class="follow">!</span>' : ''}</button>
      <button class="act" data-act="chat" title="Reply (C)"><span class="ico">${I.chat}</span><span>${a.status === 'needs-you' ? 'Reply' : msgs}</span></button>
      ${a.status === 'done' ? `<button class="act lit" data-act="ship" title="Looks good (D)"><span class="ico">${I.check}</span><span>Ship it</span></button>` : ''}
      ${a.status === 'running' || a.status === 'queued' ? `<button class="act" data-act="stop" title="Stop"><span class="ico">${I.stop}</span><span>Stop</span></button>` : ''}
      ${a.status === 'failed' || a.status === 'stopped' ? `<button class="act" data-act="retry"><span class="ico">${I.skip}</span><span>Retry</span></button><button class="act" data-act="ship"><span class="ico">${I.check}</span><span>Dismiss</span></button>` : ''}
      ${a.prUrl || a.url ? `<a class="act" href="${esc(a.prUrl || a.url)}" target="_blank" rel="noopener"><span class="ico">${I.share}</span><span>${a.prUrl ? 'PR' : 'Source'}</span></a>` : ''}
      ${disc()}
    </div>
    </div>
  </section>`;
}

// ---------- render ----------
function visible() {
  return data.feed.filter(c => tab === 'all' ? true : tab === 'needs' ? c.type === 'agent' && ['needs-you', 'failed', 'done'].includes(c.status) : c.type === 'agent');
}
function keyOf(c) { return c.type === 'agent' ? 'agent:' + c.id : c.id; }

function render(reorder) {
  const list = visible(); const byKey = new Map(list.map(c => [keyOf(c), c]));
  const cur = currentKey();
  if (reorder || !order.length) order = list.map(keyOf);
  else {
    order = order.filter(k => byKey.has(k));
    const fresh = list.map(keyOf).filter(k => !order.includes(k));
    const urgent = fresh.filter(k => byKey.get(k).type === 'agent'); // agents that need you slot in right after where you are
    const rest = fresh.filter(k => !urgent.includes(k));
    order.splice(Math.max(0, order.indexOf(cur) + 1), 0, ...urgent); order.push(...rest);
  }
  for (const [k, n] of nodes) if (!byKey.has(k)) { n.el.remove(); nodes.delete(k); }
  let prev = null;
  for (const k of order) {
    const c = byKey.get(k);
    const sig = JSON.stringify(c.type === 'agent' ? [c.status, c.log?.length, c.question, c.summary, c.cost, c.denials, c.history?.length, c.diff, c.shot] : [c.title, c.body, c.hook, c.slides]);
    let n = nodes.get(k);
    if (!n || n.sig !== sig) {
      const tpl = document.createElement('template'); tpl.innerHTML = (c.type === 'agent' ? agentCard(c) : itemCard(c)).trim();
      const el = tpl.content.firstChild;
      if (n) { if (n.el.classList.contains('current')) el.classList.add('current'); n.el.replaceWith(el); }
      n = { el, sig }; nodes.set(k, n);
      el.querySelectorAll('[data-autoscroll]').forEach(l => l.scrollTop = l.scrollHeight);
    }
    const want = prev ? prev.nextSibling : feedEl.firstChild;
    if (want !== n.el) feedEl.insertBefore(n.el, want);
    prev = n.el;
  }
  const empty = feedEl.querySelector('.empty');
  if (!order.length && !empty) { feedEl.append($('#emptyTpl').content.cloneNode(true)); feedEl.querySelector('#emptySync').onclick = sync; }
  else if (order.length && empty) empty.remove();
  const curEl = cur && nodes.get(cur)?.el;
  if (curEl && !reorder && Math.abs(feedEl.scrollTop - curEl.offsetTop) > 4) feedEl.scrollTop = curEl.offsetTop;
  markCurrent(); counts();
  if (sheet.mode === 'chat') renderChat();
}

function counts() {
  const needs = data.feed.filter(c => c.type === 'agent' && c.status === 'needs-you').length;
  const live = data.feed.filter(c => c.type === 'agent' && (c.status === 'running' || c.status === 'queued')).length;
  document.querySelectorAll('.needsCount').forEach(b => { b.hidden = !needs; b.textContent = needs; });
  document.querySelectorAll('.agentsCount').forEach(b => { b.hidden = !live; b.textContent = live; });
  $('#liveDot').hidden = !live;
  document.title = needs ? `(${needs}) ShipTok` : 'ShipTok';
}

function hud(g) {
  if (!g) return; data.game = g;
  const pct = Math.min(1, (g.xp - g.prevAt) / Math.max(1, g.nextAt - g.prevAt));
  $('#lvlNum').textContent = g.level; $('#lvlRing').style.strokeDashoffset = 100 - pct * 100;
  $('#xpText').textContent = `${g.xp} XP`; $('#xpNext').textContent = `${g.nextAt - g.xp} XP to level ${g.level + 1}`;
  const live = g.combo > 1 && Date.now() - g.lastActionAt < 45000;
  $('#combo').textContent = 'x' + (live ? g.combo : 1); $('#combo').classList.toggle('live', live);
  $('#streakNum').textContent = g.streak || 0;
  const today = todayCount(g);
  $('#goalNum').textContent = `${today}/${g.dailyGoal}`; $('#goalBar').style.width = Math.min(100, today / g.dailyGoal * 100) + '%';
  document.querySelectorAll('.disc b').forEach(b => b.textContent = 'x' + (live ? g.combo : 1));
  if (!$('#profile').hidden) renderProfile();
}
function todayCount(g) { return g.todayDay === new Date().toISOString().slice(0, 10) ? g.today : 0; }

// ---------- navigation ----------
function cards() { return [...feedEl.querySelectorAll('.card')]; }
function currentCard() { const y = feedEl.scrollTop + feedEl.clientHeight / 2; return cards().find(c => c.offsetTop <= y && c.offsetTop + c.offsetHeight > y); }
function currentKey() { return currentCard()?.dataset.id; }
function markCurrent() {
  const c = currentCard(); const was = feedEl.querySelector('.card.current');
  cards().forEach(x => x.classList.toggle('current', x === c));
  if (c && c !== was) setSlide(c, 0);
  playVisible();
}
function scrollToKey(k, behavior = 'smooth') { const el = nodes.get(k)?.el; if (el) feedEl.scrollTo({ top: el.offsetTop, behavior }); }
function next(dir = 1) { const cs = cards(); const i = cs.indexOf(currentCard()); const t = cs[Math.max(0, Math.min(cs.length - 1, i + dir))]; if (t) feedEl.scrollTo({ top: t.offsetTop, behavior: 'smooth' }); }
let scrollT; feedEl.addEventListener('scroll', () => { clearTimeout(scrollT); scrollT = setTimeout(markCurrent, 80); });

function setTab(t) {
  tab = t; order = []; render(true); feedEl.scrollTo({ top: 0 });
  document.querySelectorAll('#tabs [data-tab]').forEach(x => x.classList.toggle('on', x.dataset.tab === t));
  const nav = { all: 'home', agents: 'agents', needs: 'inbox' }[t];
  document.querySelectorAll('[data-nav]').forEach(x => x.classList.toggle('on', x.dataset.nav === nav));
  $('#profile').hidden = true;
}
document.querySelectorAll('#tabs [data-tab]').forEach(b => b.onclick = () => setTab(b.dataset.tab));
$('#liveBtn').onclick = () => setTab('agents');
$('#refresh').onclick = () => sync();
$('#refreshSide').onclick = () => sync();
$('#upBtn').onclick = () => next(-1);
$('#downBtn').onclick = () => next(1);
document.addEventListener('click', e => {
  const b = e.target.closest('.sidenav [data-nav], #bottomnav [data-nav]'); if (!b) return;
  const n = b.dataset.nav;
  if (n === 'new') return openNew();
  if (n === 'profile') { document.querySelectorAll('[data-nav]').forEach(x => x.classList.toggle('on', x.dataset.nav === 'profile')); $('#profile').hidden = false; return renderProfile(); }
  setTab({ home: 'all', agents: 'agents', inbox: 'needs' }[n]);
});

function modeSwitch(demo) {
  const b = $('#modeBtn'); if (!b) return;
  document.body.classList.toggle('demo', !!demo);
  b.innerHTML = demo ? '<i></i>Demo data · <u>switch to live</u>' : '<i></i>Live · <u>switch to demo</u>';
  b.href = demo ? `${location.protocol}//${location.hostname}:4777/` : '/demo';
  b.title = demo ? 'Made-up startup and scripted agents. Press R to reset the demo.' : 'Opens a made-up feed you can show or record';
}
function spin(on) { ['#refresh', '#refreshSide'].forEach(q => $(q)?.classList.toggle('spin', !!on)); }

// ---------- actions ----------
async function load(reorder) { const j = await api('feed'); data = j; modeSwitch(j.demo); if (j.me) { ME = esc(j.me[0].toUpperCase()); SRC.manual[2] = ME; document.querySelectorAll('.avatar.me').forEach(x => x.textContent = ME); } hud(j.game); render(reorder); spin('spin', !!(j.syncing || j.curating)); }
async function sync() { spin(true); toast('Curating your feed'); await api('sync', { curate: true }); }

async function leave(card) { card.classList.add('leaving'); next(1); await new Promise(r => setTimeout(r, 300)); }
function itemOf(k) { return data.feed.find(c => keyOf(c) === k); }

feedEl.addEventListener('click', async e => {
  const nav = e.target.closest('[data-slide],[data-goto]');
  if (nav) { const card = nav.closest('.card'); return nav.dataset.goto ? setSlide(card, +nav.dataset.goto) : stepSlide(card, +nav.dataset.slide); }
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const card = btn.closest('.card'); const k = card.dataset.id; const act = btn.dataset.act;
  const agentId = k.startsWith('agent:') ? k.slice(6) : null;
  try {
    if (act === 'more') return btn.classList.toggle('open');
    if (act === 'agent') return openDispatch(itemOf(k));
    if (act === 'chat') return openChat(agentId);
    if (act === 'copy') { await navigator.clipboard.writeText(btn.dataset.text); return toast('Copied. Paste it in a terminal'); }
    if (['skip', 'snooze', 'done'].includes(act)) return hideItem(card, act, btn);
    if (act === 'stop') { await api('stop', { id: agentId }); return; }
    if (act === 'retry') return replyTo(agentId, 'Try again. If you hit the same problem, explain it and ask me with QUESTION:.');
    if (act === 'ship') { burst(btn); await leave(card); await api('archive', { id: agentId, hideItem: true }); return load(); }
  } catch (err) { toast(err.message); }
});
async function hideItem(card, how, fromEl) {
  if (how === 'done') burst(fromEl);
  await leave(card); const r = await api('hide', { itemId: card.dataset.id, how }); celebrate(r, fromEl); load();
}
// double-tap a card: done (like the heart, but it clears your plate)
let lastTap = 0;
feedEl.addEventListener('click', e => {
  if (e.target.closest('button,a,.term,.lede,.bubble')) return;
  const now = Date.now(); const card = e.target.closest('.card'); if (!card || card.classList.contains('empty')) return;
  if (now - lastTap < 320) {
    burst({ getBoundingClientRect: () => ({ left: e.clientX, top: e.clientY, width: 0, height: 0 }) });
    const k = card.dataset.id;
    if (k.startsWith('agent:')) { const a = itemOf(k); if (a?.status === 'done') card.querySelector('[data-act="ship"]')?.click(); }
    else hideItem(card, 'done');
    lastTap = 0;
  } else lastTap = now;
});

async function replyTo(id, text, allow) {
  try { await api('reply', { id, text, allow }); toast(allow ? 'Sent and allowed. The agent is back on it' : 'Sent. The agent is back on it'); }
  catch (e) { toast(e.message); }
}

// ---------- sheet: dispatch / chat / capture ----------
const sheet = { mode: null, ref: null, chosen: null, allow: new Set() };
function showSheet(head, body, placeholder) {
  $('#sheetHead').textContent = head; $('#sheetBody').innerHTML = body;
  $('#sheetForm').hidden = placeholder === null; $('#sheetText').placeholder = placeholder || '';
  $('#sheet').hidden = false; document.body.classList.add('panel-open');
}
function closeSheet() { $('#sheet').hidden = true; document.body.classList.remove('panel-open'); sheet.mode = null; $('#sheetText').value = ''; feedEl.focus(); }

function openDispatch(it) {
  if (!it) return;
  Object.assign(sheet, { mode: 'dispatch', ref: it, chosen: null });
  const presets = it.actions?.length ? it.actions.map((a, i) => [ACTION_EMOJI[i % 4], a.label, a.instruction, a.sub]) : (PRESETS[it.kind] || PRESETS.issue);
  showSheet(`${presets.length} move${presets.length === 1 ? '' : 's'}`, `<h4>${esc(it.title)}</h4>` + presets.map(([em, t, ins, sub], i) =>
    `<button type="button" class="opt" data-i="${i}" data-ins="${esc(ins)}"><div class="avatar key">${i + 1}</div><div><b>${esc(t)}</b><small>${esc(sub || '')}</small></div><span class="go">Send</span></button>`).join(''),
    'Or say what to do…');
}
function chatBody(a) {
  const hist = (a.history || []).map(m => `<div class="msg ${m.who}"><div class="avatar ${m.who === 'you' ? 'me' : 'bot'}">${m.who === 'you' ? ME : I.robot}</div><div><div class="who">${m.who === 'you' ? 'you' : '@agent-' + esc(a.id)} · ${ago(m.at)}</div><div class="txt">${mdLite(m.text || '')}</div></div></div>`).join('');
  let tail = '';
  if (a.status === 'needs-you') {
    tail += (a.denials || []).map(d => `<button type="button" class="allow ${sheet.allow.has(d.rule) ? 'on' : ''}" data-rule="${esc(d.rule)}"><code>${esc(d.tool === 'Bash' ? d.input?.command : d.tool + ' ' + (d.input?.file_path || ''))}</code><em>${sheet.allow.has(d.rule) ? 'Allowing' : 'Allow ' + esc(d.rule)}</em></button>`).join('');
    tail += a.external ? `<p class="fine" style="color:#666">Answer it in its own session: <code>claude --resume ${esc(a.sessionId)}</code></p>`
      : `<div class="quick"><button type="button" data-quick="Yes, go ahead.">Yes, go</button><button type="button" data-quick="No. Stop here and summarise.">No</button><button type="button" data-quick="Your call — pick the option you think is best and continue.">Your call</button></div>`;
  }
  if (a.status === 'running' || a.status === 'queued') tail += `<div class="msg"><div class="avatar bot">${I.robot}</div><div><div class="who">working…</div><div class="txt">${esc(a.log?.at(-1)?.s || 'Spinning up…')}</div></div></div>`;
  const acts = [a.prUrl && `<a class="primary" href="${esc(a.prUrl)}" target="_blank" rel="noopener">Open PR</a>`, a.status === 'done' && `<button type="button" data-sheet-act="ship">Ship it</button>`,
    (a.status === 'running' || a.status === 'queued') && `<button type="button" data-sheet-act="stop">Stop</button>`].filter(Boolean).join('');
  return hist + tail + (acts ? `<div class="sheet-actions">${acts}</div>` : '');
}
function openChat(id) {
  const a = data.feed.find(c => c.type === 'agent' && c.id === id); if (!a) return;
  Object.assign(sheet, { mode: 'chat', ref: id, allow: new Set() });
  showSheet(`${(a.history || []).length} messages`, chatBody(a), a.external ? null : a.status === 'done' ? 'Ask for changes…' : 'Reply to the agent…');
  const b = $('#sheetBody'); b.scrollTop = b.scrollHeight;
  if (a.status === 'needs-you') setTimeout(() => $('#sheetText').focus(), 60);
}
function renderChat() {
  const a = data.feed.find(c => c.type === 'agent' && c.id === sheet.ref); if (!a) return;
  const b = $('#sheetBody'); const atEnd = b.scrollTop + b.clientHeight > b.scrollHeight - 30;
  $('#sheetHead').textContent = `${(a.history || []).length} messages`; b.innerHTML = chatBody(a); if (atEnd) b.scrollTop = b.scrollHeight;
}
function openNew() {
  Object.assign(sheet, { mode: 'new', ref: null });
  showSheet('Capture a card', `<label class="field">What needs doing?<input id="newTitle" placeholder="e.g. Fix the upload retry on slow wifi"></label>
    <label class="field">Repository (optional)<input id="newRepo" placeholder="owner/name" list="repoList"></label>
    <p class="fine" style="color:#777">It lands in your feed. Add details below, then send an agent at it whenever you like.</p>`, 'Details for the agent (optional)…');
  api('repos').then(r => { const dl = document.createElement('datalist'); dl.id = 'repoList'; dl.innerHTML = Object.keys(r).map(k => `<option value="${esc(k)}">`).join(''); $('#sheetBody').append(dl); });
  setTimeout(() => $('#newTitle').focus(), 60);
}

$('#sheet').addEventListener('click', async e => {
  if (e.target.closest('[data-close]')) return closeSheet();
  const opt = e.target.closest('.opt');
  if (opt) {
    if (sheet.chosen === opt || e.target.closest('.go')) { $('#sheetText').value = opt.dataset.ins; return $('#sheetForm').requestSubmit(); }
    document.querySelectorAll('.opt.on').forEach(o => o.classList.remove('on')); opt.classList.add('on'); sheet.chosen = opt; $('#sheetText').value = opt.dataset.ins; return;
  }
  const al = e.target.closest('.allow');
  if (al) {
    const a = data.feed.find(c => c.type === 'agent' && c.id === sheet.ref);
    if (!a?.question || /^I was blocked by a permission/.test(a.question)) { closeSheet(); return replyTo(sheet.ref, '', [al.dataset.rule]); }
    sheet.allow.has(al.dataset.rule) ? sheet.allow.delete(al.dataset.rule) : sheet.allow.add(al.dataset.rule); return renderChat();
  }
  const q = e.target.closest('[data-quick]');
  if (q) { const id = sheet.ref, allow = [...sheet.allow]; closeSheet(); return replyTo(id, q.dataset.quick, allow.length ? allow : null); }
  const sa = e.target.closest('[data-sheet-act]');
  if (sa) { const id = sheet.ref; closeSheet(); if (sa.dataset.sheetAct === 'stop') return api('stop', { id }); const el = nodes.get('agent:' + id)?.el; if (el) await leave(el); await api('archive', { id, hideItem: true }); return load(); }
});
$('#sheetText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#sheetForm').requestSubmit(); } });
$('#sheetText').addEventListener('input', e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; });
$('#sheetForm').addEventListener('submit', async e => {
  e.preventDefault(); const text = $('#sheetText').value.trim();
  try {
    if (sheet.mode === 'dispatch') {
      if (!text) return toast('Pick a move or type what to do');
      const it = sheet.ref; closeSheet(); const card = nodes.get(it.id)?.el; if (card) await leave(card);
      const r = await api('dispatch', { itemId: it.id, instruction: text }); toast("Agent sent. It'll come back here"); load(); return;
    }
    if (sheet.mode === 'chat') {
      if (!text && !sheet.allow.size) return;
      const id = sheet.ref, allow = [...sheet.allow]; closeSheet(); return replyTo(id, text, allow.length ? allow : null);
    }
    if (sheet.mode === 'new') {
      const title = $('#newTitle').value.trim(); if (!title) return toast('Give it a title');
      await api('item', { title, repo: $('#newRepo').value.trim() || undefined, body: text }); closeSheet(); toast('Added to your feed'); load();
    }
  } catch (err) { toast(err.message); }
});

// ---------- profile ----------
const BADGES = [['first-blood', 'First agent'], ['unblocker', 'Unblocker'], ['combo-5', '5x combo'], ['goal', 'Daily goal'], ['streak-3', '3-day streak'], ['streak-7', '7-day streak']];
function renderProfile() {
  const g = data.game || {}; const c = data.curator || {};
  const pct = Math.min(1, (g.xp - g.prevAt) / Math.max(1, g.nextAt - g.prevAt)); const today = todayCount(g);
  const agents = data.feed.filter(x => x.type === 'agent');
  $('#profile').innerHTML = `<div class="prof-top">
      <div class="prof-av"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="16.5" class="track"/><circle cx="18" cy="18" r="16.5" class="fill" pathLength="100" style="stroke-dashoffset:${100 - pct * 100}"/></svg><div class="avatar me">${ME}</div><span class="lv">Lv ${g.level || 1}</span></div>
      <h3>@${esc((data.me || 'you').toLowerCase())}</h3><div class="sub">${g.xp || 0} XP · ${Math.max(0, (g.nextAt || 0) - (g.xp || 0))} to level ${(g.level || 1) + 1}</div>
    </div>
    <div class="stats"><div><b>${g.streak || 0}</b><span>day streak</span></div><div><b>${today}</b><span>moves today</span></div><div><b>${agents.length}</b><span>agents</span></div></div>
    <div class="goalcard"><div class="row"><span>Daily goal</span><b>${today}/${g.dailyGoal || 10}</b></div><div class="bar"><i style="width:${Math.min(100, today / (g.dailyGoal || 10) * 100)}%"></i></div></div>
    <div class="badges">${BADGES.map(([id, l]) => `<div class="${(g.badges || []).includes(id) ? 'got' : ''}">${l}</div>`).join('')}</div>
    <p class="fine">Curator: ${c.runs || 0} runs · $${(c.totalCost || 0).toFixed(2)} spent · last ${c.lastAt ? ago(c.lastAt) + ' ago' : 'never'}${c.lastCount ? ` · ${c.lastCount} cards` : ''}<br>
    XP: send an agent +10 · answer an agent +15 · ship it +20 · done +8 · quick moves stack a combo, 3-day streaks give +25%.</p>`;
}

// ---------- keyboard ----------
document.addEventListener('keydown', e => {
  if (e.target.matches?.('textarea,input') || e.metaKey || e.ctrlKey) { if (e.key === 'Escape') { e.target.blur(); closeSheet(); } return; }
  if (!$('#sheet').hidden) { if (e.key === 'Escape') closeSheet(); if (/^[1-4]$/.test(e.key)) document.querySelector(`.opt[data-i="${e.key - 1}"]`)?.click(); return; }
  const card = currentCard(); const act = a => card?.querySelector(`[data-act="${a}"]`)?.click();
  if ((e.key === 'ArrowRight' || e.key === 'l') && stepSlide(card, 1)) return e.preventDefault();
  if ((e.key === 'ArrowLeft' || e.key === 'h') && stepSlide(card, -1)) return e.preventDefault();
  const map = { j: () => next(1), ArrowDown: () => next(1), k: () => next(-1), ArrowUp: () => next(-1), a: () => act('agent'), s: () => act('skip'), z: () => act('snooze'),
    d: () => card?.querySelector('[data-act="done"],[data-act="ship"]')?.click(), c: () => act('chat'), o: () => card?.querySelector('a.act[href]')?.click(), r: sync };
  if (map[e.key]) { e.preventDefault(); map[e.key](); }
});

// ---------- juice ----------
let toastT;
function toast(msg, onClick) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); t.onclick = onClick || null; clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
function local(el) {
  const sr = { left: 0, top: 0, width: innerWidth, height: innerHeight }; const b = el?.getBoundingClientRect?.();
  return b ? { x: b.left - sr.left + b.width / 2, y: b.top - sr.top + (b.height || 0) / 2 } : { x: sr.width / 2, y: sr.height / 2 };
}
function burst(fromEl) {
  const p = local(fromEl); const b = document.createElement('div'); b.className = 'burst'; b.innerHTML = I.check;
  b.style.left = p.x + 'px'; b.style.top = p.y + 'px'; $('#xpfx').append(b); setTimeout(() => b.remove(), 850);
}
function celebrate(r, fromEl) {
  if (!r?.gained) return; hud(r.game);
  const p = local(fromEl); const f = document.createElement('div'); f.className = 'float';
  f.style.left = p.x + 'px'; f.style.top = p.y + 'px';
  f.innerHTML = `+${r.gained} XP${r.game.combo > 1 ? `<small>${r.game.combo}x combo</small>` : ''}`;
  $('#xpfx').append(f); setTimeout(() => f.remove(), 1200);
  if (r.levelUp) { confetti(); toast(`Level ${r.game.level}`); }
  for (const b of r.badges || []) setTimeout(() => toast(`Badge: ${b}`), 900);
  if (navigator.vibrate) navigator.vibrate(12);
}
function confetti() {
  const c = $('#confetti'); const x = c.getContext('2d'); const W = c.width = c.offsetWidth, H = c.height = c.offsetHeight;
  const cols = ['#fe2c55', '#25f4ee', '#ffffff', '#fe2c55', '#25f4ee'];
  const ps = Array.from({ length: 120 }, () => ({ x: W / 2, y: H / 3, vx: (Math.random() - .5) * 12, vy: Math.random() * -12 - 4, r: Math.random() * 6 + 3, c: cols[Math.random() * 5 | 0], a: Math.random() * 6 }));
  let f = 0; (function tick() { x.clearRect(0, 0, W, H); for (const p of ps) { p.vy += .4; p.x += p.vx; p.y += p.vy; p.a += .2; x.fillStyle = p.c; x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * .6); x.restore(); } if (++f < 110) requestAnimationFrame(tick); else x.clearRect(0, 0, W, H); })();
}

// ---------- live ----------
const es = new EventSource('/api/events');
let reloadT; const soon = () => { clearTimeout(reloadT); reloadT = setTimeout(() => load(), 250); };
const lastNeeds = new Set();
es.addEventListener('feed', soon);
es.addEventListener('agent', e => {
  const a = JSON.parse(e.data);
  if (a.status === 'needs-you' && !lastNeeds.has(a.id)) {
    lastNeeds.add(a.id);
    toast(`Needs you: ${a.title.slice(0, 44)}`, () => { setTab('all'); setTimeout(() => scrollToKey('agent:' + a.id), 50); });
    if (document.hidden && window.Notification?.permission === 'granted') new Notification('An agent needs you', { body: a.question || a.title });
  }
  if (a.status !== 'needs-you') lastNeeds.delete(a.id);
  soon();
});
es.addEventListener('xp', e => { const r = JSON.parse(e.data); if (r.kind === 'agentDone') { celebrate(r); toast(`Agent finished: ${r.note?.slice(0, 44)}`); } else hud(r.game); });
es.addEventListener('curator', e => { const c = JSON.parse(e.data); spin('spin', !!c.running); if (!c.running && c.lastCount) toast(`${c.lastCount} new cards`); });
es.addEventListener('sync', e => { const s = JSON.parse(e.data); if ('running' in s) spin('spin', s.running); if (s.errors?.length) toast(s.errors[0].slice(0, 90)); });

document.addEventListener('click', () => { if (window.Notification?.permission === 'default') Notification.requestPermission(); }, { once: true });
load(true);
setInterval(() => hud(data.game), 5000);
