# ShipTok

**TikTok for your work.** A vertical feed of everything that needs you: PRs waiting on your review, issues, your Notion backlog, and Claude Code sessions waiting for an answer. Swipe through it, send a Claude agent at any card in one tap, and the agent comes back into your feed when it needs a decision, a permission, or is done.

A curator (one cheap Claude call) merges GitHub, your Notion roadmap and your recent Claude Code sessions into ranked cards. Each card plays like a short video, using:

- screenshots Claude took in your sessions
- the PR's live preview
- the diff
- Notion checklists
- a graphic for the decision

You get XP, combos and a streak for clearing it.

> **Want it on your phone, without your laptop running?** A hosted version is in the works: the curator runs in the cloud, with push notifications for agents that need you. [Join the waitlist](https://github.com/J3012B/shiptok/issues/1) by subscribing to that issue, or [reserve a founding spot for €19](https://buy.stripe.com/cNicN4dObb867yQ2FYd3i01). It's credited toward your subscription, and fully refundable until launch.

## Install

ShipTok is a Claude Code plugin. In Claude Code:

```
/plugin install shiptok --marketplace J3012B/shiptok
```

Then run `/shiptok:setup`. Claude does the setup with you:

- checks you have Node 18+, the GitHub CLI (`gh`) signed in, and Claude Code
- offers a 30-second demo with made-up data first
- finds your code folders
- connects a Notion database if your backlog lives there (optional)
- starts the feed at http://127.0.0.1:4777

Later, `/shiptok:feed` starts, stops or opens it.

Your settings and data live in `~/.shiptok/`. Plugin updates never touch them.

## How it works

- **Feed:** GitHub (reviews requested, issues assigned to you, your open PRs), your Notion database, and your Claude Code sessions from the last 48 hours. The curator turns them into cards and ranks what's blocked on you first.
- **Agents:**
  - Tap Agent on a card and pick a move, or type your own.
  - A headless Claude Code run starts in a fresh git worktree on its own branch.
  - It never merges. It opens draft PRs.
  - When it needs you, it ends with a question, or it's blocked by a permission, and its card jumps back into your feed.
  - Answer in the panel, tick "Allow" for a blocked command, and it resumes the same session.
- **Every other Claude Code session:** the plugin's hook drops a card into the feed whenever any session is waiting on you.
- **Costs:** the curator is one Sonnet call, about $0.20–0.30. It runs at most every 2 hours, only while you've had the feed open, or when you press R. Agents run on your own Claude plan.

## Keys

`J`/`K` or ↑/↓ scroll · ←/→ slides · `A` send an agent · `D` done · `Z` later · `S` skip · `C` chat · `O` open · `R` refresh · `1`–`4` pick a move

## Demo mode

Use demo mode to show or record ShipTok without real data. The dot under the logo switches between Live and Demo, or you can run `node server.mjs --demo` (port 4778).

The demo is a made-up startup, "Tidepool", with scripted agents. They type, ask you something, and ship once you answer. Nothing calls Claude. Press R to reset between takes.

## Use it from your phone

The feed listens on 127.0.0.1 only, on purpose, because it can start agents that run commands on your machine. To use it from a phone, set `HOST` to your Tailscale address (or similar private network) in `~/.shiptok/.env`. Never expose it to the internet.

## Settings

All of these are optional and live in `~/.shiptok/.env`; the setup skill writes them for you:

| Setting | What it does |
| --- | --- |
| `CODE_ROOTS` | Folders with your git checkouts, comma-separated |
| `NOTION_TOKEN`, `NOTION_DATA_SOURCE` | Read-only Notion connection and the database to read |
| `CURATOR_CONTEXT` | A line about you and your team, for better ranking |
| `CURATOR_MODEL`, `CURATE_EVERY_MIN` | Curator model (default `sonnet`) and how often it may run |
| `MAX_AGENTS`, `AGENT_ALLOWED_TOOLS`, `AGENT_MODEL` | How many agents at once, and what they may do without asking |
| `SESSION_HOURS`, `DAILY_GOAL`, `PORT`, `HOST` | Session look-back, daily XP goal, server address |

## Anything can drop a card in

```bash
curl -X POST http://127.0.0.1:4777/api/inbox -H 'Content-Type: application/json' \
  -d '{"title":"Deploy bot","question":"Prod deploy is ready. Go?"}'
```

## Run without the plugin

Zero dependencies:

```bash
git clone https://github.com/J3012B/shiptok && cd shiptok
node server.mjs
```

## License

MIT
