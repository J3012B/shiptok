// Demo mode: a made-up startup ("Tidepool", a team calendar app) so ShipTok can be shown and recorded
// without any real repos, roadmap or client data. Agents are scripted, not real Claude runs.
const H = 36e5, now = () => Date.now();
const iso = ago => new Date(now() - ago).toISOString();
const day = n => new Date(now() + n * 864e5).toISOString().slice(0, 10);
const img = (f, label, agoH) => ({ type: 'image', src: '/media/' + f, label, at: iso(agoH * H) });
const vid = (f, label, agoH) => ({ type: 'video', src: '/media/' + f + '.mp4', poster: '/media/' + f + '.png', label, at: iso(agoH * H) });
const spark = peaks => Array.from({ length: 24 }, (_, i) => Math.round(2 + (peaks[i] || 0) + Math.abs(Math.sin(i * 1.7)) * 3));

const card = (id, o) => ({ id: 'ai:' + id, source: 'curator', updatedAt: iso((o.agoH || 1) * H), firstSeen: now() - (o.agoH || 1) * H, links: [], covers: [], ...o });

export function seed() {
  const items = [
    card('annual-discount', { kind: 'decide', title: 'Annual plan: 2 months free or 20% off?', priority: 92, effort: '2 min', repo: 'tidepool/web',
      hook: 'Pricing page ships Thursday; copy depends on your call.',
      body: 'The new pricing page is built (#418). The yearly toggle still says **2 months free** (≈17%). Maya suggested **20% off** because it reads simpler and matches competitors. Either way the Stripe prices exist already; only copy and one price id change.',
      links: [{ label: 'PR #418', url: 'https://github.com/tidepool/web/pull/418' }], session: { id: 'demo-pricing', cwd: '~/code/tidepool' },
      visual: { type: 'options', options: [{ label: '2 months free', detail: '≈17%, feels generous' }, { label: '20% off', detail: 'simpler, matches others' }, { label: 'Test both', detail: 'A/B for 2 weeks' }] },
      actions: [{ label: 'Go with 20%', sub: 'update copy + price id', instruction: 'Switch yearly to 20% off.' }, { label: 'Set up A/B', sub: 'split traffic 50/50', instruction: 'Set up an A/B test.' }],
      slides: [img('checkout.png', 'Claude saw this', 3), { type: 'diff', add: 186, del: 24, count: 6, state: 'open', files: [{ path: 'src/pricing/Plans.tsx', add: 98, del: 12 }, { path: 'src/pricing/Toggle.tsx', add: 41, del: 6 }, { path: 'src/billing/prices.ts', add: 22, del: 4 }, { path: 'tests/pricing.spec.ts', add: 19, del: 2 }, { path: 'src/i18n/en.json', add: 6, del: 0 }] }] }),
    card('launch-email', { kind: 'unblock', title: 'Launch email goes out Friday — needs your OK', priority: 95, effort: '2 min', agoH: 2,
      hook: '4,812 people get it at 9:00 CET Friday.',
      body: 'The two-way sync announcement is designed and scheduled in the email tool for **Friday 9:00 CET** to 4,812 users. The draft still shows a `{{first_name}}` fallback bug for 312 people without a name. Approve the copy, and an agent fixes the fallback.',
      visual: { type: 'countdown', date: day(4), label: 'Two-way sync email' },
      actions: [{ label: 'Fix fallback', sub: 'use "there" when no name', instruction: 'Fix the first-name fallback.' }],
      slides: [img('email.png', 'You pasted this', 5), { type: 'stat', value: '312', label: 'people would see {{first_name}}', sub: 'no name on file' }] }),
    card('pr-calendar-sync', { kind: 'review', title: 'Two-way Google sync is ready for your review', priority: 88, effort: '15 min', repo: 'tidepool/app', agoH: 4,
      hook: 'Ben asked for your review 4 h ago; CI is green.',
      body: '#412 adds two-way Google Calendar sync: bookings write to Google, Google events block slots. 1,942 events synced on staging without conflicts. One open question from Ben: should descriptions copy by default?',
      links: [{ label: 'PR #412', url: 'https://github.com/tidepool/app/pull/412' }],
      visual: { type: 'flow', steps: ['Skim the diff', 'Try it on preview', 'Answer Ben', 'Approve'] },
      slides: [img('settings.png', 'From #412', 4), { type: 'site', src: '/media/landing.png', url: 'https://feat-two-way-sync.tidepool.pages.dev', label: 'Live preview' },
        { type: 'diff', add: 1318, del: 242, count: 23, state: 'open', files: [{ path: 'src/sync/google/twoWay.ts', add: 412, del: 0 }, { path: 'src/sync/google/webhooks.ts', add: 233, del: 18 }, { path: 'src/sync/conflicts.ts', add: 201, del: 64 }, { path: 'db/migrations/0042_sync_state.sql', add: 88, del: 0 }, { path: 'src/settings/CalendarSync.tsx', add: 176, del: 91 }, { path: 'tests/sync/twoWay.test.ts', add: 208, del: 0 }] }] }),
    card('dark-mode-save', { kind: 'build', title: 'Save button hides behind the keyboard', priority: 80, effort: '1 h', repo: 'tidepool/app', agoH: 6,
      hook: '3 users reported it this week, all on iPhone dark mode.',
      body: 'On iPhone the **Save** button of the booking-link sheet sits under the keyboard, so people can\'t save without closing it. Happens in light mode too but is invisible in dark mode screenshots. Likely the sheet uses `100vh` instead of the visual viewport.',
      visual: { type: 'flow', steps: ['Reproduce on iPhone', 'Use visual viewport', 'Pin Save above keys', 'Screenshot both modes'] },
      slides: [vid('bug', 'Screen recording from a user', 6), { type: 'checklist', done: 1, total: 4, items: [{ t: 'Pin Save above the keyboard', done: false }, { t: 'Test iPhone SE + 15 Pro', done: false }, { t: 'Before/after screenshots', done: false }, { t: 'Reproduce from user report', done: true }] }] }),
    card('signups-up', { kind: 'fyi', title: 'Sign-ups up 38% since the new onboarding', priority: 60, effort: '2 min', agoH: 9,
      hook: 'Best month yet — and activation rose too.',
      body: '1,284 sign-ups in 30 days, up 38%. Activation went from 52% to 61% after the 3-step onboarding shipped on 2 Nov. Churn ticked up 0.3 pts, mostly solo accounts.',
      visual: { type: 'stat', value: '+38%', label: 'sign-ups in 30 days', sub: 'activation 52% → 61%' },
      slides: [vid('dash', 'Claude saw this', 9), { type: 'activity', buckets: spark({ 9: 14, 10: 22, 11: 18, 15: 9, 20: 12 }), tools: [{ name: 'Bash', n: 48 }, { name: 'browser_batch', n: 21 }, { name: 'Read', n: 17 }], messages: 214, session: 'demo-metrics' }] }),
    card('timezone-lisbon', { kind: 'build', title: 'Bookings in Lisbon land an hour off', priority: 76, effort: 'half day', repo: 'tidepool/app', agoH: 12,
      hook: 'Northwind (42 seats) is in Lisbon and noticed.',
      body: 'Since the clocks changed on 26 Oct, bookings made from Lisbon show one hour late for guests in Berlin. The slot finder converts with a fixed offset instead of the zone name. Issue #397 has two customer reports.',
      links: [{ label: 'Issue #397', url: 'https://github.com/tidepool/app/issues/397' }],
      visual: { type: 'stat', value: '1 h', label: 'off since 26 Oct', sub: '2 customer reports' },
      slides: [img('tz.png', 'From issue #397', 12), { type: 'flow', steps: ['Use zone names, not offsets', 'Test DST weeks', 'Recheck Northwind bookings'] }, { type: 'activity', buckets: spark({ 4: 10, 5: 17, 6: 8 }), tools: [{ name: 'Grep', n: 22 }, { name: 'Read', n: 19 }, { name: 'Bash', n: 9 }], messages: 88, session: 'demo-tz' }] }),
    card('churn-notes', { kind: 'followup', title: 'Maya\'s churn interviews: 3 things to act on', priority: 58, effort: '15 min', agoH: 20,
      hook: 'She interviewed 9 churned teams; notes are in the roadmap.',
      body: 'Top reasons: no Outlook two-way sync (5 of 9), price per seat for part-timers (3), and missing round-robin for sales teams (2). Maya proposes a part-time seat at half price.',
      visual: { type: 'options', options: [{ label: 'Outlook sync next', detail: '5 of 9 churned' }, { label: 'Part-time seats', detail: 'half price' }, { label: 'Round-robin', detail: 'sales teams' }] },
      slides: [vid('churn', 'From the roadmap page', 20), { type: 'checklist', done: 9, total: 9, items: [{ t: 'Northwind Studio — Outlook', done: true }, { t: 'Bright Labs — price', done: true }, { t: 'Oak & Ivy — Outlook', done: true }, { t: 'Kestrel Health — round-robin', done: true }, { t: 'Fable Coffee — price', done: true }] }] }),
    card('flaky-ci', { kind: 'unblock', title: 'CI is red on main for 2 hours', priority: 90, effort: '15 min', repo: 'tidepool/app', agoH: 2,
      hook: 'Blocks 4 open PRs from merging.',
      body: 'The `checkout.spec.ts` end-to-end test times out about one run in three since Stripe test mode got slower. Nothing in the app changed. Retrying passes.',
      visual: { type: 'stat', value: '4', label: 'PRs blocked', sub: 'flaky checkout test' },
      slides: [vid('ci', 'Claude saw this', 1), { type: 'activity', buckets: spark({ 20: 16, 21: 25, 22: 19, 23: 8 }), tools: [{ name: 'Bash', n: 31 }, { name: 'Read', n: 12 }], messages: 66, session: 'demo-ci' }] }),
  ];
  for (const it of items) it.visual && it.slides && !it.slides.some(s => s.type === it.visual.type) && it.slides.splice(1, 0, it.visual);
  const slides = Object.fromEntries(items.map(it => [it.id, it.slides || (it.visual ? [it.visual] : [])]));
  items.forEach(it => delete it.slides);

  const agents = {
    d1: { id: 'd1', itemId: null, title: 'Add Outlook two-way sync (spike)', repo: 'tidepool/app', status: 'running', instruction: 'Spike Outlook two-way sync using the Google adapter as a template. Draft PR, no merge.',
      log: [], history: [{ who: 'you', text: 'Spike Outlook two-way sync using the Google adapter as a template. Draft PR, no merge.', at: now() - 6 * 6e4 }], startedAt: now() - 6 * 6e4, cost: 0.41, cwd: '~/.shiptok/worktrees/d1', loop: true, shot: { src: '/media/settings.png', label: 'Working on this screen' } },
    d2: { id: 'd2', itemId: null, title: 'Fix the flaky checkout test', repo: 'tidepool/app', status: 'done', instruction: 'Make checkout.spec.ts stable.',
      summary: 'The test waited a fixed 5 s for Stripe. It now waits for the **payment succeeded** event instead, and I ran it 50× in a row: all green. Draft PR: https://github.com/tidepool/app/pull/421',
      prUrl: 'https://github.com/tidepool/app/pull/421', shot: { src: '/media/cipass.png', label: 'After the fix' }, diff: { add: 38, del: 21, count: 3, files: [{ path: 'tests/e2e/checkout.spec.ts', add: 24, del: 17 }, { path: 'tests/e2e/helpers/stripe.ts', add: 12, del: 2 }, { path: 'playwright.config.ts', add: 2, del: 2 }] }, log: [], history: [{ who: 'you', text: 'Make checkout.spec.ts stable.', at: now() - 40 * 6e4 }], startedAt: now() - 40 * 6e4, endedAt: now() - 12 * 6e4, cost: 0.63 },
  };
  const game = { xp: 2390, streak: 12, lastDay: new Date().toISOString().slice(0, 10), today: 6, todayDay: new Date().toISOString().slice(0, 10), combo: 0, lastActionAt: 0, badges: ['streak-3', 'streak-7', 'first-blood', 'unblocker'] };
  return { items: Object.fromEntries(items.map(i => [i.id, i])), slides, agents, game };
}

