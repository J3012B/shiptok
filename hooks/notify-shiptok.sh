#!/bin/bash
# Claude Code hook: when any Claude session is waiting on you, drop a card into ShipTok.
# Installed by the ShipTok plugin (hooks/hooks.json). Silent when ShipTok is not running.
# Agents ShipTok started itself report back on their own, so they're skipped here.
[ -n "$SHIPTOK_AGENT$SHIPFEED_AGENT" ] && exit 0
input=$(cat)
URL="${SHIPTOK_URL:-http://127.0.0.1:4777}"
printf '%s' "$input" | /usr/bin/python3 -c '
import json,sys,os
d=json.load(sys.stdin)
cwd=d.get("cwd","")
print(json.dumps({"session_id":d.get("session_id"),"cwd":cwd,"title":"Claude in "+os.path.basename(cwd),
  "question":d.get("message") or "Waiting for you","status":"needs-you"}))' \
| curl -s -m 2 -X POST -H 'Content-Type: application/json' --data-binary @- "$URL/api/inbox" >/dev/null 2>&1
exit 0
