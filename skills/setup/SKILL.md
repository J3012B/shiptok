---
name: setup
description: Set up ShipTok, the TikTok-style feed of your work. Checks prerequisites, connects GitHub and optionally a Notion backlog, writes the settings file, and starts the feed. Use when the user installs ShipTok, says "set up shiptok", or the feed is missing settings.
---

# Set up ShipTok

ShipTok is a local web app. Its code is in `${CLAUDE_PLUGIN_ROOT}`. The user's settings and data live in `~/.shiptok/`, so plugin updates never touch them. Walk the user through setup one step at a time, and do the work yourself wherever you can.

## 1. Check what's there

Run these, and fix or explain anything missing before going on:

- `node -v`: needs 18 or newer.
- `gh auth status`: GitHub CLI, signed in. If it's missing, tell the user to run `gh auth login` themselves, because it opens a browser.
- `claude --version`: agents and the curator run through the Claude Code CLI on the user's own plan.
- If `~/.shiptok/.env` already exists, read it, say what's set, and only fill the gaps.

## 2. Offer the demo first

Ask whether they want a 30-second look with made-up data before connecting anything. If yes, run `"${CLAUDE_PLUGIN_ROOT}/bin/shiptok" demo`, which opens http://127.0.0.1:4778, then continue setup.

## 3. Code folders

ShipTok finds local clones so agents can work in a fresh git worktree. Look for folders that contain git repositories: `~/Code`, `~/code`, `~/Coding`, `~/Projects`, `~/dev`, `~/src`, `~/GitHub`. Propose the ones that exist and let the user confirm. They go in `CODE_ROOTS`, comma-separated.

## 4. Notion backlog (optional)

Ask whether their backlog or roadmap lives in a Notion database. If not, skip this step; GitHub and Claude sessions are enough.

If yes:

1. Ask them to open https://www.notion.so/profile/integrations, create a new internal integration called "ShipTok", and turn on **Read content** only, with no insert, update or user info.
2. **Never ask for the token in chat.** Create `~/.shiptok/.env` with a line `NOTION_TOKEN=`, then ask the user to paste the token after the `=` themselves and save the file.
3. Ask them to share the backlog database with the connection: open the database page, then ⋯ → Connections → ShipTok.
4. Find the database without printing the token:
   ```bash
   set -a; . ~/.shiptok/.env; set +a
   curl -s -X POST https://api.notion.com/v1/search -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2025-09-03" -H "Content-Type: application/json" -d '{"filter":{"property":"object","value":"data_source"}}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const r of JSON.parse(s).results||[])console.log(r.id,"·",(r.title||[]).map(t=>t.plain_text).join(""))})'
   ```
   Show the titles and let them pick one. Write its id as `NOTION_DATA_SOURCE`. If nothing is listed, the database isn't shared with the connection yet.

## 5. A line about them

Ask for one or two sentences the curator should know: who they are, what they're building, and teammates' names, so "waiting on Ruben" lands. Put it in `CURATOR_CONTEXT` on a single line. Also set `SHIPTOK_NAME` to their first name.

## 6. Write the settings

`~/.shiptok/.env` ends up like this. Keep the token line the user pasted.

```
CODE_ROOTS=~/Code
NOTION_TOKEN=…
NOTION_DATA_SOURCE=…
CURATOR_CONTEXT=…
SHIPTOK_NAME=…
CURATOR_MODEL=sonnet
CURATE_EVERY_MIN=120
```

## 7. Start it

Run `"${CLAUDE_PLUGIN_ROOT}/bin/shiptok" start`, then `"${CLAUDE_PLUGIN_ROOT}/bin/shiptok" open`. The first curation takes about a minute. Then tell them:

- **Costs:** the curator is one Sonnet call, about $0.20–0.30. It runs at most every 2 hours and only if the feed was open in the last 2 hours, or when they press R. Agents they send run on their own Claude plan.
- **Agents:** an agent never merges. It works on a new branch in `~/.shiptok/worktrees/` and opens draft PRs.
- **Waiting sessions:** the plugin's hook drops a card into the feed whenever any Claude Code session is waiting on them.
- **Commands:** `/shiptok:feed` starts, stops or opens it later.
- **On a phone:** the feed listens on 127.0.0.1 only. To use it from a phone, set `HOST=0.0.0.0` and reach it over a private network such as Tailscale. Never expose it to the internet, because anyone who reaches it can send agents into their repos.
