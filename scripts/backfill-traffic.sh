#!/bin/bash
# Traffic sync backfill: Nov 2025 - Apr 2026
# Waits for each chunk to finish before starting next one

API="http://localhost:3099/api/sync/sp-api"
STATUS_API="http://localhost:3099/api/sync/status"

# 7-day chunks for Nov 2025 - Apr 2026
RANGES=(
  "2025-11-08|2025-11-14"
  "2025-11-15|2025-11-21"
  "2025-11-22|2025-11-30"
  "2025-12-01|2025-12-07"
  "2025-12-08|2025-12-14"
  "2025-12-15|2025-12-21"
  "2025-12-22|2025-12-31"
  "2026-01-01|2026-01-07"
  "2026-01-08|2026-01-14"
  "2026-01-15|2026-01-21"
  "2026-01-22|2026-01-31"
  "2026-02-01|2026-02-07"
  "2026-02-08|2026-02-14"
  "2026-02-15|2026-02-21"
  "2026-02-22|2026-02-28"
  "2026-03-01|2026-03-07"
  "2026-03-08|2026-03-14"
  "2026-03-15|2026-03-21"
  "2026-03-22|2026-03-31"
  "2026-04-01|2026-04-07"
  "2026-04-08|2026-04-14"
  "2026-04-15|2026-04-21"
  "2026-04-22|2026-04-29"
)

wait_for_idle() {
  echo "  Waiting for current sync to finish..."
  while true; do
    STATUS=$(curl -s "$STATUS_API" | python3 -c "
import sys, json
d = json.load(sys.stdin)
logs = [l for l in d['logs'] if l['api_type'] == 'sp-api-traffic']
print(logs[0]['status'] if logs else 'idle')
" 2>/dev/null)
    if [ "$STATUS" != "running" ]; then
      echo "  Status: $STATUS"
      break
    fi
    sleep 15
  done
}

# Wait for any currently-running sync first
wait_for_idle

for RANGE in "${RANGES[@]}"; do
  START=$(echo "$RANGE" | cut -d'|' -f1)
  END=$(echo "$RANGE" | cut -d'|' -f2)

  echo "=== Syncing $START to $END ==="
  RESPONSE=$(curl -s --max-time 30 -X POST "$API" \
    -H "Content-Type: application/json" \
    -d "{\"syncType\":\"traffic\",\"startDate\":\"$START\",\"endDate\":\"$END\"}" 2>&1)
  echo "  Triggered: $RESPONSE"

  # Give server 3s to register the sync before polling
  sleep 3
  wait_for_idle

  echo "  Done: $START to $END"
  echo ""
done

echo "=== Backfill complete ==="
