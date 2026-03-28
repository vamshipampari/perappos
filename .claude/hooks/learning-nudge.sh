#!/usr/bin/env bash
# Nudges every 3rd Stop event to capture learnings
# Critical: must check stop_hook_active to prevent infinite loops

INPUT=$(cat)

STOP_ACTIVE=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('stop_hook_active', False))" 2>/dev/null)
if [ "$STOP_ACTIVE" = "True" ]; then exit 0; fi

SESSION_ID=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('session_id', 'unknown'))" 2>/dev/null)
COUNTER_FILE="/tmp/claude_stop_${SESSION_ID}"

COUNT=0
if [ -f "$COUNTER_FILE" ]; then COUNT=$(cat "$COUNTER_FILE"); fi
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"

if [ $((COUNT % 3)) -eq 0 ]; then
  echo "💡 Learning check: did anything non-obvious happen? Run /capture-learning if yes."
fi