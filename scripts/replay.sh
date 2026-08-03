#!/usr/bin/env bash
#
# Replay hand-authored transcripts through the real webhook path.
#
# HighLevel refuses to provision LC Phone on marketplace sandbox companies
# ("Twilio master account has disabled the creation of sandbox SubAccounts"),
# so no number can be bought and no live Voice AI call can be placed. This
# script posts transcripts to the same endpoint GHL calls in production, so
# everything downstream — normalize, judge, sanitize, scoreCall, findings,
# use actions, recommendations — runs untouched.
#
# Usage:  ./scripts/replay.sh [api-base-url]
#         API=http://localhost:8000 ./scripts/replay.sh
set -euo pipefail

API="${1:-${API:-http://localhost:8000}}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/replay" && pwd)"

for file in "$DIR"/*.json; do
  name="$(basename "$file")"
  printf '→ %-40s ' "$name"
  curl -sS -X POST "$API/webhooks/ghl" \
    -H 'content-type: application/json' \
    --data-binary "@$file"
  printf '\n'
done

echo
echo "Queued. Watch the workers at http://127.0.0.1:8288 (evaluate-call)."
echo "Re-running is safe: the unique (location_id, ghl_call_id) index makes a replay a no-op."
