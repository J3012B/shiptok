---
name: feed
description: Start, stop, open or check ShipTok, the TikTok-style feed of your work, or start its demo. Use when the user says "open my feed", "start shiptok", "stop shiptok", "is shiptok running", or "shiptok demo".
---

# ShipTok

The launcher is `"${CLAUDE_PLUGIN_ROOT}/bin/shiptok"`:

| What the user wants | Run |
| --- | --- |
| Open the feed (starts it if needed) | `"${CLAUDE_PLUGIN_ROOT}/bin/shiptok" start; "${CLAUDE_PLUGIN_ROOT}/bin/shiptok" open` |
| Stop it | `"${CLAUDE_PLUGIN_ROOT}/bin/shiptok" stop` |
| Check it | `"${CLAUDE_PLUGIN_ROOT}/bin/shiptok" status` |
| Demo with made-up data | `"${CLAUDE_PLUGIN_ROOT}/bin/shiptok" demo` |
| Something's wrong | `"${CLAUDE_PLUGIN_ROOT}/bin/shiptok" logs 60`, then explain what the log shows |

If `~/.shiptok/.env` doesn't exist yet, use the `setup` skill first. Restart after changing `~/.shiptok/.env`.
