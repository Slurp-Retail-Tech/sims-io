#!/usr/bin/env bash
set -euo pipefail

cd "$CLAUDE_PROJECT_DIR"

run_lint() {
  if [[ -f package.json ]] && command -v jq >/dev/null 2>&1; then
    if jq -e '.scripts.lint' package.json >/dev/null 2>&1; then
      npm run lint >/dev/null
      return
    fi
  fi

  if [[ -f pyproject.toml ]] && command -v ruff >/dev/null 2>&1; then
    ruff check .
    return
  fi

  if [[ -f Makefile ]] && grep -q '^lint:' Makefile; then
    make lint >/dev/null
    return
  fi

  return 0
}

if ! run_lint; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Lint failed. Fix lint errors before committing."}}'
fi
