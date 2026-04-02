#!/usr/bin/env bash
set -euo pipefail

payload="$(cat)"

if command -v claude-secret-scan >/dev/null 2>&1; then
  claude-secret-scan --mode=pre
  exit 0
fi

if printf '%s' "$payload" | grep -Eiq 'AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36,}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----'; then
  echo '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","permissionDecision":"deny","permissionDecisionReason":"Potential secret detected in prompt or hook payload."}}'
fi