// What a scripted agent "does". First run asks a question; after your reply it finishes with a PR.
export function script(a, resume) {
  const t = (a.title + ' ' + a.instruction).toLowerCase();
  const file = /email/.test(t) ? 'emails/two-way-sync.mjml' : /price|annual|20%/.test(t) ? 'src/pricing/Plans.tsx' : /keyboard|save/.test(t) ? 'src/links/LinkSheet.tsx'
    : /lisbon|timezone/.test(t) ? 'src/slots/convert.ts' : /outlook/.test(t) ? 'src/sync/outlook/twoWay.ts' : 'src/app.ts';
  const first = [
    ['tool', `Bash: git checkout -b fix/shiptok-${a.id}`], ['say', 'Reading the code around this first.'], ['tool', `Read: ${file}`],
    ['tool', `Grep: ${file.split('/').pop().split('.')[0]}`], ['tool', 'Read: tests/' + file.split('/').pop().replace(/\.\w+$/, '.test.ts')],
    ['say', 'Found it. Making the change.'], ['tool', `Edit: ${file}`], ['tool', 'Bash: npm test -- --run'], ['say', '214 tests passed'],
  ];
  const question = /price|annual|20%/.test(t) ? 'Copy is updated to "20% off". Should existing yearly customers keep their old price at renewal? (A) keep it, (B) move them to the new price.'
    : /email/.test(t) ? 'Fallback is "Hi there,". Do you also want me to send a test to your inbox before Friday? (yes / no)'
    : /keyboard|save/.test(t) ? 'Save now sticks above the keyboard. Should it also stay visible when the sheet is scrolled? (A) yes, sticky, (B) only at the bottom.'
    : 'The change works locally. Should I open the PR as a draft or ready for review?';
  const done = [['tool', `Edit: ${file}`], ['tool', 'Bash: npm test -- --run'], ['say', '216 tests passed'], ['tool', 'Bash: git push -u origin HEAD'],
    ['tool', 'Bash: gh pr create --draft'], ['say', 'Draft PR is up.']];
  const pr = 'https://github.com/tidepool/app/pull/' + (430 + (a.id.charCodeAt(0) % 9));
  if (a.loop) return { lines: [...first, ['tool', 'Read: src/sync/google/twoWay.ts'], ['tool', 'Write: src/sync/outlook/graphClient.ts'], ['tool', 'Bash: npm run typecheck'], ['say', 'Mapping Outlook recurrence rules onto ours…']], loop: true };
  const shot = /keyboard|save/.test(t) ? { src: '/media/fixed.mp4', poster: '/media/fixed.png', video: true, label: 'After the fix' }
    : /price|annual|20%/.test(t) ? { src: '/media/checkout.png', label: 'Updated pricing page' } : /email/.test(t) ? { src: '/media/email.png', label: 'Fixed email preview' }
    : /lisbon|timezone/.test(t) ? { src: '/media/tz.png', label: 'Reproduced' } : /outlook/.test(t) ? { src: '/media/settings.png', label: 'Working on this screen' }
    : /churn|interview/.test(t) ? { src: '/media/churn.png', label: 'From the notes' } : /ci|flaky|test/.test(t) ? { src: '/media/cipass.png', label: 'After the fix' } : { src: '/media/dash.png', label: 'Claude saw this' };
  const test = 'tests/' + file.split('/').pop().replace(/\.\w+$/, '.test.ts');
  if (!resume) return { lines: first, end: { status: 'needs-you', question, shot, diff: { add: 27, del: 9, count: 2, files: [{ path: file, add: 19, del: 9 }, { path: test, add: 8, del: 0 }] } } };
  return { lines: done, end: { status: 'done', shot, summary: `Done — ${file} is changed, tests pass, and the draft PR is ready for you: ${pr}`, prUrl: pr, diff: { add: 64, del: 12, count: 3, files: [{ path: file, add: 34, del: 12 }, { path: test, add: 26, del: 0 }, { path: 'CHANGELOG.md', add: 4, del: 0 }] } } };
}
