#!/usr/bin/env bash
set -euo pipefail

payload="$(cat)"
file_path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')"

case "$file_path" in
  */migrations/*|*/db/migrate/*|*/schema.prisma|*/prisma/migrations/*)
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Migration or schema edits are protected. Review the migration plan and re-run intentionally."}}'
    ;;
esac
