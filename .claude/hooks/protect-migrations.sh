#!/usr/bin/env bash
set -euo pipefail

payload="$(cat)"
file_path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')"

case "$file_path" in
  */migrations/*|*/db/migrate/*|*/schema.prisma|*/prisma/migrations/*)
    # Allow creating NEW migration files (they are never auto-applied), but keep
    # protecting modifications to existing migration files — editing an
    # already-applied migration is the real hazard.
    if [ -n "$file_path" ] && [ -e "$file_path" ]; then
      echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Modifying an existing migration file is protected. Create a new forward migration instead."}}'
    fi
    ;;
esac
