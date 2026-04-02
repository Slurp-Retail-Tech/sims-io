#!/usr/bin/env bash
set -euo pipefail

cd "$CLAUDE_PROJECT_DIR"

if [[ -f package.json ]]; then
  staged="$(git diff --cached --name-only)"

  if printf '%s\n' "$staged" | grep -Eq '^(src/|app/|lib/|packages/)'; then
    if ! printf '%s\n' "$staged" | grep -Eq '^(package.json|CHANGELOG.md)$'; then
      echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Source changes are staged without a version or changelog update. Update package.json or CHANGELOG.md, or disable this hook if your repo does not version in source."}}'
    fi
  fi
fi
