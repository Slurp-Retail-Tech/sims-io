#!/usr/bin/env bash
set -euo pipefail

if command -v osascript >/dev/null 2>&1; then
  osascript -e 'display notification "Claude Code is waiting for input" with title "Claude Code"'
elif command -v notify-send >/dev/null 2>&1; then
  notify-send "Claude Code" "Claude Code is waiting for input"
else
  printf '\a' >/dev/tty 2>/dev/null || true
fi
