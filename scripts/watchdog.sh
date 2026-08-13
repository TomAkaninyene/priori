#!/usr/bin/env bash
# Priori watchdog: checks pm2 health, recent errors, and env config drift.
# Only pings Claude (and thus PushNotification) when something is actually wrong.
set -uo pipefail

REPO=/root/xlayer-signal-ledger
STATE_DIR="$REPO/detector/state"
STATE_FILE="$STATE_DIR/watchdog-state.json"
LIVE_URL="https://priori-delta-nine.vercel.app"
CLAUDE_BIN=/root/.local/bin/claude
mkdir -p "$STATE_DIR"

problems=()

# --- pm2 health ---
PM2_JSON=$(pm2 jlist 2>/dev/null || echo '[]')

for app in priori-detector priori-publisher; do
  status=$(echo "$PM2_JSON" | python3 -c "
import json,sys
apps=json.load(sys.stdin)
for a in apps:
    if a.get('name')=='$app':
        print(a.get('pm2_env',{}).get('status','missing'))
        break
else:
    print('missing')
")
  restarts=$(echo "$PM2_JSON" | python3 -c "
import json,sys
apps=json.load(sys.stdin)
for a in apps:
    if a.get('name')=='$app':
        print(a.get('pm2_env',{}).get('restart_time',0))
        break
else:
    print(0)
")
  if [ "$status" != "online" ]; then
    problems+=("$app is status=$status (expected online)")
  fi

  prev_restarts=$(python3 -c "
import json
try:
    d=json.load(open('$STATE_FILE'))
    print(d.get('$app',{}).get('restarts',$restarts))
except Exception:
    print($restarts)
")
  if [ "$restarts" -gt "$prev_restarts" ]; then
    problems+=("$app restart count jumped from $prev_restarts to $restarts since last check")
  fi
done

# --- new ERROR lines since last check ---
ERR_LOG=$(pm2 conf priori-detector 2>/dev/null | grep -o '/root/.pm2/logs/priori-detector-error.log' | head -1)
ERR_LOG=${ERR_LOG:-/root/.pm2/logs/priori-detector-error.log}
cur_err_lines=$(wc -l < "$ERR_LOG" 2>/dev/null || echo 0)
prev_err_lines=$(python3 -c "
import json
try:
    print(json.load(open('$STATE_FILE')).get('err_lines',$cur_err_lines))
except Exception:
    print($cur_err_lines)
")
if [ "$cur_err_lines" -gt "$prev_err_lines" ]; then
  new_errors=$(tail -n "+$((prev_err_lines + 1))" "$ERR_LOG" | grep -i "ERROR" | tail -5)
  if [ -n "$new_errors" ]; then
    problems+=("new ERROR log lines in priori-detector:
$new_errors")
  fi
fi

# --- env drift: live bundle vs local root .env ---
DETECTOR_MIN_RR=$(grep -E '^DETECTOR_MIN_RR=' "$REPO/.env" | cut -d= -f2)
DETECTOR_CONVICTION_THRESHOLD=$(grep -E '^DETECTOR_CONVICTION_THRESHOLD=' "$REPO/.env" | cut -d= -f2)

html=$(curl -sf --max-time 15 "$LIVE_URL" || echo "")
asset=$(echo "$html" | grep -oE '/assets/index-[^"]+\.js' | head -1)
if [ -n "$asset" ]; then
  js=$(curl -sf --max-time 15 "$LIVE_URL$asset" || echo "")
  live_min_rr=$(echo "$js" | grep -oE 'VITE_MIN_RR:`[^`]+`' | head -1 | sed -E 's/.*`([^`]+)`/\1/')
  live_threshold=$(echo "$js" | grep -oE 'VITE_CONVICTION_THRESHOLD:`[^`]+`' | head -1 | sed -E 's/.*`([^`]+)`/\1/')

  if [ -n "$DETECTOR_MIN_RR" ] && [ -n "$live_min_rr" ] && [ "$DETECTOR_MIN_RR" != "$live_min_rr" ]; then
    problems+=("env drift: live frontend VITE_MIN_RR=$live_min_rr but detector DETECTOR_MIN_RR=$DETECTOR_MIN_RR")
  fi
  if [ -n "$DETECTOR_CONVICTION_THRESHOLD" ] && [ -n "$live_threshold" ] && [ "$DETECTOR_CONVICTION_THRESHOLD" != "$live_threshold" ]; then
    problems+=("env drift: live frontend VITE_CONVICTION_THRESHOLD=$live_threshold but detector DETECTOR_CONVICTION_THRESHOLD=$DETECTOR_CONVICTION_THRESHOLD")
  fi
else
  problems+=("could not fetch/parse live frontend bundle at $LIVE_URL to check env drift")
fi

# --- save state for next run ---
python3 -c "
import json
state = {
    'priori-detector': {'restarts': $(echo "$PM2_JSON" | python3 -c "
import json,sys
apps=json.load(sys.stdin)
for a in apps:
    if a.get('name')=='priori-detector':
        print(a.get('pm2_env',{}).get('restart_time',0)); break
else:
    print(0)
")},
    'priori-publisher': {'restarts': $(echo "$PM2_JSON" | python3 -c "
import json,sys
apps=json.load(sys.stdin)
for a in apps:
    if a.get('name')=='priori-publisher':
        print(a.get('pm2_env',{}).get('restart_time',0)); break
else:
    print(0)
")},
    'err_lines': $cur_err_lines,
}
json.dump(state, open('$STATE_FILE','w'))
"

# --- alert only if something is wrong ---
if [ ${#problems[@]} -gt 0 ]; then
  summary=$(printf '%s\n---\n' "${problems[@]}")
  echo "$(date -u +%FT%TZ) PROBLEMS FOUND:"
  echo "$summary"
  "$CLAUDE_BIN" -p "Priori watchdog detected issue(s) on the production server. Call PushNotification once with a single concise (<200 char) summary of the most important problem below. Do not investigate further, do not use any other tool, just notify.

$summary" --allowedTools PushNotification
else
  echo "$(date -u +%FT%TZ) all clear"
fi
